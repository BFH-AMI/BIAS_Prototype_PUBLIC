from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable
from urllib.error import URLError
from urllib.request import urlopen

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright

from reporting import build_pdf_report


ROOT_DIR = Path(__file__).resolve().parents[2]
ARTIFACT_DIR = ROOT_DIR / "webtool" / "test_artifacts" / "latest"
LOG_DIR = ARTIFACT_DIR / "logs"
RESULT_JSON_PATH = ARTIFACT_DIR / "workflow_test_results.json"
REPORT_PDF_PATH = ARTIFACT_DIR / "workflow_test_report.pdf"
SERVER_LOG_PATH = ARTIFACT_DIR / "stub_server_output.log"
PORT = int(os.environ.get("BIAS_TEST_PORT", "8010"))
BASE_URL = f"http://127.0.0.1:{PORT}"


class SuiteContext:
    def __init__(self, page):
        self.page = page
        self.initial_pool_count = 0
        self.modified_pool_count = 0
        self.reloaded_pool_count = 0
        self.workflow_session_id = ""


def reset_artifact_dir() -> None:
    if ARTIFACT_DIR.exists():
        shutil.rmtree(ARTIFACT_DIR)
    LOG_DIR.mkdir(parents=True, exist_ok=True)


def start_server() -> subprocess.Popen[str]:
    env = os.environ.copy()
    python_path = env.get("PYTHONPATH", "")
    env["PYTHONPATH"] = str(ROOT_DIR) if not python_path else f"{ROOT_DIR}{os.pathsep}{python_path}"
    env["BIAS_TEST_LOG_DIR"] = str(LOG_DIR)
    env["BIAS_TEST_PORT"] = str(PORT)
    handle = SERVER_LOG_PATH.open("w", encoding="utf-8")
    return subprocess.Popen(
        [sys.executable, str(ROOT_DIR / "webtool" / "tests" / "stub_server.py")],
        cwd=str(ROOT_DIR),
        env=env,
        stdout=handle,
        stderr=subprocess.STDOUT,
        text=True,
    )


def wait_for_server(timeout_seconds: int = 30) -> None:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        try:
            with urlopen(f"{BASE_URL}/api/overview", timeout=2) as response:
                if response.status == 200:
                    return
        except URLError:
            time.sleep(0.5)
    raise RuntimeError(f"Stub server did not become ready within {timeout_seconds} seconds.")


def stop_server(process: subprocess.Popen[str] | None) -> None:
    if process is None:
        return
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=10)


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        rows.append(json.loads(line))
    return rows


def run_case(results: list[dict[str, Any]], name: str, func: Callable[[], str | None]) -> None:
    start = time.time()
    try:
        detail = func() or ""
        results.append({
            "name": name,
            "status": "passed",
            "duration_seconds": round(time.time() - start, 3),
            "details": detail,
        })
    except Exception as exc:
        results.append({
            "name": name,
            "status": "failed",
            "duration_seconds": round(time.time() - start, 3),
            "details": f"{type(exc).__name__}: {exc}\n{traceback.format_exc()}",
        })


def expect(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def wait_for_stage_log_count(min_count: int, timeout_seconds: float = 5.0) -> None:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        if len(read_jsonl(LOG_DIR / "workflow_stage_events.jsonl")) >= min_count:
            return
        time.sleep(0.1)
    actual = len(read_jsonl(LOG_DIR / "workflow_stage_events.jsonl"))
    raise AssertionError(f"Expected at least {min_count} workflow stage events, found {actual}.")


def case_modify_pool_persists(ctx: SuiteContext) -> str:
    page = ctx.page
    page.goto(f"{BASE_URL}/config", wait_until="domcontentloaded")
    page.wait_for_selector("#continueConfigBtn")
    page.click("#continueConfigBtn")
    page.wait_for_url(f"{BASE_URL}/model-snapshot")
    page.wait_for_selector("#initialHeadToHeadList li")
    wait_for_stage_log_count(2)
    ctx.initial_pool_count = page.locator("#initialHeadToHeadList li").count()
    expect(ctx.initial_pool_count >= 2, "Initial head-to-head pool did not load.")

    page.click("#modifyHeadToHeadPoolBtn")
    page.wait_for_url(f"{BASE_URL}/candidate-profiles")
    page.wait_for_selector("#h2hPoolCandidatesList .profile-pool-chip")
    h2h_pool = page.locator("#h2hPoolCandidatesList .profile-pool-chip")
    expect(h2h_pool.count() == ctx.initial_pool_count, "Modify Pool did not start from the snapshot pool.")

    first_remove = page.locator("#h2hPoolCandidatesList .profile-pool-chip .profile-pool-chip-remove").first
    first_remove.click()
    page.wait_for_function(
        "expected => { try { return JSON.parse(localStorage.getItem('bias_h2h_candidates_v1') || '[]').length === expected; } catch { return false; } }",
        arg=ctx.initial_pool_count - 1,
    )
    ctx.modified_pool_count = int(page.evaluate("() => { try { return JSON.parse(localStorage.getItem('bias_h2h_candidates_v1') || '[]').length; } catch { return 0; } }"))
    expect(ctx.modified_pool_count == ctx.initial_pool_count - 1, "Pool removal did not persist on the Modify Pool page.")

    page.click("text=Return to Snapshot")
    page.wait_for_url(f"{BASE_URL}/model-snapshot")
    page.wait_for_function(
        "expected => document.querySelectorAll('#initialHeadToHeadList li').length === expected",
        arg=ctx.modified_pool_count,
    )
    snapshot_count = page.locator("#initialHeadToHeadList li").count()
    expect(snapshot_count == ctx.modified_pool_count, "Snapshot did not reflect the saved Modify Pool selection.")
    return f"Initial pool {ctx.initial_pool_count}; modified pool {ctx.modified_pool_count}; snapshot showed {snapshot_count}."


def case_backtracking_reloads_dependencies(ctx: SuiteContext) -> str:
    page = ctx.page
    page.goto(f"{BASE_URL}/config", wait_until="domcontentloaded")
    page.wait_for_selector("#wEducation")
    page.eval_on_selector(
        "#wEducation",
        "el => { el.value = '0.11'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }",
    )
    page.click("#continueConfigBtn")
    page.wait_for_url(f"{BASE_URL}/model-snapshot")
    page.wait_for_selector("#initialHeadToHeadList li")
    wait_for_stage_log_count(4)
    ctx.reloaded_pool_count = page.locator("#initialHeadToHeadList li").count()
    expect(ctx.modified_pool_count < ctx.initial_pool_count, "Modify Pool test precondition was not established.")
    expect(
        ctx.reloaded_pool_count == ctx.initial_pool_count,
        f"Expected a fresh pool of {ctx.initial_pool_count} after returning to Config, got {ctx.reloaded_pool_count}.",
    )
    return f"Pool reset from {ctx.modified_pool_count} back to {ctx.reloaded_pool_count} after Config change."


def case_finish_head_to_head(ctx: SuiteContext) -> str:
    page = ctx.page
    page.click("#continueToHeadToHeadBtn")
    page.wait_for_url(f"{BASE_URL}/head-to-head")
    page.wait_for_selector("#finishRoundsBtn")
    page.click("#finishRoundsBtn")
    page.wait_for_url(f"{BASE_URL}/top-candidates")
    page.wait_for_selector("#shortlistCandidatesList")
    wait_for_stage_log_count(7)
    shortlist_text = page.locator("#shortlistCandidatesList").text_content() or ""
    expect("No shortlisted candidates" not in shortlist_text, "Top Candidates page did not render a shortlist.")
    return "Head-to-Head finished and navigated to Top Candidates."


def case_candidate_ratings_and_audits(ctx: SuiteContext) -> str:
    page = ctx.page
    page.get_by_role("link", name="Go to Candidate Ratings").click()
    page.wait_for_url(f"{BASE_URL}/candidate-ratings")
    page.wait_for_selector("#ratingCandidateList .rating-candidate-tab")
    page.wait_for_function("() => (document.querySelector('#fairnessInitialReview')?.textContent || '').trim().length > 0")
    page.wait_for_function("() => (document.querySelector('#ntnuInitialReview')?.textContent || '').trim().length > 0")
    wait_for_stage_log_count(8)

    page.click("#ratingOverallStarsControl .rating-star-btn:nth-child(4)")
    page.fill("#ratingOverallJustification", "Automated regression rating justification.")
    page.dispatch_event("#ratingOverallJustification", "blur")
    page.click("#ratingSubmitEvaluationBtn")
    page.wait_for_function("() => (document.querySelector('#ratingSubmitEvaluationStatus')?.textContent || '').includes('saved')")

    page.click("#submitAllRatingsRunAuditsBtn")
    page.wait_for_url(f"{BASE_URL}/ratings-audits")
    page.wait_for_function("() => (document.querySelector('#ratingsAuditFairnessOutput')?.textContent || '').trim().length > 0")
    page.wait_for_function("() => (document.querySelector('#ratingsAuditNTNUOutput')?.textContent || '').trim().length > 0")
    wait_for_stage_log_count(9)
    return "Candidate Ratings saved and Ratings & Audits rendered both assistant outputs."


def case_feedback_submission(ctx: SuiteContext) -> str:
    page = ctx.page
    page.get_by_role("link", name="Go To User Feedback Questionnaire").click()
    page.wait_for_url(f"{BASE_URL}/feedback-questionnaire")
    page.wait_for_selector("#feedbackForm")
    wait_for_stage_log_count(10)
    page.fill("#feedbackRole", "Automated test reviewer")
    page.select_option("#feedbackExperience", "moderate")
    page.fill("#feedbackWorkflowStage", "Model snapshot, Modify Pool, candidate ratings, and audit summary.")
    page.check("input[name='quant_functionality'][value='4']")
    page.fill("#feedbackUsefulFeatures", "Modify Pool, candidate ratings, and audit summary.")
    page.select_option("#feedbackRecommendation", "yes")
    page.click("#feedbackSubmitBtn")
    page.wait_for_url(f"{BASE_URL}/feedback-confirmation?mode=submit")
    page.wait_for_selector("#feedbackConfirmationSummary")
    wait_for_stage_log_count(11)
    ctx.workflow_session_id = page.evaluate("() => localStorage.getItem('bias_workflow_session_id_v1') || ''")
    expect(bool(ctx.workflow_session_id), "Workflow session id was not captured from the browser state.")
    return f"Feedback submitted with workflow session id {ctx.workflow_session_id}."


def case_validate_logs(ctx: SuiteContext) -> str:
    workflow_logs = read_jsonl(LOG_DIR / "workflow_stage_events.jsonl")
    api_logs = read_jsonl(LOG_DIR / "api_events.jsonl")
    ranking_logs = read_jsonl(LOG_DIR / "head_to_head_rankings.jsonl")
    feedback_logs = read_jsonl(LOG_DIR / "user_feedback_responses.jsonl")

    expect(workflow_logs, "Workflow stage log file is empty.")
    expect(api_logs, "API event log file is empty.")
    expect(ranking_logs, "Ranking log file is empty.")
    expect(feedback_logs, "User feedback log file is empty.")

    session_logs = [row for row in workflow_logs if row.get("session_id") == ctx.workflow_session_id]
    expect(session_logs, "No workflow stage logs were recorded for the active browser session.")
    stage_actions = {(row.get("stage"), row.get("action")) for row in session_logs}
    expected_stage_actions = {
        ("config", "save_and_continue"),
        ("model_snapshot", "snapshot_ready"),
        ("head_to_head", "page_loaded"),
        ("head_to_head", "finish_rounds"),
        ("top_candidates", "page_loaded"),
        ("candidate_ratings", "page_loaded"),
        ("ratings_audits", "page_loaded"),
        ("feedback_questionnaire", "page_loaded"),
        ("feedback_confirmation", "page_loaded"),
    }
    missing_stage_actions = sorted(expected_stage_actions - stage_actions)
    expect(not missing_stage_actions, f"Missing workflow stage actions: {missing_stage_actions}")

    routes = {row.get("route") for row in api_logs}
    expected_routes = {
        "/api/run",
        "/api/llm-evaluate-stream",
        "/api/h2h/compute",
        "/api/fairness/qa-stream",
        "/api/fairness/candidate-review-stream",
        "/api/ntnu/candidate-review-stream",
        "/api/fairness/cross-candidate-audit-stream",
        "/api/ntnu/final-audit-stream",
        "/api/user-feedback",
        "/api/candidate-profile/{application_id}",
    }
    missing_routes = sorted(expected_routes - routes)
    expect(not missing_routes, f"Missing API log routes: {missing_routes}")

    latest_ranking = ranking_logs[-1]
    expect(len(latest_ranking.get("rankings", [])) >= 1, "Ranking log did not include ranked candidates.")

    latest_feedback = feedback_logs[-1]
    expect(
        str(((latest_feedback.get("feedback") or {}).get("role")) or "") == "Automated test reviewer",
        "User feedback log did not capture the submitted role field.",
    )

    return (
        f"Workflow logs={len(workflow_logs)}, API logs={len(api_logs)}, "
        f"ranking logs={len(ranking_logs)}, User feedback logs={len(feedback_logs)}."
    )


def build_summary(cases: list[dict[str, Any]]) -> dict[str, Any]:
    log_counts = {
        "workflow_stage_events": len(read_jsonl(LOG_DIR / "workflow_stage_events.jsonl")),
        "api_events": len(read_jsonl(LOG_DIR / "api_events.jsonl")),
        "ranking_events": len(read_jsonl(LOG_DIR / "head_to_head_rankings.jsonl")),
        "user_feedback_events": len(read_jsonl(LOG_DIR / "user_feedback_responses.jsonl")),
    }
    failed_count = sum(1 for case in cases if case["status"] != "passed")
    summary = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "base_url": BASE_URL,
        "overall_passed": failed_count == 0,
        "passed_count": sum(1 for case in cases if case["status"] == "passed"),
        "failed_count": failed_count,
        "cases": cases,
        "log_counts": log_counts,
        "artifacts": {
            "workflow_stage_log": str(LOG_DIR / "workflow_stage_events.jsonl"),
            "api_event_log": str(LOG_DIR / "api_events.jsonl"),
            "ranking_log": str(LOG_DIR / "head_to_head_rankings.jsonl"),
            "user_feedback_log": str(LOG_DIR / "user_feedback_responses.jsonl"),
            "server_output": str(SERVER_LOG_PATH),
            "result_json": str(RESULT_JSON_PATH),
            "report_pdf": str(REPORT_PDF_PATH),
        },
    }
    RESULT_JSON_PATH.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    build_pdf_report(RESULT_JSON_PATH, REPORT_PDF_PATH)
    return summary


def main() -> int:
    reset_artifact_dir()
    server = start_server()
    cases: list[dict[str, Any]] = []
    try:
        wait_for_server()
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            context = browser.new_context()
            page = context.new_page()
            page.set_default_timeout(30000)
            ctx = SuiteContext(page)

            run_case(cases, "Modify Pool persistence", lambda: case_modify_pool_persists(ctx))
            run_case(cases, "Backtracking reloads dependencies", lambda: case_backtracking_reloads_dependencies(ctx))
            run_case(cases, "Head-to-Head finish to Top Candidates", lambda: case_finish_head_to_head(ctx))
            run_case(cases, "Candidate Ratings and audits render", lambda: case_candidate_ratings_and_audits(ctx))
            run_case(cases, "Feedback submission completes", lambda: case_feedback_submission(ctx))
            run_case(cases, "Logs capture workflow inputs and outputs", lambda: case_validate_logs(ctx))

            context.close()
            browser.close()
    finally:
        stop_server(server)

    summary = build_summary(cases)
    print(json.dumps(summary, indent=2))
    return 0 if summary.get("overall_passed") else 1


if __name__ == "__main__":
    raise SystemExit(main())