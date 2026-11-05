"""Run the fictional private practice acceptance in ordered Xcode phases.

Simulator Files preview (no real Google account):
  python3 ios/scripts/practice_import_acceptance.py sim <simulator-UDID> <simulator.xctestrun> <output-directory>
Physical (private Google copy, existing consent, signed build and unlocked phone):
  python3 ios/scripts/practice_import_acceptance.py phone <device-UDID> <device.xctestrun> <output-directory>
The phone run creates/opens a practice copy and saves a renamed sample through Files. It only proceeds with the unique
private target after the independent Google preflight. An interrupted run has separate phase results and exact run ID.
"""
import argparse
import hashlib
import json
from pathlib import Path
import plistlib
import re
import subprocess
import uuid

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / 'fixtures' / 'Kitty-2027-01-card-proof.csv'
SHA = '7f88605db65da236d62866612a2c9f2e272bd11a649b1dc1cc5408930779140b'
UI = 'KittyUITests/PracticeBankImportUITests/'
CORE = 'KittyTests/PracticeBankProviderTests/'


def run(mode, udid, base, dest, resume=False):
    assert hashlib.sha256(FIXTURE.read_bytes()).hexdigest() == SHA
    if mode == 'sim' and not re.fullmatch('[A-Fa-f0-9-]{36}', udid):
        raise ValueError('Provide the selected simulator UUID.')
    if not re.fullmatch('[A-Fa-f0-9-]{20,40}', udid):
        raise ValueError('Provide the selected device identifier.')
    state_path = dest / 'progress.json'
    key = hashlib.sha256(udid.encode()).hexdigest()
    if resume:
        state = json.loads(state_path.read_text())
        if state['mode'] != mode or state['deviceHash'] != key:
            raise RuntimeError('This acceptance belongs to a different device or mode.')
    else:
        dest.mkdir(parents=True, exist_ok=False)
        state = dict(run=str(uuid.uuid4()), title='', mode=mode, deviceHash=key, passed=[], attempts={}, uncertain=[])
    def save_state():
        new = state_path.with_suffix('.tmp'); new.write_text(json.dumps(state, indent=2) + '\n'); new.replace(state_path)
    save_state()
    run_id = state['run']; title = state['title']
    phases = [('sim-files', UI + 'testSimulatorFilesPreviewForSameSignedOriginal')] if mode == 'sim' else [
        ('prepare', UI + 'testCreatePrivatePracticeAndSaveSampleThroughFiles'),
        ('baseline', CORE + 'testCaptureUntouchedPracticeCopyBaseline'),
        ('import', UI + 'testConfirmOriginalFromFilesOnPrivateCopy'),
        ('after-import', CORE + 'testReadAfterImportAndReplayFromSheetsAndDrive'),
        ('replay', UI + 'testReplayOriginalFromFilesOnPrivateCopy'),
        ('after-replay', CORE + 'testReadAfterImportAndReplayFromSheetsAndDrive')]
    for name, test in phases:
        if name in state['passed']:
            continue
        if name == 'import' and state['attempts'].get(name, 0):
            # A timeout after tapping Confirm might already have committed. Only the independent provider checks can resolve it.
            if name not in state['uncertain']:
                state['uncertain'].append(name); save_state()
            print('A prior confirmation attempt is unverified. Proceeding directly to provider readback; the button will not be tapped again.', flush=True)
            continue
        state['attempts'][name] = state['attempts'].get(name, 0) + 1; save_state()
        suffix = f"{name}-{state['attempts'][name]:02d}"
        data = plistlib.loads(base.read_bytes()); configuration = list(data.get('TestConfigurations', []))
        targets = [target for cfg in configuration for target in cfg['TestTargets']]
        if not targets:
            targets = [t for key,t in data.items() if key != '__xctestrun_metadata__' and isinstance(t,dict)]
        assert targets
        for t in targets:
            env = t.setdefault('EnvironmentVariables', {})
            env.update(KITTY_PRACTICE_ACCEPTANCE='simulator-files' if mode == 'sim' else 'private-google', KITTY_PRACTICE_RUN=run_id, KITTY_PRACTICE_TITLE=title)
        # __TESTROOT__ in xctestrun paths is relative to the .xctestrun's own directory.
        local = base.parent / ('kitty-practice-' + run_id + '-' + suffix + '.xctestrun')
        with local.open('xb') as f:
            plistlib.dump(data,f)
        result = dest / (suffix + '.xcresult'); log = dest / (suffix + '.log')
        cmd = ['xcodebuild', 'test-without-building', '-xctestrun', str(local), '-destination',
               ('platform=iOS Simulator,id=' if mode == 'sim' else 'platform=iOS,id=') + udid,
               '-parallel-testing-enabled','NO','-destination-timeout','30','-resultBundlePath',str(result), '-only-testing:' + test]
        print('Running',name,flush=True)
        try:
            with log.open('x') as out:
                proc = subprocess.run(cmd, stdout=out, stderr=subprocess.STDOUT)
        finally:
            local.unlink(missing_ok=True)
        if proc.returncode != 0:
            raise RuntimeError(f'{name} failed; inspect {log} and {result} before repeating any phase.')
        summary = json.loads(subprocess.check_output(['xcrun','xcresulttool','get','test-results','summary','--path',str(result)]))
        if summary.get('passedTests') != 1 or summary.get('failedTests') != 0 or summary.get('skippedTests') != 0:
            raise RuntimeError(f'{name} did not run and pass its one required test.')
        if name == 'baseline':
            found = re.findall(r'^KITTY_PRACTICE_TITLE=(Davies practice · [A-Fa-f0-9]{8})\s*$', log.read_text(), re.M)
            if len(found) != 1:
                raise RuntimeError('Independent Google preflight did not report one exact private copy title.')
            title = found[0]; state['title'] = title
        state['passed'].append(name); save_state()
    print('Passed',len(state['passed']),'acceptance phases. Evidence:',dest)
    if state['uncertain']:
        print('Interrupted on-screen confirmation; separately verified provider and replay phases are identified in progress.json.')


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__); p.add_argument('mode',choices=['sim','phone']);p.add_argument('udid');p.add_argument('xctestrun',type=Path);p.add_argument('out',type=Path)
    p.add_argument('--resume',action='store_true',help='Resume this output directory, reuse the same private target and file, and never repeat an attempted confirmation.'); a=p.parse_args();run(a.mode,a.udid,a.xctestrun.resolve(),a.out.resolve(),a.resume)
