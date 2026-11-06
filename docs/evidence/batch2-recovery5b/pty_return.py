"""Capture actual successor PTY using the retained input driver."""
from pathlib import Path
import sys
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'docs/evidence/batch2-recovery5a'))
import pty_driver as p
p.OUT=ROOT/'docs/evidence/batch2-recovery5b';p.SESSION='b2r5b-tui'
if __name__=='__main__':
 action=sys.argv[1]
 if action=='capture':print(p.capture(sys.argv[2],float(sys.argv[3]) if len(sys.argv)>3 else 1))
 elif action=='label':p.click_label(sys.argv[2]);print(p.capture(sys.argv[3]))
 elif action=='keys':p.keys(*sys.argv[2:])
 elif action=='click':p.click(int(sys.argv[2]),int(sys.argv[3]));print(p.capture(sys.argv[4]))
