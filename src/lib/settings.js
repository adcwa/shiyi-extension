import { DEFAULT_PREFS, DEFAULT_PROFILE, cleanPrefs, cleanProfile, secretIdentity, secretInput, AppError, assert } from './core.js';
import { migrateSitePolicy } from './site-policy.js';
import { summaryPresetProfile, cleanSummaryProfile, DEFAULT_SUMMARY_PREFS, cleanSummaryPrefs } from './summary-presets.js';
import { MAX_CONNECTIONS, connectionBank, connectionPurpose } from './connections.js';
import { cleanKnowledgePrefs } from './knowledge-core.js';
import { libraryItems, migrateModels, synchronizeModels, supportsSummary, MAX_LIBRARY_CONNECTIONS } from './model-library.js';

const SHARED_CREDENTIALS = 'modelLibraryCredentials';
const oldCredentials = ['modelCredentials', 'summaryCredentials', 'credential', 'summaryCredential'];
const cleanFor = (purpose, profile) => purpose === 'summary' ? cleanSummaryProfile(profile) : cleanProfile(profile);
let tail = Promise.resolve();
function normalizeConfig(value = {}) {
  const provider = value.profile?.provider ?? (value.profile?.endpoint ? 'custom' : DEFAULT_PROFILE.provider);
  const result = { ...migrateSitePolicy(value), prefs: { ...DEFAULT_PREFS, ...value.prefs }, profile: { ...DEFAULT_PROFILE, ...value.profile, provider }, summaryProfile: value.summaryProfile || summaryPresetProfile(), summaryPrefs: { ...DEFAULT_SUMMARY_PREFS, ...value.summaryPrefs }, modelConnections: { ...value.modelConnections }, knowledgePrefs: cleanKnowledgePrefs(value.knowledgePrefs) };
  return migrateModels(result);
}
export async function initializeStorage() {
  await Promise.all([chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }), chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })]);
  const { config: existing } = await chrome.storage.local.get('config'), { value, legacy } = normalizeConfig(existing);
  // Copy before committing references, preserving each persistence area. Only a
  // pre-library configuration migrates secrets, so a cleared key cannot revive.
  for (const area of [chrome.storage.local, chrome.storage.session]) {
    const map = { ...(await area.get(SHARED_CREDENTIALS))[SHARED_CREDENTIALS] };
    for (const item of legacy) {
      const key = item.purpose === 'summary' ? 'summaryCredentials' : 'modelCredentials';
      const old = (await area.get(key))[key]?.[item.oldId];
      const singleKey = item.purpose === 'summary' ? 'summaryCredential' : 'credential';
      const single = (await area.get(singleKey))[singleKey];
      const candidate = old || (connectionBank(value, item.purpose).defaultId === item.id ? single : null);
      if (!map[item.id] && candidate?.identity === secretIdentity(item.profile)) map[item.id] = candidate;
    }
    await area.set({ [SHARED_CREDENTIALS]: map });
  }
  await chrome.storage.local.set({ config: value });
  for (const area of [chrome.storage.local, chrome.storage.session]) for (const key of oldCredentials) await area.remove(key);
  await chrome.storage.session.remove('temporary');
}
export async function config() { return normalizeConfig((await chrome.storage.local.get('config')).config).value; }
export function changeConfig(work) {
  const run = tail.then(async () => { const value = await config(), result = await work(value); synchronizeModels(value); await chrome.storage.local.set({ config: value }); return result ?? value; });
  tail = run.catch(() => {}); return run;
}
export const savePrefs = prefs => changeConfig(value => { value.prefs = cleanPrefs(prefs); });
export const saveSummaryPrefs = prefs => changeConfig(value => { value.summaryPrefs = cleanSummaryPrefs(prefs); });
export const saveKnowledgePrefs = prefs => changeConfig(value => { value.knowledgePrefs = cleanKnowledgePrefs({...value.knowledgePrefs,...prefs}); });
async function secretFor(purpose, profile) {
  if (profile.auth === 'none' || profile.connectionId === null) return '';
  let id = profile.connectionId;
  if (!id) {
    const value = await config(), bank = connectionBank(value, purpose), primary = bank.items.find(item => item.id === bank.defaultId);
    if (primary && secretIdentity(primary.profile) === secretIdentity(profile)) id = primary.id;
  }
  if (!id) return '';
  const [session, local] = await Promise.all([chrome.storage.session.get(SHARED_CREDENTIALS), chrome.storage.local.get(SHARED_CREDENTIALS)]), identity = secretIdentity(profile);
  return session[SHARED_CREDENTIALS]?.[id]?.identity === identity ? session[SHARED_CREDENTIALS][id].apiKey : local[SHARED_CREDENTIALS]?.[id]?.identity === identity ? local[SHARED_CREDENTIALS][id].apiKey : '';
}
export const getSecret = profile => secretFor('translation', profile);
export const getSummarySecret = profile => secretFor('summary', profile);
async function resolveFor(purpose, input, keyValue) {
  const profile = cleanFor(purpose, input), entered = secretInput(keyValue), apiKey = profile.auth === 'none' ? '' : entered || await secretFor(purpose, profile);
  if (profile.auth === 'bearer' && !apiKey) throw new AppError('MISSING_KEY', '请为这个模型连接填写 API Key；已保存连接可在各场景直接选择。');
  return { profile, apiKey };
}
export const resolveProfile = (input, keyValue) => resolveFor('translation', input, keyValue);
export const resolveSummaryProfile = (input, keyValue) => resolveFor('summary', input, keyValue);
async function writeSecret(id, profile, apiKey) {
  const credential = { identity: secretIdentity(profile), apiKey };
  for (const [area, keep] of [[chrome.storage.local, profile.rememberKey], [chrome.storage.session, !profile.rememberKey]]) {
    const map = { ...(await area.get(SHARED_CREDENTIALS))[SHARED_CREDENTIALS] };
    if (profile.auth === 'bearer' && keep) map[id] = credential; else delete map[id];
    await area.set({ [SHARED_CREDENTIALS]: map });
  }
}
function attach(value, purpose, id, makeDefault = false) {
  const item = libraryItems(value).find(item => item.id === id);
  assert(item, 'NOT_FOUND', '这个模型已从模型库移除，请重新选择。');
  cleanFor(purpose, item.profile);
  const bank = connectionBank(value, purpose);
  if (!bank.items.some(item => item.id === id)) {
    assert(bank.items.length < MAX_CONNECTIONS, 'CONNECTION_LIMIT', `每个场景最多使用 ${MAX_CONNECTIONS} 个连接。`);
    bank.items.push({ id, backup: false, profile: item.profile });
  }
  if (!bank.defaultId || makeDefault) bank.defaultId = id;
  value.modelConnections[purpose] = bank;
}
async function saveInLibrary(value, input, keyValue, id) {
  const items = libraryItems(value), previous = items.find(item => item.id === id);
  assert(id === null || previous, 'NOT_FOUND', '这个模型连接已不存在，请重新选择。');
  assert(previous || items.length < MAX_LIBRARY_CONNECTIONS, 'CONNECTION_LIMIT', `模型库最多保存 ${MAX_LIBRARY_CONNECTIONS} 个连接。`);
  const { profile: clean, apiKey } = await resolveFor('translation', { ...input, connectionId: id }, keyValue);
  const profile = { ...clean, connectionId: id || crypto.randomUUID() };
  assert(supportsSummary(profile) || !connectionBank(value, 'summary').items.some(item => item.id === id), 'MODEL_IN_USE', '这个模型正在总结场景使用。请先从总结场景移除，再改为翻译专用型号。');
  await writeSecret(profile.connectionId, profile, apiKey);
  if (previous) previous.profile = profile; else items.push({ id: profile.connectionId, profile });
  return profile.connectionId;
}
export function saveLibraryConnection(input, keyValue, { id = null } = {}) {
  return changeConfig(async value => ({ id: await saveInLibrary(value, input, keyValue, id) }));
}
export function saveConnection(purpose, input, keyValue, options = {}) {
  connectionPurpose(purpose);
  return changeConfig(async value => {
    const bank = connectionBank(value, purpose), id = Object.hasOwn(options, 'id') ? options.id : bank.defaultId || null;
    assert(id !== null || bank.items.length < MAX_CONNECTIONS, 'CONNECTION_LIMIT', `每个场景最多使用 ${MAX_CONNECTIONS} 个连接。`);
    const clean = cleanFor(purpose, input), saved = await saveInLibrary(value, clean, keyValue, id);
    attach(value, purpose, saved, options.makeDefault === true);
    if (id === null) bank.items.find(item => item.id === saved).backup = true;
    return { id: saved };
  });
}
export const saveProfile = (input, key, options) => saveConnection('translation', input, key, options);
export const saveSummaryProfile = (input, key, options) => saveConnection('summary', input, key, options);
export function assignConnection(purpose, id, makeDefault = true) {
  connectionPurpose(purpose);
  return changeConfig(value => { attach(value, purpose, id, makeDefault); if(!makeDefault)connectionBank(value,purpose).items.find(item=>item.id===id).backup=true; });
}
export function removeLibraryConnection(id) {
  return changeConfig(async value => {
    assert(libraryItems(value).some(item => item.id === id), 'NOT_FOUND', '这个模型连接已不存在。');
    value.modelLibrary.items = libraryItems(value).filter(item => item.id !== id);
    for (const bank of Object.values(value.modelConnections)) {
      bank.items = bank.items.filter(item => item.id !== id);
      if (bank.defaultId === id) bank.defaultId = bank.items.find(item => item.backup)?.id || '';
    }
    await writeSecret(id, { auth: 'none' }, '');
  });
}
export function updateConnection(purpose, id, action, enabled) {
  connectionPurpose(purpose);
  return changeConfig(value => {
    const bank = connectionBank(value, purpose), index = bank.items.findIndex(item => item.id === id);
    assert(index >= 0, 'NOT_FOUND', '这个场景尚未使用此模型，请从模型库选择。');
    assert(['default','backup','up','down','delete'].includes(action), 'INVALID_INPUT', '不支持的连接操作。');
    if (action === 'default') bank.defaultId = id;
    if (action === 'backup') { assert(typeof enabled === 'boolean', 'INVALID_INPUT', '请选择是否作为备用。'); bank.items[index].backup = enabled; }
    if (action === 'up' || action === 'down') { const next = index + (action === 'up' ? -1 : 1); if (index > 0 && next > 0 && next < bank.items.length) [bank.items[index], bank.items[next]] = [bank.items[next], bank.items[index]]; }
    if (action === 'delete') {
      assert(bank.defaultId !== id || bank.items.length === 1, 'DEFAULT_CONNECTION', '请先将另一个模型设为默认，再从本场景移除。');
      bank.items.splice(index, 1); if (bank.defaultId === id) bank.defaultId = '';
    }
  });
}
export async function publicConfig() {
  const value = await config(), profiles = new Map();
  for (const item of libraryItems(value)) profiles.set(item.id, { ...item.profile, hasKey: !!await getSecret(item.profile) });
  const modelLibrary = { version: 1, items: libraryItems(value).map(item => ({ id: item.id, profile: profiles.get(item.id), supportsSummary: supportsSummary(item.profile) })) };
  const modelConnections = Object.fromEntries(['translation','summary'].map(purpose => { const bank = connectionBank(value, purpose); return [purpose, { defaultId: bank.defaultId, items: bank.items.map(item => ({ ...item, profile: profiles.get(item.id) })) }]; }));
  return { ...value, modelLibrary, modelConnections, profile: profiles.get(value.profile.connectionId) || { ...value.profile, hasKey: false }, summaryProfile: { ...(profiles.get(value.summaryProfile.connectionId) || value.summaryProfile), hasKey: !!await getSummarySecret(value.summaryProfile), configured: !!value.summaryConfigured } };
}
async function clearIds(ids) {
  for (const area of [chrome.storage.local, chrome.storage.session]) {
    const map = { ...(await area.get(SHARED_CREDENTIALS))[SHARED_CREDENTIALS] };
    for (const id of ids) delete map[id];
    await area.set({ [SHARED_CREDENTIALS]: map });
    for (const old of oldCredentials) await area.remove(old);
  }
}
export const clearCredential = () => changeConfig(value => clearIds(connectionBank(value, 'translation').items.map(item => item.id)));
export const clearSummaryCredential = () => changeConfig(value => clearIds(connectionBank(value, 'summary').items.map(item => item.id)));
export const clearLibraryCredentials = () => changeConfig(value => clearIds(libraryItems(value).map(item => item.id)));
