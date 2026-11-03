"""Package checks for the multi-connection/native-auth release.

No browser, credential cache, cloud database or real extension profile access.
Functional and UI evidence retain their actual isolated/live test boundaries.
"""
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlsplit, unquote
import hashlib, json, re, shutil, zipfile

ROOT=Path(__file__).resolve().parents[1]
VERSION=json.loads((ROOT/'package.json').read_text())['version']
RELEASES=ROOT/'releases';OUT=ROOT/'verification'
RELEASE=RELEASES/f'dianyi-{VERSION}';ARCHIVE=RELEASES/f'dianyi-chrome-edge-{VERSION}.zip'
sha=lambda data:hashlib.sha256(data).hexdigest()
units=json.loads((OUT/f'unit-{VERSION}.json').read_text())
native=json.loads((OUT/f'native-host-{VERSION}.json').read_text())
live=json.loads((OUT/f'codex-live-{VERSION}.json').read_text())
ui=json.loads((OUT/f'connections-{VERSION}.json').read_text())
for report in [units,native,live,ui]:assert report['version']==VERSION and report['result']=='pass'
assert units['passed']==114 and units['failed']==0 and native['passed']==6
assert live['framed_native_host_status']=='pass' and live['credentials_recorded'] is False
historical=[]
for line in (RELEASES/'SHA256SUMS.txt').read_text().splitlines():
    digest,name=line.split()
    if name==ARCHIVE.name:continue
    assert sha((RELEASES/name).read_bytes())==digest,name
    historical.append(name)
def production(path):
    return path.is_file() and path.suffix!='.pyc' and not any(part.startswith('.') or part=='__pycache__' for part in path.relative_to(ROOT/'src').parts)
expected={str(path.relative_to(ROOT/'src')):path.read_bytes() for path in (ROOT/'src').rglob('*') if production(path)}
for destination,source in [('INSTALL.md','user-guide.md'),('INSTALL.html','user-guide.html'),*[(name,name) for name in ['provider-defaults.md','provider-defaults.html','summary-guide.md','summary-guide.html','codex-setup.md']]]:expected[destination]=(ROOT/'docs'/source).read_bytes()
for size in [16,32,48,128]:expected[f'icons/icon{size}.png']=(RELEASE/f'icons/icon{size}.png').read_bytes()
with zipfile.ZipFile(ARCHIVE) as archive:
    assert archive.testzip() is None and len(archive.namelist())==len(expected)
    assert set(archive.namelist())==set(expected)
    for name,data in expected.items():
        assert archive.read(name)==data==(RELEASE/name).read_bytes(),name
        assert Path(name).suffix.lower() not in ['.doc','.docx','.key','.pyc'],name
        assert '__pycache__' not in name and 'bridge-settings.json' not in name and not name.startswith(('tests/','verification/')),name
        if Path(name).suffix in ['.js','.json','.html','.py']:
            text=data.decode()
            assert not re.search(r'sk-[A-Za-z0-9._-]{20,}',text),'Possible credential in '+name
            assert not any(token in text for token in ['qa-primary-not-a-real-key','qa-backup-not-a-real-key','fixture-key','__shiyiMenuReplay']),name
    manifest=json.loads(archive.read('manifest.json'))
    assert manifest['version']==VERSION and manifest['short_name']=='点译'
    assert manifest['optional_permissions']==['nativeMessaging']
    with zipfile.ZipFile(RELEASES/'dianyi-chrome-edge-0.11.0.zip') as baseline:
        old=json.loads(baseline.read('manifest.json'))
        for field in ['permissions','host_permissions','content_security_policy','side_panel','minimum_chrome_version']:assert manifest[field]==old[field],field
class Links(HTMLParser):
    def __init__(self):super().__init__();self.refs=[];self.ids=[]
    def handle_starttag(self,tag,attributes):
        attrs=dict(attributes)
        if attrs.get('id'):self.ids.append(attrs['id'])
        if tag=='img':assert 'alt' in attrs
        for key in ['href','src']:
            if attrs.get(key):self.refs.append(attrs[key])
for name in ['intro.html','privacy.html','terms.html','codex-setup.html','404.html']:
    parsed=Links();parsed.feed(expected[name].decode());assert len(set(parsed.ids))==len(parsed.ids),name
    for ref in parsed.refs:
        parts=urlsplit(ref)
        if parts.scheme or ref.startswith('//'):continue
        if not parts.path:assert not parts.fragment or parts.fragment in parsed.ids,(name,ref)
        else:assert (RELEASE/Path(name).parent/unquote(parts.path)).is_file(),(name,ref)
assert '沉浸式翻译' not in expected['intro.html'].decode()
assert '沉浸式翻译' not in (ROOT/'README.md').read_text()
assert 'dianyi-chrome-edge-'+VERSION+'.zip' in expected['ui/intro.js'].decode()
synced=[]
for destination in sorted(RELEASES.iterdir()):
    if not destination.is_dir() or destination==RELEASE or not re.fullmatch(r'(?:dianyi|shiyi)-\d+\.\d+\.\d+',destination.name):continue
    shutil.copytree(RELEASE,destination,dirs_exist_ok=True)
    for name,data in expected.items():assert (destination/name).read_bytes()==data,str(destination/name)
    synced.append(destination.name)
archives=sorted(RELEASES.glob('*chrome-edge-*.zip'))
(RELEASES/'SHA256SUMS.txt').write_text(''.join(sha(path.read_bytes())+'  '+path.name+'\n' for path in archives))
report={'version':VERSION,'result':'pass','zip':ARCHIVE.name,'bytes':ARCHIVE.stat().st_size,'sha256':sha(ARCHIVE.read_bytes()),'production_files':len(expected),'source_package_byte_match':True,'zip_integrity':'pass','unit_tests':114,'native_host_tests':6,'production_scripts':len(list((ROOT/'src').rglob('*.js'))),'live_codex_word_and_stream':'pass','live_framed_host_status':'pass','browser_ui_scope':ui['scope'],'default_permissions_and_csp_unchanged_since':'0.11.0','new_optional_permission':'nativeMessaging, requested only when connecting Codex','no_credential_or_auth_cache_packaged':True,'new_runtime_debug_flags':False,'word_files':False,'historical_zips_unchanged':historical,'unpacked_install_directories_synced':synced,'limitations':['No new full legacy extension-page E2E run','Real native browser bridge registration requires first-time local installation','Native Edge and Windows bridge not verified; helper supports macOS/Linux']}
(OUT/f'connections-release-{VERSION}.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({name:report[name] for name in ['result','zip','bytes','sha256','production_files']},ensure_ascii=False))
print(f'Historical ZIPs unchanged: {len(historical)}; unpacked install paths synchronized: {len(synced)}')
