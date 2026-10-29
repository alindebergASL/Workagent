exec((__import__('pathlib').Path('.local/batch3/b32b/native.py').read_text().split("result={'mode'")[0]).replace("cols,rows=(80,35) if mode=='reopen' else (100,45)","cols,rows=(100,45)"))
try:
 t.pump(1);t.wait('Enter adds a line');label('Files');label('Working files');t.wait('Working files ·');label('Export fidelity',True)
 for _ in range(40):send(f'\x1b[<65;{cols-3};{rows-6}M',.01)
 t.capture('bottom')
 seen=set()
 for i in range(40):
  for value in ('0.3','1.5'):
   if value in t.text and value not in seen:seen.add(value);t.capture('value-'+value)
  if len(seen)==2:break
  send('\x1b[<64;40;32M',.1)
 assert len(seen)==2, t.text
finally:t.close()
