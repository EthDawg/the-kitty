"""Read only this run's fictional export from the simulator's local Files provider."""
import csv
import hashlib
import io
from pathlib import Path
import re
import subprocess
import sys


def verify(device, build_log):
    names = re.findall(r"^KITTY_UI_EXPORT_FIXTURE: (.+)$", Path(build_log).read_text(), re.M)
    if len(names) != 1 or not re.fullmatch(
        r"(?:kitty-entries-2027-01-31|kitty-native-export-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\.csv", names[0]
    ):
        raise SystemExit("Expected one completed simulator-local export test with a valid fixture filename.")
    groups = subprocess.check_output(
        ["xcrun", "simctl", "get_app_container", device, "com.apple.DocumentsApp", "groups"], text=True)
    matches = [line.split("\t", 1)[1] for line in groups.splitlines()
               if line.startswith("group.com.apple.FileProvider.LocalStorage\t")]
    if len(matches) != 1:
        raise SystemExit("The simulator did not identify exactly one local Files provider.")
    data = (Path(matches[0]) / "File Provider Storage" / names[0]).read_bytes()
    records = list(csv.DictReader(io.StringIO(data.decode("utf-8-sig"))))
    # Frozen Davies snapshot, Activity search 'woolworths', the shared engine's CSV bytes.
    digest = hashlib.sha256(data).hexdigest()
    if len(records) != 38 or digest != "e2f949dceb1e838544f34e793fcf943a284385e79336680fa985b57b0b7f46c9":
        raise SystemExit(f"Export did not match the fictional fixture: {len(records)} rows, SHA-256 {digest}.")
    print(f"Verified simulator Files export: {len(records)} rows, {len(data)} bytes, SHA-256 {digest}")


if __name__ == "__main__":
    verify(*sys.argv[1:])
