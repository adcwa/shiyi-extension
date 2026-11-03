(() => {
  'use strict';
  if (globalThis.ShiyiCompanion) return;
  function createSVG() {
    const ns = 'http://www.w3.org/2000/svg';
    const node = (tag, attrs, parent) => {
      const value = document.createElementNS(ns, tag);
      for (const [key, text] of Object.entries(attrs)) value.setAttribute(key, text);
      if (parent) parent.append(value); return value;
    };
    const svg = node('svg', { viewBox: '0 0 80 88', class: 'companion-cat', 'aria-hidden': 'true', focusable: 'false' });
    node('ellipse', { cx: '40', cy: '81', rx: '24', ry: '4', fill: '#173f3520', class: 'cat-shadow' }, svg);
    const cat = node('g', { class: 'cat-float' }, svg);
    node('path', { d: 'M57 65c20 4 18-21 8-15-5 3 2 7 3 4', fill: 'none', stroke: '#548f7a', 'stroke-width': '7', 'stroke-linecap': 'round', class: 'cat-tail' }, cat);
    node('path', { d: 'M23 54c-7 9-7 21 1 24h32c8-4 8-15 0-24Z', fill: '#e8f2e8', stroke: '#2b6655', 'stroke-width': '2' }, cat);
    node('ellipse', { cx: '40', cy: '67', rx: '11', ry: '10', fill: '#fffaf0' }, cat);
    node('path', { d: 'M18 29 16 9c0-3 3-4 5-2l13 11h13L59 7c2-2 5-1 5 2l-2 20c12 22-1 34-22 34S6 50 18 29Z', fill: '#fff2d8', stroke: '#2b6655', 'stroke-width': '2', 'stroke-linejoin': 'round' }, cat);
    node('path', { d: 'm20 14 2 12 8-5Zm40 0-2 12-8-5Z', fill: '#e9b7a0' }, cat);
    const eyes = node('g', { class: 'cat-eyes' }, cat);
    node('ellipse', { cx: '29', cy: '38', rx: '2.5', ry: '3.5', fill: '#234b40' }, eyes);
    node('ellipse', { cx: '51', cy: '38', rx: '2.5', ry: '3.5', fill: '#234b40' }, eyes);
    node('path', { d: 'm36 46 4 3 4-3M40 49v3m-6 0q6 5 12 0', fill: 'none', stroke: '#9a6a59', 'stroke-width': '1.7', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, cat);
    node('path', { d: 'm21 44-9-2m10 6-10 1m47-5 9-2m-10 6 10 1', fill: 'none', stroke: '#9baf9d', 'stroke-width': '1.5', 'stroke-linecap': 'round' }, cat);
    node('path', { d: 'M23 69q-5 7 0 10h9q4-5-1-9', fill: '#fff2d8', stroke: '#2b6655', 'stroke-width': '1.8', 'stroke-linecap': 'round' }, cat);
    node('path', { d: 'M48 70q-4 6 1 9h9q5-5-2-10', fill: '#fff2d8', stroke: '#2b6655', 'stroke-width': '1.8', 'stroke-linecap': 'round', class: 'cat-paw' }, cat);
    node('path', { d: 'M35 66h10v9H35Z', fill: '#387d68', stroke: 'none', rx: '2' }, cat);
    node('path', { d: 'M38 69h4m-2-1v5m-2-2 2 2 2-2', fill: 'none', stroke: '#ffffff', 'stroke-width': '1.2', 'stroke-linecap': 'round' }, cat);
    return svg;
  }
  const styles = `
.companion{pointer-events:auto;position:fixed;right:18px;bottom:16px;width:32px;height:36px;color:#263735;font:12px/1.65 -apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;text-align:left;letter-spacing:normal}
.pet-button{display:grid;place-items:center;width:32px;height:36px;padding:0;border:0;border-radius:18px;background:transparent!important;cursor:pointer;filter:drop-shadow(0 2px 3px #17392712)}
.pet-button .companion-cat{width:24px;height:26.6667px;overflow:visible;stroke:none;fill:none;flex-shrink:0}
.cat-float{animation:cat-breathe 4s ease-in-out infinite;transform-origin:40px 78px}.cat-eyes{animation:cat-blink 5.8s infinite;transform-origin:40px 38px}.cat-tail{animation:cat-tail 4.3s ease-in-out infinite;transform-origin:57px 65px}.pet-button:hover .cat-paw,.pet-button:focus-visible .cat-paw{animation:cat-wave .9s ease-in-out 2;transform-origin:50px 75px}
.pet-badge{position:absolute;top:2px;right:0;width:5px;height:5px;border-radius:50%;background:#3c8a73;pointer-events:none}
.pet-panel{position:absolute;right:0;bottom:45px;width:320px;max-width:calc(100vw - 24px);max-height:calc(100vh - 82px);overflow:auto;padding:16px;background:#fff;border:1px solid #d5e1d7;border-radius:13px;box-shadow:0 10px 35px #17392722;animation:pet-open .16s ease-out}
.pet-top,.pet-modes,.pet-actions,.pet-footer{display:flex;align-items:center;gap:7px}.pet-top{justify-content:space-between;margin-bottom:14px}.pet-top strong{display:flex;align-items:center;gap:7px;font-size:14px;font-weight:600}.pet-panel button{font:inherit;min-height:36px;padding:7px 9px;border-radius:7px}.pet-top .pet-close{width:32px;min-height:32px;padding:6px;display:grid;place-items:center}.pet-modes{padding:3px;border:1px solid #e1e8df;border-radius:9px;margin-bottom:12px}.pet-modes button{flex:1;font-size:12px;white-space:nowrap}.pet-modes [aria-pressed=true]{color:#006665;background:#edf4ee}.pet-main{width:100%;justify-content:center;margin:2px 0 8px;min-height:40px!important}.pet-status,.pet-cache{font-size:11px;color:#607466;margin:8px 0;overflow-wrap:anywhere}.pet-cache{color:#477563}.pet-error{color:#9a3932;font-size:11px;line-height:1.8;margin:8px 0}.pet-actions{flex-wrap:wrap;margin-top:8px}.pet-actions button{font-size:11px;border:1px solid #dfe7de}.pet-panel progress{display:block;width:100%;height:4px;accent-color:#006665;margin:10px 0}.pet-footer{justify-content:space-between;border-top:1px solid #e8ede5;margin-top:13px;padding-top:7px}.pet-footer button{font-size:11px;color:#607466}.companion [hidden]{display:none!important}
@keyframes cat-breathe{0%,100%{transform:translateY(0)}50%{transform:translateY(-1.5px)}}@keyframes cat-blink{0%,43%,47%,100%{transform:scaleY(1)}45%{transform:scaleY(.1)}}@keyframes cat-tail{0%,100%{transform:rotate(-3deg)}50%{transform:rotate(7deg)}}@keyframes cat-wave{0%,100%{transform:rotate(0)}50%{transform:rotate(-18deg)}}@keyframes pet-open{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
@media(max-width:500px){.companion{right:12px;bottom:12px}.pet-panel{width:310px}}@media(prefers-reduced-motion:reduce){.cat-float,.cat-eyes,.cat-tail,.cat-paw,.pet-panel{animation:none!important}}
`;
  globalThis.ShiyiCompanion = Object.freeze({ createSVG, styles });
})();
