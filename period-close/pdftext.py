"""Text out of a simple PDF, standard library only.

    python3 period-close/pdftext.py statement.pdf        # prints the lines, top to bottom, left to right

Written for the documents the demo portals produce through pdf-lib (Helvetica, one text run per `BT`, an absolute
`Tm` before each `Tj`), and honest about its limits: it reads FlateDecode or raw content streams, WinAnsi text in hex
or literal strings, and groups runs into lines by their y position. Anything else (CID fonts, embedded subset fonts
with custom encodings, encrypted files, text drawn as paths or images) comes back empty or garbled, and the importer
treats "no lines" and "no amounts" as "this PDF needs a person" rather than guessing. It is a reader, never a judge:
every number it returns is checked against the sheet before it is believed.
"""
import re
import sys
import zlib
from pathlib import Path

OBJ = re.compile(rb'(\d+)\s+(\d+)\s+obj\b(.*?)endobj', re.S)
STREAM = re.compile(rb'stream\r?\n(.*?)\r?\nendstream', re.S)
TOKEN = re.compile(rb'<([0-9A-Fa-f\s]*)>|\((?:\\.|[^\\)])*\)|\[|\]|/[^\s/\[\]<>(]+|-?\d*\.?\d+|[A-Za-z\'"*]+')


def _literal(tok):
    out, i, s = bytearray(), 1, tok[1:-1]
    esc = {b'n': 10, b'r': 13, b't': 9, b'b': 8, b'f': 12, b'(': 40, b')': 41, b'\\': 92}
    i = 0
    while i < len(s):
        c = s[i:i + 1]
        if c == b'\\' and i + 1 < len(s):
            n = s[i + 1:i + 2]
            if n in esc:
                out.append(esc[n]); i += 2; continue
            if n.isdigit():
                oct_ = s[i + 1:i + 4]
                digits = re.match(rb'[0-7]{1,3}', oct_).group(0)
                out.append(int(digits, 8) & 255); i += 1 + len(digits); continue
            i += 2; continue
        out += c; i += 1
    return bytes(out)


def _decode(raw):
    return raw.decode('cp1252', errors='replace')


def _streams(data):
    """Decoded page content streams in object-number order (pdf-lib writes pages in order)."""
    out = []
    for num, _, body in OBJ.findall(data):
        m = STREAM.search(body)
        if not m:
            continue
        head = body[:m.start()]
        if b'/ObjStm' in head or b'/XRef' in head or b'/Image' in head or b'/FontFile' in head:
            continue
        raw = m.group(1)
        if b'/FlateDecode' in head:
            try:
                raw = zlib.decompress(raw)
            except zlib.error:
                continue
        elif re.search(rb'/Filter\s*(/|\[)', head):
            continue  # a filter we do not read
        if b'BT' in raw and (b'Tj' in raw or b'TJ' in raw):
            out.append((int(num), raw))
    return [s for _, s in sorted(out)]


def runs(data):
    """[(page, x, y, text)] for every text-showing operator, in drawing order."""
    out = []
    for page, content in enumerate(_streams(data), 1):
        x = y = 0.0
        tlx = tly = 0.0  # start of the current line (Td/T* move from here)
        leading = 0.0
        size = 0.0
        stack = []
        for tok in TOKEN.findall(content):
            pass
        toks = [m.group(0) for m in TOKEN.finditer(content)]
        for t in toks:
            if t.startswith(b'<') or t.startswith(b'('):
                stack.append(t); continue
            if t == b'[' or t == b']':
                stack.append(t); continue
            if t.startswith(b'/') or re.fullmatch(rb'-?\d*\.?\d+', t):
                stack.append(t); continue
            op = t
            nums = []
            for s in stack:
                if re.fullmatch(rb'-?\d*\.?\d+', s):
                    nums.append(float(s))
            if op == b'Tf' and nums:
                size = nums[-1]
            elif op == b'TL' and nums:
                leading = nums[-1]
            elif op == b'Tm' and len(nums) >= 6:
                x, y = nums[-2], nums[-1]; tlx, tly = x, y
            elif op in (b'Td', b'TD') and len(nums) >= 2:
                tlx += nums[-2]; tly += nums[-1]; x, y = tlx, tly
                if op == b'TD':
                    leading = -nums[-1]
            elif op == b'T*':
                tly -= leading; x, y = tlx, tly
            elif op in (b'Tj', b"'", b'"', b'TJ'):
                if op == b"'" or op == b'"':
                    tly -= leading; x, y = tlx, tly
                parts = []
                for s in stack:
                    if s.startswith(b'<'):
                        hx = re.sub(rb'\s', b'', s[1:-1])
                        if len(hx) % 2:
                            hx += b'0'
                        parts.append(_decode(bytes.fromhex(hx.decode('ascii'))))
                    elif s.startswith(b'('):
                        parts.append(_decode(_literal(s)))
                text = ''.join(parts)
                if text.strip():
                    out.append((page, round(x, 2), round(y, 2), text))
                x += size * 0.5 * len(text)  # a rough advance, only so same-line runs keep their order
            stack = []
    return out


def lines(data, tolerance=2.0):
    """Text lines per page: runs within `tolerance` points of the same baseline, left to right, joined by two spaces."""
    out = []
    pages = {}
    for page, x, y, text in runs(data):
        pages.setdefault(page, []).append((y, x, text))
    for page in sorted(pages):
        rows = []
        for y, x, text in sorted(pages[page], key=lambda r: (-r[0], r[1])):
            if rows and abs(rows[-1][0] - y) <= tolerance:
                rows[-1][1].append((x, text))
            else:
                rows.append([y, [(x, text)]])
        for y, cells in rows:
            out.append((page, y, [t for _, t in sorted(cells)]))
    return out


def text(path):
    data = Path(path).read_bytes()
    if not data.startswith(b'%PDF-'):
        raise ValueError(f'{path}: not a PDF (no %PDF- header)')
    return lines(data)


if __name__ == '__main__':
    for p in sys.argv[1:]:
        for page, y, cells in text(p):
            print(f'{page}:{y:7.2f}  ' + '  |  '.join(cells))
