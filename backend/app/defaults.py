from app.contracts import QuestionnaireItem


DEFAULT_QUESTIONNAIRE = [
    QuestionnaireItem(
        id="product_variant",
        prompt="Which exact product, variant, and pack size should this ad show?",
    ),
    QuestionnaireItem(
        id="offer_terms",
        prompt="What price, discount, dates, eligibility, and exclusions are approved?",
    ),
    QuestionnaireItem(
        id="approved_claims",
        prompt="Which performance, health, sustainability, or comparative claims are approved, and what supports them?",
    ),
    QuestionnaireItem(
        id="audience",
        prompt="Who is the intended audience, market, and language?",
    ),
    QuestionnaireItem(
        id="brand_voice",
        prompt="What brand voice and visual identity should this creative follow?",
    ),
    QuestionnaireItem(
        id="cta_destination",
        prompt="What call to action and landing page should the ad use?",
    ),
    QuestionnaireItem(
        id="placement_specs",
        prompt="Which placement, aspect ratio, and platform-specific requirements apply?",
    ),
    QuestionnaireItem(
        id="required_disclosures",
        prompt="Are there required disclosures, warranty terms, sponsorship labels, or legal lines?",
    ),
]


DEFAULT_SKILL = """# Ecommerce ad review skill

Review the supplied creative, campaign brief, source facts, and questionnaire. Keep factual QA separate from creative-quality review. Ground every finding in visible evidence or an explicit source fact; distinguish observed facts, reasonable interpretation, and uncertainty. Never invent product features, prices, offer terms, endorsements, certifications, performance claims, or legal requirements. When the evidence is insufficient, say so and route the item to a human.

## Factual and specification QA
- Compare the depicted product, variant, packaging, price, discount, dates, eligibility, exclusions, CTA, URL, and language with the supplied source facts.
- Flag contradictions, missing required information, illegible material terms, unsupported objective claims, and disclosures that appear absent or too difficult to read. Do not treat missing brief details as proof that the ad is false.
- Identify claims about health, safety, environmental impact, results, price savings, comparisons, testimonials, or guarantees for human substantiation review. This is a triage signal, not a legal opinion or compliance certification.

## Creative-quality rubric (score each dimension 1–5)
1. Message clarity: can the audience understand the offer and value proposition quickly?
2. Product prominence: is the correct product recognizable and visually important?
3. Visual hierarchy: do headline, product, proof, offer, and CTA have a useful order?
4. Mobile legibility: are important words and details readable at likely feed size?
5. Contrast and accessibility: are text/background combinations, type size, and information cues usable?
6. Composition: is the layout balanced, focused, and free of distracting clutter?
7. Brand fit: does the treatment reflect the supplied brand voice and references?
8. Placement fit: does the composition suit the selected platform, aspect ratio, and ad type?
9. Persuasion and CTA: is there a clear, relevant next action without unsupported urgency?

Adapt the review to the ad type. For product/catalog ads prioritize product accuracy, variant clarity, price/offer legibility, and direct product-page CTA. For social feed ads prioritize a fast opening message, thumb-stop focus, native readability, and a clear brand/product cue. For Stories/Reels prioritize a vertical-safe composition, central safe area, concise text, and an unobstructed CTA. For display banners prioritize one message, a clear product/brand, legibility at small sizes, and a strong CTA. For promotions verify the complete offer and material terms. For testimonials check that the endorsement is identifiable, representative, disclosed when required, and supported by the supplied evidence.

## Output rules
- Create separate factual and creative-quality reports, with numbered findings and evidence tied to an image location when possible.
- Prefer the smallest actionable edit that fixes the issue while preserving the brand, exact product, and approved facts.
- If asked for improvement directions, provide exactly four distinct, feasible edit prompts. Preserve approved offer copy and product details; do not silently add claims or change terms.
- Treat platform recommendations as creative guidance that should be checked against current platform policy before launch. This workflow does not certify legal or platform compliance."""
