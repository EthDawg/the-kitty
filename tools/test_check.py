"""check.py has to fail when something is wrong, and CI has to go through it. No product files are copied."""
import contextlib
import importlib.util
import io
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("check", ROOT / "check.py")
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)


def workflow_commands(path):
    """Every command a workflow file runs, one line per command."""
    commands, block = [], None
    for line in Path(path).read_text().splitlines():
        indent = len(line) - len(line.lstrip())
        if block is not None:
            if line.strip() and indent <= block:
                block = None
            elif line.strip():
                commands.append(line.strip())
                continue
        found = re.match(r"\s*(?:- )?run:\s*(.*)", line)
        if found:
            if found.group(1).strip() in {"|", ">"}:
                block = indent
            else:
                commands.append(found.group(1).strip())
    return commands


class CheckCommand(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for command in (["init", "--quiet"], ["config", "user.email", "check@mail.example"], ["config", "user.name", "Check"]):
            subprocess.run(["git", "-C", self.temp.name, *command], check=True)
        (self.root / "kept.txt").write_text("kept\n")
        subprocess.run(["git", "-C", self.temp.name, "add", "."], check=True)
        subprocess.run(["git", "-C", self.temp.name, "commit", "--quiet", "-m", "start"], check=True)
        self.addCleanup(setattr, check, "ROOT", check.ROOT)
        self.addCleanup(setattr, check, "AREAS", check.AREAS)
        check.ROOT = self.root

    def areas(self, *steps):
        check.AREAS = [("one", "test", "proves one thing", list(steps))]

    def run_main(self, *arguments):
        printed = io.StringIO()
        with contextlib.redirect_stdout(printed):
            code = check.main(list(arguments))
        return code, printed.getvalue()

    def test_a_passing_area_says_pass(self):
        self.areas("git status")
        code, printed = self.run_main()
        self.assertEqual(code, 0, printed)
        self.assertIn("PASS", printed)

    def test_a_failing_step_fails_its_area_and_shows_the_output(self):
        self.areas("git no-such-command")
        code, printed = self.run_main()
        self.assertEqual(code, 1)
        self.assertIn("FAIL", printed)
        self.assertIn("no-such-command", printed)

    def test_a_generator_that_rewrites_a_committed_file_fails(self):
        def rewrites(scratch):
            (self.root / "kept.txt").write_text("rewritten\n")
        rewrites.label = "rewrites"
        self.areas(rewrites)
        code, printed = self.run_main()
        self.assertEqual(code, 1, printed)
        self.assertIn("kept.txt", printed)

    def test_a_tree_already_dirty_is_not_blamed_on_the_check(self):
        (self.root / "kept.txt").write_text("an edit in progress\n")
        self.areas("git status")
        code, printed = self.run_main()
        self.assertEqual(code, 0, printed)

    def test_a_skip_passes_locally_and_fails_in_ci(self):
        def cannot(scratch):
            raise check.Skipped("needs a browser")
        cannot.label = "cannot"
        self.areas(cannot)
        code, printed = self.run_main()
        self.assertEqual(code, 0, printed)
        self.assertIn("SKIP", printed)
        self.assertEqual(self.run_main("--ci", "test")[0], 1)


class WorkflowsGoThroughCheck(unittest.TestCase):
    SETUP = ("npm ci", "npx playwright install --with-deps chromium")

    def test_every_job_is_a_check_py_call(self):
        commands = workflow_commands(ROOT / ".github/workflows/test.yml")
        self.assertTrue(commands)
        for command in commands:
            self.assertTrue(command in self.SETUP or command.startswith("python3 check.py --ci "), command)

    def test_every_area_runs_in_some_job(self):
        ran = " ".join(workflow_commands(ROOT / ".github/workflows/test.yml") + workflow_commands(ROOT / ".github/workflows/ios.yml"))
        for job in {job for _, job, _, _ in check.AREAS}:
            self.assertIn(f"check.py --ci {job}", ran)


class DocsStayTrue(unittest.TestCase):
    """The pages a newcomer reads first: their links resolve, and the map leaves nothing out."""
    PAGES = ["README.md", "AGENTS.md", "CONTRIBUTING.md", "MAINTAINERS.md", "ARCHITECTURE.md", "period-close/README.md",
             *(str(page.relative_to(ROOT)) for page in (ROOT / "docs").glob("*.md")),
             *(str(page.relative_to(ROOT)) for page in (ROOT / "docs/decisions").glob("*.md"))]

    def test_relative_links_resolve(self):
        for page in self.PAGES:
            for target in re.findall(r"\]\(([^)#\s]+)(?:#[^)]*)?\)", (ROOT / page).read_text()):
                if "://" not in target:
                    self.assertTrue((ROOT / page).parent.joinpath(target).exists(), f"{page} links to {target}")

    def test_the_map_names_every_top_level_folder(self):
        text = (ROOT / "docs/MAP.md").read_text()
        folders = subprocess.run(["git", "-C", str(ROOT), "ls-files"], check=True, capture_output=True, text=True).stdout
        for folder in {line.split("/")[0] for line in folders.splitlines() if "/" in line}:
            self.assertIn(f"`{folder}/`", text)


class PublicCheck(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location("check_public", ROOT / "tools/check_public.py")
        self.public = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.public)

    def test_private_shapes_are_found_and_fiction_is_not(self):
        sheet = "1zfiCnqO36a0YmMwC8-J6iGHUGvmLdXmhbL5"
        def found(text, terms=()):
            return self.public.findings("note.md", text, frozenset({sheet}), list(terms))
        self.assertTrue(found("saved in /Users/somebody/money"))
        self.assertTrue(found("mail someone@realmail.com"))
        self.assertTrue(found("https://docs.google.com/spreadsheets/d/1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/edit"))
        self.assertTrue(found("the Smith family", ["smith"]))
        self.assertFalse(found("mail billing@westpaw.example"))
        self.assertFalse(found(f"https://docs.google.com/spreadsheets/d/{sheet}/copy"))
        self.assertFalse(found("the Davies family", ["smith"]))


if __name__ == "__main__":
    unittest.main()
