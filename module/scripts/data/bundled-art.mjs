/**
 * Class art shipped with the module (module/assets/classes/<name>.webp).
 *
 * An option whose identifier matches a file name uses it directly (so homebrew "spellsword" or
 * "nightblade" classes just work). Core D&D options without a same-named image use the aliases
 * below; edit them here, or override any option from the Artwork settings menu.
 */
import { MODULE_PATH } from "../constants.mjs";

const IMAGES = new Set([
  "acrobat", "agent", "archer", "assassin", "barbarian", "bard", "battlemage", "crusader", "healer", "knight",
  "mage", "monk", "nightblade", "pilgrim", "rogue", "scout", "sorcerer", "spellsword", "thief", "warrior",
  "witchhunter"
]);

const ALIASES = {
  class: {
    artificer: "battlemage",
    cleric: "healer",
    druid: "pilgrim",
    fighter: "warrior",
    paladin: "crusader",
    ranger: "scout",
    warlock: "nightblade",
    wizard: "mage"
  },
  subclass: {
    "arcane-trickster": "agent",
    "eldritch-knight": "spellsword",
    hunter: "archer",
    "oath-of-devotion": "knight",
    devotion: "knight",
    "warrior-of-the-open-hand": "acrobat",
    "open-hand": "acrobat",
    "oath-of-vengeance": "witchhunter",
    vengeance: "witchhunter"
  }
};

function lookup(type, identifier) {
  if ( !identifier ) return null;
  if ( IMAGES.has(identifier) ) return identifier;
  const alias = ALIASES[type]?.[identifier];
  return alias && IMAGES.has(alias) ? alias : null;
}

/**
 * Bundled image path for a gallery entry, or null. Subclasses without their own image fall back to
 * their parent class's art.
 * @param {{ type: string, identifier: string, index?: object }} entry
 * @returns {string|null}
 */
export function bundledArt(entry) {
  if ( !["class", "subclass"].includes(entry?.type) ) return null;
  const name = lookup(entry.type, entry.identifier)
    ?? (entry.type === "subclass" ? lookup("class", entry.index?.system?.classIdentifier) : null);
  return name ? `${MODULE_PATH}/assets/classes/${name}.webp` : null;
}
