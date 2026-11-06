"""Missing native import/chart/annotated readback, actual PTY only."""
exec((__import__('pathlib').Path('.local/batch3/b32b/native.py').read_text().split("result={'mode'")[0]).replace("cols,rows=(80,35) if mode=='reopen' else (100,45)","cols,rows=(100,45)"))
def top():
 for _ in range(65):send(f'\x1b[<64;{cols-3};{rows-6}M',.005)
def select_file(name):
 top();label('Working files (25',True);send('\x1b[H');
 # Inspect options and click literal filename, not retained draft picker.
 label(name,True);label('Open exact',True);t.pump(1)
result={'mode':mode,'actions':actions,'passed':False}
try:
 t.pump(1);t.wait('Enter adds a line');label('Files');label('Working files');t.wait('Working files ·');t.capture('start')
 if mode=='annotated':
  select_file('native-brief.json');label('Human native edit',True);send('\x1b[1;5F');send('\x1b[B'*6);t.capture('annotation-visible');assert 'Human native annotation' in t.text
 elif mode.startswith('import-'):
  fmt=mode.split('-')[1];select_file('original.'+fmt);t.capture('source');label('Make editable office copy',True);t.pump(3);t.capture('imported');assert 'office-v1' in t.text or 'Office source' in t.text
 elif mode=='chart':
  select_file('capacity.csv');label('txt',True);send('\x1b[F\r');t.pump(.5)
  input_value('Category column','region');input_value('Numeric value column','hours');input_value('Chart title','Capacity by region');input_value('X axis label','Region');input_value('Y axis label','Hours');label('Export saved version',True);t.pump(3);t.capture('exported')
  label('Export fidelity',True);t.pump(.5);t.capture('manifest');input_value('Absolute download destination',str(base/'evidence/native-chart.png'));label('Download export',True);t.pump(2);t.capture('downloaded');assert (base/'evidence/native-chart.png').exists()
 result['passed']=True
finally:
 t.close();(out/('office-'+mode+'-result.json')).write_text(json.dumps(result,indent=2))
print('Actual PTY PASS',mode)
