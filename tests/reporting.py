from __future__ import annotations

import json
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


def build_pdf_report(summary_path: str | Path, output_path: str | Path) -> Path:
    summary_file = Path(summary_path)
    output_file = Path(output_path)
    payload = json.loads(summary_file.read_text(encoding="utf-8"))

    styles = getSampleStyleSheet()
    story = []
    story.append(Paragraph("BIAS Webtool Automated Test Report", styles["Title"]))
    story.append(Spacer(1, 0.3 * cm))
    story.append(Paragraph(f"Generated: {payload.get('generated_at', 'unknown')}", styles["Normal"]))
    story.append(Paragraph(f"Base URL: {payload.get('base_url', 'unknown')}", styles["Normal"]))
    story.append(Paragraph(f"Overall status: {'PASSED' if payload.get('overall_passed') else 'FAILED'}", styles["Normal"]))
    story.append(Spacer(1, 0.4 * cm))

    summary_rows = [["Metric", "Value"]]
    summary_rows.append(["Passed cases", str(payload.get("passed_count", 0))])
    summary_rows.append(["Failed cases", str(payload.get("failed_count", 0))])
    summary_rows.append(["Workflow stage log entries", str((payload.get("log_counts") or {}).get("workflow_stage_events", 0))])
    summary_rows.append(["API event log entries", str((payload.get("log_counts") or {}).get("api_events", 0))])
    summary_rows.append(["Ranking log entries", str((payload.get("log_counts") or {}).get("ranking_events", 0))])
    summary_rows.append(["User feedback log entries", str((payload.get("log_counts") or {}).get("user_feedback_events", 0))])
    summary_table = Table(summary_rows, colWidths=[7 * cm, 8 * cm])
    summary_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#dbeafe")),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    story.append(summary_table)
    story.append(Spacer(1, 0.5 * cm))

    case_rows = [["Case", "Status", "Duration (s)", "Details"]]
    for case in payload.get("cases", []):
      case_rows.append([
          str(case.get("name", "unnamed")),
          str(case.get("status", "unknown")),
          f"{float(case.get('duration_seconds', 0.0)):.2f}",
          str(case.get("details", ""))[:2200],
      ])
    case_table = Table(case_rows, colWidths=[5.0 * cm, 2.2 * cm, 2.4 * cm, 6.4 * cm], repeatRows=1)
    case_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e5e7eb")),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    story.append(Paragraph("Case Results", styles["Heading2"]))
    story.append(case_table)
    story.append(Spacer(1, 0.5 * cm))

    artifacts = payload.get("artifacts", {})
    artifact_rows = [["Artifact", "Path"]]
    for label, path in sorted(artifacts.items()):
        artifact_rows.append([str(label), str(path)])
    artifact_table = Table(artifact_rows, colWidths=[4.2 * cm, 10.8 * cm], repeatRows=1)
    artifact_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#fef3c7")),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    story.append(Paragraph("Generated Artifacts", styles["Heading2"]))
    story.append(artifact_table)

    output_file.parent.mkdir(parents=True, exist_ok=True)
    doc = SimpleDocTemplate(str(output_file), pagesize=A4, leftMargin=1.6 * cm, rightMargin=1.6 * cm, topMargin=1.5 * cm, bottomMargin=1.5 * cm)
    doc.build(story)
    return output_file