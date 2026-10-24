/**
 * Spell selection: which classes cast, how many spells they may pick, and from which list.
 *
 * Counts come from (highest priority first):
 *  1. The GM's Spell Rules override for that class,
 *  2. The class item's own data (its "cantrips" scale value and spellcasting preparation formula),
 *  3. The Rust engine's built-in SRD tables.
 * The maximum spell level always comes from the Rust engine.
 */
import { Rules } from "../rules.mjs";
import { getSpellsForList } from "../data/compendium.mjs";
import { loc, setting, worldRules } from "../utils.mjs";

function scaleNumber(values, pattern) {
  const hit = Object.entries(values ?? {}).find(([key, v]) => pattern.test(key) && (v?.value !== undefined));
  const n = Number(hit?.[1]?.value);
  return Number.isFinite(n) ? n : null;
}

/**
 * @typedef CastingClass
 * @property {string} identifier   Class identifier (the spell's `sourceItem` is `class:<identifier>`)
 * @property {string} ruleId       Identifier used for rules lookup (subclass for Eldritch Knight etc.)
 * @property {string} label
 * @property {number} level
 * @property {string} casting      known | prepared | pact | spellbook
 * @property {string} method       dnd5e spell method: "spell" or "pact"
 * @property {number} cantrips
 * @property {number} spells
 * @property {number|null} spellbook
 * @property {number} maxSpellLevel
 * @property {string} spellList
 * @property {string} countSource  override | item | table | none
 */

/**
 * @param {Actor} actor  A prepared (possibly temporary) dnd5e character.
 * @returns {CastingClass[]}
 */
export function castingClasses(actor) {
  const overrides = setting("spellRules") ?? {};
  const out = [];
  for ( const [identifier, cls] of Object.entries(actor.spellcastingClasses ?? {}) ) {
    const sc = cls.spellcasting ?? cls.system.spellcasting;
    const subclass = cls.subclass;
    const classProgression = cls.system.spellcasting?.progression ?? "none";
    const viaSubclass = !!subclass && (classProgression === "none");
    const ruleId = viaSubclass ? subclass.identifier : identifier;
    const level = cls.system.levels ?? 1;
    const rules = cls.system.source?.rules || worldRules();
    const abilityMod = actor.system.abilities?.[sc?.ability]?.mod ?? 0;
    const override = overrides[ruleId] ?? null;

    const limits = Rules.spellLimits({
      identifier: ruleId, level, rules, abilityMod, rule: override, progression: sc?.progression ?? "none"
    });

    let cantrips = limits.cantrips;
    let spells = limits.spells;
    let countSource = override ? "override" : (limits.knownClass ? "table" : "none");
    if ( !override ) {
      const scale = { ...cls.scaleValues, ...(viaSubclass ? subclass.scaleValues : {}) };
      const itemCantrips = scaleNumber(scale, /cantrip/i);
      const formulaMax = sc?.preparation?.formula ? Number(cls.system.spellcasting?.preparation?.max) : NaN;
      const itemSpells = Number.isFinite(formulaMax) && (formulaMax > 0) ? formulaMax
        : scaleNumber(scale, /(spells-known|max-prepared|prepared)/i);
      if ( itemCantrips !== null ) cantrips = itemCantrips;
      if ( itemSpells !== null ) spells = itemSpells;
      if ( (itemCantrips !== null) || (itemSpells !== null) ) countSource = "item";
    }

    const progression = sc?.progression ?? limits.progression;
    out.push({
      identifier,
      ruleId,
      label: viaSubclass ? `${cls.name} (${subclass.name})` : cls.name,
      level,
      rules,
      casting: limits.casting ?? (progression === "pact" ? "pact" : "prepared"),
      method: CONFIG.DND5E.spellProgression?.[progression]?.type ?? (progression === "pact" ? "pact" : "spell"),
      ability: sc?.ability,
      abilityLabel: loc(CONFIG.DND5E.abilities?.[sc?.ability]?.label ?? ""),
      cantrips,
      spells,
      spellbook: limits.spellbook === null ? null : Math.max(limits.spellbook, spells),
      maxSpellLevel: limits.maxSpellLevel,
      spellList: override?.spellList || limits.spellList || ruleId,
      replacePerLevel: limits.replacePerLevel,
      countSource
    });
  }
  return out;
}

/**
 * Candidate spells for a casting class: its registered spell list, limited to castable levels.
 * @param {CastingClass} caster
 * @returns {Promise<{ cantrips: object[], leveled: object[], fromList: boolean }>}
 */
export async function candidateSpells(caster) {
  let { spells, fromList } = await getSpellsForList(caster.spellList, "class");
  if ( !fromList && (caster.spellList !== caster.ruleId) ) {
    ({ spells, fromList } = await getSpellsForList(caster.ruleId, "subclass"));
  }
  const level = s => Number(s.index.system?.level ?? 0);
  return {
    cantrips: caster.cantrips > 0 ? spells.filter(s => level(s) === 0) : [],
    leveled: spells.filter(s => (level(s) > 0) && (level(s) <= caster.maxSpellLevel)),
    fromList
  };
}

/** Spells already on the actor attributed to a class (granted by features or picked earlier). */
export function existingSpells(actor, identifier) {
  return actor.items.filter(i => (i.type === "spell") && (i.system.sourceItem === `class:${identifier}`));
}

/** Short label for a spell card: "1st-level Evocation", "Conjuration cantrip". */
export function spellSubtitle(entry) {
  const sys = entry.index?.system ?? entry.system ?? {};
  const school = loc(CONFIG.DND5E.spellSchools?.[sys.school]?.label ?? sys.school ?? "");
  const level = Number(sys.level ?? 0);
  const levelLabel = loc(CONFIG.DND5E.spellLevels?.[level] ?? `${level}`);
  return level === 0 ? `${school} ${levelLabel}`.trim() : `${levelLabel} ${school}`.trim();
}

/** Tags (concentration, ritual, components) for a spell card. */
export function spellTags(entry) {
  const props = new Set(entry.index?.system?.properties ?? entry.system?.properties ?? []);
  const tags = [];
  if ( props.has("concentration") ) tags.push({ key: "C", label: loc(CONFIG.DND5E.itemProperties?.concentration?.label ?? "Concentration") });
  if ( props.has("ritual") ) tags.push({ key: "R", label: loc(CONFIG.DND5E.itemProperties?.ritual?.label ?? "Ritual") });
  const components = ["vocal", "somatic", "material"].filter(c => props.has(c))
    .map(c => (CONFIG.DND5E.itemProperties?.[c]?.abbreviation ?? c[0]).toUpperCase?.() ?? c[0]);
  if ( components.length ) tags.push({ key: components.join(""), label: components.join(", ") });
  return tags;
}

/**
 * Item data for chosen spells, attributed to the casting class.
 * @param {CastingClass} caster
 * @param {{ cantrips: string[], spells: string[], prepared: string[] }} picks
 * @param {Function} itemDataFrom
 */
export async function spellItemData(caster, picks, itemDataFrom) {
  const prepared = new Set(picks.prepared ?? []);
  const out = [];
  const all = [...(picks.cantrips ?? []), ...(picks.spells ?? [])];
  for ( const uuid of all ) {
    const doc = await fromUuid(uuid);
    if ( !doc ) continue;
    const data = itemDataFrom(doc);
    const isCantrip = Number(data.system?.level ?? 0) === 0;
    // Wizards prepare a subset of their spellbook; everyone else has their picks ready.
    const ready = isCantrip || (caster.casting !== "spellbook") || prepared.has(uuid);
    foundry.utils.mergeObject(data, {
      "system.sourceItem": `class:${caster.identifier}`,
      "system.method": caster.method,
      "system.prepared": ready ? 1 : 0
    });
    out.push(data);
  }
  return out;
}
