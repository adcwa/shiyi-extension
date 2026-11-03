import { AppError } from './core.js';

export const CODEX_HOST = 'com.dianyi.codex';
export async function connectionPermission(profile, chromeApi = chrome) {
  if (profile.provider === 'codex') return chromeApi.permissions.contains({ permissions: ['nativeMessaging'] });
  const url = new URL(profile.endpoint);
  return chromeApi.permissions.contains({ origins: [`${url.protocol}//${url.hostname}/*`] });
}
export function nativeCodex({ action = 'generate', model = 'auto', messages = [], timeoutSeconds = 60, signal, onDelta = () => {}, chromeApi = chrome }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new AppError('CANCELLED', '生成已停止。')); return; }
    let port, settled = false, output = '', timer;
    const finish = (error, result) => {
      if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      try { port?.disconnect(); } catch {}
      error ? reject(error) : resolve(result);
    };
    const abort = () => finish(new AppError('CANCELLED', '生成已停止。'));
    try {
      port = chromeApi.runtime.connectNative(CODEX_HOST);
      signal?.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => finish(new AppError('TIMEOUT', '本机 Codex 没有及时完成，请检查登录状态或选择更轻量的模型。')), (action === 'status' ? 20 : timeoutSeconds + 10) * 1000);
      port.onMessage.addListener(message => {
        if (settled) return;
        if (message?.type === 'delta' && typeof message.text === 'string') {
          output += message.text;
          if (output.length > 131072) { finish(new AppError('RESULT_TOO_LARGE', 'Codex 输出过长，已停止生成。')); return; }
          try { onDelta(message.text); } catch (error) { finish(error); }
        } else if (message?.type === 'done') finish(null, action === 'status' ? message.status : output || message.text || '');
        else if (message?.type === 'error') {
          const errors = {
            CODEX_AUTH: '本机 Codex 尚未登录或登录已过期。请在终端运行 codex login 后重试。',
            CODEX_UNAVAILABLE: '无法启动本机 Codex。请先安装 Codex CLI，并重新安装点译本机助手。',
            CODEX_PERMISSION: '本机助手尚未允许这个扩展 ID。请复制当前安装命令，重新安装点译本机助手。',
            CODEX_CAPABILITY: '当前 Codex 配置无法施加仅文本限制。请更新 Codex CLI，或改用 API Key 连接。',
            CODEX_TOOLS_BLOCKED: '本次请求尝试使用文本生成以外的工具，已停止。请缩小资料或调整提示词后重试。',
            TIMEOUT: '本机 Codex 处理超时，已停止任务。',
            CODEX_MODEL: '本机 Codex 无法使用此模型，请选择 auto 或当前账户可用的型号。',
            CODEX_FAILED: '本机 Codex 未能完成本次生成。请确认登录、模型权限及账户额度后重试。'
          };
          const code = Object.hasOwn(errors, message.code) ? message.code : 'CODEX_FAILED';
          finish(new AppError(code, errors[code]));
        }
      });
      port.onDisconnect.addListener(() => {
        // Consume lastError without exposing native process output or paths.
        void chromeApi.runtime.lastError;
        finish(new AppError('CODEX_UNAVAILABLE', '未连接到点译本机助手。请按安装指引完成一次安装，然后重新测试。'));
      });
      port.postMessage({ action, model, messages, timeoutSeconds });
    } catch { finish(new AppError('CODEX_PERMISSION', '请允许点译连接本机应用，再测试 Codex。')); }
  });
}

// Adapt the official native protocol to the same bounded parsing and rendering
// paths used by API connections. No auth token enters the extension or headers.
export function codexFetch(profile, { messages, stream }, signal, chromeApi) {
  if (!stream) return nativeCodex({ model: profile.model, messages, timeoutSeconds: profile.timeoutSeconds, signal, chromeApi }).then(text => new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { headers: { 'Content-Type': 'application/json' } }));
  const encoder = new TextEncoder(), task = new AbortController();
  const abort = () => task.abort();
  if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
  const body = new ReadableStream({
    start(controller) {
      nativeCodex({ model: profile.model, messages, timeoutSeconds: profile.timeoutSeconds, signal: task.signal, chromeApi,
        onDelta: text => controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`))
      }).then(() => { if (!task.signal.aborted) { controller.enqueue(encoder.encode('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')); controller.close(); } }, error => { if (!task.signal.aborted) controller.error(error); else if (signal?.aborted) controller.error(new AppError('CANCELLED', '生成已停止。')); }).finally(() => signal?.removeEventListener('abort', abort));
    },
    cancel() { task.abort(); signal?.removeEventListener('abort', abort); }
  });
  return Promise.resolve(new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }));
}
