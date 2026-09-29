from __future__ import annotations

import json
import re
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

try:
    from webtool.cbr_system import (
        build_candidate_features,
        normalize_weights,
        score_cbr_candidates,
    )
    from webtool.cbr_feature_scoring import normalize_cbr_features_payload
    from webtool.llm_evaluator import evaluate_with_llm_selection
    from webtool.llm_evaluator import evaluate_with_llm_preselection
    from webtool.llm_evaluator import stream_with_llm_selection
    from webtool.h2h_core import build_initial_selection, compute_h2h_state
    from webtool.snapshot_core import build_snapshot_view_model
    from webtool.fairness_agent import (
        run_candidate_review,
        run_cross_candidate_audit,
        run_fairness_qa,
        stream_candidate_review,
        stream_cross_candidate_audit,
        stream_fairness_qa,
    )
    from webtool.ntnu_agent import (
        run_ntnu_final_audit,
        run_ntnu_initial_review,
        run_ntnu_policy_qa,
        stream_ntnu_final_audit,
        stream_ntnu_initial_review,
        stream_ntnu_policy_qa,
    )
except ImportError:
    from cbr_system import (  # type: ignore
        build_candidate_features,
        normalize_weights,
        score_cbr_candidates,
    )
    from cbr_feature_scoring import normalize_cbr_features_payload  # type: ignore
    from llm_evaluator import evaluate_with_llm_selection  # type: ignore
    from llm_evaluator import evaluate_with_llm_preselection  # type: ignore
    from llm_evaluator import stream_with_llm_selection  # type: ignore
    from h2h_core import build_initial_selection, compute_h2h_state  # type: ignore
    from snapshot_core import build_snapshot_view_model  # type: ignore
    from fairness_agent import (  # type: ignore
        run_candidate_review,
        run_cross_candidate_audit,
        run_fairness_qa,
        stream_candidate_review,
        stream_cross_candidate_audit,
        stream_fairness_qa,
    )
    from ntnu_agent import (  # type: ignore
        run_ntnu_final_audit,
        run_ntnu_initial_review,
        run_ntnu_policy_qa,
        stream_ntnu_final_audit,
        stream_ntnu_initial_review,
        stream_ntnu_policy_qa,
    )


BASE_DIR = Path(__file__).resolve().parent
DEFAULT_JOB_DIR = BASE_DIR / "data" / "jobs" / "STS_PhD_Position_2026"
DEFAULT_APPLICATIONS_PATH = DEFAULT_JOB_DIR / "STS_PhD_Position_2026_applications_with_summaries.json"
STATIC_DIR = BASE_DIR / "static"
LOG_DIR = BASE_DIR / "logs"
RANKING_LOG_PATH = LOG_DIR / "head_to_head_rankings.jsonl"
WORKFLOW_STAGE_LOG_PATH = LOG_DIR / "workflow_stage_events.jsonl"
USER_FEEDBACK_LOG_PATH = LOG_DIR / "user_feedback_responses.jsonl"
API_EVENT_LOG_PATH = LOG_DIR / "api_events.jsonl"
NTNU_KNOWLEDGE_BASE_DIR = BASE_DIR / "prompts" / "eval_assistants" / "ntnu_knowledge_base"
NTNU_RETRIEVAL_MAP_PATH = NTNU_KNOWLEDGE_BASE_DIR / "retrieval_map.json"
DEFAULT_MUST_HAVE_REQUIREMENTS = [
    "Master's degree in STS or a similar field.",
    "Educational background equivalent to a Norwegian five-year program.",
    "At least 120 ECTS (or equivalent) at master's level.",
    "Master's Degree Completed Before Start",
    "Master's average grade equivalent to B or better on the NTNU scale.",
    "Admission requirements for NTNU's doctoral programme.",
    "Fluent oral and written Norwegian/Scandinavian.",
    "Fluent oral and written English.",
]

class RunConfig(BaseModel):
    evaluator_mode: str = "cbr"
    extra_criteria: list[str] = Field(default_factory=list)
    cbr_weights: dict[str, float] = Field(
        default_factory=lambda: {
            "education": 0.24,
            "experience": 0.28,
            "research_outputs": 0.22,
            "skills_and_methods": 0.26,
        }
    )
    education_backgrounds: dict[str, list[str]] = Field(
        default_factory=lambda: {
            "preferred": [
                "Science and Technology Studies (STS)",
                "Sociology",
                "History",
                "Geography",
                "Political science",
                "Philosophy",
                "Media Studies",
            ],
            "acceptable": [],
        }
    )
    selected_subfeatures: dict[str, list[str]] = Field(
        default_factory=lambda: {
            "education": [
                "highest_degree_completed",
                "gpa_normalized_0_100",
                "master_thesis_grade_normalized_0_100",
                "bachelor_field",
                "master_field",
            ],
            "experience": [
                "years_research_experience",
                "years_relevant_professional_experience",
                "years_teaching_experience",
                "career_gap_months",
                "time_since_last_academic_activity_months",
            ],
            "research_outputs": [
                "num_peer_reviewed_publications",
                "num_first_author_publications",
                "num_conference_outputs",
                "num_posters_or_extended_abstracts",
                "has_independent_research_output",
            ],
            "skills_and_methods": [
                "has_quantitative_methods",
                "has_qualitative_methods",
                "has_programming_or_technical_skills",
                "num_programming_languages",
                "has_experimental_or_empirical_design",
                "english_level",
                "local_language_level",
            ],
        }
    )
    llm_evaluator: dict[str, Any] = Field(default_factory=dict)
    initial_screening: dict[str, Any] = Field(default_factory=dict)
    max_matchups: int = 20


class PreselectionRunRequest(BaseModel):
    run_config: RunConfig = Field(default_factory=RunConfig)
    requirements: list[str] = Field(default_factory=list)


class LLMEvaluatorConfig(BaseModel):
    model: str = "gpt-5.4-mini"
    key_name: str = "OPENAI_KEY"
    config_path: str = "prompts/CONFIG.txt"
    prompt_dir: str = "prompts/eval_agents"
    additional_instructions: str = ""


class LLMEvaluatorRunRequest(BaseModel):
    run_config: RunConfig = Field(default_factory=RunConfig)
    llm_config: LLMEvaluatorConfig = Field(default_factory=LLMEvaluatorConfig)


class FairnessAgentConfig(BaseModel):
    model: str = "gpt-5.4-mini"
    key_name: str = "OPENAI_KEY"
    config_path: str = "prompts/CONFIG.txt"
    prompt_dir: str = "prompts/eval_assistants"
    additional_instructions: str = ""


class NTNUPolicyConfig(BaseModel):
    model: str = "gpt-5.4-mini"
    key_name: str = "OPENAI_KEY"
    config_path: str = "prompts/CONFIG.txt"
    prompt_dir: str = "prompts/eval_assistants"
    additional_instructions: str = ""


class FairnessCandidateReviewRequest(BaseModel):
    candidate_id: str
    candidate_materials: dict[str, Any] = Field(default_factory=dict)
    candidate_summary: str = ""
    sensitive_attributes: dict[str, Any] = Field(default_factory=dict)
    ratings: dict[str, Any] = Field(default_factory=dict)
    notes: str = ""
    fairness_config: FairnessAgentConfig = Field(default_factory=FairnessAgentConfig)


class FairnessQARequest(BaseModel):
    question: str
    optional_context: dict[str, Any] = Field(default_factory=dict)
    fairness_config: FairnessAgentConfig = Field(default_factory=FairnessAgentConfig)


class FairnessCrossCandidateAuditRequest(BaseModel):
    candidate_metadata: list[dict[str, Any]] = Field(default_factory=list)
    ratings: dict[str, Any] = Field(default_factory=dict)
    rationales: dict[str, str] = Field(default_factory=dict)
    sensitive_attributes: dict[str, Any] = Field(default_factory=dict)
    fairness_config: FairnessAgentConfig = Field(default_factory=FairnessAgentConfig)


class NTNUInitialReviewRequest(BaseModel):
    candidate_id: str
    candidate_materials: dict[str, Any] = Field(default_factory=dict)
    candidate_summary: str = ""
    sensitive_attributes: dict[str, Any] = Field(default_factory=dict)
    ntnu_config: NTNUPolicyConfig = Field(default_factory=NTNUPolicyConfig)


class NTNUQARequest(BaseModel):
    question: str
    chat_history: list[dict[str, Any]] = Field(default_factory=list)
    candidate_context: dict[str, Any] = Field(default_factory=dict)
    ntnu_config: NTNUPolicyConfig = Field(default_factory=NTNUPolicyConfig)


class NTNUFinalAuditRequest(BaseModel):
    selected_candidates: list[dict[str, Any]] = Field(default_factory=list)
    ratings: dict[str, Any] = Field(default_factory=dict)
    rationales: dict[str, Any] = Field(default_factory=dict)
    sensitive_attributes: dict[str, Any] = Field(default_factory=dict)
    ntnu_config: NTNUPolicyConfig = Field(default_factory=NTNUPolicyConfig)


class RankingRow(BaseModel):
    rank: int
    application_id: str
    score: float
    wins: int
    losses: int
    comparisons: int


class ComparisonRecord(BaseModel):
    left: str
    right: str
    winner: str
    loser: str
    rationale: str = ""
    section_winners: dict[str, str] = Field(default_factory=dict)


class RankingLogPayload(BaseModel):
    job_dir: str
    session_id: str = ""
    source_path: str = ""
    config_signature: str = ""
    pool_signature: str = ""
    rankings: list[RankingRow] = Field(default_factory=list)
    comparisons: list[ComparisonRecord] = Field(default_factory=list)


class StageEventPayload(BaseModel):
    stage: str
    action: str
    inputs: dict[str, Any] = Field(default_factory=dict)
    outputs: dict[str, Any] = Field(default_factory=dict)
    session_id: Optional[str] = None


class UserFeedbackSubmissionPayload(BaseModel):
    exported_at: Optional[str] = None
    workflow_session_id: str = ""
    session_context: dict[str, Any] = Field(default_factory=dict)
    feedback: dict[str, Any] = Field(default_factory=dict)


class H2HComputeRequest(BaseModel):
    candidates: list[dict[str, Any]] = Field(default_factory=list)
    comparisons: list[dict[str, Any]] = Field(default_factory=list)
    eta: float = 0.05
    exclude_top6_vs_top6: bool = True


class H2HInitialSelectionRequest(BaseModel):
    all_candidates: list[dict[str, Any]] = Field(default_factory=list)
    cbr_top_ids: list[str] = Field(default_factory=list)
    llm_top_ids: list[str] = Field(default_factory=list)
    pool_size: int = 10
    rng_seed: int = 42


class SnapshotViewModelRequest(BaseModel):
    ranked_candidates: list[dict[str, Any]] = Field(default_factory=list)
    llm_selection: Optional[dict[str, Any]] = None
    pool_size: int = 10
    rng_seed: int = 42


def _read_text(path: Path) -> str:
    if not path.exists():
        return ""
    return path.read_text(encoding="utf-8")


def _append_ranking_log(payload: RankingLogPayload) -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    entry = {
        "timestamp": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
        **payload.model_dump(),
    }
    with RANKING_LOG_PATH.open("a", encoding="utf-8") as log_file:
        log_file.write(json.dumps(entry, ensure_ascii=True) + "\n")


def _compact_log_value(value: Any, depth: int = 0) -> Any:
    if depth > 5:
        return "<truncated:depth>"

    if isinstance(value, str):
        max_len = 2000
        return value if len(value) <= max_len else f"{value[:max_len-3]}..."

    if isinstance(value, list):
        if len(value) > 40:
            tail = value[-2:] if len(value) >= 2 else value
            return {
                "_type": "list",
                "count": len(value),
                "tail": [_compact_log_value(item, depth + 1) for item in tail],
            }
        return [_compact_log_value(item, depth + 1) for item in value]

    if isinstance(value, dict):
        compacted: dict[str, Any] = {}
        for key, nested in value.items():
            key_norm = str(key)

            if key_norm in {"candidate_context", "conversation_history", "qa_history"}:
                if isinstance(nested, list):
                    compacted[key_norm] = {
                        "_type": "list",
                        "count": len(nested),
                        "tail": [_compact_log_value(item, depth + 1) for item in nested[-2:]],
                    }
                elif isinstance(nested, dict):
                    compacted[key_norm] = {
                        "_type": "object",
                        "keys": sorted([str(k) for k in nested.keys()])[:40],
                    }
                else:
                    compacted[key_norm] = _compact_log_value(nested, depth + 1)
                continue

            compacted[key_norm] = _compact_log_value(nested, depth + 1)
        return compacted

    return value


def _append_stage_event_log(payload: StageEventPayload) -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    entry = {
        "timestamp": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
        **_compact_log_value(payload.model_dump()),
    }
    with WORKFLOW_STAGE_LOG_PATH.open("a", encoding="utf-8") as log_file:
        log_file.write(json.dumps(entry, ensure_ascii=True) + "\n")


def _append_api_event_log(
    *,
    route: str,
    event_type: str,
    inputs: Any,
    outputs: Any,
    ok: bool = True,
) -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    workflow_session_id = ""
    if isinstance(inputs, dict):
        workflow_session_id = str(
            inputs.get("workflow_session_id")
            or inputs.get("session_id")
            or ((inputs.get("session_context") or {}).get("workflow_session_id") if isinstance(inputs.get("session_context"), dict) else "")
            or ""
        ).strip()
    entry = {
        "timestamp": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
        "route": str(route or "unknown"),
        "event_type": str(event_type or "request_response"),
        "ok": bool(ok),
        "workflow_session_id": workflow_session_id,
        "inputs": _compact_log_value(inputs),
        "outputs": _compact_log_value(outputs),
    }
    with API_EVENT_LOG_PATH.open("a", encoding="utf-8") as log_file:
        log_file.write(json.dumps(entry, ensure_ascii=True) + "\n")


def _append_user_feedback_log(payload: UserFeedbackSubmissionPayload) -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    entry = {
        "timestamp": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
        **payload.model_dump(),
    }
    with USER_FEEDBACK_LOG_PATH.open("a", encoding="utf-8") as log_file:
        log_file.write(json.dumps(entry, ensure_ascii=True) + "\n")


def _sse_message(payload: dict[str, Any], event: str | None = None) -> str:
    message = ""
    if event:
        message += f"event: {event}\n"
    message += f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
    return message


def _stream_response_from_events(
    event_factory: Callable[[], Iterator[dict[str, Any]]],
    *,
    log_route: str | None = None,
    log_inputs: Any = None,
) -> StreamingResponse:
    def event_stream() -> Iterator[str]:
        final_event_for_log: dict[str, Any] | None = None
        error_for_log: dict[str, Any] | None = None
        try:
            for event in event_factory():
                if event.get("type") == "done":
                    final_event_for_log = event
                elif event.get("type") == "error":
                    error_for_log = event
                yield _sse_message(event, event.get("type"))
        except Exception as exc:
            error_event = {
                "type": "error",
                "error_type": type(exc).__name__,
                "error_message": str(exc),
            }
            error_for_log = error_event
            yield _sse_message(error_event, "error")
        finally:
            if log_route:
                if final_event_for_log is not None:
                    _append_api_event_log(
                        route=log_route,
                        event_type="stream_complete",
                        inputs=log_inputs,
                        outputs=final_event_for_log,
                        ok=True,
                    )
                elif error_for_log is not None:
                    _append_api_event_log(
                        route=log_route,
                        event_type="stream_error",
                        inputs=log_inputs,
                        outputs=error_for_log,
                        ok=False,
                    )

    return StreamingResponse(event_stream(), media_type="text/event-stream")


def _model_meta(evaluation: dict[str, Any], fallback_model: str) -> dict[str, Any]:
    return {
        "model": evaluation.get("model", fallback_model),
    }


def _ntnu_candidate_payload(payload: NTNUInitialReviewRequest) -> dict[str, Any]:
    return {
        **payload.candidate_materials,
        "candidate_summary": payload.candidate_summary,
        "sensitive_attributes": payload.sensitive_attributes,
    }


def load_job_data() -> dict[str, Any]:
    if DEFAULT_APPLICATIONS_PATH.exists():
        payload = json.loads(DEFAULT_APPLICATIONS_PATH.read_text(encoding="utf-8"))
        return {
            "job_ad": payload.get("job_ad", ""),
            "applications": payload.get("applications", []),
            "job_name": payload.get("job_name", DEFAULT_JOB_DIR.name),
            "source_path": str(DEFAULT_APPLICATIONS_PATH.relative_to(BASE_DIR)),
        }

    # Backward compatibility with prior scenario-based source.
    scenarios_path = DEFAULT_JOB_DIR / "scenarios.json"
    job_ad_path = DEFAULT_JOB_DIR / "job_ad.txt"
    if not scenarios_path.exists():
        raise FileNotFoundError(
            f"Missing source data: expected {DEFAULT_APPLICATIONS_PATH} or {scenarios_path}"
        )

    scenarios = json.loads(scenarios_path.read_text(encoding="utf-8"))
    return {
        "job_ad": _read_text(job_ad_path),
        "applications": scenarios,
        "job_name": DEFAULT_JOB_DIR.name,
        "source_path": str(scenarios_path.relative_to(BASE_DIR)),
    }

def _build_llm_candidate_payload(data: dict[str, Any]) -> list[dict[str, Any]]:
    all_candidates: list[dict[str, Any]] = []
    for row in data.get("applications", []):
        if not isinstance(row, dict):
            continue
        application_id = str(row.get("application_id", "")).strip()
        if not application_id:
            continue
        all_candidates.append(
            {
                "application_id": application_id,
                "summary": row.get("summary"),
            }
        )
    return all_candidates


def _excluded_candidate_ids_from_config(config: RunConfig | None) -> set[str]:
    if config is None:
        return set()
    initial = config.initial_screening if isinstance(config.initial_screening, dict) else {}
    raw = initial.get("excluded_candidate_ids") if isinstance(initial, dict) else []
    if not isinstance(raw, list):
        return set()
    return {str(item or "").strip() for item in raw if str(item or "").strip()}


def _extract_default_requirements(job_ad: str, limit: int = 8) -> list[str]:
    text = str(job_ad or "")
    lines = [" ".join(line.strip().split()) for line in text.splitlines()]
    lines = [line for line in lines if line]

    banned = {
        "qualification requirements",
        "the application must contain",
        "about the application",
        "job duties",
        "personal characteristics",
    }

    def add_if_concrete(target: list[str], seen: set[str], value: str) -> None:
        cleaned = re.sub(r"\s+", " ", str(value or "")).strip(" -;:.,")
        if len(cleaned) < 18 or len(cleaned) > 220:
            return
        lower = cleaned.lower()
        if lower in banned:
            return
        if not any(token in lower for token in (
            "master",
            "admission",
            "document",
            "transcript",
            "diploma",
            "degree",
            "required",
            "must",
            "cv",
            "project description",
            "publication",
            "reference",
            "english",
            "norwegian",
            "language",
        )):
            return
        key = lower
        if key in seen:
            return
        seen.add(key)
        target.append(cleaned)

    picked: list[str] = []
    seen: set[str] = set()

    for idx, line in enumerate(lines):
        lower = line.lower()

        if "master" in lower and "before" in lower and "start" in lower:
            add_if_concrete(
                picked,
                seen,
                "Completed master's degree required before employment start (final-semester applicants may apply).",
            )
            continue

        if "admission" in lower and "doctoral" in lower:
            add_if_concrete(
                picked,
                seen,
                "Candidate must be eligible for admission to NTNU's doctoral programme.",
            )
            continue

        if lower == "the application must contain":
            for nxt in lines[idx + 1 : idx + 14]:
                nxt_lower = nxt.lower()
                if nxt_lower in banned:
                    break
                add_if_concrete(picked, seen, nxt)
            continue

        add_if_concrete(picked, seen, line)
        if len(picked) >= max(1, int(limit)):
            break

    return picked[: max(1, int(limit))]


def _load_ntnu_retrieval_map() -> dict[str, list[str]]:
    try:
        raw = json.loads(_read_text(NTNU_RETRIEVAL_MAP_PATH))
        if not isinstance(raw, dict):
            return {}
        return {
            str(filename): [str(category) for category in categories if str(category or "").strip()]
            for filename, categories in raw.items()
            if isinstance(categories, list)
        }
    except json.JSONDecodeError:
        return {}


def _select_ntnu_docs_for_preselection() -> list[dict[str, Any]]:
    retrieval_map = _load_ntnu_retrieval_map()

    docs: list[dict[str, Any]] = []
    for path in sorted(NTNU_KNOWLEDGE_BASE_DIR.glob("*.txt")):
        filename = path.name
        categories = retrieval_map.get(filename, [])
        content = _read_text(path)
        docs.append(
            {
                "filename": filename,
                "categories": categories,
                "summary": _summarize_ntnu_doc(content, max_chars=380),
                "content_excerpt": content,
            }
        )

    return docs


def _extract_ntnu_concrete_requirements(limit: int = 8) -> list[str]:
    docs = _select_ntnu_docs_for_preselection()
    candidates: list[str] = []
    seen: set[str] = set()
    doc_priority = {
        "documentation_requirements.txt": 1,
        "recruitment_policy.txt": 2,
        "foreign_employees.txt": 3,
    }

    def rank(doc: dict[str, Any]) -> int:
        return doc_priority.get(str(doc.get("filename", "")), 99)

    for doc in sorted(docs, key=rank):
        text = str(doc.get("content_excerpt", ""))
        for line in text.splitlines():
            cleaned = " ".join(line.strip(" -\t").split())
            if len(cleaned) < 15 or len(cleaned) > 220:
                continue
            lower = cleaned.lower()
            if not any(token in lower for token in ("must", "required", "applicants must", "required documentation")):
                continue
            if not any(token in lower for token in (
                "master",
                "admission",
                "document",
                "diploma",
                "transcript",
                "translation",
                "verification",
                "language",
                "permit",
                "work",
                "cv",
            )):
                continue
            key = lower
            if key in seen:
                continue
            seen.add(key)
            candidates.append(cleaned.rstrip(".;:"))
            if len(candidates) >= max(1, int(limit)):
                return candidates

    return candidates


def _build_default_screening_requirements(job_ad: str, limit: int = 12) -> tuple[list[str], list[str], list[str]]:
    job_reqs = _extract_default_requirements(job_ad, limit=max(4, int(limit // 2)))
    ntnu_reqs = _extract_ntnu_concrete_requirements(limit=max(4, int(limit // 2)))
    merged = DEFAULT_MUST_HAVE_REQUIREMENTS[: max(1, int(limit))]
    return merged, job_reqs, ntnu_reqs


def _job_description_or_empty() -> str:
    data = load_job_data()
    return str(data.get("job_ad", ""))


def _load_prompt_preview_payload() -> dict[str, str]:
    eval_dir = BASE_DIR / "prompts" / "eval_agents"
    assistant_dir = BASE_DIR / "prompts" / "eval_assistants"
    return {
        "llm_evaluator_system": _read_text(eval_dir / "eval_system_prompt.txt"),
        "preselection_prompt": _read_text(eval_dir / "pre-screening.txt"),
        "fairness_assistant_system": _read_text(assistant_dir / "fairness_assistant_system.txt"),
        "ntnu_assistant_system": _read_text(assistant_dir / "ntnu_system.txt"),
    }


def _summarize_ntnu_doc(text: str, max_chars: int = 260) -> str:
    cleaned = str(text or "").strip()
    if not cleaned:
        return "No summary available."

    paragraphs = [part.strip() for part in cleaned.split("\n\n") if part.strip()]
    first = paragraphs[0] if paragraphs else cleaned
    first = " ".join(first.split())
    if len(first) <= max_chars:
        return first

    clipped = first[: max_chars - 1].rsplit(" ", 1)[0].strip()
    return f"{clipped}..." if clipped else f"{first[: max_chars - 3]}..."


def _load_ntnu_knowledge_base_summary() -> list[dict[str, Any]]:
    retrieval_map = _load_ntnu_retrieval_map()

    docs: list[dict[str, Any]] = []
    for path in sorted(NTNU_KNOWLEDGE_BASE_DIR.glob("*.txt")):
        content = _read_text(path)
        docs.append(
            {
                "filename": path.name,
                "summary": _summarize_ntnu_doc(content),
                "categories": retrieval_map.get(path.name, []),
            }
        )
    return docs


def build_run(config: RunConfig) -> dict[str, Any]:
    data, weights, ranked_cbr = build_ranked_candidates(config)

    cbr_top = ranked_cbr[:5]
    pool = ranked_cbr[:10]
    llm_selection: dict[str, Any] | None = None

    if str(config.evaluator_mode or "cbr").lower() == "llm":
        llm_cfg = config.llm_evaluator if isinstance(config.llm_evaluator, dict) else {}
        all_candidates = _build_llm_candidate_payload(data)
        evaluation = evaluate_with_llm_selection(
            job_ad=data.get("job_ad", ""),
            all_candidates=all_candidates,
            model=str(llm_cfg.get("model", "gpt-5.4-mini")),
            key_name=str(llm_cfg.get("key_name", "OPENAI_KEY")),
            config_path=str(llm_cfg.get("config_path", "prompts/CONFIG.txt")),
            prompt_dir=str(llm_cfg.get("prompt_dir", "prompts/eval_agents")),
            additional_instructions=str(llm_cfg.get("additional_instructions", "")),
        )

        by_id = {str(c.get("application_id", "")): c for c in ranked_cbr}
        llm_pool: list[dict[str, Any]] = []
        for label_key in ("shortlist", "longlist"):
            for row in evaluation.get(label_key, []):
                application_id = str(row.get("application_id", "")).strip()
                if not application_id:
                    continue
                candidate = by_id.get(application_id)
                if candidate is None:
                    continue
                enriched = dict(candidate)
                enriched["llm_label"] = label_key
                llm_pool.append(enriched)

        if llm_pool:
            pool = llm_pool[:10]

        llm_selection = {
            "model": evaluation.get("model", "gpt-5.4-mini"),
            "shortlist": evaluation.get("shortlist", []),
            "longlist": evaluation.get("longlist", []),
            "fallback_used": evaluation.get("fallback_used", False),
            "fallback_reason": evaluation.get("fallback_reason"),
        }
    # Pairwise aggregate matchup scoring is intentionally disabled.
    matchups: list[dict[str, Any]] = []

    return {
        "meta": {
            "job_dir": str(DEFAULT_JOB_DIR.relative_to(BASE_DIR)),
            "source_path": data.get("source_path", ""),
            "candidate_count": len(ranked_cbr),
            "evaluator_mode": str(config.evaluator_mode or "cbr").lower(),
        },
        "job_ad": data["job_ad"],
        "weights": weights,
        "ranked_candidates": ranked_cbr,
        "shortlists": {
            "cbr": cbr_top,
        },
        "pool": pool,
        "llm_selection": llm_selection,
        "head_to_head": matchups,
    }


def build_ranked_candidates(config: RunConfig) -> tuple[dict[str, Any], dict[str, float], list[dict[str, Any]]]:
    data = load_job_data()
    excluded_ids = _excluded_candidate_ids_from_config(config)
    if excluded_ids:
        data["applications"] = [
            row
            for row in data.get("applications", [])
            if isinstance(row, dict)
            and str(row.get("application_id", "")).strip()
            and str(row.get("application_id", "")).strip() not in excluded_ids
        ]
    weights = normalize_weights(config.cbr_weights)
    candidates = [
        build_candidate_features(
            item,
            scoring_config={
                "education_backgrounds": config.education_backgrounds,
                "selected_subfeatures": config.selected_subfeatures,
            },
        )
        for item in data["applications"]
    ]
    scored = score_cbr_candidates(
        candidates,
        weights,
        scoring_config={
            "selected_subfeatures": config.selected_subfeatures,
        },
    )
    ranked_cbr = sorted(scored, key=lambda c: c["scores"]["cbr"], reverse=True)
    return data, weights, ranked_cbr


app = FastAPI(title="BIAS Prototype Webtool")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def disable_cache_for_api_and_html(request: Request, call_next):
    response = await call_next(request)
    path = request.url.path or ""
    is_api = path.startswith("/api/")
    is_html_route = path in {
        "/",
        "/config",
        "/preselection",
        "/results",
        "/head-to-head",
        "/model-snapshot",
        "/top-candidates",
        "/candidate-profiles",
        "/candidate-ratings",
        "/ratings-audits",
        "/feedback-questionnaire",
        "/feedback-confirmation",
        "/cbr-scoring",
    }
    if is_api or is_html_route:
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/")
def home() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/config")
def config_page() -> FileResponse:
    return FileResponse(STATIC_DIR / "config.html")


@app.get("/results")
def results_page() -> RedirectResponse:
    return RedirectResponse(url="/preselection", status_code=307)


@app.get("/preselection")
def preselection_page() -> FileResponse:
    return FileResponse(STATIC_DIR / "preselection.html")


@app.get("/head-to-head")
def head_to_head_page() -> FileResponse:
    return FileResponse(STATIC_DIR / "head_to_head.html")


@app.get("/model-snapshot")
def model_snapshot_page() -> FileResponse:
    return FileResponse(STATIC_DIR / "model_snapshot.html")


@app.get("/top-candidates")
def top_candidates_page() -> FileResponse:
    return FileResponse(STATIC_DIR / "top_candidates.html")


@app.get("/candidate-profiles")
def candidate_profiles_page() -> FileResponse:
    return FileResponse(STATIC_DIR / "candidate_profiles.html")


@app.get("/candidate-ratings")
def candidate_ratings_page() -> FileResponse:
    return FileResponse(STATIC_DIR / "candidate_ratings.html")


@app.get("/ratings-audits")
def ratings_audits_page() -> FileResponse:
    return FileResponse(STATIC_DIR / "ratings_audits.html")


@app.get("/feedback-questionnaire")
def feedback_questionnaire_page() -> FileResponse:
    return FileResponse(STATIC_DIR / "feedback_questionnaire.html")


@app.get("/feedback-confirmation")
def feedback_confirmation_page() -> FileResponse:
    return FileResponse(STATIC_DIR / "feedback_confirmation.html")


@app.get("/cbr-scoring")
def cbr_scoring_page() -> FileResponse:
    return FileResponse(STATIC_DIR / "cbr_scoring.html")


@app.get("/ntnu-knowledge-base")
def ntnu_knowledge_base_page() -> FileResponse:
    return FileResponse(STATIC_DIR / "ntnu_knowledge_base.html")


@app.get("/api/overview")
def overview() -> dict[str, Any]:
    data = load_job_data()
    default_requirements, job_reqs, ntnu_reqs = _build_default_screening_requirements(str(data.get("job_ad", "")))
    return {
        "job_dir": str(DEFAULT_JOB_DIR.relative_to(BASE_DIR)),
        "source_path": data.get("source_path", ""),
        "job_ad_preview": data["job_ad"][:1200],
        "job_ad_full": data["job_ad"],
        "candidate_count": len(data["applications"]),
        "must_have_requirements": default_requirements,
        "must_have_requirements_job_ad": job_reqs,
        "must_have_requirements_ntnu": ntnu_reqs,
        "default_weights": {
            "education": 0.24,
            "experience": 0.28,
            "research_outputs": 0.22,
            "skills_and_methods": 0.26,
        },
        "quality_notes": [
            "CBR scores reflect patterns in past labelled cases — if those labels carried bias, the scores will too.",
            "LLM evaluation is opaque by default; always inspect the rationale, not just the shortlist.",
            "Head-to-head comparisons can introduce order and fatigue effects; complete enough rounds for the ranking to stabilise.",
            "Fairness flags are prompts for reflection, not verdicts — the evaluator is accountable for every decision.",
            "NTNU policy checks cover only documents in the local knowledge base; verify against current official sources before finalising.",
            "All automated outputs are decision support. No stage of this tool replaces human judgment.",
        ],
    }


@app.get("/api/ntnu-knowledge-base")
def ntnu_knowledge_base_list() -> dict[str, Any]:
    return {
        "documents": _load_ntnu_knowledge_base_summary(),
    }


@app.get("/api/ntnu-knowledge-base/{filename}")
def ntnu_knowledge_base_document(filename: str) -> dict[str, Any]:
    safe_name = Path(str(filename or "")).name
    if not safe_name or safe_name != filename or not safe_name.endswith(".txt"):
        raise HTTPException(status_code=400, detail="Invalid document name")

    doc_path = NTNU_KNOWLEDGE_BASE_DIR / safe_name
    if not doc_path.exists() or not doc_path.is_file():
        raise HTTPException(status_code=404, detail="Document not found")

    content = _read_text(doc_path)
    return {
        "filename": safe_name,
        "summary": _summarize_ntnu_doc(content),
        "raw_text": content,
    }


@app.get("/api/config-prompts")
def config_prompts() -> dict[str, Any]:
    return _load_prompt_preview_payload()


@app.post("/api/run")
def run_pipeline(config: RunConfig) -> dict[str, Any]:
    response = build_run(config)
    _append_api_event_log(
        route="/api/run",
        event_type="request_response",
        inputs=config.model_dump(),
        outputs=response,
    )
    return response


@app.post("/api/llm-evaluate")
def llm_evaluate(payload: LLMEvaluatorRunRequest) -> dict[str, Any]:
    llm_config = payload.llm_config

    data = load_job_data()
    all_candidates = _build_llm_candidate_payload(data)
    excluded_ids = _excluded_candidate_ids_from_config(payload.run_config)
    if excluded_ids:
        all_candidates = [
            row
            for row in all_candidates
            if str(row.get("application_id", "")).strip() not in excluded_ids
        ]

    evaluation = evaluate_with_llm_selection(
        job_ad=data.get("job_ad", ""),
        all_candidates=all_candidates,
        model=llm_config.model,
        key_name=llm_config.key_name,
        config_path=llm_config.config_path,
        prompt_dir=llm_config.prompt_dir,
        additional_instructions=llm_config.additional_instructions,
    )

    response = {
        "meta": {
            "job_dir": str(DEFAULT_JOB_DIR.relative_to(BASE_DIR)),
            "source_path": data.get("source_path", ""),
            "candidate_count": len(all_candidates),
            "llm_model": llm_config.model,
        },
        "llm_selection": evaluation,
    }
    _append_api_event_log(
        route="/api/llm-evaluate",
        event_type="request_response",
        inputs=payload.model_dump(),
        outputs=response,
    )
    return response


@app.post("/api/llm-evaluate-stream")
def llm_evaluate_stream(payload: LLMEvaluatorRunRequest) -> StreamingResponse:
    llm_config = payload.llm_config

    data = load_job_data()
    all_candidates = _build_llm_candidate_payload(data)
    excluded_ids = _excluded_candidate_ids_from_config(payload.run_config)
    if excluded_ids:
        all_candidates = [
            row
            for row in all_candidates
            if str(row.get("application_id", "")).strip() not in excluded_ids
        ]

    return _stream_response_from_events(
        lambda: stream_with_llm_selection(
            job_ad=data.get("job_ad", ""),
            all_candidates=all_candidates,
            model=llm_config.model,
            key_name=llm_config.key_name,
            config_path=llm_config.config_path,
            prompt_dir=llm_config.prompt_dir,
            additional_instructions=llm_config.additional_instructions,
        ),
        log_route="/api/llm-evaluate-stream",
        log_inputs=payload.model_dump(),
    )


@app.post("/api/preselection")
def preselection_run(payload: PreselectionRunRequest) -> dict[str, Any]:
    config = payload.run_config
    screening_cfg = config.initial_screening if isinstance(config.initial_screening, dict) else {}

    data = load_job_data()
    all_candidates = _build_llm_candidate_payload(data)
    requirements = [
        str(item or "").strip()
        for item in (payload.requirements or screening_cfg.get("requirements") or [])
        if str(item or "").strip()
    ]
    ntnu_context_docs = _select_ntnu_docs_for_preselection()
    if not requirements:
        requirements, _, _ = _build_default_screening_requirements(str(data.get("job_ad", "")))

    evaluation = evaluate_with_llm_preselection(
        job_ad=str(data.get("job_ad", "")),
        requirements=requirements,
        all_candidates=all_candidates,
        model=str(screening_cfg.get("model", "gpt-5.4-mini")),
        key_name=str(screening_cfg.get("key_name", "OPENAI_KEY")),
        config_path=str(screening_cfg.get("config_path", "prompts/CONFIG.txt")),
        prompt_path=str(screening_cfg.get("prompt_path", "prompts/eval_agents/pre-screening.txt")),
        additional_instructions=str(screening_cfg.get("additional_instructions", "")),
        ntnu_context_docs=ntnu_context_docs,
    )

    response = {
        "meta": {
            "job_dir": str(DEFAULT_JOB_DIR.relative_to(BASE_DIR)),
            "source_path": data.get("source_path", ""),
            "candidate_count": len(all_candidates),
            "requirements_count": len(requirements),
            "ntnu_context_doc_count": len(ntnu_context_docs),
            "llm_model": evaluation.get("model", "gpt-5.4-mini"),
        },
        "requirements": requirements,
        "ntnu_context_docs": [
            {
                "filename": str(doc.get("filename", "")),
                "categories": doc.get("categories", []),
                "summary": str(doc.get("summary", "")),
            }
            for doc in ntnu_context_docs
        ],
        "preselection": {
            "omitted_candidates": evaluation.get("omitted_candidates", []),
            "considered_candidates": evaluation.get("considered_candidates", len(all_candidates)),
            "response_text": evaluation.get("response_text", ""),
            "fallback_used": evaluation.get("fallback_used", False),
            "fallback_reason": evaluation.get("fallback_reason"),
        },
    }
    _append_api_event_log(
        route="/api/preselection",
        event_type="request_response",
        inputs=payload.model_dump(),
        outputs=response,
    )
    return response


@app.post("/api/fairness/candidate-review")
def fairness_candidate_review(payload: FairnessCandidateReviewRequest) -> dict[str, Any]:
    config = payload.fairness_config
    evaluation = run_candidate_review(
        job_description=_job_description_or_empty(),
        candidate_materials=payload.candidate_materials,
        candidate_summary=payload.candidate_summary,
        sensitive_attributes=payload.sensitive_attributes,
        ratings=payload.ratings,
        notes=payload.notes,
        model=config.model,
        key_name=config.key_name,
        config_path=config.config_path,
        prompt_dir=config.prompt_dir,
        additional_instructions=config.additional_instructions,
    )
    response = {
        "candidate_id": payload.candidate_id,
        "review": evaluation.get("result", {}),
        "meta": _model_meta(evaluation, config.model),
    }
    _append_api_event_log(
        route="/api/fairness/candidate-review",
        event_type="request_response",
        inputs=payload.model_dump(),
        outputs={**response, "response_text": evaluation.get("response_text", "")},
    )
    return response


@app.post("/api/fairness/candidate-review-stream")
def fairness_candidate_review_stream(payload: FairnessCandidateReviewRequest) -> StreamingResponse:
    config = payload.fairness_config

    return _stream_response_from_events(
        lambda: stream_candidate_review(
            job_description=_job_description_or_empty(),
            candidate_materials=payload.candidate_materials,
            candidate_summary=payload.candidate_summary,
            sensitive_attributes=payload.sensitive_attributes,
            ratings=payload.ratings,
            notes=payload.notes,
            model=config.model,
            key_name=config.key_name,
            config_path=config.config_path,
            prompt_dir=config.prompt_dir,
            additional_instructions=config.additional_instructions,
        ),
        log_route="/api/fairness/candidate-review-stream",
        log_inputs=payload.model_dump(),
    )


@app.post("/api/fairness/qa")
def fairness_qa(payload: FairnessQARequest) -> dict[str, Any]:
    config = payload.fairness_config
    evaluation = run_fairness_qa(
        user_question=payload.question,
        candidate_or_selection_context=payload.optional_context,
        model=config.model,
        key_name=config.key_name,
        config_path=config.config_path,
        prompt_dir=config.prompt_dir,
        additional_instructions=config.additional_instructions,
    )
    response = {
        "response": evaluation.get("result", {}),
        "meta": _model_meta(evaluation, config.model),
    }
    _append_api_event_log(
        route="/api/fairness/qa",
        event_type="request_response",
        inputs=payload.model_dump(),
        outputs={**response, "response_text": evaluation.get("response_text", "")},
    )
    return response


@app.post("/api/fairness/qa-stream")
def fairness_qa_stream(payload: FairnessQARequest) -> StreamingResponse:
    config = payload.fairness_config

    return _stream_response_from_events(
        lambda: stream_fairness_qa(
            user_question=payload.question,
            candidate_or_selection_context=payload.optional_context,
            model=config.model,
            key_name=config.key_name,
            config_path=config.config_path,
            prompt_dir=config.prompt_dir,
            additional_instructions=config.additional_instructions,
        ),
        log_route="/api/fairness/qa-stream",
        log_inputs=payload.model_dump(),
    )


@app.post("/api/fairness/cross-candidate-audit")
def fairness_cross_candidate_audit(payload: FairnessCrossCandidateAuditRequest) -> dict[str, Any]:
    config = payload.fairness_config
    evaluation = run_cross_candidate_audit(
        job_description=_job_description_or_empty(),
        candidate_metadata=payload.candidate_metadata,
        sensitive_attributes=payload.sensitive_attributes,
        ratings=payload.ratings,
        rationales=payload.rationales,
        model=config.model,
        key_name=config.key_name,
        config_path=config.config_path,
        prompt_dir=config.prompt_dir,
        additional_instructions=config.additional_instructions,
    )
    response = {
        "audit": evaluation.get("result", {}),
        "meta": _model_meta(evaluation, config.model),
    }
    _append_api_event_log(
        route="/api/fairness/cross-candidate-audit",
        event_type="request_response",
        inputs=payload.model_dump(),
        outputs={**response, "response_text": evaluation.get("response_text", "")},
    )
    return response


@app.post("/api/fairness/cross-candidate-audit-stream")
def fairness_cross_candidate_audit_stream(payload: FairnessCrossCandidateAuditRequest) -> StreamingResponse:
    config = payload.fairness_config

    return _stream_response_from_events(
        lambda: stream_cross_candidate_audit(
            job_description=_job_description_or_empty(),
            candidate_metadata=payload.candidate_metadata,
            sensitive_attributes=payload.sensitive_attributes,
            ratings=payload.ratings,
            rationales=payload.rationales,
            model=config.model,
            key_name=config.key_name,
            config_path=config.config_path,
            prompt_dir=config.prompt_dir,
            additional_instructions=config.additional_instructions,
        ),
        log_route="/api/fairness/cross-candidate-audit-stream",
        log_inputs=payload.model_dump(),
    )


@app.post("/api/ntnu/candidate-review")
def ntnu_candidate_review(payload: NTNUInitialReviewRequest) -> dict[str, Any]:
    config = payload.ntnu_config
    evaluation = run_ntnu_initial_review(
        job_ad=_job_description_or_empty(),
        candidate=_ntnu_candidate_payload(payload),
        model=config.model,
        key_name=config.key_name,
        config_path=config.config_path,
        prompt_dir=config.prompt_dir,
        additional_instructions=config.additional_instructions,
    )
    response = {
        "candidate_id": payload.candidate_id,
        "review": evaluation.get("result", {}),
        "routed_categories": evaluation.get("routed_categories", []),
        "retrieved_files": evaluation.get("retrieved_files", []),
        "meta": _model_meta(evaluation, config.model),
    }
    _append_api_event_log(
        route="/api/ntnu/candidate-review",
        event_type="request_response",
        inputs=payload.model_dump(),
        outputs={**response, "response_text": evaluation.get("response_text", "")},
    )
    return response


@app.post("/api/ntnu/candidate-review-stream")
def ntnu_candidate_review_stream(payload: NTNUInitialReviewRequest) -> StreamingResponse:
    config = payload.ntnu_config

    return _stream_response_from_events(
        lambda: stream_ntnu_initial_review(
            job_ad=_job_description_or_empty(),
            candidate=_ntnu_candidate_payload(payload),
            model=config.model,
            key_name=config.key_name,
            config_path=config.config_path,
            prompt_dir=config.prompt_dir,
            additional_instructions=config.additional_instructions,
        ),
        log_route="/api/ntnu/candidate-review-stream",
        log_inputs=payload.model_dump(),
    )


@app.post("/api/ntnu/qa")
def ntnu_qa(payload: NTNUQARequest) -> dict[str, Any]:
    config = payload.ntnu_config
    evaluation = run_ntnu_policy_qa(
        question=payload.question,
        chat_history=payload.chat_history,
        job_ad=_job_description_or_empty(),
        candidate=payload.candidate_context or {},
        model=config.model,
        key_name=config.key_name,
        config_path=config.config_path,
        prompt_dir=config.prompt_dir,
        additional_instructions=config.additional_instructions,
    )
    response = {
        "response": evaluation.get("result", {}),
        "routed_categories": evaluation.get("routed_categories", []),
        "retrieved_files": evaluation.get("retrieved_files", []),
        "meta": _model_meta(evaluation, config.model),
    }
    _append_api_event_log(
        route="/api/ntnu/qa",
        event_type="request_response",
        inputs=payload.model_dump(),
        outputs={**response, "response_text": evaluation.get("response_text", "")},
    )
    return response


@app.post("/api/ntnu/qa-stream")
def ntnu_qa_stream(payload: NTNUQARequest) -> StreamingResponse:
    config = payload.ntnu_config

    job_ad = _job_description_or_empty()
    candidate = payload.candidate_context or {}
    return _stream_response_from_events(
        lambda: stream_ntnu_policy_qa(
            question=payload.question,
            chat_history=payload.chat_history,
            job_ad=job_ad,
            candidate=candidate,
            model=config.model,
            key_name=config.key_name,
            config_path=config.config_path,
            prompt_dir=config.prompt_dir,
            additional_instructions=config.additional_instructions,
        ),
        log_route="/api/ntnu/qa-stream",
        log_inputs=payload.model_dump(),
    )


@app.post("/api/ntnu/final-audit")
def ntnu_final_audit(payload: NTNUFinalAuditRequest) -> dict[str, Any]:
    config = payload.ntnu_config
    evaluation = run_ntnu_final_audit(
        job_ad=_job_description_or_empty(),
        selected_candidates=payload.selected_candidates,
        ratings=payload.ratings,
        rationales=payload.rationales,
        sensitive_attributes=payload.sensitive_attributes,
        model=config.model,
        key_name=config.key_name,
        config_path=config.config_path,
        prompt_dir=config.prompt_dir,
        additional_instructions=config.additional_instructions,
    )
    response = {
        "audit": evaluation.get("result", {}),
        "routed_categories": evaluation.get("routed_categories", []),
        "retrieved_files": evaluation.get("retrieved_files", []),
        "meta": _model_meta(evaluation, config.model),
    }
    _append_api_event_log(
        route="/api/ntnu/final-audit",
        event_type="request_response",
        inputs=payload.model_dump(),
        outputs={**response, "response_text": evaluation.get("response_text", "")},
    )
    return response


@app.post("/api/ntnu/final-audit-stream")
def ntnu_final_audit_stream(payload: NTNUFinalAuditRequest) -> StreamingResponse:
    config = payload.ntnu_config

    return _stream_response_from_events(
        lambda: stream_ntnu_final_audit(
            job_ad=_job_description_or_empty(),
            selected_candidates=payload.selected_candidates,
            ratings=payload.ratings,
            rationales=payload.rationales,
            sensitive_attributes=payload.sensitive_attributes,
            model=config.model,
            key_name=config.key_name,
            config_path=config.config_path,
            prompt_dir=config.prompt_dir,
            additional_instructions=config.additional_instructions,
        ),
        log_route="/api/ntnu/final-audit-stream",
        log_inputs=payload.model_dump(),
    )


@app.post("/api/log-ranking")
def log_ranking(payload: RankingLogPayload) -> dict[str, Any]:
    _append_ranking_log(payload)
    return {
        "ok": True,
        "path": str(RANKING_LOG_PATH.relative_to(BASE_DIR)),
        "entries_logged": 1,
    }


@app.post("/api/log-stage")
def log_stage(payload: StageEventPayload) -> dict[str, Any]:
    _append_stage_event_log(payload)
    return {
        "ok": True,
        "path": str(WORKFLOW_STAGE_LOG_PATH.relative_to(BASE_DIR)),
        "entries_logged": 1,
    }


def _submit_user_feedback(payload: UserFeedbackSubmissionPayload, route_path: str) -> dict[str, Any]:
    _append_user_feedback_log(payload)
    response = {
        "ok": True,
        "path": str(USER_FEEDBACK_LOG_PATH.relative_to(BASE_DIR)),
        "entries_logged": 1,
        "workflow_session_id": payload.workflow_session_id,
    }
    _append_api_event_log(
        route=route_path,
        event_type="request_response",
        inputs=payload.model_dump(),
        outputs=response,
    )
    return response


@app.post("/api/user-feedback")
def submit_user_feedback(payload: UserFeedbackSubmissionPayload) -> dict[str, Any]:
    return _submit_user_feedback(payload, "/api/user-feedback")


@app.post("/api/hr-feedback")
def submit_hr_feedback(payload: UserFeedbackSubmissionPayload) -> dict[str, Any]:
    # Backward-compatible alias retained for older clients.
    return _submit_user_feedback(payload, "/api/hr-feedback")


@app.post("/api/h2h/compute")
def h2h_compute(payload: H2HComputeRequest) -> dict[str, Any]:
    response = compute_h2h_state(
        candidates=payload.candidates,
        comparisons=payload.comparisons,
        eta=payload.eta,
        id_key="application_id",
        exclude_top6_vs_top6=payload.exclude_top6_vs_top6,
    )
    _append_api_event_log(
        route="/api/h2h/compute",
        event_type="request_response",
        inputs=payload.model_dump(),
        outputs=response,
    )
    return response


@app.post("/api/h2h/initial-selection")
def h2h_initial_selection(payload: H2HInitialSelectionRequest) -> dict[str, Any]:
    selection = build_initial_selection(
        all_candidates=payload.all_candidates,
        cbr_top_ids=payload.cbr_top_ids,
        llm_top_ids=payload.llm_top_ids,
        pool_size=max(2, int(payload.pool_size or 10)),
        rng_seed=int(payload.rng_seed or 42),
        id_key="application_id",
    )
    response = {
        "initial_selection": selection,
        "pool_size": len(selection),
    }
    _append_api_event_log(
        route="/api/h2h/initial-selection",
        event_type="request_response",
        inputs=payload.model_dump(),
        outputs=response,
    )
    return response


@app.post("/api/snapshot/view-model")
def snapshot_view_model(payload: SnapshotViewModelRequest) -> dict[str, Any]:
    response = build_snapshot_view_model(
        ranked_candidates=payload.ranked_candidates,
        llm_selection=payload.llm_selection,
        pool_size=max(2, int(payload.pool_size or 10)),
        rng_seed=int(payload.rng_seed or 42),
    )
    _append_api_event_log(
        route="/api/snapshot/view-model",
        event_type="request_response",
        inputs=payload.model_dump(),
        outputs=response,
    )
    return response


@app.get("/api/candidate-profile/{application_id}")
def candidate_profile(application_id: str) -> dict[str, Any]:
    data = load_job_data()
    for row in data.get("applications", []):
        if not isinstance(row, dict):
            continue
        row_id = str(row.get("application_id", "")).strip()
        if row_id != str(application_id).strip():
            continue

        materials = row.get("materials") if isinstance(row.get("materials"), dict) else {}
        summary = row.get("summary") if isinstance(row.get("summary"), str) else ""
        cbr_features_raw = row.get("cbr_features") if isinstance(row.get("cbr_features"), dict) else {}
        cbr_features = normalize_cbr_features_payload(cbr_features_raw)
        cbr_breakdown = row.get("cbr_breakdown") if isinstance(row.get("cbr_breakdown"), dict) else {}
        scores = row.get("scores") if isinstance(row.get("scores"), dict) else {}

        # Ensure profile payload has canonical CBR feature names and a computed breakdown,
        # even when source rows do not include precomputed breakdown/scores.
        if not cbr_breakdown:
            computed = build_candidate_features(
                {
                    "application_id": row_id,
                    "summary": summary,
                    "cbr_features": cbr_features,
                },
                scoring_config=None,
            )
            computed_breakdown = computed.get("cbr_breakdown") if isinstance(computed.get("cbr_breakdown"), dict) else {}
            if computed_breakdown:
                cbr_breakdown = computed_breakdown

        sensitive_attributes = (
            cbr_features.get("sensitive_attributes_not_for_evaluation")
            if isinstance(cbr_features.get("sensitive_attributes_not_for_evaluation"), dict)
            else {}
        )
        response = {
            "application_id": row_id,
            "source_seed_candidate_name": row.get("source_seed_candidate_name"),
            "variant_assigned_name": row.get("variant_assigned_name"),
            "summary_text": summary,
            "sensitive_attributes": sensitive_attributes,
            "materials": materials,
            "cbr_features": cbr_features,
            "cbr_breakdown": cbr_breakdown,
            "scores": scores,
        }
        _append_api_event_log(
            route="/api/candidate-profile/{application_id}",
            event_type="request_response",
            inputs={"application_id": application_id},
            outputs=response,
        )
        return response

    raise HTTPException(status_code=404, detail=f"Application not found: {application_id}")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=True)
