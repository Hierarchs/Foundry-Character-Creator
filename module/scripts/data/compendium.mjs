/**
 * Compendium access. Everything the wizard offers comes from the world's Item compendiums,
 * including premium content modules and D&D Beyond imports, so nothing is hard-coded.
 *
 * If the GM picked packs in the Content Sources menu, only those are used (per category, falling back
 * to everything when the picked packs have none of that type). Otherwise indexes are fetched through
 * dnd5e's CompendiumBrowser, so its "Compendium Browser Sources" configuration applies.
 */
import { contentRules, setting, worldRules } from "../utils.mjs";

/** Extra index fields per dnd5e item type. */
const INDEX_FIELDS = {
  class: [
    "system.identifier", "system.hd.denomination", "system.spellcasting.progression",
    "system.spellcasting.ability", "system.primaryAbility", "system.source"
  ],
  subclass: ["system.identifier", "system.classIdentifier", "system.spellcasting.progression", "system.source"],
  background: ["system.identifier", "system.source"],
  race: ["system.identifier", "system.source", "system.type"],
  spell: [
    "system.identifier", "system.level", "system.school", "system.properties", "system.activation",
    "system.range", "system.duration", "system.source"
  ],
  weapon: ["system.identifier", "system.type", "system.rarity", "system.price", "system.properties", "system.source"],
  equipment: ["system.identifier", "system.type", "system.rarity", "system.price", "system.source"],
  tool: ["system.identifier", "system.type", "system.rarity", "system.price", "system.source"]
};

/** @type {Map<string, Promise<object[]>>} */
const indexCache = new Map();
/** @type {Map<string, Promise<Item>>} */
const docCache = new Map();

export function clearCompendiumCache() {
  indexCache.clear();
  docCache.clear();
}

/** The edition filter in effect: "2024", "2014", or "all". */
export function activeRules() {
  const mode = setting("contentRules");
  return mode === "auto" ? worldRules() : mode;
}

function slug(name) {
  if ( globalThis.dnd5e?.utils?.formatIdentifier ) return dnd5e.utils.formatIdentifier(name);
  return String(name).slugify?.({ strict: true }) ?? String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function packFor(uuid) {
  const parts = String(uuid).split(".");
  if ( parts[0] !== "Compendium" ) return null;
  return game.packs.get(`${parts[1]}.${parts[2]}`) ?? null;
}

/** Packs the GM chose in the Content Sources menu (empty = use dnd5e's Compendium Browser sources). */
export function selectedPacks() {
  return (setting("packs") ?? []).map(id => game.packs.get(id)).filter(p => p && (p.metadata.type === "Item"));
}

async function fetchFromPacks(packs, type, fields) {
  const results = [];
  for ( const pack of packs ) {
    const index = await pack.getIndex({ fields: Array.from(fields) });
    for ( const entry of index ) {
      if ( entry.type !== type ) continue;
      entry.uuid ??= `Compendium.${pack.collection}.Item.${entry._id}`;
      results.push(entry);
    }
  }
  return results.sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
}

/** @returns {Promise<{ list: object[], explicit: boolean }>} */
async function fetchIndex(type) {
  const fields = new Set(INDEX_FIELDS[type] ?? ["system.identifier", "system.source"]);
  // Use the GM's chosen packs; any category they don't cover falls back to every source.
  const chosen = selectedPacks();
  if ( chosen.length ) {
    const list = await fetchFromPacks(chosen, type, fields);
    if ( list.length ) return { list, explicit: true };
  }
  const Browser = globalThis.dnd5e?.applications?.CompendiumBrowser;
  const list = Browser?.fetch
    ? await Browser.fetch(Item, { types: new Set([type]), indexFields: fields, sort: true })
    : await fetchFromPacks(game.packs.filter(p => (p.metadata.type === "Item") && p.visible), type, fields);
  return { list, explicit: false };
}

/**
 * @typedef GenesisEntry
 * @property {string} uuid
 * @property {string} name
 * @property {string} img
 * @property {string} type         dnd5e item type
 * @property {string} identifier
 * @property {string} rules        "2024", "2014", or ""
 * @property {string} book         Source book or compendium label
 * @property {string} packId
 * @property {boolean} isSystem    Comes from the dnd5e system's own SRD packs
 * @property {object} index        Raw compendium index entry
 */

function normalize(entry) {
  const pack = packFor(entry.uuid);
  const packageType = pack?.metadata.packageType;
  return {
    uuid: entry.uuid,
    name: entry.name,
    img: entry.img,
    type: entry.type,
    identifier: entry.system?.identifier || slug(entry.name),
    rules: contentRules(entry),
    book: entry.system?.source?.book || pack?.metadata.label || "",
    packId: pack?.collection ?? "",
    isSystem: (packageType === "system") || (pack?.metadata.packageName === "dnd5e"),
    index: entry
  };
}

function filterEntries({ entries, explicit }) {
  // Packs the GM picked by hand are shown whole; the edition filter only trims the fallback sources.
  const rules = explicit ? "all" : activeRules();
  let list = entries.filter(e => (rules === "all") || !e.rules || (e.rules === rules));

  // Premium books usually reprint the SRD; prefer the richer copy when both are present.
  if ( setting("hideSrdDuplicates") ) {
    const keyOf = e => `${e.type}:${e.identifier}:${e.rules}:${e.index.system?.classIdentifier ?? ""}`;
    const premium = new Set(list.filter(e => !e.isSystem).map(keyOf));
    list = list.filter(e => !e.isSystem || !premium.has(keyOf(e)));
  }

  const seen = new Set();
  return list.filter(e => {
    const key = `${e.type}:${e.identifier}:${e.rules}:${e.book}:${e.index.system?.classIdentifier ?? ""}`;
    if ( seen.has(key) ) return false;
    seen.add(key);
    return true;
  });
}

/**
 * All usable entries of one dnd5e item type, filtered by edition and de-duplicated.
 * @param {string} type
 * @returns {Promise<GenesisEntry[]>}
 */
export async function getEntries(type) {
  if ( !indexCache.has(type) ) {
    const promise = fetchIndex(type).then(({ list, explicit }) => ({ entries: list.map(normalize), explicit }));
    promise.catch(() => indexCache.delete(type));
    indexCache.set(type, promise);
  }
  return filterEntries(await indexCache.get(type));
}

export async function getSubclasses(classIdentifier) {
  return (await getEntries("subclass")).filter(e => e.index.system?.classIdentifier === classIdentifier);
}

/** Load (and cache) a full document. */
export function getDocument(uuid) {
  if ( !uuid ) return Promise.resolve(null);
  if ( !docCache.has(uuid) ) {
    const promise = fromUuid(uuid);
    promise.catch(() => docCache.delete(uuid));
    docCache.set(uuid, promise);
  }
  return docCache.get(uuid);
}

/** The level at which a class grants its subclass (from its Subclass advancement), or null. */
export function subclassLevel(classDoc) {
  const advancement = classDoc?.advancement?.byType?.Subclass?.[0];
  return advancement?.level ?? advancement?.levels?.[0] ?? null;
}

/* -------------------------------------------- */
/*  Spells                                      */
/* -------------------------------------------- */

async function spellListsReady(timeout=10000) {
  const registry = globalThis.dnd5e?.registry?.spellLists;
  if ( !registry ) return null;
  const start = Date.now();
  while ( !registry.ready && ((Date.now() - start) < timeout) ) {
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  return registry;
}

/**
 * Spells on a registered dnd5e spell list (e.g. `class:wizard`), matched by UUID or identifier so
 * that premium reprints of SRD spells are found too.
 * @returns {Promise<{ spells: GenesisEntry[], fromList: boolean }>}
 */
export async function getSpellsForList(identifier, type="class") {
  const all = await getEntries("spell");
  const registry = await spellListsReady();
  const list = registry?.forType?.(type, identifier);
  if ( !list ) return { spells: all, fromList: false };
  const uuids = list.uuids;
  const identifiers = list.identifiers;
  const spells = all.filter(s => uuids.has(s.uuid) || identifiers.has(s.identifier));

  // Collapse identical spells from different packs, preferring the one the list itself references.
  const best = new Map();
  for ( const spell of spells ) {
    const current = best.get(spell.identifier);
    if ( !current || (uuids.has(spell.uuid) && !uuids.has(current.uuid)) ) best.set(spell.identifier, spell);
  }
  return { spells: Array.from(best.values()).sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang)), fromList: true };
}

/* -------------------------------------------- */
/*  Equipment categories                        */
/* -------------------------------------------- */

const CATEGORY_TYPES = { weapon: "weapon", armor: "equipment", tool: "tool" };
const ARMOR_TYPES = ["light", "medium", "heavy", "shield"];

function matchesCategory(category, key, entry) {
  const type = entry.index.system?.type?.value ?? "";
  switch ( category ) {
    case "weapon":
      if ( key === "sim" ) return type.startsWith("simple");
      if ( key === "mar" ) return type.startsWith("martial");
      if ( key ) return type === key;
      return type.startsWith("simple") || type.startsWith("martial");
    case "armor":
      return key ? type === key : ARMOR_TYPES.includes(type);
    case "tool":
      return key ? (type === key) || (entry.index.system?.type?.baseItem === key) : true;
    default:
      return false;
  }
}

/**
 * Items a player can pick for a starting-equipment category such as "any martial weapon".
 * @returns {Promise<{ uuid: string, name: string, img: string }[]>}
 */
export async function getCategoryOptions(category, key) {
  if ( category === "focus" ) {
    const ids = CONFIG.DND5E.focusTypes?.[key]?.itemIds ?? {};
    const groups = key ? [ids] : Object.values(CONFIG.DND5E.focusTypes ?? {}).map(f => f.itemIds ?? {});
    return groups.flatMap(g => Object.values(g)).map(uuid => {
      const index = fromUuidSync(uuid);
      return index ? { uuid, name: index.name, img: index.img } : null;
    }).filter(Boolean);
  }
  const itemType = CATEGORY_TYPES[category];
  if ( !itemType ) return [];
  return (await getEntries(itemType))
    .filter(e => !e.index.system?.rarity && matchesCategory(category, key, e))
    .map(e => ({ uuid: e.uuid, name: e.name, img: e.img }));
}
