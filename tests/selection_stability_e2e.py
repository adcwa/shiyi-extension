"""Actual selection and annotation churn probe, against an unmodified MV3 build.

The local HTTP fixture returns deterministic meanings; no external API or key.
Measure removed/added mark nodes and rendered frame gaps, including after
another word is learned on the same page, rather than only seeding a glossary.
"""
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from playwright.sync_api import sync_playwright, expect
import json, tempfile

ROOT = Path(__file__).resolve().parents[1]
VERSION = json.loads((ROOT / 'package.json').read_text())['version']
OUT = ROOT / 'verification'
OUT.mkdir(exist_ok=True)
CASES = {
    'plain': '<p id="source">Curiosity opens doors. Curiosity makes reading better. Serendipity helps Curiosity.</p>',
    'split': '<p id="source">Curiosity <em>Curiosity</em> <a href="#stay">Curiosity</a> Serendipity.</p>',
    'adjacent': '<nav id="source"><a href="#one">Curiosity</a> <a href="#two">Curiosity</a> <a href="#three">Curiosity</a> <span>Serendipity</span></nav>',
    'whitespace': '<p id="source">Curiosity\nCuriosity&nbsp;&nbsp;Curiosity\tSerendipity</p>',
    'breaks': '<p id="source">Curiosity <br>Curiosity <br><span>Curiosity</span> Serendipity</p>',
    'nested': '<main id="source"><p>Curiosity <em>Curiosity</em> Serendipity.</p><p>Curiosity brings possibilities.</p></main>',
}
HTML = '''<!doctype html><html lang="en"><meta charset="utf-8"><title>Selection stability fixture</title><style>
body{margin:32px;color:#263735;background:white;font:18px/1.9 system-ui}main{max-width:850px}a{margin-right:16px;color:inherit}
</style><main>CONTENT</main><script>
window.beginProbe=()=>{
 const initial=[...document.querySelectorAll('#source [data-shiyi-mark]')];
 const meanings=[...document.querySelectorAll('#source [data-shiyi-meaning]')];
 window.churn={markAdded:0,markRemoved:0,meaningAdded:0,meaningRemoved:0,frames:0,gapFrames:0};
 window.probe=new MutationObserver(records=>{const count=(nodes,selector)=>[...nodes].reduce((sum,node)=>sum+(node.nodeType===1?Number(node.matches(selector))+node.querySelectorAll(selector).length:0),0);for(const r of records){churn.markAdded+=count(r.addedNodes,'[data-shiyi-mark]');churn.markRemoved+=count(r.removedNodes,'[data-shiyi-mark]');churn.meaningAdded+=count(r.addedNodes,'[data-shiyi-meaning]');churn.meaningRemoved+=count(r.removedNodes,'[data-shiyi-meaning]')}});
 probe.observe(document.getElementById('source'),{childList:true,subtree:true});
 let active=true;function frame(){if(!active)return;churn.frames++;if(document.querySelectorAll('#source [data-shiyi-mark]').length<initial.length)churn.gapFrames++;requestAnimationFrame(frame)}requestAnimationFrame(frame);
 window.endProbe=()=>{active=false;probe.disconnect();return {...churn,initial:initial.length,retained:initial.filter(n=>n.isConnected).length,initialMeanings:meanings.length,retainedMeanings:meanings.filter(n=>n.isConnected).length,marks:document.querySelectorAll('#source [data-shiyi-mark]').length,nested:document.querySelectorAll('[data-shiyi-mark] [data-shiyi-mark]').length}};
};
</script></html>'''
calls = []


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        name = self.path.strip('/').split('?')[0]
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.end_headers()
        self.wfile.write(HTML.replace('CONTENT', CASES.get(name, CASES['plain'])).encode())

    def do_POST(self):
        data = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))))
        request = json.loads(data['messages'][-1]['content'])
        calls.append(request)
        result = {'translation': {'curiosity': '好奇心', 'serendipity': '机缘巧合'}.get(request['text'].lower(), '测试译文'), 'sourceLanguage': 'en', 'kind': 'word'}
        body = json.dumps({'choices': [{'message': {'content': json.dumps(result, ensure_ascii=False)}}]}).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(body)


server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
Thread(target=server.serve_forever, daemon=True).start()
origin = 'http://127.0.0.1:' + str(server.server_port)
report = {'version': VERSION, 'scope': 'Unmodified MV3 extension; real selection, local HTTP translation and annotation DOM/frame observation. No provider keys.', 'checks': [], 'measurements': [], 'failures': [], 'result': 'running'}


def select_text(page, text):
    coords = page.evaluate('''text=>{const nodes=[],w=document.createTreeWalker(document.getElementById('source'),NodeFilter.SHOW_TEXT);let n,raw='';while(n=w.nextNode()){if(n.parentElement.closest('[data-shiyi-meaning]'))continue;nodes.push({node:n,start:raw.length,end:raw.length+n.length});raw+=n.data}const start=raw.indexOf(text),end=start+text.length;if(start<0)throw Error('missing source');const a=nodes.find(n=>n.end>start),b=nodes.find(n=>n.end>=end),range=document.createRange();range.setStart(a.node,start-a.start);range.setEnd(b.node,end-b.start);return [...range.getClientRects()].filter(r=>r.width>0).map(r=>({x:r.x,y:r.y,width:r.width,height:r.height}))}''', text)
    first, last = coords[0], coords[-1]
    page.mouse.move(first['x'] + .2, first['y'] + first['height'] / 2)
    page.mouse.down()
    page.mouse.move(last['x'] + last['width'] - .2, last['y'] + last['height'] / 2, steps=12)
    page.mouse.up()
    expect(page.locator('#shiyi-extension-root').get_by_role('button', name='翻译为中文', exact=True)).to_be_visible()


try:
    with tempfile.TemporaryDirectory(prefix='dianyi-selection-stability-') as folder, sync_playwright() as p:
        browser = next((Path.home() / 'Library/Caches/ms-playwright').glob('chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'))
        extension = ROOT / 'releases' / ('shiyi-' + VERSION)
        ctx = p.chromium.launch_persistent_context(folder, executable_path=str(browser), headless=True, ignore_default_args=['--disable-extensions'], args=['--disable-extensions-except=' + str(extension), '--load-extension=' + str(extension)], viewport={'width': 1100, 'height': 900})
        try:
            worker = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker')
            ext = worker.url.split('/')[2]
            ui = ctx.new_page()
            ui.goto('chrome-extension://' + ext + '/options.html#translation')
            expect(ui.get_by_label('每批翻译块数', exact=True)).to_be_visible()

            def message(kind, **extra):
                reply = ui.evaluate('data=>chrome.runtime.sendMessage(data)', {'type': 'SHIYI/' + kind, **extra})
                assert reply['ok'], reply
                return reply['data']

            message('SAVE_PROFILE', profile={'provider': 'custom', 'name': 'Local stability test', 'endpoint': origin + '/v1/chat/completions', 'model': 'stability-fixture', 'auth': 'none', 'timeoutSeconds': 5, 'rememberKey': False})
            page = ctx.new_page()
            for mode in ['hover', 'inline']:
                prefs = message('UI_STATE')['prefs']
                message('SAVE_PREFS', prefs={**prefs, 'displayMode': mode})
                for name in CASES:
                    # A fresh document starts empty only for the first case.
                    page.goto(origin + '/' + name)
                    if mode == 'hover' and name == 'plain':
                        page.evaluate('window.originalHTML=document.getElementById("source").innerHTML;window.originalTextNode=document.getElementById("source").firstChild')
                    expect(page.locator('#shiyi-extension-root')).to_be_attached()
                    if not calls:
                        select_text(page, 'Curiosity')
                        page.locator('#shiyi-extension-root').get_by_role('button', name='翻译为中文', exact=True).click()
                        expect(page.locator('#source [data-shiyi-mark]')).to_have_count(3)
                    else:
                        expect(page.locator('#source [data-shiyi-mark]')).to_have_count(4)
                    page.keyboard.press('Escape')
                    page.evaluate('getSelection().removeAllRanges()')
                    page.mouse.move(4, 4)
                    page.wait_for_timeout(300)
                    page.evaluate('beginProbe()')
                    page.wait_for_timeout(1000)
                    data = page.evaluate('endProbe()')
                    label = mode + '/' + name + '/stationary'
                    report['measurements'].append({'case': label, **data})
                    print(json.dumps({'case': label, **data}), flush=True)
                    if data['markRemoved'] or data['meaningRemoved'] or data['nested'] or data['gapFrames']:
                        report['failures'].append(label)
                    else:
                        report['checks'].append(label)
                    if name == 'plain' and mode == 'hover':
                        page.evaluate('beginProbe()')
                        select_text(page, 'Serendipity')
                        page.locator('#shiyi-extension-root').get_by_role('button', name='翻译为中文', exact=True).click()
                        expect(page.locator('#source [data-shiyi-mark]')).to_have_count(4)
                        page.wait_for_timeout(500)
                        data = page.evaluate('endProbe()')
                        report['measurements'].append({'case': 'learn another term in the same paragraph', **data})
                        print(json.dumps({'case': 'learn another term in the same paragraph', **data}), flush=True)
                        if data['markRemoved'] or data['gapFrames']:
                            report['failures'].append('learning another term rebuilds unchanged occurrences')
                        else:
                            report['checks'].append('Learning another term retains all existing occurrences without empty frames')
                    if name == 'plain':
                        page.keyboard.press('Escape')
                        page.evaluate('getSelection().removeAllRanges()')
                        page.evaluate('''()=>{const span=document.createElement('span');span.id='stream';document.getElementById('source').append(span)}''')
                        page.wait_for_timeout(150)
                        page.evaluate('beginProbe()')
                        for i in range(6):
                            page.evaluate('n=>document.getElementById("stream").textContent=n%2?" Curiosity new tail.":" pending tail."', i)
                            page.wait_for_timeout(120)
                        data = page.evaluate('endProbe()')
                        label = mode + '/repeated word added and removed elsewhere in the same paragraph'
                        report['measurements'].append({'case': label, **data})
                        print(json.dumps({'case': label, **data}), flush=True)
                        if data['retained'] != data['initial'] or data['gapFrames']:
                            report['failures'].append(label)
                        else:
                            report['checks'].append(label)
                        page.evaluate('document.getElementById("stream").remove()')
                        page.wait_for_timeout(200)
                        library = message('LIBRARY')['entries']
                        other = next(entry for entry in library if entry['text'] == 'Serendipity')
                        page.evaluate('beginProbe()')
                        for index in range(5):
                            message('EDIT_ENTRY', id=other['id'], translation='机缘巧合 ' + str(index))
                            page.wait_for_timeout(100)
                        data = page.evaluate('endProbe()')
                        label = mode + '/five glossary broadcasts retain existing marks and meanings'
                        report['measurements'].append({'case': label, **data})
                        print(json.dumps({'case': label, **data}), flush=True)
                        if data['markAdded'] or data['markRemoved'] or data['meaningAdded'] or data['meaningRemoved'] or data['gapFrames']:
                            report['failures'].append(label)
                        else:
                            report['checks'].append(label)
                        page.evaluate('beginProbe()')
                        for color in ['#1b5e20', '#245e4d', '#1b5e20', '#245e4d']:
                            message('SAVE_PREFS', prefs={**message('UI_STATE')['prefs'], 'translationColorLight': color})
                            page.wait_for_timeout(100)
                        data = page.evaluate('endProbe()')
                        label = mode + '/appearance updates retain annotation nodes'
                        report['measurements'].append({'case': label, **data})
                        print(json.dumps({'case': label, **data}), flush=True)
                        if data['markAdded'] or data['markRemoved'] or data['meaningAdded'] or data['meaningRemoved'] or data['gapFrames']:
                            report['failures'].append(label)
                        else:
                            report['checks'].append(label)
                        # Deleting the other entry must not unwrap repeated words.
                        page.evaluate('window.savedRepeated=[...document.querySelectorAll("#source [data-shiyi-mark]")].filter(n=>n.textContent==="Curiosity")')
                        deletion = message('DELETE', ids=[other['id']])
                        expect(page.locator('#source [data-shiyi-mark]')).to_have_count(3)
                        assert page.evaluate('savedRepeated.every(n=>n.isConnected)')
                        message('UNDO', token=deletion['token'])
                        expect(page.locator('#source [data-shiyi-mark]')).to_have_count(4)
                        assert page.evaluate('savedRepeated.every(n=>n.isConnected)')
                        report['checks'].append(mode + '/delete and undo retain other occurrences')
                    page.evaluate('beginProbe()')
                    for index in [0, 1, 2, 0, 2, 1]:
                        # A card can cover the next line in the <br> fixture.
                        # Close it as a user would before targeting that word.
                        page.keyboard.press('Escape')
                        page.mouse.move(4, 4)
                        page.locator('#source [data-shiyi-mark]').nth(index).hover()
                        page.wait_for_timeout(80)
                    data = page.evaluate('endProbe()')
                    label = mode + '/' + name + '/hover repeated occurrences'
                    report['measurements'].append({'case': label, **data})
                    print(json.dumps({'case': label, **data}), flush=True)
                    if data['markRemoved'] or data['meaningRemoved'] or data['nested'] or data['gapFrames']:
                        report['failures'].append(label)
                    else:
                        report['checks'].append(label)
                    if mode == 'hover' and name == 'plain':
                        message('BLACKLIST_SET', site=origin, blocked=True)
                        expect(page.locator('[data-shiyi-mark],[data-shiyi-meaning]')).to_have_count(0)
                        assert page.evaluate('document.getElementById("source").innerHTML===originalHTML&&document.getElementById("source").firstChild===originalTextNode')
                        message('BLACKLIST_SET', site=origin, blocked=False)
                        expect(page.locator('#source [data-shiyi-mark]')).to_have_count(4)
                        report['checks'].append('Incremental remove/add/edit/undo restores exact source HTML and original Text node')
            report['http_requests'] = len(calls)
            report['result'] = 'fail' if report['failures'] else 'pass'
        finally:
            ctx.close()
except Exception as error:
    report['result'] = 'fail'
    report['error'] = str(error)
    raise
finally:
    server.shutdown()
    server.server_close()
    (OUT / ('selection-stability-' + VERSION + '.json')).write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'result': report['result'], 'failures': report['failures']}, ensure_ascii=False), flush=True)
assert report['result'] == 'pass', report['failures']
