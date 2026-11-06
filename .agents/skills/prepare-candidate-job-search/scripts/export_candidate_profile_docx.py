#!/usr/bin/env python3
"""Export a complete evidence-linked candidate profile as a reviewable DOCX."""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor


INK = RGBColor(32, 32, 32)
MUTED = RGBColor(90, 90, 90)
ACCENT = RGBColor(31, 78, 121)

CATEGORY_ORDER = [
    "identity",
    "location",
    "work_authorization",
    "language",
    "education",
    "certification",
    "experience",
    "performance_evidence",
    "skills",
    "system_exposure",
    "knowledge",
    "learning",
    "project",
    "document_preference",
]


def load_json(path: Path) -> dict:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"Expected a JSON object: {path}")
    return value


def set_run(run, *, size=None, bold=None, color=None, italic=None) -> None:
    run.font.name = "Arial"
    run._element.get_or_add_rPr().rFonts.set(qn("w:ascii"), "Arial")
    run._element.get_or_add_rPr().rFonts.set(qn("w:hAnsi"), "Arial")
    if size is not None:
        run.font.size = Pt(size)
    if bold is not None:
        run.bold = bold
    if color is not None:
        run.font.color.rgb = color
    if italic is not None:
        run.italic = italic


def add_page_number(paragraph) -> None:
    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = paragraph.add_run()
    begin = OxmlElement("w:fldChar")
    begin.set(qn("w:fldCharType"), "begin")
    instruction = OxmlElement("w:instrText")
    instruction.set(qn("xml:space"), "preserve")
    instruction.text = " PAGE "
    separate = OxmlElement("w:fldChar")
    separate.set(qn("w:fldCharType"), "separate")
    end = OxmlElement("w:fldChar")
    end.set(qn("w:fldCharType"), "end")
    run._r.extend([begin, instruction, separate, end])
    set_run(run, size=8, color=MUTED)


def configure(doc: Document) -> None:
    section = doc.sections[0]
    section.page_width = Cm(21)
    section.page_height = Cm(29.7)
    section.top_margin = Cm(1.7)
    section.bottom_margin = Cm(1.6)
    section.left_margin = Cm(1.9)
    section.right_margin = Cm(1.9)
    section.footer_distance = Cm(0.8)
    add_page_number(section.footer.paragraphs[0])

    normal = doc.styles["Normal"]
    normal.font.name = "Arial"
    normal._element.rPr.rFonts.set(qn("w:ascii"), "Arial")
    normal._element.rPr.rFonts.set(qn("w:hAnsi"), "Arial")
    normal.font.size = Pt(9.5)
    normal.font.color.rgb = INK
    normal.paragraph_format.space_after = Pt(4)
    normal.paragraph_format.line_spacing = 1.08

    for style_name, size, color in (
        ("Title", 22, INK),
        ("Heading 1", 15, ACCENT),
        ("Heading 2", 12, INK),
        ("Heading 3", 10.5, ACCENT),
    ):
        style = doc.styles[style_name]
        style.font.name = "Arial"
        style._element.rPr.rFonts.set(qn("w:ascii"), "Arial")
        style._element.rPr.rFonts.set(qn("w:hAnsi"), "Arial")
        style.font.size = Pt(size)
        style.font.bold = True
        style.font.color.rgb = color
        style.paragraph_format.keep_with_next = True
        style.paragraph_format.space_before = Pt(8 if style_name != "Title" else 0)
        style.paragraph_format.space_after = Pt(4)

    bullet = doc.styles["List Bullet"]
    bullet.font.name = "Arial"
    bullet.font.size = Pt(9.2)
    bullet.paragraph_format.space_after = Pt(2)


def humanize(identifier: str) -> str:
    return identifier.replace("_", " ").replace(".", " - ").strip().title()


def add_labeled(doc: Document, label: str, value: object, *, color=INK) -> None:
    paragraph = doc.add_paragraph()
    set_run(paragraph.add_run(f"{label}: "), size=9.2, bold=True, color=color)
    set_run(paragraph.add_run(str(value)), size=9.2, color=color)


def add_structured_value(doc: Document, value: object) -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            if isinstance(item, list):
                add_labeled(doc, humanize(str(key)), "")
                for entry in item:
                    paragraph = doc.add_paragraph(style="List Bullet")
                    set_run(paragraph.add_run(str(entry)), size=9.2)
            else:
                add_labeled(doc, humanize(str(key)), item)
    elif isinstance(value, list):
        for item in value:
            paragraph = doc.add_paragraph(style="List Bullet")
            set_run(paragraph.add_run(str(item)), size=9.2)
    else:
        paragraph = doc.add_paragraph()
        set_run(paragraph.add_run(str(value)), size=9.5)


def add_sources(doc: Document, sources: list) -> None:
    add_labeled(doc, "Evidence sources", "", color=MUTED)
    for source in sources:
        paragraph = doc.add_paragraph(style="List Bullet")
        paragraph.paragraph_format.left_indent = Cm(0.55)
        set_run(paragraph.add_run(str(source)), size=8.5, color=MUTED)


def add_fact(doc: Document, fact: dict) -> None:
    doc.add_heading(humanize(str(fact["id"])), level=2)
    meta = doc.add_paragraph()
    set_run(meta.add_run(f"Fact ID: {fact['id']}"), size=8.5, color=MUTED)
    set_run(meta.add_run(f"   |   Status: {fact['status']}"), size=8.5, bold=True, color=ACCENT)
    add_structured_value(doc, fact.get("value"))
    if fact.get("usage_constraint"):
        add_labeled(doc, "Usage constraint", fact["usage_constraint"], color=RGBColor(128, 74, 0))
    add_sources(doc, fact.get("sources", []))


def add_confirmation(doc: Document, item: dict) -> None:
    doc.add_heading(str(item.get("id", "confirmation")), level=3)
    add_labeled(doc, "Kind", item.get("kind"))
    add_labeled(doc, "Status", item.get("status"))
    add_labeled(doc, "Recorded at", item.get("recorded_at"))
    if item.get("question") is not None:
        add_labeled(doc, "Question", item.get("question"))
    add_labeled(doc, "Answer type", item.get("answer_type"))
    add_structured_value(doc, item.get("answer"))
    source = item.get("source", {})
    if source:
        add_labeled(doc, "Confirmation source", json.dumps(source, ensure_ascii=False, sort_keys=True))
    scope = item.get("scope", {})
    if scope:
        add_labeled(doc, "Scope", json.dumps(scope, ensure_ascii=False, sort_keys=True))


def build(profile: dict, confirmations: dict, output: Path, include_confirmation_ledger: bool = False) -> None:
    doc = Document()
    configure(doc)

    title = doc.add_paragraph(style="Title")
    set_run(title.add_run("Complete Candidate Master Profile"), size=22, bold=True)
    subtitle = doc.add_paragraph()
    set_run(subtitle.add_run(str(profile.get("candidate_id", ""))), size=13, bold=True, color=ACCENT)
    add_labeled(doc, "Profile as of", profile.get("as_of"))
    add_labeled(doc, "Schema version", profile.get("schema_version"))

    doc.add_heading("Purpose and editing guidance", level=1)
    guidance = (
        "This document is a complete evidence-linked information source for candidate review and refinement. "
        "It is not a CV and does not apply CV page limits or tailoring rules. Revise facts only when the candidate "
        "can confirm the change or provide supporting evidence; preserve the source and usage-constraint fields."
    )
    doc.add_paragraph(guidance)

    facts_by_category: dict[str, list[dict]] = defaultdict(list)
    for fact in profile.get("facts", []):
        facts_by_category[str(fact.get("category", "uncategorized"))].append(fact)
    categories = [c for c in CATEGORY_ORDER if c in facts_by_category]
    categories.extend(sorted(set(facts_by_category) - set(categories)))

    doc.add_heading("Evidence-linked facts", level=1)
    add_labeled(doc, "Total facts", len(profile.get("facts", [])))
    for category in categories:
        if category == "experience":
            timeline = [fact for fact in facts_by_category[category] if fact.get("timeline_role") is True]
            supporting = [fact for fact in facts_by_category[category] if fact.get("timeline_role") is not True]
            doc.add_heading("Career timeline", level=1)
            doc.add_paragraph(
                "Only the entries in this section are chronological employment roles. CV generators may use these "
                "facts to construct the employment timeline, subject to source and date validation."
            )
            for fact in timeline:
                add_fact(doc, fact)
            doc.add_heading("Experience details and boundaries", level=1)
            doc.add_paragraph(
                "These entries enrich, qualify, or limit the role facts above. They must not create additional "
                "positions or employment periods in a CV."
            )
            for fact in supporting:
                add_fact(doc, fact)
            continue
        doc.add_heading(humanize(category), level=1)
        for fact in facts_by_category[category]:
            add_fact(doc, fact)

    doc.add_heading("Conflicts", level=1)
    conflicts = profile.get("conflicts", [])
    if not conflicts:
        doc.add_paragraph("None recorded.")
    for conflict in conflicts:
        doc.add_heading(humanize(str(conflict.get("id", "conflict"))), level=2)
        add_structured_value(doc, conflict)

    doc.add_heading("Unverified claims", level=1)
    claims = profile.get("unverified_claims", [])
    if not claims:
        doc.add_paragraph("None recorded.")
    else:
        add_structured_value(doc, claims)

    if include_confirmation_ledger:
        doc.add_page_break()
        doc.add_heading("Candidate confirmation ledger", level=1)
        doc.add_paragraph(
            "The ledger below preserves the candidate's explicit statements, including active and superseded entries, "
            "so proposed edits can be checked against their original provenance."
        )
        add_labeled(doc, "Ledger as of", confirmations.get("as_of"))
        add_labeled(doc, "Total confirmations", len(confirmations.get("confirmations", [])))
        for item in confirmations.get("confirmations", []):
            add_confirmation(doc, item)

    core = doc.core_properties
    core.title = f"Complete Candidate Master Profile - {profile.get('candidate_id', '')}"
    core.subject = "Evidence-linked candidate information source for review and refinement"
    core.author = str(profile.get("candidate_id", ""))
    output.parent.mkdir(parents=True, exist_ok=True)
    doc.save(output)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile", type=Path, required=True)
    parser.add_argument("--confirmations", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--include-confirmation-ledger", action="store_true")
    args = parser.parse_args()
    build(load_json(args.profile), load_json(args.confirmations), args.output, args.include_confirmation_ledger)
    print(json.dumps({"output": str(args.output.resolve())}, ensure_ascii=False))


if __name__ == "__main__":
    main()
