"""Exercise offline dictionary, model fallback/cache, and local speech in Chromium."""
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread, Event
from playwright.sync_api import sync_playwright, expect
from browser_binary import browser_binary
import json, shutil, tempfile

ROOT = Path(__file__).resolve().parents[1]
VERSION = json.loads((ROOT / 'package.json').read_text())['version']
calls = []
release_pronunciation, pronunciation_started = Event(), Event()
ARTICLE = '<!doctype html><html lang="en"><meta charset="utf-8"><style>body{font:18px/1.8 system-ui;margin:50px}p{margin:40px 0}</style><body><p id="word">Workflow orchestration coordinates tasks.</p><p id="engineer">An engineer designs systems.</p><p id="phrase">We study distributed systems.</p><textarea>DO_NOT_SEND_EDITOR</textarea></body></html>'
PRONUNCIATION = {'available': True, 'british': '/dɪˈstrɪb.juː.tɪd ˈsɪs.təmz/', 'american': '/dɪˈstrɪb.jə.tɪd ˈsɪs.təmz/', 'syllables': 'dis-trib-ut-ed sys-tems', 'explanation': 'distributed 的主重音在 /strɪb/，注意词尾 /tɪd/。'}

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def do_GET(self):
        self.send_response(200); self.send_header('Content-Type', 'text/html;charset=utf-8'); self.end_headers(); self.wfile.write(ARTICLE.encode())
    def do_POST(self):
        payload = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        calls.append({'payload': payload, 'auth': self.headers.get('Authorization')})
        assert json.loads(payload['messages'][-1]['content'])['task'] == 'pronunciation'
        pronunciation_started.set()
        release_pronunciation.wait(10)
        self.send_response(200); self.send_header('Content-Type', 'text/event-stream'); self.end_headers()
        event = 'data: ' + json.dumps({'choices': [{'delta': {'content': json.dumps(PRONUNCIATION, ensure_ascii=False)}}]}) + '\n\ndata: [DONE]\n\n'
        self.wfile.write(event.encode()); self.wfile.flush()

server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
Thread(target=server.serve_forever, daemon=True).start()
origin = f'http://127.0.0.1:{server.server_port}'
try:
    with tempfile.TemporaryDirectory(prefix='dianyi-pronunciation-') as folder, sync_playwright() as playwright:
        extension = Path(folder) / 'extension'
        shutil.copytree(ROOT / 'releases' / ('dianyi-' + VERSION), extension)
        context = playwright.chromium.launch_persistent_context(str(Path(folder) / 'profile'), executable_path=browser_binary(), headless=True, ignore_default_args=['--disable-extensions'], args=['--disable-extensions-except=' + str(extension), '--load-extension=' + str(extension)], viewport={'width': 1000, 'height': 850})
        try:
            worker = context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
            base = 'chrome-extension://' + worker.url.split('/')[2]
            ui = context.new_page(); ui.goto(base + '/options.html#model'); expect(ui.locator('h1')).to_be_visible()
            def message(kind, **extra):
                response = ui.evaluate('data=>chrome.runtime.sendMessage(data)', {'type': 'SHIYI/' + kind, **extra})
                assert response['ok'], response
                return response['data']
            message('VOCABULARY_IMPORT', data={'format': 'shiyi-vocabulary', 'version': 1, 'entries': [
                {'id': 'legacy-word', 'text': 'orchestration', 'translation': '编排', 'targetLanguage': 'zh-CN', 'kind': 'word'},
                {'id': 'engineer-word', 'text': 'engineer', 'translation': '工程师', 'targetLanguage': 'zh-CN', 'kind': 'word'},
                {'id': 'phrase-word', 'text': 'distributed systems', 'translation': '分布式系统', 'targetLanguage': 'zh-CN', 'kind': 'phrase'}]})
            page = context.new_page()
            errors = []; page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(origin + '/reading?private-token=never-send')
            tab_id = ui.evaluate('async url=>(await chrome.tabs.query({})).find(tab=>tab.url===url).id', page.url)
            def speech(action):
                # Model the native API in the extension's isolated world, where
                # the content script actually runs, instead of the page world.
                return ui.evaluate('''async ({tabId,action})=>{
                    const [result]=await chrome.scripting.executeScript({target:{tabId},args:[action],func:action=>{
                        if(action==='init'){
                            globalThis.testSpeech=[];globalThis.testVoices=[{name:'Remote',lang:'en-US',localService:false},{name:'Local UK',lang:'en-GB',localService:true},{name:'Local US',lang:'en-US',localService:true}];
                            globalThis.SpeechSynthesisUtterance=class{constructor(text){this.text=text}};
                            const service=new EventTarget();service.getVoices=()=>globalThis.testVoices;service.cancel=()=>globalThis.testSpeech.push({cancel:true});service.speak=u=>globalThis.testSpeech.push({text:u.text,lang:u.lang,voice:u.voice.name});
                            Object.defineProperty(globalThis,'speechSynthesis',{value:service,configurable:true});
                        }
                        if(action==='empty')globalThis.testVoices=[];
                        return globalThis.testSpeech;
                    }});return result.result;
                }''', {'tabId': tab_id, 'action': action})
            speech('init')
            # A previous model's "unknown" result must not hide a newly bundled
            # dictionary headword when upgrading an existing installation.
            ui.evaluate('''async url=>{
                const store=await import('./lib/db.js');
                const {pronunciationIdentity}=await import('./lib/pronunciation-model.js');
                const entry=(await store.listEntries('zh-CN')).find(item=>item.text==='orchestration');
                const id=await pronunciationIdentity(url,entry,'Workflow orchestration coordinates tasks.');
                const revision=await store.explanationOpen(id,entry);
                await store.explanationWrite(id,revision,entry,{text:JSON.stringify({available:false,reason:'Old model could not identify this word.'}),modelName:'Old model'});
            }''', page.url)
            root = page.locator('#shiyi-extension-root')
            expect(page.locator('[data-shiyi-mark]')).to_have_count(3)
            page.locator('#word [data-shiyi-mark]').hover()
            expect(root.get_by_role('button', name='查看读音', exact=True)).to_have_count(0)
            expect(root.get_by_label('国际音标', exact=True)).to_contain_text('/ˌɔɹkəˈstɹeɪʃən/')
            expect(root.locator('.pronunciation-notes')).to_be_hidden()
            root.get_by_role('button', name='发音说明', exact=True).click()
            expect(root.locator('.pronunciation-notes')).to_contain_text('本地词典')
            expect(root.locator('[data-pronunciation]').get_by_role('button', name='配置总结模型', exact=True)).to_have_count(0)
            assert not calls
            expect(root.locator('.meaning')).to_have_text('编排')

            page.keyboard.press('Escape'); page.mouse.move(10, 10)
            context.set_offline(True)
            page.locator('#engineer [data-shiyi-mark]').hover()
            expect(root.get_by_label('国际音标', exact=True)).to_contain_text('/ˌɛndʒəˈnɪɹ/')
            root.get_by_role('button', name='听美音', exact=True).click()
            assert speech('read')[-1] == {'text': 'engineer', 'lang': 'en-US', 'voice': 'Local US'}
            page.keyboard.press('Escape'); page.mouse.move(10, 10)
            context.set_offline(False)
            page.locator('#phrase [data-shiyi-mark]').hover()
            expect(root.get_by_label('国际音标', exact=True)).to_contain_text('本地词典暂无')
            expect(root.locator('[data-pronunciation]').get_by_role('button', name='配置总结模型', exact=True)).to_have_count(0)
            assert not calls
            print('PASS: A fresh install has offline IPA and local playback without a summary model; an unlisted phrase keeps playback and never demands configuration', flush=True)

            profile = {'provider': 'custom', 'name': 'Pronunciation fixture', 'endpoint': origin + '/v1', 'model': 'summary', 'auth': 'bearer', 'timeoutSeconds': 5, 'rememberKey': False}
            message('SAVE_SUMMARY_PROFILE', profile=profile, apiKey='fake-pronunciation-key')
            page.keyboard.press('Escape'); expect(root.locator('.card')).to_have_count(0)
            page.mouse.move(10, 10)
            page.locator('#engineer [data-shiyi-mark]').hover()
            expect(root.get_by_label('国际音标', exact=True)).to_contain_text('/ˌɛndʒəˈnɪɹ/')
            assert not calls
            page.keyboard.press('Escape'); page.mouse.move(10, 10)
            page.locator('#phrase [data-shiyi-mark]').hover()
            expect(root.get_by_label('国际音标', exact=True)).to_have_text('正在加载音标…')
            assert pronunciation_started.wait(5)
            page.mouse.move(10, 10)
            expect(root.locator('.card')).to_have_count(0)
            page.locator('#phrase [data-shiyi-mark]').hover()
            expect(root.get_by_label('国际音标', exact=True)).to_have_text('正在加载音标…')
            assert len(calls) == 1
            release_pronunciation.set()
            expect(root.get_by_label('国际音标', exact=True)).to_contain_text(PRONUNCIATION['british'])
            expect(root.get_by_label('国际音标', exact=True)).to_contain_text(PRONUNCIATION['american'])
            expect(root.locator('.pronunciation-notes')).to_be_hidden()
            root.get_by_role('button', name='发音说明', exact=True).click()
            expect(root.locator('.pronunciation-notes')).to_contain_text('主重音')
            assert len(calls) == 1 and calls[0]['auth'] == 'Bearer fake-pronunciation-key'
            assert 'DO_NOT_SEND' not in json.dumps(calls) and 'private-token' not in json.dumps(calls)
            print('PASS: Dictionary hits bypass a configured summary model; an unlisted phrase automatically shares one fallback request across reopening and keeps guidance collapsed', flush=True)

            speech('init')
            root.get_by_role('button', name='听英音', exact=True).click()
            expect(root.get_by_role('button', name='听英音', exact=True)).to_have_text('停止朗读')
            root.get_by_role('button', name='听美音', exact=True).click()
            expect(root.get_by_role('button', name='听美音', exact=True)).to_have_text('停止朗读')
            spoken = [item for item in speech('read') if item.get('text')]
            assert [item['voice'] for item in spoken] == ['Local UK', 'Local US']
            assert all(item['text'] == 'distributed systems' for item in spoken)
            context.grant_permissions(['clipboard-read', 'clipboard-write'], origin=origin)
            root.get_by_role('button', name='复制读音', exact=True).click()
            assert PRONUNCIATION['british'] in page.evaluate('navigator.clipboard.readText()')
            root.get_by_role('button', name='复制全部', exact=True).click()
            assert '主重音' in page.evaluate('navigator.clipboard.readText()')
            print('PASS: British/American playback selects only matching local voices, and pronunciation is copyable', flush=True)

            page.set_viewport_size({'width': 375, 'height': 760})
            page.reload(); expect(page.locator('[data-shiyi-mark]')).to_have_count(3)
            page.locator('#phrase [data-shiyi-mark]').hover()
            expect(root.get_by_label('国际音标', exact=True)).to_contain_text(PRONUNCIATION['american'])
            root.get_by_role('button', name='发音说明', exact=True).click()
            expect(root.locator('.pronunciation-notes')).to_contain_text('dis-trib-ut-ed')
            assert len(calls) == 1
            assert root.locator('.card').evaluate('node=>{const r=node.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight}')
            OUT = ROOT / 'verification'; OUT.mkdir(exist_ok=True)
            page.screenshot(path=str(OUT / 'pronunciation-card.png'), animations='disabled', caret='initial')
            message('CLEAR_SUMMARY_KEY')
            page.reload(); expect(page.locator('[data-shiyi-mark]')).to_have_count(3)
            page.locator('#phrase [data-shiyi-mark]').hover()
            expect(root.get_by_label('国际音标', exact=True)).to_contain_text(PRONUNCIATION['british'])
            assert len(calls) == 1
            print('PASS: Cached IPA restores after refresh and key removal and fits a 375px viewport', flush=True)

            speech('init'); speech('empty')
            root.get_by_role('button', name='听英音', exact=True).click()
            expect(root.locator('[data-pronunciation] [role="alert"]')).to_contain_text('本机暂无英式英语语音')
            assert len(calls) == 1
            print('PASS: Missing local voices give an inline recovery message without a remote speech request', flush=True)
            assert not errors, errors
        finally: context.close()
finally:
    server.shutdown(); server.server_close()
