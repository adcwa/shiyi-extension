"""Real old-to-new ZIP upgrade, shared credentials, local vocabulary and live search.

Everything uses isolated temporary profiles and a loopback model fixture. The old
vocabulary is deliberately authored fixture data; no user profile/key is read.
"""
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from playwright.sync_api import sync_playwright, expect
from browser_binary import browser_binary
import json, os, tempfile, time, zipfile, subprocess, sys

ROOT=Path(__file__).resolve().parents[1]
VERSION=json.loads((ROOT/'package.json').read_text())['version']
OUT=ROOT/'verification';OUT.mkdir(exist_ok=True)
SHOTS=OUT/'shared-models-ui';SHOTS.mkdir(exist_ok=True)
report={'version':VERSION,'result':'running','scope':'Unmodified historical 0.13.0 ZIP upgraded with the shipped updater in the original path; legacy key absence preserved; isolated Chrome profile; real localhost HTTP/SSE; synthetic vocabulary and credentials.','checks':[]}
calls=[];errors=[]
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_GET(self):
  body=f'<!doctype html><html lang="en"><meta charset="utf-8"><title>Article {self.path}</title><style>main{{max-width:760px;margin:50px auto;font:18px/1.8 system-ui}}</style><main><h1>Reading {self.path}</h1><p id="target">resilience</p><p>Curiosity and evidence support local reading. This synthetic article explains durable vocabulary and shared model choices, with sources saved locally for future reading.</p></main></html>'
  self.send_response(200);self.send_header('Content-Type','text/html;charset=utf-8');self.end_headers();self.wfile.write(body.encode())
 def do_POST(self):
  data=json.loads(self.rfile.read(int(self.headers['Content-Length'])));calls.append({'body':data,'authorization':self.headers.get('Authorization')})
  if not data.get('stream'):
   self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(json.dumps({'choices':[{'message':{'content':json.dumps({'translation':'韧性','sourceLanguage':'en','kind':'word'},ensure_ascii=False)}}]}).encode());return
  self.send_response(200);self.send_header('Content-Type','text/event-stream');self.end_headers()
  output='## 本地模型库验收\n\n这是本地合成文章的流式总结，用于验证同一连接在多个场景复用。\n\n- 来源保留。\n- 词库升级后继续存在。\n'
  try:
   for n in range(0,len(output),16):self.wfile.write(('data: '+json.dumps({'choices':[{'delta':{'content':output[n:n+16]}}]},ensure_ascii=False)+'\n\n').encode());self.wfile.flush();time.sleep(.025)
   self.wfile.write(b'data: [DONE]\n\n');self.wfile.flush()
  except (BrokenPipeError,ConnectionResetError):pass
def passed(name):report['checks'].append({'name':name,'result':'pass'});print('PASS: '+name,flush=True)
server=ThreadingHTTPServer(('127.0.0.1',0),Handler);Thread(target=server.serve_forever,daemon=True).start();origin=f'http://127.0.0.1:{server.server_port}'
try:
 with tempfile.TemporaryDirectory(prefix='dianyi-shared-upgrade-') as directory,sync_playwright() as p:
  directory=Path(directory);extension=directory/'extension';profile_dir=directory/'profile'
  binary=os.environ.get('SHIYI_TEST_CHROMIUM') or str(browser_binary())
  def launch(path=extension,profile=profile_dir):
   return p.chromium.launch_persistent_context(str(profile),executable_path=binary,headless=True,ignore_default_args=['--disable-extensions'],args=['--disable-extensions-except='+str(path),'--load-extension='+str(path)],viewport={'width':1440,'height':1000},accept_downloads=True)
  with zipfile.ZipFile(ROOT/'releases/dianyi-chrome-edge-0.13.0.zip') as z:z.extractall(extension)
  context=launch()
  def bind():
   global worker,ext,ui
   worker=context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker');ext=worker.url.split('/')[2]
   ui=context.new_page();ui.on('pageerror',lambda error:errors.append(str(error)));ui.goto(f'chrome-extension://{ext}/options.html#model')
   try:expect(ui.locator('.page-heading h1')).to_be_visible()
   except Exception:
    report['failure_body']=ui.locator('body').inner_text()[:1600]
    reply=ui.evaluate('()=>chrome.runtime.sendMessage({type:"SHIYI/UI_STATE"})');report['failure_state']={'ok':reply.get('ok'),'error':reply.get('error'),'version':reply.get('data',{}).get('version'),'has_model_library':'modelLibrary' in reply.get('data',{})}
    raise
  def api(message_type,**fields):
   response=ui.evaluate('m=>chrome.runtime.sendMessage(m)',{'type':'SHIYI/'+message_type,**fields});assert response and response.get('ok'),response;return response.get('data')
  def wait(fn,seconds=15):
   end=time.monotonic()+seconds
   while time.monotonic()<end:
    if fn():return
    ui.wait_for_timeout(60)
   raise AssertionError('Browser state did not settle')
  bind();old_id=ext
  base={'provider':'custom','name':'Saved primary','endpoint':origin+'/v1','model':'shared-model','auth':'bearer','rememberKey':True,'timeoutSeconds':5}
  old_translation=api('SAVE_PROFILE',profile=base,apiKey='primary-shared-fixture')['id']
  old_summary=api('SAVE_SUMMARY_PROFILE',profile={**base,'name':'Old summary','model':'summary-model'},apiKey='old-summary-fixture')['id']
  api('SAVE_SUMMARY_PREFS',prefs={'preset':'general','prompts':{}})
  word_ids=ui.evaluate('''async()=>{const store=await import(chrome.runtime.getURL('lib/db.js'));const ids=[];for(const [text,translation] of [['curiosity','好奇心'],['evidence','依据']]){const id=crypto.randomUUID();await store.commitTranslation({id,text,translation,kind:'word',targetLanguage:'zh-CN',sourceLanguage:'en',style:'regular',source:{url:'https://example.org/fixture',title:'Synthetic old vocabulary'},createdAt:1,updatedAt:2},await store.getEpoch());ids.push(id);}return ids;}''')
  ui.evaluate('''async()=>{const {createKnowledgeStore}=await import(chrome.runtime.getURL('lib/knowledge-store.js'));const db=createKnowledgeStore();const source={url:'https://example.org/legacy-evidence',title:'Legacy fixture',domain:'example.org'};await db.write({visits:[{id:'legacy-visit',visitedAt:1,source,title:source.title,domain:source.domain,summaryId:'legacy-summary',documentId:'legacy-document',note:'Legacy note',tags:[]}],documents:[{id:'legacy-document',source}],snapshots:[{id:'legacy-document',text:'Legacy original evidence'}],summaries:[{id:'legacy-summary',kind:'page',logicalKey:'page:legacy-document',documentId:'legacy-document',source,phase:'complete',text:'Legacy saved summary',createdAt:1,updatedAt:1}],jobs:[{id:'legacy-summary',status:'complete'}]});await db.close();}''')
  incoming=directory/'new-download'
  with zipfile.ZipFile(ROOT/'releases'/f'dianyi-chrome-edge-{VERSION}.zip') as z:z.extractall(incoming)
  updated=subprocess.run([sys.executable,str(incoming/'upgrade/install.py'),'--source',str(incoming),'--target',str(extension)],text=True,capture_output=True)
  assert updated.returncode==0,updated.stderr
  assert 'key' not in json.loads((extension/'manifest.json').read_text())
  upgrade=context.new_page();upgrade.goto(f'chrome-extension://{old_id}/options.html#model')
  upgrade.wait_for_function("()=>document.querySelector('.page-heading h1')||document.querySelector('#retry')")
  if upgrade.get_by_role('button',name='打开扩展管理',exact=True).count():
   with context.expect_page() as management:upgrade.get_by_role('button',name='打开扩展管理',exact=True).click()
   manager=management.value;manager.wait_for_load_state();manager.goto('chrome://extensions')
  else:manager=context.new_page();manager.goto('chrome://extensions')
  if not manager.locator('#devMode').evaluate('n=>n.checked'):manager.locator('#devMode').click()
  item=manager.locator('extensions-item[id="'+old_id+'"]')
  try:
   expect(item.locator('#dev-reload-button')).to_be_visible()
   item.locator('#dev-reload-button').click();manager.wait_for_timeout(300)
  except Exception:
   report['extension_manager']=manager.locator('extensions-item').evaluate_all('items=>items.map(n=>({id:n.id,data:n.data,text:n.shadowRoot.textContent,buttons:[...n.shadowRoot.querySelectorAll("cr-icon-button,cr-button,button")].map(b=>({id:b.id,label:b.getAttribute("aria-label"),title:b.title}))}))');raise
  wake=context.new_page();wake.goto(f'chrome-extension://{old_id}/options.html#model')
  try:
   bind();assert ext==old_id;state=api('UI_STATE');assert state['version']==VERSION;assert state['knowledgePrefs']['autoSummary'] is False;assert len(state['modelLibrary']['items'])==2
   assert sorted(e['id'] for e in api('LIBRARY')['entries'])==sorted(word_ids);assert state['vocabularyBackup']['count']==2
   assert state['modelConnections']['translation']['defaultId']==old_translation and state['modelConnections']['summary']['defaultId']==old_summary
   legacy=api('KNOWLEDGE_DETAIL',id='legacy-visit');assert legacy['visit']['note']=='Legacy note' and legacy['summary']['text']=='Legacy saved summary'
   assert any(s['text']=='Legacy original evidence' for s in api('KNOWLEDGE_EXPORT',originals=True)['snapshots'])
   api('KNOWLEDGE_DELETE',ids=['legacy-visit'])
   passed('same-directory ZIP upgrade preserves extension identity, original vocabulary IDs, both model choices and local keys')
   expect(ui.locator('.page-heading h1')).to_have_text('模型库');assert ui.locator('#model-form').count()==0
   ui.goto(f'chrome-extension://{ext}/options.html#summary');assert ui.locator('#model-form,#model-key').count()==0
   ui.get_by_role('link',name='选择总结模型',exact=True).click()
   before=len(calls);ui.locator('#scene-summary-model').select_option(old_translation);wait(lambda:api('UI_STATE')['summaryProfile']['connectionId']==old_translation);assert len(calls)==before
   state=api('UI_STATE');assert state['summaryProfile']['hasKey'];assert state['summaryProfile']['connectionId']==state['profile']['connectionId']
   passed('summary and periodic scenes select an existing model with no duplicate configuration, Key entry or test request')
   ui.goto(f'chrome-extension://{ext}/options.html#model');ui.locator('[data-edit-connection="'+old_translation+'"]').click();expect(ui.locator('#model-key')).not_to_have_attribute('required','');ui.locator('#model-name').fill('Shared reading model');ui.get_by_role('button',name='连接并保存',exact=True).click();expect(ui.locator('#connection-result')).to_contain_text('已连接并保存')
   state=api('UI_STATE');assert state['profile']['name']==state['summaryProfile']['name']=='Shared reading model';assert calls[-1]['authorization']=='Bearer primary-shared-fixture';assert len(calls)==before+1
   passed('editing one shared connection reuses its saved Key and updates every referencing scene')
   ui.get_by_role('button',name='添加模型',exact=True).click();ui.get_by_role('button',name='自定义服务',exact=True).click();ui.locator('#model-name').fill('Backup model');ui.locator('#model-endpoint').fill(origin+'/v1');ui.locator('#model-id').fill('backup-model');ui.locator('#model-key').fill('backup-fixture');expect(ui.locator('#remember-key')).to_be_checked();ui.get_by_role('button',name='连接并保存',exact=True).click();expect(ui.locator('#connection-result')).to_contain_text('已连接并保存')
   backup=next(i['id'] for i in api('UI_STATE')['modelLibrary']['items'] if i['profile']['name']=='Backup model')
   ui.locator('#scene-translation-model').select_option(backup);wait(lambda:api('UI_STATE')['profile']['connectionId']==backup);assert api('UI_STATE')['summaryProfile']['connectionId']==old_translation
   ui.goto(f'chrome-extension://{ext}/options.html#model-summary');ui.locator('#scene-summary-backup').select_option(backup);wait(lambda:any(i['id']==backup and i['backup'] for i in api('UI_STATE')['modelConnections']['summary']['items']))
   passed('models save locally once; scene defaults and explicitly selected backups remain independent')
   mt=api('MODEL_LIBRARY_SAVE',profile={'provider':'qwen','model':'qwen-mt-flash','rememberKey':False},apiKey='unrequested-mt-fixture',connectionId=None)['id'];ui.reload();expect(ui.locator('#scene-summary-model option[value="'+mt+'"]').first).to_be_disabled()
   passed('translation-only models remain in the shared library but cannot be selected for summary')
   ui.goto(f'chrome-extension://{ext}/options.html#model');ui.locator('[data-library-delete="'+backup+'"]').click();expect(ui.locator('#modal')).to_contain_text('翻译、总结与回顾');ui.locator('[data-confirm-library-delete="'+backup+'"]').click();wait(lambda:all(i['id']!=backup for i in api('UI_STATE')['modelLibrary']['items']));assert all(i['id']!=backup for i in api('UI_STATE')['modelConnections']['summary']['items'])
   ui.locator('#scene-translation-model').select_option(old_translation);wait(lambda:api('UI_STATE')['profile']['connectionId']==old_translation)
   passed('deleting a shared model reports affected scenes and clears its references and credential together')
   ui.get_by_role('button',name='收起',exact=True).click() if ui.get_by_role('button',name='收起',exact=True).count() else None
   ui.locator('#notice').evaluate('n=>n.replaceChildren()');ui.evaluate('window.scrollTo(0,0)');ui.screenshot(path=str(SHOTS/'model-library-desktop.png'),full_page=True)
   ui.goto(f'chrome-extension://{ext}/options.html#summary');ui.locator('#notice').evaluate('n=>n.replaceChildren()');ui.screenshot(path=str(SHOTS/'summary-desktop.png'),full_page=True)
   ui.set_viewport_size({'width':375,'height':900});assert ui.evaluate('document.documentElement.scrollWidth<=innerWidth');ui.screenshot(path=str(SHOTS/'summary-mobile.png'),full_page=True);ui.set_viewport_size({'width':1440,'height':1000})
   passed('shared model library and summary selectors render in the incumbent desktop and 375px management layout')
   api('AUTO_SUMMARY_SET',enabled=True)
   a=context.new_page();a.goto(origin+'/article-a');wait(lambda:any(i['phase']=='complete' and 'article-a' in i['title'] for i in api('KNOWLEDGE_LIST')['items']))
   assert calls[-1]['body']['stream'] and calls[-1]['authorization']=='Bearer primary-shared-fixture'
   target=a.locator('#target');target.scroll_into_view_if_needed();box=target.evaluate('n=>{const r=document.createRange();r.selectNodeContents(n);const b=r.getBoundingClientRect();return{x:b.x,y:b.y,w:b.width,h:b.height}}');a.mouse.move(box['x']+.3,box['y']+box['h']/2);a.mouse.down();a.mouse.move(box['x']+box['w']-.3,box['y']+box['h']/2,steps=15);a.mouse.up();a.locator('#shiyi-extension-root .selection-main').click();wait(lambda:any(e['text']=='resilience' for e in api('LIBRARY')['entries']));assert calls[-1]['authorization']=='Bearer primary-shared-fixture';assert api('UI_STATE')['vocabularyBackup']['count']==3
   passed('actual page summary and pointer-selected translation both use the single saved credential; new words update the local copy')
   b=context.new_page();b.goto(origin+'/article-b');wait(lambda:any(i['phase']=='complete' and 'article-b' in i['title'] for i in api('KNOWLEDGE_LIST')['items']))
   ui.goto(f'chrome-extension://{ext}/options.html#trails');expect(ui.locator('.knowledge-row')).to_have_count(2);expect(ui.locator('[data-k=toggle-filters]')).to_have_attribute('aria-expanded','false')
   before=len(calls);ui.locator('#knowledge-query').fill('article');ui.locator('#knowledge-query').fill('article-b');ui.wait_for_timeout(120);expect(ui.locator('.knowledge-row')).to_have_count(2);expect(ui.locator('.knowledge-row')).to_have_count(1);expect(ui.locator('.knowledge-row')).to_contain_text('article-b');assert len(calls)==before
   ui.locator('#knowledge-query').fill('');expect(ui.locator('.knowledge-row')).to_have_count(2)
   ui.locator('#knowledge-query').evaluate("n=>{n.value='article-b';n.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true}));}");ui.wait_for_timeout(500);expect(ui.locator('.knowledge-row')).to_have_count(2);ui.locator('#knowledge-query').dispatch_event('compositionend');expect(ui.locator('.knowledge-row')).to_have_count(1)
   passed('trajectory search debounces typing, waits for IME composition, supports clearing, and never requests a model')
   ui.locator('[data-k=toggle-filters]').click();ui.get_by_role('button',name='清除筛选',exact=True).click();expect(ui.locator('.knowledge-row')).to_have_count(2);ui.locator('.knowledge-row').first.click();ui.locator('#knowledge-note-project').fill('Local project');ui.get_by_role('button',name='保存备注',exact=True).click();expect(ui.locator('#notice')).to_contain_text('阅读备注已保存');ui.locator('#knowledge-project').select_option('Local project');expect(ui.locator('.knowledge-row')).to_have_count(1)
   ui.locator('#notice').evaluate('n=>n.replaceChildren()');ui.evaluate('window.scrollTo(0,0)');ui.screenshot(path=str(SHOTS/'trails-desktop.png'),full_page=True)
   passed('project filter changes update results immediately without a Filter button')
   day=api('KNOWLEDGE_REVIEW',kind='analysis',dimension='Shared model review');wait(lambda:any(i['id']==day['id'] and i['phase']=='complete' for i in api('KNOWLEDGE_LIST',view='reviews')['items']))
   ui.goto(f'chrome-extension://{ext}/options.html#reviews');before=len(calls);ui.locator('#knowledge-query').fill('no-match-for-review');expect(ui.locator('.knowledge-row')).to_have_count(0);ui.locator('#knowledge-query').fill('');expect(ui.locator('.knowledge-row')).to_have_count(1);assert len(calls)==before
   passed('review search shares automatic delayed retrieval and clearing, without generating a new review')
   ui.locator('#knowledge-query').fill('Article');ui.locator('[data-k=generate-open]').click();ui.locator('#knowledge-kind').select_option('analysis');ui.locator('[data-k=generate]').click();expect(ui.locator('.knowledge-detail-head')).to_be_visible();ui.wait_for_timeout(600);expect(ui.locator('.knowledge-detail-head')).to_be_visible();expect(ui.locator('.knowledge-detail-head>p').first).to_contain_text('已完成')
   passed('explicit Generate applies the pending search range and retains the result instead of a delayed filter clearing it')
   ui.goto(f'chrome-extension://{ext}/options.html#library')
   with ui.expect_download() as download:ui.get_by_role('button',name='导出词库',exact=True).click()
   exported=Path(download.value.path()).read_bytes();assert len(json.loads(exported)['entries'])==3;assert b'primary-shared-fixture' not in exported
   recovered=json.loads(exported);recovered['entries'][0]['translation']='do not replace current';recovered['entries'].append({'text':'continuity','translation':'连续性','targetLanguage':'zh-CN','kind':'word'})
   ui.locator('#vocabulary-file').set_input_files({'name':'recovery.json','mimeType':'application/json','buffer':json.dumps(recovered,ensure_ascii=False).encode()});expect(ui.locator('#notice')).to_contain_text('已恢复 1 个词句，保留 3 个已有词句');assert api('UI_STATE')['count']==4;assert api('LIBRARY')['entries'][0]['translation']!='do not replace current'
   passed('real vocabulary JSON export and file-picker recovery merge new words without replacing saved meanings or exposing keys')
   ui.goto(f'chrome-extension://{ext}/options.html#data');expect(ui.locator('#main')).to_contain_text('本地自动副本：4 个词句');ui.locator('#notice').evaluate('n=>n.replaceChildren()');ui.screenshot(path=str(SHOTS/'vocabulary-protection.png'),full_page=True)
   context.close();context=launch();bind();assert api('UI_STATE')['count']==4;assert api('UI_STATE')['summaryProfile']['hasKey'];assert api('UI_STATE')['profile']['hasKey'];assert api('UI_STATE')['profile']['connectionId']==old_translation
   passed('complete browser restart retains the shared local Key, selected scene models, vocabulary and backup')
   assert not errors,errors
   report.update(result='pass',browser=worker.evaluate('()=>navigator.userAgent'),page_errors=errors,model_requests=len(calls))
  finally:context.close()
except Exception as error:report.update(result='fail',error=str(error),page_errors=errors);raise
finally:server.shutdown();server.server_close();(OUT/f'shared-models-{VERSION}.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
