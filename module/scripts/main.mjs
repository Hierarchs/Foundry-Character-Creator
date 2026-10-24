/**
 * Character Genesis — entry point.
 */
import { MODULE_ID, TEMPLATES } from "./constants.mjs";
import { registerSettings } from "./settings.mjs";
import { initRules, Rules, rulesReady } from "./rules.mjs";
import GenesisWizard from "./apps/wizard.mjs";
import { installAdvancementHooks } from "./engine/advancement.mjs";
import { registerSocket } from "./engine/socket.mjs";
import { clearCompendiumCache } from "./data/compendium.mjs";
import { log, setting, t } from "./utils.mjs";

function ensureReady() {
  if ( rulesReady() ) return true;
  ui.notifications.error(t("Errors.Wasm"));
  return false;
}

function canCreate() {
  return game.user.can("ACTOR_CREATE") || (setting("playerCreation") && !!game.users.activeGM);
}

/** Public API, also available as `game.modules.get("character-genesis").api` and `CharacterGenesis`. */
const api = {
  /** Open the character creator. */
  create() {
    if ( !ensureReady() ) return null;
    clearCompendiumCache();
    return GenesisWizard.open({ mode: "create" });
  },

  /** Open the level-up wizard for a character (defaults to the user's assigned character). */
  levelUp(actor=game.user.character) {
    if ( !ensureReady() ) return null;
    if ( !actor || (actor.type !== "character") ) return ui.notifications.warn(t("LevelUp.NoActor"));
    if ( !actor.isOwner ) return ui.notifications.warn(t("LevelUp.NotOwner"));
    if ( (actor.system.details.level ?? 0) >= 20 ) return ui.notifications.info(t("LevelUp.Max"));
    if ( !actor.system.details.level ) return api.create();
    clearCompendiumCache();
    return GenesisWizard.open({ mode: "levelup", actor });
  },

  rules: Rules,
  clearCache: clearCompendiumCache,
  Wizard: GenesisWizard
};

Hooks.once("init", () => {
  registerSettings();
  const loadTemplates = foundry.applications?.handlebars?.loadTemplates ?? globalThis.loadTemplates;
  loadTemplates(Object.values(TEMPLATES));
  game.modules.get(MODULE_ID).api = api;
  globalThis.CharacterGenesis = api;
});

Hooks.once("ready", async () => {
  if ( game.system.id !== "dnd5e" ) {
    ui.notifications.error(t("Errors.System"));
    return;
  }
  try {
    const path = `modules/${MODULE_ID}/wasm/genesis_rules.wasm`;
    await initRules(foundry.utils.getRoute?.(path) ?? `/${path}`);
    log(`rules engine v${Rules.version()} loaded`);
  } catch(err) {
    console.error(err);
    ui.notifications.error(t("Errors.Wasm"));
  }
  installAdvancementHooks();
  registerSocket();
  promptNewPlayer();
});

/** Offer the wizard to players who log in without a character. */
async function promptNewPlayer() {
  if ( game.user.isGM || !setting("promptNewPlayers") || !canCreate() ) return;
  if ( game.user.character || game.actors.some(a => (a.type === "character") && a.isOwner) ) return;
  const proceed = await foundry.applications.api.DialogV2.confirm({
    window: { title: t("Prompt.Title"), icon: "fa-solid fa-hat-wizard" },
    content: `<p>${t("Prompt.Content")}</p>`,
    yes: { label: t("Prompt.Yes"), icon: "fa-solid fa-hat-wizard" },
    no: { label: t("Prompt.No") },
    rejectClose: false
  });
  if ( proceed ) api.create();
}

/* -------------------------------------------- */
/*  Entry points                                */
/* -------------------------------------------- */

// "Create Character" button in the Actors sidebar.
Hooks.on("renderActorDirectory", (app, html) => {
  if ( !setting("sidebarButton") || !canCreate() ) return;
  const root = html instanceof HTMLElement ? html : html?.[0] ?? app.element;
  if ( !root || root.querySelector(".genesis-create") ) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "genesis-create";
  button.innerHTML = `<i class="fa-solid fa-hat-wizard"></i> ${t("Sidebar.Create")}`;
  button.addEventListener("click", () => api.create());
  const actions = root.querySelector(".header-actions");
  if ( actions ) actions.append(button);
  else (root.querySelector(".directory-header") ?? root).prepend(button);
});

// Keep other windows (advancement steps, dialogs, file pickers) above the full-screen wizard.
Hooks.on("renderApplicationV2", app => {
  if ( !document.body.classList.contains("genesis-open") || (app instanceof GenesisWizard) ) return;
  const element = app.element;
  const wizard = document.querySelector(".character-genesis");
  if ( !element || !wizard || (app.options?.window?.frame === false) ) return;
  const floor = Number(getComputedStyle(wizard).zIndex) || 0;
  if ( (Number(getComputedStyle(element).zIndex) || 0) <= floor ) element.style.zIndex = String(floor + 10);
});

// "Level Up" in a character sheet's header menu.
Hooks.on("getHeaderControlsApplicationV2", (app, controls) => {
  const actor = app.document ?? app.actor;
  if ( !(actor instanceof Actor) || (actor.type !== "character") || !actor.isOwner ) return;
  if ( controls.some(c => c.action === "genesisLevelUp") ) return;
  controls.unshift({
    icon: "fa-solid fa-angles-up",
    label: "GENESIS.Sheet.LevelUp",
    action: "genesisLevelUp",
    onClick: () => api.levelUp(actor)
  });
});

// Right-click on an actor in the sidebar.
function contextOptions(app, options) {
  const actorFor = li => game.actors.get((li instanceof HTMLElement ? li : li?.[0])?.dataset?.entryId ?? li?.data?.("entryId"));
  options.push({
    name: "GENESIS.Sheet.LevelUp",
    icon: '<i class="fa-solid fa-angles-up"></i>',
    condition: li => {
      const actor = actorFor(li);
      return !!actor && (actor.type === "character") && actor.isOwner;
    },
    callback: li => api.levelUp(actorFor(li))
  });
}
Hooks.on("getActorContextOptions", contextOptions);
Hooks.on("getActorDirectoryEntryContext", contextOptions);
