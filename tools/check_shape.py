#!/usr/bin/env python3
"""Check the one-app/one-host repository boundary, without inspecting build outputs.

The static top-level allowlist is the directory set at main 7ad1895402bc5320dfbaf0be4009b81c6df037ed,
plus standard/, life/, evidence/ and template/, each agreed later. ios/ left the list on 8 Nov 2026,
when the iOS host was retired. Adding another top-level directory requires agreement;
do not regenerate this list from whatever a change happens to introduce.

Run from anywhere: python3 tools/check_shape.py [--root REPOSITORY]. Git's tracked
files and untracked, unignored working files are checked. A tracked file is checked
even if a later ignore rule matches it. Ignored, untracked build outputs are omitted.
The engine (src/engine.js) and the brand assets (brand/) each have one source: an exact
copy of their bytes anywhere else is rejected, even when renamed. Build an ignored output
from the shared source instead. This is a layout/source check, not proof that differently
rewritten code or a generated file has the right origin.
"""
from __future__ import annotations

import argparse
import hashlib
from pathlib import Path, PurePosixPath
import subprocess
import sys


ALLOWED_TOP_LEVEL_DIRS = frozenset({
    ".github", "apps-script", "brand", "data", "docs", "fixtures", "merchants",
    "period-close", "portals", "skills", "sources", "src", "tax", "tools",
    "standard",  # the household data standard; agreed for the Records tab, which reads its generated view
    "life",  # the fictional family and their chapters; agreed in the programme brief, a good first read
    "evidence", "template",  # agreed 7 Nov 2026 in the re-founding: the runs behind FINDINGS.md, and the blank Sheet's contract
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
ENGINE = "src/engine.js"


def git(root: Path, *arguments: str, input_bytes: bytes | None = None,
        allowed_codes: tuple[int, ...] = (0,)) -> bytes:
    result = subprocess.run(["git", "-C", str(root), *arguments], input=input_bytes,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    if result.returncode not in allowed_codes:
        raise RuntimeError(result.stderr.decode("utf-8", errors="replace").strip()
                           or f"git {' '.join(arguments)} failed")
    return result.stdout


def is_original(relative: PurePosixPath) -> bool:
    """The engine and brand/ hold the one source of each shared asset."""
    return relative.as_posix() == ENGINE or (relative.parts[0] == "brand" and relative.suffix.lower() in BRAND_EXTENSIONS)


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

    # Only a file the size of an original can be its copy, so most files are never read.
    originals: dict[bytes, str] = {}
    sizes: set[int] = set()
    for name in names:
        relative, path = PurePosixPath(name), root / name
        if is_original(relative) and path.is_file() and not path.is_symlink():
            data = path.read_bytes()
            if data:
                originals[hashlib.sha256(data).digest()] = name
                sizes.add(len(data))

    for name in names:
        relative, path = PurePosixPath(name), root / name
        if is_original(relative) or path.is_symlink() or not path.is_file():
            continue  # Deleted tracked files are not working-tree content; a link is not a copy.
        if path.stat().st_size not in sizes:
            continue
        original = originals.get(hashlib.sha256(path.read_bytes()).digest())
        if original:
            errors.add(f"{name}: copied bytes from {original}; build an ignored output from the shared source instead")
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
