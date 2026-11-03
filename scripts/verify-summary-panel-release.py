"""Verify the tab-scoped summary release and update existing unpacked installs.

No user browser profile, model credential, authentication cache or cloud data is
read. Historical ZIPs remain immutable; only local unpacked install aliases sync.
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
reports = {name: json.loads((OUT/f'{name}-{VERSION}.json').read_text()) for name in ['unit', 'summary', 'summary-panel', 'summary-panel-browser-code']}
for value in reports.values(): assert value['version'] == VERSION and value['result'] == 'pass'
assert reports['unit']['passed'] == 126 and reports['unit']['failed'] == 0
assert len(reports['summary']['checks']) == 19 and len(reports['summary-panel']['checks']) == 11
checked = subprocess.run(['rtk', 'proxy', 'npm', 'run', 'check'], cwd=ROOT, text=True, capture_output=True)
assert checked.returncode == 0, checked.stdout+checked.stderr
historical = []
for line in (RELEASES/'SHA256SUMS.txt').read_text().splitlines():
    checksum, name = line.split()
    if name == ARCHIVE.name: continue
    assert sha((RELEASES/name).read_bytes()) == checksum, name
    historical.append(name)

def production(path):
    return path.is_file() and path.suffix != '.pyc' and not any(part.startswith('.') or part == '__pycache__' for part in path.relative_to(ROOT/'src').parts)
expected = {path.relative_to(ROOT/'src').as_posix(): path.read_bytes() for path in (ROOT/'src').rglob('*') if production(path)}
tested = reports['summary-panel-browser-code']['production_source_hashes']
assert set(tested) == set(expected)
for name, data in expected.items(): assert sha(data) == tested[name], 'Production source changed after browser verification: '+name
for destination, source in [('INSTALL.md', 'user-guide.md'), ('INSTALL.html', 'user-guide.html'), *[(name, name) for name in ['provider-defaults.md', 'provider-defaults.html', 'summary-guide.md', 'summary-guide.html', 'codex-setup.md']]]:
    expected[destination] = (ROOT/'docs'/source).read_bytes()
for size in [16, 32, 48, 128]: expected[f'icons/icon{size}.png'] = (RELEASE/f'icons/icon{size}.png').read_bytes()
with zipfile.ZipFile(ARCHIVE) as archive:
    assert archive.testzip() is None and set(archive.namelist()) == set(expected)
    for name, data in expected.items():
        assert archive.read(name) == data == (RELEASE/name).read_bytes(), name
        assert Path(name).suffix.lower() not in ['.doc', '.docx', '.key', '.pyc'], name
        assert '__pycache__' not in name and not name.startswith(('tests/', 'verification/')), name
        assert Path(name).name not in ['auth.json', '.env', 'bridge-settings.json'], name
        if Path(name).suffix in ['.js', '.json', '.html', '.py']:
            text = data.decode()
            assert not re.search(r'sk-[A-Za-z0-9._-]{20,}', text), 'Possible credential in '+name
            assert not any(token in text for token in ['qa-primary-not-a-real-key', 'qa-backup-not-a-real-key', 'fixture-key', '__shiyiMenuReplay']), name
    manifest = json.loads(archive.read('manifest.json'))
    assert manifest['version'] == VERSION and not manifest.get('side_panel')
    with zipfile.ZipFile(RELEASES/'dianyi-chrome-edge-0.12.0.zip') as baseline:
        previous = json.loads(baseline.read('manifest.json'))
        for field in ['permissions', 'optional_permissions', 'host_permissions', 'content_security_policy', 'minimum_chrome_version']:
            assert manifest[field] == previous[field], field

class Links(HTMLParser):
    def __init__(self): super().__init__(); self.refs, self.ids = [], []
    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        if attrs.get('id'): self.ids.append(attrs['id'])
        if tag == 'img': assert 'alt' in attrs
        for key in ['href', 'src']:
            if attrs.get(key): self.refs.append(attrs[key])
for name in ['intro.html', 'privacy.html', 'terms.html', 'codex-setup.html', '404.html', 'summary.html']:
    parsed = Links(); parsed.feed(expected[name].decode()); assert len(parsed.ids) == len(set(parsed.ids)), name
    for ref in parsed.refs:
        parts = urlsplit(ref)
        if parts.scheme or ref.startswith('//'): continue
        if not parts.path: assert not parts.fragment or parts.fragment in parsed.ids, (name, ref)
        else: assert (RELEASE/Path(name).parent/unquote(parts.path)).is_file(), (name, ref)
assert f'dianyi-chrome-edge-{VERSION}.zip' in expected['ui/intro.js'].decode()
assert '沉浸式翻译' not in (ROOT/'README.md').read_text()

synced = []
for destination in sorted(RELEASES.iterdir()):
    if not destination.is_dir() or destination == RELEASE or not re.fullmatch(r'(?:dianyi|shiyi)-\d+\.\d+\.\d+', destination.name): continue
    shutil.copytree(RELEASE, destination, dirs_exist_ok=True)
    for name, data in expected.items(): assert (destination/name).read_bytes() == data, str(destination/name)
    synced.append(destination.name)
archives = sorted(RELEASES.glob('*chrome-edge-*.zip'))
(RELEASES/'SHA256SUMS.txt').write_text(''.join(sha(path.read_bytes())+'  '+path.name+'\n' for path in archives))
report = {'version': VERSION, 'result': 'pass', 'zip': ARCHIVE.name, 'bytes': ARCHIVE.stat().st_size, 'sha256': sha(ARCHIVE.read_bytes()), 'production_files': len(expected), 'production_scripts': len(list((ROOT/'src').rglob('*.js'))), 'unit_tests': 126, 'summary_browser_checks': 19, 'native_panel_checks': 11, 'source_package_byte_match': True, 'browser_tested_production_bytes_unchanged': True, 'default_permissions_and_csp_unchanged_since': '0.12.0', 'global_side_panel_removed': True, 'no_credential_or_auth_cache_packaged': True, 'new_runtime_debug_flags': False, 'word_files': False, 'historical_zips_unchanged': historical, 'unpacked_install_directories_synced': synced, 'native_scope': reports['summary-panel']['scope'], 'limitations': ['No real paid-provider call in this release', 'Native Edge and physical resize gestures not verified', 'No rerun of all legacy translation browser suites or unchanged native Codex helper']}
(OUT/f'summary-panel-release-{VERSION}.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
print(json.dumps({key: report[key] for key in ['version', 'result', 'zip', 'bytes', 'sha256', 'production_files']}, ensure_ascii=False))
print(f'Historical ZIPs preserved: {len(historical)}; existing unpacked installs synced: {len(synced)}')
