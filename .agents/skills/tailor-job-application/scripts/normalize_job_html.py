#!/usr/bin/env python3
"""Extract a schema.org JobPosting record from saved HTML."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from html import unescape
from html.parser import HTMLParser


class JsonLdParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.capture = False
        self.buffer: list[str] = []
        self.scripts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if tag.lower() == "script" and values.get("type") == "application/ld+json":
            self.capture = True
            self.buffer = []

    def handle_data(self, data: str) -> None:
        if self.capture:
            self.buffer.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "script" and self.capture:
            self.scripts.append("".join(self.buffer))
            self.capture = False


class TextParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() == "li":
            self.parts.append("\n- ")
        elif tag.lower() in {"p", "br", "ul", "ol", "h1", "h2", "h3"}:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() in {"p", "li", "ul", "ol", "h1", "h2", "h3"}:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        self.parts.append(data)


def repair_text(value: str) -> str:
    value = value.replace("\\n", "\n")
    if any(marker in value for marker in ("枚", "鈥", "聽", "檔", "銆")):
        try:
            value = value.encode("gbk").decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            pass
    return value


def repair_value(value):
    if isinstance(value, str):
        return repair_text(value)
    if isinstance(value, list):
        return [repair_value(item) for item in value]
    if isinstance(value, dict):
        return {key: repair_value(item) for key, item in value.items()}
    return value


def find_job(source: str) -> dict:
    parser = JsonLdParser()
    parser.feed(source)
    for raw in parser.scripts:
        try:
            value = json.loads(raw)
        except json.JSONDecodeError:
            continue
        for item in value if isinstance(value, list) else [value]:
            if isinstance(item, dict) and item.get("@type") == "JobPosting":
                return repair_value(item)
    raise ValueError("No JobPosting JSON-LD record found")


def plain(fragment: str) -> str:
    parser = TextParser()
    parser.feed(unescape(repair_text(fragment)))
    text = "".join(parser.parts)
    text = re.sub(r"[ \t]+", " ", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def to_markdown(record: dict) -> str:
    org = record.get("hiringOrganization") or {}
    locations = []
    for location in record.get("jobLocation") or []:
        address = location.get("address") or {}
        locations.append(", ".join(x for x in [address.get("addressLocality"), address.get("addressCountry")] if x))
    return "\n".join([f"# {record.get('title', 'Untitled role')}", "", f"- Company: {org.get('name', '')}", f"- Location: {'; '.join(locations)}", f"- Posted: {record.get('datePosted', '')}", f"- Source: {record.get('url', '')}", "", "## Description", "", plain(record.get("description", "")), ""])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("html", type=Path)
    parser.add_argument("--json", dest="json_path", type=Path, required=True)
    parser.add_argument("--markdown", type=Path, required=True)
    args = parser.parse_args()
    record = find_job(args.html.read_text(encoding="utf-8", errors="replace"))
    args.json_path.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    args.markdown.write_text(to_markdown(record), encoding="utf-8")
    print(json.dumps({"title": record.get("title"), "url": record.get("url")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
