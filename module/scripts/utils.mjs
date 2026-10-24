import { MODULE_ID } from "./constants.mjs";

/** Localize a key under this module's namespace (`GENESIS.*`), with optional format data. */
export function t(key, data) {
  const full = key.startsWith("GENESIS.") ? key : `GENESIS.${key}`;
  return data ? game.i18n.format(full, data) : game.i18n.localize(full);
}

/** Localize an arbitrary key (dnd5e config labels are usually already localized). */
export function loc(key) {
  if ( !key ) return "";
  return game.i18n.has?.(key) ? game.i18n.localize(key) : key;
}

export function setting(key) {
  return game.settings.get(MODULE_ID, key);
}

export function escapeHTML(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Replace Foundry/dnd5e enricher syntax with its display text (or nothing). */
export function stripEnrichers(text) {
  return String(text ?? "")
    .replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1")
    .replace(/@\w+\[[^\]]*\](?:\{([^}]*)\})?/g, (_, label) => label ?? "")
    .replace(/\[\[\/?\w*\s*([^\]]*)\]\](?:\{([^}]*)\})?/g, (_, inner, label) => label ?? inner ?? "")
    .replace(/&\w+\[([^\]\s]+)[^\]]*\](?:\{([^}]*)\})?/g, (_, key, label) => label ?? key);
}

function parse(html) {
  const div = document.createElement("div");
  // Keep words in adjacent cells and blocks apart once tags are stripped.
  div.innerHTML = stripEnrichers(html).replace(/<\/(p|div|li|td|th|tr|h\d|table|ul|ol|section|aside)>|<br\s*\/?>/gi, " $&");
  div.querySelectorAll("script, style").forEach(el => el.remove());
  return div;
}

/** Strip HTML tags and collapse whitespace. */
export function plainText(html) {
  return (parse(html).textContent ?? "").replace(/\s+/g, " ").trim();
}

/**
 * First sentence (or two) of an item's description, for the cinematic tagline. Tables, headings,
 * and sidebars (e.g. a class's "Core Traits" table) are skipped in favour of the first real paragraph.
 */
export function tagline(html, maxLength=220) {
  const div = parse(html);
  div.querySelectorAll("table, h1, h2, h3, h4, h5, h6, aside, figure, .fvtt.advice").forEach(el => el.remove());
  const paragraph = Array.from(div.querySelectorAll("p"))
    .map(p => p.textContent.replace(/\s+/g, " ").trim())
    .find(p => p.length >= 40);
  const text = paragraph ?? (div.textContent ?? "").replace(/\s+/g, " ").trim();
  if ( !text ) return "";
  const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [text];
  let out = "";
  for ( const s of sentences ) {
    if ( (out + s).length > maxLength ) break;
    out += s;
  }
  out ||= `${text.slice(0, maxLength - 1)}…`;
  return out.trim();
}

/** The first <img> source inside some HTML, used to discover splash art in item descriptions. */
export function firstImage(html) {
  const match = String(html ?? "").match(/<img[^>]+src=["']([^"']+)["']/i);
  return match?.[1] ?? null;
}

export function isVideo(src) {
  return /\.(webm|mp4|m4v|ogv)(\?.*)?$/i.test(String(src ?? ""));
}

/** Turn plain text from a textarea into simple paragraphs for an HTML field. */
export function textToHTML(text) {
  return String(text ?? "").split(/\n{2,}/).map(p => p.trim()).filter(Boolean)
    .map(p => `<p>${escapeHTML(p).replace(/\n/g, "<br>")}</p>`).join("");
}

export function signed(n) {
  const v = Number(n) || 0;
  return v >= 0 ? `+${v}` : `${v}`;
}

export function debounce(fn, wait=150) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

/** Which rules edition a piece of content follows: "2024", "2014", or "" if it doesn't say. */
export function contentRules(entry) {
  const rules = foundry.utils.getProperty(entry, "system.source.rules");
  return rules ? String(rules) : "";
}

/** The edition the world plays by, from dnd5e's own setting. */
export function worldRules() {
  try {
    return game.settings.get("dnd5e", "rulesVersion") === "legacy" ? "2014" : "2024";
  } catch {
    return "2024";
  }
}

/** Find a label in a nested dnd5e trait config (languages and tools have `children`). */
export function traitLabel(config, key) {
  if ( !config ) return key;
  const direct = config[key];
  if ( direct ) return loc(direct.label ?? direct);
  for ( const value of Object.values(config) ) {
    if ( value?.children ) {
      const found = traitLabel(value.children, key);
      if ( found !== key ) return found;
    }
  }
  return key;
}

/**
 * Horizontally centre `item` inside its scroll container without touching any other ancestor
 * (Element#scrollIntoView would also scroll the fixed, overflow-hidden wizard itself).
 */
export function centerInScroller(scroller, item) {
  if ( !scroller || !item ) return;
  const s = scroller.getBoundingClientRect();
  const i = item.getBoundingClientRect();
  scroller.scrollLeft += (i.left + (i.width / 2)) - (s.left + (s.width / 2));
}

/**
 * Apply the theme setting as a `genesis-theme-<name>` class on the given elements (default: every open
 * wizard) and on the body, so dnd5e's advancement windows can follow the theme too.
 */
export function applyTheme(...elements) {
  const theme = setting("theme") || "cinematic";
  const targets = elements.length ? elements : Array.from(document.querySelectorAll(".character-genesis"));
  for ( const el of [...targets, document.body].filter(Boolean) ) {
    for ( const cls of Array.from(el.classList) ) if ( cls.startsWith("genesis-theme-") ) el.classList.remove(cls);
    el.classList.add(`genesis-theme-${theme}`);
  }
}

export function log(...args) {
  console.log("Character Genesis |", ...args);
}
