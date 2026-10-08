import base64
import json
import mimetypes
import os
import re
import tempfile
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from urllib.parse import urlsplit
from uuid import uuid4

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
from pydantic import BaseModel, Field

from app.contracts import (
    AssetRecord,
    NodeProgress,
    NodeStatus,
    QuestionnaireItem,
    RunStatus,
    RunView,
    WorkflowThresholds,
)
from app import openrouter
from app.defaults import DEFAULT_QUESTIONNAIRE, DEFAULT_SKILL
from app.state import RunState, emit
from app.workflow import WorkflowError, apply_review_decision, generate_image_drafts, run_workflow


MAX_FILE_BYTES = 20 * 1024 * 1024
MAX_SESSION_IMAGE_BYTES = 12 * 1024 * 1024
MAX_FILES_PER_RUN = 10
MAX_QUESTIONNAIRE_ITEMS = 26
DEFAULT_RUN_BUDGET_USD = 12.0

app = FastAPI(title="Adverifact API", version="0.3.0")
allowed_origins = [
    origin.strip()
    for origin in os.environ.get(
        "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
    ).split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class SessionRequest(BaseModel):
    view: RunView


class ReviewSessionRequest(SessionRequest):
    decision: str = Field(pattern="^(approve|reject)$")
    notes: str = Field(default="", max_length=2000)


def _default_thresholds() -> WorkflowThresholds:
    return WorkflowThresholds(
        minimum_quality_score=int(os.environ.get("MIN_QUALITY_SCORE", "84")),
    )


def _workflow_nodes() -> list[NodeProgress]:
    return [
        NodeProgress(
            id="input",
            label="Creative input",
            status=NodeStatus.COMPLETE,
            detail="Files and brief received",
        ),
        NodeProgress(id="preflight", label="Preflight and normalize"),
        NodeProgress(id="factual_qa", label="Product and offer QA"),
        NodeProgress(id="quality", label="Creative quality"),
        NodeProgress(id="findings", label="Findings and annotations"),
        NodeProgress(id="gate", label="Quality gate"),
        NodeProgress(id="review", label="Human review"),
        NodeProgress(id="improve", label="Image improvements"),
        NodeProgress(id="complete", label="Complete"),
    ]


def _sniff_media_type(content: bytes) -> str | None:
    if content.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if len(content) >= 12 and content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        return "image/webp"
    if content.startswith(b"%PDF-"):
        return "application/pdf"
    return None


def _decode_image_data_url(value: str, label: str) -> bytes:
    match = re.fullmatch(r"data:(image/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)", value)
    if not match:
        raise HTTPException(
            status_code=422,
            detail=f"{label} is missing from the browser session. Start the workflow again from preflight.",
        )
    try:
        content = base64.b64decode(match.group(2), validate=True)
    except (ValueError, base64.binascii.Error) as error:
        raise HTTPException(status_code=422, detail=f"{label} is not valid image data.") from error
    if len(content) > MAX_SESSION_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail=f"{label} exceeds the session image limit.")
    return content


def _data_url(path: Path) -> str:
    media_type = mimetypes.guess_type(path.name)[0] or "image/jpeg"
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{media_type};base64,{encoded}"


def _session_state(view: RunView, run_dir: Path) -> RunState:
    asset_paths: dict[str, Path] = {}
    analysis_page_paths: dict[int, Path] = {}
    for page in view.pages:
        image = _decode_image_data_url(page.image_url, f"Creative page {page.index + 1}")
        name = f"normalized-{page.index:02d}.jpg"
        path = run_dir / name
        path.write_bytes(image)
        asset_paths[name] = path
        analysis_page_paths[page.index] = path
        for category, url in (
            ("factual", page.factual_annotation_url),
            ("quality", page.quality_annotation_url),
        ):
            if url.startswith("data:"):
                content = _decode_image_data_url(url, f"{category.title()} annotation {page.index + 1}")
                annotated_path = run_dir / f"{category}-annotated-{page.index:02d}.jpg"
                annotated_path.write_bytes(content)
                asset_paths[annotated_path.name] = annotated_path
    for index, draft in enumerate(view.image_drafts):
        if draft.image_url.startswith("data:"):
            content = _decode_image_data_url(draft.image_url, f"Image draft {index + 1}")
            suffix = Path(urlsplit(draft.image_url).path).suffix.lower()
            if suffix not in {".jpg", ".jpeg", ".png", ".webp"}:
                suffix = ".png"
            path = run_dir / f"draft-{index + 1:02d}{suffix}"
            path.write_bytes(content)
            asset_paths[path.name] = path
    return RunState(
        view=view,
        run_dir=run_dir,
        asset_paths=asset_paths,
        analysis_page_paths=analysis_page_paths,
    )


def _public_asset_url(url: str, state: RunState) -> str:
    if url.startswith("data:"):
        return url
    name = Path(urlsplit(url).path).name
    path = state.asset_paths.get(name)
    if path is None or not path.is_file():
        raise WorkflowError("A workflow result image is missing from this browser session.")
    return _data_url(path)


def _response(state: RunState) -> dict[str, object]:
    view = state.view.model_copy(deep=True)
    for page in view.pages:
        page.image_url = _public_asset_url(page.image_url, state)
        if page.factual_annotation_url:
            page.factual_annotation_url = _public_asset_url(page.factual_annotation_url, state)
        if page.quality_annotation_url:
            page.quality_annotation_url = _public_asset_url(page.quality_annotation_url, state)
    for draft in view.image_drafts:
        draft.image_url = _public_asset_url(draft.image_url, state)
    return {
        "view": view.model_dump(mode="json"),
        "events": state.event_history,
    }


def _parse_questionnaire(raw: str) -> list[QuestionnaireItem]:
    try:
        value = json.loads(raw)
        if not isinstance(value, list) or len(value) > MAX_QUESTIONNAIRE_ITEMS:
            raise ValueError
        if any(not isinstance(item, dict) for item in value):
            raise ValueError
        return [
            QuestionnaireItem.model_validate(item)
            for item in value
            if item.get("enabled", True)
        ]
    except (json.JSONDecodeError, TypeError, ValueError) as error:
        raise HTTPException(
            status_code=422,
            detail="Questionnaire must be a JSON array of valid questions (26 maximum).",
        ) from error


def _parse_thresholds(raw: str) -> WorkflowThresholds:
    try:
        values = json.loads(raw)
        if not isinstance(values, dict):
            raise ValueError
        merged = _default_thresholds().model_dump(mode="json")
        merged.update(values)
        return WorkflowThresholds.model_validate(merged)
    except (json.JSONDecodeError, TypeError, ValueError) as error:
        raise HTTPException(
            status_code=422,
            detail="Workflow thresholds must contain valid bounded values.",
        ) from error


@app.get("/api/health")
async def health() -> dict[str, object]:
    return {
        "status": "ok",
        "service": "adverifact-api",
        "ai_provider": "openrouter",
        "ai_configured": openrouter.configured(),
    }


@app.get("/api/config/defaults")
async def defaults() -> dict[str, object]:
    return {
        "questionnaire": [item.model_dump(mode="json") for item in DEFAULT_QUESTIONNAIRE],
        "skill_text": DEFAULT_SKILL,
        "limits": {
            "max_files": MAX_FILES_PER_RUN,
            "max_file_bytes": MAX_FILE_BYTES,
            "max_questionnaire_items": MAX_QUESTIONNAIRE_ITEMS,
            "default_run_budget_usd": DEFAULT_RUN_BUDGET_USD,
            "thresholds": _default_thresholds().model_dump(mode="json"),
        },
    }


@app.post("/api/workflow/preflight")
async def preflight(
    brief: str = Form(default="", max_length=12000),
    platform: str = Form(default="other", max_length=100),
    ad_type: str = Form(default="product_static", max_length=100),
    objective: str = Form(default="sales", max_length=100),
    improve_images: bool = Form(default=False),
    questionnaire_json: str = Form(default="[]", max_length=50000),
    skill_text: str = Form(default="", max_length=24000),
    thresholds_json: str = Form(default="{}", max_length=2000),
    budget_limit_usd: float = Form(default=DEFAULT_RUN_BUDGET_USD, ge=0.5, le=50.0),
    files: list[UploadFile] = File(default=[]),
) -> dict[str, object]:
    if len(files) > MAX_FILES_PER_RUN:
        raise HTTPException(status_code=413, detail="A run can include at most 10 files.")
    if not files:
        raise HTTPException(status_code=422, detail="Upload at least one creative file.")

    questionnaire = _parse_questionnaire(questionnaire_json)
    thresholds = _parse_thresholds(thresholds_json)
    with tempfile.TemporaryDirectory(prefix="ads-right-session-") as temporary:
        run_dir = Path(temporary)
        assets: list[AssetRecord] = []
        asset_paths: dict[str, Path] = {}
        for upload in files:
            filename = Path(upload.filename or "upload").name
            content = await upload.read(MAX_FILE_BYTES + 1)
            await upload.close()
            if len(content) > MAX_FILE_BYTES:
                raise HTTPException(status_code=413, detail=filename + " exceeds the 20 MB per-file limit.")
            media_type = _sniff_media_type(content)
            if media_type not in {"image/jpeg", "image/png", "image/webp", "application/pdf"}:
                raise HTTPException(
                    status_code=415,
                    detail=filename + " must contain a JPEG, PNG, WebP, or PDF file.",
                )

            width = None
            height = None
            if media_type.startswith("image/"):
                try:
                    image = Image.open(BytesIO(content))
                    try:
                        image.verify()
                    finally:
                        image.close()
                    image = Image.open(BytesIO(content))
                    try:
                        width, height = image.size
                    finally:
                        image.close()
                except Exception as error:
                    raise HTTPException(
                        status_code=422,
                        detail=filename + " could not be decoded as an image.",
                    ) from error

            asset_id = uuid4().hex + Path(filename).suffix.lower()
            destination = run_dir / asset_id
            destination.write_bytes(content)
            assets.append(
                AssetRecord(
                    id=asset_id,
                    filename=filename,
                    media_type=media_type,
                    size_bytes=len(content),
                    width=width,
                    height=height,
                )
            )
            asset_paths[asset_id] = destination


        view = RunView(
            id=str(uuid4()),
            status=RunStatus.QUEUED,
            created_at=datetime.now(timezone.utc).isoformat(),
            brief=brief,
            platform=platform,
            ad_type=ad_type,
            objective=objective,
            improve_images=improve_images,
            thresholds=thresholds,
            budget_limit_usd=budget_limit_usd,
            questionnaire=questionnaire,
            skill_text=skill_text or DEFAULT_SKILL,
            assets=assets,
            nodes=_workflow_nodes(),
            message="Creative received. Preparing browser-session image pages.",
        )
        state = RunState(view=view, run_dir=run_dir, asset_paths=asset_paths)
        emit(state, "run.created", status=RunStatus.QUEUED.value, assets=len(assets))
        await run_workflow(state, "preflight")
        return _response(state)


async def _run_session_stage(view: RunView, stage: str) -> dict[str, object]:
    with tempfile.TemporaryDirectory(prefix="ads-right-session-") as temporary:
        state = _session_state(view, Path(temporary))
        await run_workflow(state, stage)
        return _response(state)


@app.post("/api/workflow/factual-qa")
async def factual_qa(request: SessionRequest) -> dict[str, object]:
    return await _run_session_stage(request.view, "factual_qa")


@app.post("/api/workflow/quality")
async def quality(request: SessionRequest) -> dict[str, object]:
    return await _run_session_stage(request.view, "quality")


@app.post("/api/workflow/reports")
async def reports(request: SessionRequest) -> dict[str, object]:
    return await _run_session_stage(request.view, "reports")


@app.post("/api/workflow/gate")
async def quality_gate(request: SessionRequest) -> dict[str, object]:
    return await _run_session_stage(request.view, "gate")


@app.post("/api/workflow/review")
async def review(request: ReviewSessionRequest) -> dict[str, object]:
    with tempfile.TemporaryDirectory(prefix="ads-right-session-") as temporary:
        state = _session_state(request.view, Path(temporary))
        try:
            await apply_review_decision(state, request.decision, request.notes)
        except WorkflowError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error
        return _response(state)


@app.post("/api/workflow/image-edits")
async def image_edits(request: SessionRequest) -> dict[str, object]:
    if request.view.review.decision != "approve" or not request.view.improve_images:
        raise HTTPException(
            status_code=409,
            detail="Image edits require an approved review and enabled image improvements.",
        )
    with tempfile.TemporaryDirectory(prefix="ads-right-session-") as temporary:
        state = _session_state(request.view, Path(temporary))
        await generate_image_drafts(state)
        return _response(state)
