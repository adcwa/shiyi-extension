"""Offline installer boundaries; fixture application trees, never user profiles."""
from pathlib import Path
from unittest.mock import patch
import importlib.util
import json
import tempfile
import unittest

MODULE=Path(__file__).resolve().parents[1]/'src/upgrade/install.py'
spec=importlib.util.spec_from_file_location('dianyi_upgrade',MODULE);upgrade=importlib.util.module_from_spec(spec);spec.loader.exec_module(upgrade)

class InstallerTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)
  self.source=self.root/'new';self.source.mkdir();self.target=self.root/'old'
  self.manifest={'manifest_version':3,'name':'点译 · 测试','version':'0.14.2','key':'fixture-public-key'}
  (self.source/'manifest.json').write_text(json.dumps(self.manifest));(self.source/'background.js').write_text('new program')
 def legacy(self,key=None):
  self.target.mkdir();manifest={**self.manifest,'version':'0.14.1'}
  if key is None:manifest.pop('key')
  else:manifest['key']=key
  (self.target/'manifest.json').write_text(json.dumps(manifest));(self.target/'background.js').write_text('old program')
 def test_fresh_uses_fixed_public_identity(self):
  upgrade.install(self.source,self.target);self.assertEqual(json.loads((self.target/'manifest.json').read_text())['key'],'fixture-public-key')
 def test_keyless_legacy_keeps_key_absence(self):
  self.legacy();result=upgrade.install(self.source,self.target)
  self.assertNotIn('key',json.loads((self.target/'manifest.json').read_text()));self.assertEqual((self.target/'background.js').read_text(),'new program')
  self.assertEqual((Path(result['backup'])/'background.js').read_text(),'old program')
 def test_existing_public_identity_never_replaced(self):
  self.legacy('original-public-key');upgrade.install(self.source,self.target)
  self.assertEqual(json.loads((self.target/'manifest.json').read_text())['key'],'original-public-key')
 def test_unrelated_target_files_and_outside_storage_unchanged(self):
  self.legacy();(self.target/'my-notes.txt').write_text('keep notes');store=self.root/'browser-storage';store.write_text('synthetic existing data')
  upgrade.install(self.source,self.target)
  self.assertEqual((self.target/'my-notes.txt').read_text(),'keep notes');self.assertEqual(store.read_text(),'synthetic existing data')
 def test_non_extension_target_rejected(self):
  self.target.mkdir();(self.target/'important.txt').write_text('keep')
  with self.assertRaises(ValueError):upgrade.install(self.source,self.target)
  self.assertEqual((self.target/'important.txt').read_text(),'keep')
 def test_self_and_nested_targets_rejected(self):
  for target in [self.source,self.source/'nested',self.root]:
   with self.assertRaises(ValueError):upgrade.install(self.source,target)
 def test_symlink_target_cannot_overwrite_other_files(self):
  self.legacy();outside=self.root/'outside';outside.write_text('keep');(self.target/'background.js').unlink();(self.target/'background.js').symlink_to(outside)
  with self.assertRaises(ValueError):upgrade.install(self.source,self.target)
  self.assertEqual(outside.read_text(),'keep')
 def test_repeated_updates_retain_legacy_identity(self):
  self.legacy();upgrade.install(self.source,self.target);upgrade.install(self.source,self.target)
  self.assertNotIn('key',json.loads((self.target/'manifest.json').read_text()))
 def test_metadata_discovery_prioritizes_existing_local_files(self):
  self.legacy();base=self.root/'Chrome';profile=base/'Default';profile.mkdir(parents=True)
  (profile/'Preferences').write_text(json.dumps({'extensions':{'settings':{'a':{'path':str(self.target),'secret':'never output'},'b':{'path':str(self.source)}}}}))
  (profile/'Local Extension Settings'/'a').mkdir(parents=True)
  rows=upgrade.discover_installs([('Chrome',base)]);self.assertEqual(rows[0]['path'],str(self.target.resolve()));self.assertTrue(rows[0]['has_local_files']);self.assertNotIn('never output',json.dumps(rows))
 def test_partial_file_failure_rolls_back_written_application_files(self):
  self.legacy();original=(self.target/'manifest.json').read_bytes();replace=upgrade.os.replace;calls=0
  def fail_second(*args):
   nonlocal calls
   calls+=1
   if calls==2:raise OSError('fixture disk failure')
   return replace(*args)
  with patch.object(upgrade.os,'replace',fail_second):
   with self.assertRaises(OSError):upgrade.install(self.source,self.target)
  self.assertEqual((self.target/'manifest.json').read_bytes(),original);self.assertEqual((self.target/'background.js').read_text(),'old program')

if __name__=='__main__':unittest.main()
