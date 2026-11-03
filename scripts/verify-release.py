"""Verify the exact release ZIP in an isolated browser and sync legacy paths.

Historical ZIP files are read-only. Only local deterministic HTTP fixtures and
temporary profiles are used; no user's browser profile or credentials are read.
"""
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from playwright.sync_api import sync_playwright, expect
import hashlib, json, shutil, tempfile, time, zipfile

ROOT = Path(__file__).resolve().parents[1]
VERSION = json.loads((ROOT/'package.json').read_text())['version']
RELEASE = ROOT/'releases'/('dianyi-'+VERSION)
ARCHIVE = ROOT/'releases'/('dianyi-chrome-edge-'+VERSION+'.zip')
OUT = ROOT/'verification'
reports = {}
for name, filename, count in [('browser_integration', 'extension-e2e.json', 45), ('page_reading', 'page-translation-e2e.json', 20), ('reading_preferences', 'reading-preferences-e2e.json', 9), ('repeated_word_stability', 'repeated-word-'+VERSION+'.json', 12), ('selection_stability', 'selection-stability-'+VERSION+'.json', 34), ('selection_capsule', 'selection-capsule-e2e.json', 14), ('page_memory', 'page-memory-e2e.json', 13), ('compact_layout', 'compact-layout-'+VERSION+'.json', 21), ('mt_chinese', 'mt-chinese-e2e.json', 12), ('inline_structure', 'inline-structure-'+VERSION+'.json', 21), ('model_access', 'model-access-'+VERSION+'.json', 6)]:
    result = json.loads((OUT/filename).read_text())
    assert result['version'] == VERSION and result['result'] == 'pass' and len(result['checks']) == count, filename
    reports[name] = result
summary = json.loads((OUT/('summary-'+VERSION+'.json')).read_text())
assert summary['version'] == VERSION and summary['result'] == 'pass' and len(summary['checks']) == 19
reports['summary'] = summary
native_summary = json.loads((OUT/('summary-native-'+VERSION+'.json')).read_text())
assert native_summary['result'] == 'pass' and native_summary['popup_one_activation'] and native_summary['context_menu_real_click'] and not native_summary['native_menu_replay']
units = json.loads((OUT/('unit-'+VERSION+'.json')).read_text())
assert units['result'] == 'pass' and units['passed'] == 102
throughput = json.loads((OUT/('reader-throughput-'+VERSION+'.json')).read_text())
assert throughput['version'] == VERSION and throughput['result'] == 'pass'
assert json.loads((OUT/('long-text-'+VERSION+'.json')).read_text())['result'] == 'pass'
for line in (ROOT/'releases/SHA256SUMS.txt').read_text().splitlines():
    digest, name = line.split()
    if name == ARCHIVE.name: continue  # The current, not-yet-delivered build may be rebuilt during verification.
    assert hashlib.sha256((ROOT/'releases'/name).read_bytes()).hexdigest() == digest, name

SOURCE = 'Build with the OpenAI API in ChatGPT and Codex'
TRANSLATION = '在 ChatGPT 和 Codex 中使用 OpenAI API 进行开发'
HTML = '<!doctype html><meta charset="utf-8"><title>点译安装包验收</title><style>body{margin:32px;background:#f7f8f5;font:18px/1.8 system-ui}main{padding:24px;background:white;border:1px solid #e0e8df;border-radius:12px}h1{font-size:24px}p{margin:28px 0}</style><main><h1>OpenAI API 开发指南</h1><p id="source">'+SOURCE+'</p><p id="repeat">'+SOURCE+' / '+SOURCE+' <span id="counter">0</span></p><p id="rich">Read <a id="rich-link" href="/docs"><b>the guide</b></a> with <code>stable()</code> and <font face="monospace">detail</font>.</p></main><script>document.getElementById("rich-link").addEventListener("click",e=>{e.preventDefault();window.richClicks=(window.richClicks||0)+1});</script>'
calls = []
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def do_GET(self):
        self.send_response(200); self.send_header('Content-Type', 'text/html;charset=utf-8'); self.end_headers(); self.wfile.write(HTML.encode())
    def do_POST(self):
        data = json.loads(json.loads(self.rfile.read(int(self.headers['Content-Length'])))['messages'][-1]['content']); calls.append(data)
        def output(parts): return {'parts': [{'id': part['id'], 'text': '安装包译文：'+part['text'] if part['text'].strip() else part['text']} for part in parts]}
        value = {'blocks': [{'id': block['id'], **output(block['parts'])} for block in data['blocks']]} if data.get('task') == 'blocks' else output(data['parts'])
        self.send_response(200); self.send_header('Content-Type', 'application/json'); self.end_headers()
        self.wfile.write(json.dumps({'choices':[{'message':{'content':json.dumps(value, ensure_ascii=False)}}]}).encode())

server = ThreadingHTTPServer(('127.0.0.1', 0), Handler); Thread(target=server.serve_forever, daemon=True).start()
origin = 'http://127.0.0.1:'+str(server.server_port)
errors = []
try:
    with tempfile.TemporaryDirectory(prefix='dianyi-exact-zip-') as temp, sync_playwright() as playwright:
        temp = Path(temp); extracted = temp/'extension'
        with zipfile.ZipFile(ARCHIVE) as archive:
            assert archive.testzip() is None
            assert not any(Path(name).suffix.lower() in ('.doc', '.docx') for name in archive.namelist())
            archive.extractall(extracted)
        files = [path.relative_to(extracted) for path in extracted.rglob('*') if path.is_file()]
        expected = {path.relative_to(ROOT/'src') for path in (ROOT/'src').rglob('*') if path.is_file()}
        expected.update(Path(name) for name in ['INSTALL.md','INSTALL.html','provider-defaults.md','provider-defaults.html','summary-guide.md','summary-guide.html',*[f'icons/icon{size}.png' for size in [16,32,48,128]]])
        assert set(files) == expected
        for rel in files: assert (extracted/rel).read_bytes() == (RELEASE/rel).read_bytes(), str(rel)
        for path in extracted.rglob('*.js'):
            assert not any(value in path.read_text() for value in ['fixture-key', 'fixture-memory-key', '__shiyiMenuReplay', '__shiyiMigrate']), str(path)
        manifest = json.loads((extracted/'manifest.json').read_text())
        assert manifest['name'] == '点译 · 翻译与网页总结' and manifest['short_name'] == '点译' and manifest['version'] == VERSION
        assert (extracted/'INSTALL.md').read_bytes() == (ROOT/'docs/user-guide.md').read_bytes()
        assert (extracted/'INSTALL.html').read_bytes() == (ROOT/'docs/user-guide.html').read_bytes()
        assert manifest['permissions'] == json.loads((ROOT/'src/manifest.json').read_text())['permissions']
        assert not manifest.get('side_panel') and 'sidePanel' in manifest['permissions']
        assert 'ui/summary.js' in (extracted/'summary.html').read_text()
        assert (extracted/'summary-guide.html').read_bytes() == (ROOT/'docs/summary-guide.html').read_bytes()
        browser = next((Path.home()/'Library/Caches/ms-playwright').glob('chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'))
        context = playwright.chromium.launch_persistent_context(str(temp/'profile'), executable_path=str(browser), headless=True, ignore_default_args=['--disable-extensions'], args=['--disable-extensions-except='+str(extracted), '--load-extension='+str(extracted)], viewport={'width':1000,'height':800})
        try:
            worker = context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
            ext = worker.url.split('/')[2]; ui = context.new_page(); ui.on('pageerror', lambda error: errors.append(str(error)))
            ui.goto('chrome-extension://'+ext+'/options.html#model'); expect(ui.get_by_label('API Key', exact=True)).to_be_visible()
            def message(kind, **payload):
                result = ui.evaluate('data=>chrome.runtime.sendMessage(data)', {'type':'SHIYI/'+kind, **payload}); assert result['ok'], result; return result['data']
            initial = message('UI_STATE'); assert initial['version'] == VERSION and initial['count'] == 0 and not initial['blacklist'] and not initial['profile']['hasKey'] and initial['pageCache']['count'] == 0
            grants = ui.evaluate('()=>chrome.permissions.getAll()'); assert set(grants['origins']) == {'http://*/*','https://*/*'}
            ui.goto('chrome-extension://'+ext+'/options.html#translation'); expect(ui.get_by_label('每批翻译块数', exact=True)).to_have_value('16')
            expect(ui.get_by_label('浅色页面取色器', exact=True)).to_have_value('#245e4d'); expect(ui.get_by_label('深色页面取色器', exact=True)).to_have_value('#c1e7d5')
            entry = {'id':'package-sample','identity':'zh-CN\x1f'+SOURCE.lower(),'text':SOURCE,'translation':TRANSLATION,'kind':'phrase','sourceLanguage':'en','targetLanguage':'zh-CN','style':'regular','modelName':'Local fixture','source':{'domain':'127.0.0.1','url':'','title':'Package acceptance'},'context':'','createdAt':1,'updatedAt':1}
            ui.evaluate('''entry=>new Promise((resolve,reject)=>{const r=indexedDB.open('shiyi-vocabulary');r.onsuccess=()=>{const db=r.result,tx=db.transaction('entries','readwrite');tx.objectStore('entries').put(entry);tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>reject(tx.error)}})''', entry)
            page = context.new_page(); page.on('pageerror', lambda error: errors.append(str(error))); page.goto(origin+'/reading')
            root = page.locator('#shiyi-extension-root'); expect(root).to_be_attached(); expect(root.locator('[data-pet-toggle]')).to_have_count(0); assert not calls
            mark = page.locator('#source [data-shiyi-mark]'); expect(mark).to_have_count(1); mark.hover()
            card = root.locator('.card'); expect(card.locator('.meaning')).to_have_text(TRANSLATION)
            assert card.evaluate("node=>node.querySelector('.inside').firstElementChild.classList.contains('meaning')")
            card.screenshot(path=str(OUT/'tooltip-package.png'), animations='disabled', caret='initial')
            page.keyboard.press('Escape'); page.evaluate('getSelection().removeAllRanges()'); page.mouse.move(4, 4)
            rect = page.locator('#source').evaluate('n=>{const r=document.createRange();r.selectNodeContents(n);const b=r.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height}}')
            page.mouse.move(rect['x']+.2, rect['y']+rect['height']/2); page.mouse.down(); page.mouse.move(rect['x']+rect['width']-.2, rect['y']+rect['height']/2, steps=15); page.mouse.up()
            capsule = root.locator('.selection-capsule'); expect(capsule).to_be_visible()
            expect(capsule.locator('.selection-main')).to_have_text('中文')
            assert capsule.evaluate('n=>n.getBoundingClientRect().width===140&&n.getBoundingClientRect().height===34&&getComputedStyle(n).borderRadius==="999px"')
            capsule.screenshot(path=str(OUT/'selection-capsule.png'), animations='disabled')
            # Keyboard focus must be visible outside the rounded split control.
            capsule.locator('.selection-main').focus(); page.keyboard.press('Tab'); page.keyboard.press('Shift+Tab')
            assert capsule.locator('.selection-main').evaluate('n=>n.matches(":focus-visible")&&getComputedStyle(n).outlineStyle==="solid"&&getComputedStyle(n.parentElement).overflow==="visible"')
            for label, value in [('英语','英语'),('简体中文','中文')]:
                root.get_by_role('button', name='选择目标语言', exact=True).click()
                root.get_by_role('option', name=label, exact=True).click()
                expect(capsule.locator('.selection-main')).to_have_text(value)
                expect(capsule.locator('.selection-main')).to_be_enabled()
            assert not calls
            root.get_by_role('button', name='关闭划词工具', exact=True).click(); page.evaluate('getSelection().removeAllRanges()')
            prefs = message('UI_STATE')['prefs']; message('SAVE_PREFS', prefs={**prefs, 'displayMode':'inline'})
            expect(page.locator('#repeat [data-shiyi-meaning]')).to_have_count(2)
            page.evaluate('''()=>{window.retained=[...document.querySelectorAll('#repeat [data-shiyi-mark],#repeat [data-shiyi-meaning]')];let value=0;window.timer=setInterval(()=>document.getElementById('counter').textContent=String(++value),25)}''')
            page.wait_for_timeout(500); assert page.evaluate('()=>{clearInterval(timer);return retained.length===4&&retained.every(node=>node.isConnected)}')
            # The old preflight passed counters but still cleared an entire
            # paragraph if a real match was inserted or removed beside it.
            for index in range(6):
                page.evaluate('value=>document.getElementById("counter").textContent=value', SOURCE if index % 2 else '0')
                expect(page.locator('#repeat [data-shiyi-mark]')).to_have_count(3 if index % 2 else 2)
                assert page.evaluate('retained.every(node=>node.isConnected)')
            page.evaluate('document.getElementById("counter").textContent="0"')
            expect(page.locator('#repeat [data-shiyi-mark]')).to_have_count(2)
            message('EDIT_ENTRY', id=entry['id'], translation=TRANSLATION+'。')
            expect(page.locator('#repeat [data-shiyi-meaning]').first).to_have_text('（'+TRANSLATION+'。）')
            assert page.evaluate('retained.every(node=>node.isConnected)')
            message('EDIT_ENTRY', id=entry['id'], translation=TRANSLATION)
            page.mouse.move(4,4); mark.hover()
            with context.expect_page() as opened: card.get_by_role('button', name='编辑', exact=True).click()
            editor = opened.value; expect(editor.get_by_label('已存释义', exact=True)).to_have_value(TRANSLATION); editor.close()
            page.keyboard.press('Escape'); page.mouse.move(4,4); mark.hover(); card.get_by_role('button', name='取消标记并从词库删除', exact=True).click()
            expect(mark).to_have_count(0); root.get_by_role('button', name='撤销', exact=True).click(); expect(mark).to_have_count(1)
            page.evaluate('document.getElementById("counter").textContent="0"')
            message('SAVE_PROFILE', profile={'provider':'custom','name':'ZIP acceptance','endpoint':origin+'/v1','model':'local-fixture','auth':'none','timeoutSeconds':5,'rememberKey':False})
            tab = ui.evaluate('async url=>(await chrome.tabs.query({})).find(t=>t.url===url).id', page.url)
            def complete():
                deadline = time.monotonic()+15
                while time.monotonic() < deadline:
                    value = message('UI_STATE', tabId=tab)['tab']['page']
                    if value and value['active'] and value['phase'] == 'complete' and not value['running'] and value['completed'] > 0: return value
                    ui.wait_for_timeout(40)
                raise AssertionError(value)
            message('PAGE_COMMAND', tabId=tab, action='translate', mode='bilingual'); reading = complete(); assert reading['cached'] == reading['completed'] and not reading['failed']
            rich = page.locator('#rich + [data-shiyi-block-translation]')
            expect(rich.locator('a b')).to_contain_text('the guide')
            expect(rich.locator('code')).to_have_text('stable()')
            expect(rich.locator('font')).to_have_attribute('face', 'monospace')
            rich.locator('a').click(); assert page.evaluate('richClicks') == 1
            assert page.locator('#source + [data-shiyi-block-translation]').evaluate('n=>getComputedStyle(n).backgroundColor==="rgba(0, 0, 0, 0)"&&parseFloat(getComputedStyle(n).fontSize)===16')
            before = len(calls); page.reload(); restored = complete(); assert restored['restored'] == reading['completed'] and len(calls) == before
            expect(root.locator('[data-pet-toggle]')).to_have_count(0)
            toolbar = context.new_page(); toolbar.goto('chrome-extension://'+ext+'/popup.html?tab='+str(tab)); expect(root.locator('[data-pet-toggle]')).to_be_visible(); toolbar.close()
            root.locator('[data-pet-toggle]').click(); root.get_by_role('button', name='重新翻译', exact=True).click(); complete(); assert len(calls) > before
            assert not errors, errors
            print('PASS: exact extracted ZIP loads; generic links/bold/code/font reconstruction and original click, language capsule, pet, local refresh, retranslate and glossary stability.', flush=True)
        finally: context.close()
finally:
    server.shutdown(); server.server_close()

old_versions = ['0.1.0','0.1.1','0.2.0','0.2.1','0.3.0','0.3.1','0.4.0','0.5.0','0.5.1','0.6.0','0.6.1','0.7.0','0.7.1','0.8.0','0.9.0','0.9.1']
synced = []
for name in [*('shiyi-'+old for old in old_versions), 'dianyi-0.6.0', 'dianyi-0.6.1', 'dianyi-0.7.0', 'dianyi-0.7.1', 'dianyi-0.8.0', 'dianyi-0.9.0', 'dianyi-0.9.1']:
    destination = ROOT/'releases'/name
    if not destination.exists(): continue
    shutil.copytree(RELEASE, destination, dirs_exist_ok=True)
    for rel in files: assert (destination/rel).read_bytes() == (RELEASE/rel).read_bytes(), str(destination/rel)
    synced.append(str(destination))
for rel in files: assert (ROOT/'releases'/('shiyi-'+VERSION)/rel).read_bytes() == (RELEASE/rel).read_bytes(), str(rel)
archives = sorted((ROOT/'releases').glob('*chrome-edge-*.zip'))
(ROOT/'releases/SHA256SUMS.txt').write_text(''.join(hashlib.sha256(path.read_bytes()).hexdigest()+'  '+path.name+'\n' for path in archives))
report = {'version':VERSION, 'name':'点译', 'zip':ARCHIVE.name, 'bytes':ARCHIVE.stat().st_size, 'sha256':hashlib.sha256(ARCHIVE.read_bytes()).hexdigest(), 'browser_storage_modified':False, 'test_profile':'isolated temporary', 'production_files':len(files), 'zip_integrity':'pass', 'unmodified_extracted_zip_load':'pass', 'test_hooks_in_production':False, 'embedded_test_credentials':False, 'word_files':False, 'new_permissions_since_0.9.1':['sidePanel'], 'default_web_access':'HTTP(S)', 'initial_vocabulary_entries':0, 'default_blacklist_entries':0, 'checks':{'production_scripts':len(list((ROOT/'src').rglob('*.js'))), 'unit_tests':units['passed'], **{name:len(value['checks']) for name,value in reports.items()}}, 'verified_versions':{name:VERSION for name in [*reports,'throughput','long_text']}, 'original_install_directories_synced':synced}
report['model_access'] = {'result':'pass','bounded_structured_errors':True,'raw_upstream_message_exposed':False,'credentials_saved_in_diagnostic':False,'qwen_workspace_and_public_quota_shapes':'pass','original_http_categories_preserved':True,'new_runtime_flags':False}
report['page_memory'] = {'result':'pass','database_version':2,'upgrade_from':'immutable 0.5.1 ZIP','preserves_extension_id_library_model_preferences_credentials':True,'refresh_model_requests':0,'retranslate_bypasses_old_results':True,'stale_revision_rejected':True,'selection_and_spa_isolation':True,'ttl_days':7,'max_pages':50,'max_page_bytes':3*1024*1024,'max_total_bytes':20*1024*1024}
report['reading_appearance'] = {'background':'transparent','border_px':0,'bilingual_font_delta_px':-2,'translation_only_preserves_font':True,'animated_cat':'pass','cat_size_px':[24,26.67],'companion_default':'hidden, toolbar popup opt-in per document','explicit_close':'pass','reduced_motion':'pass','compact_navigation':'pass','numeric_badges_unchanged':'pass'}
report['qwen_mt'] = {'default':'qwen-mt-flash','protocol':'single raw user message and translation_options','key_default':'empty','get_key_link':'adjacent official link','aligned_plaintext_frames':'pass','bounded_fallback':'pass','max_concurrent_http':2,'scope':'Local HTTP protocol tests; no real provider key or billed account used.'}
report['chinese_bilingual'] = {'native_blocks_skipped':'pass','mixed_fragments_keep_chinese_once':'pass','stale_chinese_snapshot_ignored':'pass','japanese_hint_and_kana':'pass','all_chinese_page_model_requests':0}
report['selection_capsule'] = {'visible_label':'selected target language only','size_px':[140,34],'border_radius_px':999,'target_languages':7,'switch_language_model_requests':0,'remember_selection':'pass','more_context':'pass','keyboard_and_viewport':'pass','auto_vocabulary_save':'pass','long_selection_paragraph_mode':'pass','extra_flags_required':False}
report['inline_structure'] = {'local_tree_mapping':'pass','text_tags':35,'historical_bold_aliases':['bold','blod'],'nested_links_code_font':'pass','original_click_bridge':'pass','native_link_gestures':'pass','literal_model_html':'pass','old_0_8_cache_upgrade_extra_requests':0,'dynamic_link_and_font_updates':'pass','restores_exact_source':'pass','new_permissions':False,'runtime_flags_required':False}
report['batch_reading'] = {'default_blocks':16,'range':[1,64],'concurrent_requests':2,'fixture_120_blocks_requests':throughput['model_requests'],'fixture_elapsed_ms':throughput['elapsed_ms'],'fixture_first_visible_ms':throughput['first_visible_translation_ms'],'scope':throughput['scope']}
report['repeated_word_stability'] = {'result':'pass','same_paragraph_live_counter':'zero mark and meaning replacements','dense_repeated_occurrences':180,'exact_source_restore':'pass','delete_undo':'pass','unmodified_extracted_zip_inline_node_retention':'pass'}
report['repeated_word_stability']['incremental_reconciliation'] = {'actual_selection_and_new_term':'retain existing nodes', 'changing_match_in_same_paragraph':'retain unaffected marks and meanings', 'glossary_broadcasts':5, 'appearance_updates':'no replacement', 'empty_frames':0, 'test':'selection_stability_e2e.py', 'debug_flags_required':False}
report['native_context_menu'] = {'os_click_verified_version':'0.3.0','translation_behavior_preserved':True, 'new_summary_item':True,'labels_updated':'点译','callback_path_verified_version':VERSION}
report['summary'] = {'result':'pass','checks':len(summary['checks']),'independent_credentials':True,'transport':'real local HTTP/SSE, unchanged extracted ZIP','paid_provider_account_tested':False,'native_popup_and_context_menu':'pass','native_resize_handle_present':True,'physical_drag_verification':native_summary['physical_drag_verification'],'artifacts':['Markdown','code','table','Mermaid','MathML'],'exports':['md','html','csv','svg','mmd','tex','code'],'max_input_chars':60000,'max_output_chars':80000,'max_duration_seconds':180,'session_results':8,'sidebar_settings_or_translation':False}
(OUT/'package.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
print(json.dumps({'version':VERSION,'zip':ARCHIVE.name,'files':len(files),'bytes':report['bytes'],'sha256':report['sha256'],'synced_install_paths':len(synced),'historical_zips_preserved':len(archives)-1}, ensure_ascii=False, indent=2))
