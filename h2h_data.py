from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from urllib import request


def resolve_repo_root() -> Path:
    cwd = Path.cwd().resolve()
    candidates = [cwd, cwd.parent]
    for candidate in candidates:
        if (candidate / "src" / "outputs" / "jobs").exists():
            return candidate
    return cwd


def normalize_weights(weights: dict[str, float]) -> dict[str, float]:
    normalized = {
        "education": max(0.0, float(weights.get("education", 0.0))),
        "experience": max(0.0, float(weights.get("experience", 0.0))),
        "research_outputs": max(0.0, float(weights.get("research_outputs", 0.0))),
        "skills_and_methods": max(0.0, float(weights.get("skills_and_methods", 0.0))),
    }
    total = sum(normalized.values()) or 1.0
    return {key: value / total for key, value in normalized.items()}


def _format_subfeatures(sub: dict[str, Any]) -> list[str]:
    lines: list[str] = []
    if not isinstance(sub, dict):
        return ["- No subfeature details available."]

    for category in ["education", "experience", "research_outputs", "skills_and_methods"]:
        values = sub.get(category, {})
        if not isinstance(values, dict):
            continue
        present = [f"{k}: {v}" for k, v in values.items() if v not in (None, "")]
        if present:
            lines.append(f"- {category}: " + "; ".join(present[:3]))

    if not lines:
        lines.append("- No populated subfeature values found.")
    return lines


def _coerce_float(*values: Any) -> float:
    for value in values:
        if value in (None, ""):
            continue
        try:
            return float(value)
        except (TypeError, ValueError):
            continue
    return 0.0


def _normalize_candidate(
    *,
    application_id: str,
    name: str,
    summary: str,
    baseline_score: float,
) -> dict[str, Any]:
    return {
        "id": application_id,
        "application_id": application_id,
        "name": name,
        "summary": summary,
        "baseline_score": float(baseline_score),
    }


def load_candidates_from_local(job_name: str = "STS_PhD_Position_2026") -> list[dict[str, Any]]:
    repo_root = resolve_repo_root()
    app_path = repo_root / "src" / "outputs" / "jobs" / job_name / f"{job_name}_applications_with_summaries.json"
    if not app_path.exists():
        raise FileNotFoundError(f"Applications file not found: {app_path}")

    payload = json.loads(app_path.read_text(encoding="utf-8"))
    applications = payload.get("applications", []) if isinstance(payload, dict) else []

    rows: list[dict[str, Any]] = []
    for idx, app in enumerate(applications):
        if not isinstance(app, dict):
            continue

        app_id = str(app.get("application_id") or f"application_{idx + 1}")
        raw_summary = app.get("summary")
        parsed_summary: dict[str, object] = {}
        if isinstance(raw_summary, dict):
            parsed_summary = raw_summary
        elif isinstance(raw_summary, str) and raw_summary.strip():
            try:
                maybe_json = json.loads(raw_summary)
                if isinstance(maybe_json, dict):
                    parsed_summary = maybe_json
            except json.JSONDecodeError:
                parsed_summary = {}

        displayed_name = str(
            parsed_summary.get("application_id")
            or app.get("source_seed_candidate_name")
            or app_id
        )

        strengths = parsed_summary.get("evidenced_strengths", [])
        limitations = parsed_summary.get("evidenced_limitations", [])
        takeaways = parsed_summary.get("reviewer_takeaways", [])

        summary_lines: list[str] = []
        if isinstance(strengths, list):
            summary_lines.extend([f"- Strength: {item}" for item in strengths[:2] if isinstance(item, str)])
        if isinstance(limitations, list):
            summary_lines.extend([f"- Limitation: {item}" for item in limitations[:2] if isinstance(item, str)])
        if isinstance(takeaways, list):
            summary_lines.extend([f"- Takeaway: {item}" for item in takeaways[:1] if isinstance(item, str)])
        if not summary_lines:
            summary_lines.append("- No parsed summary fields available for this application.")

        top_scores = app.get("scores", {}) if isinstance(app.get("scores"), dict) else {}
        summary_scores = parsed_summary.get("scores", {}) if isinstance(parsed_summary.get("scores"), dict) else {}
        baseline_score = _coerce_float(
            app.get("baseline_score"),
            top_scores.get("combined"),
            top_scores.get("cbr"),
            parsed_summary.get("baseline_score"),
            parsed_summary.get("combined_score"),
            summary_scores.get("combined"),
            summary_scores.get("cbr"),
            0.0,
        )

        rows.append(
            _normalize_candidate(
                application_id=app_id,
                name=displayed_name,
                summary="\n".join(summary_lines),
                baseline_score=baseline_score,
            )
        )

    return rows


def load_candidates_from_api(
    base_url: str,
    cbr_weights: dict[str, float],
    pool_size: int,
    timeout_seconds: int = 15,
) -> list[dict[str, Any]]:
    payload = json.dumps(
        {
            "cbr_weights": normalize_weights(cbr_weights),
            "extra_criteria": [],
            "max_matchups": 20,
        }
    ).encode("utf-8")

    req = request.Request(
        f"{base_url.rstrip('/')}/api/run",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    with request.urlopen(req, timeout=timeout_seconds) as resp:
        data = json.loads(resp.read().decode("utf-8"))

    pool = data.get("pool", []) if isinstance(data, dict) else []
    rows: list[dict[str, Any]] = []
    for item in pool[:pool_size]:
        if not isinstance(item, dict):
            continue

        application_id = str(item.get("application_id") or item.get("name") or "application")
        name = str(item.get("name") or application_id)
        score = (item.get("scores") or {}).get("cbr")
        baseline_score = _coerce_float((item.get("scores") or {}).get("combined"), score, 0.0)
        sub = (((item.get("cbr_breakdown") or {}).get("subfeatures")) or {})
        summary_lines = [f"- CBR score: {score}"] if score is not None else []
        summary_lines.extend(_format_subfeatures(sub if isinstance(sub, dict) else {}))

        rows.append(
            _normalize_candidate(
                application_id=application_id,
                name=name,
                summary="\n".join(summary_lines),
                baseline_score=baseline_score,
            )
        )

    return rows
