import { DEFAULT_PREFS, DEFAULT_PROFILE, cleanPrefs, cleanProfile, secretIdentity, secretInput, AppError } from './core.js';
import { migrateSitePolicy } from './site-policy.js';

export async function initializeStorage() {
  await Promise.all([
    chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
    chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
  ]);
  const { config } = await chrome.storage.local.get('config');
  await chrome.storage.local.set({ config: migrateSitePolicy(config || { prefs: { ...DEFAULT_PREFS }, profile: { ...DEFAULT_PROFILE } }) });
  await chrome.storage.session.remove('temporary');
}
export async function config() {
  const { config: value } = await chrome.storage.local.get('config');
  // v0.1.0 connections had no provider metadata. Keep their exact endpoint/model
  // and credential identity instead of silently converting them into a preset.
  const provider = value?.profile?.provider ?? (value?.profile?.endpoint ? 'custom' : DEFAULT_PROFILE.provider);
  return { ...migrateSitePolicy(value), prefs: { ...DEFAULT_PREFS, ...value?.prefs }, profile: { ...DEFAULT_PROFILE, ...value?.profile, provider } };
}
let tail = Promise.resolve();
export function changeConfig(work) {
  const run = tail.then(async () => { const value = await config(); const result = await work(value); await chrome.storage.local.set({ config: value }); return result ?? value; });
  tail = run.catch(() => {}); return run;
}
export const savePrefs = prefs => changeConfig(value => { value.prefs = cleanPrefs(prefs); });
export async function getSecret(profile) {
  if (profile.auth === 'none') return '';
  const identity = secretIdentity(profile);
  const [{ credential: session }, { credential: local }] = await Promise.all([chrome.storage.session.get('credential'), chrome.storage.local.get('credential')]);
  return session?.identity === identity ? session.apiKey : local?.identity === identity ? local.apiKey : '';
}
export async function resolveProfile(input, keyValue) {
  const profile = cleanProfile(input), entered = secretInput(keyValue);
  const apiKey = profile.auth === 'none' ? '' : entered || await getSecret(profile);
  if (profile.auth === 'bearer' && !apiKey) throw new AppError('MISSING_KEY', '请填写 API Key；更换服务地址后需要重新填写密钥。');
  return { profile, apiKey };
}
export async function saveProfile(input, keyValue) {
  const { profile, apiKey } = await resolveProfile(input, keyValue);
  return changeConfig(async value => {
    const credential = { identity: secretIdentity(profile), apiKey };
    // The opt-in is evaluated here, never inferred from a previous connection.
    if (profile.auth === 'none') await Promise.all([chrome.storage.local.remove('credential'), chrome.storage.session.remove('credential')]);
    else if (profile.rememberKey) { await chrome.storage.local.set({ credential }); await chrome.storage.session.remove('credential'); }
    else { await chrome.storage.session.set({ credential }); await chrome.storage.local.remove('credential'); }
    value.profile = profile;
  });
}
export async function publicConfig() {
  const value = await config();
  return { ...value, profile: { ...value.profile, hasKey: !!await getSecret(value.profile) } };
}
export async function clearCredential() { await Promise.all([chrome.storage.local.remove('credential'), chrome.storage.session.remove('credential')]); }
