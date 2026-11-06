#!/usr/bin/env python3
"""Fail if a tracked file holds something that points at a real person or a private place.

Run from anywhere: python3 tools/check_public.py [--root REPOSITORY]. It looks for three shapes:
a home-directory path, an email address outside the reserved .example domain, and a Google document
link other than the fictional sheets in kitty.config.json.

A list of real names cannot live in a public repository, so a maintainer keeps one elsewhere and points
KITTY_PRIVATE_TERMS at it, one term per line. Every term is matched without regard to case. Passing
this check does not prove data is fictional. It catches the common slips.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys


HOME_PATH = re.compile(r"(?:/Users/[A-Za-z0-9._-]+|/home/[a-z0-9._-]+/|[A-Za-z]:\\Users\\|~/(?:Documents|Developer|Library)\b)")
EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})\b")
GOOGLE_DOC = re.compile(r"(?:docs|drive)\.google\.com/[a-z/]*?(?:d|folders)/([A-Za-z0-9_-]{25,})")
ALLOWED_MAIL_HOSTS = ("example", "example.com", "example.org", "example.net")
ALLOWED_MAIL_SERVICE = frozenset({"www.googleapis.com"})  # an OAuth scope written as a path, not an address
HOME_PATH_RULES = frozenset({"tools/check_public.py", "tools/test_check.py"})  # they spell the shapes they look for


def tracked(root: Path) -> list[str]:
    listed = subprocess.run(["git", "-C", str(root), "ls-files", "-z"], check=True,
                            stdout=subprocess.PIPE).stdout.decode()
    return [name for name in listed.split("\0") if name]


def private_terms() -> list[str]:
    path = os.environ.get("KITTY_PRIVATE_TERMS")
    if not path:
        return []
    return [line.strip().lower() for line in Path(path).read_text().splitlines() if line.strip()]


def fictional_documents(root: Path) -> frozenset[str]:
    config = json.loads((root / "kitty.config.json").read_text())
    return frozenset(value for key, value in config.items() if key.endswith("sheet") and value)


def mail_allowed(host: str) -> bool:
    host = host.lower()
    return host in ALLOWED_MAIL_SERVICE or any(host == end or host.endswith("." + end) for end in ALLOWED_MAIL_HOSTS)


def findings(name: str, text: str, documents: frozenset[str], terms: list[str]) -> list[str]:
    found = []
    for number, line in enumerate(text.splitlines(), 1):
        where = f"{name}:{number}"
        if name not in HOME_PATH_RULES:
            found += [f"{where}: a home-directory path" for _ in HOME_PATH.finditer(line)]
            found += [f"{where}: an address at {m.group(1)}" for m in EMAIL.finditer(line) if not mail_allowed(m.group(1))]
            found += [f"{where}: a Google document that is not a fictional sheet" for m in GOOGLE_DOC.finditer(line)
                      if m.group(1) not in documents]
        lowered = line.lower()
        found += [f"{where}: a private term" for term in terms if term in lowered]
    return found


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--root", default=Path(__file__).resolve().parent.parent, type=Path)
    root = parser.parse_args().root.resolve()
    documents, terms, found = fictional_documents(root), private_terms(), []
    names = tracked(root)
    for name in names:
        try:
            text = (root / name).read_text(encoding="utf-8")
        except (UnicodeDecodeError, IsADirectoryError, FileNotFoundError):
            continue  # binary files, or a deletion not yet committed
        found += findings(name, text, documents, terms)
    if found:
        print("\n".join(found))
        print(f"\n{len(found)} finding(s). Only shapes reach this repository, never anyone's data: see CONTRIBUTING.md.")
        return 1
    print(f"Nothing private found in {len(names)} tracked files ({len(terms)} private terms checked).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
