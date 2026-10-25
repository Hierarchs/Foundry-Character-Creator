/**
 * Which compendium packs hold official D&D content: the dnd5e system's own SRD, this module's birthsigns,
 * and the official D&D books sold for Foundry. Books are matched by module title, since the marketplace
 * doesn't publish their package ids.
 */
import { MODULE_ID } from "../constants.mjs";

/** Official D&D books on the Foundry marketplace, titled as they are listed there. */
const OFFICIAL_BOOKS = [
  "Player's Handbook",
  "Dungeon Master's Guide",
  "Monster Manual",
  "Tasha's Cauldron of Everything",
  "Eberron: Forge of the Artificer",
  "Forgotten Realms: Heroes of Faerûn",
  "Forgotten Realms: Adventures in Faerûn",
  "Arcana Unleashed",
  "Arcana Unleashed: Deadfall",
  "Ravenloft: The Horrors Within",
  "Heroes of the Borderlands",
  "Tomb of Annihilation",
  "Phandelver and Below: The Shattered Obelisk"
];

/**
 * A title reduced to letters and digits, without accents, a "Dungeons & Dragons" prefix, or an edition year,
 * so "Dungeons & Dragons Player’s Handbook" and "Player's Handbook (2024)" compare equal.
 */
function titleKey(title) {
  return String(title ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/^\s*(dungeons\s*(&|and)\s*dragons|d\s*&\s*d)\b\s*[:\-–—]?\s*/, "")
    .replace(/\((19|20)\d{2}\)/g, "")
    .replace(/[^a-z0-9]/g, "");
}

const OFFICIAL_KEYS = OFFICIAL_BOOKS.map(titleKey);

/** Whether a module's title names an official book ("Starter Set: Heroes of the Borderlands" included). */
function isOfficialTitle(title) {
  const key = titleKey(title);
  return !!key && OFFICIAL_KEYS.some(k => (key === k) || key.endsWith(k));
}

/** @param {CompendiumCollection} pack */
export function isOfficialPack(pack) {
  const { packageType, packageName } = pack?.metadata ?? {};
  if ( packageType === "system" ) return packageName === "dnd5e";
  if ( packageType !== "module" ) return false;
  return (packageName === MODULE_ID) || isOfficialTitle(game.modules.get(packageName)?.title);
}
