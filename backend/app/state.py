from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.contracts import RunView


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class RunState:
    """Ephemeral state for one browser-requested workflow stage."""

    view: RunView
    run_dir: Path
    asset_paths: dict[str, Path] = field(default_factory=dict)
    analysis_page_paths: dict[int, Path] = field(default_factory=dict)
    event_history: list[dict[str, Any]] = field(default_factory=list)


def emit(state: RunState, event_type: str, **data: Any) -> dict[str, Any]:
    """Collect stage events in request memory for the browser to receive."""
    event = {
        "sequence": len(state.event_history) + 1,
        "type": event_type,
        "run_id": state.view.id,
        "at": utc_now(),
        "data": data,
    }
    state.event_history.append(event)
    return event
