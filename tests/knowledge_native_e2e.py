"""Native cached side panels with background knowledge from the exact ZIP, with real local HTTP/SSE.

Uses a temporary browser profile and synthetic public article text. No provider
credentials, production hooks, or user browser data are used.
"""
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from playwright.sync_api import sync_playwright, expect
import base64, json, tempfile, time, zipfile

ROOT = Path(__file__).resolve().parents[1]
VERSION = json.loads((ROOT/'package.json').read_text())['version']
OUT = ROOT/'verification'
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
        binary = Path.home()/'Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
        context = p.chromium.launch_persistent_context(str(Path(temp)/'profile'), executable_path=str(binary), headless=False, ignore_default_args=['--disable-extensions'], args=['--window-size=1380,950', '--disable-extensions-except='+str(extension), '--load-extension='+str(extension)], no_viewport=True)
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
            message('AUTO_SUMMARY_SET',enabled=True)
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
                state={'requests':len(calls),'records':message('KNOWLEDGE_LIST')['items'],'tabs':worker.evaluate('()=>chrome.tabs.query({})'),'panels':[{'url':item['url']} for item in targets() if '/summary.html?' in item['url']]}
                raise AssertionError('Native side panel did not reach the expected state: '+json.dumps(state,ensure_ascii=False))
            def completed(tab_id):
                wait(lambda: panel_target(tab_id) and panel_value(tab_id, 'document.querySelector("#summary-status").textContent') == '总结完成')
            def open_panel(article, tab_id):
                popup = context.new_page(); popup.goto(f'chrome-extension://{ext}/popup.html?tab={tab_id}')
                popup.locator('#summary-preset').select_option('general')
                popup.locator('#summarize-page').click()
                article.bring_to_front()
                wait(lambda: article.evaluate('innerWidth') < full_width-100)
                completed(tab_id)
                if not popup.is_closed(): popup.close()
            def close_panel(article, tab_id):
                worker.evaluate('id=>chrome.sidePanel.close({tabId:id})', tab_id)
                ui.wait_for_timeout(250)
                article.bring_to_front()

            defaults = worker.evaluate('()=>chrome.sidePanel.getOptions({})')
            assert defaults['enabled'] is False, defaults
            for tab_id in [a, b]:
                option = worker.evaluate('tabId=>chrome.sidePanel.getOptions({tabId})', tab_id)
                assert option['enabled'] is True and option['path'] == f'summary.html?tabId={tab_id}', option
            wait(lambda: len([r for r in message('KNOWLEDGE_LIST')['items'] if r['phase']=='complete'])>=2)
            assert len(calls) == 2
            passed('background summaries finish without opening panels; global panel fallback remains disabled')

            article_a.bring_to_front(); full_width = article_a.evaluate('innerWidth')
            open_panel(article_a, a)
            assert len(calls) == 2 and any('PAGE_MARKER_article-a' in call['messages'][-1]['content'] for call in calls)
            narrow_width = article_a.evaluate('innerWidth'); assert narrow_width < full_width-100, (full_width, narrow_width)
            assert '抓住重点，继续阅读' not in panel_value(a, 'document.body.innerText')
            assert 'article-a 的重点' in panel_value(a, 'document.querySelector("#summary-doc").innerText')
            passed('production popup opens the native tab panel and loads its already-saved summary with no extra request', {'full_width': full_width, 'article_width_with_panel': narrow_width})
            screenshot = rpc(panel_target(a)['targetId'], 'Page.captureScreenshot', {'format': 'png'})
            (OUT/f'knowledge-native-{VERSION}.png').write_bytes(base64.b64decode(screenshot['data']))
            assert panel_value(a, 'document.querySelectorAll("form,input,select,textarea,[data-open]").length') == 0
            assert panel_value(a, 'document.documentElement.scrollWidth<=innerWidth') is True
            passed('actual side panel renders summary and code, without settings or translation controls')

            article_b.bring_to_front(); ui.wait_for_timeout(500)
            assert article_b.evaluate('innerWidth') == full_width
            assert not panel_target(b) and len(calls) == 2
            article_a.bring_to_front(); ui.wait_for_timeout(400)
            assert article_a.evaluate('innerWidth') == narrow_width and len(calls) == 2
            passed('switching to an unopened tab hides the panel; returning restores only that tab without a request')

            open_panel(article_b, b)
            assert len(calls) == 2 and any('PAGE_MARKER_article-b' in call['messages'][-1]['content'] for call in calls)
            assert 'article-a 的重点' in panel_value(a, 'document.querySelector("#summary-doc").innerText')
            passed('second tab opens independently and cannot overwrite the first tab result')
            before = len(calls);visits=message('KNOWLEDGE_LIST')['total'];article_b.reload();wait(lambda:message('KNOWLEDGE_LIST')['total']>visits);completed(b);ui.wait_for_timeout(500)
            assert len(calls) == before
            passed('visible native panel restores identical page content after refresh without a repeated model call')
            before = len(calls); article_b.goto(origin_b+'/article-b-next'); wait(lambda: len(calls) == before+1); completed(b)
            assert 'PAGE_MARKER_article-b-next' in calls[-1]['messages'][-1]['content']
            passed('visible native panel summarizes loaded new source after navigation')

            close_panel(article_b, b)
            before = len(calls); article_b.goto(origin_b+'/article-b-closed'); wait(lambda: any('article-b-closed' in r['title'] and r['phase']=='complete' for r in message('KNOWLEDGE_LIST')['items']))
            assert len(calls) == before+1 and article_b.evaluate('innerWidth') == full_width
            # A browser-native opening has no SUMMARY_OPEN/START message. It
            # must begin through the panel's normal bind/visibility lifecycle.
            ui.evaluate('tabId=>chrome.sidePanel.open({tabId})', b)
            article_b.bring_to_front(); wait(lambda: article_b.evaluate('innerWidth') < full_width-100); completed(b)
            assert len(calls) == before+1
            passed('direct native opening loads the background result without SUMMARY_OPEN or SUMMARY_START')
            close_panel(article_b, b); before = len(calls); open_panel(article_b, b); ui.wait_for_timeout(450)
            assert len(calls) == before
            passed('closing hides the panel while background summary continues; native reopening reuses that saved result')

            before = len(calls); message('BLACKLIST_SET', site=origin_a, blocked=True)
            assert article_b.evaluate('innerWidth') < full_width-100, 'Blacklisting inactive A closed active B'
            article_a.bring_to_front(); article_a.reload(); ui.wait_for_timeout(650)
            disabled = worker.evaluate('tabId=>chrome.sidePanel.getOptions({tabId})', a)
            assert disabled['enabled'] is False and article_a.evaluate('innerWidth') == full_width
            assert all('PAGE_MARKER_article-a' not in call['messages'][-1]['content'] for call in calls[before:])
            article_b.bring_to_front(); ui.wait_for_timeout(350)
            assert article_b.evaluate('innerWidth') < full_width-100, {'b_width': article_b.evaluate('innerWidth'), 'full_width': full_width, 'before': before, 'calls': len(calls), 'b_options': worker.evaluate('tabId=>chrome.sidePanel.getOptions({tabId})', b), 'b_visible': panel_value(b, 'document.visibilityState') if panel_target(b) else None}
            assert all('PAGE_MARKER_article-a' not in call['messages'][-1]['content'] for call in calls[before:])
            before=len(calls)
            passed('blacklist closes its native panel and blocks that source; other panels stay open and context repairs exclude it')
            message('BLACKLIST_SET', site=origin_a, blocked=False)
            article_a.bring_to_front(); ui.wait_for_timeout(500)
            wait(lambda: len(calls)==before+1)
            wait(lambda: any('article-a' in r['title'] and r['phase']=='complete' for r in message('KNOWLEDGE_LIST')['items']))
            assert article_a.evaluate('innerWidth') == full_width
            open_panel(article_a, a); assert len(calls) == before+1
            passed('removing blacklist resumes background summary without automatically opening the native panel')
            message('AUTO_SUMMARY_SET',enabled=False)
            before=len(calls);article_a.goto(origin_a+'/off-popup');ui.wait_for_timeout(650)
            assert len(calls)==before
            open_panel(article_a,a);assert len(calls)==before+1
            assert message('UI_STATE')['knowledgePrefs']['autoSummary'] is False
            passed('with automation off, the real popup still opens a native panel and manually summarizes without enabling automation')
            before=len(calls);article_a.goto(origin_a+'/off-visible');wait(lambda:panel_value(a,'document.querySelector("#summary-status").textContent')=='自动总结已关闭')
            ui.wait_for_timeout(600);assert len(calls)==before
            panel_value(a,'document.querySelector("#summary-retry").click();true');completed(a)
            assert len(calls)==before+1
            passed('visible native sidebar navigation stays idle while off; its manual summary button remains functional')
            assert not errors, errors
            report.update(result='pass', browser=worker.evaluate('()=>navigator.userAgent'), model_requests=len(calls), page_errors=errors, rendered_screenshot=f'knowledge-native-{VERSION}.png')
        finally: context.close()
except Exception as error:
    report.update(result='fail', error=str(error), page_errors=errors)
    raise
finally:
    server.shutdown(); server.server_close()
    (OUT/f'knowledge-native-{VERSION}.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
