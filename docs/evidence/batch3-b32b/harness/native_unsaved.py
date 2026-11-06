exec(__import__('pathlib').Path('.local/batch3/b32b/native_supplement.py').read_text().split("\nresult={'mode'")[0])
try:
 t.pump(1);t.wait('Enter adds a line');label('Files');label('Working files');t.wait('Working files ·')
 if mode=='unsaved':
  select_file('native-brief.json');label('Human native edit',True);send('\x1b[18~')
  files=client.request('/'+ws+'/work-areas/'+f['native']+'/files')['items'];file=next(x for x in files if x['filename']=='native-brief.json');a=client.request('/'+ws+'/artifacts/'+file['workspace_file_id']);obj=json.loads(a['current_revision']['body']['content']);obj['annotations'].append('Unsaved native human note survives restart.');paste(json.dumps(obj,ensure_ascii=False,indent=2));send('\x1b[1;5F');t.capture('retained-private-draft')
 else:
  # Selected private draft restored on fresh PTY launch, without an API write.
  label('Human native edit',True);send('\x1b[1;5F');send('\x1b[B'*6);t.capture('restored-private-draft');assert 'Unsaved native human note' in t.text
finally:t.close()
