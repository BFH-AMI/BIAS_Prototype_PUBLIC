from __future__ import annotations

import json
from pathlib import Path
from typing import TYPE_CHECKING, Any, Iterator

try:
    from webtool.llm_evaluator import load_api_key, make_openai_client
except ImportError:
    from llm_evaluator import load_api_key, make_openai_client  # type: ignore

if TYPE_CHECKING:
    from openai import OpenAI


MODULE_DIR = Path(__file__).resolve().parent


def resolve_local_path(path_str: str) -> Path:
    path = Path(path_str)
    if path.is_absolute():
        return path
    return MODULE_DIR / path


def read_text(path: Path, *, missing_ok: bool = False) -> str:
    if missing_ok and not path.exists():
        return ""
    return path.read_text(encoding="utf-8")


def json_block(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2)


def fill_template(template: str, mapping: dict[str, str]) -> str:
    output = template
    for key, value in mapping.items():
        output = output.replace(f"{{{key}}}", value)
    return output


def extract_json(text: str, *, error_message: str) -> dict[str, Any]:
    def _attempt_parse(source: str) -> dict[str, Any] | None:
        try:
            parsed = json.loads(source)
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            return None
        return None

    direct = _attempt_parse(text)
    if direct is not None:
        return direct

    decoder = json.JSONDecoder()
    best_obj: dict[str, Any] | None = None
    best_end = -1

    for idx, ch in enumerate(text):
        if ch != "{":
            continue
        try:
            parsed, end = decoder.raw_decode(text[idx:])
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict) and (idx + end) > best_end:
            best_obj = parsed
            best_end = idx + end

    if best_obj is not None:
        return best_obj

    raise ValueError(error_message)


def run_prompt(
    *,
    system_prompt: str,
    user_prompt: str,
    model: str,
    key_name: str,
    config_path: str,
    timeout_seconds: int,
    parse_error_message: str,
) -> dict[str, Any]:
    api_key = load_api_key(config_path=config_path, key_name=key_name)
    client: OpenAI = make_openai_client(api_key)

    response = client.responses.create(
        model=model,
        input=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        timeout=timeout_seconds,
    )

    response_text = str(getattr(response, "output_text", "") or "")
    parsed = extract_json(response_text, error_message=parse_error_message) if response_text else {}

    return {
        "model": model,
        "prompt_system": system_prompt,
        "prompt_user": user_prompt,
        "response_text": response_text,
        "result": parsed,
    }


def stream_prompt(
    *,
    system_prompt: str,
    user_prompt: str,
    model: str,
    key_name: str,
    config_path: str,
    timeout_seconds: int,
    parse_error_message: str,
) -> Iterator[dict[str, Any]]:
    response_text = ""
    parsed: dict[str, Any] = {}

    yield {
        "type": "start",
        "model": model,
        "timeout_seconds": timeout_seconds,
        "prompt_system": system_prompt,
        "prompt_user": user_prompt,
    }

    try:
        api_key = load_api_key(config_path=config_path, key_name=key_name)
        client: OpenAI = make_openai_client(api_key)
    except Exception as exc:
        yield {
            "type": "error",
            "error_type": type(exc).__name__,
            "error_message": str(exc),
        }
        yield {
            "type": "done",
            "result": {
                "model": model,
                "prompt_system": system_prompt,
                "prompt_user": user_prompt,
                "response_text": response_text,
                "result": parsed,
            },
        }
        return

    try:
        with client.responses.stream(
            model=model,
            input=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            timeout=timeout_seconds,
        ) as stream:
            for event in stream:
                if getattr(event, "type", "") == "response.output_text.delta":
                    delta = str(getattr(event, "delta", "") or "")
                    if delta:
                        response_text += delta
                        yield {
                            "type": "delta",
                            "delta": delta,
                            "response_text": response_text,
                        }
                elif getattr(event, "type", "") == "response.output_text.done":
                    done_text = str(getattr(event, "text", "") or "")
                    if done_text and len(done_text) > len(response_text):
                        response_text = done_text

            final_response = stream.get_final_response()
            final_output_text = str(getattr(final_response, "output_text", "") or "")
            if final_output_text and len(final_output_text) > len(response_text):
                response_text = final_output_text

        parsed = extract_json(response_text, error_message=parse_error_message) if response_text else {}
    except Exception as exc:
        yield {
            "type": "error",
            "error_type": type(exc).__name__,
            "error_message": str(exc),
        }

    yield {
        "type": "done",
        "result": {
            "model": model,
            "prompt_system": system_prompt,
            "prompt_user": user_prompt,
            "response_text": response_text,
            "result": parsed,
        },
    }