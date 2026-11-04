import test from 'node:test';
import { execFileSync } from 'node:child_process';
test('offline installer preserves legacy identities, application backups and data boundaries in ten scenarios',()=>{
  execFileSync('python3',['tests/upgrade_installer_test.py'],{cwd:new URL('..',import.meta.url),stdio:'pipe'});
});
