/**
 * A small stand-in for the parts of Foundry VTT V14 and dnd5e that Character Genesis touches, so the
 * wizard can be rendered and clicked through in an ordinary browser. Dev-only; never shipped.
 *
 * Data comes from dev/fixtures/srd.json (SRD 5.2, CC-BY-4.0). The advancement manager is a mock that
 * applies grants, saves, skills, languages, and hit points so the later steps have something to show.
 */

const MODULE_ID = "character-genesis";

/* -------------------------------------------- */
/*  Utilities                                   */
/* -------------------------------------------- */

const getType = v => (v === null ? "null" : Array.isArray(v) ? "Array" : v instanceof Set ? "Set"
  : (typeof v === "object" ? (v.constructor?.name === "Object" || !v.constructor ? "Object" : v.constructor.name) : typeof v));

function getProperty(obj, path) {
  return String(path).split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setProperty(obj, path, value) {
  const parts = String(path).split(".");
  let target = obj;
  for ( const p of parts.slice(0, -1) ) target = (target[p] ??= {});
  target[parts.at(-1)] = value;
  return true;
}
function expandObject(obj) {
  const out = {};
  for ( const [k, v] of Object.entries(obj) ) {
    const value = getType(v) === "Object" ? expandObject(v) : v;
    if ( k.includes(".") ) {
      const existing = getProperty(out, k);
      setProperty(out, k, getType(existing) === "Object" && getType(value) === "Object" ? mergeObject(existing, value) : value);
    } else out[k] = (getType(out[k]) === "Object" && getType(value) === "Object") ? mergeObject(out[k], value) : value;
  }
  return out;
}
function deepClone(v) {
  if ( v instanceof Set ) return new Set(v);
  if ( Array.isArray(v) ) return v.map(deepClone);
  if ( v && (typeof v === "object") && (getType(v) === "Object") ) {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deepClone(x)]));
  }
  return v;
}
function mergeObject(original, other={}, { inplace=true }={}) {
  const target = inplace ? original : deepClone(original);
  const source = Object.keys(other).some(k => k.includes(".")) ? expandObject(other) : other;
  for ( const [k, v] of Object.entries(source) ) {
    if ( (getType(v) === "Object") && (getType(target[k]) === "Object") ) mergeObject(target[k], v);
    else target[k] = deepClone(v);
  }
  return target;
}
const randomID = (n=16) => Array.from({ length: n }, () => "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[Math.floor(Math.random() * 62)]).join("");
const slugify = s => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
String.prototype.slugify ??= function() { return slugify(this); };
Math.clamp ??= (v, min, max) => Math.min(Math.max(v, min), max);

/* -------------------------------------------- */
/*  Hooks                                       */
/* -------------------------------------------- */

const hooks = new Map();
globalThis.Hooks = {
  on(name, fn) { hooks.set(name, [...(hooks.get(name) ?? []), { fn, once: false }]); },
  once(name, fn) { hooks.set(name, [...(hooks.get(name) ?? []), { fn, once: true }]); },
  call(name, ...args) {
    for ( const h of [...(hooks.get(name) ?? [])] ) {
      if ( h.once ) hooks.set(name, hooks.get(name).filter(x => x !== h));
      if ( h.fn(...args) === false ) return false;
    }
    return true;
  },
  callAll(name, ...args) {
    for ( const h of [...(hooks.get(name) ?? [])] ) {
      if ( h.once ) hooks.set(name, hooks.get(name).filter(x => x !== h));
      h.fn(...args);
    }
    return true;
  }
};

/* -------------------------------------------- */
/*  Templates                                   */
/* -------------------------------------------- */

const compiled = new Map();
async function loadTemplates(paths) {
  await Promise.all(paths.map(async path => {
    const text = await (await fetch(`/${path.replace(/^modules\/character-genesis/, "module")}`)).text();
    const fn = Handlebars.compile(text);
    compiled.set(path, fn);
    Handlebars.registerPartial(path, fn);
  }));
}
async function renderTemplate(path, data) {
  if ( !compiled.has(path) ) await loadTemplates([path]);
  return compiled.get(path)(data, { allowProtoPropertiesByDefault: true, allowProtoMethodsByDefault: true });
}
Handlebars.registerHelper("localize", (key, options) => {
  const hash = options?.hash ?? {};
  return Object.keys(hash).length ? game.i18n.format(key, hash) : game.i18n.localize(key);
});
Handlebars.registerHelper("eq", (a, b) => a === b);

/* -------------------------------------------- */
/*  ApplicationV2                               */
/* -------------------------------------------- */

const instances = new Map();
let zIndex = 100;

class ApplicationV2 {
  static DEFAULT_OPTIONS = { classes: [], tag: "div", window: { frame: true, positioned: true, title: "" }, actions: {}, position: {} };
  static RENDER_STATES = { NONE: 0, RENDERED: 2, CLOSED: -1 };

  constructor(options={}) {
    const chain = [];
    for ( let cls = this.constructor; cls && (cls !== Object); cls = Object.getPrototypeOf(cls) ) {
      if ( Object.hasOwn(cls, "DEFAULT_OPTIONS") ) chain.unshift(cls.DEFAULT_OPTIONS);
    }
    this.options = { classes: [], actions: {}, window: {}, position: {} };
    for ( const o of [...chain, options] ) {
      for ( const [k, v] of Object.entries(o) ) {
        if ( Array.isArray(this.options[k]) ) this.options[k] = [...this.options[k], ...(v ?? [])];
        else if ( getType(this.options[k]) === "Object" && getType(v) === "Object" ) this.options[k] = { ...this.options[k], ...v };
        else this.options[k] = v;
      }
    }
    this.id = this.options.id ?? `app-${randomID(6)}`;
    this.state = 0;
    this.element = null;
    this._queue = Promise.resolve();
  }

  get rendered() { return this.state === 2; }
  get window() { return { title: this.options.window?.title }; }

  render(options={}, legacy) {
    if ( typeof options === "boolean" ) options = { force: options, ...(legacy ?? {}) };
    this._queue = this._queue.then(() => this._render(options)).catch(err => console.error(err));
    return this._queue.then(() => this);
  }

  async _render(options) {
    if ( (this.state === -1) && !options.force ) return;
    const first = !this.element;
    const parts = options.parts ?? Object.keys(this.constructor.PARTS ?? {});
    const context = await this._prepareContext(options);
    if ( first ) {
      const frame = this.options.window?.frame !== false;
      this.element = document.createElement(this.options.tag ?? "div");
      this.element.id = this.id;
      this.element.classList.add("application", ...this.options.classes);
      if ( frame ) {
        this.element.classList.add("window-app-v2");
        this.element.style.zIndex = ++zIndex;
        const pos = this.options.position ?? {};
        Object.assign(this.element.style, { width: `${pos.width ?? 500}px`, height: pos.height ? `${pos.height}px` : "", left: `${Math.max(20, (innerWidth - (pos.width ?? 500)) / 2)}px`, top: "60px" });
        this.element.innerHTML = `<header class="window-header"><h1 class="window-title">${game.i18n.localize(this.options.window?.title ?? "")}</h1><button type="button" data-action="close">✕</button></header><section class="window-content"></section>`;
      }
      this.element.addEventListener("click", this.#onClick.bind(this));
      document.body.append(this.element);
      instances.set(this.id, this);
    }
    const content = this.element.querySelector(".window-content") ?? this.element;
    const scroll = new Map();
    for ( const partId of parts ) {
      const prior = content.querySelector(`[data-application-part="${partId}"]`);
      for ( const sel of this.constructor.PARTS[partId].scrollable ?? [] ) {
        prior?.querySelectorAll(sel).forEach((el, i) => scroll.set(`${partId}|${sel}|${i}`, [el.scrollTop, el.scrollLeft]));
      }
      const partContext = await this._preparePartContext(partId, { ...context }, options);
      const html = await renderTemplate(this.constructor.PARTS[partId].template, partContext);
      const tpl = document.createElement("template");
      tpl.innerHTML = html.trim();
      const el = tpl.content.firstElementChild;
      el.dataset.applicationPart = partId;
      if ( prior ) prior.replaceWith(el);
      else content.append(el);
      for ( const sel of this.constructor.PARTS[partId].scrollable ?? [] ) {
        el.querySelectorAll(sel).forEach((x, i) => {
          const s = scroll.get(`${partId}|${sel}|${i}`);
          if ( s ) [x.scrollTop, x.scrollLeft] = s;
        });
      }
    }
    this.state = 2;
    if ( first ) await this._onFirstRender(context, options);
    await this._onRender(context, { ...options, parts });
    Hooks.callAll(`render${this.constructor.name}`, this, this.element, context, options);
  }

  #onClick(event) {
    const target = event.target.closest("[data-action]");
    if ( !target || !this.element.contains(target) ) return;
    const action = target.dataset.action;
    if ( action === "close" ) return this.close();
    const handler = this.options.actions?.[action];
    if ( handler ) return (handler.handler ?? handler).call(this, event, target);
    return this._onClickAction(event, target);
  }

  async _prepareContext() { return {}; }
  async _preparePartContext(partId, context) { return context; }
  async _onFirstRender() {}
  async _onRender() {}
  _onClickAction() {}
  _onClose() {}
  setPosition() {}
  bringToFront() { if ( this.element ) this.element.style.zIndex = ++zIndex; }

  async close(options={}) {
    if ( !this.element ) { this.state = -1; return this; }
    this.element.remove();
    this.state = -1;
    instances.delete(this.id);
    this._onClose(options);
    this.element = null;
    return this;
  }
}
const HandlebarsApplicationMixin = Base => class HandlebarsApplication extends Base {};

/** Dialogs resolve immediately in the harness (as if the player picked the default). */
const DialogV2 = {
  autoAnswer: true,
  async confirm({ content }={}) { console.info("[harness] confirm:", content); return this.autoAnswer; },
  async wait({ buttons }={}) { return (buttons.find(b => b.default) ?? buttons[0])?.action ?? null; },
  async prompt() { return null; }
};

class FilePicker {
  constructor(options) { this.options = options; }
  browse() {
    const path = prompt("[harness] image path or URL", this.options.current ?? "");
    if ( path !== null ) this.options.callback?.(path);
  }
}

/* -------------------------------------------- */
/*  Documents                                   */
/* -------------------------------------------- */

const fixtures = await (await fetch("/dev/fixtures/srd.json")).json();
// The module's own Birthsigns of Tamriel pack, straight from its source data.
const { birthsignItems } = await import("/tools/birthsigns.mjs");
for ( const item of birthsignItems() ) {
  fixtures.items.push({ ...item, uuid: `Compendium.character-genesis.birthsigns.Item.${item._id}`, pack: "character-genesis.birthsigns" });
}
const palette = ["#7a4b2a", "#2d5c7a", "#5c2d7a", "#2d7a4f", "#7a2d39", "#6b6b2d", "#2d6b6b", "#4f3d7a"];
function placeholderIcon(name) {
  let h = 0;
  for ( const c of name ) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const color = palette[h % palette.length];
  const initials = name.split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase();
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><defs><radialGradient id='g' cx='35%' cy='30%'><stop offset='0' stop-color='${color}' stop-opacity='1'/><stop offset='1' stop-color='#111'/></radialGradient></defs><rect width='64' height='64' fill='url(#g)'/><text x='32' y='41' font-family='Georgia,serif' font-size='24' fill='#f2d48a' text-anchor='middle'>${initials}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** Minimal EquipmentEntryData: children + generateLabel, enough for the equipment step. */
class EquipmentEntry {
  constructor(data, parent) { Object.assign(this, data); this.parent = parent; }
  get children() {
    return this.parent.startingEquipment.filter(e => e.group === this._id).sort((a, b) => a.sort - b.sort);
  }
  toObject() { const { parent, ...rest } = this; return deepClone(rest); }
  generateLabel({ depth=1 }={}) {
    const n = this.count > 1 ? `${this.count}× ` : "";
    switch ( this.type ) {
      case "AND": return this.children.map(c => c.generateLabel({ depth: depth + 1 })).filter(Boolean).join(", ");
      case "OR": return this.children.map((c, i) => `(${"abcdefg"[i]}) ${c.generateLabel({ depth: depth + 1 })}`).join(" or ");
      case "linked": return `${n}<a class="content-link">${byUuid.get(this.key)?.name ?? this.key}</a>`;
      case "currency": return `${this.count ?? 0} ${(this.key ?? "gp").toUpperCase()}`;
      default: return `${n || "any "}${this.key ?? ""} ${this.type}`.replace(/\s+/g, " ").trim();
    }
  }
}

class Advancement {
  constructor(data, item) { Object.assign(this, deepClone(data)); this.item = item; this.configuration ??= {}; this.value ??= {}; }
  get levels() { return [this.level ?? 1]; }
  get identifier() { return this.configuration.identifier || slugify(this.title ?? ""); }
  get actor() { return this.item.parent ?? null; }
  static metadata = { title: "Advancement" };
}

class Item {
  constructor(data, parent=null) {
    this._source = deepClone(data);
    Object.assign(this, deepClone(data));
    this.parent = parent;
    this.system ??= {};
    this.img = data.img && !/^(data:|modules\/)/.test(data.img) ? placeholderIcon(data.name) : data.img;
    this.prepare();
  }
  get id() { return this._id; }
  get identifier() { return this.system.identifier || slugify(this.name); }
  get documentName() { return "Item"; }
  get actor() { return this.parent; }
  prepare() {
    const list = Array.isArray(this.system.advancement) ? this.system.advancement : Object.values(this.system.advancement ?? {});
    const byType = {};
    const byLevel = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [i, []]));
    const byId = {};
    for ( const a of list.map(d => new Advancement(d, this)) ) {
      (byType[a.type] ??= []).push(a);
      byId[a._id] = a;
      if ( a.type === "ScaleValue" ) continue;
      const lvl = a.type === "HitPoints" ? 1 : (a.level ?? 1);
      byLevel[lvl]?.push(a);
    }
    this.advancement = { byType, byLevel, byId };
    const sc = this.system.spellcasting;
    if ( sc ) sc.preparation ??= {};
    if ( Array.isArray(this.system.startingEquipment) ) {
      this.system.startingEquipment = this.system.startingEquipment.map(e => new EquipmentEntry(e, this.system));
    }
    const labels = {};
    if ( this.type === "spell" ) {
      const a = this.system.activation ?? {};
      labels.activation = a.type ? `${a.value ?? 1} ${a.type}` : "";
      const r = this.system.range ?? {};
      labels.range = r.units === "self" ? "Self" : r.units === "touch" ? "Touch" : r.value ? `${r.value} ${r.units}` : "";
      const d = this.system.duration ?? {};
      labels.duration = d.units === "inst" ? "Instantaneous" : d.value ? `${d.value} ${d.units}` : (d.units ?? "");
      const props = new Set(this.system.properties ?? []);
      labels.components = { vsm: ["vocal", "somatic", "material"].filter(p => props.has(p)).map(p => p[0].toUpperCase()).join(", ") };
    }
    this.labels = labels;
  }
  get spellcasting() {
    const own = this.system.spellcasting;
    const sub = this.subclass?.system.spellcasting;
    return deepClone(sub && sub.progression !== "none" ? sub : own);
  }
  get subclass() {
    return this.parent?.items.find(i => i.type === "subclass" && i.system.classIdentifier === this.identifier) ?? null;
  }
  get class() {
    return this.parent?.items.find(i => i.type === "class" && i.identifier === this.system.classIdentifier) ?? null;
  }
  get isOriginalClass() { return this.parent?.system.details.originalClass === this.id; }
  get scaleValues() {
    const level = this.type === "class" ? this.system.levels : this.class?.system.levels ?? 0;
    const out = {};
    for ( const a of this.advancement.byType.ScaleValue ?? [] ) {
      const points = Object.entries(a.configuration.scale ?? {}).map(([l, v]) => [Number(l), v.value]).sort((x, y) => x[0] - y[0]);
      const hit = points.filter(([l]) => l <= level).at(-1);
      out[a.identifier] = hit ? { value: hit[1] } : null;
    }
    return out;
  }
  getFlag(scope, key) { return getProperty(this.flags ?? {}, `${scope}.${key}`); }
  toObject() { return deepClone(this._source); }
  get system_container() { return null; }
}
Item.implementation = Item;

const byUuid = new Map(fixtures.items.map(i => [i.uuid, i]));
const docCache = new Map();
globalThis.fromUuid = async uuid => {
  if ( !byUuid.has(uuid) ) return null;
  if ( !docCache.has(uuid) ) docCache.set(uuid, new Item(byUuid.get(uuid)));
  return docCache.get(uuid);
};
globalThis.fromUuidSync = uuid => {
  const d = byUuid.get(uuid);
  return d ? { name: d.name, img: placeholderIcon(d.name), uuid, system: d.system } : null;
};

function mod(score) { return Math.floor((Number(score) - 10) / 2); }

class Collection extends Map {
  get contents() { return Array.from(this.values()); }
  find(fn) { return this.contents.find(fn); }
  filter(fn) { return this.contents.filter(fn); }
  map(fn) { return this.contents.map(fn); }
  some(fn) { return this.contents.some(fn); }
  get size() { return super.size; }
}

class Actor {
  constructor(data={}) {
    this._source = deepClone(data);
    this.prepare();
  }
  prepare() {
    const data = this._source;
    this._id = data._id ?? null;
    this.name = data.name ?? "Actor";
    this.type = data.type ?? "character";
    this.img = data.img ?? "";
    this.flags = data.flags ?? {};
    this.ownership = data.ownership ?? {};
    this.items = new Collection();
    for ( const i of data.items ?? [] ) this.items.set(i._id, new Item(i, this));
    const sys = this.system = deepClone(data.system ?? {});
    sys.abilities ??= {};
    for ( const k of ["str", "dex", "con", "int", "wis", "cha"] ) {
      sys.abilities[k] ??= {};
      sys.abilities[k].value ??= 10;
      sys.abilities[k].mod = mod(sys.abilities[k].value);
      sys.abilities[k].proficient ??= 0;
    }
    sys.details ??= {};
    const classes = this.items.filter(i => i.type === "class");
    sys.details.level = classes.reduce((n, c) => n + (c.system.levels ?? 0), 0);
    sys.details.race = this.items.find(i => i.type === "race") ?? null;
    sys.details.background = this.items.find(i => i.type === "background") ?? null;
    sys.attributes ??= {};
    const level = sys.details.level || 1;
    let hp = 0;
    for ( const c of classes ) {
      const die = Number(String(c.system.hd?.denomination ?? "d8").slice(1));
      for ( let l = 1; l <= (c.system.levels ?? 0); l++ ) hp += (c.isOriginalClass && l === 1 ? die : die / 2 + 1) + sys.abilities.con.mod;
    }
    sys.attributes.hp = { ...(sys.attributes.hp ?? {}), max: Math.max(hp, 1) };
    sys.attributes.ac = { value: 10 + sys.abilities.dex.mod };
    sys.attributes.prof = 2 + Math.floor((level - 1) / 4);
    sys.attributes.movement = { walk: sys.details.race?.system.movement?.walk ?? 30, units: "ft" };
    sys.attributes.init = { total: sys.abilities.dex.mod };
    sys.skills ??= {};
    sys.traits ??= {};
    for ( const t of ["languages", "weaponProf", "armorProf"] ) sys.traits[t] = { value: new Set(sys.traits[t]?.value ?? []) };
    sys.tools ??= {};
    for ( const c of classes ) {
      for ( const [k, v] of Object.entries(c.scaleValues) ) setProperty(sys, `scale.${c.identifier}.${k}`, v);
      if ( c.system.spellcasting ) c.system.spellcasting.preparation.max = Number(String(c.system.spellcasting.preparation?.formula ?? "").includes("max-prepared") ? c.scaleValues["max-prepared"]?.value : NaN);
    }
  }
  get id() { return this._id; }
  get uuid() { return `Actor.${this._id}`; }
  get isOwner() { return true; }
  get classes() { return Object.fromEntries(this.items.filter(i => i.type === "class").map(c => [c.identifier, c])); }
  get spellcastingClasses() {
    return Object.fromEntries(Object.entries(this.classes).filter(([, c]) => (c.spellcasting?.progression ?? "none") !== "none"));
  }
  clone() { return new this.constructor(deepClone(this._source)); }
  toObject() { return deepClone(this._source); }
  updateSource(changes) { mergeObject(this._source, changes); this.prepare(); }
  async deleteEmbeddedDocuments(_type, ids) {
    this._source.items = (this._source.items ?? []).filter(i => !ids.includes(i._id));
    this.prepare();
    return ids;
  }
  async createEmbeddedDocuments(_type, items) {
    for ( const i of items ) (this._source.items ??= []).push({ ...deepClone(i), _id: randomID() });
    this.prepare();
    console.info("[harness] createEmbeddedDocuments", items.map(i => i.name));
    return items;
  }
  addItem(data) {
    const item = { ...deepClone(data), _id: data._id ?? randomID() };
    (this._source.items ??= []).push(item);
    this.prepare();
    return item;
  }
  static async create(data) {
    const actor = new Actor({ ...data, _id: randomID() });
    game.actors.set(actor.id, actor);
    console.info("[harness] Actor.create", data);
    window.__lastCreated = data;
    return actor;
  }
  get sheet() { return { render: () => ui.notifications.info(`(harness) would open ${this.name}'s sheet`) }; }
}
Actor.implementation = Actor;

/* -------------------------------------------- */
/*  dnd5e mock                                  */
/* -------------------------------------------- */

class MockAdvancementManager {
  constructor(actor, options={}) {
    this.actor = actor;
    this.options = options;
    this.clone = actor.clone();
    this.steps = [];
    this.element = null;
  }
  get rendered() { return !!this.element; }

  static forNewItem(actor, itemData, options) {
    const m = new this(actor, options);
    const data = deepClone(itemData);
    data._id = randomID();
    const levels = data.type === "class" ? (data.system.levels ?? 1) : 0;
    if ( data.type === "class" && !m.clone._source.system?.details?.originalClass ) setProperty(m.clone._source, "system.details.originalClass", data._id);
    m.clone.addItem(data);
    m.item = data;
    m.levels = levels;
    m.steps = [{ type: "forward" }];
    return m;
  }

  /** Level an existing class on a saved (harness) actor; applies directly when completed. */
  static forLevelChange(actor, classId, delta, options) {
    const m = new this(actor, options);
    const cls = m.clone._source.items.find(i => i._id === classId);
    m.item = cls;
    m.levels = (cls?.system.levels ?? 0) + delta;
    m.levelChange = { classId, delta };
    m.steps = [{ type: "forward" }];
    return m;
  }

  /** Apply grants, traits, and the subclass from the item's advancements. */
  async #apply() {
    if ( this.levelChange ) {
      const cls = this.clone._source.items.find(i => i._id === this.levelChange.classId);
      cls.system.levels += this.levelChange.delta;
      this.clone.prepare();
      return;
    }
    const src = this.clone._source;
    const item = this.clone.items.get(this.item._id);
    const upTo = this.item.type === "class" ? this.levels : 20;
    const grantItems = [];
    for ( const [lvl, list] of Object.entries(item.advancement.byLevel) ) {
      if ( Number(lvl) > upTo ) continue;
      for ( const a of list ) {
        if ( a.type === "ItemGrant" ) {
          for ( const { uuid } of a.configuration.items ?? [] ) {
            const doc = byUuid.get(uuid);
            if ( doc ) grantItems.push({ ...deepClone(doc), _id: randomID() });
          }
        } else if ( a.type === "Trait" ) {
          const keys = [...(a.configuration.grants ?? [])];
          for ( const choice of a.configuration.choices ?? [] ) keys.push(...(choice.pool ?? []).filter(k => !k.endsWith("*")).slice(0, choice.count ?? 1));
          for ( const key of keys ) {
            const [trait, ...rest] = key.split(":");
            const leaf = rest.at(-1);
            if ( trait === "saves" ) setProperty(src, `system.abilities.${leaf}.proficient`, 1);
            else if ( trait === "skills" ) setProperty(src, `system.skills.${leaf}.value`, 1);
            else if ( trait === "languages" ) setProperty(src, "system.traits.languages.value", [...(getProperty(src, "system.traits.languages.value") ?? []), leaf]);
            else if ( trait === "weapon" ) setProperty(src, "system.traits.weaponProf.value", [...(getProperty(src, "system.traits.weaponProf.value") ?? []), leaf]);
            else if ( trait === "armor" ) setProperty(src, "system.traits.armorProf.value", [...(getProperty(src, "system.traits.armorProf.value") ?? []), leaf]);
          }
        } else if ( a.type === "Subclass" ) {
          const answer = await this.options.answers?.(a, Number(lvl));
          // The real wizard answers this through the flow patch; the mock reads the wizard state.
          const uuid = answer?.uuid ?? instances.get("character-genesis")?.draft?.subclass;
          const doc = byUuid.get(uuid);
          if ( doc ) grantItems.push({ ...deepClone(doc), _id: randomID(), system: { ...deepClone(doc.system), classIdentifier: item.identifier } });
        } else if ( a.type === "AbilityScoreImprovement" && this.item.type === "background" ) {
          const open = ["str", "dex", "con", "int", "wis", "cha"].filter(k => !(a.configuration.locked ?? []).includes(k));
          if ( open[0] ) setProperty(src, `system.abilities.${open[0]}.value`, (getProperty(src, `system.abilities.${open[0]}.value`) ?? 10) + 2);
          if ( open[1] ) setProperty(src, `system.abilities.${open[1]}.value`, (getProperty(src, `system.abilities.${open[1]}.value`) ?? 10) + 1);
        }
      }
    }
    src.items.push(...grantItems);
    this.clone.prepare();
  }

  async render() {
    await this.#apply();
    const el = this.element = document.createElement("div");
    el.className = "application genesis-advancement harness-manager";
    el.innerHTML = `<header class="window-header"><h1 class="window-title">Advancement — ${this.item.name}</h1></header>
      <section class="window-content"><p>(harness) dnd5e would ask for this item's choices here.</p>
      <p>Granted: ${this.clone.items.filter(i => i.type === "feat").map(i => i.name).join(", ") || "—"}</p>
      <footer><button type="button" data-x="cancel">Cancel</button> <button type="button" data-x="complete">Complete</button></footer></section>`;
    el.addEventListener("click", e => {
      const x = e.target.closest("[data-x]")?.dataset.x;
      if ( x === "complete" ) this.#complete();
      if ( x === "cancel" ) this.close();
    });
    document.body.append(el);
    if ( MockAdvancementManager.autoComplete ) setTimeout(() => this.#complete(), 150);
    return this;
  }

  #complete() {
    const updates = this.clone.toObject();
    if ( Hooks.call("dnd5e.preAdvancementManagerComplete", this, updates, updates.items, [], []) === false ) {
      return this.close({ skipConfirmation: true });
    }
    // Saved actor: write the clone back, like performBulkUpdate would.
    this.actor._source = updates;
    this.actor.prepare();
    Hooks.callAll("dnd5e.advancementManagerComplete", this);
    return this.close({ skipConfirmation: true });
  }

  async close() {
    this.element?.remove();
    this.element = null;
    return this;
  }
}
MockAdvancementManager.autoComplete = true;

const skillLabels = { acr: "Acrobatics", ani: "Animal Handling", arc: "Arcana", ath: "Athletics", dec: "Deception", his: "History", ins: "Insight", itm: "Intimidation", inv: "Investigation", med: "Medicine", nat: "Nature", prc: "Perception", prf: "Performance", per: "Persuasion", rel: "Religion", slt: "Sleight of Hand", ste: "Stealth", sur: "Survival" };

globalThis.dnd5e = {
  utils: { formatIdentifier: slugify },
  applications: {
    advancement: { AdvancementManager: MockAdvancementManager },
    CompendiumBrowser: {
      async fetch(_cls, { types=new Set() }={}) {
        return fixtures.items.filter(i => !types.size || types.has(i.type))
          .map(i => ({ uuid: i.uuid, name: i.name, img: i.img?.startsWith("modules/") ? i.img : placeholderIcon(i.name), type: i.type, system: deepClone(i.system), flags: deepClone(i.flags ?? {}) }))
          .sort((a, b) => a.name.localeCompare(b.name));
      }
    }
  },
  registry: {
    spellLists: {
      ready: true,
      forType(type, identifier) {
        const uuids = fixtures.spellLists[`${type}:${identifier}`];
        if ( !uuids ) return null;
        const set = new Set(uuids);
        return { uuids: set, identifiers: new Set(uuids.map(u => byUuid.get(u)?.system.identifier || slugify(byUuid.get(u)?.name ?? ""))) };
      }
    }
  },
  documents: {
    Trait: {
      keyLabel(key, { trait }={}) {
        const leaf = key.split(":").pop();
        if ( trait === "languages" || key.startsWith("languages") ) return leaf.charAt(0).toUpperCase() + leaf.slice(1);
        if ( key.startsWith("skills") ) return skillLabels[leaf] ?? leaf;
        return leaf.charAt(0).toUpperCase() + leaf.slice(1);
      },
      localizedList({ grants=[], choices=[] }) {
        const g = Array.from(grants).map(k => this.keyLabel(k));
        const c = choices.map(ch => `choose ${ch.count ?? 1} from ${(ch.pool ?? []).map(k => this.keyLabel(k)).join(", ")}`);
        return [...g, ...c].join("; ");
      }
    }
  }
};

/* -------------------------------------------- */
/*  Game, CONFIG, UI                            */
/* -------------------------------------------- */

const lang = await (await fetch("/module/lang/en.json")).json();
const dnd5eLabels = {
  "DND5E.Faith": "Faith", "DND5E.Gender": "Gender", "DND5E.Age": "Age", "DND5E.Height": "Height", "DND5E.Weight": "Weight",
  "DND5E.Eyes": "Eyes", "DND5E.Hair": "Hair", "DND5E.Skin": "Skin", "DND5E.Appearance": "Appearance",
  "DND5E.PersonalityTraits": "Personality Traits", "DND5E.Ideals": "Ideals", "DND5E.Bonds": "Bonds", "DND5E.Flaws": "Flaws"
};
const i18n = {
  lang: "en",
  has: key => getProperty(lang, key) !== undefined || key in dnd5eLabels,
  localize: key => (typeof getProperty(lang, key) === "string" ? getProperty(lang, key) : dnd5eLabels[key] ?? key),
  format: (key, data={}) => i18n.localize(key).replace(/{(\w+)}/g, (_, k) => data[k] ?? `{${k}}`),
  getListFormatter: opts => new Intl.ListFormat("en", opts)
};

const settings = new Map();
const settingDefs = new Map();
const users = [
  { id: "gm0000000000000a", name: "Gamemaster", isGM: true },
  { id: "plyr00000000000b", name: "Morgan", isGM: false },
  { id: "plyr00000000000c", name: "Sam", isGM: false }
];
users.activeGM = users[0];

globalThis.game = {
  ready: true,
  i18n,
  world: { id: "harness", title: "Harness World" },
  system: { id: "dnd5e", title: "Dungeons & Dragons Fifth Edition" },
  modules: new Map([[MODULE_ID, { id: MODULE_ID, active: true }]]),
  packs: new Collection([...new Set(fixtures.items.map(i => i.pack))].map(id => [id, {
    collection: id,
    visible: true,
    async getIndex() {
      return fixtures.items.filter(i => i.pack === id)
        .map(i => ({ _id: i._id, uuid: i.uuid, name: i.name, type: i.type, img: i.img?.startsWith("modules/") ? i.img : placeholderIcon(i.name), system: deepClone(i.system), flags: deepClone(i.flags ?? {}) }));
    },
    metadata: id.startsWith("character-genesis") ? { id, label: "Birthsigns of Tamriel", packageName: "character-genesis", packageType: "module", type: "Item" } : { id, label: `SRD 5.2 ${id.split(".")[1].replace("24", "")}`, packageName: "dnd5e", packageType: "system", type: "Item" }
  }])),
  folders: [],
  actors: new Collection(),
  items: { fromCompendium: doc => { const d = doc.toObject(); delete d._id; return d; } },
  users,
  user: { ...users[0], character: null, can: () => true, update: async () => {} },
  socket: { on() {}, emit(...a) { console.info("[harness] socket", ...a); } },
  settings: {
    register(ns, key, data) { settingDefs.set(`${ns}.${key}`, data); if ( !settings.has(`${ns}.${key}`) ) settings.set(`${ns}.${key}`, deepClone(data.default)); },
    registerMenu() {},
    get(ns, key) {
      if ( ns === "dnd5e" && key === "rulesVersion" ) return "modern";
      return deepClone(settings.get(`${ns}.${key}`));
    },
    async set(ns, key, value) { settings.set(`${ns}.${key}`, deepClone(value)); return value; }
  }
};

globalThis.CONFIG = {
  sounds: {},
  Item: { documentClass: Item, typeLabels: {} },
  DND5E: {
    abilities: {
      str: { label: "Strength", abbreviation: "str" }, dex: { label: "Dexterity", abbreviation: "dex" },
      con: { label: "Constitution", abbreviation: "con" }, int: { label: "Intelligence", abbreviation: "int" },
      wis: { label: "Wisdom", abbreviation: "wis" }, cha: { label: "Charisma", abbreviation: "cha" }
    },
    skills: Object.fromEntries(Object.entries(skillLabels).map(([k, label]) => [k, { label }])),
    alignments: { lg: "Lawful Good", ng: "Neutral Good", cg: "Chaotic Good", ln: "Lawful Neutral", tn: "True Neutral", cn: "Chaotic Neutral", le: "Lawful Evil", ne: "Neutral Evil", ce: "Chaotic Evil" },
    spellLevels: { 0: "Cantrip", 1: "1st Level", 2: "2nd Level", 3: "3rd Level", 4: "4th Level", 5: "5th Level", 6: "6th Level", 7: "7th Level", 8: "8th Level", 9: "9th Level" },
    spellSchools: { abj: { label: "Abjuration" }, con: { label: "Conjuration" }, div: { label: "Divination" }, enc: { label: "Enchantment" }, evo: { label: "Evocation" }, ill: { label: "Illusion" }, nec: { label: "Necromancy" }, trs: { label: "Transmutation" } },
    spellProgression: { none: { label: "None" }, full: { label: "Full Caster", type: "spell" }, half: { label: "Half Caster", type: "spell" }, third: { label: "Third Caster", type: "spell" }, artificer: { label: "Artificer", type: "spell" }, pact: { label: "Pact Magic", type: "pact" } },
    actorSizes: { tiny: { label: "Tiny" }, sm: { label: "Small" }, med: { label: "Medium" }, lg: { label: "Large" } },
    creatureTypes: { humanoid: { label: "Humanoid" } },
    itemProperties: { concentration: { label: "Concentration" }, ritual: { label: "Ritual" }, vocal: { abbreviation: "V" }, somatic: { abbreviation: "S" }, material: { abbreviation: "M" } },
    focusTypes: {},
    weaponProficienciesMap: { simpleM: "sim", simpleR: "sim", martialM: "mar", martialR: "mar" },
    armorProficienciesMap: { light: "lgt", medium: "med", heavy: "hvy", shield: "shl" },
    currencies: { gp: { abbreviation: "gp" } },
    defaultCurrency: "gp"
  }
};

globalThis.CONST = {
  DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 },
  TOKEN_DISPOSITIONS: { HOSTILE: -1, NEUTRAL: 0, FRIENDLY: 1 }
};

function notify(type, message) {
  const host = document.getElementById("notifications");
  const li = document.createElement("li");
  li.className = `notification ${type}`;
  li.textContent = message;
  host.append(li);
  setTimeout(() => li.remove(), 4000);
  console[type === "error" ? "error" : "info"](`[${type}]`, message);
}
globalThis.ui = {
  notifications: { info: m => notify("info", m), warn: m => notify("warning", m), error: m => notify("error", m) }
};

class Roll {
  constructor(formula) { this.formula = String(formula); }
  get isDeterministic() { return !/d\d/i.test(this.formula); }
  async evaluate() {
    const dice = [];
    const expr = this.formula.replace(/(\d*)d(\d+)/gi, (_, n, f) => {
      const results = Array.from({ length: Number(n || 1) }, () => ({ result: 1 + Math.floor(Math.random() * Number(f)) }));
      dice.push({ results });
      return results.reduce((s, r) => s + r.result, 0);
    });
    this.dice = dice;
    // eslint-disable-next-line no-new-func
    this.total = Function(`"use strict"; return (${expr.replace(/[^0-9+\-*/(). ]/g, "")})`)();
    return this;
  }
  async toMessage() {}
}
globalThis.Roll = Roll;
globalThis.ChatMessage = { implementation: { create: async d => console.info("[harness] chat", d), getSpeaker: () => ({}) } };
globalThis.Item = Item;
globalThis.Actor = Actor;

const TextEditor = {
  async enrichHTML(html) {
    return String(html ?? "")
      .replace(/@UUID\[[^\]]+\]\{([^}]+)\}/g, '<a class="content-link">$1</a>')
      .replace(/@UUID\[[^\]]*?([^.\]]+)\]/g, '<a class="content-link">$1</a>')
      .replace(/\[\[\/\w+\s+([^\]]+)\]\]/g, "$1")
      .replace(/&(Reference|Embed)\[[^\]]+\]/g, "")
      .replace(/<img[^>]*>/g, "");
  }
};

globalThis.foundry = {
  utils: {
    getProperty, setProperty, mergeObject, deepClone, expandObject, randomID, getType,
    getRoute: p => `/${p.replace(/^modules\/character-genesis/, "module")}`,
    isEmpty: o => !o || !Object.keys(o).length
  },
  applications: {
    api: { ApplicationV2, HandlebarsApplicationMixin, DialogV2 },
    handlebars: { loadTemplates, renderTemplate },
    instances,
    ux: { TextEditor: { implementation: TextEditor } },
    apps: { FilePicker: { implementation: FilePicker } }
  },
  documents: { collections: { CompendiumCollection: class {} } }
};

export { MockAdvancementManager, fixtures };
