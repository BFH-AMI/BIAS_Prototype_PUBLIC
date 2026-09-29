from __future__ import annotations

import copy
import random
from typing import Any


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None or value == "":
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _normalize_pair(pair: tuple[str, str] | list[str]) -> tuple[str, str]:
    left = str(pair[0])
    right = str(pair[1])
    return tuple(sorted((left, right)))


def _llm_label_score(status: Any) -> float | None:
    txt = str(status or "").strip().lower()
    if txt == "shortlist":
        return 1.0
    if txt == "longlist":
        return 0.6
    if txt == "reject":
        return 0.2
    return None


def compute_baseline_score(candidate: dict[str, Any]) -> float:
    cbr_score = _safe_float(
        candidate.get("backend_score", candidate.get("cbr_score", ((candidate.get("scores") or {}).get("cbr")))),
        0.0,
    )
    llm_score = candidate.get("llm_label_score")
    if llm_score is None:
        llm_score = _llm_label_score(candidate.get("llm_status"))
    if llm_score is None:
        return cbr_score
    total = (cbr_score + float(llm_score)) / 2.0
    return cbr_score if total == 0 else total


def build_initial_selection(
    all_candidates: list[dict[str, Any]],
    cbr_top_ids: list[str],
    llm_top_ids: list[str],
    pool_size: int = 10,
    rng_seed: int = 42,
    id_key: str = "application_id",
) -> list[dict[str, Any]]:
    by_id = {
        str(candidate.get(id_key) or "").strip(): candidate
        for candidate in all_candidates
        if str(candidate.get(id_key) or "").strip()
    }

    cbr_top = [cid for cid in (str(i or "").strip() for i in cbr_top_ids or []) if cid in by_id]
    llm_top = [cid for cid in (str(i or "").strip() for i in llm_top_ids or []) if cid in by_id]

    cbr_set = set(cbr_top)
    llm_set = set(llm_top)
    selected_ids: list[str] = []

    for candidate_id in cbr_top:
        if candidate_id in llm_set and candidate_id not in selected_ids:
            selected_ids.append(candidate_id)

    cbr_remaining = [cid for cid in cbr_top if cid not in selected_ids]
    llm_remaining = [cid for cid in llm_top if cid not in selected_ids]
    turn = 0

    while len(selected_ids) < 8 and (cbr_remaining or llm_remaining):
        primary = cbr_remaining if turn % 2 == 0 else llm_remaining
        secondary = llm_remaining if turn % 2 == 0 else cbr_remaining
        if primary:
            selected_ids.append(primary.pop(0))
        elif secondary:
            selected_ids.append(secondary.pop(0))
        else:
            break
        turn += 1

    remaining_pool = [
        str(candidate.get(id_key) or "").strip()
        for candidate in all_candidates
        if str(candidate.get(id_key) or "").strip() and str(candidate.get(id_key) or "").strip() not in selected_ids
    ]
    wildcard_ids: set[str] = set()
    rng = random.Random(int(rng_seed))
    rng.shuffle(remaining_pool)
    for candidate_id in remaining_pool:
        if len(selected_ids) >= pool_size:
            break
        selected_ids.append(candidate_id)
        wildcard_ids.add(candidate_id)

    output: list[dict[str, Any]] = []
    for candidate_id in selected_ids[:pool_size]:
        source = copy.deepcopy(by_id[candidate_id])
        source_tags = set(source.get("source_tags") or [])
        if candidate_id in cbr_set:
            source_tags.add("cbr_top10")
        if candidate_id in llm_set:
            source_tags.add("llm_top10")
        if candidate_id in cbr_set and candidate_id in llm_set:
            source_tags.add("cbr_llm_overlap")
        if candidate_id in wildcard_ids:
            source_tags.add("wildcard")

        llm_rank = llm_top.index(candidate_id) if candidate_id in llm_set else -1
        source["backend_score"] = _safe_float(
            source.get("backend_score", source.get("cbr_score", ((source.get("scores") or {}).get("cbr")))),
            0.0,
        )
        source["llm_status"] = "shortlist" if llm_rank >= 0 and llm_rank < 5 else ("longlist" if llm_rank >= 0 else "none")
        source["llm_rank"] = llm_rank + 1 if llm_rank >= 0 else None
        source["llm_label_score"] = _llm_label_score(source.get("llm_status"))
        source["baseline_score"] = compute_baseline_score(source)
        source["source_tags"] = sorted(source_tags)
        source.setdefault("selection_strategy", "combined_cbr_llm_initial_10")
        source.setdefault("top_neighbors", ((source.get("cbr_breakdown") or {}).get("retrieval") or {}).get("top_neighbors", []))
        output.append(source)

    return output


def fit_scores(
    comparisons: list[dict[str, Any]],
    candidates: list[dict[str, Any]],
    eta: float = 0.1,
    id_key: str = "application_id",
) -> dict[str, float]:
    learning_rate = max(0.01, min(0.5, _safe_float(eta, 0.05)))
    scores: dict[str, float] = {}

    for candidate in candidates:
        candidate_id = str(candidate.get(id_key) or "").strip()
        if not candidate_id:
            continue
        baseline = candidate.get("baseline_score")
        if baseline is None:
            baseline = compute_baseline_score(candidate)
        scores[candidate_id] = _safe_float(baseline, 0.0)

    for comparison in comparisons or []:
        winner = str(comparison.get("winner") or "").strip()
        loser = str(comparison.get("loser") or "").strip()
        if not winner or not loser or winner == loser:
            continue
        if winner not in scores or loser not in scores:
            continue
        raw_diff = scores[winner] - scores[loser]
        diff = max(-30.0, min(30.0, raw_diff))
        p_wins = 1.0 / (1.0 + __import__("math").exp(-diff))
        delta = learning_rate * (1.0 - p_wins)
        scores[winner] += delta
        scores[loser] -= delta

    return scores


def _ranking_rows(
    candidates: list[dict[str, Any]],
    comparisons: list[dict[str, Any]],
    scores: dict[str, float],
    id_key: str,
) -> list[dict[str, Any]]:
    wins: dict[str, int] = {}
    losses: dict[str, int] = {}
    for candidate in candidates:
        candidate_id = str(candidate.get(id_key) or "").strip()
        if not candidate_id:
            continue
        wins[candidate_id] = 0
        losses[candidate_id] = 0

    for comparison in comparisons or []:
        winner = str(comparison.get("winner") or "").strip()
        loser = str(comparison.get("loser") or "").strip()
        if winner in wins:
            wins[winner] += 1
        if loser in losses:
            losses[loser] += 1

    by_id = {
        str(candidate.get(id_key) or "").strip(): candidate
        for candidate in candidates
        if str(candidate.get(id_key) or "").strip()
    }

    rows: list[dict[str, Any]] = []
    for candidate_id, score in scores.items():
        candidate = by_id.get(candidate_id, {})
        baseline = candidate.get("baseline_score")
        if baseline is None:
            baseline = compute_baseline_score(candidate)
        rows.append(
            {
                id_key: candidate_id,
                "application_id": candidate_id,
                "name": str(candidate.get("display_name") or candidate.get("name") or candidate_id),
                "baseline_score": round(_safe_float(baseline, 0.0), 3),
                "score": round(_safe_float(score, 0.0), 3),
                "wins": int(wins.get(candidate_id, 0)),
                "losses": int(losses.get(candidate_id, 0)),
                "comparisons": int(wins.get(candidate_id, 0) + losses.get(candidate_id, 0)),
            }
        )

    rows.sort(key=lambda row: row["score"], reverse=True)
    return rows


def choose_next_pair(
    candidates: list[dict[str, Any]],
    comparisons: list[dict[str, Any]],
    scores: dict[str, float],
    id_key: str = "application_id",
    exclude_top6_vs_top6: bool = True,
) -> tuple[list[str] | None, str]:
    ids = [str(candidate.get(id_key) or "").strip() for candidate in candidates]
    ids = [candidate_id for candidate_id in ids if candidate_id]
    if len(ids) < 2:
        return None, "insufficient_pool"

    ranked = sorted(ids, key=lambda cid: scores.get(cid, 0.0), reverse=True)
    top6 = set(ranked[:6])

    compared = {
        _normalize_pair([comparison.get("winner", ""), comparison.get("loser", "")])
        for comparison in comparisons or []
        if str(comparison.get("winner") or "").strip() and str(comparison.get("loser") or "").strip()
    }

    counts: dict[str, int] = {candidate_id: 0 for candidate_id in ids}
    for comparison in comparisons or []:
        winner = str(comparison.get("winner") or "").strip()
        loser = str(comparison.get("loser") or "").strip()
        if winner in counts:
            counts[winner] += 1
        if loser in counts:
            counts[loser] += 1

    def is_excluded(pair: list[str]) -> bool:
        if not exclude_top6_vs_top6:
            return False
        return pair[0] in top6 and pair[1] in top6

    def is_compared(pair: list[str]) -> bool:
        return _normalize_pair(pair) in compared

    def is_eligible(pair: list[str]) -> bool:
        return not is_excluded(pair) and not is_compared(pair)

    round_num = len(comparisons or [])

    untested = [candidate_id for candidate_id in ranked if counts.get(candidate_id, 0) == 0]
    if untested:
        challenger = untested[-1]
        opponents = (ranked[4:8] if len(ranked) >= 8 else ranked[:])
        opponents = [opponent for opponent in opponents if opponent != challenger]
        for opponent in opponents:
            pair = [challenger, opponent]
            if is_eligible(pair):
                return pair, "first_chance_audition"

    if round_num % 4 == 3:
        bottom = ranked[6:]
        gatekeepers = ranked[4:8]
        options: list[tuple[float, str, str]] = []
        for challenger in bottom:
            for opponent in gatekeepers:
                if challenger == opponent:
                    continue
                pair = [challenger, opponent]
                if not is_eligible(pair):
                    continue
                gap = abs(scores.get(opponent, 0.0) - scores.get(challenger, 0.0))
                options.append((gap, challenger, opponent))
        if options:
            options.sort(key=lambda item: item[0])
            _, left, right = options[0]
            return [left, right], "bottom_up_audition"

    outside = ranked[6:]
    cutoff_options: list[tuple[float, str, str]] = []
    for challenger in outside:
        for incumbent in ranked[:6]:
            pair = [challenger, incumbent]
            if not is_eligible(pair):
                continue
            gap = scores.get(incumbent, 0.0) - scores.get(challenger, 0.0)
            cutoff_options.append((gap, challenger, incumbent))
    if cutoff_options:
        cutoff_options.sort(key=lambda item: item[0])
        _, left, right = cutoff_options[0]
        return [left, right], "cutoff_challenge"

    all_remaining: list[tuple[float, str, str]] = []
    for idx, left in enumerate(ranked):
        for right in ranked[idx + 1 :]:
            pair = [left, right]
            if not is_eligible(pair):
                continue
            all_remaining.append((abs(scores.get(left, 0.0) - scores.get(right, 0.0)), left, right))
    if all_remaining:
        all_remaining.sort(key=lambda item: item[0])
        _, left, right = all_remaining[0]
        return [left, right], "closest_remaining"

    for idx, left in enumerate(ranked):
        for right in ranked[idx + 1 :]:
            pair = [left, right]
            if not is_excluded(pair):
                return pair, "fallback"

    return None, "no_eligible_pair"


def compute_h2h_state(
    candidates: list[dict[str, Any]],
    comparisons: list[dict[str, Any]],
    eta: float = 0.05,
    id_key: str = "application_id",
    exclude_top6_vs_top6: bool = True,
) -> dict[str, Any]:
    scores = fit_scores(comparisons, candidates, eta=eta, id_key=id_key)
    rows = _ranking_rows(candidates, comparisons, scores, id_key=id_key)

    ids = [str(candidate.get(id_key) or "").strip() for candidate in candidates]
    ids = [candidate_id for candidate_id in ids if candidate_id]
    ranked = sorted(ids, key=lambda cid: scores.get(cid, 0.0), reverse=True)
    top6 = set(ranked[:6])

    compared_pairs = {
        _normalize_pair([comparison.get("winner", ""), comparison.get("loser", "")])
        for comparison in comparisons or []
        if str(comparison.get("winner") or "").strip() and str(comparison.get("loser") or "").strip()
    }

    def is_excluded(pair: tuple[str, str]) -> bool:
        if not exclude_top6_vs_top6:
            return False
        return pair[0] in top6 and pair[1] in top6

    eligible_pairs: set[tuple[str, str]] = set()
    for idx, left in enumerate(ids):
        for right in ids[idx + 1 :]:
            pair = _normalize_pair((left, right))
            if is_excluded(pair):
                continue
            eligible_pairs.add(pair)

    completed_eligible_pairs = len([pair for pair in compared_pairs if pair in eligible_pairs])
    remaining_eligible_pairs = max(0, len(eligible_pairs) - completed_eligible_pairs)

    next_pair, mode = choose_next_pair(
        candidates,
        comparisons,
        scores,
        id_key=id_key,
        exclude_top6_vs_top6=exclude_top6_vs_top6,
    )
    return {
        "rows": rows,
        "scores": {k: round(v, 6) for k, v in scores.items()},
        "next_pair": next_pair,
        "mode": mode,
        "eligible_pair_count": len(eligible_pairs),
        "completed_eligible_pairs": completed_eligible_pairs,
        "remaining_eligible_pairs": remaining_eligible_pairs,
    }
