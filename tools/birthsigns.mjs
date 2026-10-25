/**
 * Source data for the "Birthsigns of Tamriel" compendium (Item pack, dnd5e feats of type "birthsign").
 * tools/build-packs.mjs compiles this into module/packs/birthsigns; the dev harness loads it directly.
 *
 * Balanced as 5e origin-feat-sized boons. Oblivion-style drawbacks are Active Effects flagged
 * `drawback` and shipped disabled; the wizard enables them when the GM turns on "Birthsign Drawbacks".
 */
const MODULE_ID = "character-genesis";
const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];
const SPELLS = {
  charmPerson: ["Compendium.dnd5e.spells24.Item.phbsplCharmPerso", ["vocal", "somatic"]],
  cureWounds: ["Compendium.dnd5e.spells24.Item.phbsplCureWounds", ["vocal", "somatic"]],
  invisibility: ["Compendium.dnd5e.spells24.Item.phbsplInvisibili", ["vocal", "somatic", "material", "concentration"]],
  knock: ["Compendium.dnd5e.spells24.Item.phbsplKnock00000", ["vocal"]],
  magicMissile: ["Compendium.dnd5e.spells24.Item.phbsplMagicMissi", ["vocal", "somatic"]]
};

/** Stable 16-character ids so updates replace rather than duplicate documents. */
const id = (prefix, key) => `${prefix}${key}`.replace(/[^A-Za-z0-9]/g, "").padEnd(16, "0").slice(0, 16);

const once = () => ({ max: "1", spent: 0, recovery: [{ period: "lr", type: "recoverAll" }] });
const useCharge = () => ({
  targets: [{ type: "itemUses", value: "1", target: "", scaling: {} }],
  scaling: { allowed: false },
  spellSlot: false
});

function asi(key, abilities) {
  return {
    _id: id("asi", key), type: "AbilityScoreImprovement", level: 0, title: "Birthsign: Ability Score", hint: "", value: {},
    configuration: {
      cap: 1, points: 1, locked: ABILITIES.filter(a => !abilities.includes(a)),
      fixed: Object.fromEntries(ABILITIES.map(a => [a, 0]))
    }
  };
}

function skills(key, pool) {
  return {
    _id: id("trt", key), type: "Trait", level: 0, title: "Birthsign: Skill", hint: "", value: { chosen: [] },
    configuration: {
      mode: "default", allowReplacements: false,
      grants: pool.length === 1 ? [`skills:${pool[0]}`] : [],
      choices: pool.length > 1 ? [{ count: 1, pool: pool.map(s => `skills:${s}`) }] : []
    }
  };
}

function activity(key, type, data) {
  const _id = id("act", key);
  return {
    [_id]: foundry_merge({
      _id, type, name: "", sort: 0,
      activation: { type: "action", value: null, override: false, condition: "" },
      consumption: useCharge(),
      description: { chatFlavor: "" },
      duration: { units: "inst", concentration: false, override: false },
      range: { override: false, units: "self", special: "" },
      target: {
        template: { contiguous: false, units: "ft", type: "" },
        affects: { choice: false, count: "", type: "self", special: "" },
        override: false, prompt: false
      },
      uses: { spent: 0, recovery: [], max: "" }
    }, data)
  };
}

function cast(key, [uuid, properties], ability) {
  return activity(key, "cast", {
    activation: { type: "action", value: null, override: false, condition: "" },
    range: { override: false, units: "self", special: "" },
    spell: { uuid, ability, challenge: { attack: null, save: null, override: false }, level: null, properties, spellbook: true }
  });
}

function effect(key, name, img, changes, { drawback=false }={}) {
  return {
    _id: id("eff", key), name, img, type: "base", system: {}, description: "", origin: null, tint: "#ffffff",
    transfer: true, disabled: drawback, statuses: [], duration: {}, sort: 0,
    changes: changes.map(([k, v]) => ({ key: k, mode: 2, value: v, priority: null })),
    flags: drawback ? { [MODULE_ID]: { drawback: true } } : {}
  };
}

/** Tiny deep merge for plain data (the build script runs outside Foundry). */
function foundry_merge(target, source) {
  for ( const [k, v] of Object.entries(source) ) {
    if ( v && (typeof v === "object") && !Array.isArray(v) && target[k] && (typeof target[k] === "object") ) foundry_merge(target[k], v);
    else target[k] = v;
  }
  return target;
}

const p = text => `<p>${text}</p>`;

/** Order follows Tamriel's calendar (Morning Star first); the Serpent wanders and has no month. */
const SIGNS = [
  {
    key: "ritual", name: "The Ritual", month: 1, guardian: "Mage",
    lore: "Born under the Ritual, you carry a spark of the divine that answers in times of need.",
    benefit: "Increase your Wisdom or Charisma by 1. Once per Long Rest you can cast <em>Cure Wounds</em> without a spell slot.",
    advancement: [asi("ritual", ["wis", "cha"])],
    uses: true, activities: cast("ritual", SPELLS.cureWounds, "wis")
  },
  {
    key: "lover", name: "The Lover", month: 2, guardian: "Thief",
    lore: "The Lover's children are graceful and passionate, hard to refuse.",
    benefit: "Increase your Charisma by 1. Once per Long Rest you can cast <em>Charm Person</em> without a spell slot.",
    advancement: [asi("lover", ["cha"])],
    uses: true, activities: cast("lover", SPELLS.charmPerson, "cha")
  },
  {
    key: "lord", name: "The Lord", month: 3, guardian: "Warrior",
    lore: "The Lord's blood runs strong; wounds close quickly on those born under his stars.",
    benefit: "As a Bonus Action once per Long Rest, you regain Hit Points equal to 1d8 + your character level.",
    drawback: "You have Vulnerability to Fire damage.",
    uses: true,
    activities: activity("lord", "heal", {
      name: "Blood of the North",
      activation: { type: "bonus" },
      healing: { number: 1, denomination: 8, bonus: "@details.level", types: ["healing"], custom: { enabled: false }, scaling: { number: 1 } }
    }),
    effects: [effect("lordfire", "Trollkin (Drawback)", "icons/magic/fire/flame-burning-creature-skeleton.webp", [["system.traits.dv.value", "fire"]], { drawback: true })]
  },
  {
    key: "mage", name: "The Mage", month: 4, guardian: "Mage",
    lore: "Those born under the Mage, one of the three Guardians, have a natural gift for magic.",
    benefit: "Increase your Intelligence or Wisdom by 1, and you gain proficiency in Arcana.",
    advancement: [asi("mage", ["int", "wis"]), skills("mage", ["arc"])]
  },
  {
    key: "shadow", name: "The Shadow", month: 5, guardian: "Thief",
    lore: "The Shadow grants the power to slip from sight.",
    benefit: "Once per Long Rest you can cast <em>Invisibility</em> on yourself without a spell slot.",
    uses: true, activities: cast("shadow", SPELLS.invisibility, "cha")
  },
  {
    key: "steed", name: "The Steed", month: 6, guardian: "Warrior",
    lore: "The Steed's charges are impatient and always on the move.",
    benefit: "Increase your Strength or Dexterity by 1, and your Speed increases by 10 feet.",
    advancement: [asi("steed", ["str", "dex"])],
    effects: [effect("steedspeed", "Steed's Stride", "icons/skills/movement/feet-winged-boots-brown.webp", [["system.attributes.movement.walk", "10"]])]
  },
  {
    key: "apprentice", name: "The Apprentice", month: 7, guardian: "Mage",
    lore: "The Apprentice's season gifts raw magical power, at the cost of a weakness to it.",
    benefit: "Increase your Intelligence, Wisdom, or Charisma by 1. Once per Long Rest you can cast <em>Magic Missile</em> without a spell slot.",
    drawback: "You have Vulnerability to Force damage.",
    advancement: [asi("apprentice", ["int", "wis", "cha"])],
    uses: true, activities: cast("apprentice", SPELLS.magicMissile, "int"),
    effects: [effect("apprforce", "Elfborn (Drawback)", "icons/magic/symbols/runes-star-pentagon-blue.webp", [["system.traits.dv.value", "force"]], { drawback: true })]
  },
  {
    key: "warrior", name: "The Warrior", month: 8, guardian: "Warrior",
    lore: "The Warrior is the first of the three Guardians; its charges are skilled with weapons of all kinds.",
    benefit: "Increase your Strength or Constitution by 1, and you gain proficiency in Athletics or Intimidation.",
    advancement: [asi("warrior", ["str", "con"]), skills("warrior", ["ath", "itm"])]
  },
  {
    key: "lady", name: "The Lady", month: 9, guardian: "Warrior",
    lore: "The Lady's charges are kind, tolerant, and hard to wear down.",
    benefit: "Increase your Wisdom or Constitution by 1, and you gain proficiency in Insight or Medicine.",
    advancement: [asi("lady", ["wis", "con"]), skills("lady", ["ins", "med"])]
  },
  {
    key: "tower", name: "The Tower", month: 10, guardian: "Thief",
    lore: "The Tower's charges have a knack for finding secrets and opening what is locked.",
    benefit: "You gain proficiency in Investigation. Once per Long Rest you can cast <em>Knock</em> without a spell slot.",
    advancement: [skills("tower", ["inv"])],
    uses: true, activities: cast("tower", SPELLS.knock, "int")
  },
  {
    key: "atronach", name: "The Atronach", month: 11, guardian: "Mage",
    lore: "The Atronach's children drink in the magic thrown at them.",
    benefit: "Increase your Intelligence, Wisdom, or Charisma by 1. Once per Long Rest, as a Reaction when you take damage from a spell, you gain Temporary Hit Points equal to 1d10 + your character level.",
    advancement: [asi("atronach", ["int", "wis", "cha"])],
    uses: true,
    activities: activity("atronach", "heal", {
      name: "Spell Absorption",
      activation: { type: "reaction", condition: "when you take damage from a spell" },
      healing: { number: 1, denomination: 10, bonus: "@details.level", types: ["temphp"], custom: { enabled: false }, scaling: { number: 1 } }
    })
  },
  {
    key: "thief", name: "The Thief", month: 12, guardian: "Thief",
    lore: "The Thief, last of the three Guardians, favours the lucky and the light-fingered.",
    benefit: "Increase your Dexterity by 1, and you gain proficiency in Stealth or Sleight of Hand.",
    advancement: [asi("thief", ["dex"]), skills("thief", ["ste", "slt"])]
  },
  {
    key: "serpent", name: "The Serpent", month: null, guardian: null,
    lore: "The Serpent wanders the sky and has no season. Its rare charges strike with venom.",
    benefit: "Once per Long Rest, as an action, touch a creature: it makes a Constitution saving throw (DC 8 + your Constitution modifier + your Proficiency Bonus), taking 3d6 Poison damage on a failure or half as much on a success.",
    uses: true,
    activities: activity("serpent", "save", {
      name: "Serpent's Kiss",
      range: { override: false, units: "touch", special: "" },
      target: { affects: { type: "creature", count: "1" } },
      save: { ability: ["con"], dc: { calculation: "con", formula: "" } },
      damage: {
        onSave: "half",
        parts: [{ number: 3, denomination: 6, bonus: "", types: ["poison"], custom: { enabled: false, formula: "" }, scaling: { number: 1 } }]
      }
    })
  }
];

const MONTH_NAMES = ["Morning Star", "Sun's Dawn", "First Seed", "Rain's Hand", "Second Seed", "Midyear",
  "Sun's Height", "Last Seed", "Hearthfire", "Frostfall", "Sun's Dusk", "Evening Star"];

/** Full dnd5e item documents (with `_key`s for the Foundry CLI). */
export function birthsignItems() {
  return SIGNS.map((s, order) => {
    const _id = id("gbs", s.key);
    const img = `modules/${MODULE_ID}/assets/birthsigns/${s.key}.webp`;
    const season = s.month ? `${MONTH_NAMES[s.month - 1]}` : "No fixed month: the Serpent wanders";
    const charge = s.guardian ? ` · Charge of the ${s.guardian}` : "";
    const description = [
      p(`<em>${s.lore}</em>`),
      p(`<strong>Month:</strong> ${season}${charge}`),
      p(`<strong>Benefit.</strong> ${s.benefit}`),
      s.drawback ? p(`<strong>Drawback (optional rule).</strong> ${s.drawback}`) : ""
    ].join("");
    const effects = (s.effects ?? []).map(e => ({ ...e, _key: `!items.effects!${_id}.${e._id}` }));
    return {
      _id,
      _key: `!items!${_id}`,
      name: s.name,
      type: "feat",
      img,
      system: {
        description: { value: description, chat: "" },
        identifier: `birthsign-${s.key}`,
        source: { custom: "Character Genesis", book: "Birthsigns of Tamriel", page: "", license: "", rules: "" },
        type: { value: "birthsign", subtype: "" },
        requirements: "",
        properties: [],
        uses: s.uses ? once() : { max: "", spent: 0, recovery: [] },
        activities: s.activities ?? {},
        advancement: s.advancement ?? [],
        prerequisites: { level: null, repeatable: false }
      },
      effects,
      flags: { [MODULE_ID]: { month: s.month, order, figure: img } },
      folder: null,
      sort: (order + 1) * 1000,
      ownership: { default: 0 }
    };
  });
}

export { MONTH_NAMES };
