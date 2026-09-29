# BIAS Prototype Webtool

FastAPI-based recruitment-evaluation webtool with CBR scoring, LLM-assisted preselection, fairness checks, and NTNU policy-assistant workflows. This folder is self-contained and can run as its own repository.

## 1. Quick Start with Temporary Public Sharing

Use Cloudflare Tunnel to share your local app with evaluators through a temporary public URL.

<!-- ```bash
python -m venv .venv
source .venv/bin/activate -->
```bash
python -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
uvicorn app:app --reload --host 127.0.0.1 --port 8000
```

Open http://127.0.0.1:8000/

## 2. Install cloudflared (one-time)

On macOS (Homebrew):

```bash
brew install cloudflared
```

## 3. Create a temporary public URL

In a second terminal:

```bash
cloudflared tunnel --url http://127.0.0.1:8000
```

Cloudflared will print a public `https://...trycloudflare.com` URL. Share that URL with your evaluation group.

## 4. Stop sharing

Press `Ctrl+C` in the tunnel terminal to disable the public URL.

## 5. One-command launcher (recommended)

You can start both the app and tunnel with one command:

```bash
chmod +x scripts/share.sh
./scripts/share.sh
```

This starts local uvicorn + Cloudflare Tunnel and prints a temporary public URL.

## 6. Remote Host Deployment (Linux/macOS)

Run behind a reverse proxy (Nginx/Caddy) and terminate TLS at the proxy.

### App process

```bash
python -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8000
```

Recommended production notes:
- Run the app with a process manager (systemd, supervisord, or container orchestration).
- Expose only the reverse-proxy port publicly.
- Keep app logs and generated JSONL artifacts outside version control.

## 7. Environment and Secrets

The application now resolves API keys in this order:
1. Environment variable matching the configured key name (default: `OPENAI_KEY`)
2. `OPENAI_API_KEY` (fallback for compatibility)
3. `prompts/CONFIG.txt` (local file fallback)

Recommended setup:

```bash
export OPENAI_KEY="your_real_openai_key"
```

If you prefer file-based local config, use `prompts/CONFIG.txt` with placeholders and never commit real values.

## 8. Temporary Sharing Notes

- Free tunnel URL: yes.
- OpenAI-backed features are not free if real API calls are used.
- Anyone with the URL can access the app while the tunnel is running.
- Keep sharing sessions time-limited and only while you supervise the run.
- Keep the app and tunnel terminals open during the evaluation.

## 9. Repository Security Hygiene

This repository is configured to ignore local secrets and generated logs via `.gitignore`, including:
- `prompts/CONFIG.txt`
- `logs/*.jsonl`
- `test_artifacts/latest/`

Before publishing externally:
- Rotate any previously exposed API keys.
- Remove sensitive files from git history if they were committed in the past.
- Review all data files under `data/` for privacy/compliance requirements.

## 10. Standalone Setup

1. Copy this `webtool` folder into a new repository.
2. Create and activate a Python virtual environment.
3. Install dependencies and run the app from the repository root.

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --reload --host 127.0.0.1 --port 8000
```

Open http://127.0.0.1:8000/

## 11. Runtime Data and Assets

- Candidate dataset: `data/jobs/STS_PhD_Position_2026/STS_PhD_Position_2026_applications_with_summaries.json`
- Agent prompts: `prompts/eval_agents/*.txt`
- Assistant prompts and NTNU KB: `prompts/eval_assistants/*`
- Frontend static assets: `static/*`
- Ranking logs output: `logs/head_to_head_rankings.jsonl`

## 12. Preparing Your Own Candidate Data

The app loads one JSON file for a job. By default, it looks for:

```text
data/jobs/<job_name>/<job_name>_applications_with_summaries.json
```

The file is a JSON object with job-level information and an `applications` array. Each array item represents one candidate. Keep `application_id` unique and stable; it is used to connect rankings, profiles, and feedback to the same candidate.

### Top-level fields

- `job_name` (string): descriptive job identifier. It does not change the runtime path by itself; update the path constants in `app.py` when switching datasets.
- `job_ad` (string): position description used as context by evaluation workflows.
- `applications` (array): candidate records. This should contain at least one record.

### Candidate fields

- `application_id` (string): unique candidate identifier. Required for consistent use across workflows.
- `materials` (object): source application content, such as `cv`, `transcript`, `motivation_letter`, `project_outline`, or `masters_thesis_abstract`. Use descriptive keys and string values; additional keys are allowed.
- `summary` (string or object): concise, evidence-based summary for screening and profile views. A plain-text string is simplest; a structured summary can also be supplied as an object.
- `cbr_features` (object): structured features for case-based reasoning (CBR) scoring. The four feature groups below are the canonical schema. Missing features are allowed, but more complete and consistently encoded features support more useful comparisons.
- `selection_ground_truth` (object, optional): reference decision for evaluation, not a substitute for application evidence. `label` can be `shortlist`, `longlist`, or `reject`.

The app computes candidate scores and feature breakdowns at runtime. Precomputed `scores` and `cbr_breakdown` fields are not required.

### CBR feature groups

Use numeric values for numeric fields, JSON booleans (`true`/`false`) for yes/no fields, and strings for descriptive fields. GPA and thesis grades ending in `_normalized_0_100` should be on a 0–100 scale.

- `education`: `highest_degree_completed`, `gpa_normalized_0_100`, `master_thesis_grade_normalized_0_100`, `bachelor_field`, `master_field`.
- `experience`: `years_research_experience`, `years_relevant_professional_experience`, `years_teaching_experience`, `career_gap_months`, `time_since_last_academic_activity_months`.
- `research_outputs`: `num_peer_reviewed_publications`, `num_first_author_publications`, `num_conference_outputs`, `num_posters_or_extended_abstracts`, `has_independent_research_output`.
- `skills_and_methods`: `has_quantitative_methods`, `has_qualitative_methods`, `has_programming_or_technical_skills`, `num_programming_languages`, `has_experimental_or_empirical_design`, `english_level`, `local_language_level`.

### Example

This is fictional sample data. Replace it with your own job and candidate records; do not include real personal data in a public repository.

```json
{
	"job_name": "example_research_role",
	"job_ad": "We are hiring a researcher with experience in qualitative methods and public policy.",
	"applications": [
		{
			"application_id": "candidate-001",
			"materials": {
				"cv": "Research assistant, 2022-2025. Conducted interviews and policy document analysis.",
				"motivation_letter": "I am applying because my research experience matches the role.",
				"masters_thesis_abstract": "A qualitative study of policy implementation in local government."
			},
			"summary": "MSc in public policy. Three years of research experience, including interviews and document analysis.",
			"cbr_features": {
				"education": {
					"highest_degree_completed": "Master of Science",
					"gpa_normalized_0_100": 86,
					"master_thesis_grade_normalized_0_100": 90,
					"bachelor_field": "Sociology",
					"master_field": "Public Policy"
				},
				"experience": {
					"years_research_experience": 3.0,
					"years_relevant_professional_experience": 2.0,
					"years_teaching_experience": 1.0,
					"career_gap_months": 0,
					"time_since_last_academic_activity_months": 0
				},
				"research_outputs": {
					"num_peer_reviewed_publications": 1,
					"num_first_author_publications": 1,
					"num_conference_outputs": 2,
					"num_posters_or_extended_abstracts": 0,
					"has_independent_research_output": true
				},
				"skills_and_methods": {
					"has_quantitative_methods": false,
					"has_qualitative_methods": true,
					"has_programming_or_technical_skills": false,
					"num_programming_languages": 0,
					"has_experimental_or_empirical_design": false,
					"english_level": "fluent",
					"local_language_level": "intermediate"
				}
			}
		}
	]
}
```

`cbr_features` may also include `sensitive_attributes_not_for_evaluation` for a locally controlled fairness review. Such data is not part of the four CBR scoring groups; avoid collecting or publishing it unless it is necessary, lawful, and properly protected. Use synthetic or anonymized examples in public repositories, and ensure you have an appropriate basis and safeguards before processing real applicant information.

To use a different job dataset, update the default job configuration in `app.py` or place your JSON file at the configured path. Keep the filename in the `<job_name>_applications_with_summaries.json` form when following the default convention.
chmod +x scripts/share.sh
./scripts/share.sh
```
