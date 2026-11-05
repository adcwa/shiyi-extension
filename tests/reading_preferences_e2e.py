"""Actual MV3 settings, palette and 16/32/64-block alignment acceptance.

The local endpoint deliberately reverses both block and fragment arrays. No real
LLM or credentials are used; unique source labels detect writes to the wrong DOM.
"""
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread, Lock
from playwright.sync_api import sync_playwright, expect
import json, tempfile, time,zipfile

ROOT=Path(__file__).resolve().parents[1]
VERSION=json.loads((ROOT/'package.json').read_text())['version']
OUT=ROOT/'verification';OUT.mkdir(exist_ok=True)
report={'version':VERSION,'result':'running','checks':[],'errors':[],'scope':'Real unmodified MV3 extension and local HTTP fixture; reversed blocks and fragments, no provider credentials.'}
calls=[];lock=Lock();control={'mode':'ok','delay':0}
ARTICLE='''<!doctype html><meta charset="utf-8"><title>Reading preference acceptance</title><style>body{margin:24px;background:#fff;color:#263735;font:16px/1.8 system-ui}main{max-width:800px;margin:auto}p{margin:18px 0}a{color:#006665}code{font-size:12px}@media(prefers-color-scheme:dark){body{background:#1a2821;color:#e2ebe1}a{color:#a2d6c4}}</style><main>'''+''.join('<p id="p'+str(i)+'">Block '+str(i)+': <a id="link'+str(i)+'" href="/target">link '+str(i)+'</a> <em id="em'+str(i)+'">detail '+str(i)+'</em><code>protectedCode'+str(i)+'()</code> end '+str(i)+'.</p>' for i in range(65))+'''</main><script>window.sourceLinks=[...document.querySelectorAll('a')];sourceLinks.forEach(a=>a.addEventListener('click',e=>{e.preventDefault();window.clicks=(window.clicks||0)+1}));</script>'''

class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def do_GET(self):
        self.send_response(200);self.send_header('Content-Type','text/html;charset=utf-8');self.end_headers();self.wfile.write(ARTICLE.encode())
    def do_POST(self):
        payload=json.loads(self.rfile.read(int(self.headers.get('Content-Length',0))));data=json.loads(payload['messages'][-1]['content'])
        with lock:calls.append({'model':payload['model'],'data':data});mode=control['mode'];delay=control['delay']
        def translated(parts):
            return [{'id':p['id'],'text':p['text'] if not p['text'].strip() or p['text'].startswith('⟦SHIYI_') else '译-'+p['text'].strip()} for p in reversed(parts)]
        try:
            if delay:time.sleep(delay)
            if data['task']=='blocks':
                blocks=[]
                for block in reversed(data['blocks']):
                    text=''.join(p['text'] for p in block['parts'])
                    if mode=='corrupt' and text.startswith('Block 10:'):continue
                    item={'id':block['id'],'parts':translated(block['parts'])};blocks.append(item)
                    if mode=='corrupt' and text.startswith('Block 20:'):blocks.append(item)
                result={'blocks':blocks}
            else:result={'parts':translated(data['parts'])}
            self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(json.dumps({'choices':[{'message':{'content':json.dumps(result,ensure_ascii=False)}}]}).encode())
        except (BrokenPipeError,ConnectionResetError):pass

def passed(name,detail=None):
    report['checks'].append({'name':name,'result':'pass',**({'detail':detail} if detail else {})});print('PASS:',name,flush=True)

server=ThreadingHTTPServer(('127.0.0.1',0),Handler);Thread(target=server.serve_forever,daemon=True).start()
origin='http://127.0.0.1:'+str(server.server_port)
try:
    with tempfile.TemporaryDirectory(prefix='shiyi-reading-prefs-') as temp,sync_playwright() as p:
        candidates=sorted((Path.home()/'Library/Caches/ms-playwright').glob('chromium-*'),key=lambda path:int(path.name.split('-')[-1]),reverse=True)
        browser=next(path/'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' for path in candidates if (path/'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing').is_file())
        extension=Path(temp)/'exact-zip'
        with zipfile.ZipFile(ROOT/'releases'/f'dianyi-chrome-edge-{VERSION}.zip') as archive:archive.extractall(extension)
        ctx=p.chromium.launch_persistent_context(temp,executable_path=str(browser),headless=True,ignore_default_args=['--disable-extensions'],args=['--disable-extensions-except='+str(extension),'--load-extension='+str(extension)],viewport={'width':1440,'height':1100})
        try:
            worker=ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker');ext=worker.url.split('/')[2]
            ui=ctx.new_page();ui.on('pageerror',lambda e:report['errors'].append(str(e)));ui.goto('chrome-extension://'+ext+'/options.html#translation')
            expect(ui.get_by_label('每批翻译块数',exact=True)).to_have_value('16')
            expect(ui.get_by_label('双语译文字号',exact=True)).to_have_value('0')
            def message(kind,**payload):
                result=ui.evaluate('data=>chrome.runtime.sendMessage(data)',{'type':'SHIYI/'+kind,**payload});assert result['ok'],result;return result['data']
            def save():
                ui.get_by_role('button',name='保存偏好',exact=True).click();expect(ui.locator('#notice')).to_contain_text('翻译偏好已保存');expect(ui.get_by_role('button',name='保存偏好',exact=True)).to_be_enabled()
            def batch_size(size):ui.get_by_label('每批翻译块数',exact=True).fill(str(size));save()
            profile={'provider':'custom','name':'Local settings fixture','endpoint':origin+'/v1/chat/completions','model':'prefs-default','auth':'none','timeoutSeconds':5,'rememberKey':False}
            def model(name):message('SAVE_PROFILE',profile={**profile,'model':name})
            model('prefs-default')
            article=ctx.new_page();article.on('pageerror',lambda e:report['errors'].append(str(e)));article.goto(origin+'/article');expect(article.locator('#shiyi-extension-root')).to_be_attached()
            initial=article.locator('main').inner_html();tab=ui.evaluate('async url=>(await chrome.tabs.query({})).find(t=>t.url===url).id',article.url)
            def command(action,mode=None):return message('PAGE_COMMAND',tabId=tab,action=action,**({'mode':mode} if mode else {}))
            def status():return message('UI_STATE',tabId=tab)['tab']['page']
            def complete():
                deadline=time.monotonic()+30;value=None
                while time.monotonic()<deadline:
                    value=status()
                    if value and value['active'] and not value['running'] and value['phase'] in ('complete','paused'):return value
                    ui.wait_for_timeout(30)
                raise AssertionError(value)
            def correct(excluded=()):
                for i in range(65):
                    if i in excluded:continue
                    expect(article.locator('#link'+str(i))).to_have_text('译-link '+str(i))
                    expect(article.locator('#em'+str(i))).to_have_text('译-detail '+str(i))
                    assert article.locator('#p'+str(i)).evaluate('node=>node.firstChild.data.trim()')=='译-Block '+str(i)+':'
                    expect(article.locator('#p'+str(i)+' code')).to_have_text('protectedCode'+str(i)+'()')
                assert article.evaluate('sourceLinks.every((a,i)=>a===document.getElementById("link"+i))')

            assert message('UI_STATE')['prefs']['batchSize']==16
            passed('Fresh and legacy-compatible preferences default to 16 blocks with independent light and dark color pickers')
            for size in [16,32,64]:
                batch_size(size);model('prefs-'+str(size));command('translate','translation');result=complete()
                assert result['completed']==65 and result['failed']==0,result
                correct();requests=[c['data'] for c in calls if c['model']=='prefs-'+str(size)]
                maximum=max(len(c.get('blocks',[])) or 1 for c in requests);assert maximum==size,(size,maximum)
                command('restore');assert article.locator('main').inner_html()==initial
                passed(str(size)+'-block requests map every reversed block and fragment to the correct text, link and emphasis, then restore exact HTML',{'maximum_observed_batch':maximum,'requests':len(requests)})

            batch_size(16);model('prefs-corrupt');control['mode']='corrupt';command('translate','translation');result=complete()
            assert result['failed']==2 and result['completed']==63,result
            correct(excluded=(10,20))
            expect(article.locator('#link10')).to_have_text('link 10');expect(article.locator('#link20')).to_have_text('link 20')
            before=len(calls);control['mode']='ok';command('retry');result=complete();assert result['failed']==0 and len(calls)==before+2;correct()
            command('restore');passed('Missing and duplicated block IDs preserve only their own originals; retry sends exactly those two failed blocks')

            model('prefs-colors');command('translate','bilingual');complete();before=len(calls)
            original_node=article.locator('#p0 + [data-shiyi-block-translation]');expect(original_node).to_have_css('font-size','16px')
            for tag in ['a','em','code']:
                source_size=article.locator('#p0 '+tag).evaluate('n=>getComputedStyle(n).fontSize')
                expect(original_node.locator(tag)).to_have_css('font-size',source_size)
            passed('Default bilingual text and its nested links, emphasis and code retain each original font size')
            article.evaluate('window.fontTestNode=document.querySelector("#p0 + [data-shiyi-block-translation]")')
            for reduction in [2,4,0]:
                ui.get_by_label('双语译文字号',exact=True).select_option(str(reduction))
                expect(ui.locator('#color-light-preview .preview-translation')).to_have_css('font-size',str(16-reduction)+'px')
                save();expect(original_node).to_have_css('font-size',str(16-reduction)+'px')
                for tag in ['a','em','code']:
                    size=article.locator('#p0 '+tag).evaluate('n=>parseFloat(getComputedStyle(n).fontSize)')
                    expect(original_node.locator(tag)).to_have_css('font-size',str(int(size)-reduction)+'px')
                assert article.evaluate('fontTestNode===document.querySelector("#p0 + [data-shiyi-block-translation]")')
                assert len(calls)==before
            ui.get_by_label('双语译文字号',exact=True).select_option('2');save()
            command('mode','translation');expect(article.locator('#p0')).to_have_css('font-size','16px');expect(article.locator('#p0 code')).to_have_css('font-size','12px')
            command('mode','bilingual');expect(original_node).to_have_css('font-size','14px')
            assert len(calls)==before
            ui.reload();expect(ui.get_by_label('双语译文字号',exact=True)).to_have_value('2')
            article.reload();expect(article.locator('#p0 + [data-shiyi-block-translation]')).to_have_css('font-size','14px')
            assert len(calls)==before
            ui.get_by_label('双语译文字号',exact=True).select_option('0');save();expect(article.locator('#p0 + [data-shiyi-block-translation]')).to_have_css('font-size','16px')
            passed('Font choices repaint existing nodes without model calls; translation-only retains original sizes and reload restores the saved choice with cached translations')
            ui.get_by_role('button',name='浅色页面：蓝色',exact=True).click();ui.get_by_role('button',name='深色页面：浅蓝',exact=True).click()
            expect(ui.get_by_label('浅色页面取色器',exact=True)).to_have_value('#1d4ed8');expect(ui.get_by_label('深色页面颜色值',exact=True)).to_have_value('#bfdbfe')
            ui.get_by_label('浅色页面颜色值',exact=True).fill('#aa22cc')
            expect(ui.get_by_label('浅色页面取色器',exact=True)).to_have_value('#aa22cc')
            assert ui.locator('#color-light-preview .preview-translation').evaluate('node=>getComputedStyle(node).color')=='rgb(170, 34, 204)'
            ui.get_by_role('button',name='浅色页面：蓝色',exact=True).click();save()
            expect(article.locator('[data-shiyi-block-translation]').first).to_have_css('color','rgb(29, 78, 216)')
            assert status()['active'] and len(calls)==before
            article.emulate_media(color_scheme='dark');expect(article.locator('[data-shiyi-block-translation]').first).to_have_css('color','rgb(191, 219, 254)')
            article.emulate_media(color_scheme='light');command('restore');command('translate','bilingual');complete();assert len(calls)==before
            command('restore');passed('Palette, custom hex and native picker stay synchronized; saved colors repaint light/dark results without model requests or cache invalidation')

            batch_size(32);model('prefs-live');control['delay']=.25;command('translate','bilingual')
            deadline=time.monotonic()+5
            while len([c for c in calls if c['model']=='prefs-live'])<2 and time.monotonic()<deadline:ui.wait_for_timeout(20)
            ui.get_by_label('双语译文字号',exact=True).select_option('2');ui.get_by_label('每批翻译块数',exact=True).fill('4');ui.get_by_label('浅色页面颜色值',exact=True).fill('#6d28d9');save()
            result=complete();control['delay']=0
            assert result['completed']==65 and result['failed']==0,result
            expect(article.locator('[data-shiyi-block-translation]').first).to_have_css('color','rgb(109, 40, 217)')
            expect(article.locator('#p0 + [data-shiyi-block-translation]')).to_have_css('font-size','14px')
            command('mode','translation');correct();command('restore');assert article.locator('main').inner_html()==initial
            passed('Saving font size, batch size and color during in-flight 32-block work preserves the job, correctly applies later batches, and loses no mappings')

            entry={'id':'color-word','identity':'zh-CN\x1flink 5','text':'link 5','translation':'链接五','kind':'phrase','sourceLanguage':'en','targetLanguage':'zh-CN','style':'regular','source':{'domain':'127.0.0.1','url':'','title':'Color fixture'},'createdAt':1,'updatedAt':1}
            assert ui.evaluate('''entry=>new Promise((resolve,reject)=>{const o=indexedDB.open('shiyi-vocabulary');o.onsuccess=()=>{const db=o.result,tx=db.transaction('entries','readwrite');tx.objectStore('entries').put(entry);tx.oncomplete=()=>{db.close();resolve(true)};tx.onerror=()=>reject(tx.error)}})''',entry)
            article.reload();expect(article.locator('#link5 [data-shiyi-mark]')).to_have_count(1);article.locator('#link5 [data-shiyi-mark]').hover()
            expect(article.locator('#shiyi-extension-root .card .meaning')).to_have_css('color','rgb(109, 40, 217)')
            ui.get_by_role('button',name='括号释义',exact=True).click();save();expect(article.locator('#link5 [data-shiyi-meaning]')).to_have_css('color','rgb(109, 40, 217)')
            passed('The configured light-page color also applies to saved hover definitions and inline parenthetical meanings')

            ui.get_by_role('button',name='悬浮释义',exact=True).click();ui.get_by_label('双语译文字号',exact=True).select_option('0');ui.get_by_label('每批翻译块数',exact=True).fill('16');ui.get_by_role('button',name='浅色页面：蓝色',exact=True).click();save();ui.reload()
            expect(ui.get_by_label('每批翻译块数',exact=True)).to_have_value('16');expect(ui.get_by_label('浅色页面颜色值',exact=True)).to_have_value('#1d4ed8')
            expect(ui.get_by_label('深色页面取色器',exact=True)).to_have_value('#bfdbfe')
            ui.locator('#reading-preferences-card').screenshot(path=str(OUT/'reading-preferences.png'),animations='disabled',caret='initial')
            for width in [1440,1024,768,375]:
                ui.set_viewport_size({'width':width,'height':1100});assert ui.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),width
            ui.locator('#reading-preferences-card').screenshot(path=str(OUT/'reading-preferences-mobile.png'),animations='disabled',caret='initial')
            passed('Batch and color choices survive reload and the settings fit 375–1440px without horizontal overflow')
            assert not report['errors'],report['errors']
            assert 'protectedCode' not in json.dumps([c['data'] for c in calls])
            report['result']='pass'
        except Exception:
            report['failure_state']={'reader':status(),'prefs':message('UI_STATE')['prefs'],'link':article.locator('#link5').evaluate('n=>n.outerHTML'),'body':article.evaluate('({marks:document.querySelectorAll("[data-shiyi-mark]").length,meanings:document.querySelectorAll("[data-shiyi-meaning]").length,translations:document.querySelectorAll("[data-shiyi-block-translation]").length,selection:String(getSelection())})')}
            for i,page in enumerate(ctx.pages):
                try:page.screenshot(path=str(OUT/('reading-prefs-failure-'+str(i)+'.png')),full_page=True,caret='initial')
                except Exception:pass
            raise
        finally:ctx.close()
except Exception as error:
    report['result']='fail';report['failure']=str(error);raise
finally:
    server.shutdown();server.server_close();(OUT/f'reading-preferences-{VERSION}.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'result':report['result'],'checks':len(report['checks']),'failure':report.get('failure')},ensure_ascii=False),flush=True)
