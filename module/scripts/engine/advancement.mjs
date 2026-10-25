/**
 * Drives dnd5e's own AdvancementManager so every class, species, background, and feat that uses
 * standard Advancements works without per-book setup.
 *
 * Character creation runs the managers against a temporary, unsaved actor. The
 * `dnd5e.preAdvancementManagerComplete` hook is used to capture the finished actor data and veto the
 * database write, so nothing is created until the player confirms the whole character.
 *
 * Choices the wizard already collected (subclass, hit point method) are fed back in by wrapping
 * `getAutomaticApplicationValue` on the flow classes; anything else still shows the native step UI,
 * themed to match the wizard.
 */
import { setting } from "../utils.mjs";

/** @type {Map<object, { capture: boolean, result: any, resolve: Function }>} */
const pending = new Map();
/** Clone actor -> function (advancement, level) => answer | undefined */
const answerProviders = new WeakMap();
let active = null;

const MANAGER_OPTIONS = {
  automaticApplication: true,
  classes: ["genesis-advancement"],
  position: { width: 520 }
};

function Manager() {
  const cls = globalThis.dnd5e?.applications?.advancement?.AdvancementManager;
  if ( !cls ) throw new Error("dnd5e AdvancementManager is not available");
  return cls;
}

/** Install the flow wrapper and completion hooks. Called once on `ready`. */
export function installAdvancementHooks() {
  const ns = globalThis.dnd5e?.applications?.advancement;
  for ( const Flow of [ns?.AdvancementFlow, ns?.AdvancementFlowV2].filter(Boolean) ) {
    const original = Flow.prototype.getAutomaticApplicationValue;
    if ( !original || original.genesisWrapped ) continue;
    const wrapped = async function(...args) {
      const provider = answerProviders.get(this.advancement?.actor);
      if ( provider ) {
        try {
          const answer = await provider(this.advancement, this.level);
          if ( answer !== undefined ) return answer;
        } catch(err) {
          console.error("Character Genesis | answer provider failed", err);
        }
      }
      return original.apply(this, args);
    };
    wrapped.genesisWrapped = true;
    Flow.prototype.getAutomaticApplicationValue = wrapped;
  }

  Hooks.on("dnd5e.preAdvancementManagerComplete", manager => {
    const entry = pending.get(manager);
    if ( !entry?.capture ) return;
    entry.result = manager.clone.toObject();
    return false;
  });

  Hooks.on("renderAdvancementManager", manager => {
    if ( active?.manager === manager ) embedActiveManager();
  });

  Hooks.on("dnd5e.advancementManagerComplete", manager => {
    const entry = pending.get(manager);
    if ( entry && !entry.capture ) entry.result = true;
  });
}

/**
 * Answers for advancement steps the wizard has already decided.
 * @param {object} options
 * @param {string|null} [options.subclassUuid]  Subclass picked in the gallery.
 * @param {string} [options.hpMode]             "avg", "max", or "prompt".
 */
export function makeAnswers({ subclassUuid=null, hpMode=setting("hpMode") }={}) {
  return (advancement, level) => {
    switch ( advancement?.type ) {
      case "Subclass":
        return subclassUuid ? { uuid: subclassUuid } : undefined;
      case "HitPoints":
        if ( hpMode === "prompt" ) return undefined;
        // The system already gives the original class maximum hit points at level 1.
        if ( (level === 1) && advancement.item?.isOriginalClass ) return undefined;
        return { [level]: hpMode === "max" ? "max" : "avg" };
      default:
        return undefined;
    }
  };
}

/**
 * Render a prepared manager and wait for it to finish or be cancelled.
 * @returns {Promise<object|boolean|null>} Captured actor data, `true` for an applied run, or
 *                                         `null`/`false` if the player closed it.
 */
function drive(manager, { capture, answers }) {
  if ( answers ) answerProviders.set(manager.clone, answers);
  return new Promise(resolve => {
    let settled = false;
    const entry = { capture, result: undefined };
    const settle = value => {
      if ( settled ) return;
      settled = true;
      pending.delete(manager);
      answerProviders.delete(manager.clone);
      if ( active?.manager === manager ) active = null;
      resolve(value);
    };
    entry.resolve = settle;
    pending.set(manager, entry);
    active = { manager, settle };

    // Resolve only once the window is gone, so the next manager never overlaps this one.
    const originalClose = manager.close.bind(manager);
    manager.close = async (options={}) => {
      const result = await originalClose(options);
      if ( !manager.rendered ) settle(entry.result ?? (capture ? null : false));
      return result;
    };

    try {
      Promise.resolve(manager.render(true)).then(() => embedActiveManager()).catch(err => console.error(err));
    } catch(err) {
      console.error(err);
      settle(capture ? null : false);
    }
  });
}

/** Abort whatever manager the wizard is currently waiting on. */
export async function cancelActiveAdvancement() {
  if ( !active ) return;
  const { manager, settle } = active;
  settle(null);
  await manager.close({ skipConfirmation: true }).catch(() => {});
}

export function advancementInProgress() {
  return !!active;
}

/**
 * Move the running advancement window into the wizard's Features panel (`.genesis-advancement-slot`)
 * so the system's choices appear inline and themed instead of as a floating window. Safe to call
 * repeatedly; the step re-attaches it whenever the stage re-renders.
 */
export function embedActiveManager() {
  const element = active?.manager?.element;
  const slot = document.querySelector(".character-genesis .genesis-advancement-slot");
  if ( !element || !slot ) return false;
  // The manager handles its own buttons; keep their clicks (data-action="next", ...) from also
  // reaching the wizard's identically named actions.
  if ( !slot.dataset.genesisGuard ) {
    slot.addEventListener("click", event => event.stopPropagation());
    slot.dataset.genesisGuard = "true";
  }
  element.classList.add("genesis-embedded");
  if ( element.parentElement !== slot ) slot.append(element);
  return true;
}

/** Turn a birthsign's optional drawback effects on or off to match the GM setting. */
function withDrawbacks(data) {
  const enabled = setting("birthsignDrawbacks");
  for ( const effect of data.effects ?? [] ) {
    if ( effect.flags?.["character-genesis"]?.drawback ) effect.disabled = !enabled;
  }
  return data;
}

/** Plain item data from a compendium document, ready to embed. */
export function itemDataFrom(doc) {
  if ( game.items?.fromCompendium ) return game.items.fromCompendium(doc, { keepId: false });
  const data = doc.toObject();
  delete data._id;
  return data;
}

/**
 * Apply background, species, and class (in that order, as dnd5e's own level-up does) to unsaved
 * actor data. Level-based species and background advancements are handled as the class levels up.
 * @param {object} base            Starting actor data (abilities already set).
 * @param {object} items
 * @param {Item} [items.background]
 * @param {Item} [items.species]
 * @param {Item} items.cls
 * @param {number} items.level
 * @param {string|null} [items.subclassUuid]
 * @param {Function} [onStep]      Called with "background" | "species" | "class" before each run.
 * @returns {Promise<object|null>} Final actor data, or null if the player cancelled.
 */
export async function buildCharacter(base, { background, species, birthsign, cls, level, subclassUuid }, onStep) {
  const answers = makeAnswers({ subclassUuid });
  const sequence = [
    background && ["background", itemDataFrom(background)],
    species && ["species", itemDataFrom(species)],
    birthsign && ["birthsign", withDrawbacks(itemDataFrom(birthsign))],
    cls && ["class", foundry.utils.mergeObject(itemDataFrom(cls), { "system.levels": level }, { inplace: false })]
  ].filter(Boolean);

  let data = foundry.utils.deepClone(base);
  for ( const [kind, itemData] of sequence ) {
    onStep?.(kind);
    // A fresh id per run keeps each manager's window id unique.
    data._id = foundry.utils.randomID();
    const actor = new Actor.implementation(data);
    const manager = Manager().forNewItem(actor, itemData, foundry.utils.deepClone(MANAGER_OPTIONS));
    let result;
    if ( !manager.steps.length ) result = manager.clone.toObject();
    else result = await drive(manager, { capture: true, answers });
    if ( !result ) return null;
    data = result;
  }
  delete data._id;
  return data;
}

/**
 * Level a saved character up by one level in an existing class, applying changes directly.
 * @returns {Promise<boolean>} Whether the advancement completed.
 */
export async function levelUpExisting(actor, classItem, { subclassUuid=null }={}) {
  const manager = Manager().forLevelChange(actor, classItem.id, 1, foundry.utils.deepClone(MANAGER_OPTIONS));
  if ( !manager.steps.length ) {
    await classItem.update({ "system.levels": classItem.system.levels + 1 });
    return true;
  }
  return drive(manager, { capture: false, answers: makeAnswers({ subclassUuid }) });
}

/** Add a first level of a new class (multiclassing) to a saved character. */
export async function addNewClass(actor, classDoc, { subclassUuid=null }={}) {
  const data = foundry.utils.mergeObject(itemDataFrom(classDoc), { "system.levels": 1 }, { inplace: false });
  const manager = Manager().forNewItem(actor, data, foundry.utils.deepClone(MANAGER_OPTIONS));
  if ( !manager.steps.length ) {
    await actor.createEmbeddedDocuments("Item", [data]);
    return true;
  }
  return drive(manager, { capture: false, answers: makeAnswers({ subclassUuid }) });
}
