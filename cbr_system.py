from __future__ import annotations

from difflib import SequenceMatcher
import json
from typing import Any

try:
    from webtool.cbr_feature_scoring import (
        compute_cbr_category_scores,
        compute_cbr_feature_breakdown,
        normalize_cbr_features_payload,
        normalize_selected_subfeatures_config,
        warmup_background_embeddings,
    )
except ImportError:
    from cbr_feature_scoring import (  # type: ignore
        compute_cbr_category_scores,
        compute_cbr_feature_breakdown,
        normalize_cbr_features_payload,
        normalize_selected_subfeatures_config,
        warmup_background_embeddings,
    )


VALID_LABELS = {"shortlist", "longlist", "reject"}

LABEL_SCORES = {
    "shortlist": 1.0,
    "longlist": 0.6,
    "reject": 0.2,
}

SCORE_GROUPS = {
    "education": {
        "weight": 1.2,
        "columns": [
            "education__highest_degree_completed",
            "education__gpa_normalized_0_100",
            "education__master_thesis_grade_normalized_0_100",
            "education__bachelor_field",
            "education__master_field",
        ],
    },
    "experience": {
        "weight": 1.4,
        "columns": [
            "experience__years_research_experience",
            "experience__years_relevant_professional_experience",
            "experience__years_teaching_experience",
            "experience__career_gap_months",
            "experience__time_since_last_academic_activity_months",
        ],
    },
    "research_outputs": {
        "weight": 1.1,
        "columns": [
            "research_outputs__num_peer_reviewed_publications",
            "research_outputs__num_first_author_publications",
            "research_outputs__num_conference_outputs",
            "research_outputs__num_posters_or_extended_abstracts",
            "research_outputs__has_independent_research_output",
        ],
    },
    "skills_and_methods": {
        "weight": 1.3,
        "columns": [
            "skills_and_methods__has_quantitative_methods",
            "skills_and_methods__has_qualitative_methods",
            "skills_and_methods__has_programming_or_technical_skills",
            "skills_and_methods__num_programming_languages",
            "skills_and_methods__has_experimental_or_empirical_design",
            "skills_and_methods__english_level",
            "skills_and_methods__local_language_level",
        ],
    },
}


def _safe_float(value: Any) -> float | None:
    try:
        if value is None or value == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _clamp01(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


def _normalize_decision_label(label: Any) -> str | None:
    if not isinstance(label, str):
        return None

    txt = label.strip().lower()
    mapping = {
        "shortlist": "shortlist",
        "shortlisted": "shortlist",
        "short list": "shortlist",
        "longlist": "longlist",
        "longlisted": "longlist",
        "long list": "longlist",
        "reject": "reject",
        "rejected": "reject",
    }
    return mapping.get(txt)


def _flatten_dict(data: dict[str, Any], parent_key: str = "", separator: str = "__") -> dict[str, Any]:
    items: dict[str, Any] = {}
    for key, value in data.items():
        new_key = f"{parent_key}{separator}{key}" if parent_key else key
        if isinstance(value, dict):
            items.update(_flatten_dict(value, new_key, separator=separator))
        elif isinstance(value, list):
            items[new_key] = ", ".join(str(item) for item in value)
        elif isinstance(value, bool):
            items[new_key] = int(value)
        else:
            items[new_key] = value
    return items


def _pretty_label(key: str) -> str:
    return " ".join(part.capitalize() for part in str(key).replace("_", " ").split())


def _append_bullets(value: Any, lines: list[str], indent: int = 0) -> None:
    prefix = "  " * indent + "- "

    if isinstance(value, dict):
        for key, nested in value.items():
            label = _pretty_label(key)
            if isinstance(nested, (dict, list)):
                lines.append(f"{prefix}{label}:")
                _append_bullets(nested, lines, indent + 1)
            else:
                text = str(nested).strip() if nested is not None else ""
                if text:
                    lines.append(f"{prefix}{label}: {text}")
        return

    if isinstance(value, list):
        for item in value:
            if isinstance(item, (dict, list)):
                lines.append(f"{prefix}Item:")
                _append_bullets(item, lines, indent + 1)
            else:
                text = str(item).strip() if item is not None else ""
                if text:
                    lines.append(f"{prefix}{text}")
        return

    text = str(value).strip() if value is not None else ""
    if text:
        lines.append(f"{prefix}{text}")


def _extract_summary_text(summary_raw: Any) -> str:
    parsed: dict[str, Any] | None = None
    if isinstance(summary_raw, dict):
        parsed = summary_raw
    elif isinstance(summary_raw, str) and summary_raw.strip():
        try:
            maybe = json.loads(summary_raw)
            if isinstance(maybe, dict):
                parsed = maybe
            else:
                return summary_raw.strip()
        except json.JSONDecodeError:
            return summary_raw.strip()
    else:
        return "No summary available."

    lines: list[str] = []
    for section_key, section_value in parsed.items():
        lines.append(f"=== {_pretty_label(section_key)} ===")
        _append_bullets(section_value, lines)
        lines.append("")

    formatted = "\n".join(lines).strip()
    if not formatted:
        return "No summary highlights available."
    return formatted


def normalize_weights(weights: dict[str, float]) -> dict[str, float]:
    allowed = ["education", "experience", "research_outputs", "skills_and_methods"]
    cleaned = {k: max(0.0, float(weights.get(k, 0.0))) for k in allowed}
    total = sum(cleaned.values())
    if total <= 0:
        return {
            "education": 0.24,
            "experience": 0.28,
            "research_outputs": 0.22,
            "skills_and_methods": 0.26,
        }
    return {k: v / total for k, v in cleaned.items()}


def build_candidate_features(
    item: dict[str, Any],
    scoring_config: dict[str, Any] | None = None,
) -> dict[str, Any]:
    raw_cbr_features = item.get("cbr_features", {}) if isinstance(item.get("cbr_features", {}), dict) else {}
    cbr_features = normalize_cbr_features_payload(raw_cbr_features)
    flat_cbr_features = _flatten_dict(cbr_features)
    category_scores = compute_cbr_category_scores(flat_cbr_features, scoring_config=scoring_config)
    feature_breakdown = compute_cbr_feature_breakdown(flat_cbr_features, scoring_config=scoring_config)

    application_id = str(item.get("application_id") or item.get("name") or "application")
    application_name = application_id

    selection_ground_truth = item.get("selection_ground_truth") if isinstance(item.get("selection_ground_truth"), dict) else {}
    ground_truth_label = _normalize_decision_label(selection_ground_truth.get("label"))
    summary_text = _extract_summary_text(item.get("summary"))

    return {
        "application_id": application_id,
        "name": application_name,
        "department": item.get("department", "unknown"),
        "ground_truth_label": ground_truth_label,
        "summary_text": summary_text,
        "cbr_features": cbr_features,
        "cbr_breakdown": {
            "aggregates": category_scores,
            "subfeatures": feature_breakdown,
        },
        "cbr_flat_features": flat_cbr_features,
    }


def _string_similarity(left: Any, right: Any) -> float:
    if left is None and right is None:
        return 1.0
    if left is None or right is None:
        return 0.0

    left_text = str(left).strip().casefold()
    right_text = str(right).strip().casefold()
    if not left_text and not right_text:
        return 1.0
    if left_text == right_text:
        return 1.0
    if left_text in right_text or right_text in left_text:
        return 0.85
    return SequenceMatcher(None, left_text, right_text).ratio()


def _numeric_similarity(left: Any, right: Any, bounds: tuple[float, float]) -> float:
    if left is None and right is None:
        return 1.0
    if left is None or right is None:
        return 0.0

    lower, upper = bounds
    span = max(float(upper - lower), 1e-9)
    return max(0.0, 1.0 - abs(float(left) - float(right)) / span)


def _prepare_similarity_schema(candidates: list[dict[str, Any]], weights: dict[str, float]) -> dict[str, Any]:
    selected_by_category: dict[str, set[str]] = {}
    for group_name, group in SCORE_GROUPS.items():
        selected_by_category[group_name] = {
            str(column).split("__", 1)[1]
            for column in group["columns"]
            if "__" in str(column)
        }

    return _prepare_similarity_schema_with_selection(candidates, weights, selected_by_category)


def _prepare_similarity_schema_with_selection(
    candidates: list[dict[str, Any]],
    weights: dict[str, float],
    selected_by_category: dict[str, set[str]],
) -> dict[str, Any]:
    score_columns: list[str] = []
    for group_name, group in SCORE_GROUPS.items():
        selected_subfeatures = selected_by_category.get(group_name)
        if selected_subfeatures is None:
            selected_subfeatures = {
                str(column).split("__", 1)[1]
                for column in group["columns"]
                if "__" in str(column)
            }

        for column in group["columns"]:
            column_key = str(column).split("__", 1)[1] if "__" in str(column) else str(column)
            if column_key in selected_subfeatures:
                score_columns.append(column)

    available_columns: list[str] = []
    for column in score_columns:
        if any(column in c.get("cbr_flat_features", {}) for c in candidates):
            available_columns.append(column)

    numeric_columns: set[str] = set()
    numeric_bounds: dict[str, tuple[float, float]] = {}
    for column in available_columns:
        numeric_values: list[float] = []
        for c in candidates:
            raw = c.get("cbr_flat_features", {}).get(column)
            val = _safe_float(raw)
            if val is not None:
                numeric_values.append(val)

        column_looks_numeric = (
            column.endswith(("_months", "_languages", "_0_100"))
            or column.startswith(("experience__years", "research_outputs__num", "skills_and_methods__num"))
            or column.startswith("skills_and_methods__has_")
            or len(set(numeric_values)) > 2
        )

        if column_looks_numeric:
            numeric_columns.add(column)
            if numeric_values:
                numeric_bounds[column] = (min(numeric_values), max(numeric_values))
            else:
                numeric_bounds[column] = (0.0, 1.0)
    column_weights: dict[str, float] = {}
    for group_name, group in SCORE_GROUPS.items():
        present_columns = [column for column in group["columns"] if column in available_columns]
        if not present_columns:
            continue
        per_column_weight = float(weights.get(group_name, 0.0)) / len(present_columns)
        for column in present_columns:
            column_weights[column] = per_column_weight

    return {
        "score_columns": available_columns,
        "numeric_columns": numeric_columns,
        "numeric_bounds": numeric_bounds,
        "column_weights": column_weights,
    }


def _normalize_selected_subfeatures_config(scoring_config: dict[str, Any] | None) -> dict[str, set[str]]:
    return normalize_selected_subfeatures_config(scoring_config)


def _pair_similarity(target: dict[str, Any], other: dict[str, Any], schema: dict[str, Any]) -> tuple[float, dict[str, float]]:
    score_columns = schema["score_columns"]
    numeric_columns = schema["numeric_columns"]
    numeric_bounds = schema["numeric_bounds"]
    column_weights = schema["column_weights"]

    target_features = target.get("cbr_flat_features", {})
    other_features = other.get("cbr_flat_features", {})

    weighted_sum = 0.0
    total_weight = 0.0
    group_scores: dict[str, float] = {}

    for group_name, group in SCORE_GROUPS.items():
        present_columns = [column for column in group["columns"] if column in score_columns]
        if not present_columns:
            continue

        group_weighted_sum = 0.0
        group_total_weight = 0.0
        for column in present_columns:
            left_raw = target_features.get(column)
            right_raw = other_features.get(column)
            if column in numeric_columns:
                left = _safe_float(left_raw)
                right = _safe_float(right_raw)
                similarity = _numeric_similarity(left, right, numeric_bounds[column])
            else:
                similarity = _string_similarity(left_raw, right_raw)

            weight = float(column_weights.get(column, 0.0))
            weighted_sum += similarity * weight
            total_weight += weight
            group_weighted_sum += similarity * weight
            group_total_weight += weight

        group_scores[f"{group_name}_similarity"] = (group_weighted_sum / group_total_weight) if group_total_weight else 0.0

    if total_weight <= 0:
        return 0.0, group_scores
    return weighted_sum / total_weight, group_scores


def _score_from_neighbors(
    candidate: dict[str, Any],
    labeled_cases: list[dict[str, Any]],
    schema: dict[str, Any],
    k_neighbors: int,
) -> tuple[float, dict[str, Any], list[dict[str, Any]]]:
    neighbors: list[dict[str, Any]] = []
    for other in labeled_cases:
        if other["application_id"] == candidate["application_id"]:
            continue

        label = _normalize_decision_label(other.get("ground_truth_label"))
        if label is None or label not in VALID_LABELS:
            continue

        sim, group_scores = _pair_similarity(candidate, other, schema)
        neighbors.append(
            {
                "application_id": other["application_id"],
                "name": other.get("name", other["application_id"]),
                "label": label,
                "label_score": LABEL_SCORES[label],
                "similarity": sim,
                "group_scores": group_scores,
            }
        )

    neighbors.sort(key=lambda row: row["similarity"], reverse=True)
    top_neighbors = neighbors[:k_neighbors]

    total_similarity = 0.0
    weighted_label_score_sum = 0.0
    label_similarity = {"shortlist": 0.0, "longlist": 0.0, "reject": 0.0}
    for row in top_neighbors:
        sim = row["similarity"]
        total_similarity += sim
        label_similarity[row["label"]] += sim
        weighted_label_score_sum += sim * float(row["label_score"])

    confidence = {
        "shortlist": (label_similarity["shortlist"] / total_similarity) if total_similarity else 0.0,
        "longlist": (label_similarity["longlist"] / total_similarity) if total_similarity else 0.0,
        "reject": (label_similarity["reject"] / total_similarity) if total_similarity else 0.0,
    }
    predicted_label = max(confidence, key=confidence.get) if total_similarity else None
    score = (weighted_label_score_sum / total_similarity) if total_similarity else 0.0

    components = {
        "neighbor_weighted_label_average": round(score, 4),
        "neighbors_used": len(top_neighbors),
        "shortlist_weight_share": round(confidence["shortlist"], 4),
        "longlist_weight_share": round(confidence["longlist"], 4),
        "reject_weight_share": round(confidence["reject"], 4),
        "predicted_label": predicted_label,
    }
    return score, components, top_neighbors


def score_cbr_candidates(
    candidates: list[dict[str, Any]],
    weights: dict[str, float],
    scoring_config: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    k_neighbors = 5
    selected_by_category = _normalize_selected_subfeatures_config(scoring_config)
    schema = _prepare_similarity_schema_with_selection(candidates, weights, selected_by_category)
    labeled_cases = [
        c for c in candidates
        if _normalize_decision_label(c.get("ground_truth_label")) in VALID_LABELS
    ]

    background_values: list[Any] = []
    for candidate in candidates:
        flat = candidate.get("cbr_flat_features", {}) if isinstance(candidate.get("cbr_flat_features", {}), dict) else {}
        background_values.append(flat.get("education__bachelor_field"))
        background_values.append(flat.get("education__master_field"))
    warmup_background_embeddings(background_values)

    scored: list[dict[str, Any]] = []
    for c in candidates:
        cbr_score, cbr_components, top_neighbors = _score_from_neighbors(c, labeled_cases, schema, k_neighbors)

        enriched = dict(c)
        enriched.pop("cbr_flat_features", None)
        enriched["scores"] = {
            "cbr": round(cbr_score, 4),
        }
        enriched["cbr_score_components"] = cbr_components
        enriched.setdefault("cbr_breakdown", {})
        enriched["cbr_breakdown"]["retrieval"] = {
            "k_neighbors": k_neighbors,
            "top_neighbors": [
                {
                    "application_id": row["application_id"],
                    "name": row["name"],
                    "label": row["label"],
                    "label_score": row["label_score"],
                    "similarity": round(row["similarity"], 4),
                    "group_scores": {
                        key: round(float(value), 4)
                        for key, value in row.get("group_scores", {}).items()
                    },
                }
                for row in top_neighbors
            ],
        }
        scored.append(enriched)
    return scored
