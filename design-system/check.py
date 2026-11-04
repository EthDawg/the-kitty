"""One local command for the delivered implementation foundations. No network or provider writes."""
from pathlib import Path
import subprocess,sys
root=Path(__file__).resolve().parents[1]
commands=[['node','--test','test.js',*[str(p.relative_to(root)) for p in sorted((root/'design-system/tests').glob('*.test.mjs'))],'design-system/contracts/contract.test.mjs'],[sys.executable,'demo-portals/verify.py'],[sys.executable,'design-system/assets/integration/validate.py'],[sys.executable,'build.py'],[sys.executable,'design-system/build-preview.py']]
for command in commands:
 print('\nRUN '+' '.join(command),flush=True)
 subprocess.run(command,cwd=root,check=True)
print('\nPASS: all local checks. Provider writes, real-bank compatibility and device acceptance are not covered.')
