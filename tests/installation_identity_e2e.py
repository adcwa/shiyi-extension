"""A user extracts the same release into a different directory and loads it.

Real isolated Chrome, real extension storage and production database writes.
Only deliberately synthetic configuration and vocabulary are used.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from browser_binary import browser_binary
import json, tempfile, zipfile, hashlib, sys, subprocess

ROOT=Path(__file__).resolve().parents[1]
VERSION=json.loads((ROOT/'package.json').read_text())['version']
OUT=ROOT/'verification';OUT.mkdir(exist_ok=True)
report={'version':VERSION,'result':'running','scope':'Different unpacked directories, same isolated Chrome profile, production local model and vocabulary stores; no user profile or paid service.','checks':[]}
def passed(name):report['checks'].append({'name':name,'result':'pass'});print('PASS: '+name,flush=True)
try:
 with tempfile.TemporaryDirectory(prefix='dianyi-identity-') as directory,sync_playwright() as p:
  root=Path(directory);profile=root/'browser';first=root/'download-first';second=root/'download-second'
  archive=ROOT/'releases'/f'dianyi-chrome-edge-{VERSION}.zip'
  previous = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else archive
  for package,destination in [(previous, first),(archive, second)]:
   with zipfile.ZipFile(package) as z:z.extractall(destination)
  report['from_version'] = json.loads((first/'manifest.json').read_text())['version']
  binary=browser_binary()
  def launch(folder):return p.chromium.launch_persistent_context(str(profile),executable_path=binary,headless=True,ignore_default_args=['--disable-extensions'],args=['--disable-extensions-except='+str(folder),'--load-extension='+str(folder)],viewport={'width':1200,'height':900})
  def bind(context):
   worker=context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker');ident=worker.url.split('/')[2]
   ui=context.new_page();ui.goto(f'chrome-extension://{ident}/options.html#model');expect(ui.locator('.page-heading h1')).to_be_visible()
   return worker,ident,ui
  def api(ui,kind,**fields):
   reply=ui.evaluate('m=>chrome.runtime.sendMessage(m)',{'type':'SHIYI/'+kind,**fields});assert reply['ok'],reply;return reply['data']
  context=launch(first)
  try:
   worker,old_id,ui=bind(context)
   connection=api(ui,'SAVE_PROFILE',profile={'provider':'custom','name':'Persistent fixture','model':'fixture','endpoint':'http://127.0.0.1:59998/v1','auth':'bearer','rememberKey':True},apiKey='identity-only-synthetic-value')['id']
   api(ui,'MODEL_ASSIGN',purpose='summary',id=connection,makeDefault=True)
   state=api(ui,'UI_STATE');api(ui,'SAVE_PREFS',prefs={**state['prefs'],'targetLanguage':'ja'})
   ui.evaluate('''async()=>{const s=await import(chrome.runtime.getURL('lib/db.js'));await s.commitTranslation({id:'retained-fixture-word',text:'evidence',translation:'依据',kind:'word',targetLanguage:'zh-CN',sourceLanguage:'en',style:'regular',source:{url:'https://example.org',title:'Synthetic source'},createdAt:1,updatedAt:2},await s.getEpoch());}''')
   ui.evaluate('''async()=>{const {createKnowledgeStore}=await import(chrome.runtime.getURL('lib/knowledge-store.js'));const db=createKnowledgeStore();const source={url:'https://example.org/synthetic-evidence',title:'Saved fixture article',domain:'example.org'};await db.write({visits:[{id:'retained-visit',visitedAt:1,source,title:source.title,domain:source.domain,summaryId:'retained-summary',documentId:'retained-document',note:'My saved note',tags:['fixture']}],documents:[{id:'retained-document',source}],snapshots:[{id:'retained-document',text:'Saved synthetic original article'}],summaries:[{id:'retained-summary',kind:'page',logicalKey:'page:retained-document',documentId:'retained-document',source,phase:'complete',text:'Saved synthetic summary',createdAt:1,updatedAt:1}],jobs:[{id:'retained-summary',status:'complete'}]});await db.close();}''')
   page_id = ui.evaluate('''async()=>{const db=await import(chrome.runtime.getURL('lib/db.js'));
     const info={mode:'bilingual',scope:'page',selectionPaths:[],title:'Saved page'};
     const {id,revision}=await db.pageOpen('retained-page-cache',info);
     await db.pagePatch(id,revision,info,[{key:'saved-block',locator:'p',signature:'same',values:['译文'],translation:'译文'}]);
     return id;}''')
   before=api(ui,'UI_STATE');assert before['count']==1 and before['profile']['hasKey']
  finally:context.close()
  if previous != archive:
   subprocess.run([sys.executable,str(second/'upgrade/install.py'),'--source',str(second),'--target',str(first)],check=True,capture_output=True)
  context=launch(first if previous != archive else second)
  if previous != archive:
   manager=context.new_page();manager.goto('chrome://extensions')
   if not manager.locator('#devMode').evaluate('node=>node.checked'): manager.locator('#devMode').click()
   manager.locator(f'extensions-item[id="{old_id}"] #dev-reload-button').click()
   manager.wait_for_timeout(400)
  try:
   worker,new_id,ui=bind(context);after=api(ui,'UI_STATE')
   report['observed']={'same_extension_id':new_id==old_id,'models_before':len(before['modelLibrary']['items']),'models_after':len(after['modelLibrary']['items']),'words_before':before['count'],'words_after':after['count'],'has_key_after':after['profile']['hasKey']}
   assert new_id==old_id, 'Changing extraction directory produced a new extension identity and empty storage: '+json.dumps(report['observed'])
   passed('the installed release retains the same extension identity')
   assert after['profile']['connectionId']==connection and after['summaryProfile']['connectionId']==connection and after['profile']['hasKey']
   assert after['version']==VERSION and after['prefs']['targetLanguage']=='ja';passed('both scene model choices, saved Key and preferences survive the upgrade')
   words=api(ui,'LIBRARY')['entries'];assert len(words)==1 and words[0]['id']=='retained-fixture-word';passed('original vocabulary IDs and meanings survive loading the new directory')
   record=api(ui,'KNOWLEDGE_DETAIL',id='retained-visit');assert record['summary']['text']=='Saved synthetic summary' and record['visit']['note']=='My saved note'
   data=api(ui,'KNOWLEDGE_EXPORT',originals=True);assert any(s['text']=='Saved synthetic original article' for s in data['snapshots']);passed('reading trajectory, original snapshot, notes and summary also retain their original identities')
   cache=ui.evaluate('''async id=>{const db=await import(chrome.runtime.getURL('lib/db.js'));return db.pageRead(id);}''',page_id)
   assert cache['blocks'][0]['translation']=='译文';passed('page translation cache retains the saved block')
   ui.goto(f'chrome-extension://{new_id}/options.html')
   expect(ui.get_by_role('heading',name='词句库',exact=True)).to_be_visible()
   expect(ui.get_by_role('searchbox',name='搜索词句或释义')).to_be_visible()
   expect(ui.locator('.term-table')).to_contain_text('依据')
   passed('default manager opens vocabulary and displays the existing word')
   ui.goto(f'chrome-extension://{new_id}/options.html#data');expect(ui.locator('#installation-status')).to_contain_text('固定插件身份')
   ui.screenshot(path=str(OUT/f'installation-identity-{VERSION}.png'),full_page=True)
   for width in (375, 768, 1024, 1360):
    ui.set_viewport_size({'width':width,'height':900})
    for section in ('library','trails','reviews','model','translation','summary','sites','data','help','about'):
     ui.goto(f'chrome-extension://{new_id}/options.html#{section}')
     expect(ui.locator('#intro-root h1' if section == 'about' else 'main h1').first).to_be_visible()
     assert ui.evaluate('document.documentElement.scrollWidth<=innerWidth'), (width,section)
   passed('existing management links resolve without page overflow at 375–1360px')
   report.update(result='pass',tested_archive_sha256=hashlib.sha256(archive.read_bytes()).hexdigest())
  finally:context.close()
except Exception as error:report.update(result='fail',error=str(error));raise
finally:(OUT/f'installation-identity-{VERSION}.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
