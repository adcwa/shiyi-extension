import { assert, boundedText, pageOrigin, siteOrigin } from './core.js';

export const PAGE_MATCHES = Object.freeze(['http://*/*', 'https://*/*']);
export function blacklistSite(value) {
  const text = boundedText(value, 2048, '网站地址');
  let url;
  try { url = new URL(text.includes('://') ? text : `https://${text}`); } catch { assert(false, 'INVALID_SITE', '请填写有效的网站域名或网址。'); }
  assert(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password, 'INVALID_SITE', '请填写普通网站域名或网址，不包含账号和密码。');
  url.hostname = url.hostname.replace(/\.$/, '');
  siteOrigin(url.origin);
  return url.hostname.toLowerCase();
}
export const domainMatches = (host, site) => host === site || host.endsWith(`.${site}`);
export function cleanBlacklist(values) {
  const sites = [];
  for (const value of Array.isArray(values) ? values : []) {
    try { sites.push(blacklistSite(value)); } catch { /* Discard invalid legacy rules without changing other data. */ }
  }
  const unique = [...new Set(sites)].sort((a, b) => a.length - b.length || a.localeCompare(b));
  return unique.filter((site, index) => !unique.slice(0, index).some(parent => domainMatches(site, parent)));
}
export function blockingSite(url, blacklist) {
  if (!pageOrigin(url)) return null;
  const host = new URL(url).hostname.toLowerCase();
  return blacklist.find(site => domainMatches(host, site)) || null;
}
export function changeBlacklist(blacklist, input, blocked) {
  const site = blacklistSite(input);
  const next = blocked ? cleanBlacklist([...blacklist, site]) : blacklist.filter(item => item !== site);
  assert(next.length <= 200, 'SITE_LIMIT', '黑名单最多保存 200 个域名，请先整理。');
  return next;
}
export function migrateSitePolicy(value = {}) {
  const blacklist = value.sitePolicy === 'blacklist' ? value.blacklist : (Array.isArray(value.sites) ? value.sites.filter(site => site?.enabled === false).map(site => site.origin) : []);
  const next = { ...value, version: 2, sitePolicy: 'blacklist', blacklist: cleanBlacklist(blacklist) };
  delete next.sites;
  return next;
}
