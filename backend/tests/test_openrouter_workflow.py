import base64
import json
import os
import unittest
from io import BytesIO
from unittest.mock import patch

from fastapi.testclient import TestClient
from PIL import Image
import pypdfium2 as pdfium

from app.main import app
from app.openrouter import decision_request, normalize_decision_response


class FakeResponse:
    status_code = 200
    is_success = True

    def __init__(self, value):
        self.value = value

    def json(self):
        return self.value


class FakeOpenRouterClient:
    requests = []
    requires_review = False

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def post(self, url, *, headers=None, json=None, **kwargs):
        self.requests.append({"url": url, "headers": headers or {}, "json": json})
        if url.endswith("/api/alpha/decisions"):
            return FakeResponse(self._decisions(json))
        if url.endswith("/api/v1/responses"):
            return FakeResponse(self._report(json))
        if url.endswith("/api/v1/images"):
            return FakeResponse(self._image(json))
        raise AssertionError("Unexpected outbound request: " + url)

    @staticmethod
    def _decisions(body):
        answers = {}
        for name, question in body["questions"].items():
            kind = question["type"]
            if kind == "noul":
                answers[name] = {"type": "noul", "noul": 0.1}
            elif kind == "choice":
                options = list(question["criteria"])
                choice = "cannot_assess" if FakeOpenRouterClient.requires_review and name == "product_variant" else options[0]
                answers[name] = {
                    "type": "choice",
                    "choice": choice,
                    "probabilities": {option: 1.0 if option == choice else 0.0 for option in options},
                    "confidence": 0.99,
                }
            elif kind == "score":
                levels = question["criteria"]
                answers[name] = {
                    "type": "score",
                    "score": float(len(levels) - 1),
                    "legend": {str(index): label for index, label in enumerate(levels)},
                    "probabilities": {
                        str(index): 1.0 if index == len(levels) - 1 else 0.0
                        for index in range(len(levels))
                    },
                    "confidence": 0.99,
                }
            else:
                raise AssertionError("Unexpected question type: " + kind)
        return {
            "model": body["model"],
            "answers": answers,
            "usage": {"input_tokens": 100, "output_tokens": 0, "cost": 0.00001},
        }

    @staticmethod
    def _report(body):
        schema = body["text"]["format"]["schema"]
        suggestion_count = schema["properties"]["suggestions"]["maxItems"]
        suggestions = [
            {
                "id": "edit-%d" % index,
                "title": "Edit direction %d" % index,
                "rationale": "Improve hierarchy while preserving approved details.",
                "edit_prompt": "Clarify the product and offer hierarchy.",
            }
            for index in range(1, suggestion_count + 1)
        ]
        report = {
            "overall_score": 94,
            "summary": "The creative is clear, with one item for review.",
            "findings": [],
            "suggestions": suggestions,
        }
        if "product_regions" in schema["properties"]:
            report.update(
                product_visible=True,
                product_detection_confidence=0.99,
                product_regions=[
                    {"x": 200, "y": 200, "width": 600, "height": 600, "confidence": 0.99}
                ],
            )
        return {
            "model": body["model"],
            "output_text": json.dumps(report),
            "usage": {"input_tokens": 120, "output_tokens": 80, "cost": 0.0001},
        }

    @staticmethod
    def _image(body):
        image = Image.new("RGB", (64, 64), color=(40, 130, 190))
        buffer = BytesIO()
        image.save(buffer, format="PNG")
        image.close()
        return {
            "data": [{"b64_json": base64.b64encode(buffer.getvalue()).decode("ascii"), "media_type": "image/png"}],
            "usage": {"cost": 0.01},
        }


class OpenRouterWorkflowTests(unittest.TestCase):
    def setUp(self):
        FakeOpenRouterClient.requests = []
        FakeOpenRouterClient.requires_review = False

    def test_decision_adapter_builds_multimodal_request_and_maps_probabilities(self):
        questions = [
            {"name": "has_copy_issue", "type": "predicate", "instructions": "Does the copy have an issue?"},
            {
                "name": "product_match",
                "type": "choice",
                "instructions": "Does the product match?",
                "choices": [
                    {"value": "match", "description": "Matches"},
                    {"value": "mismatch", "description": "Does not match"},
                ],
            },
            {
                "name": "quality",
                "type": "score",
                "instructions": "How strong is the layout?",
                "levels": [
                    {"label": "1 - Weak", "description": "Needs work"},
                    {"label": "2 - Strong", "description": "Works well"},
                ],
            },
        ]
        request = decision_request(
            "Review the creative.",
            [{"type": "input_image", "image_url": "data:image/jpeg;base64,YWJj"}],
            questions,
        )
        self.assertEqual(request["model"], "openai/gpt-6-luna-decisions")
        self.assertEqual(request["state"][0], {"type": "text", "text": "Review the creative."})
        self.assertEqual(request["state"][1]["image_url"]["url"], "data:image/jpeg;base64,YWJj")
        self.assertEqual(request["questions"]["has_copy_issue"]["type"], "noul")
        self.assertEqual(request["questions"]["product_match"]["criteria"]["mismatch"], "Does not match")
        self.assertEqual(request["questions"]["quality"]["criteria"], ["1 - Weak: Needs work", "2 - Strong: Works well"])

        normalized = normalize_decision_response(
            {
                "model": "openai/gpt-6-luna-decisions-20261006",
                "answers": {
                    "has_copy_issue": {"type": "noul", "noul": 0.7},
                    "product_match": {
                        "type": "choice",
                        "choice": "match",
                        "probabilities": {"match": 0.9, "mismatch": 0.1},
                    },
                    "quality": {
                        "type": "score",
                        "score": 0.9,
                        "legend": {"0": "1 - Weak", "1": "2 - Strong"},
                        "probabilities": {"0": 0.1, "1": 0.9},
                    },
                },
                "usage": {"input_tokens": 10, "cost": 0.00001},
            },
            questions,
        )
        self.assertEqual(normalized["answers"][0]["type"], "predicate")
        self.assertEqual(normalized["answers"][0]["probability"], 0.7)
        self.assertEqual(normalized["answers"][1]["probabilities"][0]["label"], "match")
        self.assertEqual(normalized["answers"][2]["probabilities"][1]["label"], "2 - Strong")
        with self.assertRaisesRegex(ValueError, "unknown choice"):
            normalize_decision_response(
                {"answers": {"product_match": {"type": "choice", "choice": "other"}}},
                [questions[1]],
            )

    def test_browser_session_workflow_runs_through_human_review_and_four_image_edits(self):
        FakeOpenRouterClient.requires_review = True
        png = BytesIO()
        Image.new("RGB", (240, 160), color=(245, 190, 80)).save(png, format="PNG")
        with patch.dict(os.environ, {"OPENROUTER_API_KEY": "test-key"}), patch(
            "app.workflow.httpx.AsyncClient", FakeOpenRouterClient
        ), TestClient(app) as client:
            preflight_response = client.post(
                "/api/workflow/preflight",
                data={
                    "brief": "A sample product ad for launch review.",
                    "platform": "instagram",
                    "ad_type": "product or catalog",
                    "objective": "sales",
                    "improve_images": "true",
                    "questionnaire_json": "[]",
                    "budget_limit_usd": "12",
                },
                files={"files": ("creative.png", png.getvalue(), "image/png")},
            )
            self.assertEqual(preflight_response.status_code, 200, preflight_response.text)
            view = preflight_response.json()["view"]
            self.assertEqual(view["status"], "running")
            self.assertEqual(len(view["pages"]), 1)

            for path in (
                "/api/workflow/factual-qa",
                "/api/workflow/quality",
                "/api/workflow/reports",
                "/api/workflow/gate",
            ):
                stage_response = client.post(path, json={"view": view})
                self.assertEqual(stage_response.status_code, 200, stage_response.text)
                view = stage_response.json()["view"]
                self.assertFalse(view["error"])
                if path.endswith("factual-qa"):
                    factual_events = stage_response.json()["events"]

            self.assertEqual(view["status"], "waiting_for_review")
            self.assertTrue(view["needs_human_review"])
            self.assertEqual(len(view["quality_report"]["suggestions"]), 4)
            self.assertIn("question.updated", [event["type"] for event in factual_events])

            review_response = client.post(
                "/api/workflow/review",
                json={"view": view, "decision": "approve", "notes": "Proceed with edit concepts."},
            )
            self.assertEqual(review_response.status_code, 200, review_response.text)
            view = review_response.json()["view"]
            edits_response = client.post("/api/workflow/image-edits", json={"view": view})
            self.assertEqual(edits_response.status_code, 200, edits_response.text)
            completed = edits_response.json()["view"]

        self.assertEqual(completed["status"], "completed", completed.get("error") or completed.get("message"))
        self.assertEqual(len(completed["image_drafts"]), 4)
        self.assertTrue(all(draft["image_url"].startswith("data:image/png;base64,") for draft in completed["image_drafts"]))
        draft_image = Image.open(BytesIO(base64.b64decode(completed["image_drafts"][0]["image_url"].split(",", 1)[1])))
        source_image = Image.open(BytesIO(base64.b64decode(completed["pages"][0]["image_url"].split(",", 1)[1])))
        try:
            self.assertEqual(draft_image.size, source_image.size)
            self.assertEqual(draft_image.getpixel((120, 80)), source_image.getpixel((120, 80)))
            self.assertEqual(draft_image.getpixel((4, 4)), (40, 130, 190))
        finally:
            draft_image.close()
            source_image.close()
        calls = FakeOpenRouterClient.requests
        self.assertEqual(sum(call["url"].endswith("/api/alpha/decisions") for call in calls), 2)
        self.assertEqual(sum(call["url"].endswith("/api/v1/responses") for call in calls), 2)
        image_calls = [call for call in calls if call["url"].endswith("/api/v1/images")]
        self.assertEqual(len(image_calls), 4)
        self.assertIn("input_references", image_calls[0]["json"])
        self.assertTrue(all(call["headers"]["Authorization"] == "Bearer test-key" for call in calls))

    def test_automatic_pass_skips_human_review_and_image_generation(self):
        png = BytesIO()
        Image.new("RGB", (240, 160), color=(80, 180, 120)).save(png, format="PNG")
        with patch.dict(os.environ, {"OPENROUTER_API_KEY": "test-key"}), patch(
            "app.workflow.httpx.AsyncClient", FakeOpenRouterClient
        ), TestClient(app) as client:
            response = client.post(
                "/api/workflow/preflight",
                data={"improve_images": "true", "questionnaire_json": "[]"},
                files={"files": ("clean-ad.png", png.getvalue(), "image/png")},
            )
            self.assertEqual(response.status_code, 200, response.text)
            view = response.json()["view"]
            for path in (
                "/api/workflow/factual-qa",
                "/api/workflow/quality",
                "/api/workflow/reports",
                "/api/workflow/gate",
            ):
                response = client.post(path, json={"view": view})
                self.assertEqual(response.status_code, 200, response.text)
                view = response.json()["view"]

        self.assertEqual(view["status"], "completed")
        self.assertFalse(view["needs_human_review"])
        self.assertEqual(view["review"]["decision"], None)
        self.assertEqual(view["nodes"][-3]["status"], "skipped")
        self.assertEqual(view["image_drafts"], [])
        self.assertFalse(any(call["url"].endswith("/api/v1/images") for call in FakeOpenRouterClient.requests))

    def test_pdf_preflight_renders_a_page_with_pillow_rs(self):
        document = pdfium.PdfDocument.new()
        page = document.new_page(320, 480)
        page.gen_content()
        pdf = BytesIO()
        document.save(pdf)
        page.close()
        document.close()

        with TestClient(app) as client:
            response = client.post(
                "/api/workflow/preflight",
                data={"questionnaire_json": "[]"},
                files={"files": ("creative.pdf", pdf.getvalue(), "application/pdf")},
            )
        self.assertEqual(response.status_code, 200, response.text)
        view = response.json()["view"]
        self.assertEqual(view["assets"][0]["media_type"], "application/pdf")
        self.assertEqual(view["assets"][0]["page_count"], 1)
        self.assertEqual(len(view["pages"]), 1)
        self.assertGreater(view["pages"][0]["width"], 0)
        self.assertGreater(view["pages"][0]["height"], 0)


if __name__ == "__main__":
    unittest.main()
