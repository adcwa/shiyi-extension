#!/usr/bin/env python3
"""Install the reviewed local host for exact extension IDs (macOS / Linux).
No login, credentials, global Codex configuration or startup service is changed.
"""
from pathlib import Path
import argparse, json, os, re, shlex, shutil, sys

HOST = 'com.dianyi.codex'

def locations(home, platform):
    if platform == 'darwin':
        base=home/'Library/Application Support'
        return {'chrome':base/'Google/Chrome/NativeMessagingHosts','edge':base/'Microsoft Edge/NativeMessagingHosts'}
    if platform.startswith('linux'):
        base=home/'.config'
        return {'chrome':base/'google-chrome/NativeMessagingHosts','edge':base/'microsoft-edge/NativeMessagingHosts'}
    raise ValueError('当前本机助手安装器支持 macOS / Linux。其他系统仍可使用插件的 API Key 连接。')

def install(extension_ids, browser='both', codex_path=None, home=None, platform=None):
    home=Path(home or Path.home()); platform=platform or sys.platform
    if not extension_ids or any(not re.fullmatch(r'[a-p]{32}',value) for value in extension_ids): raise ValueError('扩展 ID 需要是扩展管理页显示的 32 位字母。')
    targets=locations(home,platform)
    cli=codex_path or shutil.which('codex')
    if not cli or not Path(cli).is_file() or not os.access(cli,os.X_OK): raise ValueError('没有找到可执行的 Codex CLI。请先按官方说明安装并运行 codex login。')
    cli=str(Path(cli).absolute())
    destination=home/'.local/share/dianyi-codex';destination.mkdir(parents=True,exist_ok=True,mode=0o700)
    settings_file=destination/'bridge-settings.json'
    previous=json.loads(settings_file.read_text()) if settings_file.exists() else {}
    allowed=set(previous.get('allowed_origins',[])) | {'chrome-extension://'+value+'/' for value in extension_ids}
    if any(not re.fullmatch(r'chrome-extension://[a-p]{32}/',value) for value in allowed): raise ValueError('已有本机助手来源配置无效，请先检查本机助手目录。')
    if len(allowed)>16: raise ValueError('最多允许 16 个明确的扩展 ID，请先整理本机助手的来源配置。')
    shutil.copyfile(Path(__file__).with_name('dianyi_codex.py'),destination/'dianyi_codex.py')
    settings_file.write_text(json.dumps({'codex_path':cli,'allowed_origins':sorted(allowed)},ensure_ascii=False,indent=2)+'\n');settings_file.chmod(0o600)
    launcher=destination/'launch.sh'
    launcher.write_text('#!/bin/sh\nexec '+shlex.quote(sys.executable)+' '+shlex.quote(str(destination/'dianyi_codex.py'))+' "$@"\n');launcher.chmod(0o700)
    manifest={'name':HOST,'description':'点译本机 Codex 文本助手','path':str(launcher),'type':'stdio','allowed_origins':sorted(allowed)}
    installed=[]
    for name,path in targets.items():
        if browser not in ['both',name]: continue
        path.mkdir(parents=True,exist_ok=True)
        file=path/(HOST+'.json');file.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n');file.chmod(0o600);installed.append(name)
    return installed

def main():
    parser=argparse.ArgumentParser(description='安装点译本机 Codex 助手，只允许指定扩展连接。')
    parser.add_argument('--extension-id',action='append',required=True,help='点译设置页提供的扩展 ID；重复填写可授权多个安装目录')
    parser.add_argument('--browser',choices=['chrome','edge','both'],default='both',help='需要安装的浏览器，默认 Chrome 与 Edge')
    parser.add_argument('--codex-path',help='可选：本机已安装的 Codex CLI 完整路径')
    args=parser.parse_args()
    try:
        result=install(args.extension_id,args.browser,args.codex_path)
        print('点译本机助手已安装：'+', '.join(result)+'。请回到插件点击“检测本机登录”。')
        print('登录仍由 Codex CLI 管理；本安装器未读取、导出或修改认证令牌。')
    except (OSError,ValueError) as error: parser.exit(1,'安装未完成：'+str(error)+'\n')

if __name__=='__main__': main()
