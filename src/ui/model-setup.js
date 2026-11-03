import { DEFAULT_PROFILE, cleanProfile, secretIdentity } from '../lib/core.js';
import { DEFAULT_PROVIDER, PROVIDERS, presetProfile, translationModelInfo, translationModelLabel, isMTProfile } from '../lib/providers.js';
import { esc, icon } from './common.js';

export function initialModelDraft(profile) {
  const provider = profile.provider || (profile.endpoint ? 'custom' : DEFAULT_PROVIDER);
  if (!profile.endpoint && provider !== 'custom') return { ...presetProfile(provider, profile.region || 'cn'), apiKey: '', advancedOpen: false };
  return { ...DEFAULT_PROFILE, ...profile, provider, apiKey: '', advancedOpen: false };
}
export function collectModelDraft(form, previous) {
  const value = id => form.querySelector(`#${id}`)?.value;
  const manualModel = previous.provider !== 'custom' && value('model-id') === '__other__';
  return { ...previous, name: value('model-name'), endpoint: value('model-endpoint'), model: manualModel ? value('other-model') || '' : value('model-id'), manualModel,
    auth: previous.provider === 'custom' ? value('auth-type') : 'bearer', region: value('provider-region') || '',
    timeoutSeconds: Number(value('timeout')), rememberKey: form.querySelector('#remember-key').checked,
    apiKey: value('model-key'), advancedOpen: form.querySelector('#model-advanced').open };
}
export function useRecommendedModel(draft) {
  const preset = presetProfile(draft.provider, draft.region || 'cn');
  return preset ? { ...draft, model: preset.model, manualModel: false } : draft;
}
export function updateModelGuidance(form, draft) {
  const provider = PROVIDERS[draft.provider]; if (!provider) return;
  const info = translationModelInfo(draft.provider, draft.model), current = form.querySelector('#current-model'), badge = form.querySelector('.model-recommendation');
  if (current) current.textContent = draft.model || '待填写';
  if (badge) { badge.textContent = info?.recommended ? '推荐' : info ? '按需选择' : '自选模型'; badge.classList.toggle('green', info?.recommended === true); }
  const advice = info?.description || '使用你指定的型号，费用与能力以服务商为准。';
  if (form.querySelector('#current-model-advice')) form.querySelector('#current-model-advice').textContent = advice;
  if (form.querySelector('#model-advice')) form.querySelector('#model-advice').textContent = `${advice} 推荐项在前，无需为普通翻译选择复杂推理模型。`;
}
export function changeProvider(draft, provider) {
  if (provider === draft.provider) return draft;
  if (provider === 'custom') return { ...draft, provider, region: '', name: '自定义服务', auth: 'bearer', apiKey: '', rememberKey: false, advancedOpen: false };
  const preset = presetProfile(provider);
  if (!preset) throw new Error('请选择支持的厂家，或选择自定义服务。');
  return { ...preset, apiKey: '', advancedOpen: false };
}
export function changeRegion(draft, region) {
  const preset = presetProfile(draft.provider, region);
  if (!preset) throw new Error('请选择有效的服务地域。');
  return { ...draft, endpoint: preset.endpoint, region: preset.region, apiKey: '', rememberKey: false };
}
export function canReuseKey(draft, saved) {
  if (!saved.hasKey) return false;
  try { return secretIdentity(cleanProfile(draft)) === secretIdentity(saved); } catch { return false; }
}
export function modelForm(draft, saved) {
  const provider = PROVIDERS[draft.provider], custom = draft.provider === 'custom', reuse = canReuseKey(draft, saved);
  const keyRequired = draft.auth !== 'none' && !reuse;
  const region = provider?.regions?.[draft.region || 'cn'];
  const selectedModel = translationModelInfo(draft.provider, draft.model);
  const modelBadge = selectedModel?.recommended ? '<span class="tag green model-recommendation">推荐</span>' : `<span class="tag model-recommendation">${selectedModel ? '按需选择' : '自选模型'}</span>`;
  const modelAdvice = selectedModel?.description || '使用你指定的型号，费用与能力以服务商为准。';
  const knownModel = provider?.translationModels.some(item => item.id === draft.model);
  const choices = [...Object.entries(PROVIDERS).map(([id, item]) => ({ id, name: item.name, description: item.description })), { id: 'custom', name: '自定义服务', description: '其他厂家 / 本地模型' }];
  const endpointField = `<div class="form-row"><label for="model-endpoint">服务地址${custom ? '' : '（自动配置）'}</label><div><input class="input" id="model-endpoint" type="url" maxlength="2048" value="${esc(draft.endpoint)}" placeholder="https://your-model.example/v1" autocomplete="off" spellcheck="false" ${custom ? 'required' : 'readonly'}><p class="field-help">${custom ? '支持基础地址或完整 /chat/completions 地址；远端使用 HTTPS，本机回环地址可用 HTTP。' : '已使用厂家官方服务地址。代理、企业网关或其他地址请选择“自定义服务”。'}</p></div></div>`;
  const modelField = `<div class="form-row"><label for="model-id">${custom ? '模型名称' : '翻译模型'}</label><div>${custom ? `<input class="input" id="model-id" maxlength="160" value="${esc(draft.model)}" placeholder="填写服务商提供的模型名称" autocomplete="off" spellcheck="false" required>` : `<select class="input" id="model-id" aria-describedby="model-advice">${provider.translationModels.map(item => `<option value="${esc(item.id)}" ${!draft.manualModel && item.id === draft.model ? 'selected' : ''}>${esc(translationModelLabel(item))}</option>`).join('')}${!knownModel && !draft.manualModel && draft.model ? `<option value="${esc(draft.model)}" selected>${esc(draft.model)} · 当前模型</option>` : ''}<option value="__other__" ${draft.manualModel ? 'selected' : ''}>其他模型（手动填写）</option></select>${draft.manualModel ? `<label class="form-label other-model-label" for="other-model">模型名称</label><input class="input" id="other-model" value="${esc(draft.model)}" maxlength="160" placeholder="填写此厂家提供的模型标识" autocomplete="off" spellcheck="false" required>` : ''}`}<p class="field-help" id="model-advice">${custom ? '按服务商提供的模型标识填写。' : `${esc(modelAdvice)} 推荐项在前，无需为普通翻译选择复杂推理模型。`}</p></div></div>`;
  return `<form id="model-form"><section class="card model-setup-card"><fieldset id="model-controls" class="model-controls"><div class="section-title">${icon('cpu')}<h2>选择你熟悉的服务商。</h2></div><p class="section-description">常用厂家已配好地址和模型，填入自己的 Key 就能连接。</p><div class="provider-grid" role="group" aria-label="模型服务商">${choices.map(item => `<button type="button" class="provider-choice ${item.id === draft.provider ? 'active' : ''}" data-provider="${item.id}" aria-label="${esc(item.name)}" aria-pressed="${item.id === draft.provider}"><span class="provider-name">${esc(item.name)}<span class="provider-check">${icon('check')}</span></span><span class="provider-description">${esc(item.description)}</span></button>`).join('')}</div>${custom ? `<div class="custom-connection-fields">${endpointField}${modelField}<div class="form-row"><label for="auth-type">鉴权方式</label><select class="input" id="auth-type"><option value="bearer" ${draft.auth === 'bearer' ? 'selected' : ''}>API Key（Bearer）</option><option value="none" ${draft.auth === 'none' ? 'selected' : ''}>无需密钥（本地服务）</option></select></div></div>` : `<div class="provider-ready"><div class="provider-model-summary"><div class="provider-model-current"><span>当前模型</span><code id="current-model">${esc(draft.model || (draft.manualModel ? '待填写' : provider.model))}</code>${modelBadge}</div><p id="current-model-advice">${esc(modelAdvice)}</p>${draft.model !== provider.model ? '<button type="button" class="link-btn use-recommended" data-action="use-recommended-model">改用推荐模型</button>' : ''}${region ? `<small>当前地域：${esc(region.name)}；请使用该地域创建的 Key。</small>` : ''}<small>${isMTProfile(draft) ? '翻译专用模型，适合快速阅读。可在高级设置选择通用模型。' : '通用型号关闭深度思考，适合快速翻译。可在高级设置选择其他型号。'}</small></div></div>`}<div class="model-key-block"><div class="model-key-label"><label for="model-key">API Key</label></div><div class="model-key-entry"><div class="secret-field"><input type="password" class="input" id="model-key" maxlength="4096" autocomplete="off" spellcheck="false" placeholder="${reuse ? '已有匹配的密钥，留空沿用' : `粘贴你的${provider ? ' ' + provider.shortName : ''} API Key`}" ${draft.auth === 'none' ? 'disabled' : ''} ${keyRequired ? 'required' : ''}><button class="icon-btn" type="button" data-action="toggle-key" aria-label="显示或隐藏密钥">${icon('eye')}</button></div>${provider ? `<a class="model-key-link" href="${esc(provider.keyUrl)}" target="_blank" rel="noopener noreferrer">获取 Key ${icon('up')}</a>` : ''}</div><p class="field-help">${provider?.name === 'OpenAI' ? '请使用 OpenAI API 平台创建的 Key。' : '密钥只用于你选择的服务。'}${reuse ? saved.rememberKey ? ' 当前密钥已保存在本机。' : ' 当前密钥在本次浏览器会话中有效。' : ' 默认仅本次浏览器会话有效。'}</p><label class="check-label model-remember"><input type="checkbox" id="remember-key" ${draft.rememberKey ? 'checked' : ''}><span>在此浏览器长期记住密钥 <small>仅本机保存，不参与词库导出。</small></span></label></div><details id="model-advanced" class="model-advanced" ${draft.advancedOpen ? 'open' : ''}><summary>高级设置<span>${custom ? '连接名称、请求超时' : '模型、地域与连接参数'}</span></summary><div class="model-advanced-body">${provider?.regions ? `<div class="form-row"><label for="provider-region">服务地域</label><div><select class="input" id="provider-region">${Object.entries(provider.regions).map(([id, item]) => `<option value="${id}" ${id === (draft.region || 'cn') ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</select><p class="field-help">不同地域的 Key 不通用；切换后请填写对应 Key。其他地域或专属域名可使用自定义服务。</p></div></div>` : ''}${custom ? '' : modelField + endpointField}<div class="form-row"><label for="model-name">连接名称</label><input class="input" id="model-name" value="${esc(draft.name)}" placeholder="为这个连接起个名字" maxlength="40"></div><div class="form-row"><label for="timeout">请求超时</label><select class="input" id="timeout">${[5, 10, 20, 25].map(value => `<option value="${value}" ${value === draft.timeoutSeconds ? 'selected' : ''}>${value} 秒</option>`).join('')}</select></div><p class="field-help model-storage-note">浏览器本地存储不是安全密码保险箱。切换厂家时，尚未保存的 Key 会清空。</p></div></details><div class="test-result" id="connection-result" role="status" aria-live="polite"></div><div class="model-actions"><button class="btn primary" type="submit">${icon('check')}连接并保存</button><button class="btn subtle" type="button" data-action="test-model">仅测试连接 ${icon('arrow')}</button></div><p class="field-help model-test-note">会发送固定测试词检查连接，可能消耗少量额度；不发送网页正文。</p></fieldset></section></form>`;
}
