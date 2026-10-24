/**
 * Splash-art resolution for classes, subclasses, species, and backgrounds.
 *
 * Order of precedence:
 *  1. GM override from the Artwork menu (by UUID, then by `type:identifier` so it survives reprints)
 *  2. An `art` flag on the item itself (`flags.character-genesis.art`)
 *  3. Any module listening to the `characterGenesis.resolveArt` hook
 *  4. The first image embedded in the item's description (common in premium books and DDB imports)
 *  5. The world's default backdrop setting
 *
 * Separately, `figure` is a transparent character cut-out drawn in front of the backdrop: the class
 * art bundled with the module (see bundled-art.mjs) unless the GM overrides it.
 */
import { MODULE_ID } from "../constants.mjs";
import { firstImage, isVideo, setting } from "../utils.mjs";
import { bundledArt } from "./bundled-art.mjs";

/**
 * @typedef ArtResult
 * @property {string|null} src
 * @property {boolean} video
 * @property {string} position   CSS object-position, e.g. "center top"
 * @property {string|null} source  Where the art came from (override, flag, hook, description, default)
 */

export function artKey(entry) {
  return `${entry.type}:${entry.identifier}`;
}

/**
 * @param {import("./compendium.mjs").GenesisEntry} entry
 * @param {Item|null} doc  The full document, if already loaded.
 * @returns {ArtResult}
 */
export function resolveArt(entry, doc=null) {
  const overrides = setting("artwork") ?? {};
  const override = overrides[entry?.uuid] ?? overrides[artKey(entry ?? {})];
  const result = { src: null, video: false, position: override?.position || "center", source: null };

  if ( override?.src ) Object.assign(result, { src: override.src, source: "override" });
  else if ( doc?.getFlag?.(MODULE_ID, "art") ) Object.assign(result, { src: doc.getFlag(MODULE_ID, "art"), source: "flag" });

  if ( !result.src ) {
    Hooks.callAll("characterGenesis.resolveArt", entry, doc, result);
    if ( result.src ) result.source ??= "hook";
  }

  // Transparent character figure shown in front of the backdrop (bundled class art by default).
  result.figure = override?.figure ?? bundledArt(entry);

  if ( !result.src && doc ) {
    const img = firstImage(doc.system?.description?.value);
    if ( img ) Object.assign(result, { src: img, source: "description" });
  }

  if ( !result.src ) {
    const fallback = setting("defaultBackdrop");
    if ( fallback ) Object.assign(result, { src: fallback, source: "default" });
  }

  result.video = isVideo(result.src);
  return result;
}
