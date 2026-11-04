"""Verify the durable reading-knowledge release and refresh local install aliases.

Only project build outputs are read or written. No user browser profile, model
credential, authentication cache, or cloud database is accessed. Old ZIPs are
immutable; existing unpacked installation directories receive the new files.
"""
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlsplit, unquote
import hashlib, json, re, shutil, subprocess, zipfile

ROOT = Path(__file__).resolve().parents[1]
VERSION = json.loads((ROOT/'package.json').read_text())['version']
RELEASES, OUT = ROOT/'releases', ROOT/'verification'
RELEASE, ARCHIVE = RELEASES/f'dianyi-{VERSION}', RELEASES/f'dianyi-chrome-edge-{VERSION}.zip'
sha = lambda data: hashlib.sha256(data).hexdigest()
names = ['unit', 'knowledge', 'knowledge-native', 'knowledge-browser-code', 'shared-models', 'automatic-summary','installation-identity']
reports = {name: json.loads((OUT/f'{name}-{VERSION}.json').read_text()) for name in names}
for name, report in reports.items():
    assert report['version'] == VERSION and report['result'] == 'pass', name
assert reports['unit']['passed'] >= 175 and reports['unit']['failed'] == 0
assert len(reports['knowledge']['checks']) == 15 and len(reports['knowledge-native']['checks']) == 13
assert len(reports['shared-models']['checks']) == 14
assert len(reports['automatic-summary']['checks']) == 7
assert len(reports['installation-identity']['checks']) == 4
checked = subprocess.run(['rtk', 'proxy', 'npm', 'run', 'check'], cwd=ROOT, text=True, capture_output=True)
assert checked.returncode == 0, checked.stdout+checked.stderr

historical = []
for line in (RELEASES/'SHA256SUMS.txt').read_text().splitlines():
    checksum, name = line.split()
    if name == ARCHIVE.name:
        continue
    assert sha((RELEASES/name).read_bytes()) == checksum, name
    with zipfile.ZipFile(RELEASES/name) as historical_archive:
        previous_identity=json.loads(historical_archive.read('manifest.json')).get('key')
        if previous_identity:assert previous_identity==json.loads((ROOT/'src/manifest.json').read_text())['key'], 'Never rotate the fixed extension identity'
    historical.append(name)

def production(path):
    return path.is_file() and path.suffix != '.pyc' and not any(part.startswith('.') or part == '__pycache__' for part in path.relative_to(ROOT/'src').parts)

expected = {path.relative_to(ROOT/'src').as_posix(): path.read_bytes() for path in (ROOT/'src').rglob('*') if production(path)}
tested = reports['knowledge-browser-code']['production_source_hashes']
assert set(tested) == set(expected)
for name, data in expected.items():
    assert sha(data) == tested[name], 'Production source changed after browser verification: '+name
docs = ['provider-defaults', 'summary-guide', 'knowledge-guide', 'model-library-guide', 'verification', 'qwen-access-diagnosis', 'inline-structure', 'annotation-stability', 'compact-layout', 'block-reading', 'architecture']
copies = [('INSTALL.md', 'user-guide.md'), ('INSTALL.html', 'user-guide.html'), ('codex-setup.md', 'codex-setup.md')]
copies += [(name+suffix, name+suffix) for name in docs for suffix in ['.md', '.html']]
for destination, source in copies:
    expected[destination] = (ROOT/'docs'/source).read_bytes()
for size in [16, 32, 48, 128]:
    expected[f'icons/icon{size}.png'] = (RELEASE/f'icons/icon{size}.png').read_bytes()
with zipfile.ZipFile(ARCHIVE) as archive:
    assert archive.testzip() is None and set(archive.namelist()) == set(expected)
    for name, data in expected.items():
        assert archive.read(name) == data == (RELEASE/name).read_bytes(), name
        assert Path(name).suffix.lower() not in ['.doc', '.docx', '.key', '.pyc'], name
        assert '__pycache__' not in name and not name.startswith(('tests/', 'verification/')), name
        assert Path(name).name not in ['auth.json', '.env', 'bridge-settings.json'], name
        if Path(name).suffix in ['.js', '.json', '.html', '.md', '.py']:
            text = data.decode()
            assert not re.search(r'sk-[A-Za-z0-9._-]{20,}', text), 'Possible credential in '+name
            assert not any(token in text for token in ['qa-primary-not-a-real-key', 'qa-backup-not-a-real-key', 'fixture-key', '__shiyiMenuReplay']), name
    manifest = json.loads(archive.read('manifest.json'))
    assert manifest['version'] == VERSION and not manifest.get('side_panel')
    assert manifest.get('key') and manifest['key'] == json.loads((ROOT/'src/manifest.json').read_text())['key']
    assert archive.getinfo('升级点译.command').external_attr >> 16 & 0o111
    with zipfile.ZipFile(RELEASES/'dianyi-chrome-edge-0.12.1.zip') as baseline:
        previous = json.loads(baseline.read('manifest.json'))
        assert set(manifest['permissions']) == set(previous['permissions']) | {'alarms', 'unlimitedStorage'}
        for field in ['optional_permissions', 'host_permissions', 'content_security_policy', 'minimum_chrome_version']:
            assert manifest[field] == previous[field], field
        assert manifest['content_scripts'][0]['js'] == previous['content_scripts'][0]['js'] + ['content/knowledge.js']
        for field in ['matches', 'all_frames', 'run_at', 'css']:
            assert manifest['content_scripts'][0].get(field) == previous['content_scripts'][0].get(field), field

class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.refs, self.ids = [], []
    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        if attrs.get('id'):
            self.ids.append(attrs['id'])
        if tag == 'img':
            assert 'alt' in attrs
        for key in ['href', 'src']:
            if attrs.get(key):
                self.refs.append(attrs[key])

for name, data in expected.items():
    if not name.endswith('.html'):
        continue
    parsed = Links()
    parsed.feed(data.decode())
    assert len(parsed.ids) == len(set(parsed.ids)), name
    for ref in parsed.refs:
        parts = urlsplit(ref)
        if parts.scheme or ref.startswith('//'):
            continue
        if not parts.path:
            assert not parts.fragment or parts.fragment in parsed.ids, (name, ref)
        else:
            target = RELEASE/Path(name).parent/unquote(parts.path)
            assert target.is_file(), (name, ref)
assert f'dianyi-chrome-edge-{VERSION}.zip' in expected['ui/intro.js'].decode()
assert '沉浸式翻译' not in (ROOT/'README.md').read_text()

synced = []
for destination in sorted(RELEASES.iterdir()):
    if not destination.is_dir() or destination == RELEASE or not (destination.name=='dianyi' or re.fullmatch(r'(?:dianyi|shiyi)-\d+\.\d+\.\d+', destination.name)):
        continue
    previous=json.loads((destination/'manifest.json').read_text())
    shutil.copytree(RELEASE, destination, dirs_exist_ok=True)
    retained={**manifest}
    if previous.get('key'):retained['key']=previous['key']
    else:retained.pop('key',None)
    (destination/'manifest.json').write_text(json.dumps(retained,ensure_ascii=False,indent=2)+'\n')
    for name, data in expected.items():
        if name=='manifest.json':
            installed=json.loads((destination/name).read_text());assert {k:v for k,v in installed.items() if k!='key'}=={k:v for k,v in manifest.items() if k!='key'}
            assert installed.get('key')==previous.get('key')
        else:assert (destination/name).read_bytes() == data, str(destination/name)
    synced.append(destination.name)
archives = sorted(RELEASES.glob('*chrome-edge-*.zip'))
(RELEASES/'SHA256SUMS.txt').write_text(''.join(sha(path.read_bytes())+'  '+path.name+'\n' for path in archives))
report = {
    'version': VERSION, 'result': 'pass', 'zip': ARCHIVE.name,
    'bytes': ARCHIVE.stat().st_size, 'sha256': sha(ARCHIVE.read_bytes()),
    'production_files': len(expected), 'production_scripts': len(list((ROOT/'src').rglob('*.js'))),
    'unit_tests': reports['unit']['passed'], 'background_browser_checks': 15, 'native_panel_checks': 13, 'shared_models_upgrade_checks': 14,'automatic_summary_checks':7,
    'source_package_byte_match': True, 'browser_tested_production_bytes_unchanged': True,
    'new_default_permissions': ['alarms', 'unlimitedStorage'], 'csp_and_host_permissions_unchanged_since': '0.12.1',
    'no_history_permission': 'history' not in manifest['permissions'], 'global_side_panel_disabled': True,
    'no_credential_or_auth_cache_packaged': True, 'new_runtime_debug_flags': False, 'word_files': False,
    'all_packaged_html_local_links_valid': True, 'historical_zips_unchanged': historical,
    'unpacked_install_directories_synced': synced,
    'native_scope': reports['knowledge-native']['scope'],
    'automatic_summary_default':False,'manual_summary_independent':True,
    'fixed_identity_on_fresh_installs':True,'legacy_install_identity_preserved':True,'directory_change_checks':4,
    'limitations': ['No paid-provider semantic/account test', 'Native Edge and physical resize gestures not verified', 'Legacy translation browser suites and unchanged native Codex helper not rerun', 'Browser-off schedules backfill only when automatic summary is enabled'],
}
(OUT/f'knowledge-release-{VERSION}.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
print(json.dumps({key: report[key] for key in ['version', 'result', 'zip', 'bytes', 'sha256', 'production_files']}, ensure_ascii=False))
print(f'Historical ZIPs preserved: {len(historical)}; existing unpacked installs synced: {len(synced)}')
