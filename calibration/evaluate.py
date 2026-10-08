"""Measure the deterministic gate against the labeled synthetic fixture set."""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent / "backend"))

from app.contracts import AnalysisReport, Finding, QuestionAnswer, WorkflowThresholds  # noqa: E402
from app.workflow import _needs_human_review  # noqa: E402


def models_for(case: dict[str, object]) -> tuple[AnalysisReport, AnalysisReport]:
    fixture = case["fixture_prediction"]
    assert isinstance(fixture, dict)
    answers = [QuestionAnswer(id=item["id"], question=item["id"], answer=item["answer"], answer_type=item["answer_type"]) for item in fixture["factual_answers"]]
    facts = [
        Finding(number=index, severity=item["severity"], title=item["title"], explanation=item["evidence"], evidence=item["evidence"], recommendation="Verify and correct against the supplied approved reference.")
        for index, item in enumerate(fixture["factual_findings"], start=1)
    ]
    quality_items = fixture["quality_findings"]
    quality = [
        Finding(number=index, severity=item["severity"], title=item["title"], explanation=item["evidence"], evidence=item["evidence"], recommendation="Refine the creative and check the revised layout at placement size.")
        for index, item in enumerate(quality_items, start=1)
    ]
    factual_report = AnalysisReport(overall_score=100, summary="Labeled factual fixture", findings=facts, question_answers=answers)
    quality_report = AnalysisReport(overall_score=fixture["quality_score"], summary="Labeled quality fixture", findings=quality)
    return factual_report, quality_report


def score_threshold(cases: list[dict[str, object]], threshold: int) -> dict[str, object]:
    limits = WorkflowThresholds(minimum_quality_score=threshold)
    false_passes = 0
    false_reviews = 0
    factual_misses = 0
    factual_review_cases = 0
    review_count = 0
    by_format: dict[str, dict[str, int]] = defaultdict(
        lambda: {
            "total": 0,
            "expected_review": 0,
            "predicted_review": 0,
            "factual_review_cases": 0,
            "factual_misses": 0,
        }
    )
    details = []
    for case in cases:
        factual, quality = models_for(case)
        predicted, reason = _needs_human_review(factual, quality, limits)
        expected = bool(case["expected_needs_review"])
        factual_issue = any(finding.severity in {"critical", "high"} for finding in factual.findings) or any(
            (answer.answer_type == "choice" and answer.answer in {"mismatch", "cannot_assess"})
            or (
                answer.id == "copy_syntax_issue"
                and isinstance(answer.answer, (int, float))
                and answer.answer >= limits.syntax_issue_probability
            )
            or (
                answer.id == "potentially_sensitive_claim"
                and isinstance(answer.answer, (int, float))
                and answer.answer >= limits.sensitive_claim_probability
            )
            for answer in factual.question_answers
        )
        factual_miss = factual_issue and not predicted
        false_passes += int(expected and not predicted)
        false_reviews += int(not expected and predicted)
        factual_review_cases += int(factual_issue)
        factual_misses += int(factual_miss)
        review_count += int(predicted)
        format_metrics = by_format[str(case["ad_type"])]
        format_metrics["total"] += 1
        format_metrics["expected_review"] += int(expected)
        format_metrics["predicted_review"] += int(predicted)
        format_metrics["factual_review_cases"] += int(factual_issue)
        format_metrics["factual_misses"] += int(factual_miss)
        details.append(
            {
                "id": case["id"],
                "expected_review": expected,
                "predicted_review": predicted,
                "factual_issue": factual_issue,
                "factual_miss": factual_miss,
                "reason": reason,
            }
        )
    return {
        "threshold": threshold,
        "cases": len(cases),
        "false_passes": false_passes,
        "false_reviews": false_reviews,
        "factual_review_cases": factual_review_cases,
        "factual_misses": factual_misses,
        "review_rate": round(review_count / len(cases), 4) if cases else 0,
        "weighted_error": false_passes * 5 + false_reviews,
        "by_ad_type": dict(sorted(by_format.items())),
        "details": details,
    }


def main() -> None:
    cases = json.loads((ROOT / "cases.json").read_text(encoding="utf-8"))
    sweep = [score_threshold(cases, value) for value in range(70, 96)]
    selected = min(sweep, key=lambda item: (item["weighted_error"], item["false_reviews"], -item["threshold"]))
    baseline = score_threshold(cases, 84)
    output = {
        "dataset": "synthetic hand-labeled fixtures; no live model output",
        "cases": len(cases),
        "formats": sorted({case["ad_type"] for case in cases}),
        "severity_bands": sorted({case["expected_severity"] for case in cases}),
        "false_pass_cost_weight": 5,
        "current_default_threshold": 84,
        "current_default_metrics": {
            key: baseline[key]
            for key in ("cases", "false_passes", "false_reviews", "factual_review_cases", "factual_misses", "review_rate", "by_ad_type")
        },
        "selected_fixture_threshold": selected["threshold"],
        "selected_fixture_metrics": {
            key: selected[key]
            for key in ("cases", "false_passes", "false_reviews", "factual_review_cases", "factual_misses", "review_rate", "by_ad_type")
        },
        "threshold_sweep": [
            {key: row[key] for key in ("threshold", "false_passes", "false_reviews", "factual_misses", "review_rate", "weighted_error")}
            for row in sweep
        ],
        "interpretation": "The threshold only calibrates this deterministic gate against synthetic expected cases. It does not measure Decisions or vision-model accuracy, nor represent production prevalence. Collect blinded human labels and live model outputs before treating it as a production threshold.",
    }
    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
