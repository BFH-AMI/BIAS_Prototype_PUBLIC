from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import TYPE_CHECKING, Any, Iterator, Optional

if TYPE_CHECKING:
    from openai import OpenAI


PRESELECT_TIMEOUT_SECONDS = 12
SELECTION_TIMEOUT_SECONDS = 90


MODULE_DIR = Path(__file__).resolve().parent


def _resolve_local_path(path_str: str) -> Path:
    path = Path(path_str)
    if path.is_absolute():
        return path
    return MODULE_DIR / path


def load_api_key(config_path: str = "prompts/CONFIG.txt", key_name: str = "OPENAI_KEY") -> str:
    """Load API key from environment first, then KEY = value text config."""
    env_value = str(os.environ.get(key_name, "") or "").strip()
    if env_value:
        return env_value

    # Backward-compatible fallback for standard OpenAI env var naming.
    if key_name.upper().startswith("OPENAI_KEY"):
        openai_env = str(os.environ.get("OPENAI_API_KEY", "") or "").strip()
        if openai_env:
            return openai_env

    path = _resolve_local_path(config_path)
    if not path.exists():
        raise FileNotFoundError(
            f"Config file not found: {path}. Set environment variable {key_name} (recommended) "
            f"or create {config_path}."
        )

    target_prefix = f"{key_name}"
    api_key: Optional[str] = None

    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                continue
            if "=" not in stripped:
                continue
            lhs, rhs = stripped.split("=", 1)
            if lhs.strip() != target_prefix:
                continue
            api_key = rhs.strip()
            if (api_key.startswith("\"") and api_key.endswith("\"")) or (
                api_key.startswith("'") and api_key.endswith("'")
            ):
                api_key = api_key[1:-1]
            break

    if not api_key:
        raise ValueError(
            f"{key_name} not found in {config_path}. Set environment variable {key_name} (recommended)."
        )

    return api_key


def make_openai_client(api_key: str) -> "OpenAI":
    try:
        from openai import OpenAI as OpenAIClient
    except ModuleNotFoundError as exc:
        raise ModuleNotFoundError(
            "The openai package is required. Install it with: pip install openai"
        ) from exc

    return OpenAIClient(api_key=api_key)


def _read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def load_eval_prompts(prompt_dir: str = "prompts/eval_agents") -> dict[str, str]:
    base = _resolve_local_path(prompt_dir)
    return {
        "eval_system_prompt": _read_text(base / "eval_system_prompt.txt"),
        "eval_user_template": _read_text(base / "eval_user_prompt.txt"),
    }


def _build_llm_messages(
    job_ad: str,
    candidate_payload: list[dict[str, Any]],
    prompt_dir: str,
    additional_instructions: str = "",
) -> tuple[str, str]:
    prompts = load_eval_prompts(prompt_dir=prompt_dir)
    system_prompt = prompts["eval_system_prompt"]
    user_prompt = prompts["eval_user_template"].format(
        job_ad=job_ad,
        applications_json=json.dumps(candidate_payload, ensure_ascii=False, indent=2),
        previous_selection_json="null",
        fairness_feedback_json="null",
    )
    instructions = additional_instructions.strip()
    if instructions:
        user_prompt = f"{user_prompt}\n\nADDITIONAL_INSTRUCTIONS:\n{instructions}\n"
    return system_prompt, user_prompt


def _build_preselection_messages(
    job_ad: str,
    requirements: list[str],
    candidate_payload: list[dict[str, Any]],
    ntnu_context_docs: list[dict[str, Any]],
    prompt_path: str,
    additional_instructions: str = "",
) -> tuple[str, str]:
    path = _resolve_local_path(prompt_path)
    if not path.exists():
        raise FileNotFoundError(f"Preselection prompt file not found: {path}")

    template = _read_text(path)
    if not template.strip():
        raise ValueError(f"Preselection prompt file is empty: {path}")

    requirements_json = json.dumps(requirements or [], ensure_ascii=False, indent=2)
    ntnu_doc_context_json = json.dumps(ntnu_context_docs or [], ensure_ascii=False, indent=2)
    applications_json = json.dumps(candidate_payload, ensure_ascii=False, indent=2)

    if "{job_ad}" in template:
        user_prompt = template.format(
            job_ad=job_ad,
            requirements_json=requirements_json,
            ntnu_doc_context_json=ntnu_doc_context_json,
            applications_json=applications_json,
        )
    else:
        user_prompt = template
        user_prompt = user_prompt.replace("{{JOB_AD}}", job_ad)
        user_prompt = user_prompt.replace("{{REQUIREMENTS_JSON}}", requirements_json)
        user_prompt = user_prompt.replace("{{NTNU_DOC_CONTEXT_JSON}}", ntnu_doc_context_json)
        user_prompt = user_prompt.replace("{{APPLICATIONS_JSON}}", applications_json)

    instructions = additional_instructions.strip()
    if instructions:
        user_prompt = f"{user_prompt}\n\nADDITIONAL_INSTRUCTIONS:\n{instructions}\n"

    system_prompt = "You are a precise pre-screening assistant. Return strict JSON only."
    return system_prompt, user_prompt


def _extract_json(text: str) -> dict[str, Any]:
    def _attempt_parse(source: str) -> dict[str, Any] | None:
        try:
            data = json.loads(source)
            if isinstance(data, dict):
                return data
        except json.JSONDecodeError:
            return None
        return None

    def _repair_common_json_issues(source: str) -> str:
        repaired = source
        # Common malformed token from model output: "selection_reason: "Some text"
        # Repair to valid JSON key/value form: "selection_reason": "Some text"
        repaired = re.sub(
            r'"selection_reason\s*:\s*"',
            '"selection_reason": "',
            repaired,
            flags=re.IGNORECASE,
        )
        return repaired

    direct = _attempt_parse(text)
    if direct is not None:
        return direct

    repaired_text = _repair_common_json_issues(text)
    repaired_direct = _attempt_parse(repaired_text)
    if repaired_direct is not None:
        return repaired_direct

    decoder = json.JSONDecoder()
    best_obj: dict[str, Any] | None = None
    best_end = -1

    for source in (text, repaired_text):
        for idx, ch in enumerate(source):
            if ch != "{":
                continue
            try:
                parsed, end = decoder.raw_decode(source[idx:])
            except json.JSONDecodeError:
                continue
            if isinstance(parsed, dict) and (idx + end) > best_end:
                best_obj = parsed
                best_end = idx + end

    if best_obj is not None:
        return best_obj

    raise ValueError("LLM response did not contain a parsable JSON object")


def _normalized_selection_reason(row: dict[str, Any]) -> str:
    for key in (
        "selection_reason",
        "selection_reason:",
        "selection_reason: ",
        "reason",
        "rationale",
    ):
        value = row.get(key)
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return ""


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
        reason = _normalized_selection_reason(row)
        if reason:
            entry["selection_reason"] = reason
        normalized.append(entry)
    return normalized


def _normalize_omitted_items(items: Any) -> list[dict[str, str]]:
    if not isinstance(items, list):
        return []
    normalized: list[dict[str, str]] = []
    seen: set[str] = set()
    for row in items:
        if not isinstance(row, dict):
            continue
        application_id = str(
            row.get("application_id")
            or row.get("candidate_id")
            or row.get("id")
            or ""
        ).strip()
        if not application_id or application_id in seen:
            continue
        reason = str(row.get("reason") or row.get("explanation") or row.get("note") or "").strip()
        normalized.append({
            "application_id": application_id,
            "reason": reason,
        })
        seen.add(application_id)
    return normalized


def _is_explicit_omission_reason(reason: str) -> bool:
    text = str(reason or "").strip().lower()
    if not text:
        return False

    # Reject ambiguity/near-match reasons so borderline candidates stay in pool.
    ambiguous_markers = [
        "not stated",
        "not mentioned",
        "unclear",
        "ambiguous",
        "uncertain",
        "insufficient evidence",
        "missing information",
        "no evidence provided",
        "approximately",
        "approx",
        "close to",
        "near",
        "partial",
    ]
    if any(marker in text for marker in ambiguous_markers):
        return False

    return True


def _fallback_fill(
    selected: list[dict[str, Any]],
    excluded_ids: set[str],
    application_pool: list[dict[str, Any]],
    target_count: int,
) -> list[dict[str, Any]]:
    output = [row for row in selected if row["application_id"] not in excluded_ids]
    used = {row["application_id"] for row in output}

    for candidate in application_pool:
        if len(output) >= target_count:
            break
        application_id = str(candidate.get("application_id") or "")
        if not application_id or application_id in used or application_id in excluded_ids:
            continue
        output.append(
            {
                "application_id": application_id,
                "selection_reason": "Included by fallback ordering due to incomplete LLM output.",
            }
        )
        used.add(application_id)

    return output[:target_count]


def _normalize_summary_payload(summary_value: Any) -> Any:
    if isinstance(summary_value, (dict, list)):
        return summary_value

    if isinstance(summary_value, str):
        text = summary_value.strip()
        if not text:
            return ""
        try:
            parsed = json.loads(text)
            if isinstance(parsed, (dict, list)):
                return parsed
        except json.JSONDecodeError:
            pass
        return text

    return summary_value


def _fallback_ranked_candidates(candidate_pool: list[dict[str, Any]], target_count: int) -> list[dict[str, Any]]:
    return [
        {
            "application_id": str(candidate.get("application_id") or ""),
            "selection_reason": "Included by fallback ordering because the LLM response was unavailable or incomplete.",
        }
        for candidate in candidate_pool[:target_count]
        if str(candidate.get("application_id") or "").strip()
    ]


def _prepare_candidate_payload(all_candidates: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], set[str]]:
    candidate_payload_raw = [
        {
            "application_id": str(c.get("application_id") or ""),
            "summary": _normalize_summary_payload(c.get("summary")),
        }
        for c in all_candidates
    ]

    valid_ids = {
        str(row.get("application_id", "")).strip()
        for row in candidate_payload_raw
        if str(row.get("application_id", "")).strip()
    }
    candidate_payload = [
        {
            "application_id": str(row.get("application_id", "")).strip(),
            "summary": row.get("summary"),
        }
        for row in candidate_payload_raw
        if str(row.get("application_id", "")).strip()
    ]
    return candidate_payload, valid_ids


def _finalize_llm_selection_result(
    *,
    model: str,
    candidate_payload: list[dict[str, Any]],
    valid_ids: set[str],
    parsed: dict[str, Any],
    shortlist_raw: list[dict[str, Any]],
    longlist_raw: list[dict[str, Any]],
    prompt_system_sent: str,
    user_prompt_sent: str,
    raw_response_text: str,
    client_error: str | None,
    client_error_type: str | None,
    selection_error: str | None,
    selection_error_type: str | None,
) -> dict[str, Any]:
    shortlist_filtered = [row for row in shortlist_raw if row["application_id"] in valid_ids]
    shortlist = _fallback_fill(shortlist_filtered, set(), candidate_payload, 5)

    shortlist_ids = {row["application_id"] for row in shortlist}
    longlist_filtered = [
        row
        for row in longlist_raw
        if row["application_id"] in valid_ids and row["application_id"] not in shortlist_ids
    ]
    longlist = _fallback_fill(longlist_filtered, shortlist_ids, candidate_payload, 5)

    if not shortlist and candidate_payload:
        shortlist = _fallback_ranked_candidates(candidate_payload, 5)
        shortlist_ids = {row["application_id"] for row in shortlist}

    if not longlist and candidate_payload:
        remaining_pool = [row for row in candidate_payload if row["application_id"] not in shortlist_ids]
        longlist = _fallback_ranked_candidates(remaining_pool, 5)

    return {
        "model": model,
        "timeout_seconds": SELECTION_TIMEOUT_SECONDS,
        "considered_candidates": len(candidate_payload),
        "shortlist": shortlist,
        "longlist": longlist,
        "prompt_system": prompt_system_sent,
        "prompt_user": user_prompt_sent,
        "response_text": raw_response_text,
        "raw_response": parsed,
        "fallback_used": bool(client_error or selection_error),
        "fallback_reason": selection_error or client_error,
        "fallback_error_type": selection_error_type,
        "client_error_type": client_error_type,
        "error_message": selection_error or client_error,
        "error_type": selection_error_type or client_error_type,
    }


def evaluate_with_llm_selection(
    job_ad: str,
    all_candidates: list[dict[str, Any]],
    model: str = "gpt-5.4-mini",
    key_name: str = "OPENAI_KEY",
    config_path: str = "prompts/CONFIG.txt",
    prompt_dir: str = "prompts/eval_agents",
    additional_instructions: str = "",
) -> dict[str, Any]:
    client: OpenAI | None = None
    client_error: str | None = None
    client_error_type: str | None = None
    try:
        api_key = load_api_key(config_path=config_path, key_name=key_name)
        client = make_openai_client(api_key)
    except Exception as exc:
        client_error = str(exc)
        client_error_type = type(exc).__name__

    candidate_payload, valid_ids = _prepare_candidate_payload(all_candidates)

    parsed: dict[str, Any] = {}
    shortlist_raw: list[dict[str, Any]] = []
    longlist_raw: list[dict[str, Any]] = []
    system_prompt_sent = ""
    user_prompt_sent = ""
    raw_response_text = ""
    selection_error: str | None = None
    selection_error_type: str | None = None

    try:
        system_prompt_sent, user_prompt_sent = _build_llm_messages(
            job_ad,
            candidate_payload,
            prompt_dir=prompt_dir,
            additional_instructions=additional_instructions,
        )
    except Exception as exc:
        selection_error = str(exc)
        selection_error_type = type(exc).__name__

    if client is not None and not selection_error:
        try:
            response = client.responses.create(
                model=model,
                input=[
                    {"role": "system", "content": system_prompt_sent},
                    {"role": "user", "content": user_prompt_sent},
                ],
                timeout=SELECTION_TIMEOUT_SECONDS,
            )
            raw_response_text = str(getattr(response, "output_text", "") or "")
            parsed = _extract_json(raw_response_text) if raw_response_text else {}
            shortlist_raw = _normalize_ranked_items(parsed.get("shortlist"))
            longlist_raw = _normalize_ranked_items(parsed.get("longlist"))
        except Exception as exc:
            selection_error = str(exc)
            selection_error_type = type(exc).__name__
    elif client is None:
        selection_error = client_error
        selection_error_type = client_error_type

    return _finalize_llm_selection_result(
        model=model,
        candidate_payload=candidate_payload,
        valid_ids=valid_ids,
        parsed=parsed,
        shortlist_raw=shortlist_raw,
        longlist_raw=longlist_raw,
        prompt_system_sent=system_prompt_sent,
        user_prompt_sent=user_prompt_sent,
        raw_response_text=raw_response_text,
        client_error=client_error,
        client_error_type=client_error_type,
        selection_error=selection_error,
        selection_error_type=selection_error_type,
    )


def stream_with_llm_selection(
    job_ad: str,
    all_candidates: list[dict[str, Any]],
    model: str = "gpt-5.4-mini",
    key_name: str = "OPENAI_KEY",
    config_path: str = "prompts/CONFIG.txt",
    prompt_dir: str = "prompts/eval_agents",
    additional_instructions: str = "",
) -> Iterator[dict[str, Any]]:
    client: OpenAI | None = None
    client_error: str | None = None
    client_error_type: str | None = None
    try:
        api_key = load_api_key(config_path=config_path, key_name=key_name)
        client = make_openai_client(api_key)
    except Exception as exc:
        client_error = str(exc)
        client_error_type = type(exc).__name__

    candidate_payload, valid_ids = _prepare_candidate_payload(all_candidates)
    system_prompt_sent = ""
    user_prompt_sent = ""
    parsed: dict[str, Any] = {}
    shortlist_raw: list[dict[str, Any]] = []
    longlist_raw: list[dict[str, Any]] = []
    raw_response_text = ""
    selection_error: str | None = None
    selection_error_type: str | None = None

    try:
        system_prompt_sent, user_prompt_sent = _build_llm_messages(
            job_ad,
            candidate_payload,
            prompt_dir=prompt_dir,
            additional_instructions=additional_instructions,
        )
    except Exception as exc:
        selection_error = str(exc)
        selection_error_type = type(exc).__name__

    yield {
        "type": "start",
        "model": model,
        "considered_candidates": len(candidate_payload),
        "timeout_seconds": SELECTION_TIMEOUT_SECONDS,
        "prompt_system": system_prompt_sent,
        "prompt_user": user_prompt_sent,
    }

    if client is not None and not selection_error:
        try:
            with client.responses.stream(
                model=model,
                input=[
                    {"role": "system", "content": system_prompt_sent},
                    {"role": "user", "content": user_prompt_sent},
                ],
                timeout=SELECTION_TIMEOUT_SECONDS,
            ) as stream:
                for event in stream:
                    if getattr(event, "type", "") == "response.output_text.delta":
                        delta = str(getattr(event, "delta", "") or "")
                        if delta:
                            raw_response_text += delta
                            yield {
                                "type": "delta",
                                "delta": delta,
                                "response_text": raw_response_text,
                            }
                    elif getattr(event, "type", "") == "response.output_text.done":
                        done_text = str(getattr(event, "text", "") or "")
                        if done_text and len(done_text) > len(raw_response_text):
                            raw_response_text = done_text

                final_response = stream.get_final_response()
                final_output_text = str(getattr(final_response, "output_text", "") or "")
                if final_output_text and len(final_output_text) > len(raw_response_text):
                    raw_response_text = final_output_text

            if raw_response_text:
                parsed = _extract_json(raw_response_text)
                shortlist_raw = _normalize_ranked_items(parsed.get("shortlist"))
                longlist_raw = _normalize_ranked_items(parsed.get("longlist"))
        except Exception as exc:
            selection_error = str(exc)
            selection_error_type = type(exc).__name__
    elif client is None:
        selection_error = client_error
        selection_error_type = client_error_type

    if selection_error:
        yield {
            "type": "error",
            "error_type": selection_error_type,
            "error_message": selection_error,
        }

    evaluation = _finalize_llm_selection_result(
        model=model,
        candidate_payload=candidate_payload,
        valid_ids=valid_ids,
        parsed=parsed,
        shortlist_raw=shortlist_raw,
        longlist_raw=longlist_raw,
        prompt_system_sent=system_prompt_sent,
        user_prompt_sent=user_prompt_sent,
        raw_response_text=raw_response_text,
        client_error=client_error,
        client_error_type=client_error_type,
        selection_error=selection_error,
        selection_error_type=selection_error_type,
    )

    yield {
        "type": "done",
        "llm_selection": evaluation,
    }


def evaluate_with_llm_preselection(*args: Any, **kwargs: Any) -> dict[str, Any]:
    job_ad = str(kwargs.get("job_ad", ""))
    requirements = kwargs.get("requirements")
    all_candidates = kwargs.get("all_candidates")
    model = str(kwargs.get("model", "gpt-5.4-mini"))
    key_name = str(kwargs.get("key_name", "OPENAI_KEY"))
    config_path = str(kwargs.get("config_path", "prompts/CONFIG.txt"))
    prompt_path = str(kwargs.get("prompt_path", "prompts/eval_agents/pre-screening.txt"))
    additional_instructions = str(kwargs.get("additional_instructions", ""))
    ntnu_context_docs = kwargs.get("ntnu_context_docs")

    client: OpenAI | None = None
    client_error: str | None = None
    client_error_type: str | None = None
    try:
        api_key = load_api_key(config_path=config_path, key_name=key_name)
        client = make_openai_client(api_key)
    except Exception as exc:
        client_error = str(exc)
        client_error_type = type(exc).__name__

    candidate_payload, valid_ids = _prepare_candidate_payload(all_candidates or [])
    req_list = [str(item or "").strip() for item in (requirements or []) if str(item or "").strip()]
    ntnu_docs = [doc for doc in (ntnu_context_docs or []) if isinstance(doc, dict)]

    system_prompt_sent = ""
    user_prompt_sent = ""
    raw_response_text = ""
    parsed: dict[str, Any] = {}
    omitted_raw: list[dict[str, str]] = []
    selection_error: str | None = None
    selection_error_type: str | None = None

    try:
        system_prompt_sent, user_prompt_sent = _build_preselection_messages(
            job_ad=job_ad,
            requirements=req_list,
            candidate_payload=candidate_payload,
            ntnu_context_docs=ntnu_docs,
            prompt_path=prompt_path,
            additional_instructions=additional_instructions,
        )
    except Exception as exc:
        selection_error = str(exc)
        selection_error_type = type(exc).__name__

    if client is not None and not selection_error:
        try:
            response = client.responses.create(
                model=model,
                input=[
                    {"role": "system", "content": system_prompt_sent},
                    {"role": "user", "content": user_prompt_sent},
                ],
                timeout=PRESELECT_TIMEOUT_SECONDS,
            )
            raw_response_text = str(getattr(response, "output_text", "") or "")
            parsed = _extract_json(raw_response_text) if raw_response_text else {}
            omitted_raw = _normalize_omitted_items(
                parsed.get("omitted_candidates")
                or parsed.get("omitted")
                or parsed.get("excluded_candidates")
                or []
            )
        except Exception as exc:
            selection_error = str(exc)
            selection_error_type = type(exc).__name__
    elif client is None:
        selection_error = client_error
        selection_error_type = client_error_type

    omitted_candidates = [
        row
        for row in omitted_raw
        if row["application_id"] in valid_ids and _is_explicit_omission_reason(row.get("reason", ""))
    ]

    return {
        "model": model,
        "timeout_seconds": PRESELECT_TIMEOUT_SECONDS,
        "considered_candidates": len(candidate_payload),
        "requirements_count": len(req_list),
        "ntnu_context_doc_count": len(ntnu_docs),
        "omitted_candidates": omitted_candidates,
        "prompt_system": system_prompt_sent,
        "prompt_user": user_prompt_sent,
        "response_text": raw_response_text,
        "raw_response": parsed,
        "fallback_used": bool(client_error or selection_error),
        "fallback_reason": selection_error or client_error,
        "fallback_error_type": selection_error_type,
        "client_error_type": client_error_type,
    }
