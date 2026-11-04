#!/usr/bin/env python3
"""Install offline or update the ORIGINAL unpacked directory, preserving its ID.

Browser preferences are read only for extension paths. Storage, credentials,
browser databases and permissions are never read, copied, deleted or modified.
"""
from pathlib import Path
from datetime import datetime
import argparse
import json
import os
import shutil
import sys
import tempfile
import uuid


def manifest_at(folder):
    manifest = json.loads((Path(folder)/'manifest.json').read_text(encoding='utf-8'))
    if manifest.get('manifest_version') != 3 or not any(name in manifest.get('name', '') for name in ['点译', '拾译']):
        raise ValueError('请选择点译原来加载的文件夹，其中应包含 manifest.json。')
    return manifest


def installation_manifest(incoming, existing=None):
    result = dict(incoming)
    # Adding a new public key to a legacy install changes its ID and disconnects
    # its existing storage. An absent legacy key is an identity to preserve too.
    if existing is not None:
        if 'key' in existing:
            result['key'] = existing['key']
        else:
            result.pop('key', None)
    return result


def source_files(source):
    result = []
    for file in sorted(source.rglob('*')):
        relative = file.relative_to(source)
        if any(part.startswith('.') or part == '__pycache__' for part in relative.parts) or file.suffix == '.pyc':
            continue
        if file.is_symlink():
            raise ValueError('安装包含符号链接，请重新解压官方项目安装包。')
        if file.is_file():
            result.append(relative)
    return result


def install(source, target, *, backup=True):
    source, target = Path(source).resolve(), Path(target).expanduser().resolve()
    incoming = manifest_at(source)
    if source == target or source in target.parents or target in source.parents:
        raise ValueError('新版解压目录和原安装目录需要分别选择，且不能互相包含。')
    if (target/'.git').exists():
        raise ValueError('目标是代码仓库，请选择实际加载的插件文件夹。')
    existing = manifest_at(target) if (target/'manifest.json').exists() else None
    if target.exists() and existing is None and any(target.iterdir()):
        raise ValueError('目标文件夹不是点译安装目录；为避免覆盖其他文件，已停止。')
    files = source_files(source)
    for relative in files:
        if (target/relative).is_symlink() or any(parent.is_symlink() for parent in (target/relative).parents if parent != target and target in parent.parents):
            raise ValueError('原安装目录含符号链接，已停止覆盖。')
    prepared = installation_manifest(incoming, existing)
    backup_path = None
    if backup and existing:
        backup_path = target.parent/'.dianyi-code-backups'/(target.name+'-'+existing['version']+'-'+datetime.now().strftime('%Y%m%d-%H%M%S')+'-'+uuid.uuid4().hex[:6])
    target.mkdir(parents=True, exist_ok=True)
    # Prepare every file first. Backup only the application files we will change,
    # never browser storage. Preserve unrelated files in the target directory.
    with tempfile.TemporaryDirectory(prefix='.dianyi-update-', dir=target.parent) as staging:
        stage = Path(staging)
        for relative in files:
            staged = stage/relative;staged.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source/relative, staged)
        (stage/'manifest.json').write_text(json.dumps(prepared, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
        old = {}
        for relative in files:
            file = target/relative
            if file.exists() and not file.is_file():
                raise ValueError('原安装目录的文件类型不匹配，已停止覆盖。')
            old[relative] = (file.read_bytes(), file.stat().st_mode) if file.exists() else None
            if backup_path and file.exists():
                copy = backup_path/relative;copy.parent.mkdir(parents=True, exist_ok=True);shutil.copy2(file, copy)
        written = []
        try:
            for relative in files:
                file = target/relative;file.parent.mkdir(parents=True, exist_ok=True)
                os.replace(stage/relative, file);written.append(relative)
        except Exception:
            for relative in reversed(written):
                file = target/relative
                if old[relative] is None:
                    file.unlink(missing_ok=True)
                else:
                    file.write_bytes(old[relative][0]);file.chmod(old[relative][1])
            raise
    return {'version': incoming['version'], 'target': str(target), 'existing': existing is not None,
            'identity': 'fixed' if prepared.get('key') else 'original-directory',
            'backup': str(backup_path) if backup_path else None}


def browser_roots(home=None, platform=None):
    home, platform = Path(home or Path.home()), platform or sys.platform
    if platform == 'darwin':
        base = home/'Library/Application Support'
        return [('Chrome', base/'Google/Chrome'), ('Edge', base/'Microsoft Edge')]
    if platform == 'win32':
        base = Path(os.environ.get('LOCALAPPDATA', str(home/'AppData/Local')))
        return [('Chrome', base/'Google/Chrome/User Data'), ('Edge', base/'Microsoft/Edge/User Data')]
    return [('Chrome', home/'.config/google-chrome'), ('Chromium', home/'.config/chromium'), ('Edge', home/'.config/microsoft-edge')]


def discover_installs(roots=None):
    found = {}
    for browser, base in roots or browser_roots():
        for profile in [base/'Default', *sorted(base.glob('Profile *'))]:
            settings = {}
            for name in ['Preferences', 'Secure Preferences']:
                try:
                    settings.update(json.loads((profile/name).read_text(encoding='utf-8')).get('extensions', {}).get('settings', {}))
                except (OSError, ValueError):
                    continue
            for ident, item in settings.items():
                raw = item.get('path', '')
                if not raw or not Path(raw).is_absolute():
                    continue
                path = Path(raw).resolve()
                try:
                    manifest = manifest_at(path)
                except (OSError, ValueError, TypeError):
                    continue
                row = found.setdefault(str(path), {'path': str(path), 'version': manifest['version'], 'browsers': [], 'has_local_files': False})
                row['browsers'].append(browser+' / '+profile.name)
                # File existence helps distinguish an old data-bearing instance
                # from a newly empty one. Contents and keys are never accessed.
                row['has_local_files'] |= (profile/'Local Extension Settings'/ident).exists() or (profile/'IndexedDB'/('chrome-extension_'+ident+'_0.indexeddb.leveldb')).exists()
    return sorted(found.values(), key=lambda row: (not row['has_local_files'], row['path']))


def main():
    parser = argparse.ArgumentParser(description='保留点译原安装目录与插件身份，离线升级应用文件，不接触浏览器数据。')
    parser.add_argument('--source', type=Path, default=Path(__file__).resolve().parents[1], help='新版解压文件夹')
    parser.add_argument('--target', type=Path, help='已确认的原安装目录；不存在的空目录将作为首次安装')
    args = parser.parse_args()
    source = args.source.resolve();manifest_at(source)
    target = args.target
    if target is None:
        rows = [row for row in discover_installs() if Path(row['path']) != source]
        print('\n点译 · 安装与升级\n已安装请选原来的文件夹，不要卸载，不要重新加载新目录。\n')
        for index, row in enumerate(rows, 1):
            print(str(index)+'. '+('有本地数据文件 · ' if row['has_local_files'] else '')+' / '.join(row['browsers']))
            print('   '+row['path'])
        print('N. 首次安装到固定文件夹\nP. 手动输入原安装文件夹\nQ. 取消')
        choice = input('请选择：').strip()
        if choice.lower() == 'q':return
        if choice.lower() == 'n':
            target = Path.home()/('Applications' if sys.platform == 'darwin' else 'Dianyi')/('Dianyi' if sys.platform == 'darwin' else 'extension')
        elif choice.lower() == 'p':
            target = Path(input('原安装文件夹完整路径：').strip().strip('"').strip("'"))
        elif choice.isdigit() and 1 <= int(choice) <= len(rows):
            target = Path(rows[int(choice)-1]['path'])
        else:raise ValueError('没有选择有效目录，未修改任何文件。')
        print('\n将更新应用文件到：'+str(target.expanduser().resolve()))
        print('保留原插件身份；不读取 Key，不修改浏览器数据库。旧代码另存为可回退副本。')
        if input('按回车继续，输入其他内容取消：').strip():return
    result = install(source, target)
    print('\n已准备 v'+result['version']+'：'+result['target'])
    if result['existing']:
        print('请在 chrome://extensions 或 edge://extensions 中，找到原来那条点译，点击“重新加载”。不要删除原插件。')
    else:
        print('请在扩展管理页“加载已解压的扩展”，选择上面的固定文件夹。')
    if result['backup']:print('旧应用文件备份：'+result['backup'])
    print('配置、已长期保存的 Key、词库与轨迹继续由原浏览器身份读取。仅会话保存的 Key 在重新加载后需重填。')


if __name__ == '__main__':
    try:main()
    except (OSError, ValueError, EOFError) as error:
        print('未完成安装：'+str(error), file=sys.stderr);sys.exit(1)
