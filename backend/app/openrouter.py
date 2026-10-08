"""OpenRouter endpoints and the Decisions API compatibility adapter."""

import math
import os
from typing import Any


API_BASE = os.environ.get("OPENROUTER_API_BASE", "https://openrouter.ai").rstrip("/")
API_KEY_ENV = "OPENROUTER_API_KEY"
DECISION_MODEL = os.environ.get(
    "OPENROUTER_DECISION_MODEL", "openai/gpt-6-luna-decisions"
)
REPORT_MODEL = os.environ.get("OPENROUTER_REPORT_MODEL", "openai/gpt-6-luna")
IMAGE_MODEL = os.environ.get(
    "OPENROUTER_IMAGE_MODEL", "openai/gpt-image-2.5-sunburst"
)
IMAGE_QUALITY = os.environ.get("OPENROUTER_IMAGE_QUALITY", "low")

ENDPOINTS = {
    "decisions": "/api/alpha/decisions",
    "responses": "/api/v1/responses",
    "images": "/api/v1/images",
}


def api_key() -> str:
    return os.environ.get(API_KEY_ENV, "").strip()


def configured() -> bool:
    return bool(api_key())


def endpoint(operation: str) -> str:
    return API_BASE + ENDPOINTS[operation]


def decision_question(question: dict[str, Any]) -> dict[str, Any]:
    """Translate one OpenAI Decisions question to OpenRouter's typed schema."""
    question_type = question["type"]
    result: dict[str, Any] = {
        "type": {"predicate": "noul"}.get(question_type, question_type),
        "instructions": question["instructions"],
    }
    if question_type == "predicate":
        result["criteria"] = {
            "true": question["instructions"],
            "false": "The condition in the instructions is false or not supported by the evidence.",
        }
    elif question_type == "choice":
        result["criteria"] = {
            str(choice["value"]): str(choice.get("description", choice["value"]))
            for choice in question.get("choices", [])
        }
    elif question_type == "score":
        result["criteria"] = [
            "%s: %s" % (level["label"], level.get("description", ""))
            for level in question.get("levels", [])
        ]
    else:
        raise ValueError("Unsupported Decisions question type: " + str(question_type))
    return result


def decision_request(
    context: str,
    image_parts: list[dict[str, Any]],
    questions: list[dict[str, Any]],
) -> dict[str, Any]:
    """Build a shared state request with inline image parts and keyed questions."""
    state: list[dict[str, Any]] = [{"type": "text", "text": context}]
    for part in image_parts:
        image_url = part.get("image_url")
        if not isinstance(image_url, str):
            raise ValueError("Decision images must be inline data URLs.")
        state.append(
            {"type": "image_url", "image_url": {"url": image_url}}
        )
    return {
        "model": DECISION_MODEL,
        "state": state,
        "questions": {
            question["name"]: decision_question(question) for question in questions
        },
    }


def _probability_list(
    probabilities: Any,
    labels: dict[str, str] | None = None,
) -> list[dict[str, Any]]:
    if not isinstance(probabilities, dict):
        return []
    return [
        {
            "label": (labels or {}).get(str(key), str(key)),
            "probability": value,
        }
        for key, value in probabilities.items()
        if isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(float(value))
    ]


def normalize_decision_response(
    payload: dict[str, Any], questions: list[dict[str, Any]]
) -> dict[str, Any]:
    """Normalize OpenRouter's keyed answers for the existing workflow contracts."""
    raw_answers = payload.get("answers")
    if not isinstance(raw_answers, dict):
        raise ValueError("OpenRouter returned an invalid Decisions answer map.")

    answers: list[dict[str, Any]] = []
    for question in questions:
        name = question["name"]
        raw = raw_answers.get(name)
        if not isinstance(raw, dict):
            raise ValueError("OpenRouter omitted the Decisions answer: " + name)

        raw_type = raw.get("type")
        question_type = question["type"]
        expected_type = {"predicate": "noul"}.get(question_type, question_type)
        if raw_type != expected_type:
            raise ValueError("OpenRouter returned an unexpected answer type for " + name)

        answer: dict[str, Any] = {
            "name": name,
            "confidence": raw.get("confidence"),
        }
        if raw_type == "noul":
            probability = raw.get("noul")
            if (
                not isinstance(probability, (int, float))
                or isinstance(probability, bool)
                or not math.isfinite(float(probability))
                or not 0 <= float(probability) <= 1
            ):
                raise ValueError("OpenRouter returned an invalid noul answer for " + name)
            answer.update(type="predicate", probability=probability)
        elif raw_type == "choice":
            valid_choices = {
                str(choice["value"]) for choice in question.get("choices", [])
            }
            if raw.get("choice") not in valid_choices:
                raise ValueError("OpenRouter returned an unknown choice for " + name)
            answer.update(
                type="choice",
                choice=raw.get("choice"),
                probabilities=_probability_list(raw.get("probabilities")),
            )
        elif raw_type == "score":
            score = raw.get("score")
            level_count = len(question.get("levels", []))
            if (
                not isinstance(score, (int, float))
                or isinstance(score, bool)
                or not math.isfinite(float(score))
                or not 0 <= float(score) <= max(0, level_count - 1)
            ):
                raise ValueError("OpenRouter returned an invalid score for " + name)
            legend = raw.get("legend")
            labels = legend if isinstance(legend, dict) else {}
            if not labels:
                labels = {
                    str(index): level["label"]
                    for index, level in enumerate(question.get("levels", []))
                }
            answer.update(
                type="score",
                score=score,
                probabilities=_probability_list(raw.get("probabilities"), labels),
            )
        answers.append(answer)

    return {
        "model": payload.get("model", DECISION_MODEL),
        "answers": answers,
        "usage": payload.get("usage", {}),
    }
