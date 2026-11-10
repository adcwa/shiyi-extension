"""Exercise contextual word explanations in an actual isolated MV3 extension."""
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread, Lock, Event
from playwright.sync_api import sync_playwright, expect
from browser_binary import browser_binary
import json, shutil, tempfile, time

ROOT = Path(__file__).resolve().parents[1]
VERSION = json.loads((ROOT / 'package.json').read_text())['version']
OUT = ROOT / 'verification'
OUT.mkdir(exist_ok=True)
calls, lock, control = [], Lock(), {'mode': 'ok', 'version': 1}
release_translation = Event()
ARTICLE = '''<!doctype html><html lang="en"><meta charset="utf-8"><title>Understanding retrieval</title>
<style>body{font:18px/1.8 system-ui;margin:60px;max-width:680px}p{margin:32px 0}.private{display:none}</style>
<body><main><p id="first">RAG retrieves documents before generation.<span class="private">DO_NOT_SEND_HIDDEN</span></p>
<p id="second">In a textile discussion RAG refers to a piece of old cloth.</p>
<p id="third">Vector databases store embeddings.</p>
<textarea>DO_NOT_SEND_DRAFT</textarea><input value="DO_NOT_SEND_INPUT"><div contenteditable="true">DO_NOT_SEND_EDITOR</div></main></body></html>'''


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args): pass

    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type', 'text/html;charset=utf-8')
        self.end_headers()
        self.wfile.write(ARTICLE.encode())

    def do_POST(self):
        payload = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        data = json.loads(payload['messages'][-1]['content'])
        if data.get('task') == 'pronunciation':
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream')
            self.end_headers()
            content = json.dumps({'available': False, 'reason': '此测试词的读音暂不确定。'})
            self.wfile.write(('data: ' + json.dumps({'choices': [{'delta': {'content': content}}]}) + '\n\ndata: [DONE]\n\n').encode())
            return
        with lock:
            mode = control['mode']
            version = control['version']
            calls.append({'payload': payload, 'data': data, 'auth': self.headers.get('Authorization'), 'cookie': self.headers.get('Cookie')})
        try:
            if data.get('task') != 'explain':
                if mode == 'parallel':
                    release_translation.wait(10)
                result = {'translation': '抹布', 'sourceLanguage': 'en', 'kind': 'word'}
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'choices': [{'message': {'content': json.dumps(result)}}]}).encode())
                return
            if mode == '401':
                self.send_response(401)
                self.end_headers()
                return
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream')
            self.end_headers()
            chunks = ['语境含义\n这里的 RAG 是检索增强生成。', '\n补充理解\n先检索资料，再据此生成答案。<img src=x onerror=alert(1)>']
            if 'textile' in data['nearby_context']:
                chunks = ['语境含义\n此处 RAG 指一块旧布。', '\n补充理解\n同一词语的解释取决于当前语境。']
            if version > 1:
                chunks[0] += f'（第{version}版）'
            for chunk in chunks:
                self.wfile.write(('data: ' + json.dumps({'choices': [{'delta': {'content': chunk}}]}) + '\n\n').encode())
                self.wfile.flush()
                time.sleep(1 if mode == 'ok' else 2)
            self.wfile.write(b'data: [DONE]\n\n')
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError): pass


def passed(text):
    print('PASS:', text, flush=True)


server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
Thread(target=server.serve_forever, daemon=True).start()
origin = f'http://127.0.0.1:{server.server_port}'
try:
    with tempfile.TemporaryDirectory(prefix='dianyi-explanation-') as folder, sync_playwright() as playwright:
        extension = Path(folder) / 'extension'
        shutil.copytree(ROOT / 'releases' / ('dianyi-' + VERSION), extension)
        def launch():
            return playwright.chromium.launch_persistent_context(str(Path(folder) / 'profile'), executable_path=browser_binary(), headless=True, ignore_default_args=['--disable-extensions'], args=['--disable-extensions-except=' + str(extension), '--load-extension=' + str(extension)], viewport={'width': 1100, 'height': 850})
        context = launch()
        try:
            worker = context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
            base = 'chrome-extension://' + worker.url.split('/')[2]
            ui = context.new_page()
            ui.goto(base + '/options.html#model')
            expect(ui.locator('h1')).to_be_visible()

            def message(kind, **extra):
                result = ui.evaluate('data=>chrome.runtime.sendMessage(data)', {'type': 'SHIYI/' + kind, **extra})
                assert result['ok'], result
                return result['data']

            profile = {'provider': 'custom', 'name': 'Translation fixture', 'endpoint': origin + '/v1', 'model': 'translation-fixture', 'auth': 'bearer', 'timeoutSeconds': 5, 'rememberKey': False}
            message('SAVE_PROFILE', profile=profile, apiKey='fake-translation-key')
            page = context.new_page()
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(origin + '/reading?private-token=never-send')
            root = page.locator('#shiyi-extension-root')
            expect(root).to_be_attached()
            page.locator('#first').evaluate('node=>{const r=document.createRange();r.setStart(node.firstChild,0);r.setEnd(node.firstChild,3);getSelection().removeAllRanges();getSelection().addRange(r);node.dispatchEvent(new PointerEvent("pointerup",{bubbles:true,button:0}))}')
            root.get_by_role('button', name='翻译为中文', exact=True).click()
            expect(root.locator('.meaning')).to_have_text('抹布')
            expect(root.get_by_role('button', name='展开更多', exact=True)).to_be_visible()
            assert len(calls) == 1 and 'context' not in calls[0]['data']
            passed('The saved translation gains an explicit expansion action with zero automatic summary requests')

            root.get_by_role('button', name='展开更多', exact=True).evaluate('button=>button.click()')
            expect(root.get_by_role('button', name='展开更多', exact=True)).to_have_attribute('aria-expanded', 'false')
            root.get_by_role('button', name='展开更多', exact=True).click()
            expect(root.locator('.explanation').get_by_role('button', name='配置总结模型', exact=True)).to_be_visible()
            expect(root.locator('.meaning')).to_have_text('抹布')
            assert len(calls) == 1
            summary = {**profile, 'name': 'Summary fixture', 'model': 'summary-fixture'}
            message('SAVE_SUMMARY_PROFILE', profile=summary, apiKey='fake-summary-key')
            root.get_by_role('button', name='重试', exact=True).click()
            expect(root.locator('.explanation-body')).to_contain_text('检索增强生成')
            expect(root.locator('.explanation')).to_have_attribute('aria-busy', 'true')
            page.mouse.move(10, 10)
            page.wait_for_timeout(350)
            expect(root.get_by_role('region', name='补充解释')).to_be_visible()
            expect(root.locator('.explanation-status')).to_have_text('补充完成 · Summary fixture')
            expect(root.locator('.meaning')).to_have_text('抹布')
            assert root.locator('.explanation img').count() == 0
            assert 'onerror=alert(1)' in root.locator('.explanation-body').inner_text()
            request = calls[-1]
            assert request['payload']['model'] == 'summary-fixture' and request['auth'] == 'Bearer fake-summary-key'
            assert request['data']['current_translation'] == '抹布' and request['data']['nearby_context'] == 'RAG retrieves documents before generation.'
            assert 'DO_NOT_SEND' not in json.dumps(request) and 'private-token' not in json.dumps(request)
            assert request['cookie'] is None and len(message('LIBRARY')['entries']) == 1
            passed('The summary connection streams context-specific explanations, excludes private fields and URL parameters, renders model HTML as text, and preserves the original glossary entry')

            before = len(calls)
            root.get_by_role('button', name='收起补充', exact=True).click()
            root.get_by_role('button', name='展开更多', exact=True).click()
            assert len(calls) == before
            page.screenshot(path=str(OUT / 'word-explanation.png'), animations='disabled', caret='initial')
            root.get_by_role('button', name='关闭释义', exact=True).click()
            expect(root.locator('.card')).to_have_count(0)
            page.locator('#second [data-shiyi-mark]').hover()
            expect(root.locator('.meaning')).to_have_text('抹布')
            root.get_by_role('button', name='展开更多', exact=True).click()
            expect(root.locator('.explanation-body')).to_contain_text('旧布')
            expect(root.locator('.explanation-status')).to_have_text('补充完成 · Summary fixture')
            assert calls[-1]['data']['nearby_context'] == 'In a textile discussion RAG refers to a piece of old cloth.'
            passed('Collapsing and reopening reuses the current result, while another occurrence uses its own current paragraph')

            root.get_by_role('button', name='关闭释义', exact=True).click()
            before = len(calls)
            page.locator('#first [data-shiyi-mark]').hover()
            root.get_by_role('button', name='展开更多', exact=True).click()
            expect(root.locator('.explanation-status')).to_have_text('本地解释 · Summary fixture')
            assert len(calls) == before
            control['version'] = 2
            root.get_by_role('button', name='重新补充', exact=True).click()
            expect(root.locator('.explanation-body')).to_contain_text('第2版')
            expect(root.locator('.explanation-status')).to_have_text('补充完成 · Summary fixture')
            assert len(calls) == before + 1
            page.reload()
            expect(page.locator('#first [data-shiyi-mark]')).to_have_count(1)
            page.locator('#first [data-shiyi-mark]').hover()
            root.get_by_role('button', name='展开更多', exact=True).click()
            expect(root.locator('.explanation-status')).to_have_text('本地解释 · Summary fixture')
            expect(root.locator('.explanation-body')).to_contain_text('第2版')
            assert len(calls) == before + 1
            passed('Completed explanations survive closing and page reload, and explicit regeneration replaces the locally saved result')

            control['version'] = 3
            control['mode'] = 'slow'
            root.get_by_role('button', name='重新补充', exact=True).click()
            expect(root.locator('.explanation-body')).to_contain_text('第3版')
            root.get_by_role('button', name='停止', exact=True).click()
            partial = root.locator('.explanation-body').inner_text()
            expect(root.locator('.explanation-status')).to_have_text('已停止补充')
            page.wait_for_timeout(2200)
            assert root.locator('.explanation-body').inner_text() == partial
            assert len(message('LIBRARY')['entries']) == 1
            control['mode'] = '401'
            root.get_by_role('button', name='重试', exact=True).click()
            expect(root.locator('.explanation').get_by_role('button', name='配置总结模型', exact=True)).to_be_visible()
            expect(root.locator('.meaning')).to_have_text('抹布')
            root.get_by_role('button', name='关闭释义', exact=True).click()
            before = len(calls)
            page.locator('#first [data-shiyi-mark]').hover()
            root.get_by_role('button', name='展开更多', exact=True).click()
            expect(root.locator('.explanation-status')).to_have_text('本地解释 · Summary fixture')
            expect(root.locator('.explanation-body')).to_contain_text('第2版')
            assert '第3版' not in root.locator('.explanation-body').inner_text()
            assert len(calls) == before
            passed('Canceled and failed regeneration never replaces the prior complete local explanation')

            control.update(mode='ok', version=2)
            page.goto(origin + '/other')
            expect(page.locator('#first [data-shiyi-mark]')).to_have_count(1)
            page.locator('#first [data-shiyi-mark]').hover()
            root.get_by_role('button', name='展开更多', exact=True).click()
            expect(root.locator('.explanation-status')).to_have_text('补充完成 · Summary fixture')
            assert len(calls) == before + 1
            passed('The same vocabulary entry on a different page keeps its own local explanation')

            before = len(calls)
            context.close()
            context = launch()
            worker = context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
            ui = context.new_page()
            ui.goto(base + '/options.html#model')
            expect(ui.locator('h1')).to_be_visible()
            page = context.new_page()
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(origin + '/reading?private-token=never-send')
            root = page.locator('#shiyi-extension-root')
            expect(page.locator('#first [data-shiyi-mark]')).to_have_count(1)
            page.locator('#first [data-shiyi-mark]').hover()
            root.get_by_role('button', name='展开更多', exact=True).click()
            expect(root.locator('.explanation-status')).to_have_text('本地解释 · Summary fixture')
            expect(root.locator('.explanation-body')).to_contain_text('第2版')
            assert len(calls) == before
            passed('A full browser restart restores the page explanation locally even after temporary API keys are gone')

            entry = next(item for item in message('LIBRARY')['entries'] if item['text'] == 'RAG')
            ui.evaluate('''async ({entry,url})=>{
                const db=await import('./lib/db.js'), keys=await import('./lib/explanation-model.js');
                const context='RAG retrieves documents before generation.';
                const legacy=await keys.explanationIdentity(url,entry,context), revision=await db.explanationOpen(legacy,entry);
                await db.explanationWrite(legacy,revision,entry,{text:'历史版本地解释',modelName:'Legacy fixture'});
                const current=await keys.selectionExplanationIdentity(url,entry,context);
                await new Promise((resolve,reject)=>{const request=indexedDB.open('shiyi-vocabulary');request.onsuccess=()=>{const d=request.result,tx=d.transaction('explanations','readwrite');tx.objectStore('explanations').delete(current);tx.oncomplete=()=>{d.close();resolve()};tx.onabort=()=>reject(tx.error)};request.onerror=()=>reject(request.error)});
            }''', {'entry': entry, 'url': page.url})
            root.get_by_role('button', name='关闭释义', exact=True).click()
            page.locator('#first [data-shiyi-mark]').hover()
            root.get_by_role('button', name='展开更多', exact=True).click()
            expect(root.locator('.explanation-body')).to_have_text('历史版本地解释')
            expect(root.locator('.explanation-status')).to_have_text('本地解释 · Legacy fixture')
            assert len(calls) == before
            passed('Explanations saved before the parallel-flow upgrade are still read without another model request')

            message('SAVE_PROFILE', profile=profile, apiKey='fake-translation-key')
            message('SAVE_SUMMARY_PROFILE', profile=summary, apiKey='fake-summary-key')
            before = len(calls)
            control.update(mode='parallel', version=1)
            page.locator('#third').evaluate('node=>{const r=document.createRange();r.setStart(node.firstChild,0);r.setEnd(node.firstChild,6);getSelection().removeAllRanges();getSelection().addRange(r);node.dispatchEvent(new PointerEvent("pointerup",{bubbles:true,button:0}))}')
            root.get_by_role('button', name='翻译为中文', exact=True).click()
            expect(root.locator('.explanation-body')).to_contain_text('语境含义')
            expect(root.locator('.meaning')).to_contain_text('正在翻译')
            assert any(call['data'].get('task') == 'explain' and call['data']['selected_text'] == 'Vector' for call in calls[before:])
            assert any(call['data'].get('task') != 'explain' for call in calls[before:])
            release_translation.set()
            expect(root.locator('.meaning')).to_have_text('抹布')
            expect(root.locator('.explanation')).to_have_attribute('aria-busy', 'true')
            page.locator('#third [data-shiyi-mark]').click()
            page.mouse.click(8, 8)
            expect(root.locator('.card')).to_have_count(0)
            page.locator('#third [data-shiyi-mark]').hover()
            root.get_by_role('button', name='展开更多', exact=True).click()
            expect(root.locator('.explanation-status')).to_have_text('本地解释 · Summary fixture')
            assert len(calls) == before + 2
            passed('Translation and explanation requests overlap, translation renders independently, and closing or reopening the card shares the ongoing explanation and its cache')

            context.grant_permissions(['clipboard-read', 'clipboard-write'], origin=origin)
            root.get_by_role('button', name='复制译文', exact=True).click()
            assert page.evaluate('navigator.clipboard.readText()') == '抹布'
            explanation = root.locator('.explanation-body').inner_text()
            root.get_by_role('button', name='复制补充解释', exact=True).click()
            assert page.evaluate('navigator.clipboard.readText()') == explanation
            root.get_by_role('button', name='复制全部', exact=True).click()
            copied = page.evaluate('navigator.clipboard.readText()')
            assert 'Vector' in copied and '抹布' in copied and explanation in copied
            page.evaluate('window.testClipboard=navigator.clipboard;Object.defineProperty(navigator,"clipboard",{value:undefined,configurable:true})')
            root.get_by_role('button', name='复制译文', exact=True).click()
            assert page.evaluate('window.testClipboard.readText()') == '抹布'
            passed('Actual clipboard contents match translation, explanation and combined copy, including the fallback path')

            release_translation.clear()
            page.locator('#third').evaluate('node=>{const n=node.lastChild,i=n.data.indexOf("embeddings"),r=document.createRange();r.setStart(n,i);r.setEnd(n,i+10);getSelection().removeAllRanges();getSelection().addRange(r);node.dispatchEvent(new PointerEvent("pointerup",{bubbles:true,button:0}))}')
            root.get_by_role('button', name='翻译为中文', exact=True).click()
            expect(root.locator('.explanation-body')).to_contain_text('语境含义')
            expect(root.locator('.meaning')).to_contain_text('正在翻译')
            root.get_by_role('button', name='取消', exact=True).click()
            expect(root.get_by_role('button', name='翻译为中文', exact=True)).to_be_visible()
            page.wait_for_timeout(200)
            release_translation.set()
            page.wait_for_timeout(2200)
            assert all(entry['text'] != 'embeddings' for entry in message('LIBRARY')['entries'])
            expect(root.locator('.card')).to_have_count(0)
            passed('Canceling the pending lookup stops both operations and late responses cannot restore the closed result')
            assert not errors, errors
        finally:
            context.close()
finally:
    server.shutdown()
    server.server_close()
