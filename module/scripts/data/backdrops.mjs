/**
 * Scene backdrops shipped with the module (module/assets/backdrops/<name>.jpg), one per wizard step.
 * The journey follows Oblivion's opening: out of the Imperial sewers, across Cyrodiil, and up to the
 * Imperial City for the final review. Edit the map to reassign scenes.
 */
import { MODULE_PATH } from "../constants.mjs";
import { setting } from "../utils.mjs";

const STEP_BACKDROPS = {
  class: "imperial-sewers",
  subclass: "ayleid-ruins",
  background: "lake-ruins",
  species: "shivering-isles",
  abilities: "cloud-ruler",
  features: "imperial-palace",
  spells: "oblivion-gate",
  equipment: "kvatch",
  details: "lake-ruins",
  review: "imperial-city",
  levelupClass: "cloud-ruler",
  levelupApply: "imperial-palace",
  levelupDone: "imperial-city"
};

/** Bundled backdrop for a step, or null when the step has none or the setting is off. */
export function stepBackdrop(stepId) {
  if ( !setting("stepBackdrops") ) return null;
  const name = STEP_BACKDROPS[stepId];
  return name ? { src: `${MODULE_PATH}/assets/backdrops/${name}.jpg`, video: false, position: "center", source: "step" } : null;
}
