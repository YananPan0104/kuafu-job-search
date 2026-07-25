#!/usr/bin/env python3
"""Report structural ATS risks in a DOCX without modifying it."""

from __future__ import annotations

import argparse
import json
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}


def portable_path(path: Path, base_dir: Path) -> str:
    resolved = path.resolve()
    try:
        return resolved.relative_to(base_dir.resolve()).as_posix()
    except ValueError:
        return path.name


def audit(path: Path, base_dir: Path) -> dict:
    with zipfile.ZipFile(path) as archive:
        names = set(archive.namelist())
        root = ET.fromstring(archive.read("word/document.xml"))
        paragraphs = root.findall(".//w:p", NS)
        text = "\n".join("".join(n.text or "" for n in p.findall(".//w:t", NS)) for p in paragraphs)
        text_boxes = len(root.findall(".//w:txbxContent", NS))
        drawings = len(root.findall(".//w:drawing", NS))
        picts = len(root.findall(".//w:pict", NS))
        tables = len(root.findall(".//w:tbl", NS))
        images = sum(name.startswith("word/media/") for name in names)
    risks = []
    if text_boxes:
        risks.append("Critical content may be stored in text boxes and read out of order or omitted.")
    if drawings or picts:
        risks.append("Drawing or VML objects may disrupt extraction order.")
    if tables:
        risks.append("Tables can produce column-order ambiguity in some ATS parsers.")
    if images:
        risks.append("Image content is not machine-readable unless duplicated as text.")
    return {"file": portable_path(path, base_dir), "paragraph_count": len(paragraphs), "character_count": len(text), "text_box_count": text_boxes, "drawing_count": drawings, "vml_picture_count": picts, "table_count": tables, "embedded_image_count": images, "risks": risks}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("docx", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--base-dir", type=Path, default=Path.cwd())
    args = parser.parse_args()
    payload = json.dumps(audit(args.docx, args.base_dir), ensure_ascii=False, indent=2)
    if args.output:
        args.output.write_text(payload + "\n", encoding="utf-8")
    print(payload)


if __name__ == "__main__":
    main()
