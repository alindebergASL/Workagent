"""Fresh A14 stream proof; original revoked fixtures are never reactivated."""
from pathlib import Path
here=Path(__file__).resolve()
(here.parent/'runtime2').mkdir(exist_ok=True)
s=here.with_name('fixture.py').read_text()
s=s.replace("OUT=ROOT/'docs/evidence/batch2-recovery5d'", "OUT=ROOT/'docs/evidence/batch2-recovery5d/runtime2'")
s=s.replace("WS='recovery5d-scope'; PRIVATE='recovery5d-a-only'", "WS='recovery5d2-scope'; PRIVATE='recovery5d2-a-only'")
exec(compile(s,str(here),'exec'))
