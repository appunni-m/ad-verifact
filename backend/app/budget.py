import os
from decimal import Decimal
from typing import Any


class BudgetLimitExceeded(RuntimeError):
    pass


def _reserve_amount(kind: str) -> Decimal:
    key = "AI_IMAGE_CALL_RESERVE_USD" if kind == "image" else "AI_TEXT_CALL_RESERVE_USD"
    legacy_key = "OPENAI_IMAGE_CALL_RESERVE_USD" if kind == "image" else "OPENAI_TEXT_CALL_RESERVE_USD"
    fallback = "2.25" if kind == "image" else "0.50"
    return Decimal(os.environ.get(key, os.environ.get(legacy_key, fallback))).quantize(Decimal("0.000001"))


def reserve(
    run_id: str,
    run_limit_usd: float,
    kind: str,
    estimated_spent_usd: float = 0.0,
) -> float:
    """Apply a request-local spend check without storing a ledger.

    The browser returns the accumulated estimate with each workflow stage. This
    is a demo guardrail, not a billing boundary; configure a spend limit in
    OpenRouter for the hard limit.
    """
    del run_id
    amount = _reserve_amount(kind)
    available = Decimal(str(max(0.0, run_limit_usd))) - Decimal(str(max(0.0, estimated_spent_usd)))
    if amount > available:
        raise BudgetLimitExceeded(
            "This run reached its estimated spend cap. Raise the cap in the workflow input node to continue."
        )
    return float(amount)


def estimate_cost(usage: Any, kind: str, reserve_usd: float) -> float:
    if not isinstance(usage, dict):
        return reserve_usd
    try:
        reported_cost = Decimal(str(usage.get("cost")))
        if reported_cost.is_finite() and reported_cost >= 0:
            return float(reported_cost.quantize(Decimal("0.000001")))
    except (ArithmeticError, TypeError, ValueError):
        pass
    try:
        input_tokens = int(usage.get("input_tokens", 0))
        output_tokens = int(usage.get("output_tokens", 0))
    except (TypeError, ValueError):
        return reserve_usd
    if input_tokens <= 0 and output_tokens <= 0:
        return reserve_usd

    if kind == "image":
        detail = usage.get("input_tokens_details", {})
        output_detail = usage.get("output_tokens_details", {})
        image_input = int(detail.get("image_tokens", 0)) if isinstance(detail, dict) else 0
        image_output = int(output_detail.get("image_tokens", 0)) if isinstance(output_detail, dict) else output_tokens
        text_input = max(0, input_tokens - image_input)
        input_cost = (
            image_input * Decimal(os.environ.get("AI_IMAGE_INPUT_USD_PER_1M", "4"))
            + text_input * Decimal(os.environ.get("AI_IMAGE_TEXT_INPUT_USD_PER_1M", "2.5"))
        ) / Decimal(1_000_000)
        output_cost = Decimal(image_output) * Decimal(os.environ.get("AI_IMAGE_OUTPUT_USD_PER_1M", "15")) / Decimal(1_000_000)
    else:
        detail = usage.get("input_tokens_details", {})
        cached = int(detail.get("cached_tokens", 0)) if isinstance(detail, dict) else 0
        regular = max(0, input_tokens - cached)
        input_cost = (
            regular * Decimal(os.environ.get("AI_TEXT_INPUT_USD_PER_1M", "0.10"))
            + cached * Decimal(os.environ.get("AI_TEXT_CACHED_INPUT_USD_PER_1M", "0.01"))
        ) / Decimal(1_000_000)
        output_cost = Decimal(output_tokens) * Decimal(os.environ.get("AI_TEXT_OUTPUT_USD_PER_1M", "0.50")) / Decimal(1_000_000)
    return float((input_cost + output_cost).quantize(Decimal("0.000001")))
