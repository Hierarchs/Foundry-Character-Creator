/**
 * Read a prepared (possibly temporary) character into display-ready facts for the Features and
 * Review screens.
 */
import { ABILITY_KEYS } from "../constants.mjs";
import { loc, signed } from "../utils.mjs";

function keyLabel(key, trait) {
  try {
    return globalThis.dnd5e?.documents?.Trait?.keyLabel?.(key, { trait }) ?? key;
  } catch {
    return key;
  }
}

function join(values) {
  const list = values.filter(Boolean);
  if ( !list.length ) return "";
  try {
    return game.i18n.getListFormatter().format(list);
  } catch {
    return list.join(", ");
  }
}

/** @param {Actor} actor */
export function summarize(actor) {
  if ( !actor ) return null;
  const sys = actor.system;
  const proficient = v => (Number(v) || 0) >= 1;

  const skills = Object.entries(sys.skills ?? {})
    .filter(([, s]) => proficient(s.value ?? s.proficient))
    .map(([k, s]) => `${loc(CONFIG.DND5E.skills?.[k]?.label ?? k)}${(s.value ?? 0) >= 2 ? " ★" : ""}`);
  const saves = Object.entries(sys.abilities ?? {})
    .filter(([, a]) => proficient(a.proficient))
    .map(([k]) => loc(CONFIG.DND5E.abilities?.[k]?.label ?? k));
  const tools = Object.entries(sys.tools ?? {}).filter(([, v]) => proficient(v.value)).map(([k]) => keyLabel(k, "tool"));
  const languages = Array.from(sys.traits?.languages?.value ?? []).map(k => keyLabel(k, "languages"));
  const weapons = Array.from(sys.traits?.weaponProf?.value ?? []).map(k => keyLabel(k, "weapon"));
  const armor = Array.from(sys.traits?.armorProf?.value ?? []).map(k => keyLabel(k, "armor"));

  const byName = (a, b) => a.name.localeCompare(b.name, game.i18n.lang);
  const features = actor.items.filter(i => i.type === "feat")
    .map(i => ({ name: i.name, img: i.img, kind: i.system.type?.value ?? "" })).sort(byName);
  const spells = actor.items.filter(i => i.type === "spell")
    .map(i => ({ name: i.name, img: i.img, level: i.system.level })).sort(byName);
  const classes = Object.values(actor.classes ?? {}).map(c => ({
    name: c.name, img: c.img, level: c.system.levels, subclass: c.subclass?.name ?? ""
  }));

  const size = sys.traits?.size;
  const walk = sys.attributes?.movement?.walk;
  return {
    name: actor.name,
    level: sys.details?.level ?? 0,
    hp: sys.attributes?.hp?.max ?? 0,
    ac: sys.attributes?.ac?.value ?? 10,
    prof: signed(sys.attributes?.prof ?? 2),
    initiative: signed(sys.attributes?.init?.total ?? sys.abilities?.dex?.mod ?? 0),
    speed: walk ? `${walk} ${sys.attributes.movement.units ?? "ft"}` : "",
    size: size ? loc(CONFIG.DND5E.actorSizes?.[size]?.label ?? size) : "",
    classes,
    classLine: classes.map(c => `${c.name} ${c.level}${c.subclass ? ` (${c.subclass})` : ""}`).join(" / "),
    race: sys.details?.race?.name ?? actor.items.find(i => i.type === "race")?.name ?? "",
    background: sys.details?.background?.name ?? actor.items.find(i => i.type === "background")?.name ?? "",
    abilities: ABILITY_KEYS.map(k => ({
      key: k,
      abbr: loc(CONFIG.DND5E.abilities?.[k]?.abbreviation ?? k).toUpperCase(),
      value: sys.abilities?.[k]?.value ?? 10,
      mod: signed(sys.abilities?.[k]?.mod ?? 0)
    })),
    proficiencies: [
      { label: "GENESIS.Summary.Saves", value: join(saves) },
      { label: "GENESIS.Summary.Skills", value: join(skills) },
      { label: "GENESIS.Summary.Armor", value: join(armor) },
      { label: "GENESIS.Summary.Weapons", value: join(weapons) },
      { label: "GENESIS.Summary.Tools", value: join(tools) },
      { label: "GENESIS.Summary.Languages", value: join(languages) }
    ].filter(p => p.value),
    features,
    spells
  };
}
