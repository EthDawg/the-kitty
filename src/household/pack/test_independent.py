#!/usr/bin/env python3
"""Reads the packs with tools that share nothing with the code that wrote them.

openpyxl opens the workbooks. LibreOffice works every formula out from nothing: each cached answer is stripped first, so a pass here
cannot be the writer agreeing with itself. Then every number tied to the engine is compared, the zips are read with Python's zipfile,
the manifest hashes are checked and the cover note is read with pypdf.

Needs: node, soffice, pip install openpyxl pypdf. Build the world first: node standard/world/build.js
Run: python3 src/household/pack/test_independent.py [--require-soffice]
"""
import csv, hashlib, io, json, os, re, shutil, subprocess, sys, tempfile, unittest, zipfile
from pathlib import Path

import openpyxl
import pypdf

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
SOFFICE = shutil.which("soffice") or shutil.which("libreoffice")
NOT_FOUND = "not found"
ERRORS = re.compile(r"^(#(VALUE!|REF!|NAME\?|DIV/0!|N/A|NUM!|NULL!)|Err:\d+)")


def make_examples(out):
    ties = Path(out) / "ties.json"
    subprocess.run(["node", str(HERE / "cli.js"), "examples", "--out", str(out), "--ties", str(ties)], check=True, cwd=REPO, stdout=subprocess.DEVNULL)
    return json.loads(ties.read_text())


def strip_cached(src, dst):
    """Copies a workbook with the answer removed from every formula cell, so whatever reads it has to calculate."""
    stripped = 0
    with zipfile.ZipFile(src) as zin, zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename.startswith("xl/worksheets/sheet"):
                text = data.decode("utf-8")
                text, n = re.subn(r"(<c [^>]*?)( t=\"(?:str|b)\")?([^>]*>)(<f>.*?</f>)<v>.*?</v>", r"\1\3\4", text)
                stripped += n
                data = text.encode("utf-8")
            zout.writestr(item, data)
    return stripped


def recalculate(xlsx, out):
    """LibreOffice opens it, recalculates, and saves its own file, which openpyxl then reads."""
    subprocess.run([SOFFICE, "--headless", "--calc", "--convert-to", "xlsx:Calc MS Excel 2007 XML", "--outdir", str(out), str(xlsx)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=180)
    return Path(out) / Path(xlsx).name


class Packs(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp(prefix="pack-independent-"))
        cls.out = cls.tmp / "first"
        cls.out.mkdir()
        cls.ties = make_examples(cls.out)
        cls.zips = {p: cls.out / "tax-pack" / v["zip"] for p, v in cls.ties.items()}

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def workbook_path(self, person):
        target = self.tmp / f"{person}.xlsx"
        with zipfile.ZipFile(self.zips[person]) as z:
            target.write_bytes(z.read("Tax pack.xlsx"))
        return target

    def test_zip_is_sound_and_every_hash_matches(self):
        for person, path in self.zips.items():
            with zipfile.ZipFile(path) as z:
                self.assertIsNone(z.testzip())
                names = set(z.namelist())
                self.assertTrue({"Tax pack.xlsx", "Cover note.pdf", "manifest.csv"} <= names)
                rows = list(csv.DictReader(io.StringIO(z.read("manifest.csv").decode("utf-8"), newline="")))
                listed = {r["path"]: r for r in rows}
                for name in names - {"manifest.csv"}:
                    self.assertIn(name, listed, f"{person}: {name} is not in the manifest")
                    data = z.read(name)
                    self.assertEqual(hashlib.sha256(data).hexdigest(), listed[name]["sha256"], name)
                    self.assertEqual(len(data), int(listed[name]["bytes"]), name)
                    self.assertTrue(listed[name]["supports"], f"{name} says what it supports")
                self.assertLess(path.stat().st_size, 15_000_000)

    def test_cover_note_is_one_page_and_says_what_it_should(self):
        for person, path in self.zips.items():
            with zipfile.ZipFile(path) as z:
                reader = pypdf.PdfReader(io.BytesIO(z.read("Cover note.pdf")))
            self.assertEqual(len(reader.pages), 1)
            text = reader.pages[0].extract_text()
            for words in ("Tax pack cover note", "not lodged", "not tax advice", "Size:", "Davies", "indicative"):
                self.assertIn(words, text, f"{person}: {words}")

    def test_workbook_links_open_files_in_the_zip(self):
        for person, path in self.zips.items():
            wb = openpyxl.load_workbook(self.workbook_path(person))
            with zipfile.ZipFile(path) as z:
                names = set(z.namelist())
            linked = 0
            for ws in wb.worksheets:
                for row in ws.iter_rows():
                    for cell in row:
                        link = cell.hyperlink
                        if not link:
                            continue
                        if link.target:
                            from urllib.parse import unquote
                            self.assertNotIn("://", link.target)
                            self.assertIn(unquote(link.target), names, link.target)
                            linked += 1
                        else:
                            sheet = link.location.split("!")[0].strip("'")
                            self.assertIn(sheet, wb.sheetnames, link.location)
            self.assertGreater(linked, 80, f"{person}: file links")

    def test_template_shape(self):
        wanted = ["Return Summary", "Income", "Shares", "Loan Interest", "Tax Estimate", "Open Items", "Evidence", "Prior Years"]
        for person in self.zips:
            wb = openpyxl.load_workbook(self.workbook_path(person))
            for sheet in wanted:
                self.assertIn(sheet, wb.sheetnames)
            self.assertEqual(wb.sheetnames[0], "Return Summary")
            self.assertTrue(any(s.startswith("Property ") for s in wb.sheetnames))
            rs = wb["Return Summary"]
            self.assertIn(("ATO label"), [c.value for c in rs[6]] + [c.value for c in rs[7]] + [c.value for c in rs[5]])
            blue = sum(1 for ws in wb.worksheets for row in ws.iter_rows() for c in row if isinstance(c.value, (int, float)) and c.font and c.font.color and c.font.color.rgb == "FF1F4FBF")
            formulas = sum(1 for ws in wb.worksheets for row in ws.iter_rows() for c in row if isinstance(c.value, str) and c.value.startswith("="))
            self.assertGreater(blue, 20, "entered figures are blue")
            self.assertGreater(formulas, 100, "worked-out figures are live formulas")

    @unittest.skipUnless(SOFFICE, "soffice is not installed")
    def test_recalculated_from_nothing_every_number_ties_to_the_engine(self):
        for person, info in self.ties.items():
            original = self.workbook_path(person)
            work = self.tmp / f"calc-{person}"
            work.mkdir(exist_ok=True)
            bare = work / f"{person}-bare.xlsx"
            stripped = strip_cached(original, bare)
            self.assertGreater(stripped, 100, "the answers were really removed")
            bare_wb = openpyxl.load_workbook(bare, data_only=True)
            self.assertIsNone(bare_wb[info["ties"][0]["sheet"]][info["ties"][0]["cell"]].value, "no answer left to read")
            done = work / "done"
            done.mkdir(exist_ok=True)
            recalculated = recalculate(bare, done)
            wb = openpyxl.load_workbook(recalculated, data_only=True)
            self.assertGreater(len(info["ties"]), 30)
            for tie in info["ties"]:
                value = wb[tie["sheet"]][tie["cell"]].value
                self.assertIsInstance(value, (int, float), f'{person} {tie["what"]} at {tie["sheet"]}!{tie["cell"]} is {value!r}')
                self.assertEqual(round(value * 100), tie["cents"], f'{person} {tie["what"]} at {tie["sheet"]}!{tie["cell"]}')
            # nothing errors, and what this package cached is what LibreOffice got
            cached = openpyxl.load_workbook(original, data_only=True)
            live = openpyxl.load_workbook(original)
            compared = 0
            for ws in live.worksheets:
                for row in ws.iter_rows():
                    for cell in row:
                        if not (isinstance(cell.value, str) and cell.value.startswith("=")):
                            continue
                        got, ours = wb[ws.title][cell.coordinate].value, cached[ws.title][cell.coordinate].value
                        self.assertFalse(isinstance(got, str) and ERRORS.match(got), f"{ws.title}!{cell.coordinate} {cell.value} is {got}")
                        if isinstance(ours, (int, float)) and isinstance(got, (int, float)):
                            self.assertAlmostEqual(got, ours, 2, f"{ws.title}!{cell.coordinate}")
                        elif ours not in (None, ""):
                            self.assertEqual(got, ours, f"{ws.title}!{cell.coordinate}")
                        compared += 1
            self.assertGreater(compared, 100)

    @unittest.skipUnless(SOFFICE, "soffice is not installed")
    def test_loan_interest_difference_is_zero_and_nothing_missing_shows_as_zero(self):
        for person, info in self.ties.items():
            work = self.tmp / f"calc2-{person}"
            work.mkdir(exist_ok=True)
            done = work / "done"
            done.mkdir(exist_ok=True)
            bare = work / f"{person}-bare.xlsx"
            strip_cached(self.workbook_path(person), bare)
            wb = openpyxl.load_workbook(recalculate(bare, done), data_only=True)
            ws = wb["Loan Interest"]
            found = [row for row in ws.iter_rows(values_only=True) if row[0] and str(row[0]).startswith("Unexplained difference")]
            self.assertEqual(len(found), 1)
            self.assertEqual(round(found[0][4], 2), 0)
            checks = [row for row in ws.iter_rows(values_only=True) if row[0] == "Check"]
            self.assertEqual(checks[0][4], "Reconciles")
            # the two lines nobody can answer stay words through a full recalculation, and every section that depends on them says so
            rs = wb["Return Summary"]
            it1 = [row for row in rs.iter_rows(values_only=True) if row[0] == "IT1"]
            self.assertEqual(it1[0][2], NOT_FOUND)
            div = [row for row in rs.iter_rows(values_only=True) if row[1] and str(row[1]).startswith("Division 293")]
            self.assertEqual(div[0][2], NOT_FOUND)

    def test_nothing_shows_zero_where_the_pack_said_not_found(self):
        out = self.tmp / "gaps"
        out.mkdir()
        script = """
const K = require('./src/household/pack/index.js'), NH = require('./src/household/pack/node-host.js'), fs = require('fs');
const hh = NH.household(), host = NH.host(hh.world);
const L = hh.at('2024-08-05', (s) => s.stream_id === 'PHI-M' || s.stream_id === 'QS-RENTAL2' || (s.stream_id === 'DED-M' && s.captured_at >= '2024-07-01'));
const p = K.tax.build({ L, reference: hh.reference, person: 'MIA', fy: 'FY2024', asOf: '2024-08-05' });
const r = K.bundle.render(p, host);
fs.writeFileSync(process.argv[1], r.parts[0].files.find((f) => f.path === 'Tax pack.xlsx').bytes);
console.log(JSON.stringify(p.lines.filter((l) => l.section.endsWith('.summary') && l.state === 'not_found').map((l) => l.label)));
"""
        path = out / "gappy.xlsx"
        done = subprocess.run(["node", "-e", script, str(path)], check=True, cwd=REPO, capture_output=True, text=True)
        labels = json.loads(done.stdout)
        self.assertIn("D3", labels)
        cached = openpyxl.load_workbook(path, data_only=True)
        rows = {row[0]: row for row in cached["Return Summary"].iter_rows(values_only=True) if row[0] in labels}
        for label in labels:
            self.assertEqual(rows[label][2], NOT_FOUND, label)
        totals = {row[1]: row for row in cached["Return Summary"].iter_rows(values_only=True) if row[1] in ("TOTAL DEDUCTIONS", "TAXABLE INCOME")}
        self.assertEqual(totals["TOTAL DEDUCTIONS"][5], "Incomplete")
        self.assertEqual(totals["TAXABLE INCOME"][5], "Incomplete")
        if SOFFICE:
            done_dir = out / "done"
            done_dir.mkdir()
            bare = out / "bare.xlsx"
            strip_cached(path, bare)
            wb = openpyxl.load_workbook(recalculate(bare, done_dir), data_only=True)
            rows = {row[0]: row for row in wb["Return Summary"].iter_rows(values_only=True) if row[0] in labels}
            for label in labels:
                self.assertEqual(rows[label][2], NOT_FOUND, f"{label} after recalculation")
            for ws in wb.worksheets:
                for row in ws.iter_rows(values_only=True):
                    for v in row:
                        self.assertFalse(isinstance(v, str) and ERRORS.match(v), f"{ws.title}: {v}")

    def test_rebuilt_from_the_same_input_is_byte_identical(self):
        second = self.tmp / "second"
        second.mkdir()
        make_examples(second)
        for folder in ("tax-pack", "lender-pack", "tax-kit"):
            for path in sorted((self.out / folder).iterdir()):
                self.assertEqual(path.read_bytes(), (second / folder / path.name).read_bytes(), path.name)

    @unittest.skipUnless(SOFFICE, "soffice is not installed")
    def test_blank_kit_calculates_and_says_not_found(self):
        kit = next((self.out / "tax-kit").glob("*.xlsx"))
        work = self.tmp / "kit"
        work.mkdir()
        bare = work / "bare.xlsx"
        strip_cached(kit, bare)
        done = work / "done"
        done.mkdir()
        wb = openpyxl.load_workbook(recalculate(bare, done), data_only=True)
        rs = wb["Return Summary"]
        one = [row for row in rs.iter_rows(values_only=True) if row[0] == "1"]
        self.assertEqual(one[0][2], NOT_FOUND)
        for ws in wb.worksheets:
            for row in ws.iter_rows(values_only=True):
                for v in row:
                    self.assertFalse(isinstance(v, str) and ERRORS.match(v), f"{ws.title}: {v}")

    def test_no_tax_file_number_in_any_generated_file_read_independently(self):
        def valid(d):
            return sum(int(c) * w for c, w in zip(d, (1, 4, 3, 7, 5, 8, 6, 9, 10))) % 11 == 0

        def scan(name, text):
            text = re.sub(r"\b[0-9a-f]{64}\b", " ", text)
            for m in re.finditer(r"(?<![\d.,/-])(\d{3})[ -]?(\d{3})[ -]?(\d{3})(?![\d.,]*\d)", text):
                self.assertFalse(valid("".join(m.groups())), f"{name}: {m.group(0)}")
            self.assertIsNone(re.search(r"(?:\btfn\b|tax\s*file\s*(?:no|number))[\s:#.-]*\d{3}[ -]?\d{3}[ -]?\d{2,3}(?![\d-])", text, re.I), name)

        for path in list((self.out / "tax-pack").glob("*.zip")) + list((self.out / "lender-pack").glob("*.zip")):
            with zipfile.ZipFile(path) as z:
                for name in z.namelist():
                    data = z.read(name)
                    if name.endswith(".xlsx"):
                        with zipfile.ZipFile(io.BytesIO(data)) as inner:
                            for part in inner.namelist():
                                scan(f"{name}!{part}", re.sub(r"<[^>]+>", "  ", inner.read(part).decode("utf-8", "replace")))
                    elif name.endswith(".pdf"):
                        pages = pypdf.PdfReader(io.BytesIO(data)).pages
                        scan(name, "\n".join(p.extract_text() or "" for p in pages))
                    else:
                        scan(name, data.decode("utf-8", "replace"))


if __name__ == "__main__":
    require = "--require-soffice" in sys.argv
    if require:
        sys.argv.remove("--require-soffice")
        if not SOFFICE:
            sys.exit("soffice is required here and is not installed")
    unittest.main(verbosity=1)
