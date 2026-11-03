// Isolated HTTP presentation fixture. Never bundled into the extension; uses
// empty synthetic settings and cannot read user extension storage or models.
import { DEFAULT_PREFS, DEFAULT_PROFILE, VERSION } from '../src/lib/core.js';
import { summaryPresetProfile, DEFAULT_SUMMARY_PREFS } from '../src/lib/summary-presets.js';
globalThis.chrome = {
  runtime: {
    getURL: path => new URL('/src/' + path, location.origin).href,
    onMessage: { addListener() {} },
    async sendMessage(message) {
      if (message.type === 'SHIYI/UI_STATE') return { ok: true, data: { version: VERSION, prefs: { ...DEFAULT_PREFS }, profile: { ...DEFAULT_PROFILE, hasKey: false }, summaryProfile: { ...summaryPresetProfile(), configured: false, hasKey: false }, summaryPrefs: { ...DEFAULT_SUMMARY_PREFS }, count: 0, blacklist: [], pageCache: { count: 0, bytes: 0 }, tab: null } };
      if (message.type === 'SHIYI/LIBRARY') return { ok: true, data: { entries: [] } };
      return { ok: false, error: { message: '这是隔离排版验收页面，不连接模型，也不修改浏览器数据。' } };
    }
  }
};
await import('../src/ui/options.js');
