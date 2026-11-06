#!/usr/bin/env python3
"""Check everything from a fresh clone. Needs Python 3.9 or later and Node 22, nothing installed.

    python3 check.py                # every area: a plain PASS, FAIL or SKIP for each, under three minutes
    python3 check.py app standard   # only these areas
    python3 check.py --list         # the areas and what each proves
    python3 check.py --ci test      # the areas one CI job runs; a SKIP counts as a FAIL

CI calls this file and runs no check of its own, so the two cannot drift. A new check goes in AREAS.
No check may leave the working tree changed. A generator that rewrites a committed file fails its area.
"""
import argparse
import json
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import tempfile
import time


ROOT = Path(__file__).resolve().parent
TAIL = 40  # lines of a failing command's output worth reading


class Failed(Exception):
    """A step failed. The message is what to read."""


class Skipped(Exception):
    """A step cannot run here. The message says what it needs."""


def run(command, cwd=None):
    """Run a command and return its output, or raise Failed with the end of that output."""
    argv = shlex.split(command) if isinstance(command, str) else list(command)
    if argv[0] == "python3":
        argv[0] = sys.executable
    result = subprocess.run(argv, cwd=cwd or ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    if result.returncode:
        shown = command if isinstance(command, str) else " ".join(argv)
        tail = "\n".join(result.stdout.splitlines()[-TAIL:])
        raise Failed(f"$ {shown}\n{tail}")
    return result.stdout


def tree():
    """What git can see in the working tree: which paths differ, and how."""
    return run("git status --porcelain").splitlines(), run("git diff")


def built_page(path):
    def step(scratch):
        page = ROOT / path
        if not page.is_file() or not page.stat().st_size:
            raise Failed(f"{path} is missing or empty")
        run(["node", "-e", "const h=require('fs').readFileSync(process.argv[1],'utf8');"
             r"for(const m of h.matchAll(/<script>([\s\S]*?)<\/script>/g)) new Function(m[1])", str(page)])
    step.label = f"every inline script in {path} parses"
    return step


def repeated_month(sheet):
    """A month already in the sheet appends nothing and plans no write. Writes to scratch, not period-close/."""
    def step(scratch):
        out = Path(scratch) / ("month-" + Path(sheet).stem)
        printed = run(f"python3 period-close/import_month.py 2027-01 --sheet {sheet} "
                      f"--out {shlex.quote(str(out))} --inputs period-close/2027-01")
        if "0 rows to append" not in printed:
            raise Failed(f"repeating 2027-01 against {sheet} would append rows:\n{printed[-1500:]}")
        plan = json.loads((out / "write-plan.json").read_text())
        if plan["status"] != "ready" or plan["writes"]:
            raise Failed(f"repeating 2027-01 against {sheet} plans writes: {plan['totals']}")
    step.label = f"repeating a month against {sheet} writes nothing"
    return step


def portal_data(scratch):
    run(f"python3 portals/build-data.py --out {shlex.quote(str(Path(scratch) / 'months.json'))}")


portal_data.label = "the simulator still builds the portals' data"


def portal_browser(scratch):
    if not (ROOT / "portals/node_modules/.bin/playwright").exists():
        raise Skipped("the browser proof needs `npm ci && npx playwright install chromium` in portals/")
    run("npx playwright test", cwd=ROOT / "portals")


portal_browser.label = "sign in, download every shape, import, reconcile"


# Name, the CI job that runs it, what it proves, and its steps in order. A step is a command or a function.
AREAS = [
    ("layout", "test", "one app, two hosts, the repository's shape, and this file", [
        "python3 -m unittest discover -s tools -p test_check*.py",
        "python3 tools/check_shape.py",
    ]),
    ("public", "test", "no private paths, addresses or document links in anything tracked", [
        "python3 tools/check_public.py",
    ]),
    ("brand", "test", "shared brand sources are current and drive both hosts", [
        "python3 brand/generate_tokens.py --check",
        "python3 brand/build_brand.py --icons-only",
        "python3 -m unittest discover -s tools -p test_brand_pipeline.py",
    ]),
    ("app", "test", "the page's engine, Ask and the native host's contract", [
        "node --test test.js test-v2.js tools/ask-skills.test.js tools/ask-routing.test.js",
        "python3 -m unittest discover -s tools -p test_native_build.py",
        "node --test src/hosts/native.test.js",
    ]),
    ("import", "test", "the importer's promises, and JavaScript plans what Python plans", [
        "node --test tools/period-core.test.js",
        "python3 tools/period_parity.py --quiet",
        "python3 -m unittest discover -s period-close",
        repeated_month("data/snapshot.json"),
        repeated_month("data/snapshot-v2.json"),
    ]),
    ("build", "test", "both pages build, and the fixtures are what the snapshot cuts", [
        "python3 -m py_compile build.py snapshot.py tools/grid_to_snapshot.py fixtures/make-v2-fixtures.py "
        "period-close/adapters.py period-close/simulate.py period-close/import_month.py period-close/writeplan.py "
        "period-close/verify.py period-close/pdftext.py period-close/pull_portals.py",
        "python3 build.py",
        built_page("dist/kitty.html"),
        "python3 build.py --v2",
        built_page("dist/kitty-v2.html"),
        "python3 fixtures/make-v2-fixtures.py",
    ]),
    ("standard", "standard", "the data model: generated files, importers, households, replay, ladder, locked numbers", [
        "node standard/tools/generate.js --check",
        "node standard/world/build.js",
        "node --test standard/intake/test.js standard/eval/households/test.js",
        "node standard/eval/all.js --check",
    ]),
    ("portals", "portals", "the parody portals serve files the importer can read", [
        portal_data,
        "python3 build.py --v2",
        portal_browser,
    ]),
    ("ios", "ios", "the Xcode project is deterministic; simulator tests run only in CI (ios.yml)", [
        "python3 ios/scripts/generate_project.py",
    ]),
]


def need_tools():
    """Say so plainly if this machine cannot run the checks at all."""
    if sys.version_info < (3, 9):
        sys.exit("check.py needs Python 3.9 or later.")
    if not shutil.which("node"):
        sys.exit("check.py needs Node 22 on the PATH.")
    version = run("node --version").strip().lstrip("v").split(".")[0]
    if int(version) < 22:
        sys.exit(f"check.py needs Node 22 or later; this is Node {version}.")


def check(area, steps, scratch):
    """Run one area's steps in order and return (status, note)."""
    before = tree()
    try:
        for step in steps:
            step(scratch) if callable(step) else run(step)
    except Failed as failure:
        return "FAIL", str(failure)
    except Skipped as skipped:
        note = str(skipped)
    else:
        note = ""
    after = tree()
    if after != before:
        moved = sorted(line[3:] for line in set(before[0]) ^ set(after[0])) or ["a file already changed"]
        return "FAIL", (f"{area} changed {', '.join(moved)}\n"
                        "A check leaves the tree as it found it. If a generator is right, commit what it wrote.")
    return ("SKIP", note) if note else ("PASS", "")


def main(argv=None):
    parser = argparse.ArgumentParser(description="Check everything: a plain pass or fail per area.")
    parser.add_argument("areas", nargs="*", metavar="area", help="only these areas (default: all of them)")
    parser.add_argument("--list", action="store_true", help="list the areas and what each proves")
    parser.add_argument("--ci", metavar="job", choices=sorted({job for _, job, _, _ in AREAS}),
                        help="run one CI job's areas; a skip counts as a failure")
    options = parser.parse_args(argv)

    names = [name for name, _, _, _ in AREAS]
    if options.list:
        for name, job, proves, _ in AREAS:
            print(f"{name:<10}{proves}")
        return 0
    unknown = [name for name in options.areas if name not in names]
    if unknown:
        parser.error(f"no area called {', '.join(unknown)}; the areas are {', '.join(names)}")

    need_tools()
    chosen = [area for area in AREAS
              if (not options.ci or area[1] == options.ci) and (not options.areas or area[0] in options.areas)]
    results, started = [], time.time()
    with tempfile.TemporaryDirectory(prefix="kitty-check-") as scratch:
        for name, _, proves, steps in chosen:
            print(f"{name:<10}", end="", flush=True)
            began = time.time()
            status, note = check(name, steps, scratch)
            if status == "SKIP" and options.ci:
                status = "FAIL"
            results.append((name, status))
            print(f"{status}  {time.time() - began:5.1f}s  {proves if status == 'PASS' else note.splitlines()[0]}", flush=True)
            if status == "FAIL":
                print("\n".join("    " + line for line in note.splitlines()[1:]), flush=True)

    failed = [name for name, status in results if status == "FAIL"]
    skipped = [name for name, status in results if status == "SKIP"]
    summary = f"{len(results) - len(failed) - len(skipped)} passed, {len(failed)} failed, {len(skipped)} skipped"
    print(f"\n{'FAIL: ' + ', '.join(failed) if failed else 'PASS'} ({summary}, {time.time() - started:.0f}s)")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
