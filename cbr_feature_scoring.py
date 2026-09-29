from __future__ import annotations

import json
import math
from pathlib import Path
import threading
from typing import Any
from difflib import SequenceMatcher

try:
    from fastembed import TextEmbedding
except ImportError:
    TextEmbedding = None  # type: ignore


_EMBEDDING_MODEL_NAME = "BAAI/bge-small-en-v1.5"
_EMBEDDING_CACHE_PATH = Path(__file__).resolve().parent / "data" / "cache" / "background_embeddings.json"
_EMBEDDING_LOCK = threading.Lock()
_EMBEDDING_MODEL: Any = None
_EMBEDDING_CACHE: dict[str, list[float]] | None = None
_RUNTIME_QUERY_EMBEDDINGS: dict[str, list[float]] = {}

CANONICAL_CBR_SCHEMA: dict[str, list[str]] = {
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

_CATEGORY_ALIASES = {
    "education": "education",
    "experience": "experience",
    "research_outputs": "research_outputs",
    "research output": "research_outputs",
    "researchoutput": "research_outputs",
    "researchoutputs": "research_outputs",
    "skills_and_methods": "skills_and_methods",
    "skills and methods": "skills_and_methods",
    "skills": "skills_and_methods",
    "methods": "skills_and_methods",
}


def _normalize_key_token(value: Any) -> str:
    text = str(value or "").strip().casefold()
    text = "".join(ch if ch.isalnum() else "_" for ch in text)
    while "__" in text:
        text = text.replace("__", "_")
    return text.strip("_")


def _normalize_category_key(category: Any) -> str:
    token = _normalize_key_token(category)
    if not token:
        return ""
    return _CATEGORY_ALIASES.get(token, token)


def _subfeature_alias_map_by_category() -> dict[str, dict[str, str]]:
    alias_map: dict[str, dict[str, str]] = {}
    for category, keys in CANONICAL_CBR_SCHEMA.items():
        per_category: dict[str, str] = {}
        for key in keys:
            normalized_key = _normalize_key_token(key)
            per_category[normalized_key] = key
            per_category[normalized_key.replace("_0_100", "")] = key
        alias_map[category] = per_category

    alias_map["education"].update({
        "gpa": "gpa_normalized_0_100",
        "grade_point_average": "gpa_normalized_0_100",
        "thesis_grade": "master_thesis_grade_normalized_0_100",
    })
    alias_map["research_outputs"].update({
        "peer_reviewed_publications": "num_peer_reviewed_publications",
        "first_author_publications": "num_first_author_publications",
        "conference_publications": "num_conference_outputs",
    })
    alias_map["skills_and_methods"].update({
        "programming_languages": "num_programming_languages",
    })
    return alias_map


_SUBFEATURE_ALIASES = _subfeature_alias_map_by_category()


def _normalize_subfeature_key(category: str, key: Any) -> str:
    normalized = _normalize_key_token(key)
    if not normalized:
        return ""
    if category not in CANONICAL_CBR_SCHEMA:
        return normalized
    return _SUBFEATURE_ALIASES.get(category, {}).get(normalized, normalized)


def normalize_cbr_features_payload(raw_features: dict[str, Any] | None) -> dict[str, Any]:
    source = raw_features if isinstance(raw_features, dict) else {}
    normalized: dict[str, Any] = {}

    for raw_category, raw_value in source.items():
        category = _normalize_category_key(raw_category)
        if not category:
            continue

        if category == "sensitive_attributes_not_for_evaluation":
            normalized[category] = raw_value if isinstance(raw_value, dict) else {}
            continue

        if not isinstance(raw_value, dict):
            normalized[category] = raw_value
            continue

        category_payload = normalized.get(category)
        if not isinstance(category_payload, dict):
            category_payload = {}
            normalized[category] = category_payload

        for raw_key, value in raw_value.items():
            subfeature_key = _normalize_subfeature_key(category, raw_key)
            if not subfeature_key:
                continue
            category_payload[subfeature_key] = value

    return normalized


def normalize_selected_subfeatures_config(scoring_config: dict[str, Any] | None) -> dict[str, set[str]]:
    config = scoring_config or {}
    selected = config.get("selected_subfeatures") if isinstance(config, dict) else {}
    if not isinstance(selected, dict):
        return {}

    normalized: dict[str, set[str]] = {}
    for raw_category, keys in selected.items():
        if not isinstance(keys, list):
            continue
        category = _normalize_category_key(raw_category)
        if not category:
            continue
        normalized_keys = {
            _normalize_subfeature_key(category, key)
            for key in keys
            if _normalize_subfeature_key(category, key)
        }
        normalized[category] = normalized_keys
    return normalized


def _to_float(value: Any) -> float | None:
    try:
        if value is None or value == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _clamp01(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


def _normalize_text_for_embedding(value: Any) -> str:
    text = str(value).strip().casefold() if value is not None else ""
    return " ".join(text.split())


def _load_embedding_cache() -> dict[str, list[float]]:
    global _EMBEDDING_CACHE
    if _EMBEDDING_CACHE is not None:
        return _EMBEDDING_CACHE

    if not _EMBEDDING_CACHE_PATH.exists():
        _EMBEDDING_CACHE = {}
        return _EMBEDDING_CACHE

    try:
        payload = json.loads(_EMBEDDING_CACHE_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        _EMBEDDING_CACHE = {}
        return _EMBEDDING_CACHE

    model_name = str(payload.get("model_name") or "").strip()
    raw_embeddings = payload.get("embeddings")
    if model_name != _EMBEDDING_MODEL_NAME or not isinstance(raw_embeddings, dict):
        _EMBEDDING_CACHE = {}
        return _EMBEDDING_CACHE

    normalized_cache: dict[str, list[float]] = {}
    for key, vector in raw_embeddings.items():
        if not isinstance(key, str) or not isinstance(vector, list):
            continue
        try:
            normalized_cache[key] = [float(v) for v in vector]
        except (TypeError, ValueError):
            continue
    _EMBEDDING_CACHE = normalized_cache
    return _EMBEDDING_CACHE


def _save_embedding_cache(cache: dict[str, list[float]]) -> None:
    _EMBEDDING_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "model_name": _EMBEDDING_MODEL_NAME,
        "embeddings": cache,
    }
    _EMBEDDING_CACHE_PATH.write_text(json.dumps(payload, ensure_ascii=True), encoding="utf-8")


def _get_embedding_model() -> Any:
    global _EMBEDDING_MODEL
    if _EMBEDDING_MODEL is not None:
        return _EMBEDDING_MODEL
    if TextEmbedding is None:
        return None
    _EMBEDDING_MODEL = TextEmbedding(model_name=_EMBEDDING_MODEL_NAME)
    return _EMBEDDING_MODEL


def _embed_texts(texts: list[str]) -> dict[str, list[float]]:
    if not texts:
        return {}

    model = _get_embedding_model()
    if model is None:
        return {}

    vectors = list(model.embed(texts))
    embedded: dict[str, list[float]] = {}
    for index, text in enumerate(texts):
        if index >= len(vectors):
            break
        vector = vectors[index]
        embedded[text] = [float(v) for v in vector]
    return embedded


def warmup_background_embeddings(background_values: list[Any]) -> None:
    normalized_values = {
        _normalize_text_for_embedding(value)
        for value in background_values
        if _normalize_text_for_embedding(value)
    }
    if not normalized_values:
        return

    with _EMBEDDING_LOCK:
        cache = _load_embedding_cache()
        missing = [text for text in normalized_values if text not in cache]
        if not missing:
            return

        embedded = _embed_texts(missing)
        if not embedded:
            return

        cache.update(embedded)
        _save_embedding_cache(cache)


def _cosine_similarity(left: list[float], right: list[float]) -> float:
    if not left or not right or len(left) != len(right):
        return 0.0

    dot = 0.0
    left_norm = 0.0
    right_norm = 0.0
    for l_value, r_value in zip(left, right):
        dot += l_value * r_value
        left_norm += l_value * l_value
        right_norm += r_value * r_value

    denominator = math.sqrt(left_norm) * math.sqrt(right_norm)
    if denominator <= 0.0:
        return 0.0
    return _clamp01((dot / denominator + 1.0) / 2.0)


def _get_persisted_background_embedding(value: Any) -> list[float]:
    normalized = _normalize_text_for_embedding(value)
    if not normalized:
        return []

    with _EMBEDDING_LOCK:
        cache = _load_embedding_cache()
        existing = cache.get(normalized)
        if existing is not None:
            return existing

        embedded = _embed_texts([normalized])
        vector = embedded.get(normalized, [])
        if vector:
            cache[normalized] = vector
            _save_embedding_cache(cache)
        return vector


def _get_runtime_embedding(value: Any) -> list[float]:
    normalized = _normalize_text_for_embedding(value)
    if not normalized:
        return []

    existing = _RUNTIME_QUERY_EMBEDDINGS.get(normalized)
    if existing is not None:
        return existing

    embedded = _embed_texts([normalized])
    vector = embedded.get(normalized, [])
    if vector:
        _RUNTIME_QUERY_EMBEDDINGS[normalized] = vector
    return vector


def _bounded_score(value: Any, lower: float, upper: float, invert: bool = False) -> float:
    numeric = _to_float(value)
    if numeric is None:
        return 0.0
    if upper <= lower:
        return 0.0

    normalized = _clamp01((numeric - lower) / (upper - lower))
    if invert:
        return 1.0 - normalized
    return normalized


def _binary_score(value: Any) -> float:
    if isinstance(value, bool):
        return 1.0 if value else 0.0
    numeric = _to_float(value)
    if numeric is not None:
        return 1.0 if numeric > 0 else 0.0
    text = str(value).strip().casefold() if value is not None else ""
    return 1.0 if text in {"yes", "true", "y", "1", "present"} else 0.0


def _level_score(value: Any) -> float:
    if value is None:
        return 0.0

    text = str(value).strip().casefold().replace("-", " ")
    mapping = {
        "a1": 0.15,
        "a2": 0.3,
        "b1": 0.45,
        "b2": 0.65,
        "c1": 0.82,
        "c2": 0.95,
        "basic": 0.25,
        "intermediate": 0.55,
        "advanced": 0.8,
        "fluent": 0.95,
        "native": 1.0,
    }

    for key, score in mapping.items():
        if key in text:
            return score

    numeric = _to_float(value)
    if numeric is not None:
        if 0.0 <= numeric <= 1.0:
            return _clamp01(numeric)
        if 0.0 <= numeric <= 100.0:
            return _clamp01(numeric / 100.0)

    return 0.0


def _degree_score(value: Any) -> float:
    if value is None:
        return 0.0

    text = str(value).strip().casefold()
    if "phd" in text or "doctor" in text:
        return 1.0
    if "master" in text or "msc" in text or "ma" in text:
        return 0.85
    if "bachelor" in text or "bsc" in text or "ba" in text:
        return 0.65
    return 0.4 if text else 0.0


def _non_empty_text_score(value: Any) -> float:
    text = str(value).strip() if value is not None else ""
    return 1.0 if text else 0.0


def _parse_background_list(value: Any) -> list[str]:
    if value is None:
        return []

    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]

    text = str(value).strip()
    if not text:
        return []

    parts = [part.strip() for part in text.split(",")]
    return [part for part in parts if part]


def _max_similarity(candidate_value: Any, targets: list[str]) -> float:
    if not targets:
        return 0.0

    candidate_embedding = _get_persisted_background_embedding(candidate_value)
    target_embeddings = [_get_runtime_embedding(target) for target in targets]
    target_embeddings = [embedding for embedding in target_embeddings if embedding]
    if candidate_embedding and target_embeddings:
        return max(_cosine_similarity(candidate_embedding, embedding) for embedding in target_embeddings)

    return max(_fallback_string_similarity(candidate_value, target) for target in targets)


def _fallback_string_similarity(left: Any, right: Any) -> float:
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


def _background_field_score(candidate_field: Any, scoring_config: dict[str, Any] | None) -> float:
    text = str(candidate_field).strip() if candidate_field is not None else ""
    if not text:
        return 0.0

    config = scoring_config or {}
    backgrounds = config.get("education_backgrounds") if isinstance(config, dict) else {}
    backgrounds = backgrounds if isinstance(backgrounds, dict) else {}

    preferred = _parse_background_list(backgrounds.get("preferred"))
    acceptable = _parse_background_list(backgrounds.get("acceptable"))

    if not preferred and not acceptable:
        return _non_empty_text_score(candidate_field)

    preferred_similarity = _max_similarity(candidate_field, preferred)
    acceptable_similarity = _max_similarity(candidate_field, acceptable)

    # Preferred matches carry full weight; acceptable matches are discounted.
    return max(preferred_similarity * 1.0, acceptable_similarity * 0.7)


def _normalize_selected_subfeatures(scoring_config: dict[str, Any] | None) -> dict[str, set[str]]:
    return normalize_selected_subfeatures_config(scoring_config)


def _average(values: list[float]) -> float:
    if not values:
        return 0.0
    return sum(values) / len(values)


def _feature_specs(scoring_config: dict[str, Any] | None = None) -> dict[str, list[tuple[str, str, Any]]]:
    all_specs: dict[str, list[tuple[str, str, Any]]] = {
        "education": [
            ("highest_degree_completed", "Highest degree", lambda features: _degree_score(features.get("education__highest_degree_completed"))),
            ("gpa_normalized_0_100", "GPA", lambda features: _bounded_score(features.get("education__gpa_normalized_0_100"), 0.0, 100.0)),
            ("master_thesis_grade_normalized_0_100", "Thesis grade", lambda features: _bounded_score(features.get("education__master_thesis_grade_normalized_0_100"), 0.0, 100.0)),
            ("bachelor_field", "Bachelor field", lambda features: _background_field_score(features.get("education__bachelor_field"), scoring_config)),
            ("master_field", "Master field", lambda features: _background_field_score(features.get("education__master_field"), scoring_config)),
        ],
        "experience": [
            ("years_research_experience", "Research years", lambda features: _bounded_score(features.get("experience__years_research_experience"), 0.0, 8.0)),
            ("years_relevant_professional_experience", "Relevant professional years", lambda features: _bounded_score(features.get("experience__years_relevant_professional_experience"), 0.0, 8.0)),
            ("years_teaching_experience", "Teaching years", lambda features: _bounded_score(features.get("experience__years_teaching_experience"), 0.0, 6.0)),
            ("career_gap_months", "Career gap", lambda features: _bounded_score(features.get("experience__career_gap_months"), 0.0, 36.0, invert=True)),
            ("time_since_last_academic_activity_months", "Recent academic activity", lambda features: _bounded_score(features.get("experience__time_since_last_academic_activity_months"), 0.0, 36.0, invert=True)),
        ],
        "research_outputs": [
            ("num_peer_reviewed_publications", "Peer-reviewed publications", lambda features: _bounded_score(features.get("research_outputs__num_peer_reviewed_publications"), 0.0, 8.0)),
            ("num_first_author_publications", "First-author publications", lambda features: _bounded_score(features.get("research_outputs__num_first_author_publications"), 0.0, 5.0)),
            ("num_conference_outputs", "Conference outputs", lambda features: _bounded_score(features.get("research_outputs__num_conference_outputs"), 0.0, 8.0)),
            ("num_posters_or_extended_abstracts", "Posters or abstracts", lambda features: _bounded_score(features.get("research_outputs__num_posters_or_extended_abstracts"), 0.0, 8.0)),
            ("has_independent_research_output", "Independent research output", lambda features: _binary_score(features.get("research_outputs__has_independent_research_output"))),
        ],
        "skills_and_methods": [
            ("has_quantitative_methods", "Quantitative methods", lambda features: _binary_score(features.get("skills_and_methods__has_quantitative_methods"))),
            ("has_qualitative_methods", "Qualitative methods", lambda features: _binary_score(features.get("skills_and_methods__has_qualitative_methods"))),
            ("has_programming_or_technical_skills", "Programming or technical skills", lambda features: _binary_score(features.get("skills_and_methods__has_programming_or_technical_skills"))),
            ("num_programming_languages", "Programming languages", lambda features: _bounded_score(features.get("skills_and_methods__num_programming_languages"), 0.0, 5.0)),
            ("has_experimental_or_empirical_design", "Experimental or empirical design", lambda features: _binary_score(features.get("skills_and_methods__has_experimental_or_empirical_design"))),
            ("english_level", "English level", lambda features: _level_score(features.get("skills_and_methods__english_level"))),
            ("local_language_level", "Local language level", lambda features: _level_score(features.get("skills_and_methods__local_language_level"))),
        ],
    }

    selected_by_category = _normalize_selected_subfeatures(scoring_config)
    filtered_specs: dict[str, list[tuple[str, str, Any]]] = {}
    for category, specs in all_specs.items():
        selected = selected_by_category.get(category)
        if selected is None:
            filtered_specs[category] = specs
            continue
        filtered_specs[category] = [spec for spec in specs if spec[0] in selected]
    return filtered_specs


def compute_cbr_feature_breakdown(
    flat_features: dict[str, Any],
    scoring_config: dict[str, Any] | None = None,
) -> dict[str, dict[str, Any]]:
    breakdown: dict[str, dict[str, Any]] = {}
    feature_specs = _feature_specs(scoring_config)

    for category, specs in feature_specs.items():
        category_features: dict[str, dict[str, Any]] = {}
        scores: list[float] = []

        for key, label, scorer in specs:
            score = round(float(scorer(flat_features)), 4)
            raw_key = f"{category}__{key}"
            category_features[key] = {
                "label": label,
                "raw": flat_features.get(raw_key),
                "score": score,
            }
            scores.append(score)

        breakdown[category] = {
            "aggregate": round(_average(scores), 4),
            "subfeatures": category_features,
        }

    return breakdown


def compute_cbr_category_scores(
    flat_features: dict[str, Any],
    scoring_config: dict[str, Any] | None = None,
) -> dict[str, float]:
    breakdown = compute_cbr_feature_breakdown(flat_features, scoring_config=scoring_config)
    return {
        category: values["aggregate"]
        for category, values in breakdown.items()
    }
