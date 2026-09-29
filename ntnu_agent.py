from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, Iterator, List

try:
    from webtool.assistant_runtime import (
        fill_template,
        json_block,
        read_text,
        resolve_local_path,
        run_prompt,
        stream_prompt,
    )
except ImportError:
    from assistant_runtime import (  # type: ignore
        fill_template,
        json_block,
        read_text,
        resolve_local_path,
        run_prompt,
        stream_prompt,
    )

DEFAULT_PROMPT_DIR = "prompts/eval_assistants"
DEFAULT_MODEL = "gpt-5-nano"
DEFAULT_TIMEOUT_SECONDS = 90


def _load_retrieval_map(prompt_dir: str) -> Dict[str, List[str]]:
    base = resolve_local_path(prompt_dir)
    path = base / "ntnu_knowledge_base" / "retrieval_map.json"
    try:
        parsed = json.loads(read_text(path, missing_ok=True))
    except json.JSONDecodeError:
        return {}
    if not isinstance(parsed, dict):
        return {}

    output: Dict[str, List[str]] = {}
    for filename, categories in parsed.items():
        if not isinstance(filename, str):
            continue
        if isinstance(categories, list):
            output[filename] = [str(category) for category in categories]
    return output


def _route_categories(
    *,
    question: str,
    system_prompt: str,
    model: str,
    key_name: str,
    config_path: str,
    prompt_dir: str,
) -> dict[str, Any]:
    prompt_base = resolve_local_path(prompt_dir)
    retrieval_template = read_text(prompt_base / "ntnu_retrieval.txt")
    user_prompt = f"{retrieval_template}\n\nUSER_QUESTION:\n{question}\n"

    routed = run_prompt(
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        model=model,
        key_name=key_name,
        config_path=config_path,
        timeout_seconds=DEFAULT_TIMEOUT_SECONDS,
        parse_error_message="NTNU assistant response did not contain a parsable JSON object",
    )

    categories = routed.get("result", {}).get("categories") if isinstance(routed.get("result"), dict) else []
    if not isinstance(categories, list):
        categories = []

    return {
        "categories": [str(category).strip() for category in categories if str(category).strip()],
        "prompt_system": routed.get("prompt_system", ""),
        "prompt_user": routed.get("prompt_user", ""),
        "response_text": routed.get("response_text", ""),
    }


def _build_retrieved_documents_text(
    *,
    categories: list[str],
    prompt_dir: str,
) -> dict[str, Any]:
    category_set = {str(category).strip() for category in categories if str(category).strip()}
    retrieval_map = _load_retrieval_map(prompt_dir)
    prompt_base = resolve_local_path(prompt_dir)
    kb_dir = prompt_base / "ntnu_knowledge_base"

    selected_files: list[str] = []
    blocks: list[str] = []

    for filename, mapped_categories in retrieval_map.items():
        if category_set and not (set(mapped_categories) & category_set):
            continue
        file_path = kb_dir / filename
        if not file_path.exists():
            continue
        content = read_text(file_path, missing_ok=True).strip()
        if not content:
            continue
        selected_files.append(filename)
        blocks.append(f"### {filename}\n{content}")

    if not blocks:
        return {
            "retrieved_documents": "No NTNU documents matched the selected categories.",
            "files": [],
        }

    return {
        "retrieved_documents": "\n\n".join(blocks),
        "files": selected_files,
    }


def _build_all_documents_text(*, prompt_dir: str) -> dict[str, Any]:
    retrieval_map = _load_retrieval_map(prompt_dir)
    prompt_base = resolve_local_path(prompt_dir)
    kb_dir = prompt_base / "ntnu_knowledge_base"

    selected_files: list[str] = []
    blocks: list[str] = []

    for filename in retrieval_map.keys():
        file_path = kb_dir / filename
        if not file_path.exists():
            continue
        content = read_text(file_path, missing_ok=True).strip()
        if not content:
            continue
        selected_files.append(filename)
        blocks.append(f"### {filename}\n{content}")

    if not blocks:
        return {
            "retrieved_documents": "No NTNU knowledge base documents were available.",
            "files": [],
        }

    return {
        "retrieved_documents": "\n\n".join(blocks),
        "files": selected_files,
    }


def run_ntnu_initial_review(
    *,
    job_ad: str,
    candidate: dict[str, Any],
    context_question: str = "Initial NTNU policy review for this candidate.",
    model: str = DEFAULT_MODEL,
    key_name: str = "OPENAI_KEY",
    config_path: str = "prompts/CONFIG.txt",
    prompt_dir: str = DEFAULT_PROMPT_DIR,
    additional_instructions: str = "",
) -> dict[str, Any]:
    prompt_base = resolve_local_path(prompt_dir)
    system_prompt = read_text(prompt_base / "ntnu_system.txt")
    review_template = read_text(prompt_base / "ntnu_candidate_review.txt")
    extra = str(additional_instructions or "").strip()
    if extra:
        system_prompt = f"{system_prompt}\n\nADDITIONAL_INSTRUCTIONS:\n{extra}"

    routed = _route_categories(
        question=context_question,
        system_prompt=system_prompt,
        model=model,
        key_name=key_name,
        config_path=config_path,
        prompt_dir=prompt_dir,
    )
    docs = _build_all_documents_text(prompt_dir=prompt_dir)

    user_prompt = fill_template(
        review_template,
        {
            "retrieved_documents": docs["retrieved_documents"],
            "job_ad": str(job_ad or ""),
            "candidate": json_block(candidate),
        },
    )

    result = run_prompt(
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        model=model,
        key_name=key_name,
        config_path=config_path,
        timeout_seconds=DEFAULT_TIMEOUT_SECONDS,
        parse_error_message="NTNU assistant response did not contain a parsable JSON object",
    )

    return {
        **result,
        "routed_categories": routed["categories"],
        "retrieved_files": docs["files"],
        "retrieval": routed,
    }


def stream_ntnu_initial_review(
    *,
    job_ad: str,
    candidate: dict[str, Any],
    context_question: str = "Initial NTNU policy review for this candidate.",
    model: str = DEFAULT_MODEL,
    key_name: str = "OPENAI_KEY",
    config_path: str = "prompts/CONFIG.txt",
    prompt_dir: str = DEFAULT_PROMPT_DIR,
    additional_instructions: str = "",
) -> Iterator[dict[str, Any]]:
    prompt_base = resolve_local_path(prompt_dir)
    system_prompt = read_text(prompt_base / "ntnu_system.txt")
    review_template = read_text(prompt_base / "ntnu_candidate_review.txt")
    extra = str(additional_instructions or "").strip()
    if extra:
        system_prompt = f"{system_prompt}\n\nADDITIONAL_INSTRUCTIONS:\n{extra}"

    routed = _route_categories(
        question=context_question,
        system_prompt=system_prompt,
        model=model,
        key_name=key_name,
        config_path=config_path,
        prompt_dir=prompt_dir,
    )
    docs = _build_all_documents_text(prompt_dir=prompt_dir)

    user_prompt = fill_template(
        review_template,
        {
            "retrieved_documents": docs["retrieved_documents"],
            "job_ad": str(job_ad or ""),
            "candidate": json_block(candidate),
        },
    )

    for event in stream_prompt(
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        model=model,
        key_name=key_name,
        config_path=config_path,
        timeout_seconds=DEFAULT_TIMEOUT_SECONDS,
        parse_error_message="NTNU assistant response did not contain a parsable JSON object",
    ):
        if event.get("type") == "start":
            event = {
                **event,
                "routed_categories": routed["categories"],
                "retrieved_files": docs["files"],
            }
        yield event


def run_ntnu_policy_qa(
    *,
    question: str,
    chat_history: list[dict[str, Any]],
    job_ad: str = "",
    candidate: dict[str, Any] | None = None,
    model: str = DEFAULT_MODEL,
    key_name: str = "OPENAI_KEY",
    config_path: str = "prompts/CONFIG.txt",
    prompt_dir: str = DEFAULT_PROMPT_DIR,
    additional_instructions: str = "",
) -> dict[str, Any]:
    prompt_base = resolve_local_path(prompt_dir)
    system_prompt = read_text(prompt_base / "ntnu_system.txt")
    qa_template = read_text(prompt_base / "ntnu_policy.txt")
    extra = str(additional_instructions or "").strip()
    if extra:
        system_prompt = f"{system_prompt}\n\nADDITIONAL_INSTRUCTIONS:\n{extra}"

    history_text = "\n".join(
        [
            f"- {str(item.get('role', 'assistant')).upper()}: {str(item.get('text', ''))[:1200]}"
            for item in (chat_history or [])[-12:]
        ]
    )
    retrieval_question = f"{question}\n\nRECENT_CHAT_HISTORY:\n{history_text}" if history_text else question

    routed = _route_categories(
        question=retrieval_question,
        system_prompt=system_prompt,
        model=model,
        key_name=key_name,
        config_path=config_path,
        prompt_dir=prompt_dir,
    )
    docs = _build_retrieved_documents_text(categories=routed["categories"], prompt_dir=prompt_dir)

    user_prompt = fill_template(
        qa_template,
        {
            "retrieved_documents": docs["retrieved_documents"],
            "job_ad": str(job_ad or ""),
            "candidate": json_block(candidate or {}),
            "question": question,
        },
    )

    result = run_prompt(
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        model=model,
        key_name=key_name,
        config_path=config_path,
        timeout_seconds=DEFAULT_TIMEOUT_SECONDS,
        parse_error_message="NTNU assistant response did not contain a parsable JSON object",
    )

    return {
        **result,
        "routed_categories": routed["categories"],
        "retrieved_files": docs["files"],
        "retrieval": routed,
    }


def stream_ntnu_policy_qa(
    *,
    question: str,
    chat_history: list[dict[str, Any]],
    job_ad: str = "",
    candidate: dict[str, Any] | None = None,
    model: str = DEFAULT_MODEL,
    key_name: str = "OPENAI_KEY",
    config_path: str = "prompts/CONFIG.txt",
    prompt_dir: str = DEFAULT_PROMPT_DIR,
    additional_instructions: str = "",
) -> Iterator[dict[str, Any]]:
    prompt_base = resolve_local_path(prompt_dir)
    system_prompt = read_text(prompt_base / "ntnu_system.txt")
    qa_template = read_text(prompt_base / "ntnu_policy.txt")
    extra = str(additional_instructions or "").strip()
    if extra:
        system_prompt = f"{system_prompt}\n\nADDITIONAL_INSTRUCTIONS:\n{extra}"

    history_text = "\n".join(
        [
            f"- {str(item.get('role', 'assistant')).upper()}: {str(item.get('text', ''))[:1200]}"
            for item in (chat_history or [])[-12:]
        ]
    )
    retrieval_question = f"{question}\n\nRECENT_CHAT_HISTORY:\n{history_text}" if history_text else question

    routed = _route_categories(
        question=retrieval_question,
        system_prompt=system_prompt,
        model=model,
        key_name=key_name,
        config_path=config_path,
        prompt_dir=prompt_dir,
    )
    docs = _build_retrieved_documents_text(categories=routed["categories"], prompt_dir=prompt_dir)

    user_prompt = fill_template(
        qa_template,
        {
            "retrieved_documents": docs["retrieved_documents"],
            "job_ad": str(job_ad or ""),
            "candidate": json_block(candidate or {}),
            "question": question,
        },
    )

    for event in stream_prompt(
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        model=model,
        key_name=key_name,
        config_path=config_path,
        timeout_seconds=DEFAULT_TIMEOUT_SECONDS,
        parse_error_message="NTNU assistant response did not contain a parsable JSON object",
    ):
        if event.get("type") == "start":
            event = {
                **event,
                "routed_categories": routed["categories"],
                "retrieved_files": docs["files"],
            }
        yield event


def run_ntnu_final_audit(
    *,
    job_ad: str,
    selected_candidates: list[dict[str, Any]],
    ratings: dict[str, Any],
    rationales: dict[str, Any],
    sensitive_attributes: dict[str, Any] | None = None,
    context_question: str = "Final NTNU policy audit for selected candidates and evaluator rationales.",
    model: str = DEFAULT_MODEL,
    key_name: str = "OPENAI_KEY",
    config_path: str = "prompts/CONFIG.txt",
    prompt_dir: str = DEFAULT_PROMPT_DIR,
    additional_instructions: str = "",
) -> dict[str, Any]:
    prompt_base = resolve_local_path(prompt_dir)
    system_prompt = read_text(prompt_base / "ntnu_system.txt")
    audit_template = read_text(prompt_base / "ntnu_final_selection.txt")
    extra = str(additional_instructions or "").strip()
    if extra:
        system_prompt = f"{system_prompt}\n\nADDITIONAL_INSTRUCTIONS:\n{extra}"

    routed = _route_categories(
        question=context_question,
        system_prompt=system_prompt,
        model=model,
        key_name=key_name,
        config_path=config_path,
        prompt_dir=prompt_dir,
    )
    docs = _build_retrieved_documents_text(categories=routed["categories"], prompt_dir=prompt_dir)

    user_prompt = fill_template(
        audit_template,
        {
            "retrieved_documents": docs["retrieved_documents"],
            "job_ad": str(job_ad or ""),
            "selected_candidates": json_block(selected_candidates),
            "ratings": json_block(ratings),
            "rationales": json_block(rationales),
            "sensitive_attributes": json_block(sensitive_attributes or {}),
        },
    )

    result = run_prompt(
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        model=model,
        key_name=key_name,
        config_path=config_path,
        timeout_seconds=DEFAULT_TIMEOUT_SECONDS,
        parse_error_message="NTNU assistant response did not contain a parsable JSON object",
    )

    return {
        **result,
        "routed_categories": routed["categories"],
        "retrieved_files": docs["files"],
        "retrieval": routed,
    }


def stream_ntnu_final_audit(
    *,
    job_ad: str,
    selected_candidates: list[dict[str, Any]],
    ratings: dict[str, Any],
    rationales: dict[str, Any],
    sensitive_attributes: dict[str, Any] | None = None,
    context_question: str = "Final NTNU policy audit for selected candidates and evaluator rationales.",
    model: str = DEFAULT_MODEL,
    key_name: str = "OPENAI_KEY",
    config_path: str = "prompts/CONFIG.txt",
    prompt_dir: str = DEFAULT_PROMPT_DIR,
    additional_instructions: str = "",
) -> Iterator[dict[str, Any]]:
    prompt_base = resolve_local_path(prompt_dir)
    system_prompt = read_text(prompt_base / "ntnu_system.txt")
    audit_template = read_text(prompt_base / "ntnu_final_selection.txt")
    extra = str(additional_instructions or "").strip()
    if extra:
        system_prompt = f"{system_prompt}\n\nADDITIONAL_INSTRUCTIONS:\n{extra}"

    routed = _route_categories(
        question=context_question,
        system_prompt=system_prompt,
        model=model,
        key_name=key_name,
        config_path=config_path,
        prompt_dir=prompt_dir,
    )
    docs = _build_retrieved_documents_text(categories=routed["categories"], prompt_dir=prompt_dir)

    user_prompt = fill_template(
        audit_template,
        {
            "retrieved_documents": docs["retrieved_documents"],
            "job_ad": str(job_ad or ""),
            "selected_candidates": json_block(selected_candidates),
            "ratings": json_block(ratings),
            "rationales": json_block(rationales),
            "sensitive_attributes": json_block(sensitive_attributes or {}),
        },
    )

    for event in stream_prompt(
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        model=model,
        key_name=key_name,
        config_path=config_path,
        timeout_seconds=DEFAULT_TIMEOUT_SECONDS,
        parse_error_message="NTNU assistant response did not contain a parsable JSON object",
    ):
        if event.get("type") == "start":
            event = {
                **event,
                "routed_categories": routed["categories"],
                "retrieved_files": docs["files"],
            }
        yield event
