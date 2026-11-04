import { cleanProfile, DEFAULT_PROFILE } from './core.js';
import { cleanSummaryProfile, summaryPresetProfile } from './summary-presets.js';

export const MAX_LIBRARY_CONNECTIONS = 32;
export const supportsSummary = profile => {
  try { cleanSummaryProfile(profile); return true; } catch { return false; }
};
export const libraryItems = value => value.modelLibrary?.items || [];

// A connection has one identity and credential; scenes retain their own order.
export function synchronizeModels(value) {
  const library = new Map(libraryItems(value).map(item => [item.id, item]));
  value.modelConnections ||= {};
  for (const purpose of ['translation', 'summary']) {
    const previous = value.modelConnections[purpose] || { defaultId: '', items: [] };
    const items = previous.items.filter(item => library.has(item.id) && (purpose !== 'summary' || supportsSummary(library.get(item.id).profile)))
      .map(item => ({ id: item.id, backup: item.backup === true, profile: library.get(item.id).profile }));
    const primary = items.find(item => item.id === previous.defaultId);
    value.modelConnections[purpose] = { defaultId: primary?.id || '', items: primary ? [primary, ...items.filter(item => item.id !== primary.id)] : items };
    value[purpose === 'translation' ? 'profile' : 'summaryProfile'] = primary?.profile || (purpose === 'translation' ? { ...DEFAULT_PROFILE } : summaryPresetProfile());
    if (purpose === 'summary') value.summaryConfigured = !!primary;
  }
  return value;
}

export function migrateModels(value) {
  if (value.modelLibrary) return { value: synchronizeModels(value), legacy: [] };
  const items = [], legacy = [];
  for (const purpose of ['translation', 'summary']) {
    const field = purpose === 'translation' ? 'profile' : 'summaryProfile', profile = value[field];
    const available = !!profile?.endpoint && !!profile?.model && (purpose !== 'summary' || value.summaryConfigured);
    const bank = value.modelConnections?.[purpose] || { defaultId: available ? `${purpose}-primary` : '', items: available ? [{ id: `${purpose}-primary`, profile, backup: true }] : [] };
    const ids = new Map();
    for (const item of bank.items) {
      let id = item.id, suffix = 0;
      while (items.some(saved => saved.id === id)) id = `${purpose}-${item.id.slice(0, 55)}-${++suffix}`;
      const profile = cleanProfile({ ...item.profile, connectionId: id });
      items.push({ id, profile }); ids.set(item.id, id);
      legacy.push({ purpose, oldId: item.id, id, profile });
    }
    value.modelConnections ||= {};
    value.modelConnections[purpose] = { defaultId: ids.get(bank.defaultId) || '', items: bank.items.map(item => ({ id: ids.get(item.id), backup: item.backup === true })) };
  }
  value.modelLibrary = { version: 1, items };
  return { value: synchronizeModels(value), legacy };
}
