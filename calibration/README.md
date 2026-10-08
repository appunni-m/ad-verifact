# Labeled creative calibration set

This folder contains 54 fictional ecommerce ad creatives: nine labeled scenarios across six formats (product/catalog, social feed, vertical story, display banner, promotion, and testimonial). Each case includes a synthetic SVG, supplied product and offer facts (or an explicit missing-evidence case), expected review outcome, known issue severity, and a fixture prediction for exercising the deterministic review gate.

Regenerate the assets with:

    uv run --directory backend python ../calibration/build_dataset.py

Measure the review gate and sweep its quality-score threshold with:

    uv run --directory backend python ../calibration/evaluate.py > calibration/results.json

The sweep weights a false pass five times more heavily than a false review. The resulting demo default is 84: it routes the score-83 boundary case to a person while allowing a score-84 creative with two medium findings to pass. The gate also routes unassessable factual checks, high factual findings, offer mismatches, syntax probabilities at or above 0.55, claim probabilities at or above 0.55, and more than two medium creative findings to review.

At threshold 84, the fixture evaluator reports 24 factual-review cases, 0 factual misses, 0 total false passes, 0 false reviews, and a 66.67% review rate. These counts describe only this balanced synthetic set; the per-format counts and threshold sweep are in `results.json`.

These are synthetic, hand-authored fixtures, not output from OpenAI Decisions and not a measurement of vision-model accuracy. The balanced case mix is also not a production estimate of review rate. Use real, blinded human labels and live model output before treating the default as production-calibrated.
