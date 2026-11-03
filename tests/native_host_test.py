"""Isolated protocol, installer and capability tests; no real account/model."""
from pathlib import Path
import importlib.util, io, json, os, shutil, subprocess, tempfile, threading, time, unittest

ROOT=Path(__file__).resolve().parents[1]
def load(name,file):
    spec=importlib.util.spec_from_file_location(name,ROOT/file);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
host=load('dianyi_host','src/native-host/dianyi_codex.py')
installer=load('dianyi_installer','src/native-host/install.py')
FAKE='''#!/usr/bin/env python3
import sys,json
def send(value): print(json.dumps(value),flush=True)
for line in sys.stdin:
 value=json.loads(line);method=value.get('method');identifier=value.get('id');p=value.get('params',{})
 if method=='initialize':send({'id':identifier,'result':{}})
 elif method=='config/read':send({'id':identifier,'result':{'config':{'mcp_servers':{'inherited':{'enabled':'mcp_servers.inherited.enabled=false' not in sys.argv}},'features':{name:False for name in ['shell_tool','js_repl','apps','plugins','memories','hooks','multi_agent']}}}})
 elif method=='account/read':send({'id':identifier,'result':{'account':{'type':'chatgpt','email':'must-not-export@example.invalid'},'requiresOpenaiAuth':True}})
 elif method=='model/list':send({'id':identifier,'result':{'data':[{'model':'local-small','isDefault':True}]}})
 elif method=='thread/start':
  assert p['approvalPolicy']=='never' and p['sandbox']=='read-only' and p['ephemeral'] and 'cwd' in p
  send({'id':identifier,'result':{'thread':{'id':'isolated-thread','ephemeral':True},'instructionSources':[]}})
 elif method=='turn/start':
  send({'id':identifier,'result':{'turn':{'id':'isolated-turn'}}})
  text=p['input'][0]['text']
  if text=='TOOL_ATTEMPT':send({'method':'item/started','params':{'item':{'type':'commandExecution','command':'should never run'}}})
  elif text=='STALL':pass
  else:
   for delta in ['好','奇心']:send({'method':'item/agentMessage/delta','params':{'threadId':'isolated-thread','itemId':'answer','delta':delta}})
   send({'method':'turn/completed','params':{'turn':{'id':'isolated-turn','status':'completed'}}})
'''

class NativeHostTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='dianyi-host-test-');self.directory=Path(self.temp.name)
        self.cli=self.directory/'codex';self.cli.write_text(FAKE);self.cli.chmod(0o700)
    def tearDown(self): self.temp.cleanup()
    def test_utf8_frames_reject_oversize_truncation_and_invalid_actions(self):
        stream=io.BytesIO();host.write_frame(stream,{'text':'你好'});stream.seek(0);self.assertEqual(host.read_frame(stream),{'text':'你好'})
        with self.assertRaises(EOFError):host.read_frame(io.BytesIO(b'\x10\x00\x00\x00x'))
        with self.assertRaises(host.BridgeError):host.read_frame(io.BytesIO(b'\xff\xff\xff\xff'))
        for request in [{'action':'shell'},{'action':'generate','model':'x;bad','messages':[]},{'action':'generate','messages':[{'role':'tool','content':'bad'}]}]:
            with self.assertRaises(host.BridgeError):host.validate_request(request)
    def test_status_is_sanitized_and_inherited_mcp_is_explicitly_disabled(self):
        status=host.execute(host.validate_request({'action':'status'}),self.cli,lambda text:None)
        self.assertTrue(status['ready']);self.assertEqual(status['models'][0]['id'],'local-small')
        self.assertNotIn('email',json.dumps(status));self.assertNotIn('must-not-export',json.dumps(status))
    def test_real_protocol_stream_and_tools_fail_closed(self):
        output=[];host.execute(host.validate_request({'action':'generate','messages':[{'role':'user','content':'curiosity'}]}),self.cli,output.append)
        self.assertEqual(''.join(output),'好奇心')
        with self.assertRaises(host.BridgeError) as error:host.execute(host.validate_request({'action':'generate','messages':[{'role':'user','content':'TOOL_ATTEMPT'}]}),self.cli,output.append)
        self.assertEqual(error.exception.code,'CODEX_TOOLS_BLOCKED')
    def test_disconnect_stops_session_and_process_group(self):
        disconnected=threading.Event();session=host.CodexSession(self.cli,self.directory,5,disconnected,['inherited'])
        try:
            self.assertEqual(session.initialize(),[])
            timer=threading.Timer(.2,disconnected.set);timer.start()
            with self.assertRaises(host.BridgeError):session.generate({'model':'auto','messages':[{'role':'user','content':'STALL'}]},self.directory,lambda x:None)
            timer.cancel()
        finally:session.close()
        self.assertIsNotNone(session.process.poll())
    def test_installer_exact_ids_and_cli_path_stay_in_isolated_home(self):
        result=installer.install(['a'*32],codex_path=str(self.cli),home=self.directory,platform='darwin')
        self.assertEqual(result,['chrome','edge'])
        settings=json.loads((self.directory/'.local/share/dianyi-codex/bridge-settings.json').read_text())
        self.assertEqual(set(settings),{'codex_path','allowed_origins'});self.assertEqual(settings['allowed_origins'],['chrome-extension://'+'a'*32+'/'])
        manifest=json.loads((self.directory/'Library/Application Support/Google/Chrome/NativeMessagingHosts/com.dianyi.codex.json').read_text())
        self.assertEqual(manifest['allowed_origins'],settings['allowed_origins']);self.assertTrue(Path(manifest['path']).is_file())
        with self.assertRaises(ValueError):installer.install(['*'],codex_path=str(self.cli),home=self.directory,platform='darwin')
    def test_native_entry_rejects_other_origins_without_starting_cli(self):
        shutil.copyfile(ROOT/'src/native-host/dianyi_codex.py',self.directory/'dianyi_codex.py')
        (self.directory/'bridge-settings.json').write_text(json.dumps({'codex_path':'not-a-real-cli','allowed_origins':['chrome-extension://'+'a'*32+'/']}))
        process=subprocess.run([os.sys.executable,str(self.directory/'dianyi_codex.py'),'chrome-extension://'+'b'*32+'/'],input=b'',capture_output=True)
        frame=host.read_frame(io.BytesIO(process.stdout));self.assertEqual(frame,{'type':'error','code':'CODEX_PERMISSION'});self.assertEqual(process.stderr,b'')

if __name__=='__main__':unittest.main(verbosity=2)
