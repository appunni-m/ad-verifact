import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";

type QuestionnaireItem = {
  id: string;
  prompt: string;
  answer: string;
  kind: "source_fact" | "analysis";
  enabled: boolean;
};

type WorkflowThresholds = {
  minimum_quality_score: number;
  syntax_issue_probability: number;
  sensitive_claim_probability: number;
  maximum_medium_findings: number;
};

type Finding = {
  number: number;
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  explanation: string;
  evidence: string;
  recommendation: string;
  image_index: number;
};

type ProductRegion = { x: number; y: number; width: number; height: number; confidence: number };

type QuestionAnswer = {
  id: string;
  question: string;
  answer: unknown;
  answer_type: string;
  confidence?: number | null;
  probabilities: Array<{ label?: string; value?: string; probability?: number }>;
};

type Report = {
  overall_score: number;
  decision_score?: number | null;
  response_score?: number | null;
  summary: string;
  findings: Finding[];
  question_answers: QuestionAnswer[];
  suggestions: Array<{ id: string; title: string; rationale: string; edit_prompt: string }>;
  product_visible?: boolean | null;
  product_detection_confidence?: number | null;
  product_regions?: ProductRegion[];
  model: string;
};

type ImagePage = {
  index: number;
  filename: string;
  page_number: number;
  image_url: string;
  extracted_text: string;
  factual_annotation_url: string;
  quality_annotation_url: string;
};

type NodeProgress = { id: string; label: string; status: string; detail: string };

type RunView = {
  id: string;
  status: "queued" | "running" | "paused" | "waiting_for_review" | "completed" | "failed";
  created_at: string;
  brief: string;
  platform: string;
  ad_type: string;
  objective: string;
  improve_images: boolean;
  thresholds: WorkflowThresholds;
  budget_limit_usd: number;
  estimated_cost_usd: number;
  questionnaire: QuestionnaireItem[];
  skill_text: string;
  assets: Array<{ id: string; filename: string; media_type: string; size_bytes: number }>;
  pages: ImagePage[];
  nodes: NodeProgress[];
  factual_report?: Report | null;
  quality_report?: Report | null;
  image_drafts: Array<{ id: string; suggestion_id: string; title: string; rationale: string; image_url: string }>;
  api_usage: Array<{ endpoint: string; model?: string }>;
  needs_human_review?: boolean | null;
  review: { decision?: "approve" | "reject" | null; notes: string; decided_at: string };
  message: string;
  error: string;
};

type QuestionEvent = {
  id: string;
  label: string;
  stage: string;
  status: "running" | "complete" | "skipped";
  answer?: unknown;
  confidence?: number;
};

type Defaults = { questionnaire: QuestionnaireItem[]; skill_text: string; limits?: { thresholds?: WorkflowThresholds; default_run_budget_usd?: number } };
type StageResult = { view: RunView; events: Array<{ type: string; data: Record<string, unknown> }> };

type AppModel = {
  files: File[];
  brief: string;
  platform: string;
  adType: string;
  objective: string;
  questionnaire: QuestionnaireItem[];
  skillText: string;
  thresholds: WorkflowThresholds;
  runBudgetUsd: number;
  improveImages: boolean;
  run: RunView | null;
  questions: Record<string, QuestionEvent>;
  activeStage: string | null;
  running: boolean;
  busyReview: boolean;
  busyControl: boolean;
  reviewNotes: string;
  statusMessage: string;
  aiConfigured: boolean | null;
  apiOnline: boolean | null;
  defaultsLoaded: boolean;
  error: string;
};

type NodeActions = {
  model: AppModel;
  setFiles: (files: File[]) => void;
  setBrief: (brief: string) => void;
  setPlatform: (platform: string) => void;
  setAdType: (adType: string) => void;
  setObjective: (objective: string) => void;
  setQuestionnaire: (items: QuestionnaireItem[]) => void;
  setSkillText: (skill: string) => void;
  setThresholds: (thresholds: WorkflowThresholds) => void;
  setRunBudgetUsd: (budget: number) => void;
  setImproveImages: (enabled: boolean) => void;
  setReviewNotes: (notes: string) => void;
  startRun: () => void;
  decideReview: (decision: "approve" | "reject") => void;
  controlRun: (action: "pause" | "resume" | "retry") => void;
};

type FlowNodeData = NodeActions & {
  title: string;
  eyebrow: string;
  subtitle: string;
  stageId?: string;
  status?: string;
  detail?: string;
  focusNode?: (id: string) => void;
};

const initialModel: AppModel = {
  files: [],
  brief: "",
  platform: "instagram",
  adType: "product or catalog",
  objective: "sales",
  questionnaire: [],
  skillText: "",
  thresholds: { minimum_quality_score: 84, syntax_issue_probability: 0.55, sensitive_claim_probability: 0.55, maximum_medium_findings: 2 },
  runBudgetUsd: 12,
  improveImages: false,
  run: null,
  questions: {},
  activeStage: null,
  running: false,
  busyReview: false,
  busyControl: false,
  reviewNotes: "",
  statusMessage: "Configure the nodes, then run the workflow.",
  aiConfigured: null,
  apiOnline: null,
  defaultsLoaded: false,
  error: "",
};

const nodeSizes: Record<string, { width: number; height: number }> = {
  input: { width: 370, height: 700 },
  questionnaire: { width: 370, height: 760 },
  skill: { width: 370, height: 690 },
  preflight: { width: 270, height: 180 },
  factual_qa: { width: 330, height: 470 },
  quality: { width: 330, height: 470 },
  findings: { width: 480, height: 790 },
  gate: { width: 310, height: 445 },
  review: { width: 340, height: 440 },
  improve: { width: 370, height: 670 },
  complete: { width: 260, height: 190 },
};

function focusNodeSize(): { width: number; height: number } {
  return {
    width: Math.max(280, Math.min(900, window.innerWidth - 40)),
    height: Math.max(420, Math.min(610, window.innerHeight - 140)),
  };
}

function statusOf(model: AppModel, id: string): NodeProgress | undefined {
  if (model.running && model.activeStage && activeStageNodes[model.activeStage]?.includes(id)) {
    return { id, label: id, status: "running", detail: model.statusMessage };
  }
  return model.run?.nodes.find((node) => node.id === id);
}

const activeStageNodes: Record<string, string[]> = {
  preflight: ["preflight"],
  "factual-qa": ["factual_qa"],
  quality: ["quality"],
  reports: ["findings"],
  gate: ["gate"],
  "image-edits": ["improve"],
};

function NodeFrame({
  data,
  children,
  className = "",
  handles = true,
}: {
  data: FlowNodeData;
  children: React.ReactNode;
  className?: string;
  handles?: boolean;
}) {
  const status = data.status ?? "pending";
  return (
    <section className={`workflow-node ${className} status-${status}`}>
      {handles && <Handle type="target" position={Position.Left} />}
      <div className="node-heading">
        <div className="node-icon">{nodeIcon(data.stageId)}</div>
        <div className="node-heading-copy">
          <span className="node-eyebrow">{data.eyebrow}</span>
          <h2>{data.title}</h2>
        </div>
        {data.status && <span className={`node-status status-text-${status}`}>{statusLabel(status, data.stageId)}</span>}
        {data.focusNode && <button type="button" className="node-focus-button nodrag" aria-label={`Focus ${data.title}`} title="Focus this step" onClick={(event) => { event.stopPropagation(); data.focusNode?.(data.stageId ?? "input"); }}>⛶</button>}
      </div>
      {data.subtitle && <p className="node-subtitle">{data.subtitle}</p>}
      {data.detail && <div className="node-detail">{data.detail}</div>}
      <div className="node-content nodrag nowheel">{children}</div>
      {(handles || data.stageId === "input") && <Handle type="source" position={Position.Right} />}
    </section>
  );
}

function statusLabel(status: string, stageId?: string): string {
  if (status === "needs_review") return "NEEDS REVIEW";
  if (status === "complete") return "DONE";
  if (status === "running") return "RUNNING";
  if (status === "failed") return "FAILED";
  if (status === "skipped") return "SKIPPED";
  if (status === "pending") return ["input", "questionnaire", "skill"].includes(stageId ?? "") ? "READY" : "WAITING";
  return "WAITING";
}

function nodeIcon(id?: string): string {
  const icons: Record<string, string> = {
    input: "↥",
    questionnaire: "☷",
    skill: "✳",
    preflight: "▧",
    factual_qa: "✓",
    quality: "◈",
    findings: "⌕",
    gate: "◇",
    review: "◎",
    improve: "✦",
    complete: "↗",
  };
  return icons[id ?? ""] ?? "•";
}

function InputNode({ data }: NodeProps<Node<FlowNodeData>>) {
  const { model, setFiles, setBrief, setPlatform, setAdType, setObjective, setRunBudgetUsd } = data;
  const inputRef = useRef<HTMLInputElement>(null);
  const disabled = model.running;
  const addFiles = (incoming: FileList | File[]) => {
    const fresh = Array.from(incoming).filter((file) => !model.files.some((item) => item.name === file.name && item.size === file.size));
    setFiles([...model.files, ...fresh].slice(0, 10));
  };
  return (
    <NodeFrame data={data} className="config-node input-node" handles={false}>
      <div
        className="upload-area nodrag nowheel"
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => { event.preventDefault(); event.currentTarget.classList.add("drag-over"); }}
        onDragLeave={(event) => event.currentTarget.classList.remove("drag-over")}
        onDrop={(event) => { event.preventDefault(); event.currentTarget.classList.remove("drag-over"); addFiles(event.dataTransfer.files); }}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") inputRef.current?.click(); }}
      >
        <span className="upload-icon">↑</span>
        <strong>Drop ad creatives here</strong>
        <span>Images or PDFs · 20 MB each · up to 10 files</span>
        <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf" multiple disabled={disabled} onChange={(event) => { if (event.target.files) addFiles(event.target.files); event.target.value = ""; }} />
      </div>
      {model.files.length > 0 && <div className="file-chip-list">{model.files.map((file, index) => <div className="file-chip" key={`${file.name}-${file.size}`}><span className="file-type">{file.type === "application/pdf" ? "PDF" : "IMG"}</span><span title={file.name}>{file.name}</span><button type="button" aria-label={`Remove ${file.name}`} disabled={disabled} onClick={() => setFiles(model.files.filter((_, fileIndex) => fileIndex !== index))}>×</button></div>)}</div>}
      <label className="node-field"><span>Campaign brief <small>brand, product, offer, audience, guardrails</small></span><textarea className="text-input brief-input nodrag nowheel" value={model.brief} disabled={disabled} onChange={(event) => setBrief(event.target.value)} placeholder="Describe the product, approved offer, target shopper, brand voice, and any must-keep details…" /></label>
      <div className="form-row node-form-row">
        <label><span>Placement</span><select className="nodrag" disabled={disabled} value={model.platform} onChange={(event) => setPlatform(event.target.value)}><option value="instagram">Instagram</option><option value="facebook">Facebook</option><option value="tiktok">TikTok</option><option value="pinterest">Pinterest</option><option value="amazon">Amazon</option><option value="google display">Google Display</option><option value="other">Other</option></select></label>
        <label><span>Ad format</span><select className="nodrag" disabled={disabled} value={model.adType} onChange={(event) => setAdType(event.target.value)}><option>product or catalog</option><option>social feed</option><option>vertical story or reel</option><option>display banner</option><option>promotion</option><option>customer testimonial</option><option>comparison ad</option></select></label>
      </div>
      <label className="node-field"><span>Campaign objective</span><select className="nodrag" disabled={disabled} value={model.objective} onChange={(event) => setObjective(event.target.value)}><option value="sales">Drive sales</option><option value="traffic">Drive traffic</option><option value="awareness">Build awareness</option><option value="lead_generation">Generate leads</option><option value="app_installs">App installs</option></select></label>
      <label className="node-field budget-field"><span>Estimated run spend cap <small>Estimate guard; set the hard limit in OpenRouter</small></span><div className="money-input"><span>$</span><input className="number-input nodrag" type="number" min="0.5" max="50" step="0.5" disabled={disabled} value={model.runBudgetUsd} onChange={(event) => setRunBudgetUsd(Number(event.target.value))} /><span>USD</span></div></label>
      <div className="node-endpoint"><span className="field-number">01</span> Input bundle feeds every downstream check</div>
    </NodeFrame>
  );
}

function QuestionnaireNode({ data }: NodeProps<Node<FlowNodeData>>) {
  const { model, setQuestionnaire } = data;
  const edit = (id: string, patch: Partial<QuestionnaireItem>) => setQuestionnaire(model.questionnaire.map((item) => item.id === id ? { ...item, ...patch } : item));
  const add = () => setQuestionnaire([...model.questionnaire, { id: `custom_${Date.now()}`, prompt: "", answer: "", kind: "source_fact", enabled: true }]);
  const remove = (id: string) => setQuestionnaire(model.questionnaire.filter((item) => item.id !== id));
  const disabled = model.running;
  const answers = Object.values(model.questions).filter((item) => item.stage === "factual_qa");
  return (
    <NodeFrame data={data} className="config-node questionnaire-node">
      <div className="node-section-note">Each row becomes an editable Decision check. Source facts compare the ad against your inputs; assessment questions ask the model to inspect the creative.</div>
      <div className="question-list nodrag nowheel">
        {model.questionnaire.map((item, index) => {
          const result = answers.find((answer) => answer.id === `question_${item.id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48)}`);
          return <article className={`question-item ${!item.enabled ? "question-disabled" : ""}`} key={item.id}>
            <div className="question-topline"><span className="question-index">Q{String(index + 1).padStart(2, "0")}</span><label className="question-enable"><input type="checkbox" checked={item.enabled} disabled={disabled} onChange={(event) => edit(item.id, { enabled: event.target.checked })} /><span>Use</span></label><button type="button" className="remove-question" aria-label="Remove question" disabled={disabled} onClick={() => remove(item.id)}>×</button></div>
            <textarea className="text-input" value={item.prompt} disabled={disabled} onChange={(event) => edit(item.id, { prompt: event.target.value })} placeholder="Write an assessment question…" />
            <select className="question-mode" value={item.kind} disabled={disabled} onChange={(event) => edit(item.id, { kind: event.target.value as QuestionnaireItem["kind"] })}>
              <option value="source_fact">Compare with source fact</option><option value="analysis">Ask about the creative</option>
            </select>
            <textarea className="text-input fact-answer" value={item.answer} disabled={disabled} onChange={(event) => edit(item.id, { answer: event.target.value })} placeholder={item.kind === "source_fact" ? "Approved fact or reference (leave blank if unknown)" : "Optional expected answer or context"} />
            {result && <div className={`question-result event-${result.status}`}><span className="event-state" />{result.status === "running" ? "Checking now…" : result.status === "skipped" ? "Skipped — no reference supplied" : `Answer: ${String(result.answer ?? "answered")}`}</div>}
          </article>;
        })}
      </div>
      <button type="button" className="text-button add-question nodrag" disabled={disabled || model.questionnaire.length >= 26} onClick={add}><span>＋</span> Add a question</button>
      <div className="node-endpoint"><span className="field-number">02</span>{answers.filter((answer) => answer.status === "complete").length} / {answers.length || model.questionnaire.filter((item) => item.enabled).length} checks answered</div>
    </NodeFrame>
  );
}

function SkillNode({ data }: NodeProps<Node<FlowNodeData>>) {
  const { model, setSkillText } = data;
  return (
    <NodeFrame data={data} className="config-node skill-node">
      <div className="node-section-note">Editable ad-review skill. It guides placement-aware quality scoring and evidence-based recommendations.</div>
      <label className="node-field skill-editor-label"><span>Review skill <small>{model.skillText.length.toLocaleString()} characters</small></span><textarea className="text-input skill-input nodrag nowheel" value={model.skillText} disabled={model.running} onChange={(event) => setSkillText(event.target.value)} spellCheck placeholder="Define quality criteria, placement guidance, brand rules, and evidence standards…" /></label>
      <div className="skill-guidance"><strong>Default skill includes</strong><ul><li>Factual claims and offer checks</li><li>9 creative-quality dimensions</li><li>Format-specific guidance for feed, story, banner, promotion, and testimonial ads</li><li>Rules for uncertainty, evidence, and human review</li></ul></div>
      <div className="node-endpoint"><span className="field-number">03</span>Guides the quality scorer and report writer</div>
    </NodeFrame>
  );
}

function StageNode({ data }: NodeProps<Node<FlowNodeData>>) {
  const { model } = data;
  const id = data.stageId ?? "preflight";
  const progress = statusOf(model, id);
  const answers = Object.values(model.questions).filter((item) => item.stage === id);
  const completed = answers.filter((item) => item.status === "complete").length;
  const content = id === "preflight" ? (
    <div className="stage-info-list"><div><span className="mini-step">1</span><span>Validate uploads and file type</span></div><div><span className="mini-step">2</span><span>Render PDF pages and normalize imagery</span></div><div><span className="mini-step">3</span><span>Prepare visual evidence for the models</span></div></div>
  ) : (
    <>
      <div className="answer-progress"><span>{completed} / {answers.length || (id === "quality" ? 9 : 7 + model.questionnaire.filter((item) => item.enabled && (item.kind === "analysis" || item.answer.trim())).length)} questions answered</span><div><i style={{ width: `${answers.length ? Math.round(completed / answers.length * 100) : 0}%` }} /></div></div>
      {answers.length > 0 ? <ol className="answer-list nodrag nowheel">{answers.map((answer) => <li key={answer.id}><span className={`event-state event-${answer.status}`} /><div><strong>{answer.label}</strong><small>{answer.status === "running" ? "Awaiting model answer" : answer.status === "skipped" ? String(answer.answer ?? "Skipped") : `Answer: ${String(answer.answer ?? "—")}${answer.confidence != null ? ` · ${(answer.confidence * 100).toFixed(0)}% confidence` : ""}`}</small></div></li>)}</ol> : <div className="waiting-copy">Answers appear here when the browser receives this stage's result.</div>}
      <div className="api-call-badge">OpenRouter Decisions API <span>•</span> {id === "quality" ? "9 rubric scores" : "facts + questionnaire"}</div>
    </>
  );
  return <NodeFrame data={{ ...data, status: progress?.status ?? "pending", detail: progress?.detail }} className={`execution-node ${id}`}>
    {content}
    <div className="node-endpoint"><span className="field-number">{id === "preflight" ? "04" : id === "factual_qa" ? "05" : "06"}</span>{id === "preflight" ? "Pillow-RS processing + PDF rendering" : id === "factual_qa" ? "Compares visible content with supplied facts" : "Scores the editable skill by ad format"}</div>
  </NodeFrame>;
}

function FindingsNode({ data }: NodeProps<Node<FlowNodeData>>) {
  const { model } = data;
  const run = model.run;
  const factual = run?.factual_report;
  const quality = run?.quality_report;
  const pages = run?.pages ?? [];
  const facts = factual?.findings ?? [];
  const qualityFindings = quality?.findings ?? [];
  return <NodeFrame data={data} className="execution-node findings-node">
    {!run ? <div className="empty-output"><span>⌕</span><strong>Findings will appear here</strong><small>Two independent reports and numbered image annotations are generated after both model checks finish.</small></div> : <>
      <div className="result-score-line"><div><span>Quality</span><strong>{quality?.overall_score ?? "—"}<small>/100</small></strong></div><p>{quality?.summary ?? "Quality review is running…"}</p></div>
      <div className="annotation-strip">
        {pages.slice(0, 3).map((page) => <article key={page.index}><span>Image {page.index + 1} · {page.filename}</span><div className="annotation-images">{page.factual_annotation_url && <img src={page.factual_annotation_url} alt="Factual quality annotations" />} {page.quality_annotation_url && <img src={page.quality_annotation_url} alt="Creative quality annotations" />}{!page.factual_annotation_url && !page.quality_annotation_url && <img src={page.image_url} alt={page.filename} />}</div></article>)}
      </div>
      {run.improve_images && quality?.product_visible && quality.product_regions?.length ? <div className="node-section-note">Blue outline marks the product pixels locked for image edits. The backend restores those source pixels unchanged in each draft.</div> : null}
      <div className="report-columns compact-reports">
        <ReportFindings title="Factual QA" items={facts} summary={factual?.summary} tone="fact" />
        <ReportFindings title="Creative quality" items={qualityFindings} summary={quality?.summary} tone="quality" />
      </div>
      <div className="node-endpoint"><span className="field-number">07</span>Separate factual and creative-quality evidence</div>
    </>}
  </NodeFrame>;
}

function ReportFindings({ title, items, summary, tone }: { title: string; items: Finding[]; summary?: string; tone: "fact" | "quality" }) {
  return <section className={`mini-report ${tone}`}><div className="mini-report-title"><strong>{title}</strong><span>{items.length} findings</span></div>{summary && <p>{summary}</p>}{items.length ? <ol>{items.map((item) => <li key={`${title}-${item.number}`}><span className={`severity severity-${item.severity}`}>{item.number}</span><div><strong>{item.title}</strong><small>{item.explanation}</small><em>{item.recommendation}</em></div></li>)}</ol> : summary ? <div className="no-findings">No actionable issues reported.</div> : <div className="waiting-copy">Report is being prepared.</div>}</section>;
}

function GateNode({ data }: NodeProps<Node<FlowNodeData>>) {
  const { model, setThresholds } = data;
  const run = model.run;
  const needsReview = run?.needs_human_review;
  const reason = run?.nodes.find((item) => item.id === "gate")?.detail;
  const thresholds = model.thresholds;
  const disabled = model.running;
  const edit = (patch: Partial<WorkflowThresholds>) => setThresholds({ ...model.thresholds, ...patch });
  return <NodeFrame data={data} className="execution-node gate-node">
    <div className={`gate-result ${needsReview === false ? "gate-pass" : needsReview === true ? "gate-review" : "gate-wait"}`}><span>{needsReview === false ? "✓" : needsReview === true ? "!" : "◇"}</span><div><strong>{needsReview === false ? "Automatic pass" : needsReview === true ? "Person required" : "Evaluating threshold"}</strong><small>{reason ?? "Score, findings, and factual checks determine the next branch."}</small></div></div>
    <div className="gate-thresholds">
      <label><span>Minimum quality score</span><div className="gate-number"><input className="number-input nodrag" type="number" min="0" max="100" value={thresholds.minimum_quality_score} disabled={disabled} onChange={(event) => edit({ minimum_quality_score: Number(event.target.value) })} /><b>/ 100</b></div></label>
      <label><span>Syntax issue review probability</span><div className="gate-number"><input className="number-input nodrag" type="number" min="0" max="1" step="0.05" value={thresholds.syntax_issue_probability} disabled={disabled} onChange={(event) => edit({ syntax_issue_probability: Number(event.target.value) })} /></div></label>
      <label><span>Claim review probability</span><div className="gate-number"><input className="number-input nodrag" type="number" min="0" max="1" step="0.05" value={thresholds.sensitive_claim_probability} disabled={disabled} onChange={(event) => edit({ sensitive_claim_probability: Number(event.target.value) })} /></div></label>
      <label><span>Maximum medium issues</span><div className="gate-number"><input className="number-input nodrag" type="number" min="0" max="8" value={thresholds.maximum_medium_findings} disabled={disabled} onChange={(event) => edit({ maximum_medium_findings: Number(event.target.value) })} /></div></label>
      <small>Critical or high factual issues and uncertain checks always route to a person.</small>
      {run && <small className="next-run-note">Threshold edits apply to the next workflow run.</small>}
    </div>
    <div className="branch-labels"><span className="branch-auto">PASS → Complete</span><span className="branch-review">REVIEW → Human decision</span></div>
    <div className="node-endpoint"><span className="field-number">08</span>Routes only when the quality bar is missed</div>
  </NodeFrame>;
}

function ReviewNode({ data }: NodeProps<Node<FlowNodeData>>) {
  const { model, decideReview, setReviewNotes } = data;
  const run = model.run;
  const waiting = run?.status === "waiting_for_review";
  const quality = run?.quality_report;
  const productLockUncertain = !quality || quality.product_visible == null || (quality.product_detection_confidence ?? 0) < (quality.product_visible ? 0.9 : 0.95) || (quality.product_visible && (!quality.product_regions?.length || quality.product_regions.some((region) => region.confidence < 0.9)));
  return <NodeFrame data={data} className="execution-node review-node">
    {waiting ? <>
      <div className="review-required"><span>!</span><div><strong>A human decision is needed</strong><small>{run.nodes.find((node) => node.id === "review")?.detail ?? "Review the findings before continuing."}</small></div></div>
      <label className="node-field"><span>Reviewer notes <small>optional</small></span><textarea className="text-input review-notes nodrag nowheel" value={model.reviewNotes} onChange={(event) => setReviewNotes(event.target.value)} placeholder="What should be fixed or preserved?" /></label>
      <div className="review-actions nodrag"><button type="button" className="review-reject" disabled={model.busyReview} onClick={() => decideReview("reject")}>Reject</button><button type="button" className="review-approve" disabled={model.busyReview} onClick={() => decideReview("approve")}>Approve & continue</button></div>
      <small className="review-node-note">{run.improve_images ? productLockUncertain ? "Product boundary is uncertain; approval will record the review but skip image generation." : quality?.product_visible ? "Check that the blue outline encloses the complete product. Its source pixels are restored unchanged in every draft." : "No product is visible in the creative; there are no product pixels to lock." : "Approval records the review. Image generation is disabled for this run."}</small>
    </> : run?.review?.decision ? <div className={`review-decision ${run.review.decision}`}><strong>{run.review.decision === "approve" ? "Approved" : "Rejected"}</strong><small>{run.review.notes || "No reviewer note was added."}</small></div> : <div className="empty-output compact-empty"><span>◎</span><strong>Conditional human review</strong><small>This node activates only if factual checks or the quality threshold need a person.</small></div>}
    <div className="node-endpoint"><span className="field-number">09</span>{run?.review?.decision ? "Decision recorded" : "Human-in-the-loop branch"}</div>
  </NodeFrame>;
}

function ImproveNode({ data }: NodeProps<Node<FlowNodeData>>) {
  const { model, setImproveImages } = data;
  const run = model.run;
  const suggestions = run?.quality_report?.suggestions ?? [];
  const drafts = run?.image_drafts ?? [];
  const progress = statusOf(model, "improve");
  const locked = !!run && (run.status === "running" || run.status === "waiting_for_review");
  return <NodeFrame data={{ ...data, status: progress?.status ?? "pending", detail: progress?.detail }} className="config-node improve-node">
    <label className="improve-toggle nodrag"><input type="checkbox" checked={model.improveImages} disabled={model.running || locked} onChange={(event) => setImproveImages(event.target.checked)} /><span className="switch-track"><i /></span><span><strong>Suggest image improvements</strong><small>Four directions; product pixels stay locked.</small></span></label>
    {!model.improveImages && !run ? <div className="empty-output compact-empty"><span>✦</span><strong>Branch is switched off</strong><small>Enable this node to request four edit directions with the quality report.</small></div> : <>
      {suggestions.length > 0 ? <div className="suggestion-cards">{suggestions.map((suggestion, index) => <article key={suggestion.id}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{suggestion.title}</strong><small>{suggestion.rationale}</small><details><summary>View image edit prompt</summary><p>{suggestion.edit_prompt}</p></details></div></article>)}</div> : <div className="waiting-copy">Four targeted suggestions appear after analysis. Image drafts are generated only after a human approves the review branch.</div>}
      {drafts.length > 0 && <div className="draft-grid">{drafts.map((draft) => <article className="draft-card" key={draft.id}><img src={draft.image_url} alt={draft.title} /><div><strong>{draft.title}</strong><p>{draft.rationale}</p></div></article>)}</div>}
    </>}
    <div className="node-endpoint"><span className="field-number">10</span>{drafts.length ? `${drafts.length} review draft${drafts.length === 1 ? "" : "s"} generated` : model.improveImages ? "Suggestions first · image drafts after approval" : "Optional improvement branch"}</div>
  </NodeFrame>;
}

function CompleteNode({ data }: NodeProps<Node<FlowNodeData>>) {
  const { model, controlRun } = data;
  const run = model.run;
  const progress = statusOf(model, "complete");
  return <NodeFrame data={{ ...data, status: progress?.status ?? "pending", detail: progress?.detail }} className="execution-node complete-node">
    <div className="complete-summary"><div className="complete-check">✓</div><div><strong>{run?.status === "completed" ? "Workflow complete" : run?.status === "failed" ? "Run stopped" : "Ready to review"}</strong><small>{run?.message ?? "The output is collected here when every active branch is done."}</small></div></div>
    {run && <div className="complete-meta"><span>Run <b>{run.id.slice(0, 8)}</b></span><span>{run.assets.length} input file{run.assets.length === 1 ? "" : "s"}</span><span>{run.api_usage?.length ?? "—"} model calls</span><span>Estimated spend <b>${run.estimated_cost_usd?.toFixed(4) ?? "0.0000"}</b></span></div>}
    {run?.status === "running" && <button type="button" className="run-control-button" disabled={model.busyControl} onClick={() => controlRun("pause")}>{model.busyControl ? "Updating…" : "Ⅱ Pause workflow"}</button>}
    {run?.status === "paused" && <button type="button" className="run-control-button resume-control" disabled={model.busyControl} onClick={() => controlRun("resume")}>{model.busyControl ? "Updating…" : "▶ Resume workflow"}</button>}
    {run?.status === "failed" && <button type="button" className="run-control-button retry-control" disabled={model.busyControl} onClick={() => controlRun("retry")}>{model.busyControl ? "Updating…" : "↻ Retry failed run"}</button>}
    <div className="node-endpoint"><span className="field-number">11</span>Results ready to hand back</div>
  </NodeFrame>;
}

const nodeTypes = {
  creativeInput: InputNode,
  questionnaire: QuestionnaireNode,
  skill: SkillNode,
  stage: StageNode,
  findings: FindingsNode,
  gate: GateNode,
  review: ReviewNode,
  improve: ImproveNode,
  complete: CompleteNode,
};

const baseNodes: Array<Omit<Node<FlowNodeData>, "data"> & { stageId: string; title: string; eyebrow: string; subtitle: string }> = [
  { id: "input", type: "creativeInput", position: { x: 0, y: 280 }, stageId: "input", title: "Ad creative + brief", eyebrow: "01 · START", subtitle: "Upload the ad and tell the workflow what it needs to know." },
  { id: "questionnaire", type: "questionnaire", position: { x: 480, y: 30 }, stageId: "questionnaire", title: "Questionnaire", eyebrow: "02 · EDITABLE CHECKS", subtitle: "Add reference facts and questions the workflow should answer." },
  { id: "skill", type: "skill", position: { x: 480, y: 850 }, stageId: "skill", title: "Ad review skill", eyebrow: "03 · EDITABLE GUIDANCE", subtitle: "Set the standards that guide ad-quality review." },
  { id: "preflight", type: "stage", position: { x: 980, y: 410 }, stageId: "preflight", title: "Prepare creative", eyebrow: "04 · PREPROCESS", subtitle: "Validate, render, and normalize assets." },
  { id: "factual_qa", type: "stage", position: { x: 1440, y: 40 }, stageId: "factual_qa", title: "Product + offer QA", eyebrow: "05 · DECISIONS", subtitle: "Check what the ad says against what you supplied." },
  { id: "quality", type: "stage", position: { x: 1440, y: 900 }, stageId: "quality", title: "Creative quality", eyebrow: "06 · DECISIONS", subtitle: "Score the ad against the editable review skill." },
  { id: "findings", type: "findings", position: { x: 1920, y: 420 }, stageId: "findings", title: "Findings + annotations", eyebrow: "07 · TWO REPORTS", subtitle: "See every issue, numbered on the matching image." },
  { id: "gate", type: "gate", position: { x: 2500, y: 450 }, stageId: "gate", title: "Quality threshold", eyebrow: "08 · ROUTER", subtitle: "Choose automatic pass or human review." },
  { id: "review", type: "review", position: { x: 2970, y: 70 }, stageId: "review", title: "Human review", eyebrow: "09 · CONDITIONAL PATH", subtitle: "Review the evidence before approving next steps." },
  { id: "improve", type: "improve", position: { x: 2970, y: 900 }, stageId: "improve", title: "Image improvements", eyebrow: "10 · OPTIONAL PATH", subtitle: "Explore four changes and review generated drafts." },
  { id: "complete", type: "complete", position: { x: 3480, y: 455 }, stageId: "complete", title: "Done", eyebrow: "11 · OUTPUT", subtitle: "Run status and final handoff." },
];

const baseEdges: Edge[] = [
  { id: "e-input-questionnaire", source: "input", target: "questionnaire", label: "brief + facts", type: "smoothstep" },
  { id: "e-input-skill", source: "input", target: "skill", label: "brand context", type: "smoothstep" },
  { id: "e-input-preflight", source: "input", target: "preflight", type: "smoothstep" },
  { id: "e-questionnaire-facts", source: "questionnaire", target: "factual_qa", label: "checks", type: "smoothstep" },
  { id: "e-skill-quality", source: "skill", target: "quality", label: "rubric", type: "smoothstep" },
  { id: "e-preflight-facts", source: "preflight", target: "factual_qa", type: "smoothstep" },
  { id: "e-preflight-quality", source: "preflight", target: "quality", type: "smoothstep" },
  { id: "e-facts-findings", source: "factual_qa", target: "findings", type: "smoothstep" },
  { id: "e-quality-findings", source: "quality", target: "findings", type: "smoothstep" },
  { id: "e-findings-gate", source: "findings", target: "gate", type: "smoothstep" },
  { id: "e-gate-review", source: "gate", target: "review", label: "needs a person", type: "smoothstep" },
  { id: "e-review-improve", source: "review", target: "improve", label: "approved", type: "smoothstep" },
  { id: "e-gate-complete", source: "gate", target: "complete", label: "threshold met", type: "smoothstep" },
  { id: "e-improve-complete", source: "improve", target: "complete", type: "smoothstep" },
];

function buildNodeData(actions: NodeActions, model: AppModel, base: typeof baseNodes[number], focusNode: (id: string) => void): FlowNodeData {
  const progress = statusOf(model, base.stageId);
  let status = progress?.status;
  let detail = progress?.detail;
  if (base.stageId === "input") {
    status = model.run ? "complete" : "pending";
    detail = model.run ? `${model.run.assets.length} file${model.run.assets.length === 1 ? "" : "s"} received` : undefined;
  } else if (base.stageId === "questionnaire") {
    status = model.run ? "complete" : "pending";
    detail = model.run ? `${model.run.questionnaire.filter((item) => item.enabled).length} checks sent to analysis` : undefined;
  } else if (base.stageId === "skill") {
    status = model.run ? "complete" : "pending";
    detail = model.run ? "Skill attached to creative-quality review" : undefined;
  }
  return { ...actions, model, title: base.title, eyebrow: base.eyebrow, subtitle: base.subtitle, stageId: base.stageId, status, detail, focusNode };
}

function Canvas({ model, actions }: { model: AppModel; actions: NodeActions }) {
  const flow = useReactFlow();
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>("input");
  const focusNodeRef = useRef<(id: string) => void>(() => undefined);
  const routeFocusNode = useCallback((id: string) => focusNodeRef.current(id), []);
  const canvasActions = useMemo<NodeActions & { focusNode: (id: string) => void }>(() => ({ ...actions, focusNode: routeFocusNode }), [actions, routeFocusNode]);
  const initialNodes = useMemo(() => baseNodes.map((base) => ({
    ...base,
    data: buildNodeData(canvasActions, model, base, routeFocusNode),
    style: base.id === "input" ? focusNodeSize() : nodeSizes[base.id] ?? { width: 300, height: 220 },
    className: base.id === "input" ? "focused-preview" : "",
  })) as Node<FlowNodeData>[], []);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(baseEdges);
  const centerFocusedNode = useCallback((id: string, duration: number) => {
    const node = flow.getNode(id);
    if (!node) return;
    const size = focusNodeSize();
    const zoom = 0.95;
    void flow.setCenter(node.position.x + size.width / 2, node.position.y + size.height / 2 - 24 / zoom, { zoom, duration });
  }, [flow]);
  const onFlowInit = useCallback(() => {
    window.setTimeout(() => centerFocusedNode("input", 0), 120);
  }, [centerFocusedNode]);

  const focusNode = useCallback((id: string) => {
    setFocusedNodeId(id);
    setNodes((current) => current.map((node) => ({
      ...node,
      style: { ...node.style, ...(node.id === id ? focusNodeSize() : nodeSizes[node.id]) },
      className: node.id === id ? "focused-preview" : "",
    })));
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => centerFocusedNode(id, 360)));
  }, [centerFocusedNode, setNodes]);
  focusNodeRef.current = focusNode;

  const showOverview = useCallback(() => {
    setFocusedNodeId(null);
    setNodes((current) => current.map((node) => ({
      ...node,
      style: { ...node.style, ...nodeSizes[node.id] },
      className: "",
    })));
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => void flow.fitView({ padding: 0.08, duration: 360, minZoom: 0.08, maxZoom: 0.42 })));
  }, [flow, setNodes]);

  useEffect(() => {
    setNodes((current) => current.map((node) => {
      const base = baseNodes.find((item) => item.id === node.id);
      return base ? { ...node, data: buildNodeData(canvasActions, model, base, routeFocusNode) } : node;
    }));
  }, [canvasActions, model, routeFocusNode, setNodes]);

  const focusedIndex = baseNodes.findIndex((node) => node.id === focusedNodeId);
  const focusedNode = focusedIndex >= 0 ? baseNodes[focusedIndex] : null;
  const visibleNodes = focusedNode ? nodes.filter((node) => node.id === focusedNode.id) : nodes;
  const visibleEdges = focusedNode ? [] : edges;
  const stepBy = useCallback((delta: number) => {
    const next = baseNodes[focusedIndex + delta];
    if (next) focusNode(next.id);
  }, [focusedIndex, focusNode]);

  useEffect(() => {
    if (!focusedNodeId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest("input, textarea, select, button, a, summary"))) return;
      if (event.key === "ArrowLeft") { event.preventDefault(); stepBy(-1); }
      if (event.key === "ArrowRight") { event.preventDefault(); stepBy(1); }
      if (event.key === "Escape") { event.preventDefault(); showOverview(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [focusedNodeId, showOverview, stepBy]);

  useEffect(() => {
    const completed = new Set((model.run?.nodes ?? []).filter((node) => node.status === "complete").map((node) => node.id));
    const active = new Set([
      ...(model.run?.nodes ?? []).filter((node) => node.status === "running").map((node) => node.id),
      ...(model.running && model.activeStage ? activeStageNodes[model.activeStage] ?? [] : []),
    ]);
    const nextStatus = model.run?.needs_human_review;
    setEdges(baseEdges.map((edge) => {
      const route = edge.id === "e-gate-review" || edge.id === "e-review-improve";
      const skipReview = edge.id === "e-gate-complete" && nextStatus === false;
      const skipImprove = ["e-review-improve", "e-improve-complete"].includes(edge.id) && model.run?.improve_images === false;
      const edgeStage = edge.source;
      const animated = active.has(edgeStage) || (edge.source === "input" && model.running);
      const isDone = completed.has(edgeStage) && (!route || nextStatus === true);
      return { ...edge, animated, className: `${isDone ? "edge-done" : ""} ${skipReview || skipImprove ? "edge-muted" : ""}`, style: { stroke: skipReview || skipImprove ? "#2d3740" : isDone ? "#52c8a2" : animated ? "#c1a4fb" : "#43505e", strokeWidth: animated ? 2 : 1.4, opacity: skipReview || skipImprove ? 0.35 : 1 } };
    }));
  }, [model.run, model.running, model.activeStage, setEdges]);

  return <div className="canvas-wrap">
    <div className={`canvas-caption ${focusedNode ? "caption-hidden" : ""}`}><span className="canvas-kicker">VISUAL WORKFLOW</span><span>Move, zoom, and configure each node in place</span><span className="canvas-node-count">11 NODES · 3 BRANCHES</span></div>
    {focusedNode && <nav className="canvas-stepper nodrag nowheel" aria-label="Workflow step preview" onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()}>
      <button type="button" className="stepper-arrow" aria-label="Previous step" title="Previous step (←)" disabled={focusedIndex <= 0} onClick={() => stepBy(-1)}><span aria-hidden="true">‹</span><span className="stepper-label">Previous</span></button>
      <div className="stepper-title"><span>{String(focusedIndex + 1).padStart(2, "0")} / {baseNodes.length}</span><strong>{focusedNode.title}</strong></div>
      <button type="button" className="stepper-arrow" aria-label="Next step" title="Next step (→)" disabled={focusedIndex >= baseNodes.length - 1} onClick={() => stepBy(1)}><span aria-hidden="true">›</span><span className="stepper-label">Next</span></button>
      <button type="button" className="stepper-overview" onClick={showOverview}>Overview</button>
    </nav>}
    <ReactFlow
      onInit={onFlowInit}
      nodes={visibleNodes}
      edges={visibleEdges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      defaultViewport={{ x: window.innerWidth <= 650 ? 8 : 40, y: -180, zoom: 0.82 }}
      minZoom={0.08}
      maxZoom={1.5}
      nodesConnectable={false}
      elementsSelectable
      panOnScroll
      selectionOnDrag={false}
      onNodeClick={(event, node) => {
        const target = event.target;
        if (target instanceof HTMLElement && target.closest("input, textarea, select, button, a, summary")) return;
        focusNode(node.id);
      }}
      defaultEdgeOptions={{ type: "smoothstep" }}
    >
      <Background variant={BackgroundVariant.Dots} gap={19} size={1.25} color="#34404c" />
      {!focusedNode && <Controls position="top-left" style={{ top: 42, left: 14 }} showInteractive={false} />}
      {!focusedNode && <MiniMap position="top-right" style={{ width: 164, height: 106 }} pannable zoomable nodeColor={(node) => node.type === "creativeInput" ? "#987cc4" : node.type === "findings" ? "#3f987e" : "#586879"} maskColor="rgba(8, 11, 15, 0.74)" />}
    </ReactFlow>
    {!focusedNode && <div className="canvas-legend"><span><i className="legend-dot config" />Editable node</span><span><i className="legend-dot active" />Running step</span><span><i className="legend-dot done" />Completed</span></div>}
  </div>;
}

function loadSessionDraft(): Partial<AppModel> {
  try {
    const stored = window.sessionStorage.getItem("ads-right:workflow-draft:v1");
    if (!stored) return {};
    const value = JSON.parse(stored) as Partial<AppModel>;
    return {
      brief: typeof value.brief === "string" ? value.brief : "",
      platform: typeof value.platform === "string" ? value.platform : initialModel.platform,
      adType: typeof value.adType === "string" ? value.adType : initialModel.adType,
      objective: typeof value.objective === "string" ? value.objective : initialModel.objective,
      questionnaire: Array.isArray(value.questionnaire) ? value.questionnaire : [],
      skillText: typeof value.skillText === "string" ? value.skillText : "",
      thresholds: value.thresholds ?? initialModel.thresholds,
      runBudgetUsd: typeof value.runBudgetUsd === "number" ? value.runBudgetUsd : initialModel.runBudgetUsd,
      improveImages: typeof value.improveImages === "boolean" ? value.improveImages : false,
    };
  } catch {
    return {};
  }
}

function AppInner() {
  const [model, setModel] = useState<AppModel>(() => ({ ...initialModel, ...loadSessionDraft() }));
  const pauseRequestedRef = useRef(false);
  const pipelineRef = useRef<{ form: FormData; view: RunView | null; nextIndex: number } | null>(null);

  const patchModel = useCallback((patch: Partial<AppModel>) => setModel((current) => ({ ...current, ...patch })), []);
  const setFiles = useCallback((files: File[]) => patchModel({ files }), [patchModel]);
  const setBrief = useCallback((brief: string) => patchModel({ brief }), [patchModel]);
  const setPlatform = useCallback((platform: string) => patchModel({ platform }), [patchModel]);
  const setAdType = useCallback((adType: string) => patchModel({ adType }), [patchModel]);
  const setObjective = useCallback((objective: string) => patchModel({ objective }), [patchModel]);
  const setQuestionnaire = useCallback((questionnaire: QuestionnaireItem[]) => patchModel({ questionnaire }), [patchModel]);
  const setSkillText = useCallback((skillText: string) => patchModel({ skillText }), [patchModel]);
  const setThresholds = useCallback((thresholds: WorkflowThresholds) => patchModel({ thresholds }), [patchModel]);
  const setRunBudgetUsd = useCallback((runBudgetUsd: number) => patchModel({ runBudgetUsd: Math.max(0.5, Math.min(50, runBudgetUsd || 0.5)) }), [patchModel]);
  const setImproveImages = useCallback((improveImages: boolean) => patchModel({ improveImages }), [patchModel]);
  const setReviewNotes = useCallback((reviewNotes: string) => patchModel({ reviewNotes }), [patchModel]);

  const acceptStageResult = useCallback((result: StageResult) => {
    setModel((current) => {
      const questions = { ...current.questions };
      for (const event of result.events) {
        if (event.type === "question.updated") {
          const question = event.data as unknown as QuestionEvent;
          questions[question.id] = question;
        }
      }
      return {
        ...current,
        run: result.view,
        questions,
        statusMessage: result.view.message,
        error: result.view.error || "",
      };
    });
  }, []);

  useEffect(() => {
    let alive = true;
    Promise.all([fetch("/api/config/defaults"), fetch("/api/health")]).then(async ([defaultsResponse, healthResponse]) => {
      const config = defaultsResponse.ok ? await defaultsResponse.json() as Defaults : null;
      const health = healthResponse.ok ? await healthResponse.json() as { ai_configured: boolean } : null;
      if (!alive) return;
      setModel((current) => ({
        ...current,
        questionnaire: current.questionnaire.length ? current.questionnaire : config?.questionnaire ?? current.questionnaire,
        skillText: current.skillText || config?.skill_text || "",
        thresholds: config?.limits?.thresholds ?? current.thresholds,
        runBudgetUsd: config?.limits?.default_run_budget_usd ?? current.runBudgetUsd,
        defaultsLoaded: !!config,
        apiOnline: !!health,
        aiConfigured: health?.ai_configured ?? false,
        error: config ? current.error : "The API is not reachable. Start the FastAPI backend to load defaults and run this workflow.",
      }));
    }).catch(() => {
      if (alive) setModel((current) => ({ ...current, apiOnline: false, aiConfigured: false, error: "The API is not reachable. Start the FastAPI backend to load defaults and run this workflow." }));
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!model.defaultsLoaded) return;
    try {
      window.sessionStorage.setItem("ads-right:workflow-draft:v1", JSON.stringify({
        brief: model.brief,
        platform: model.platform,
        adType: model.adType,
        objective: model.objective,
        questionnaire: model.questionnaire,
        skillText: model.skillText,
        thresholds: model.thresholds,
        runBudgetUsd: model.runBudgetUsd,
        improveImages: model.improveImages,
      }));
    } catch { /* Browser storage can be disabled; current-tab state remains available. */ }
  }, [model.defaultsLoaded, model.brief, model.platform, model.adType, model.objective, model.questionnaire, model.skillText, model.thresholds, model.runBudgetUsd, model.improveImages]);

  const runPipeline = useCallback(async (startIndex: number) => {
    const pipeline = pipelineRef.current;
    if (!pipeline) return;
    const stages = ["preflight", "factual-qa", "quality", "reports", "gate"] as const;
    const labels = ["Preparing creative files", "Checking product, offer, and questionnaire facts", "Scoring creative quality", "Writing the separate evidence reports", "Applying the quality gate"];
    const activeNodes = [["preflight"], ["factual_qa"], ["quality"], ["findings"], ["gate"]];
    pauseRequestedRef.current = false;
    patchModel({ running: true, busyControl: false, error: "" });

    for (let index = startIndex; index < stages.length; index += 1) {
      const stage = stages[index];
      pipeline.nextIndex = index;
      const before = pipeline.view;
      if (before) {
        const active = new Set(activeNodes[index]);
        const runningView: RunView = {
          ...before,
          status: "running",
          message: labels[index],
          nodes: before.nodes.map((node) => active.has(node.id) ? { ...node, status: "running", detail: labels[index] } : node),
        };
        pipeline.view = runningView;
        patchModel({ run: runningView, statusMessage: labels[index], activeStage: stage });
      } else {
        patchModel({ statusMessage: labels[index], activeStage: stage });
      }
      if (stage === "factual-qa") {
        const pending: Record<string, QuestionEvent> = {};
        const factualLabels: Record<string, string> = {
          product_variant: "Product and variant match",
          offer_terms: "Offer terms match",
          approved_claims: "Claims have supplied support",
          cta_destination: "CTA and destination match",
          material_copy_legibility: "Material copy is legible",
          copy_syntax_issue: "Copy syntax check",
          potentially_sensitive_claim: "Potentially sensitive claim check",
        };
        for (const [id, label] of Object.entries(factualLabels)) {
          pending[id] = { id, label, stage: "factual_qa", status: "running" };
        }
        for (const item of model.questionnaire) {
          if (!item.enabled || (item.kind === "source_fact" && !item.answer.trim())) continue;
          const safeId = item.id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48) || "question";
          const id = `question_${safeId}`;
          pending[id] = { id, label: item.prompt, stage: "factual_qa", status: "running" };
        }
        setModel((current) => ({ ...current, questions: pending }));
      }
      if (stage === "quality") {
        const qualityLabels: Record<string, string> = {
          message_clarity: "Message clarity",
          product_prominence: "Product prominence",
          visual_hierarchy: "Visual hierarchy",
          mobile_readability: "Mobile readability",
          contrast_accessibility: "Contrast and accessibility",
          composition: "Composition",
          brand_fit: "Brand fit",
          placement_fit: "Placement fit",
          cta_effectiveness: "CTA effectiveness",
        };
        const pending = Object.fromEntries(Object.entries(qualityLabels).map(([id, label]) => [
          id,
          { id, label, stage: "quality", status: "running" as const },
        ]));
        setModel((current) => ({ ...current, questions: pending }));
      }

      try {
        const response = index === 0
          ? await fetch("/api/workflow/preflight", { method: "POST", body: pipeline.form })
          : await fetch(`/api/workflow/${stage}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ view: pipeline.view }),
            });
        const result = await response.json() as StageResult | { detail?: string };
        if (!response.ok) {
          throw new Error("detail" in result ? result.detail ?? `The ${stage} stage failed.` : `The ${stage} stage failed.`);
        }
        const completed = result as StageResult;
        pipeline.view = completed.view;
        pipeline.nextIndex = index + 1;
        acceptStageResult(completed);

        if (completed.view.status === "failed" || completed.view.status === "waiting_for_review" || completed.view.status === "completed") {
          patchModel({ running: false, busyControl: false, activeStage: null });
          return;
        }
        if (pauseRequestedRef.current) {
          const pausedView: RunView = { ...completed.view, status: "paused", message: "Workflow paused after the current browser-driven step." };
          pipeline.view = pausedView;
          pauseRequestedRef.current = false;
          patchModel({ run: pausedView, running: false, busyControl: false, activeStage: null, statusMessage: pausedView.message });
          return;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : `The ${stage} stage failed.`;
        const current = pipeline.view;
        if (current) {
          const active = new Set(activeNodes[index]);
          const failed: RunView = {
            ...current,
            status: "failed",
            error: message,
            message,
            nodes: current.nodes.map((node) => active.has(node.id) ? { ...node, status: "failed", detail: message } : node),
          };
          pipeline.view = failed;
          patchModel({ run: failed, running: false, busyControl: false, activeStage: null, error: message, statusMessage: message });
        } else {
          patchModel({ running: false, busyControl: false, activeStage: null, error: message, statusMessage: message });
        }
        return;
      }
    }
    patchModel({ running: false, busyControl: false, activeStage: null });
  }, [acceptStageResult, model.questionnaire, patchModel]);

  const startRun = useCallback(async () => {
    if (!model.files.length) { patchModel({ error: "Add at least one image or PDF in the Ad creative node." }); return; }
    if (!model.defaultsLoaded) { patchModel({ error: "The workflow defaults are not loaded. Check that the API is running." }); return; }
    if (!model.aiConfigured) { patchModel({ error: "Configure OPENROUTER_API_KEY as a server-side secret before running the workflow." }); return; }
    const form = new FormData();
    form.set("brief", model.brief);
    form.set("platform", model.platform);
    form.set("ad_type", model.adType);
    form.set("objective", model.objective);
    form.set("improve_images", String(model.improveImages));
    form.set("questionnaire_json", JSON.stringify(model.questionnaire));
    form.set("skill_text", model.skillText);
    form.set("thresholds_json", JSON.stringify(model.thresholds));
    form.set("budget_limit_usd", String(model.runBudgetUsd));
    model.files.forEach((file) => form.append("files", file));
    pipelineRef.current = { form, view: null, nextIndex: 0 };
    pauseRequestedRef.current = false;
    patchModel({ running: true, busyControl: false, activeStage: "preflight", error: "", statusMessage: "Starting the workflow…", questions: {}, run: null, reviewNotes: "" });
    await runPipeline(0);
  }, [model, patchModel, runPipeline]);

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        void startRun();
      }
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, [startRun]);

  const decideReview = useCallback(async (decision: "approve" | "reject") => {
    if (!model.run) return;
    let imageEditStarted = false;
    patchModel({ busyReview: true, error: "" });
    try {
      const response = await fetch("/api/workflow/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ view: model.run, decision, notes: model.reviewNotes }),
      });
      const result = await response.json() as StageResult | { detail?: string };
      if (!response.ok) throw new Error("detail" in result ? result.detail ?? "Review action failed." : "Review action failed.");
      const reviewed = result as StageResult;
      pipelineRef.current = { form: pipelineRef.current?.form ?? new FormData(), view: reviewed.view, nextIndex: 3 };
      acceptStageResult(reviewed);
      if (decision !== "approve" || !reviewed.view.improve_images || reviewed.view.status !== "running") {
        patchModel({ running: false, busyReview: false, activeStage: null, statusMessage: reviewed.view.message });
        return;
      }

      const editingView: RunView = {
        ...reviewed.view,
        nodes: reviewed.view.nodes.map((node) => node.id === "improve" ? { ...node, status: "running", detail: "Creating four distinct image edits" } : node),
      };
      imageEditStarted = true;
      patchModel({ run: editingView, running: true, busyReview: false, activeStage: "image-edits", statusMessage: "Creating four approved image edits…" });
      const imageResponse = await fetch("/api/workflow/image-edits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ view: editingView }),
      });
      const imageResult = await imageResponse.json() as StageResult | { detail?: string };
      if (!imageResponse.ok) throw new Error("detail" in imageResult ? imageResult.detail ?? "Image edit generation failed." : "Image edit generation failed.");
      acceptStageResult(imageResult as StageResult);
      patchModel({ running: false, busyReview: false, activeStage: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Review action failed.";
      if (imageEditStarted && pipelineRef.current?.view) {
        const failed: RunView = {
          ...pipelineRef.current.view,
          status: "failed",
          error: message,
          message,
          nodes: pipelineRef.current.view.nodes.map((node) => node.id === "improve" ? { ...node, status: "failed", detail: message } : node),
        };
        pipelineRef.current.view = failed;
        patchModel({ run: failed, busyReview: false, running: false, activeStage: null, error: message, statusMessage: message });
      } else {
        patchModel({ busyReview: false, running: false, activeStage: null, error: message, statusMessage: message });
      }
    }
  }, [model.run, model.reviewNotes, acceptStageResult, patchModel]);

  const controlRun = useCallback((action: "pause" | "resume" | "retry") => {
    if (action === "retry") {
      void startRun();
      return;
    }
    if (action === "pause") {
      if (!model.running) return;
      pauseRequestedRef.current = true;
      patchModel({ busyControl: true, statusMessage: "Pause requested; finishing the current step." });
      return;
    }
    const pipeline = pipelineRef.current;
    if (!pipeline || model.run?.status !== "paused") return;
    pauseRequestedRef.current = false;
    if (pipeline.view) {
      pipeline.view = { ...pipeline.view, status: "running", message: "Workflow resumed in this browser session." };
    }
    patchModel({ busyControl: false, run: pipeline.view, statusMessage: "Workflow resumed in this browser session." });
    void runPipeline(pipeline.nextIndex);
  }, [model.running, model.run?.status, patchModel, runPipeline, startRun]);

  const actions = useMemo<NodeActions>(() => ({ model, setFiles, setBrief, setPlatform, setAdType, setObjective, setQuestionnaire, setSkillText, setThresholds, setRunBudgetUsd, setImproveImages, setReviewNotes, startRun, decideReview, controlRun }), [model, setFiles, setBrief, setPlatform, setAdType, setObjective, setQuestionnaire, setSkillText, setThresholds, setRunBudgetUsd, setImproveImages, setReviewNotes, startRun, decideReview, controlRun]);
  const viewStatus = model.run?.status ?? "draft";
  const statusText = viewStatus === "draft" ? "Workflow draft" : viewStatus.replaceAll("_", " ");

  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href="#workflow" aria-label="Adverifact home"><span className="brand-mark">↗</span><span>adveri<span className="brand-light">fact</span></span></a>
      <div className="topbar-center"><span className="workspace-label">WORKFLOW BUILDER</span><span className="divider-dot">/</span><span className="project-label">Ecommerce ad review</span><span className="workflow-badge">DEMO</span></div>
      <div className="topbar-actions">
        <div className={`connection-state ${model.apiOnline ? "connected" : model.apiOnline === false ? "disconnected" : ""}`}><span />{model.apiOnline ? model.aiConfigured ? "OpenRouter ready" : "API connected · key missing" : model.apiOnline === false ? "API offline" : "Connecting"}</div>
        <span className={`run-state run-${viewStatus}`}><i />{statusText}</span>
        <button className="run-button top-run-button" type="button" onClick={() => model.run?.status === "paused" ? void controlRun("resume") : model.run?.status === "failed" ? void controlRun("retry") : void startRun()} disabled={model.running || model.busyReview || model.busyControl || !model.defaultsLoaded}><span className="play-icon">▶</span>{model.running ? "Running…" : model.run?.status === "paused" ? "Resume workflow" : model.run?.status === "failed" ? "Retry run" : model.run ? "Run again" : "Run workflow"}<kbd>⌘ ↵</kbd></button>
      </div>
    </header>
    <main id="workflow" className="workflow-main">
      {model.error && <div className="toast error-toast" role="alert"><span>!</span><div>{model.error}</div><button type="button" aria-label="Dismiss" onClick={() => patchModel({ error: "" })}>×</button></div>}
      {model.run?.status === "completed" && model.statusMessage && <div className="toast success-toast" role="status"><span>✓</span><div>{model.statusMessage}</div><button type="button" aria-label="Dismiss" onClick={() => patchModel({ statusMessage: "" })}>×</button></div>}
      <Canvas model={model} actions={actions} />
      <footer className="workflow-footer"><span><i className="footer-live" />{model.statusMessage}</span><span>{model.run ? `Browser session ${model.run.id.slice(0, 8)} · ${model.run.assets.length} asset${model.run.assets.length === 1 ? "" : "s"}` : "Workflow settings stay in this browser session; uploaded files and results stay in this tab"}</span></footer>
    </main>
  </div>;
}

export default function App() {
  return <ReactFlowProvider><AppInner /></ReactFlowProvider>;
}
