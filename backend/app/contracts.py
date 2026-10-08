from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field


class RunStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    PAUSED = "paused"
    WAITING_FOR_REVIEW = "waiting_for_review"
    COMPLETED = "completed"
    FAILED = "failed"


class NodeStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETE = "complete"
    FAILED = "failed"
    NEEDS_REVIEW = "needs_review"
    SKIPPED = "skipped"


class QuestionnaireItem(BaseModel):
    id: str
    prompt: str = Field(min_length=1, max_length=500)
    answer: str = Field(default="", max_length=4000)
    kind: Literal["source_fact", "analysis"] = "source_fact"
    enabled: bool = True


class AssetRecord(BaseModel):
    id: str
    filename: str
    media_type: str
    size_bytes: int
    width: int | None = None
    height: int | None = None
    page_count: int | None = None


class NodeProgress(BaseModel):
    id: str
    label: str
    status: NodeStatus = NodeStatus.PENDING
    detail: str = ""


class QuestionAnswer(BaseModel):
    id: str
    question: str
    answer: Any = None
    answer_type: str = ""
    confidence: float | None = None
    probabilities: list[dict[str, Any]] = Field(default_factory=list)


class Finding(BaseModel):
    # Finding numbers are assigned by the backend after schema validation.
    number: int = 0
    severity: Literal["critical", "high", "medium", "low"]
    title: str
    explanation: str
    evidence: str
    recommendation: str
    image_index: int = 0
    x: int = -1
    y: int = -1
    width: int = -1
    height: int = -1


class Suggestion(BaseModel):
    id: str
    title: str
    rationale: str
    edit_prompt: str


class ProductRegion(BaseModel):
    x: int = Field(ge=0, le=1000)
    y: int = Field(ge=0, le=1000)
    width: int = Field(gt=0, le=1000)
    height: int = Field(gt=0, le=1000)
    confidence: float = Field(ge=0.0, le=1.0)


class AnalysisReport(BaseModel):
    overall_score: int = Field(ge=0, le=100)
    decision_score: int | None = Field(default=None, ge=0, le=100)
    response_score: int | None = Field(default=None, ge=0, le=100)
    summary: str
    findings: list[Finding] = Field(default_factory=list)
    question_answers: list[QuestionAnswer] = Field(default_factory=list)
    suggestions: list[Suggestion] = Field(default_factory=list)
    product_visible: bool | None = None
    product_detection_confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    product_regions: list[ProductRegion] = Field(default_factory=list)
    model: str = ""
    usage: dict[str, Any] = Field(default_factory=dict)


class ImagePage(BaseModel):
    index: int
    filename: str
    asset_id: str
    page_number: int = 1
    width: int
    height: int
    image_url: str
    extracted_text: str = ""
    factual_annotation_url: str = ""
    quality_annotation_url: str = ""


class ImageDraft(BaseModel):
    id: str
    suggestion_id: str
    title: str
    rationale: str
    image_url: str


class ReviewRecord(BaseModel):
    decision: Literal["approve", "reject"] | None = None
    notes: str = ""
    decided_at: str = ""


class WorkflowThresholds(BaseModel):
    minimum_quality_score: int = Field(default=84, ge=0, le=100)
    syntax_issue_probability: float = Field(default=0.55, ge=0.0, le=1.0)
    sensitive_claim_probability: float = Field(default=0.55, ge=0.0, le=1.0)
    maximum_medium_findings: int = Field(default=2, ge=0, le=8)


class RunView(BaseModel):
    id: str
    status: RunStatus
    created_at: str
    brief: str
    platform: str
    ad_type: str
    objective: str
    improve_images: bool
    thresholds: WorkflowThresholds = Field(default_factory=WorkflowThresholds)
    budget_limit_usd: float = Field(default=12.0, ge=0.5, le=50.0)
    estimated_cost_usd: float = Field(default=0.0, ge=0.0)
    decision_answers_factual: list[QuestionAnswer] = Field(default_factory=list)
    decision_answers_quality: list[QuestionAnswer] = Field(default_factory=list)
    decision_usage_factual: dict[str, Any] = Field(default_factory=dict)
    decision_usage_quality: dict[str, Any] = Field(default_factory=dict)
    questionnaire: list[QuestionnaireItem]
    skill_text: str
    assets: list[AssetRecord]
    pages: list[ImagePage] = Field(default_factory=list)
    nodes: list[NodeProgress]
    factual_report: AnalysisReport | None = None
    quality_report: AnalysisReport | None = None
    image_drafts: list[ImageDraft] = Field(default_factory=list)
    api_usage: list[dict[str, Any]] = Field(default_factory=list)
    needs_human_review: bool | None = None
    review: ReviewRecord = Field(default_factory=ReviewRecord)
    message: str = ""
    error: str = ""


class ReviewDecision(BaseModel):
    decision: Literal["approve", "reject"]
    notes: str = Field(default="", max_length=2000)
