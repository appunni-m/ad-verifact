"""Build a small, fictional, labeled creative set for gate calibration."""

from __future__ import annotations

import html
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent
CREATIVES = ROOT / "creatives"

FORMATS = [
    ("product_catalog", "Product catalog", 640, 640, "Square product card"),
    ("social_feed", "Social feed", 640, 640, "Feed post"),
    ("vertical_story", "Vertical story", 420, 840, "Story placement"),
    ("display_banner", "Display banner", 1200, 628, "Display banner"),
    ("promotion", "Promotion", 640, 640, "Offer creative"),
    ("testimonial", "Testimonial", 640, 640, "Customer quote"),
]

VARIANTS = [
    {
        "key": "clean",
        "label": "Clean reference",
        "severity": "none",
        "expected_needs_review": False,
        "quality_score": 95,
        "quality_findings": [],
        "syntax_probability": 0.02,
        "claim_probability": 0.10,
        "offer_answer": "consistent",
        "issue": "No known issue in the labeled evidence.",
        "headline": "A little better, every day",
        "offer": "20% OFF · SEE DETAILS",
        "background": "#153b32",
        "foreground": "#f5f1e6",
    },
    {
        "key": "minor",
        "label": "One low-severity layout issue",
        "severity": "low",
        "expected_needs_review": False,
        "quality_score": 90,
        "quality_findings": ["low"],
        "syntax_probability": 0.03,
        "claim_probability": 0.10,
        "offer_answer": "consistent",
        "issue": "The CTA sits close to the edge but remains readable.",
        "headline": "Take a calmer commute",
        "offer": "20% OFF · SEE DETAILS",
        "background": "#153b32",
        "foreground": "#f5f1e6",
    },
    {
        "key": "two_medium",
        "label": "Two medium creative issues",
        "severity": "medium",
        "expected_needs_review": False,
        "quality_score": 84,
        "quality_findings": ["medium", "medium"],
        "syntax_probability": 0.04,
        "claim_probability": 0.10,
        "offer_answer": "consistent",
        "issue": "The headline hierarchy and CTA prominence each need refinement.",
        "headline": "Made for the everyday",
        "offer": "20% OFF · SEE DETAILS",
        "background": "#153b32",
        "foreground": "#c5c9c5",
    },
    {
        "key": "many_medium",
        "label": "Three medium creative issues",
        "severity": "medium",
        "expected_needs_review": True,
        "quality_score": 85,
        "quality_findings": ["medium", "medium", "medium"],
        "syntax_probability": 0.03,
        "claim_probability": 0.10,
        "offer_answer": "consistent",
        "issue": "Three separate medium-severity layout, contrast, and CTA findings.",
        "headline": "A better day starts here",
        "offer": "20% OFF · SEE DETAILS",
        "background": "#153b32",
        "foreground": "#c5c9c5",
    },
    {
        "key": "syntax_boundary",
        "label": "Copy syntax probability above boundary",
        "severity": "medium",
        "expected_needs_review": True,
        "quality_score": 91,
        "quality_findings": [],
        "syntax_probability": 0.56,
        "claim_probability": 0.10,
        "offer_answer": "consistent",
        "issue": "The headline contains a visible spelling error.",
        "headline": "Beutiful days, less waste",
        "offer": "20% OFF · SEE DETAILS",
        "background": "#153b32",
        "foreground": "#f5f1e6",
    },
    {
        "key": "claim_review",
        "label": "Unsubstantiated objective claim",
        "severity": "high",
        "expected_needs_review": True,
        "quality_score": 91,
        "quality_findings": [],
        "syntax_probability": 0.02,
        "claim_probability": 0.80,
        "offer_answer": "consistent",
        "issue": "An objective outcome claim has no substantiation in the supplied evidence.",
        "headline": "Cures every ailment",
        "offer": "20% OFF · SEE DETAILS",
        "background": "#153b32",
        "foreground": "#f5f1e6",
    },
    {
        "key": "offer_mismatch",
        "label": "Approved offer mismatch",
        "severity": "high",
        "expected_needs_review": True,
        "quality_score": 93,
        "quality_findings": [],
        "syntax_probability": 0.02,
        "claim_probability": 0.10,
        "offer_answer": "mismatch",
        "issue": "The ad says 70% off while the supplied approved offer is 20% off.",
        "headline": "A little better, every day",
        "offer": "70% OFF · TODAY ONLY",
        "background": "#153b32",
        "foreground": "#f5f1e6",
    },
    {
        "key": "score_boundary",
        "label": "Quality score below pass boundary",
        "severity": "medium",
        "expected_needs_review": True,
        "quality_score": 83,
        "quality_findings": [],
        "syntax_probability": 0.02,
        "claim_probability": 0.10,
        "offer_answer": "consistent",
        "issue": "The composite creative-quality score is below the proposed pass threshold.",
        "headline": "A little better, every day",
        "offer": "20% OFF · SEE DETAILS",
        "background": "#153b32",
        "foreground": "#f5f1e6",
    },
    {
        "key": "insufficient_evidence",
        "label": "Factual check cannot be assessed",
        "severity": "medium",
        "expected_needs_review": True,
        "quality_score": 95,
        "quality_findings": [],
        "syntax_probability": 0.02,
        "claim_probability": 0.10,
        "product_answer": "cannot_assess",
        "offer_answer": "cannot_assess",
        "issue": "The image cannot be checked against an approved product or variant reference.",
        "headline": "A little better, every day",
        "offer": "20% OFF · SEE DETAILS",
        "background": "#153b32",
        "foreground": "#f5f1e6",
    },
]


def finding(severity: str, title: str, evidence: str) -> dict[str, str]:
    return {"severity": severity, "title": title, "evidence": evidence}


def svg_for(width: int, height: int, variant: dict[str, object], ad_type: str, placement: str) -> str:
    scale = min(width, height)
    x = round(width * 0.08)
    product_width = round(width * 0.32)
    product_height = round(height * 0.34)
    product_x = round(width * 0.56)
    product_y = round(height * 0.22)
    headline_size = max(24, round(scale * 0.075))
    support_size = max(15, round(scale * 0.033))
    cta_size = max(14, round(scale * 0.035))
    headline = html.escape(str(variant["headline"]))
    offer = html.escape(str(variant["offer"]))
    bg = str(variant["background"])
    fg = str(variant["foreground"])
    headline_y = round(height * 0.25)
    support_y = round(height * 0.38)
    offer_y = round(height * 0.77)
    if ad_type == "testimonial":
        support = "‘It fits my routine.’ · customer quote"
    elif ad_type == "vertical_story":
        support = "Designed for daily use · Grove Bottle"
    elif ad_type == "display_banner":
        support = "Reusable stainless-steel bottle · Grove Bottle"
    else:
        support = "Reusable stainless-steel bottle · Grove Bottle"
    support = html.escape(support)
    if variant["key"] == "minor":
        cta_x = round(width * 0.76)
    else:
        cta_x = x
    cta_y = round(height * 0.86)
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-label="{html.escape(placement)} sample: {headline}">
<rect width="{width}" height="{height}" fill="{bg}"/>
<circle cx="{round(width*.86)}" cy="{round(height*.12)}" r="{round(scale*.22)}" fill="#d6a76e" opacity=".23"/>
<text x="{x}" y="{round(height*.12)}" fill="#a8cfb5" font-family="Arial,sans-serif" font-size="{support_size}" letter-spacing="2">GROVE GOODS</text>
<text x="{x}" y="{headline_y}" fill="{fg}" font-family="Arial,sans-serif" font-size="{headline_size}" font-weight="700">{headline}</text>
<text x="{x}" y="{support_y}" fill="{fg}" opacity=".82" font-family="Arial,sans-serif" font-size="{support_size}">{support}</text>
<rect x="{product_x}" y="{product_y}" width="{product_width}" height="{product_height}" rx="{round(scale*.07)}" fill="#d6a76e"/>
<rect x="{product_x + round(product_width*.31)}" y="{product_y - round(product_height*.10)}" width="{round(product_width*.38)}" height="{round(product_height*.12)}" rx="{round(scale*.015)}" fill="#f2d5ae"/>
<rect x="{product_x + round(product_width*.12)}" y="{product_y + round(product_height*.37)}" width="{round(product_width*.76)}" height="{round(product_height*.31)}" rx="6" fill="#f5f1e6"/>
<text x="{product_x + round(product_width*.5)}" y="{product_y + round(product_height*.55)}" text-anchor="middle" fill="#153b32" font-family="Arial,sans-serif" font-size="{max(12,round(support_size*.7))}" font-weight="700">GROVE</text>
<text x="{product_x + round(product_width*.5)}" y="{product_y + round(product_height*.64)}" text-anchor="middle" fill="#153b32" font-family="Arial,sans-serif" font-size="{max(9,round(support_size*.45))}">750 ml</text>
<rect x="{x}" y="{round(height*.69)}" width="{round(width*.47)}" height="{round(scale*.13)}" rx="10" fill="#f5f1e6"/>
<text x="{x + round(width*.235)}" y="{offer_y}" text-anchor="middle" fill="#153b32" font-family="Arial,sans-serif" font-size="{support_size}" font-weight="700">{offer}</text>
<text x="{cta_x}" y="{cta_y}" fill="#a8cfb5" font-family="Arial,sans-serif" font-size="{cta_size}" font-weight="700">SHOP NOW →</text>
<text x="{x}" y="{round(height*.94)}" fill="#a8cfb5" font-family="Arial,sans-serif" font-size="{max(10,round(support_size*.58))}">Terms apply · grove.example</text>
</svg>'''


def build() -> list[dict[str, object]]:
    CREATIVES.mkdir(parents=True, exist_ok=True)
    cases: list[dict[str, object]] = []
    for format_key, format_name, width, height, placement in FORMATS:
        for variant in VARIANTS:
            case_id = f"{format_key}-{variant['key']}"
            filename = case_id + ".svg"
            (CREATIVES / filename).write_text(svg_for(width, height, variant, format_key, placement), encoding="utf-8")
            facts = [
                {"id": "product_variant", "answer_type": "choice", "answer": variant.get("product_answer", "consistent")},
                {"id": "offer_terms", "answer_type": "choice", "answer": variant["offer_answer"]},
                {"id": "material_copy_legibility", "answer_type": "predicate", "answer": 0.96},
                {"id": "copy_syntax_issue", "answer_type": "predicate", "answer": variant["syntax_probability"]},
                {"id": "potentially_sensitive_claim", "answer_type": "predicate", "answer": variant["claim_probability"]},
            ]
            factual_findings = []
            if variant["key"] == "offer_mismatch":
                factual_findings.append(finding("high", "Offer does not match the approved reference", str(variant["issue"])))
            if variant["key"] == "claim_review":
                factual_findings.append(finding("high", "Objective claim needs substantiation", str(variant["issue"])))
            quality_findings = [
                finding(severity, f"{severity.title()} creative issue {index + 1}", str(variant["issue"]))
                for index, severity in enumerate(variant["quality_findings"])
            ]
            if variant["key"] == "syntax_boundary":
                factual_findings.append(finding("medium", "Spelling issue in visible copy", str(variant["issue"])))
            cases.append(
                {
                    "id": case_id,
                    "creative": "creatives/" + filename,
                    "ad_type": format_key,
                    "placement": placement,
                    "format_label": format_name,
                    "brief": "No product or variant reference was supplied." if variant["key"] == "insufficient_evidence" else "Grove Bottle, 750 ml. Approved offer: 20% off. Use a clear, evidence-based headline and a readable SHOP NOW CTA.",
                    "approved_facts": {} if variant["key"] == "insufficient_evidence" else {"product": "Grove Bottle 750 ml", "offer": "20% off; terms apply", "cta": "SHOP NOW", "url": "grove.example"},
                    "known_issue": variant["issue"],
                    "expected_severity": variant["severity"],
                    "expected_needs_review": variant["expected_needs_review"],
                    "fixture_prediction": {
                        "quality_score": variant["quality_score"],
                        "factual_answers": facts,
                        "factual_findings": factual_findings,
                        "quality_findings": quality_findings,
                    },
                }
            )
    (ROOT / "cases.json").write_text(json.dumps(cases, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return cases


if __name__ == "__main__":
    print(f"Built {len(build())} labeled SVG creatives in {CREATIVES}")
