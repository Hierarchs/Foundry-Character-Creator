/**
 * Harness helper: list layout faults in the open wizard. Text clipped by its own box, text spilling out
 * of its box, text drawn over an image or icon, and text drawn over other text.
 * Run from the console as `harness.audit()`.
 */

const visible = el => {
  const r = el.getBoundingClientRect();
  if ( (r.width < 1) || (r.height < 1) ) return false;
  // Ancestors count too: the gallery hero fades to opacity 0 while "Show all" is open.
  return el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
};

const describe = el => {
  const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2) : [];
  return [el.tagName.toLowerCase(), ...cls].join(".");
};

/** The part of `rect` left visible after every clipping ancestor (scrolled carousels, panels). */
function clipped(el, rect) {
  let { left, right, top, bottom } = rect;
  for ( let a = el.parentElement; a && (a !== document.body); a = a.parentElement ) {
    const cs = getComputedStyle(a);
    if ( (cs.overflowX === "visible") && (cs.overflowY === "visible") ) continue;
    const b = a.getBoundingClientRect();
    left = Math.max(left, b.left); right = Math.min(right, b.right);
    top = Math.max(top, b.top); bottom = Math.min(bottom, b.bottom);
  }
  return (right - left > 1) && (bottom - top > 1) ? { left, right, top, bottom } : null;
}

const overlaps = (a, b, inset=2) => (a.left < b.right - inset) && (b.left < a.right - inset)
  && (a.top < b.bottom - inset) && (b.top < a.bottom - inset);

/** Text rectangles of every visible text node under `root`. */
function textRects(root) {
  const rects = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while ( walker.nextNode() ) {
    const node = walker.currentNode;
    const text = node.textContent.trim();
    if ( !text || !node.parentElement || !visible(node.parentElement) ) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    for ( const r of range.getClientRects() ) {
      const shown = (r.width > 2) && (r.height > 2) && clipped(node.parentElement, r);
      if ( shown ) rects.push({ el: node.parentElement, r: shown, text: text.slice(0, 32) });
    }
  }
  return rects;
}

export function audit(root=document.querySelector(".character-genesis")) {
  if ( !root ) return ["wizard not open"];
  const issues = new Set();
  const viewport = innerWidth * innerHeight;

  for ( const el of root.querySelectorAll("*") ) {
    if ( !visible(el) ) continue;
    const ownText = [...el.childNodes].some(n => (n.nodeType === Node.TEXT_NODE) && n.textContent.trim());
    if ( !ownText ) continue;
    const cs = getComputedStyle(el);
    const scrolls = v => (v === "auto") || (v === "scroll");
    const wide = el.scrollWidth > el.clientWidth + 1;
    const tall = el.scrollHeight > el.clientHeight + 1;
    const label = `${describe(el)} "${el.textContent.trim().slice(0, 40)}"`;
    if ( wide && !scrolls(cs.overflowX) ) {
      const kind = cs.overflowX === "visible" ? "spills" : (cs.textOverflow === "ellipsis" ? "truncated" : "clipped");
      issues.add(`${kind} (x): ${label} ${el.scrollWidth}>${el.clientWidth}`);
    }
    if ( tall && !scrolls(cs.overflowY) && (cs.overflowY !== "visible") ) {
      issues.add(`clipped (y): ${label} ${el.scrollHeight}>${el.clientHeight}`);
    }
  }

  const texts = textRects(root);
  // Backdrops and other full-screen art are meant to sit behind text.
  const graphics = [...root.querySelectorAll("img, svg, i[class*='fa-']")]
    .filter(visible)
    .map(e => ({ e, r: clipped(e, e.getBoundingClientRect()) }))
    .filter(({ r }) => r && ((r.right - r.left) * (r.bottom - r.top) < viewport * 0.2));
  for ( const t of texts ) {
    for ( const g of graphics ) {
      if ( g.e.contains(t.el) || t.el.contains(g.e) ) continue;
      if ( overlaps(t.r, g.r) ) issues.add(`text over graphic: "${t.text}" (${describe(t.el)}) × ${describe(g.e)}`);
    }
  }
  for ( let i = 0; i < texts.length; i++ ) {
    for ( let j = i + 1; j < texts.length; j++ ) {
      const a = texts[i];
      const b = texts[j];
      if ( (a.el === b.el) || a.el.contains(b.el) || b.el.contains(a.el) ) continue;
      if ( overlaps(a.r, b.r) ) issues.add(`text over text: "${a.text}" × "${b.text}"`);
    }
  }
  return [...issues];
}
