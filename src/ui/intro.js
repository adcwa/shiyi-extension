export function enhanceIntroduction(scope = document, { embedded = false, installed = location.protocol === 'chrome-extension:', modelURL = 'options.html#model' } = {}) {
const root = scope.host || scope.documentElement, lifecycle = new AbortController(), cleanups = [];
const motionRoot = scope.host ? scope.querySelector('.intro-page') : root;
const listen = (target, type, handler) => target.addEventListener(type, handler, { signal: lifecycle.signal });
root.dataset.embedded = String(embedded);
if (installed) {
  scope.querySelectorAll('[data-start]').forEach(link => { link.href = modelURL; link.target = '_top'; });
  scope.querySelectorAll('[data-standalone-only]').forEach(node => { node.hidden = true; });
  scope.querySelectorAll('[data-installed-only]').forEach(node => { node.hidden = false; });
} else {
  scope.querySelectorAll('[data-package]').forEach(link => { link.href = location.protocol === 'file:' || location.pathname.includes('/src/') ? '../releases/dianyi-chrome-edge-0.14.2.zip' : 'downloads/dianyi-chrome-edge-0.14.2.zip'; });
}

const toggle = scope.querySelector('.menu-toggle'), menu = scope.getElementById('intro-menu');
let menuOpen = false, closing;
function setMenu(open, returnFocus = false) {
  if (!toggle || !menu) return;
  clearTimeout(closing); menuOpen = open;
  toggle.setAttribute('aria-expanded', String(open)); toggle.setAttribute('aria-label', open ? '关闭导航' : '打开导航');
  if (open) {
    menu.hidden = false; menu.inert = false;
    scope.querySelector('main').inert = true; scope.querySelector('footer').inert = true;
    requestAnimationFrame(() => menu.classList.add('open'));
  } else {
    menu.classList.remove('open'); menu.inert = true;
    scope.querySelector('main').inert = false; scope.querySelector('footer').inert = false;
    closing = setTimeout(() => { if (!menuOpen) menu.hidden = true; }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 500);
    if (returnFocus) toggle.focus();
  }
}
if (toggle) listen(toggle, 'click', () => setMenu(!menuOpen));
listen(scope, 'keydown', event => {
  if (!menuOpen) return;
  if (event.key === 'Escape') { event.preventDefault(); setMenu(false, true); }
  if (event.key === 'Tab') {
    const controls = [toggle, ...menu.querySelectorAll('a')], first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});
listen(scope, 'click', event => {
  const link = event.target.closest('a[href^="#"]'); if (!link) return;
  const id = link.getAttribute('href').slice(1), section = scope.getElementById(id); if (!section) return;
  if (menuOpen) setMenu(false);
  if (embedded) { event.preventDefault(); window.scrollTo({ top: section.getBoundingClientRect().top + scrollY - 24, behavior: 'instant' }); }
});

const reduced = matchMedia('(prefers-reduced-motion: reduce)');
if (!reduced.matches && 'IntersectionObserver' in window) {
  motionRoot.classList.add('has-motion');
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) { entry.target.classList.add('revealed'); observer.unobserve(entry.target); }
  }, { threshold: .08 });
  scope.querySelectorAll('.reveal').forEach(node => observer.observe(node)); cleanups.push(() => observer.disconnect());
  const words = [...scope.querySelectorAll('[data-word]')];
  let nextWord = 0, queueTime = 0;
  const wordObserver = new IntersectionObserver(entries => {
    const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => words.indexOf(a.target) - words.indexOf(b.target));
    for (const entry of visible) {
      const now = performance.now(), delay = Math.max(0, queueTime - now);
      setTimeout(() => { if (!lifecycle.signal.aborted) entry.target.classList.add('read'); }, delay);
      queueTime = Math.max(now, queueTime) + 80;
      nextWord++; wordObserver.unobserve(entry.target);
    }
    if (nextWord === words.length) wordObserver.disconnect();
  }, { rootMargin: '0px 0px -20% 0px', threshold: .5 });
  words.forEach(word => wordObserver.observe(word)); cleanups.push(() => wordObserver.disconnect());
  listen(reduced, 'change', event => { if (event.matches) motionRoot.classList.remove('has-motion'); });
}
if ('IntersectionObserver' in window) {
  const sectionObserver = new IntersectionObserver(entries => {
    const active = entries.filter(entry => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]; if (!active) return;
    scope.querySelectorAll('[data-section]').forEach(link => { if (link.dataset.section === active.target.id) link.setAttribute('aria-current', 'location'); else link.removeAttribute('aria-current'); });
  }, { rootMargin: '-15% 0px -55% 0px', threshold: 0 });
  ['why', 'reading', 'faq'].forEach(id => { const node = scope.getElementById(id); if (node) sectionObserver.observe(node); }); cleanups.push(() => sectionObserver.disconnect());
}

return () => { lifecycle.abort(); clearTimeout(closing); cleanups.forEach(work => work()); };
}
if (document.querySelector('#hero-title, .legal-page')) enhanceIntroduction();
