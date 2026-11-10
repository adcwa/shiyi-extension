import { AppError } from './core.js';

export function createPronunciationDictionary({ fetchImpl = globalThis.fetch } = {}) {
  const shards = new Map();
  return async text => {
    if (typeof text !== 'string') return null;
    const word = text.trim().toLowerCase().replace(/’/g, "'");
    // Exact headwords only: do not invent pronunciations for a name or join
    // individual words into an apparently authoritative phrase transcription.
    if (word.length > 120 || !/^[a-z][a-z.'-]*$/.test(word)) return null;
    const letter = word[0];
    if (!shards.has(letter)) {
      const loading = Promise.resolve().then(async () => {
        const response = await fetchImpl(new URL(`../data/pronunciation/en-US/${letter}.json`, import.meta.url));
        if (!response.ok) throw new Error('Dictionary unavailable');
        const value = await response.json();
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid dictionary');
        return value;
      }).catch(() => {
        shards.delete(letter);
        throw new AppError('LOCAL_PRONUNCIATION_UNAVAILABLE', '本地读音数据暂时无法读取，请重新加载点译。仍可使用试听。');
      });
      shards.set(letter, loading);
    }
    const data = await shards.get(letter), ipa = Object.hasOwn(data, word) && data[word];
    if (!ipa) return null;
    if (typeof ipa !== 'string' || ipa.length > 160 || !ipa.startsWith('/') || !ipa.endsWith('/')) throw new AppError('LOCAL_PRONUNCIATION_UNAVAILABLE', '本地读音数据不完整，请重新加载点译。');
    const notes = ['ˈ 后的音节为主重音，ˌ 后的音节为次重音。'];
    if (ipa.includes(', ')) notes.push('词典列出多个读音，请结合词性和语境判断。');
    if (/[θð]/.test(ipa)) notes.push('/θ/、/ð/ 发音时舌尖轻触上下齿之间，气流从缝隙通过；/ð/ 需振动声带。');
    if (ipa.includes('ɹ')) notes.push('/ɹ/ 发音时舌头向后收，避免舌尖触到上腭。');
    return { available: true, british: '', american: ipa, syllables: '', explanation: notes.join('\n'), source: 'dictionary' };
  };
}

export const lookupPronunciation = createPronunciationDictionary();
