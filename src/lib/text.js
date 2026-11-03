// Shared by the isolated content world and the service worker. No page globals or DOM access.
(() => {
  'use strict';
  if (globalThis.ShiyiText) return;
  const normalize = text => String(text).normalize('NFKC').replace(/\s+/gu, ' ').trim().toLowerCase();
  function isTargetLanguage(text, language, sourceLanguage = '') {
    if (language !== 'zh-CN') return false;
    if (/^(ja|ko)(-|$)/i.test(sourceLanguage)) return false;
    const value = String(text).replace(/⟦SHIYI_\d+⟧/g, '').replace(/https?:\/\/\S+/gi, '');
    if (/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(value)) return false;
    const han = (value.match(/\p{Script=Han}/gu) || []).length;
    if (!han || /[^\p{Script=Han}\p{Script=Latin}\P{Letter}]/u.test(value)) return false;
    // Brand names, API identifiers and acronyms do not turn Chinese prose into
    // an English paragraph. Remain conservative with short mixed-language text.
    const words = (value.match(/[A-Za-z][A-Za-z\d]*(?:[._-][A-Za-z\d]+)*/g) || [])
      .filter(word => !/^[A-Z\d]+$/.test(word) && !/[._-]|[a-z][A-Z]/.test(word));
    return words.length === 0 || words.length === 1 && han >= 3;
  }
  function mapped(text) {
    let value = '', offset = 0, wasSpace = false;
    const starts = [], ends = [];
    for (const point of text) {
      const end = offset + point.length;
      const folded = point.normalize('NFKC').toLowerCase();
      for (const char of folded) {
        if (/\s/u.test(char)) {
          if (wasSpace) { ends[ends.length - 1] = end; continue; }
          value += ' '; starts.push(offset); ends.push(end); wasSpace = true;
        } else {
          value += char;
          for (let i = 0; i < char.length; i++) { starts.push(offset); ends.push(end); }
          wasSpace = false;
        }
      }
      offset = end;
    }
    return { value, starts, ends };
  }
  const isSeparatedScript = char => /[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{Number}_]/u.test(char || '');
  const isWord = char => /[\p{Letter}\p{Mark}\p{Number}_]/u.test(char || '');
  function before(text, index) {
    if (index <= 0) return '';
    const c = text.charCodeAt(index - 1);
    return c >= 0xdc00 && c <= 0xdfff ? text.slice(index - 2, index) : text[index - 1];
  }
  const after = (text, index) => index >= text.length ? '' : String.fromCodePoint(text.codePointAt(index));
  function compile(entries) {
    const root = new Map();
    for (const entry of entries) {
      const key = normalize(entry.text);
      if (!key) continue;
      let node = root;
      for (let i = 0; i < key.length; i++) {
        if (!node.has(key[i])) node.set(key[i], new Map());
        node = node.get(key[i]);
      }
      node.entry = entry;
    }
    return root;
  }
  function find(text, trie) {
    const source = mapped(text), matches = [];
    for (let i = 0; i < source.value.length;) {
      let node = trie, end = i, best = null;
      for (let j = i; j < source.value.length; j++) {
        node = node.get(source.value[j]);
        if (!node) break;
        if (node.entry) {
          const startChar = after(source.value, i), endChar = before(source.value, j + 1);
          if ((!isSeparatedScript(startChar) || !isWord(before(source.value, i))) &&
              (!isSeparatedScript(endChar) || !isWord(after(source.value, j + 1)))) {
            best = node.entry; end = j + 1;
          }
        }
      }
      if (best) { matches.push({ start: source.starts[i], end: source.ends[end - 1], entry: best }); i = end; }
      else i++;
    }
    return matches;
  }
  Object.defineProperty(globalThis, 'ShiyiText', { value: Object.freeze({ normalize, isTargetLanguage, mapped, compile, find }), configurable: false });
})();
