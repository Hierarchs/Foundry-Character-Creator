/**
 * Turn class / subclass / species / background documents into the facts and feature timeline shown
 * in the wizard's Details drawer. Everything is read from the item's own data and advancements.
 */
import { loc, plainText, t, tagline } from "../utils.mjs";

function enrich(html, doc) {
  const TextEditor = foundry.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
  return TextEditor.enrichHTML(html ?? "", { relativeTo: doc, secrets: false });
}

function abilityLabel(key) {
  return loc(CONFIG.DND5E.abilities?.[key]?.label ?? key);
}

function listFormat(values, type="conjunction") {
  const list = values.filter(Boolean);
  if ( !list.length ) return "";
  try {
    return game.i18n.getListFormatter({ type }).format(list);
  } catch {
    return list.join(", ");
  }
}

function itemName(uuid) {
  try {
    return fromUuidSync(uuid)?.name ?? null;
  } catch {
    return null;
  }
}

function keyLabel(key) {
  const Trait = globalThis.dnd5e?.documents?.Trait;
  try {
    return Trait?.keyLabel?.(key) ?? key.split(":").pop();
  } catch {
    return key.split(":").pop();
  }
}

/** Names of everything an item grants, grouped by level (levels with nothing to show are skipped). */
function timeline(doc, { minLevel=0 }={}) {
  const byLevel = doc.advancement?.byLevel ?? {};
  const rows = [];
  for ( const [level, advancements] of Object.entries(byLevel) ) {
    if ( Number(level) < minLevel ) continue;
    const names = [];
    for ( const adv of advancements ?? [] ) {
      switch ( adv.type ) {
        case "ItemGrant":
          for ( const { uuid } of adv.configuration?.items ?? [] ) names.push(itemName(uuid) ?? adv.title);
          break;
        case "ItemChoice":
        case "Subclass":
        case "AbilityScoreImprovement":
          names.push(adv.title || loc(adv.constructor.metadata?.title));
          break;
        default:
          break;
      }
    }
    const unique = Array.from(new Set(names.filter(Boolean)));
    if ( unique.length ) rows.push({ level: Number(level), names: unique.join(", ") });
  }
  return rows.sort((a, b) => a.level - b.level);
}

function traitGrants(doc, prefix) {
  const keys = [];
  for ( const adv of doc.advancement?.byType?.Trait ?? [] ) {
    for ( const grant of adv.configuration?.grants ?? [] ) if ( grant.startsWith(prefix) ) keys.push(grant);
  }
  return keys;
}

function traitSummary(doc) {
  const parts = [];
  for ( const adv of doc.advancement?.byType?.Trait ?? [] ) {
    try {
      const text = globalThis.dnd5e?.documents?.Trait?.localizedList?.({
        grants: adv.configuration.grants, choices: adv.configuration.choices
      });
      if ( text ) parts.push(text);
    } catch { /* Unknown trait keys from homebrew should not break the drawer. */ }
  }
  return parts.join("; ");
}

function classFacts(doc) {
  const sys = doc.system;
  const facts = [];
  const hd = sys.hd?.denomination ?? sys.hitDice;
  if ( hd ) facts.push({ label: t("Facts.HitDie"), value: String(hd).startsWith("d") ? hd : `d${hd}` });
  const primary = Array.from(sys.primaryAbility?.value ?? []);
  if ( primary.length ) facts.push({
    label: t("Facts.PrimaryAbility"),
    value: listFormat(primary.map(abilityLabel), sys.primaryAbility.all ? "conjunction" : "disjunction")
  });
  const saves = traitGrants(doc, "saves:").map(k => abilityLabel(k.split(":").pop()));
  if ( saves.length ) facts.push({ label: t("Facts.Saves"), value: listFormat(saves) });
  const progression = sys.spellcasting?.progression;
  if ( progression && (progression !== "none") ) {
    const prog = loc(CONFIG.DND5E.spellProgression?.[progression]?.label ?? progression);
    const ability = sys.spellcasting.ability ? ` (${abilityLabel(sys.spellcasting.ability)})` : "";
    facts.push({ label: t("Facts.Spellcasting"), value: `${prog}${ability}` });
  }
  return facts;
}

function speciesFacts(doc) {
  const sys = doc.system;
  const facts = [];
  const type = sys.type?.value;
  if ( type ) facts.push({ label: t("Facts.CreatureType"), value: loc(CONFIG.DND5E.creatureTypes?.[type]?.label ?? type) });
  const sizes = Array.from(doc.advancement?.byType?.Size?.[0]?.configuration?.sizes ?? []);
  if ( sizes.length ) facts.push({
    label: t("Facts.Size"),
    value: listFormat(sizes.map(s => loc(CONFIG.DND5E.actorSizes?.[s]?.label ?? s)), "disjunction")
  });
  const walk = sys.movement?.walk;
  if ( walk ) facts.push({ label: t("Facts.Speed"), value: `${walk} ${sys.movement.units ?? "ft"}` });
  const dark = sys.senses?.darkvision;
  if ( dark ) facts.push({ label: t("Facts.Darkvision"), value: `${dark} ${sys.senses.units ?? "ft"}` });
  return facts;
}

/** Abilities a background's ASI advancement allows (2024 backgrounds lock the other three). */
export function backgroundAbilities(doc) {
  const asi = doc?.advancement?.byType?.AbilityScoreImprovement?.[0];
  if ( !asi ) return [];
  const locked = new Set(asi.configuration?.locked ?? []);
  return Object.keys(CONFIG.DND5E.abilities).filter(k => !locked.has(k));
}

/** Fixed bonuses from an ASI advancement (2014 species), keyed by ability. */
export function fixedBonuses(doc) {
  const bonuses = {};
  for ( const asi of doc?.advancement?.byType?.AbilityScoreImprovement ?? [] ) {
    for ( const [k, v] of Object.entries(asi.configuration?.fixed ?? {}) ) if ( v ) bonuses[k] = (bonuses[k] ?? 0) + v;
  }
  return bonuses;
}

function backgroundFacts(doc) {
  const facts = [];
  const abilities = backgroundAbilities(doc);
  if ( abilities.length && (abilities.length < 6) ) {
    facts.push({ label: t("Facts.AbilityScores"), value: listFormat(abilities.map(abilityLabel)) });
  }
  const feats = (doc.advancement?.byType?.ItemGrant ?? [])
    .flatMap(a => (a.configuration?.items ?? []).map(i => itemName(i.uuid)));
  if ( feats.filter(Boolean).length ) facts.push({ label: t("Facts.Feat"), value: listFormat(feats) });
  const traits = traitSummary(doc);
  if ( traits ) facts.push({ label: t("Facts.Proficiencies"), value: traits });
  return facts;
}

/** Described documents by UUID: enriching long book descriptions is the slowest part of a gallery render. */
const cache = new Map();

export function clearDescribeCache() {
  cache.clear();
}

/**
 * @param {Item} doc
 * @returns {Promise<{ tagline: string, description: string, facts: object[], timeline: object[], equipment: string }>}
 */
export function describe(doc) {
  if ( !doc ) return Promise.resolve({ tagline: "", description: "", facts: [], timeline: [], equipment: "" });
  const key = doc.uuid ?? doc.id;
  if ( !key ) return build(doc);
  if ( !cache.has(key) ) {
    const promise = build(doc);
    promise.catch(() => cache.delete(key));
    cache.set(key, promise);
  }
  return cache.get(key);
}

/** Cached rich-text enrichment for other screens (e.g. the spell inspector). */
export function enrichCached(key, html, doc) {
  const cacheKey = `enrich:${key}`;
  if ( !cache.has(cacheKey) ) cache.set(cacheKey, enrich(html, doc));
  return cache.get(cacheKey);
}

async function build(doc) {
  const raw = doc.system?.description?.value ?? "";
  let facts = [];
  let rows = [];
  switch ( doc.type ) {
    case "class":
      facts = classFacts(doc);
      rows = timeline(doc, { minLevel: 1 });
      break;
    case "subclass":
      rows = timeline(doc, { minLevel: 1 });
      break;
    case "race":
      facts = speciesFacts(doc);
      rows = timeline(doc);
      break;
    case "background":
      facts = backgroundFacts(doc);
      break;
  }
  let equipment = "";
  try {
    equipment = doc.system?.startingEquipmentDescription ?? "";
  } catch { /* Broken links in equipment data. */ }
  const description = await enrich(raw, doc);
  return {
    tagline: tagline(doc.system?.description?.chat || raw),
    description,
    hasDescription: !!plainText(raw),
    facts,
    timeline: rows,
    equipment: equipment ? await enrich(equipment, doc) : ""
  };
}

export { enrich, abilityLabel, listFormat, keyLabel };
