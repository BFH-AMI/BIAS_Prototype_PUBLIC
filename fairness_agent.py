from __future__ import annotations

from pathlib import Path
from typing import Any, Iterator

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
DEFAULT_MODEL = "gpt-5.4-mini"
DEFAULT_TIMEOUT_SECONDS = 90


def _run_fairness_prompt(
    *,
    mode_template_name: str,
    prompt_values: dict[str, Any],
    model: str = DEFAULT_MODEL,
    key_name: str = "OPENAI_KEY",
    config_path: str = "prompts/CONFIG.txt",
    prompt_dir: str = DEFAULT_PROMPT_DIR,
    timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
    additional_instructions: str = "",
) -> dict[str, Any]:
    prompt_base = resolve_local_path(prompt_dir)
    system_prompt = read_text(prompt_base / "fairness_assistant_system.txt")
    mode_template = read_text(prompt_base / mode_template_name)
    extra = str(additional_instructions or "").strip()
    if extra:
        system_prompt = f"{system_prompt}\n\nADDITIONAL_INSTRUCTIONS:\n{extra}"

    user_prompt = fill_template(
        mode_template,
        {k: json_block(v) if not isinstance(v, str) else str(v) for k, v in prompt_values.items()},
    )

    return run_prompt(
        model=model,
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        key_name=key_name,
        config_path=config_path,
        timeout_seconds=timeout_seconds,
        parse_error_message="Fairness agent response did not contain a parsable JSON object",
    )


def _stream_fairness_prompt(
    *,
    mode_template_name: str,
    prompt_values: dict[str, Any],
    model: str = DEFAULT_MODEL,
    key_name: str = "OPENAI_KEY",
    config_path: str = "prompts/CONFIG.txt",
    prompt_dir: str = DEFAULT_PROMPT_DIR,
    timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
    additional_instructions: str = "",
) -> Iterator[dict[str, Any]]:
    prompt_base = resolve_local_path(prompt_dir)
    system_prompt = read_text(prompt_base / "fairness_assistant_system.txt")
    mode_template = read_text(prompt_base / mode_template_name)
    extra = str(additional_instructions or "").strip()
    if extra:
        system_prompt = f"{system_prompt}\n\nADDITIONAL_INSTRUCTIONS:\n{extra}"

    user_prompt = fill_template(
        mode_template,
        {k: json_block(v) if not isinstance(v, str) else str(v) for k, v in prompt_values.items()},
    )

    yield from stream_prompt(
        model=model,
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        key_name=key_name,
        config_path=config_path,
        timeout_seconds=timeout_seconds,
        parse_error_message="Fairness agent response did not contain a parsable JSON object",
    )


def run_candidate_review(
    *,
    job_description: str,
    candidate_materials: dict[str, Any],
    candidate_summary: str = "",
    sensitive_attributes: dict[str, Any] | None = None,
    ratings: dict[str, Any] | None = None,
    notes: str = "",
    model: str = DEFAULT_MODEL,
    key_name: str = "OPENAI_KEY",
    config_path: str = "prompts/CONFIG.txt",
    prompt_dir: str = DEFAULT_PROMPT_DIR,
    additional_instructions: str = "",
) -> dict[str, Any]:
    return _run_fairness_prompt(
        mode_template_name="fairness_candidate_review.txt",
        prompt_values={
            "job_ad": job_description,
            "candidate_summary": candidate_summary or StringifyCandidateSummary(candidate_materials),
            "sensitive_attributes": sensitive_attributes or ExtractSensitiveAttributes(candidate_materials),
            "ratings": ratings or {},
            "notes": notes,
        },
        model=model,
        key_name=key_name,
        config_path=config_path,
        prompt_dir=prompt_dir,
        additional_instructions=additional_instructions,
    )


def stream_candidate_review(
    *,
    job_description: str,
    candidate_materials: dict[str, Any],
    candidate_summary: str = "",
    sensitive_attributes: dict[str, Any] | None = None,
    ratings: dict[str, Any] | None = None,
    notes: str = "",
    model: str = DEFAULT_MODEL,
    key_name: str = "OPENAI_KEY",
    config_path: str = "prompts/CONFIG.txt",
    prompt_dir: str = DEFAULT_PROMPT_DIR,
    additional_instructions: str = "",
) -> Iterator[dict[str, Any]]:
    return _stream_fairness_prompt(
        mode_template_name="fairness_candidate_review.txt",
        prompt_values={
            "job_ad": job_description,
            "candidate_summary": candidate_summary or StringifyCandidateSummary(candidate_materials),
            "sensitive_attributes": sensitive_attributes or ExtractSensitiveAttributes(candidate_materials),
            "ratings": ratings or {},
            "notes": notes,
        },
        model=model,
        key_name=key_name,
        config_path=config_path,
        prompt_dir=prompt_dir,
        additional_instructions=additional_instructions,
    )


def run_fairness_qa(
    *,
    user_question: str,
    candidate_or_selection_context: Any,
    model: str = DEFAULT_MODEL,
    key_name: str = "OPENAI_KEY",
    config_path: str = "prompts/CONFIG.txt",
    prompt_dir: str = DEFAULT_PROMPT_DIR,
    additional_instructions: str = "",
) -> dict[str, Any]:
    return _run_fairness_prompt(
        mode_template_name="fairness_QA.txt",
        prompt_values={
            # Keep both naming variants for template compatibility.
            "question": user_question,
            "optional_context": candidate_or_selection_context,
            "user_question": user_question,
            "candidate_or_selection_context": candidate_or_selection_context,
        },
        model=model,
        key_name=key_name,
        config_path=config_path,
        prompt_dir=prompt_dir,
        additional_instructions=additional_instructions,
    )


def stream_fairness_qa(
    *,
    user_question: str,
    candidate_or_selection_context: Any,
    model: str = DEFAULT_MODEL,
    key_name: str = "OPENAI_KEY",
    config_path: str = "prompts/CONFIG.txt",
    prompt_dir: str = DEFAULT_PROMPT_DIR,
    additional_instructions: str = "",
) -> Iterator[dict[str, Any]]:
    return _stream_fairness_prompt(
        mode_template_name="fairness_QA.txt",
        prompt_values={
            # Keep both naming variants for template compatibility.
            "question": user_question,
            "optional_context": candidate_or_selection_context,
            "user_question": user_question,
            "candidate_or_selection_context": candidate_or_selection_context,
        },
        model=model,
        key_name=key_name,
        config_path=config_path,
        prompt_dir=prompt_dir,
        additional_instructions=additional_instructions,
    )


def run_cross_candidate_audit(
    *,
    job_description: str,
    candidate_metadata: list[dict[str, Any]],
    sensitive_attributes: dict[str, Any],
    ratings: dict[str, Any],
    rationales: dict[str, str],
    model: str = DEFAULT_MODEL,
    key_name: str = "OPENAI_KEY",
    config_path: str = "prompts/CONFIG.txt",
    prompt_dir: str = DEFAULT_PROMPT_DIR,
    additional_instructions: str = "",
) -> dict[str, Any]:
    return _run_fairness_prompt(
        mode_template_name="fairness_x_candidate_audit.txt",
        prompt_values={
            "job_ad": job_description,
            "candidate_summaries": candidate_metadata,
            "sensitive_attributes": sensitive_attributes,
            "ratings": ratings,
            "rationales": rationales,
        },
        model=model,
        key_name=key_name,
        config_path=config_path,
        prompt_dir=prompt_dir,
        additional_instructions=additional_instructions,
    )


def stream_cross_candidate_audit(
    *,
    job_description: str,
    candidate_metadata: list[dict[str, Any]],
    sensitive_attributes: dict[str, Any],
    ratings: dict[str, Any],
    rationales: dict[str, str],
    model: str = DEFAULT_MODEL,
    key_name: str = "OPENAI_KEY",
    config_path: str = "prompts/CONFIG.txt",
    prompt_dir: str = DEFAULT_PROMPT_DIR,
    additional_instructions: str = "",
) -> Iterator[dict[str, Any]]:
    return _stream_fairness_prompt(
        mode_template_name="fairness_x_candidate_audit.txt",
        prompt_values={
            "job_ad": job_description,
            "candidate_summaries": candidate_metadata,
            "sensitive_attributes": sensitive_attributes,
            "ratings": ratings,
            "rationales": rationales,
        },
        model=model,
        key_name=key_name,
        config_path=config_path,
        prompt_dir=prompt_dir,
        additional_instructions=additional_instructions,
    )


def StringifyCandidateSummary(candidate_materials: dict[str, Any]) -> str:
    summary_text = candidate_materials.get("summary_text") if isinstance(candidate_materials, dict) else ""
    if isinstance(summary_text, str) and summary_text.strip():
        return summary_text
    return json_block(candidate_materials)


def ExtractSensitiveAttributes(candidate_materials: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(candidate_materials, dict):
        return {}
    sensitive = candidate_materials.get("sensitive_attributes_not_for_evaluation")
    if isinstance(sensitive, dict):
        return sensitive
    return {}
