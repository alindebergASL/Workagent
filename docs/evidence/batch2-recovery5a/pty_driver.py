"""Actual tmux PTY input/capture, not Textual Pilot or a fake HTTP transport."""
import json,subprocess,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3];OUT=ROOT/'docs/evidence/batch2-recovery5a';SESSION='b2r5a'
def tmux(*args):return subprocess.check_output(['tmux',*args],text=True)
def record(action,**data):
 with (OUT/'pty-actions.jsonl').open('a') as f:f.write(json.dumps({'action':action,**data})+'\n')
def keys(*args):
 tmux('send-keys','-t',SESSION,*args);record('keys',keys=args);time.sleep(.5)
def click(x,y):
 tmux('send-keys','-t',SESSION,'-l',f'\x1b[<0;{x};{y}M\x1b[<0;{x};{y}m');record('mouse',x=x,y=y);time.sleep(.5)
def click_label(label):
 lines=tmux('capture-pane','-p','-t',SESSION).splitlines()
 hits=[(line.index(label)+2,i+1) for i,line in enumerate(lines) if label in line]
 assert len(hits)==1,(label,hits)
 click(*hits[0])
def paste(text):
 tmux('send-keys','-t',SESSION,'-l','\x1b[200~'+text+'\x1b[201~');record('bracketed_paste',text=text);time.sleep(.6)
def capture(name,wait=1):
 time.sleep(wait);text=tmux('capture-pane','-p','-t',SESSION)
 (OUT/(name+'.txt')).write_text(text)
 (OUT/(name+'.ansi')).write_text(tmux('capture-pane','-e','-p','-t',SESSION))
 record('capture',name=name,dimensions=tmux('display-message','-p','-t',SESSION,'#{pane_width}x#{pane_height}').strip());print('Captured '+name);return text
