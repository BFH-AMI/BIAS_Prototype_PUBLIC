from urllib import error
from typing import Any

import pandas as pd
import streamlit as st

try:
    from webtool.h2h_core import compute_h2h_state
    from webtool.h2h_data import (
        load_candidates_from_api,
        load_candidates_from_local,
        normalize_weights,
    )
except ImportError:
    from h2h_core import compute_h2h_state  # type: ignore
    from h2h_data import (  # type: ignore
        load_candidates_from_api,
        load_candidates_from_local,
        normalize_weights,
    )


def init_state(application_ids: list[str]):
    current_signature = "|".join(application_ids)
    if st.session_state.get("candidate_signature") != current_signature:
        st.session_state.candidate_signature = current_signature
        st.session_state.comparisons = []

    if "comparisons" not in st.session_state:
        st.session_state.comparisons = []


def candidate_map(candidates: list[dict[str, str]]):
    return {c["id"]: c for c in candidates}


def _to_h2h_candidates(candidates: list[dict[str, str]]) -> list[dict[str, float | str]]:
    return [
        {
            "application_id": candidate["id"],
            "name": candidate.get("name", candidate["id"]),
            "baseline_score": candidate.get("baseline_score", 0.0),
        }
        for candidate in candidates
    ]


def ranking_table():
    candidates = _to_h2h_candidates(st.session_state.active_candidates)
    h2h_state = compute_h2h_state(
        candidates=candidates,
        comparisons=st.session_state.comparisons,
        eta=0.05,
        id_key="application_id",
        exclude_top6_vs_top6=True,
    )
    rows = h2h_state.get("rows", [])
    scores = h2h_state.get("scores", {})
    return pd.DataFrame(rows).sort_values("score", ascending=False), scores


def choose_next_pair():
    candidates = _to_h2h_candidates(st.session_state.active_candidates)
    h2h_state = compute_h2h_state(
        candidates=candidates,
        comparisons=st.session_state.comparisons,
        eta=0.05,
        id_key="application_id",
        exclude_top6_vs_top6=True,
    )
    pair = h2h_state.get("next_pair")
    mode = h2h_state.get("mode", "fallback")
    if isinstance(pair, list) and len(pair) == 2:
        return (str(pair[0]), str(pair[1])), str(mode)

    ids = [c["id"] for c in st.session_state.active_candidates]
    if len(ids) >= 2:
        return (ids[0], ids[1]), str(mode)
    return ("", ""), "insufficient_pool"


def record_choice(left_id, right_id, winner_id, rationale):
    loser_id = right_id if winner_id == left_id else left_id

    st.session_state.comparisons.append(
        {
            "left": left_id,
            "right": right_id,
            "winner": winner_id,
            "loser": loser_id,
            "rationale": rationale.strip(),
        }
    )


def reliability_message(h2h_state: dict[str, Any]):
    completed = int(h2h_state.get("completed_eligible_pairs", 0))
    eligible = int(h2h_state.get("eligible_pair_count", 0))
    remaining = int(h2h_state.get("remaining_eligible_pairs", 0))
    if eligible <= 0:
        return "No eligible pairs available for comparison."
    if remaining > 0:
        return f"{completed}/{eligible} eligible comparisons completed."
    return f"All eligible comparisons completed ({completed}/{eligible})."


def main():
    st.set_page_config(page_title="Head-to-head PhD Candidate Comparison", layout="wide")

    st.sidebar.header("Data Source")
    api_base_url = st.sidebar.text_input("Webtool API base URL", value="http://127.0.0.1:8000")

    st.sidebar.header("CBR Weights")
    w_education = st.sidebar.slider("Education", min_value=0.0, max_value=1.0, value=0.24, step=0.01)
    w_experience = st.sidebar.slider("Experience", min_value=0.0, max_value=1.0, value=0.28, step=0.01)
    w_outputs = st.sidebar.slider("Research outputs", min_value=0.0, max_value=1.0, value=0.22, step=0.01)
    w_methods = st.sidebar.slider("Skills and methods", min_value=0.0, max_value=1.0, value=0.26, step=0.01)
    pool_size = st.sidebar.slider("Pool size from /api/run", min_value=2, max_value=20, value=10, step=1)

    cbr_weights = {
        "education": w_education,
        "experience": w_experience,
        "research_outputs": w_outputs,
        "skills_and_methods": w_methods,
    }
    cbr_weights = normalize_weights(cbr_weights)

    try:
        all_candidates = load_candidates_from_api(api_base_url, cbr_weights, pool_size)
        source_label = f"Using /api/run pool from {api_base_url}"
    except (error.URLError, TimeoutError, KeyError, ValueError) as exc:
        st.sidebar.warning(f"API unavailable, using local file fallback. ({exc})")
        all_candidates = load_candidates_from_local()
        source_label = "Using local applications file fallback"

    if len(all_candidates) < 2:
        st.error("Need at least 2 candidates to run head-to-head comparisons.")
        return

    st.caption(source_label)

    default_ids = [c["id"] for c in all_candidates[:10]]
    selected_ids = st.sidebar.multiselect(
        "Select candidates for comparison",
        options=[c["id"] for c in all_candidates],
        default=default_ids,
    )

    if len(selected_ids) < 2:
        st.warning("Select at least 2 candidates in the sidebar.")
        return

    active_candidates = [c for c in all_candidates if c["id"] in selected_ids]
    st.session_state.active_candidates = active_candidates

    init_state([c["id"] for c in active_candidates])

    st.title("Head-to-head candidate comparison")

    shared_h2h_state = compute_h2h_state(
        candidates=_to_h2h_candidates(active_candidates),
        comparisons=st.session_state.comparisons,
        eta=0.05,
        id_key="application_id",
        exclude_top6_vs_top6=True,
    )

    st.caption(reliability_message(shared_h2h_state))

    pair, mode = choose_next_pair()
    left_id, right_id = pair
    cmap = candidate_map(active_candidates)
    st.caption(f"Comparison mode: {mode}")

    st.subheader("Current comparison")

    col1, col2 = st.columns(2)

    with col1:
        st.markdown(f"### {cmap[left_id]['name']}")
        st.markdown(cmap[left_id]["summary"])

    with col2:
        st.markdown(f"### {cmap[right_id]['name']}")
        st.markdown(cmap[right_id]["summary"])

    st.divider()

    choice = st.radio(
        "Which candidate should be preferred in this comparison?",
        options=[left_id, right_id],
        format_func=lambda cid: cmap[cid]["name"],
        horizontal=True,
    )

    rationale = st.text_area(
        "Brief rationale for this choice",
        placeholder="Example: Stronger methodological fit and more feasible project design.",
        height=100,
    )

    if st.button("Submit comparison"):
        if not rationale.strip():
            st.warning("Please add a brief rationale.")
        else:
            record_choice(left_id, right_id, choice, rationale)
            st.rerun()

    st.divider()

    st.subheader("Current ranking")
    table, _ = ranking_table()
    st.dataframe(table, use_container_width=True)

    final_six = table.head(6)
    st.caption(f"Tentative top 6 after the current round: {', '.join(final_six['name'].tolist())}")

    with st.expander("Comparison log"):
        st.json(st.session_state.comparisons)

    if st.button("Reset all comparisons"):
        st.session_state.clear()
        st.rerun()


if __name__ == "__main__":
    main()