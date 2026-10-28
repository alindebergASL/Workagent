from pathlib import Path
import sys
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'docs/evidence/batch2-recovery5a'))
import pty_driver as p
p.OUT=ROOT/'docs/evidence/batch2-recovery5c';p.SESSION='b2r5c-tui'
if __name__=='__main__':
 a=sys.argv[1]
 if a=='capture':print(p.capture(sys.argv[2]))
 elif a=='label':p.click_label(sys.argv[2]);print(p.capture(sys.argv[3]))
 elif a=='click':p.click(int(sys.argv[2]),int(sys.argv[3]));print(p.capture(sys.argv[4]))
 elif a=='keys':p.keys(*sys.argv[2:])
