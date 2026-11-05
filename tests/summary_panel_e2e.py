"""Native tab-scoped side panels from the exact ZIP, with real local HTTP/SSE.

Uses a temporary browser profile and synthetic public article text. No provider
credentials, production hooks, or user browser data are used.
"""
from pathlib import Path
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from playwright.sync_api import sync_playwright, expect
from browser_binary import browser_binary
import base64, json, tempfile, time, zipfile

ROOT = Path(__file__).resolve().parents[1]
VERSION = json.loads((ROOT/'package.json').read_text())['version']
OUT = ROOT/'verification' / (sys.argv[1] if len(sys.argv) > 1 else '')
OUT.mkdir(exist_ok=True)
report = {'version': VERSION, 'result': 'running', 'scope': 'Exact unmodified ZIP; native Chrome side panel; isolated temporary profile; local HTTP/SSE only.', 'checks': []}
calls, errors = [], []

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def do_GET(self):
        marker = self.path.strip('/').replace('?', ' ') or 'article'
        body = f'''<!doctype html><html lang="en"><meta charset="utf-8"><title>{marker} · Native summary</title><style>body{{margin:0;color:#263735;font:18px/1.9 system-ui}}main{{max-width:720px;margin:60px auto;padding:25px}}h1{{font-size:28px}}</style><main><h1>{marker}</h1><p>PAGE_MARKER_{marker}: Original source evidence for this page. The sidebar summarizes only this article, and its state belongs to this browser tab.</p><p>The reader can switch tabs, refresh this article and close the side panel. Existing source text and links stay available.</p><p>这是本地原生侧栏验收文章，不使用模型账户或真实密钥。</p></main></html>'''
        self.send_response(200); self.send_header('Content-Type', 'text/html;charset=utf-8'); self.end_headers(); self.wfile.write(body.encode())
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        calls.append(body)
        source = json.loads(body['messages'][-1]['content'])['page_content']
        marker = source.split('PAGE_MARKER_')[-1].split(':')[0]
        self.send_response(200); self.send_header('Content-Type', 'text/event-stream'); self.end_headers()
        output = f'## {marker} 的重点\n\n侧栏打开后自动读取当前标签页，原网页保留不变。\n\n- 各标签页独立开启。\n- 黑名单页面不显示侧栏。\n\n```javascript\nconst tabScoped = true;\n```\n'
        try:
            for n in range(0, len(output), 18):
                self.wfile.write(('data: '+json.dumps({'choices': [{'delta': {'content': output[n:n+18]}}]}, ensure_ascii=False)+'\n\n').encode()); self.wfile.flush(); time.sleep(.035)
            self.wfile.write(b'data: [DONE]\n\n'); self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError): pass

def passed(name, detail=None):
    report['checks'].append({'name': name, 'result': 'pass', **({'detail': detail} if detail else {})})
    print('PASS: '+name, flush=True)

server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
Thread(target=server.serve_forever, daemon=True).start()
port = server.server_port
origin_a, origin_b = f'http://127.0.0.1:{port}', f'http://localhost:{port}'
try:
    with tempfile.TemporaryDirectory(prefix='dianyi-tab-panel-') as temp, sync_playwright() as p:
        extension = Path(temp)/'extension'
        with zipfile.ZipFile(ROOT/'releases'/f'dianyi-chrome-edge-{VERSION}.zip') as archive:
            archive.extractall(extension)
        binary = browser_binary()
        context = p.chromium.launch_persistent_context(str(Path(temp)/'profile'), executable_path=binary, headless=False, ignore_default_args=['--disable-extensions'], args=['--window-size=1380,950', '--disable-extensions-except='+str(extension), '--load-extension='+str(extension)], no_viewport=True)
        try:
            worker = context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
            ext = worker.url.split('/')[2]
            ui = context.new_page(); ui.goto(f'chrome-extension://{ext}/options.html#summary')
            expect(ui.locator('h1')).to_be_visible()
            def message(kind, **fields):
                reply = ui.evaluate('m=>chrome.runtime.sendMessage(m)', {'type': 'SHIYI/'+kind, **fields})
                assert reply['ok'], reply
                return reply.get('data')
            message('SAVE_SUMMARY_PROFILE', profile={'provider': 'custom', 'name': 'Native panel fixture', 'endpoint': origin_a+'/v1', 'model': 'local-panel-fixture', 'auth': 'none', 'timeoutSeconds': 5, 'rememberKey': False}, apiKey='')
            message('SAVE_SUMMARY_PREFS', prefs={'preset': 'general'})
            ui.wait_for_timeout(300)
            article_a = context.new_page(); article_a.goto(origin_a+'/article-a')
            article_b = context.new_page(); article_b.goto(origin_b+'/article-b')
            for page in [article_a, article_b]:
                page.on('pageerror', lambda error: errors.append(str(error)))
                expect(page.locator('#shiyi-extension-root')).to_be_attached()
            tab_ids = ui.evaluate('async urls=>(await chrome.tabs.query({})).filter(t=>urls.includes(t.url)).map(t=>({id:t.id,url:t.url}))', [article_a.url, article_b.url])
            ids = {tab['url']: tab['id'] for tab in tab_ids}
            a, b = ids[article_a.url], ids[article_b.url]
            browser_cdp = context.new_cdp_session(ui)
            replies, sessions = {}, {}
            browser_cdp.on('Target.receivedMessageFromTarget', lambda info: replies.update({(info['sessionId'], json.loads(info['message']).get('id')): json.loads(info['message'])}))
            sequence = 0
            def targets(): return browser_cdp.send('Target.getTargets')['targetInfos']
            def panel_target(tab_id):
                return next((item for item in targets() if item['url'] == f'chrome-extension://{ext}/summary.html?tabId={tab_id}'), None)
            def rpc(target, method, params=None):
                global sequence
                sequence += 1
                if target not in sessions: sessions[target] = browser_cdp.send('Target.attachToTarget', {'targetId': target, 'flatten': False})['sessionId']
                session = sessions[target]
                browser_cdp.send('Target.sendMessageToTarget', {'sessionId': session, 'message': json.dumps({'id': sequence, 'method': method, 'params': params or {}})})
                deadline = time.monotonic()+8
                while (session, sequence) not in replies and time.monotonic() < deadline: ui.wait_for_timeout(20)
                answer = replies.pop((session, sequence), None)
                assert answer and 'error' not in answer, answer
                return answer['result']
            def panel_value(tab_id, expression):
                target = panel_target(tab_id); assert target, targets()
                result = rpc(target['targetId'], 'Runtime.evaluate', {'expression': expression, 'returnByValue': True})
                assert 'exceptionDetails' not in result, result
                return result['result'].get('value')
            def wait(check, seconds=10):
                deadline = time.monotonic()+seconds
                while time.monotonic() < deadline:
                    if check(): return
                    ui.wait_for_timeout(50)
                raise AssertionError('Native side panel did not reach the expected state')
            def completed(tab_id):
                wait(lambda: panel_target(tab_id) and panel_value(tab_id, 'document.querySelector("#summary-status").textContent') == '总结完成')
            def open_panel(article, tab_id):
                article.bring_to_front()
                worker.evaluate('''async id=>{
                  const {windowId}=await chrome.tabs.update(id,{active:true});
                  await chrome.windows.update(windowId,{focused:true});
                  await chrome.action.openPopup({windowId});
                }''',tab_id)
                def popup_target():
                    return next((target for target in targets() if target['url'] == f'chrome-extension://{ext}/popup.html'), None)
                wait(popup_target)
                target = popup_target()['targetId']
                def summary_button():
                    expression = """(()=>{const button=document.querySelector('#summarize-page');if(!button||button.disabled)return null;
                      const rect=button.getBoundingClientRect();return {x:rect.x+rect.width/2,y:rect.y+rect.height/2};})()"""
                    return rpc(target,'Runtime.evaluate',{'expression':expression,'returnByValue':True})['result'].get('value')
                wait(summary_button)
                position = summary_button()
                for event in ('mousePressed', 'mouseReleased'):
                    rpc(target, 'Input.dispatchMouseEvent', {'type':event, 'button':'left', 'clickCount':1, **position})
                wait(lambda: article.evaluate('innerWidth') < full_width-100)
                completed(tab_id)
            def close_panel(article, tab_id):
                worker.evaluate('id=>chrome.sidePanel.close({tabId:id})', tab_id)
                ui.wait_for_timeout(250)
                article.bring_to_front()

            edge = worker.evaluate('()=>/\\bEdg\\//.test(navigator.userAgent)')
            defaults = worker.evaluate('()=>chrome.sidePanel.getOptions({})')
            assert defaults['enabled'] is False, defaults
            for tab_id in [a, b]:
                option = worker.evaluate('tabId=>chrome.sidePanel.getOptions({tabId})', tab_id)
                assert option['enabled'] is (not edge) and option['path'] == f'summary.html?tabId={tab_id}', option
            assert len(calls) == 0
            passed('global fallback is disabled; per-tab entries do not generate summaries')

            article_a.bring_to_front(); full_width = article_a.evaluate('innerWidth')
            open_panel(article_a, a)
            assert len(calls) == 1 and 'PAGE_MARKER_article-a' in calls[-1]['messages'][-1]['content']
            narrow_width = article_a.evaluate('innerWidth'); assert narrow_width < full_width-100, (full_width, narrow_width)
            assert '抓住重点，继续阅读' not in panel_value(a, 'document.body.innerText')
            assert 'article-a 的重点' in panel_value(a, 'document.querySelector("#summary-doc").innerText')
            passed('production popup opens a native tab panel and auto-streams once without the old empty guide', {'full_width': full_width, 'article_width_with_panel': narrow_width})
            screenshot = rpc(panel_target(a)['targetId'], 'Page.captureScreenshot', {'format': 'png'})
            (OUT/f'summary-panel-{VERSION}.png').write_bytes(base64.b64decode(screenshot['data']))
            assert panel_value(a, 'document.querySelectorAll("form,input,select,textarea,[data-open]").length') == 0
            assert panel_value(a, 'document.documentElement.scrollWidth<=innerWidth') is True
            passed('actual side panel renders summary and code, without settings or translation controls')

            article_b.bring_to_front(); ui.wait_for_timeout(500)
            assert article_b.evaluate('innerWidth') == full_width
            assert not panel_target(b) and len(calls) == 1
            article_a.bring_to_front(); ui.wait_for_timeout(400)
            assert article_a.evaluate('innerWidth') == narrow_width and len(calls) == 1
            passed('switching to an unopened tab hides the panel; returning restores only that tab without a request')

            open_panel(article_b, b)
            assert len(calls) == 2 and 'PAGE_MARKER_article-b' in calls[-1]['messages'][-1]['content']
            assert 'article-a 的重点' in panel_value(a, 'document.querySelector("#summary-doc").innerText')
            passed('second tab opens independently and cannot overwrite the first tab result')
            before = len(calls); article_b.reload(); completed(b); ui.wait_for_timeout(500)
            assert len(calls) == before
            passed('visible native panel reuses a saved same-URL summary after refresh')
            article_b.goto(origin_b+'/article-b-next')
            wait(lambda: panel_target(b) and panel_value(b, 'document.querySelector("#summary-status").textContent') == '自动总结已关闭')
            assert len(calls) == before
            panel_value(b, 'document.querySelector("#summary-retry").click()')
            completed(b)
            assert len(calls) == before+1 and 'PAGE_MARKER_article-b-next' in calls[-1]['messages'][-1]['content']
            passed('navigation shows a manual summary action while automatic summaries are off')

            close_panel(article_b, b)
            before = len(calls); article_b.goto(origin_b+'/article-b-closed'); ui.wait_for_timeout(650)
            assert len(calls) == before and article_b.evaluate('innerWidth') == full_width
            # A browser-native opening has no SUMMARY_OPEN/START message. It
            # must begin through the panel's normal bind/visibility lifecycle.
            ui.evaluate('tabId=>chrome.sidePanel.open({tabId})', b)
            article_b.bring_to_front(); wait(lambda: article_b.evaluate('innerWidth') < full_width-100)
            wait(lambda: panel_target(b) and panel_value(b, 'document.querySelector("#summary-status").textContent') == '自动总结已关闭')
            assert len(calls) == before
            panel_value(b, 'document.querySelector("#summary-retry").click()');completed(b)
            assert len(calls) == before+1
            passed('direct native opening binds the right tab and waits for explicit summary when automation is off')
            close_panel(article_b, b); before = len(calls); open_panel(article_b, b); ui.wait_for_timeout(450)
            assert len(calls) == before
            passed('closing prevents new automatic work; reopening a new page generates and the same page reuses')

            before = len(calls); message('BLACKLIST_SET', site=origin_a, blocked=True)
            assert article_b.evaluate('innerWidth') < full_width-100, 'Blacklisting inactive A closed active B'
            article_a.bring_to_front(); article_a.reload(); ui.wait_for_timeout(650)
            disabled = worker.evaluate('tabId=>chrome.sidePanel.getOptions({tabId})', a)
            assert disabled['enabled'] is False and article_a.evaluate('innerWidth') == full_width
            assert len(calls) == before
            article_b.bring_to_front(); ui.wait_for_timeout(350)
            assert article_b.evaluate('innerWidth') < full_width-100 and len(calls) == before, {'b_width': article_b.evaluate('innerWidth'), 'full_width': full_width, 'before': before, 'calls': len(calls), 'b_options': worker.evaluate('tabId=>chrome.sidePanel.getOptions({tabId})', b), 'b_visible': panel_value(b, 'document.visibilityState') if panel_target(b) else None}
            passed('blacklist closes the affected native panel and prevents requests, leaving other tabs unchanged')
            message('BLACKLIST_SET', site=origin_a, blocked=False)
            article_a.bring_to_front(); ui.wait_for_timeout(500)
            assert len(calls) == before and article_a.evaluate('innerWidth') == full_width
            open_panel(article_a, a); assert len(calls) == before+1
            passed('removing blacklist restores availability and waits for an explicit open')
            assert not errors, errors
            report.update(result='pass', browser=worker.evaluate('()=>navigator.userAgent'), model_requests=len(calls), page_errors=errors, rendered_screenshot=f'summary-panel-{VERSION}.png')
        finally: context.close()
except Exception as error:
    report.update(result='fail', error=str(error), page_errors=errors)
    raise
finally:
    server.shutdown(); server.server_close()
    (OUT/f'summary-panel-{VERSION}.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
