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


def never_launched(log):
    # Device preflight errors precede the runner. Once a test case started, recover from provider evidence instead.
    if not log.exists():
        return False
    report = log.read_text(errors='replace')
    return 'cannot launch' in report and 'device is locked' in report and not re.search(r"Test Case '.+' started\.", report)


def run(mode, udid, base, dest, resume=False, concurrency=False, folder=False):
    assert hashlib.sha256(FIXTURE.read_bytes()).hexdigest() == SHA
    if folder and mode != 'sim': raise ValueError('The forced Files folder variant is simulator-only.')
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
    phases = [('sim-files', UI + 'testSimulatorFilesPreviewForSameSignedOriginal'), ('sim-commit-replay', CORE + 'testSimulatedCommitAndReplanUsingTheOriginalSelectedInFiles')] if mode == 'sim' else [
        ('prepare', UI + 'testCreatePrivatePracticeAndSaveSampleThroughFiles'),
        ('baseline', CORE + 'testCaptureUntouchedPracticeCopyBaseline'),
        ('import', UI + 'testConfirmOriginalFromFilesOnPrivateCopy'),
        ('after-import', CORE + 'testReadAfterImportAndReplayFromSheetsAndDrive'),
        ('replay', UI + 'testReplayOriginalFromFilesOnPrivateCopy'),
        ('after-replay', CORE + 'testReadAfterImportAndReplayFromSheetsAndDrive')]
    ordinary = {name for name, _ in phases}
    if concurrency:
        if mode != 'phone':
            raise ValueError('Physical concurrency proof requires the same verified private practice run.')
        phases.append(('post-replay-concurrency', CORE + 'testConcurrentNativeBankImportRecoversLostGoogleSuccess'))
    for name, test in phases:
        if name in state['passed'] or name in state.get('reconciled',{}):
            continue
        readback_only = False
        if name == 'post-replay-concurrency':
            if not ordinary.issubset(state['passed']) or state['uncertain']:
                raise RuntimeError('All six ordinary phases must pass first. Their evidence is retained independently.')
            previous = state['attempts'].get(name, 0)
            if previous and not never_launched(dest / f'{name}-{previous:02d}.log'):
                if not resume:
                    raise RuntimeError('A physical concurrency proof was already attempted. Resume to inspect the existing receipt only.')
                readback_only = True
                test = CORE + 'testReadBackExistingConcurrentNativeBankImport'
                print('Prior financial attempt retained. Selecting a distinct readback-only test; no second financial dispatch.', flush=True)
        previous = state['attempts'].get(name, 0)
        if name == 'import' and previous and not never_launched(dest / f'{name}-{previous:02d}.log'):
            # A timeout after tapping Confirm might already have committed. Only the independent provider checks can resolve it.
            if name not in state['uncertain']:
                state['uncertain'].append(name); save_state()
            print('A prior confirmation attempt is unverified. Proceeding directly to provider readback; the button will not be tapped again.', flush=True)
            continue
        state['attempts'][name] = state['attempts'].get(name, 0) + 1; save_state()
        suffix = f"{name}{'-readback' if readback_only else ''}-{state['attempts'][name]:02d}"
        data = plistlib.loads(base.read_bytes()); configuration = list(data.get('TestConfigurations', []))
        targets = [target for cfg in configuration for target in cfg['TestTargets']]
        if not targets:
            targets = [t for key,t in data.items() if key != '__xctestrun_metadata__' and isinstance(t,dict)]
        assert targets
        for t in targets:
            env = t.setdefault('EnvironmentVariables', {})
            env.pop('KITTY_PRACTICE_FOLDER',None)
            if folder: env['KITTY_PRACTICE_FOLDER'] = 'yes'
            env.pop('KITTY_PRACTICE_CONCURRENCY',None)
            env.pop('KITTY_PRACTICE_RACE_READBACK_ONLY',None)
            if name == 'post-replay-concurrency': env['KITTY_PRACTICE_CONCURRENCY'] = 'post-replay'
            if readback_only: env['KITTY_PRACTICE_RACE_READBACK_ONLY'] = '1'
            if 'file' in state: env['KITTY_PRACTICE_FILE'] = state['file']
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
        if name in ('prepare','sim-files'):
            names = re.findall(r'^KITTY_PRACTICE_FILE=(Kitty-2027-01-[A-Za-z0-9-]+)\s*$', log.read_text(), re.M)
            if len(names) != 1 or names[0] not in ('Kitty-2027-01-card-proof', 'Kitty-2027-01-proof-' + run_id):
                raise RuntimeError('The user-visible Files save did not return one verified test filename.')
            state['file'] = names[0]
        if name == 'baseline':
            found = re.findall(r'^KITTY_PRACTICE_TITLE=(Davies practice · [A-Fa-f0-9]{8})\s*$', log.read_text(), re.M)
            if len(found) != 1:
                raise RuntimeError('Independent Google preflight did not report one exact private copy title.')
            title = found[0]; state['title'] = title
        if readback_only:
            state.setdefault('reconciled',{})[name] = suffix
        else:
            state['passed'].append(name)
        save_state()
    print('Passed',len(state['passed']),'acceptance phases. Evidence:',dest)
    if state.get('reconciled'):
        print('Independently reconciled interrupted phase(s):',state['reconciled'])
    if state['uncertain']:
        print('Interrupted on-screen confirmation; separately verified provider and replay phases are identified in progress.json.')


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__); p.add_argument('mode',choices=['sim','phone']);p.add_argument('udid');p.add_argument('xctestrun',type=Path);p.add_argument('out',type=Path)
    p.add_argument('--resume', action='store_true', help='Reuse this run and never repeat an attempted confirmation.')
    p.add_argument('--concurrency-after-replay', action='store_true', help='After all six physical phases pass, prove one run-marked extra fictional row with two native clients. Its result is separate and cannot be retried automatically.')
    p.add_argument('--folder', action='store_true', help='On the simulator, exercise the Files destination-only variant by using a unique new folder.')
    a=p.parse_args();run(a.mode,a.udid,a.xctestrun.resolve(),a.out.resolve(),a.resume,a.concurrency_after_replay,a.folder)
