#!/usr/bin/env python3
"""Seed only the fictional bank CSV in a chosen iOS simulator's Files provider.

The app still receives the file through its normal document picker. This script
does not alter app code, grants, financial records or a physical device.
"""
import argparse
import hashlib
import subprocess
import uuid
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('simulator', help='Available iPhone or iPad simulator UUID')
    arguments = parser.parse_args()
    identifier = str(uuid.UUID(arguments.simulator)).upper()
    subprocess.run(['xcrun', 'simctl', 'bootstatus', identifier, '-b'], check=True)
    groups = subprocess.check_output(
        ['xcrun', 'simctl', 'get_app_container', identifier, 'com.apple.DocumentsApp', 'groups'],
        text=True,
    )
    locations = dict(line.split('\t', 1) for line in groups.splitlines() if '\t' in line)
    group = Path(locations['group.com.apple.FileProvider.LocalStorage']).resolve(strict=True)
    if 'CoreSimulator' not in group.parts or identifier not in group.parts or group.parent.name != 'AppGroup':
        raise SystemExit('The returned location is not the selected simulator app group.')
    storage = group / 'File Provider Storage'
    storage.mkdir(exist_ok=True)
    folder = storage / 'Kitty QA'
    folder.mkdir(exist_ok=True)
    original = Path(__file__).resolve().parents[1] / 'Kitty/Resources/sample-import.csv'
    content = original.read_bytes()
    fixture = folder / 'fictional-bank.csv'
    if fixture.exists() and fixture.read_bytes() != content:
        raise SystemExit('A different fictional-bank.csv already exists; it was not overwritten.')
    if not fixture.exists():
        fixture.write_bytes(content)
    print('Simulator Files fixture: local device storage / Kitty QA / fictional-bank.csv')
    print('Original SHA-256: ' + hashlib.sha256(content).hexdigest())


if __name__ == '__main__':
    main()
