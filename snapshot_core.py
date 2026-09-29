from __future__ import annotations

from typing import Any

try:
    from webtool.h2h_core import build_initial_selection
except ImportError:
    from h2h_core import build_initial_selection  # type: ignore


def _normalize_ranked_items(items: Any) -> list[dict[str, Any]]:
    if not isinstance(items, list):
        return []

    normalized: list[dict[str, Any]] = []
    for row in items:
        if not isinstance(row, dict):
            continue
        application_id = str(
            row.get("application_id")
            or row.get("candidate_id")
            or row.get("id")
            or ""
        ).strip()
        if not application_id:
            continue
        entry = dict(row)
        entry["application_id"] = application_id
        normalized.append(entry)
    return normalized


def build_snapshot_view_model(
    ranked_candidates: list[dict[str, Any]],
    llm_selection: dict[str, Any] | None,
    pool_size: int = 10,
    rng_seed: int = 42,
) -> dict[str, Any]:
    ranked = [row for row in ranked_candidates if isinstance(row, dict)]
    cbr_top = ranked[: max(2, int(pool_size))]

    llm_data = llm_selection if isinstance(llm_selection, dict) else {}
    shortlist = _normalize_ranked_items(llm_data.get("shortlist"))
    longlist = _normalize_ranked_items(llm_data.get("longlist"))

    shortlist_ids = {row["application_id"] for row in shortlist}
    longlist = [row for row in longlist if row["application_id"] not in shortlist_ids]

    llm_top_ids = [
        *[row["application_id"] for row in shortlist],
        *[row["application_id"] for row in longlist],
    ]

    initial_selection = build_initial_selection(
        all_candidates=ranked,
        cbr_top_ids=[str(row.get("application_id") or "").strip() for row in cbr_top],
        llm_top_ids=llm_top_ids,
        pool_size=max(2, int(pool_size)),
        rng_seed=int(rng_seed),
        id_key="application_id",
    )

    return {
        "cbr_top": cbr_top,
        "llm_selection": {
            **llm_data,
            "shortlist": shortlist,
            "longlist": longlist,
        },
        "initial_selection": initial_selection,
    }
