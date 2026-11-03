"""Verify a presentation-only release and preserve immutable historical ZIPs.

Uses saved real Chrome presentation observations, source checks and byte-level
package checks. Does not open extension URLs, browser profiles, storage or keys.
This is not a replacement for the full functional browser regression verifier.
"""
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlsplit, unquote
import hashlib, json, re, shutil, struct, zipfile

ROOT = Path(__file__).resolve().parents[1]
VERSION = json.loads((ROOT/'package.json').read_text())['version']
RELEASES, OUT = ROOT/'releases', ROOT/'verification'
RELEASE = RELEASES/f'dianyi-{VERSION}'
ARCHIVE = RELEASES/f'dianyi-chrome-edge-{VERSION}.zip'
sha = lambda data: hashlib.sha256(data).hexdigest()

# Historical archives are verified before any unpacked-directory synchronization.
historical = []
for line in (RELEASES/'SHA256SUMS.txt').read_text().splitlines():
    digest, name = line.split()
    if name == ARCHIVE.name: continue  # Current candidate may be rebuilt.
    assert sha((RELEASES/name).read_bytes()) == digest, name
    historical.append(name)

observations = json.loads((OUT/f'intro-{VERSION}.json').read_text())
units = json.loads((OUT/f'unit-{VERSION}.json').read_text())
assert observations['version'] == VERSION and observations['result'] == 'pass'
assert observations['management']['firstPartyConsoleErrors'] == []
assert observations['management']['primaryCTAToModel'] and observations['management']['libraryRoundtrip']
assert all(observations[key]['noHorizontalOverflow'] for key in ['desktop', 'mobile320', 'mobile375', 'tablet768'])
assert units['version'] == VERSION and units['result'] == 'pass' and units['passed'] == 102 and units['failed'] == 0

expected = {str(path.relative_to(ROOT/'src')): path.read_bytes() for path in (ROOT/'src').rglob('*') if path.is_file() and not any(part.startswith('.') for part in path.relative_to(ROOT/'src').parts)}
for dest, source in [('INSTALL.md','user-guide.md'), ('INSTALL.html','user-guide.html'), *[(name, name) for name in ['provider-defaults.md','provider-defaults.html','summary-guide.md','summary-guide.html']]]:
    expected[dest] = (ROOT/'docs'/source).read_bytes()
for size in [16,32,48,128]: expected[f'icons/icon{size}.png'] = (RELEASE/f'icons/icon{size}.png').read_bytes()

with zipfile.ZipFile(ARCHIVE) as archive:
    assert archive.testzip() is None
    assert set(archive.namelist()) == set(expected)
    assert len(archive.namelist()) == len(expected)
    for name, content in expected.items():
        assert archive.read(name) == content == (RELEASE/name).read_bytes(), name
        assert Path(name).suffix.lower() not in ['.doc','.docx','.key'], name
        assert not name.startswith(('tests/','verification/','docs/media/raw/')), name
        if Path(name).suffix in ['.js','.html','.json']:
            decoded = content.decode()
            assert not re.search(r'sk-[A-Za-z0-9._-]{20,}', decoded), 'Possible embedded credential in '+name
            assert not any(token in decoded for token in ['fixture-key','fixture-memory-key','__shiyiMenuReplay','__shiyiMigrate']), name
    manifest = json.loads(archive.read('manifest.json'))
    assert manifest['version'] == VERSION and manifest['short_name'] == '点译'
    assert manifest['side_panel'] == {'default_path':'summary.html'}
    with zipfile.ZipFile(RELEASES/'dianyi-chrome-edge-0.10.0.zip') as baseline:
        old_manifest = json.loads(baseline.read('manifest.json'))
        for field in ['permissions','host_permissions','content_security_policy','content_scripts','side_panel','minimum_chrome_version']:
            assert manifest[field] == old_manifest[field], field
        allowed = {'background.js','lib/core.js','ui/options.js','ui/styles.css','manifest.json'}
        changed_existing = [name for name in baseline.namelist() if name in expected and baseline.read(name) != expected[name] and name not in ['INSTALL.md','INSTALL.html','provider-defaults.html','summary-guide.html']]
        assert set(changed_existing) <= allowed, changed_existing

class References(HTMLParser):
    def __init__(self): super().__init__(); self.references=[]; self.ids=[]; self.images=[]
    def handle_starttag(self, tag, attributes):
        attrs=dict(attributes)
        if attrs.get('id'): self.ids.append(attrs['id'])
        if tag == 'img': self.images.append(attrs)
        for key in ['href','src']:
            if attrs.get(key): self.references.append(attrs[key])

for name in ['intro.html','privacy.html','terms.html','404.html','assets/promo/share-card.html']:
    document = References(); document.feed(expected[name].decode())
    assert len(document.ids) == len(set(document.ids)), name
    assert all('alt' in image for image in document.images), name
    for ref in document.references:
        split = urlsplit(ref)
        if split.scheme or ref.startswith('//'): continue
        if not split.path:
            assert not split.fragment or split.fragment in document.ids, (name, ref)
        else:
            target=(ROOT/'src'/Path(name).parent/unquote(split.path)).resolve()
            assert target.is_relative_to((ROOT/'src').resolve()) and target.is_file(), (name, ref)

dimensions = {}
for name in ['meaning.png','translation.png','revisit.png','social-card.png']:
    data=expected['assets/promo/'+name]
    assert data[:8] == b'\x89PNG\r\n\x1a\n'
    size=struct.unpack('>II',data[16:24]); dimensions[name]=list(size)
    assert size == ((2400,1260) if name == 'social-card.png' else (940,700)), (name,size)

# Keep all existing unpacked install paths current without changing any ZIP.
synced=[]
for destination in sorted(RELEASES.iterdir()):
    if not destination.is_dir() or destination == RELEASE or not re.fullmatch(r'(?:dianyi|shiyi)-\d+\.\d+\.\d+',destination.name): continue
    shutil.copytree(RELEASE,destination,dirs_exist_ok=True)
    for name,content in expected.items(): assert (destination/name).read_bytes() == content, str(destination/name)
    synced.append(destination.name)
archives=sorted(RELEASES.glob('*chrome-edge-*.zip'))
(RELEASES/'SHA256SUMS.txt').write_text(''.join(sha(path.read_bytes())+'  '+path.name+'\n' for path in archives))
report={
    'version':VERSION,'result':'pass','verification_scope':'Presentation release; saved real Chrome observations and package integrity, not a new full functional E2E run',
    'zip':ARCHIVE.name,'bytes':ARCHIVE.stat().st_size,'sha256':sha(ARCHIVE.read_bytes()),'production_files':len(expected),
    'unit_tests':units['passed'],'production_scripts':len(list((ROOT/'src').rglob('*.js'))),'zip_integrity':'pass','source_package_byte_match':'pass',
    'unchanged_permissions_and_csp_since':'0.10.0','unchanged_runtime_scope':'Translation/content/summary modules unchanged except core version; background adds about route only',
    'changed_existing_production_files':changed_existing,'word_files':False,'embedded_credentials':False,'new_runtime_debug_flags':False,
    'real_screenshot_dimensions':dimensions,'intro_browser_report':f'intro-{VERSION}.json',
    'management_test_context':observations['management']['context'],'historical_zips_unchanged':historical,'unpacked_install_directories_synced':synced,
    'limitations':observations['scope']['notClaimed']
}
(OUT/f'presentation-release-{VERSION}.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({key:report[key] for key in ['result','zip','bytes','sha256','production_files','unit_tests']},ensure_ascii=False))
print(f'Historical ZIPs unchanged: {len(historical)}; unpacked paths synchronized: {len(synced)}')
