// Serialized into the top frame's isolated world by chrome.scripting.
export function extractSummaryPage() {
  if (document.contentType === 'application/pdf') return { error: '浏览器内置 PDF 暂不支持，请打开可阅读的网页正文。' };
  const skip = 'script,style,noscript,template,svg,canvas,iframe,input,textarea,select,button,nav,footer,aside,[hidden],[aria-hidden="true"],[contenteditable]:not([contenteditable="false"]),[data-shiyi-root],[data-shiyi-meaning],[data-shiyi-block-translation]';
  // TreeWalker never applies its filter to the root. Validate the chosen root
  // and every ancestor before walking, otherwise hidden articles or editable
  // mains can bypass the exclusions and expose drafts to the model.
  function eligible(root) {
    if (!root || root.closest(skip)) return false;
    for (let node = root; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || style.contentVisibility === 'hidden') return false;
    }
    return root.getClientRects().length > 0;
  }
  const scope = [...document.querySelectorAll('article'), ...document.querySelectorAll('main,[role="main"]')].find(root => eligible(root) && root.textContent.trim().length >= 20) || (eligible(document.body) ? document.body : null);
  if (!scope) return { error: '网页没有可读取的正文；隐藏内容和编辑区不会纳入总结。' };
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType === 1) {
        if (node.matches(skip)) return NodeFilter.FILTER_REJECT;
        const style = getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden' || style.contentVisibility === 'hidden') return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_SKIP;
      }
      return node.data.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    }
  });
  let node, owner, body = '', truncated = false, nodes = 0;
  while ((node = walker.nextNode())) {
    if (++nodes > 30000 || body.length >= 60000) { truncated = true; break; }
    const text = globalThis.ShiyiPageSource?.text(node) ?? node.data;
    const block = node.parentElement.closest('p,li,h1,h2,h3,h4,h5,h6,pre,blockquote,tr,dt,dd,div,section,article,main');
    if (owner && block !== owner) body += '\n';
    body += text.replace(/[\t\r ]+/g, ' '); owner = block;
  }
  if (body.length > 60000) { body = body.slice(0, 60000); truncated = true; }
  return { title: document.title.slice(0, 240), url: location.href, text: body.trim(), chars: body.trim().length, truncated, scope: scope === document.body ? '当前网页可读内容' : '当前网页主要正文' };
}
