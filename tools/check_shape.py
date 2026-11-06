#!/usr/bin/env python3
"""Check the one-app/two-host repository boundary, without inspecting build outputs.

The static top-level allowlist is the directory set at main 7ad1895402bc5320dfbaf0be4009b81c6df037ed,
plus the authorised ios/ host and standard/. Adding another top-level directory requires agreement;
do not regenerate this list from whatever a change happens to introduce.

Run from anywhere: python3 tools/check_shape.py [--root REPOSITORY]. Git's tracked
files and untracked, unignored working files are checked. A tracked file is checked
even if a later ignore rule matches it. Ignored, untracked bundles/icons are omitted.
Native catalog metadata is allowed; web source and visual/font assets belong in
src/ or brand/ and enter ios/ only as ignored build outputs. Exact copies of engine
or brand asset bytes are also rejected when renamed. This is a layout/source check,
not proof that differently rewritten code or a generated file has the right origin.
"""
from __future__ import annotations

import argparse
import hashlib
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys


ALLOWED_TOP_LEVEL_DIRS = frozenset({
    ".github", "apps-script", "brand", "data", "docs", "fixtures", "merchants",
    "period-close", "portals", "skills", "sources", "src", "tax", "tools", "ios",
    "standard",  # the household data standard; agreed for the Records tab, which reads its generated view
})
WEB_EXTENSIONS = frozenset({
    ".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".html", ".htm",
    ".css", ".scss", ".sass", ".less",
})
VISUAL_EXTENSIONS = frozenset({
    ".svg", ".png", ".jpg", ".jpeg", ".gif", ".apng", ".webp", ".avif",
    ".heic", ".ico", ".icns", ".ttf", ".otf", ".woff", ".woff2",
})
BRAND_EXTENSIONS = WEB_EXTENSIONS | VISUAL_EXTENSIONS | {".json", ".pdf"}
GENERATED_SWIFT_DIR = PurePosixPath("ios/Kitty/Generated")
HEX_COLOR = re.compile(r"(?<![\w#])#[0-9a-fA-F]{8}(?!\w)|(?<![\w#])#[0-9a-fA-F]{6}(?!\w)"
                       r"|(?<![\w#])#[0-9a-fA-F]{4}(?!\w)|(?<![\w#])#[0-9a-fA-F]{3}(?!\w)"
                       r"|\b0[xX](?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6})\b")
SF_SYMBOL = re.compile(r"\b(?:systemName|systemImage|systemImageName)`?\s*:")


def git(root: Path, *arguments: str, input_bytes: bytes | None = None,
        allowed_codes: tuple[int, ...] = (0,)) -> bytes:
    result = subprocess.run(["git", "-C", str(root), *arguments], input=input_bytes,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    if result.returncode not in allowed_codes:
        raise RuntimeError(result.stderr.decode("utf-8", errors="replace").strip()
                           or f"git {' '.join(arguments)} failed")
    return result.stdout


def swift_views(source: str) -> tuple[str, str]:
    """Keep line positions, omit comments, and separately mask string contents.

    This small lexer understands nested Swift comments and ordinary/raw/multiline
    strings, including interpolation, so a URL does not hide the next initializer
    and documentation examples do not count as API calls. This is not a full Swift
    parser or a validation of the source's syntax.
    """
    visible, code = list(source), list(source)
    n = len(source)

    def blank(start: int, end: int, strings: bool = False) -> None:
        for j in range(start, end):
            if source[j] not in "\r\n":
                code[j] = " "
                if not strings:
                    visible[j] = " "

    def string(start: int, quote: int) -> int:
        hashes = source[start:quote]
        delimiter = '"""' if source.startswith('"""', quote) else '"'
        closing, escape = delimiter + hashes, "\\" + hashes
        i, span = quote + len(delimiter), start
        while i < n:
            if source.startswith(closing, i):
                i += len(closing)
                break
            if source.startswith(escape + "(", i):
                blank(span, i + len(escape) + 1, strings=True)
                i = scan(i + len(escape) + 1, interpolation=True)
                span = i
            elif source.startswith(escape, i):
                i = min(n, i + len(escape) + 1)
            else:
                i += 1
        blank(span, i, strings=True)
        return i

    def scan(i: int, interpolation: bool = False) -> int:
        depth = 1
        while i < n:
            if source.startswith("//", i):
                end = source.find("\n", i)
                end = n if end < 0 else end
                blank(i, end); i = end
            elif source.startswith("/*", i):
                start, comment_depth = i, 1
                i += 2
                while i < n and comment_depth:
                    if source.startswith("/*", i):
                        comment_depth += 1; i += 2
                    elif source.startswith("*/", i):
                        comment_depth -= 1; i += 2
                    else:
                        i += 1
                blank(start, i)
            else:
                quote = i
                while quote < n and source[quote] == "#":
                    quote += 1
                if quote < n and source[quote] == '"':
                    i = string(i, quote)
                elif interpolation and source[i] == "(":
                    depth += 1; i += 1
                elif interpolation and source[i] == ")":
                    depth -= 1; i += 1
                    if not depth:
                        return i
                else:
                    i += 1
        return i

    scan(0)
    return "".join(visible), "".join(code)


def inspect_repository(root: Path) -> tuple[list[str], int]:
    root = root.resolve()
    actual = Path(git(root, "rev-parse", "--show-toplevel").decode().strip()).resolve()
    if actual != root:
        raise RuntimeError(f"Use the repository root: {actual}")
    names = sorted(set(name.decode("utf-8", errors="surrogateescape") for name in
                       git(root, "ls-files", "--cached", "--others", "--exclude-standard", "-z").split(b"\0") if name))
    names = [name for name in names if (root / name).exists() or (root / name).is_symlink()]
    errors: set[str] = set()
    unknown_dirs = {PurePosixPath(name).parts[0] for name in names
                    if len(PurePosixPath(name).parts) > 1
                    and PurePosixPath(name).parts[0] not in ALLOWED_TOP_LEVEL_DIRS}
    # Empty directories cannot be committed, but catch an unignored new one locally.
    candidates = [p.name for p in root.iterdir()
                  if p.name != ".git" and p.is_dir() and p.name not in ALLOWED_TOP_LEVEL_DIRS]
    if candidates:
        query = b"".join((name + "/").encode("utf-8", errors="surrogateescape") + b"\0" for name in candidates)
        ignored = {name.decode("utf-8", errors="surrogateescape").rstrip("/") for name in
                   git(root, "check-ignore", "--no-index", "-z", "--stdin", input_bytes=query,
                       allowed_codes=(0, 1)).split(b"\0") if name}
        unknown_dirs.update(set(candidates) - ignored)
    for name in unknown_dirs:
        errors.add(f"{name}/: new top-level directory; use the existing layout or obtain agreement before extending it")

    originals: dict[bytes, str] = {}
    for name in names:
        relative, path = PurePosixPath(name), root / name
        if name == "src/engine.js" or (relative.parts[0] == "brand" and relative.suffix.lower() in BRAND_EXTENSIONS):
            if path.is_file() and not path.is_symlink():
                data = path.read_bytes()
                if data:
                    originals[hashlib.sha256(data).digest()] = name

    for name in names:
        relative, path = PurePosixPath(name), root / name
        ios = relative.parts[0] == "ios"
        if path.is_symlink() and (ios or relative.suffix.lower() == ".swift"):
            errors.add(f"{name}: source/asset symlinks cannot be checked; bundle from src/ and brand/ into ignored output instead")
            continue
        if not path.is_file():
            if ios and path.is_dir():
                errors.add(f"{name}: nested repository content under ios cannot be checked; keep native source directly in this repository")
            continue  # Deleted tracked files are not working-tree content.
        suffix = relative.suffix.lower()
        if ios and (suffix in WEB_EXTENSIONS or suffix in VISUAL_EXTENSIONS
                    or (suffix == ".pdf" and any(p.endswith(".xcassets") for p in relative.parts))):
            errors.add(f"{name}: web/visual/font source under ios; keep its source in src/ or brand/ and gitignore generated bundle/icon output")
            continue
        data = path.read_bytes() if ios or suffix == ".swift" else None
        if ios:
            original = originals.get(hashlib.sha256(data).digest())
            if original:
                errors.add(f"{name}: copied bytes from {original}; build an ignored output from the shared source instead")
        if suffix != ".swift" or relative.parent == GENERATED_SWIFT_DIR:
            continue
        try:
            source = data.decode("utf-8")
        except UnicodeDecodeError:
            errors.add(f"{name}: Swift source is not UTF-8 and cannot be checked")
            continue
        visible, code = swift_views(source)
        for match in HEX_COLOR.finditer(visible):
            line = source.count("\n", 0, match.start()) + 1
            errors.add(f"{name}:{line}: raw hex color {match.group()}; request a semantic generated brand token")
        for match in SF_SYMBOL.finditer(code):
            line = source.count("\n", 0, match.start()) + 1
            errors.add(f"{name}:{line}: SF Symbol API {match.group().strip()}; request a semantic generated brand icon")
    return sorted(errors), len(names)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args(argv)
    try:
        errors, count = inspect_repository(args.root)
    except (OSError, RuntimeError) as error:
        print(f"Shape check could not run: {error}", file=sys.stderr)
        return 2
    if errors:
        print("The Kitty shape check failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    print(f"The Kitty shape check passed ({count} tracked or unignored files).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
