import { DEFAULT_PREFS } from '../lib/core.js';
import { esc, icon } from './common.js';

const themes = {
  light: { label: '浅色页面', key: 'translationColorLight', paper: '#ffffff', colors: [['墨绿', '#245e4d'], ['青绿', '#006665'], ['蓝色', '#1d4ed8'], ['紫色', '#6d28d9'], ['棕色', '#92400e'], ['灰色', '#334155']] },
  dark: { label: '深色页面', key: 'translationColorDark', paper: '#1a2821', colors: [['浅绿', '#c1e7d5'], ['薄荷', '#99f6e4'], ['浅蓝', '#bfdbfe'], ['浅紫', '#ddd6fe'], ['浅金', '#fde68a'], ['浅灰', '#f1f5f9']] }
};
const validColor = value => typeof value === 'string' && /^#[a-f\d]{6}$/i.test(value);
function contrast(a, b) {
  const luminance = hex => {
    const channels = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
  };
  const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}
function colorEditor(theme, prefs) {
  const { label, key, colors, paper } = themes[theme], color = validColor(prefs[key]) ? prefs[key].toLowerCase() : DEFAULT_PREFS[key];
  return `<fieldset class="color-editor"><legend>${label}</legend><div class="color-controls"><input type="color" id="color-${theme}" value="${esc(color)}" aria-label="${label}取色器"><input class="input color-hex" id="color-${theme}-hex" type="text" value="${esc(color)}" aria-label="${label}颜色值" pattern="#[a-fA-F0-9]{6}" maxlength="7" required spellcheck="false" autocomplete="off"><button class="btn small subtle" type="button" data-reset-color="${theme}">恢复默认</button></div><div class="color-palette" role="group" aria-label="${label}调色板">${colors.map(([name, value]) => `<button type="button" class="color-swatch" style="--swatch:${value}" data-color-theme="${theme}" data-color-choice="${value}" aria-label="${label}：${name}" title="${name} ${value}" aria-pressed="${color === value}">${color === value ? icon('check') : ''}</button>`).join('')}</div><div class="reading-preview ${theme}" id="color-${theme}-preview" style="--preview-ink:${esc(color)}" aria-label="${label}颜色预览"><div class="preview-source">A quieter way to read.</div><div class="preview-translation">让阅读，从容一点。</div></div><p class="field-help color-hint" id="color-${theme}-hint" aria-live="polite">${contrast(color, paper) < 4.5 ? '文字与底色不易区分，可以换个颜色再比较。' : '颜色预览，不会发起翻译请求。'}</p></fieldset>`;
}
export function readingSettings(prefs) {
  return `<section class="card" id="reading-preferences-card"><div class="section-title">${icon('sliders')}<h2>翻译多少，用什么颜色。</h2></div><p class="section-description">按模型能力调整批次，用喜欢的颜色区分译文。</p><div class="form-row"><label for="batch-size">每批翻译块数</label><div><input class="input batch-size" id="batch-size" type="number" min="1" max="64" step="1" required value="${esc(String(prefs.batchSize ?? DEFAULT_PREFS.batchSize))}" aria-describedby="batch-size-help"><p class="field-help" id="batch-size-help">默认 16 块，可填 1–64。先显示当前位置的首个译文；文字较多或段落复杂时，会提前分批。</p></div></div><h3 class="reading-color-title">译文文字颜色</h3><p class="field-help">用于双语／按段译文、悬浮释义和括号释义。双语译文比原文小 2px，仅调整文字颜色。</p><div class="color-editors">${colorEditor('light', prefs)}${colorEditor('dark', prefs)}</div></section>`;
}
export function updateReadingColor(form, theme, value) {
  if (!themes[theme] || !validColor(value)) return false;
  const color = value.toLowerCase(), picker = form.querySelector(`#color-${theme}`), hex = form.querySelector(`#color-${theme}-hex`);
  picker.value = color; hex.value = color;
  form.querySelector(`#color-${theme}-preview`).style.setProperty('--preview-ink', color);
  form.querySelectorAll(`[data-color-theme="${theme}"]`).forEach(button => {
    const selected = button.dataset.colorChoice === color;
    button.setAttribute('aria-pressed', String(selected)); button.innerHTML = selected ? icon('check') : '';
  });
  form.querySelector(`#color-${theme}-hint`).textContent = contrast(color, themes[theme].paper) < 4.5 ? '文字与底色不易区分，可以换个颜色再比较。' : '颜色预览，不会发起翻译请求。';
  return true;
}
export function defaultReadingColor(theme) { return DEFAULT_PREFS[themes[theme]?.key]; }
