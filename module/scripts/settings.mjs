import { MODULE_ID } from "./constants.mjs";
import SpellRulesConfig from "./apps/spell-rules.mjs";
import ArtworkConfig from "./apps/artwork.mjs";
import SourcesConfig from "./apps/sources.mjs";
import { clearCompendiumCache } from "./data/compendium.mjs";

/**
 * Register world settings and the two GM configuration menus.
 */
export function registerSettings() {
  const world = (key, data) => game.settings.register(MODULE_ID, key, {
    name: `GENESIS.Settings.${key}.Name`,
    hint: `GENESIS.Settings.${key}.Hint`,
    scope: "world",
    config: true,
    ...data
  });

  game.settings.registerMenu(MODULE_ID, "sourcesMenu", {
    name: "GENESIS.Settings.sourcesMenu.Name",
    label: "GENESIS.Settings.sourcesMenu.Label",
    hint: "GENESIS.Settings.sourcesMenu.Hint",
    icon: "fa-solid fa-books",
    type: SourcesConfig,
    restricted: true
  });

  game.settings.registerMenu(MODULE_ID, "spellRulesMenu", {
    name: "GENESIS.Settings.spellRulesMenu.Name",
    label: "GENESIS.Settings.spellRulesMenu.Label",
    hint: "GENESIS.Settings.spellRulesMenu.Hint",
    icon: "fa-solid fa-hat-wizard",
    type: SpellRulesConfig,
    restricted: true
  });

  game.settings.registerMenu(MODULE_ID, "artworkMenu", {
    name: "GENESIS.Settings.artworkMenu.Name",
    label: "GENESIS.Settings.artworkMenu.Label",
    hint: "GENESIS.Settings.artworkMenu.Hint",
    icon: "fa-solid fa-image",
    type: ArtworkConfig,
    restricted: true
  });

  world("contentRules", {
    type: String,
    default: "auto",
    choices: {
      auto: "GENESIS.Settings.contentRules.Auto",
      2024: "GENESIS.Settings.contentRules.Modern",
      2014: "GENESIS.Settings.contentRules.Legacy",
      all: "GENESIS.Settings.contentRules.All"
    }
  });
  world("hideSrdDuplicates", { type: Boolean, default: true });
  world("startingLevel", { type: Number, default: 1, range: { min: 1, max: 20, step: 1 } });
  world("allowLevelChoice", { type: Boolean, default: false });
  world("maxStartingLevel", { type: Number, default: 20, range: { min: 1, max: 20, step: 1 } });
  world("abilityPointBuy", { type: Boolean, default: true });
  world("abilityStandardArray", { type: Boolean, default: true });
  world("abilityRoll", { type: Boolean, default: true });
  world("abilityManual", { type: Boolean, default: false });
  world("pointBuyBudget", { type: Number, default: 27, range: { min: 10, max: 60, step: 1 } });
  world("rollsToChat", { type: Boolean, default: true });
  world("allowReroll", { type: Boolean, default: false });
  world("hpMode", {
    type: String,
    default: "avg",
    choices: {
      avg: "GENESIS.Settings.hpMode.Average",
      max: "GENESIS.Settings.hpMode.Max",
      prompt: "GENESIS.Settings.hpMode.Prompt"
    }
  });
  world("multiclassPrereqs", {
    type: String,
    default: "enforce",
    choices: {
      enforce: "GENESIS.Settings.multiclassPrereqs.Enforce",
      warn: "GENESIS.Settings.multiclassPrereqs.Warn",
      off: "GENESIS.Settings.multiclassPrereqs.Off"
    }
  });
  world("allowGold", { type: Boolean, default: true });
  world("defaultBackdrop", { type: String, default: "", filePicker: "imagevideo" });
  world("playerCreation", { type: Boolean, default: true });
  world("actorFolder", { type: String, default: "" });
  world("assignCharacter", { type: Boolean, default: true });
  world("promptNewPlayers", { type: Boolean, default: true });
  world("sidebarButton", { type: Boolean, default: true });

  // Data edited through the menus above.
  game.settings.register(MODULE_ID, "packs", {
    scope: "world", config: false, type: Array, default: [], onChange: () => clearCompendiumCache()
  });
  game.settings.register(MODULE_ID, "spellRules", { scope: "world", config: false, type: Object, default: {} });
  game.settings.register(MODULE_ID, "artwork", { scope: "world", config: false, type: Object, default: {} });
}
