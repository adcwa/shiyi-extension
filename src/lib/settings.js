import { DEFAULT_PREFS, DEFAULT_PROFILE, cleanPrefs, cleanProfile, secretIdentity, secretInput, AppError, assert } from './core.js';
import { migrateSitePolicy } from './site-policy.js';
import { summaryPresetProfile, cleanSummaryProfile, DEFAULT_SUMMARY_PREFS, cleanSummaryPrefs } from './summary-presets.js';
import { MAX_CONNECTIONS, connectionBank, connectionPurpose } from './connections.js';
import { cleanKnowledgePrefs } from './knowledge-core.js';

const credentialKey = purpose => purpose === 'summary' ? 'summaryCredentials' : 'modelCredentials';
const legacyKey = purpose => purpose === 'summary' ? 'summaryCredential' : 'credential';
const cleanFor = (purpose, profile) => purpose === 'summary' ? cleanSummaryProfile(profile) : cleanProfile(profile);
const configured = profile => !!profile?.endpoint && !!profile?.model;
let tail = Promise.resolve();
function normalizeConfig(value = {}) {
  const provider = value.profile?.provider ?? (value.profile?.endpoint ? 'custom' : DEFAULT_PROFILE.provider);
  const result = { ...migrateSitePolicy(value), prefs: { ...DEFAULT_PREFS, ...value.prefs }, profile: { ...DEFAULT_PROFILE, ...value.profile, provider }, summaryProfile: value.summaryProfile || summaryPresetProfile(), summaryPrefs: { ...DEFAULT_SUMMARY_PREFS, ...value.summaryPrefs }, modelConnections: { ...value.modelConnections } };
  result.knowledgePrefs = cleanKnowledgePrefs(value.knowledgePrefs);
  for (const purpose of ['translation', 'summary']) {
    const field = purpose === 'translation' ? 'profile' : 'summaryProfile';
    let bank = result.modelConnections[purpose];
    if (!bank) {
      const legacy = result[field], available = configured(legacy) && (purpose === 'translation' || result.summaryConfigured), id = purpose + '-primary';
      bank = { defaultId: available ? id : '', items: available ? [{ id, profile: cleanFor(purpose, { ...legacy, connectionId: id }), backup: true }] : [] };
    }
    const primary = bank.items.find(item => item.id === bank.defaultId);
    bank = { ...bank, items: primary ? [primary, ...bank.items.filter(item => item.id !== primary.id)] : bank.items };
    result.modelConnections[purpose] = bank;
    result[field] = primary?.profile || (purpose === 'translation' ? { ...DEFAULT_PROFILE } : summaryPresetProfile());
    if (purpose === 'summary') result.summaryConfigured = !!primary;
  }
  return result;
}
export async function initializeStorage() {
  await Promise.all([chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }), chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })]);
  const { config: existing } = await chrome.storage.local.get('config'), value = normalizeConfig(existing);
  // Only migrate a matching key, in its existing persistence area. Repeated
  // initialization never resurrects a cleared key or copies a session key to disk.
  for (const purpose of ['translation', 'summary']) {
    const bank = connectionBank(value, purpose), primary = bank.items.find(item => item.id === bank.defaultId);
    for (const area of [chrome.storage.local, chrome.storage.session]) {
      const oldKey = legacyKey(purpose), newKey = credentialKey(purpose), old = (await area.get(oldKey))[oldKey];
      if (old && primary && old.identity === secretIdentity(primary.profile)) {
        const current = (await area.get(newKey))[newKey] || {};
        if (!current[primary.id]) await area.set({ [newKey]: { ...current, [primary.id]: old } });
      }
      if (old) await area.remove(oldKey);
    }
  }
  await chrome.storage.local.set({ config: value });
  await chrome.storage.session.remove('temporary');
}
export async function config() { return normalizeConfig((await chrome.storage.local.get('config')).config); }
export function changeConfig(work) {
  const run = tail.then(async () => { const value = await config(); const result = await work(value); await chrome.storage.local.set({ config: value }); return result ?? value; });
  tail = run.catch(() => {}); return run;
}
export const savePrefs = prefs => changeConfig(value => { value.prefs = cleanPrefs(prefs); });
export const saveSummaryPrefs = prefs => changeConfig(value => { value.summaryPrefs = cleanSummaryPrefs(prefs); });
export const saveKnowledgePrefs = prefs => changeConfig(value => { value.knowledgePrefs = cleanKnowledgePrefs(prefs); });
async function secretFor(purpose, profile) {
  if (profile.auth === 'none' || profile.connectionId === null) return '';
  let id = profile.connectionId;
  if (!id) {
    const value = await config(), bank = connectionBank(value, purpose), primary = bank.items.find(item => item.id === bank.defaultId);
    if (primary && secretIdentity(primary.profile) === secretIdentity(profile)) id = primary.id;
  }
  if (!id) return '';
  const key = credentialKey(purpose), [session, local] = await Promise.all([chrome.storage.session.get(key), chrome.storage.local.get(key)]), identity = secretIdentity(profile);
  return session[key]?.[id]?.identity === identity ? session[key][id].apiKey : local[key]?.[id]?.identity === identity ? local[key][id].apiKey : '';
}
export const getSecret = profile => secretFor('translation', profile);
export const getSummarySecret = profile => secretFor('summary', profile);
async function resolveFor(purpose, input, keyValue) {
  const profile = cleanFor(purpose, input), entered = secretInput(keyValue), apiKey = profile.auth === 'none' ? '' : entered || await secretFor(purpose, profile);
  if (profile.auth === 'bearer' && !apiKey) throw new AppError('MISSING_KEY', `请填写此${purpose === 'summary' ? '总结' : '翻译'}连接自己的 API Key；新连接不会借用其他连接的密钥。`);
  return { profile, apiKey };
}
export const resolveProfile = (input, keyValue) => resolveFor('translation', input, keyValue);
export const resolveSummaryProfile = (input, keyValue) => resolveFor('summary', input, keyValue);
async function writeSecret(purpose, id, profile, apiKey) {
  const key = credentialKey(purpose), credential = { identity: secretIdentity(profile), apiKey };
  for (const [area, keep] of [[chrome.storage.local, profile.rememberKey], [chrome.storage.session, !profile.rememberKey]]) {
    const map = { ...(await area.get(key))[key] };
    if (profile.auth === 'bearer' && keep) map[id] = credential; else delete map[id];
    await area.set({ [key]: map });
  }
}
export async function saveConnection(purpose, input, keyValue, options = {}) {
  connectionPurpose(purpose);
  return changeConfig(async value => {
    const bank = connectionBank(value, purpose), requested = Object.hasOwn(options, 'id') ? options.id : bank.defaultId || null;
    assert(requested === null || bank.items.some(item => item.id === requested), 'NOT_FOUND', '这个连接已不存在，请重新选择。');
    const isNew = requested === null;
    assert(!isNew || bank.items.length < MAX_CONNECTIONS, 'CONNECTION_LIMIT', `每种用途最多保存 ${MAX_CONNECTIONS} 个连接。`);
    const { profile: clean, apiKey } = await resolveFor(purpose, { ...input, connectionId: requested }, keyValue);
    const id = requested || crypto.randomUUID(), profile = { ...clean, connectionId: id };
    await writeSecret(purpose, id, profile, apiKey);
    if (isNew) bank.items.push({ id, profile, backup: true }); else bank.items.find(item => item.id === id).profile = profile;
    if (!bank.defaultId || options.makeDefault === true) bank.defaultId = id;
    value.modelConnections[purpose] = bank;
    value[purpose === 'translation' ? 'profile' : 'summaryProfile'] = bank.items.find(item => item.id === bank.defaultId).profile;
    if (purpose === 'summary') value.summaryConfigured = true;
    return { id };
  });
}
export const saveProfile = (input, key, options) => saveConnection('translation', input, key, options);
export const saveSummaryProfile = (input, key, options) => saveConnection('summary', input, key, options);
export async function updateConnection(purpose, id, action, enabled) {
  connectionPurpose(purpose);
  return changeConfig(async value => {
    const bank = connectionBank(value, purpose), index = bank.items.findIndex(item => item.id === id);
    assert(index >= 0, 'NOT_FOUND', '这个模型连接已不存在。');
    assert(['default','backup','up','down','delete'].includes(action), 'INVALID_INPUT', '不支持的连接操作。');
    if (action === 'default') bank.defaultId = id;
    if (action === 'backup') { assert(typeof enabled === 'boolean', 'INVALID_INPUT', '请选择是否作为备用。'); bank.items[index].backup = enabled; }
    if (action === 'up' || action === 'down') { const next = index + (action === 'up' ? -1 : 1); if (index > 0 && next > 0 && next < bank.items.length) [bank.items[index], bank.items[next]] = [bank.items[next], bank.items[index]]; }
    if (action === 'delete') {
      assert(bank.defaultId !== id || bank.items.length === 1, 'DEFAULT_CONNECTION', '请先将另一个连接设为默认，再移除此连接。');
      bank.items.splice(index, 1); if (bank.defaultId === id) bank.defaultId = '';
      await writeSecret(purpose, id, { auth: 'none' }, '');
    }
    const primary = bank.items.find(item => item.id === bank.defaultId);
    value[purpose === 'translation' ? 'profile' : 'summaryProfile'] = primary?.profile || (purpose === 'translation' ? { ...DEFAULT_PROFILE } : summaryPresetProfile());
    if (purpose === 'summary') value.summaryConfigured = !!primary;
  });
}
export async function publicConfig() {
  const value = await config(), modelConnections = {};
  for (const purpose of ['translation', 'summary']) {
    const bank = connectionBank(value, purpose);
    modelConnections[purpose] = { defaultId: bank.defaultId, items: await Promise.all(bank.items.map(async item => ({ ...item, profile: { ...item.profile, hasKey: !!await secretFor(purpose, item.profile) } }))) };
  }
  return { ...value, modelConnections, profile: { ...value.profile, hasKey: !!await getSecret(value.profile) }, summaryProfile: { ...value.summaryProfile, hasKey: !!await getSummarySecret(value.summaryProfile), configured: !!value.summaryConfigured } };
}
async function clearFor(purpose) {
  await Promise.all([chrome.storage.local.remove(credentialKey(purpose)), chrome.storage.session.remove(credentialKey(purpose)), chrome.storage.local.remove(legacyKey(purpose)), chrome.storage.session.remove(legacyKey(purpose))]);
}
export const clearCredential = () => changeConfig(() => clearFor('translation'));
export const clearSummaryCredential = () => changeConfig(() => clearFor('summary'));
