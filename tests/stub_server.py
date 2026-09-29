from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any, Iterator

ROOT_DIR = Path(__file__).resolve().parents[2]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from webtool import app as app_module


def _configure_log_paths() -> None:
    log_dir = Path(os.environ.get("BIAS_TEST_LOG_DIR", ROOT_DIR / "webtool" / "test_artifacts" / "latest" / "logs"))
    log_dir.mkdir(parents=True, exist_ok=True)
    app_module.LOG_DIR = log_dir
    app_module.RANKING_LOG_PATH = log_dir / "head_to_head_rankings.jsonl"
    app_module.WORKFLOW_STAGE_LOG_PATH = log_dir / "workflow_stage_events.jsonl"
    app_module.USER_FEEDBACK_LOG_PATH = log_dir / "user_feedback_responses.jsonl"
    app_module.API_EVENT_LOG_PATH = log_dir / "api_events.jsonl"


def _build_llm_selection(all_candidates: list[dict[str, Any]], model: str) -> dict[str, Any]:
    shortlist = []
    longlist = []
    for index, row in enumerate(all_candidates[:10]):
        entry = {
            "application_id": str(row.get("application_id") or ""),
            "selection_reason": f"Stub LLM assessment ranked candidate {index + 1} for downstream review.",
        }
        if index < 5:
            shortlist.append(entry)
        else:
            longlist.append(entry)
    return {
        "model": model,
        "shortlist": shortlist,
        "longlist": longlist,
        "fallback_used": False,
        "fallback_reason": None,
    }


def _assistant_result(model: str, parsed_result: dict[str, Any], *, label: str) -> dict[str, Any]:
    response_text = json.dumps(parsed_result, ensure_ascii=False)
    return {
        "model": model,
        "prompt_system": f"stub {label} system prompt",
        "prompt_user": f"stub {label} user prompt",
        "response_text": response_text,
        "result": parsed_result,
    }


def _stream_result(
    response: dict[str, Any],
    *,
    routed_categories: list[str] | None = None,
    retrieved_files: list[str] | None = None,
) -> Iterator[dict[str, Any]]:
    start_event = {
        "type": "start",
        "model": response.get("model", "stub-model"),
        "timeout_seconds": 1,
        "prompt_system": response.get("prompt_system", ""),
        "prompt_user": response.get("prompt_user", ""),
    }
    if routed_categories is not None:
        start_event["routed_categories"] = routed_categories
    if retrieved_files is not None:
        start_event["retrieved_files"] = retrieved_files
    yield start_event
    yield {
        "type": "delta",
        "delta": str(response.get("response_text", "")),
        "response_text": str(response.get("response_text", "")),
    }
    yield {
        "type": "done",
        "result": response,
    }


def fake_evaluate_with_llm_selection(*, job_ad: str, all_candidates: list[dict[str, Any]], model: str, **_: Any) -> dict[str, Any]:
    return _build_llm_selection(all_candidates, model)


def fake_stream_with_llm_selection(*, job_ad: str, all_candidates: list[dict[str, Any]], model: str, **_: Any) -> Iterator[dict[str, Any]]:
    selection = _build_llm_selection(all_candidates, model)
    response_text = json.dumps(selection, ensure_ascii=False)
    yield {
        "type": "start",
        "model": model,
        "considered_candidates": len(all_candidates),
        "timeout_seconds": 1,
        "prompt_system": "stub llm system prompt",
        "prompt_user": f"stub llm user prompt for {len(all_candidates)} candidates",
    }
    yield {
        "type": "delta",
        "delta": response_text,
        "response_text": response_text,
    }
    yield {
        "type": "done",
        "llm_selection": selection,
    }


def fake_run_candidate_review(*, candidate_materials: dict[str, Any], model: str, **_: Any) -> dict[str, Any]:
    display_name = str(candidate_materials.get("display_name") or candidate_materials.get("application_id") or "candidate")
    parsed = {
        "summary": f"Stub fairness review for {display_name}.",
        "overall_note": "Keep publication evidence and justification consistency in view.",
        "fairness_flags": [
            {
                "type": "Consistency check",
                "description": "Verify that similarly evidenced candidates receive comparable overall ratings.",
                "what_to_check": "Compare justification quality against the saved document and summary ratings.",
            }
        ],
        "reflection_questions": [
            "Would the same evidence support the same score if the candidate were reviewed later in the session?"
        ],
    }
    return _assistant_result(model, parsed, label="fairness_candidate_review")


def fake_stream_candidate_review(*, candidate_materials: dict[str, Any], model: str, **kwargs: Any) -> Iterator[dict[str, Any]]:
    return _stream_result(fake_run_candidate_review(candidate_materials=candidate_materials, model=model, **kwargs))


def fake_run_fairness_qa(*, user_question: str, model: str, **_: Any) -> dict[str, Any]:
    parsed = {
        "summary": "Stub fairness trend review completed.",
        "answer": "The recorded decisions generally align with the current ordering, with one reminder to keep rationale language consistent.",
        "trends": [
            "Higher ranked candidates were consistently favored on research fit.",
            "Rationales stayed brief and role-focused across decisions.",
        ],
        "potential_risks": [
            "One rationale relied on generic strength language and should be made more specific."
        ],
        "key_considerations": [
            "Ensure the final written justification matches the strongest documented evidence."
        ],
    }
    return _assistant_result(model, parsed, label="fairness_qa")


def fake_stream_fairness_qa(*, user_question: str, model: str, **kwargs: Any) -> Iterator[dict[str, Any]]:
    return _stream_result(fake_run_fairness_qa(user_question=user_question, model=model, **kwargs))


def fake_run_cross_candidate_audit(*, model: str, **_: Any) -> dict[str, Any]:
    parsed = {
        "summary": "Stub fairness cross-candidate audit completed.",
        "issues": [
            {
                "type": "Documentation consistency",
                "description": "Review whether the written rationales distinguish clearly between top-ranked candidates.",
                "severity": "medium",
                "recommendation": "Expand one or two rationales with evidence from the application materials.",
            }
        ],
    }
    return _assistant_result(model, parsed, label="fairness_cross_candidate_audit")


def fake_stream_cross_candidate_audit(*, model: str, **kwargs: Any) -> Iterator[dict[str, Any]]:
    return _stream_result(fake_run_cross_candidate_audit(model=model, **kwargs))


def fake_run_ntnu_initial_review(*, candidate: dict[str, Any], model: str, **_: Any) -> dict[str, Any]:
    display_name = str(candidate.get("display_name") or candidate.get("application_id") or "candidate")
    parsed = {
        "summary": f"Stub NTNU review for {display_name}.",
        "must_check": ["Confirm that the applicant documentation set is complete before final decision."],
        "potential_issues": ["Verify any eligibility assumptions against the current PhD admission guidance."],
        "administrative_notes": ["Record the final shortlist rationale in the session report."],
        "ntnu_relevant_observations": ["The candidate summary suggests a plausible research fit."],
        "sources": ["phd_admission_guidelines.txt", "recruitment_policy.txt"],
    }
    response = _assistant_result(model, parsed, label="ntnu_initial_review")
    response["routed_categories"] = ["eligibility", "documentation"]
    response["retrieved_files"] = ["phd_admission_guidelines.txt", "recruitment_policy.txt"]
    return response


def fake_stream_ntnu_initial_review(*, candidate: dict[str, Any], model: str, **kwargs: Any) -> Iterator[dict[str, Any]]:
    response = fake_run_ntnu_initial_review(candidate=candidate, model=model, **kwargs)
    return _stream_result(
        response,
        routed_categories=response.get("routed_categories", []),
        retrieved_files=response.get("retrieved_files", []),
    )


def fake_run_ntnu_policy_qa(*, question: str, model: str, **_: Any) -> dict[str, Any]:
    parsed = {
        "answer": "Stub NTNU policy answer: verify shortlist documentation completeness and archive the decision rationale.",
        "confidence": "high",
        "key_points": ["Document the final reasoning.", "Check completeness before communication."],
        "supporting_documents": ["recruitment_policy.txt"],
        "sources": ["recruitment_policy.txt"],
    }
    response = _assistant_result(model, parsed, label="ntnu_policy_qa")
    response["routed_categories"] = ["documentation"]
    response["retrieved_files"] = ["recruitment_policy.txt"]
    return response


def fake_stream_ntnu_policy_qa(*, question: str, model: str, **kwargs: Any) -> Iterator[dict[str, Any]]:
    response = fake_run_ntnu_policy_qa(question=question, model=model, **kwargs)
    return _stream_result(
        response,
        routed_categories=response.get("routed_categories", []),
        retrieved_files=response.get("retrieved_files", []),
    )


def fake_run_ntnu_final_audit(*, model: str, **_: Any) -> dict[str, Any]:
    parsed = {
        "summary": "Stub NTNU final audit completed.",
        "candidate_flags": [
            {"candidate": "Top shortlist", "flag": "Confirm supporting documents before final communication."}
        ],
        "rationale_flags": [
            {"candidate": "Overall ranking", "flag": "Ensure the final written rationale cites application evidence."}
        ],
        "policy_notes": ["Archive the shortlist reasoning with the final decision package."],
        "sources": ["recruitment_policy.txt", "phd_admission_guidelines.txt"],
    }
    response = _assistant_result(model, parsed, label="ntnu_final_audit")
    response["routed_categories"] = ["documentation", "final_decision"]
    response["retrieved_files"] = ["recruitment_policy.txt", "phd_admission_guidelines.txt"]
    return response


def fake_stream_ntnu_final_audit(*, model: str, **kwargs: Any) -> Iterator[dict[str, Any]]:
    response = fake_run_ntnu_final_audit(model=model, **kwargs)
    return _stream_result(
        response,
        routed_categories=response.get("routed_categories", []),
        retrieved_files=response.get("retrieved_files", []),
    )


def configure_stubs() -> None:
    _configure_log_paths()
    app_module.evaluate_with_llm_selection = fake_evaluate_with_llm_selection
    app_module.stream_with_llm_selection = fake_stream_with_llm_selection
    app_module.run_candidate_review = fake_run_candidate_review
    app_module.stream_candidate_review = fake_stream_candidate_review
    app_module.run_fairness_qa = fake_run_fairness_qa
    app_module.stream_fairness_qa = fake_stream_fairness_qa
    app_module.run_cross_candidate_audit = fake_run_cross_candidate_audit
    app_module.stream_cross_candidate_audit = fake_stream_cross_candidate_audit
    app_module.run_ntnu_initial_review = fake_run_ntnu_initial_review
    app_module.stream_ntnu_initial_review = fake_stream_ntnu_initial_review
    app_module.run_ntnu_policy_qa = fake_run_ntnu_policy_qa
    app_module.stream_ntnu_policy_qa = fake_stream_ntnu_policy_qa
    app_module.run_ntnu_final_audit = fake_run_ntnu_final_audit
    app_module.stream_ntnu_final_audit = fake_stream_ntnu_final_audit


configure_stubs()
app = app_module.app


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("BIAS_TEST_PORT", "8010")))