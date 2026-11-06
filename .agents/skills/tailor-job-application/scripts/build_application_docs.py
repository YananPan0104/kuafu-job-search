#!/usr/bin/env python3
"""Build approved ATS CV and cover-letter DOCX files from case configuration."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from docx import Document
from docx.enum.style import WD_STYLE_TYPE
from docx.enum.table import WD_ALIGN_VERTICAL, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor


INK = RGBColor(28, 28, 28)
MUTED = RGBColor(82, 82, 82)
ACCENT = RGBColor(31, 78, 121)
COVER_MUTED = RGBColor(89, 89, 89)


def require(mapping: dict, keys: set[str], label: str) -> None:
    missing = sorted(keys - mapping.keys())
    if missing:
        raise ValueError(f"{label} missing keys: {', '.join(missing)}")


def load_config(path: Path) -> dict:
    config = json.loads(path.read_text(encoding="utf-8"))
    require(config, {"schema_version", "case", "candidate", "cv", "cover_letter"}, "config")
    require(config["case"], {"case_id", "employer", "role_title", "location", "application_date"}, "case")
    require(config["candidate"], {"slug", "name", "location", "phone", "email", "work_authorization"}, "candidate")
    require(config["cv"], {"output_filename", "headline", "summary", "experience", "education", "skills", "certifications", "languages"}, "cv")
    require(config["cover_letter"], {"output_filename", "recipient_lines", "subject", "salutation", "paragraphs", "closing"}, "cover_letter")
    return config


def case_dir_from_config(config_path: Path) -> Path:
    if config_path.parent.name != "work":
        raise ValueError("Case configuration must be stored under <case>/work/")
    return config_path.parent.parent


def set_font(run, name: str, size=None, bold=None, italic=None, color=INK) -> None:
    run.font.name = name
    run._element.get_or_add_rPr().rFonts.set(qn("w:ascii"), name)
    run._element.get_or_add_rPr().rFonts.set(qn("w:hAnsi"), name)
    if size is not None:
        run.font.size = Pt(size)
    if bold is not None:
        run.bold = bold
    if italic is not None:
        run.italic = italic
    if color is not None:
        run.font.color.rgb = color


def set_paragraph_bottom_border(paragraph, color="B9C7D8", size="6", space="2") -> None:
    p_pr = paragraph._p.get_or_add_pPr()
    p_bdr = p_pr.find(qn("w:pBdr"))
    if p_bdr is None:
        p_bdr = OxmlElement("w:pBdr")
        p_pr.append(p_bdr)
    bottom = OxmlElement("w:bottom")
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), size)
    bottom.set(qn("w:space"), space)
    bottom.set(qn("w:color"), color)
    p_bdr.append(bottom)


def configure_cv_styles(doc: Document) -> None:
    font = "Arial"
    section = doc.sections[0]
    section.page_width = Cm(21.0)
    section.page_height = Cm(29.7)
    section.top_margin = Cm(1.1)
    section.bottom_margin = Cm(1.1)
    section.left_margin = Cm(1.6)
    section.right_margin = Cm(1.6)
    section.header_distance = Cm(0.7)
    section.footer_distance = Cm(0.7)

    styles = doc.styles
    normal = styles["Normal"]
    normal.font.name = font
    normal._element.rPr.rFonts.set(qn("w:ascii"), font)
    normal._element.rPr.rFonts.set(qn("w:hAnsi"), font)
    normal.font.size = Pt(9.2)
    normal.font.color.rgb = INK
    normal.paragraph_format.space_before = Pt(0)
    normal.paragraph_format.space_after = Pt(1.6)
    normal.paragraph_format.line_spacing = 1.03

    for style_name, size in (("Heading 1", 11.5), ("Heading 2", 10.2)):
        style = styles[style_name]
        style.font.name = font
        style._element.rPr.rFonts.set(qn("w:ascii"), font)
        style._element.rPr.rFonts.set(qn("w:hAnsi"), font)
        style.font.size = Pt(size)
        style.font.bold = True
        style.font.color.rgb = ACCENT if style_name == "Heading 1" else INK
        style.paragraph_format.keep_with_next = True
    styles["Heading 1"].paragraph_format.space_before = Pt(5)
    styles["Heading 1"].paragraph_format.space_after = Pt(2)
    styles["Heading 2"].paragraph_format.space_before = Pt(4)
    styles["Heading 2"].paragraph_format.space_after = Pt(1)

    bullet = styles["List Bullet"]
    bullet.font.name = font
    bullet._element.rPr.rFonts.set(qn("w:ascii"), font)
    bullet._element.rPr.rFonts.set(qn("w:hAnsi"), font)
    bullet.font.size = Pt(9.2)
    # Keep bullets visibly separated from the role heading and body text.
    # A larger hanging indent avoids the cramped first two experience blocks
    # that can result when long bullets wrap across several lines.
    bullet.paragraph_format.left_indent = Cm(0.62)
    bullet.paragraph_format.first_line_indent = Cm(-0.32)
    bullet.paragraph_format.space_after = Pt(0.8)
    bullet.paragraph_format.line_spacing = 1.02

    role = styles["Role"] if "Role" in styles else styles.add_style("Role", WD_STYLE_TYPE.PARAGRAPH)
    role.font.name = font
    role._element.rPr.rFonts.set(qn("w:ascii"), font)
    role._element.rPr.rFonts.set(qn("w:hAnsi"), font)
    role.font.size = Pt(9.8)
    role.font.bold = True
    role.font.color.rgb = INK
    role.paragraph_format.space_before = Pt(3)
    role.paragraph_format.space_after = Pt(1)
    role.paragraph_format.keep_with_next = True


def add_cv_section(doc: Document, title: str) -> None:
    paragraph = doc.add_paragraph(style="Heading 1")
    paragraph.add_run(title.upper())
    set_paragraph_bottom_border(paragraph)


def add_cv_role(doc: Document, item: dict) -> None:
    paragraph = doc.add_paragraph(style="Role")
    set_font(paragraph.add_run(item["title"]), "Arial", size=9.8, bold=True)
    set_font(paragraph.add_run(f" | {item['organization']} | {item['dates']}"), "Arial", size=9.3, bold=False, color=MUTED)


def add_cv_bullet(doc: Document, text: str) -> None:
    paragraph = doc.add_paragraph(style="List Bullet")
    paragraph.paragraph_format.keep_together = True
    set_font(paragraph.add_run(text), "Arial", size=9.2)


def add_cv_labeled_line(doc: Document, label: str, value: str) -> None:
    paragraph = doc.add_paragraph()
    paragraph.paragraph_format.space_after = Pt(1.3)
    set_font(paragraph.add_run(f"{label}: "), "Arial", size=9.2, bold=True)
    set_font(paragraph.add_run(value), "Arial", size=9.2)


def add_cv_project(doc: Document, item: dict) -> None:
    require(item, {"title", "bullets"}, "cv project item")
    paragraph = doc.add_paragraph(style="Role")
    set_font(paragraph.add_run(item["title"]), "Arial", size=9.8, bold=True)
    context = item.get("context")
    dates = item.get("dates")
    suffix = " | ".join(value for value in (context, dates) if value)
    if suffix:
        set_font(paragraph.add_run(f" | {suffix}"), "Arial", size=9.3, color=MUTED)
    for bullet in item["bullets"]:
        add_cv_bullet(doc, bullet)


def resolve_cv_photo(candidate: dict, case_dir: Path) -> Path | None:
    configured = candidate.get("cv_photo_path")
    if configured:
        path = Path(configured)
        resolved = path if path.is_absolute() else (case_dir / path).resolve()
        if not resolved.is_file():
            raise FileNotFoundError(f"Configured CV photo does not exist: {resolved}")
        return resolved

    if len(case_dir.parents) < 2:
        return None
    profile_dir = case_dir.parents[1] / "discovery" / candidate["slug"]
    profile_path = profile_dir / "candidate-profile.json"
    if not profile_path.is_file():
        return None
    profile = json.loads(profile_path.read_text(encoding="utf-8"))
    for fact in profile.get("facts", []):
        if fact.get("id") != "document.cv_photo" or fact.get("status") != "verified":
            continue
        value = fact.get("value")
        if not isinstance(value, dict) or not value.get("enabled"):
            return None
        asset = value.get("asset")
        if not isinstance(asset, str) or not asset:
            raise ValueError("document.cv_photo must define a non-empty asset path")
        resolved = (profile_dir / asset).resolve()
        if not resolved.is_file():
            raise FileNotFoundError(f"Profile CV photo does not exist: {resolved}")
        return resolved
    return None


def remove_table_borders(table) -> None:
    tbl_pr = table._tbl.tblPr
    borders = tbl_pr.find(qn("w:tblBorders"))
    if borders is None:
        borders = OxmlElement("w:tblBorders")
        tbl_pr.append(borders)
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        element = OxmlElement(f"w:{edge}")
        element.set(qn("w:val"), "nil")
        borders.append(element)


def add_cv_identity(doc: Document, candidate: dict, cv: dict, photo_path: Path | None) -> None:
    if photo_path is None:
        name = doc.add_paragraph()
        name.alignment = WD_ALIGN_PARAGRAPH.CENTER
        name.paragraph_format.space_after = Pt(0)
        set_font(name.add_run(candidate["name"]), "Arial", size=20, bold=True, color=RGBColor(0, 0, 0))

        headline = doc.add_paragraph()
        headline.alignment = WD_ALIGN_PARAGRAPH.CENTER
        headline.paragraph_format.space_after = Pt(2)
        set_font(headline.add_run(cv["headline"]), "Arial", size=10.4, bold=True, color=ACCENT)

        contact = doc.add_paragraph()
        contact.alignment = WD_ALIGN_PARAGRAPH.CENTER
        contact.paragraph_format.space_after = Pt(5)
        contact_text = " | ".join([candidate["location"], candidate["phone"], candidate["email"]])
        set_font(contact.add_run(contact_text), "Arial", size=8.9, color=MUTED)

        authorization = doc.add_paragraph()
        authorization.alignment = WD_ALIGN_PARAGRAPH.CENTER
        authorization.paragraph_format.space_after = Pt(3)
        set_font(authorization.add_run(" | ".join(candidate["work_authorization"])), "Arial", size=8.8, color=MUTED)
        return

    table = doc.add_table(rows=1, cols=2)
    table.alignment = WD_TABLE_ALIGNMENT.LEFT
    table.autofit = False
    remove_table_borders(table)
    table.columns[0].width = Cm(2.75)
    table.columns[1].width = Cm(15.05)
    photo_cell, text_cell = table.rows[0].cells
    photo_cell.width = Cm(2.75)
    text_cell.width = Cm(15.05)
    photo_cell.vertical_alignment = WD_ALIGN_VERTICAL.TOP
    text_cell.vertical_alignment = WD_ALIGN_VERTICAL.CENTER

    photo_paragraph = photo_cell.paragraphs[0]
    photo_paragraph.alignment = WD_ALIGN_PARAGRAPH.LEFT
    photo_paragraph.paragraph_format.space_after = Pt(0)
    photo_paragraph.add_run().add_picture(str(photo_path), width=Cm(2.35))

    name = text_cell.paragraphs[0]
    name.alignment = WD_ALIGN_PARAGRAPH.LEFT
    name.paragraph_format.space_after = Pt(0)
    set_font(name.add_run(candidate["name"]), "Arial", size=20, bold=True, color=RGBColor(0, 0, 0))

    headline = text_cell.add_paragraph()
    headline.paragraph_format.space_after = Pt(3)
    set_font(headline.add_run(cv["headline"]), "Arial", size=10.4, bold=True, color=ACCENT)

    contact = text_cell.add_paragraph()
    contact.paragraph_format.space_after = Pt(2)
    contact_text = " | ".join([candidate["location"], candidate["phone"], candidate["email"]])
    set_font(contact.add_run(contact_text), "Arial", size=8.9, color=MUTED)

    authorization = text_cell.add_paragraph()
    authorization.paragraph_format.space_after = Pt(0)
    set_font(authorization.add_run(" | ".join(candidate["work_authorization"])), "Arial", size=8.8, color=MUTED)


def build_cv(config: dict, case_dir: Path, output_override: Path | None = None) -> Path:
    candidate = config["candidate"]
    cv = config["cv"]
    doc = Document()
    configure_cv_styles(doc)
    add_cv_identity(doc, candidate, cv, resolve_cv_photo(candidate, case_dir))

    add_cv_section(doc, "Professional Summary")
    summary = doc.add_paragraph()
    summary.paragraph_format.space_after = Pt(3)
    set_font(summary.add_run(cv["summary"]), "Arial", size=9.2)

    add_cv_section(doc, "Professional Experience")
    for item in cv["experience"]:
        require(item, {"title", "organization", "dates", "bullets"}, "cv experience item")
        add_cv_role(doc, item)
        for bullet in item["bullets"]:
            add_cv_bullet(doc, bullet)

    add_cv_section(doc, "Education")
    for item in cv["education"]:
        require(item, {"degree", "institution", "dates"}, "cv education item")
        add_cv_role(doc, {"title": item["degree"], "organization": item["institution"], "dates": item["dates"]})
        if item.get("details"):
            add_cv_labeled_line(doc, item.get("details_label", "Selected coursework"), item["details"])

    if cv.get("projects"):
        add_cv_section(doc, cv.get("projects_section_title", "Selected Projects"))
        for item in cv["projects"]:
            add_cv_project(doc, item)

    add_cv_section(doc, "Skills")
    for group in cv["skills"]:
        add_cv_labeled_line(doc, group["label"], group["value"])

    add_cv_section(doc, "Certifications & Languages")
    add_cv_labeled_line(doc, "Certifications", cv["certifications"])
    add_cv_labeled_line(doc, "Languages", cv["languages"])

    metadata = cv.get("metadata", {})
    core = doc.core_properties
    core.title = metadata.get("title", f"{candidate['name']} - ATS CV")
    core.subject = metadata.get("subject", config["case"]["role_title"])
    core.author = metadata.get("author", candidate["name"])
    core.keywords = metadata.get("keywords", "")

    output = output_override or case_dir / "output" / cv["output_filename"]
    output.parent.mkdir(parents=True, exist_ok=True)
    doc.save(output)
    return output


def configure_cover_letter(doc: Document) -> None:
    font = "Calibri"
    section = doc.sections[0]
    section.page_width = Cm(21.0)
    section.page_height = Cm(29.7)
    section.top_margin = Cm(1.5)
    section.bottom_margin = Cm(1.5)
    section.left_margin = Cm(2.25)
    section.right_margin = Cm(2.25)
    section.header_distance = Cm(1.25)
    section.footer_distance = Cm(1.25)
    normal = doc.styles["Normal"]
    normal.font.name = font
    normal._element.rPr.rFonts.set(qn("w:ascii"), font)
    normal._element.rPr.rFonts.set(qn("w:hAnsi"), font)
    normal.font.size = Pt(10.5)
    normal.paragraph_format.space_before = Pt(0)
    normal.paragraph_format.space_after = Pt(6)
    normal.paragraph_format.line_spacing = 1.15


def add_cover_paragraph(doc: Document, text="", *, size=10.5, after=6, line_spacing=1.15, bold=False, color=None) -> object:
    paragraph = doc.add_paragraph()
    paragraph.alignment = WD_ALIGN_PARAGRAPH.LEFT
    paragraph.paragraph_format.space_before = Pt(0)
    paragraph.paragraph_format.space_after = Pt(after)
    paragraph.paragraph_format.line_spacing = line_spacing
    if text:
        set_font(paragraph.add_run(text), "Calibri", size=size, bold=bold, color=color)
    return paragraph


def build_cover_letter(config: dict, case_dir: Path, output_override: Path | None = None) -> Path:
    candidate = config["candidate"]
    case = config["case"]
    letter = config["cover_letter"]
    doc = Document()
    configure_cover_letter(doc)

    add_cover_paragraph(doc, candidate["name"], size=20, after=2, bold=True, color=ACCENT)
    add_cover_paragraph(doc, " | ".join([candidate["location"], candidate["phone"], candidate["email"]]), size=10, after=1, color=COVER_MUTED, line_spacing=1.0)
    add_cover_paragraph(doc, " | ".join(candidate["work_authorization"]), size=10, after=12, color=COVER_MUTED, line_spacing=1.0)
    add_cover_paragraph(doc, case["application_date"], size=10, after=10, line_spacing=1.0)
    for index, line in enumerate(letter["recipient_lines"]):
        add_cover_paragraph(doc, line, size=10, after=10 if index == len(letter["recipient_lines"]) - 1 else 0, line_spacing=1.0)
    add_cover_paragraph(doc, letter["subject"], size=11, after=10, line_spacing=1.0, bold=True, color=ACCENT)
    add_cover_paragraph(doc, letter["salutation"], after=8, line_spacing=1.0)
    for paragraph in letter["paragraphs"]:
        add_cover_paragraph(doc, paragraph)
    add_cover_paragraph(doc, letter["closing"], after=18, line_spacing=1.0)
    add_cover_paragraph(doc, candidate["name"], after=0, line_spacing=1.0, bold=True)

    metadata = letter.get("metadata", {})
    core = doc.core_properties
    core.title = metadata.get("title", f"Cover Letter - {case['role_title']}")
    core.subject = metadata.get("subject", f"Application to {case['employer']}")
    core.author = metadata.get("author", candidate["name"])
    core.keywords = metadata.get("keywords", "")

    output = output_override or case_dir / "output" / letter["output_filename"]
    output.parent.mkdir(parents=True, exist_ok=True)
    doc.save(output)
    return output


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("config", type=Path)
    parser.add_argument("--document", choices=("cv", "cover-letter", "all"), default="all")
    parser.add_argument("--cv-output", type=Path)
    parser.add_argument("--cover-letter-output", type=Path)
    args = parser.parse_args()

    config_path = args.config.resolve()
    config = load_config(config_path)
    case_dir = case_dir_from_config(config_path)
    outputs = {}
    if args.document in {"cv", "all"}:
        outputs["cv"] = str(build_cv(config, case_dir, args.cv_output))
    if args.document in {"cover-letter", "all"}:
        outputs["cover_letter"] = str(build_cover_letter(config, case_dir, args.cover_letter_output))
    print(json.dumps(outputs, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
