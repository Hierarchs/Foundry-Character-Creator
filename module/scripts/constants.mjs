export const MODULE_ID = "character-genesis";
export const MODULE_PATH = `modules/${MODULE_ID}`;
export const TEMPLATE_PATH = `${MODULE_PATH}/templates`;
export const SOCKET = `module.${MODULE_ID}`;

/** Every template the wizard can render, preloaded at init so step partials resolve synchronously. */
export const TEMPLATES = {
  chrome: `${TEMPLATE_PATH}/wizard/chrome.hbs`,
  stage: `${TEMPLATE_PATH}/wizard/stage.hbs`,
  gallery: `${TEMPLATE_PATH}/steps/gallery.hbs`,
  abilities: `${TEMPLATE_PATH}/steps/abilities.hbs`,
  features: `${TEMPLATE_PATH}/steps/features.hbs`,
  spells: `${TEMPLATE_PATH}/steps/spells.hbs`,
  equipment: `${TEMPLATE_PATH}/steps/equipment.hbs`,
  equipmentEntry: `${TEMPLATE_PATH}/steps/equipment-entry.hbs`,
  details: `${TEMPLATE_PATH}/steps/details.hbs`,
  review: `${TEMPLATE_PATH}/steps/review.hbs`,
  levelupClass: `${TEMPLATE_PATH}/steps/levelup-class.hbs`,
  levelupDone: `${TEMPLATE_PATH}/steps/levelup-done.hbs`,
  summary: `${TEMPLATE_PATH}/steps/summary.hbs`,
  spellRules: `${TEMPLATE_PATH}/settings/spell-rules.hbs`,
  sources: `${TEMPLATE_PATH}/settings/sources.hbs`,
  artwork: `${TEMPLATE_PATH}/settings/artwork.hbs`
};

/** Item types the wizard browses in gallery form, mapped to dnd5e item types. */
export const GALLERY_TYPES = {
  class: "class",
  subclass: "subclass",
  background: "background",
  species: "race"
};

export const ABILITY_KEYS = ["str", "dex", "con", "int", "wis", "cha"];

/** Font Awesome icons for each ability card (dnd5e's own SVGs are used when available). */
export const ABILITY_ICONS = {
  str: "fa-solid fa-hand-fist",
  dex: "fa-solid fa-person-running",
  con: "fa-solid fa-heart",
  int: "fa-solid fa-brain",
  wis: "fa-solid fa-eye",
  cha: "fa-solid fa-comments"
};

export const DEFAULT_PORTRAIT = "icons/svg/mystery-man.svg";
