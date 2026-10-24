/**
 * Wizard state: plain JSON so it can be saved as a draft and resumed later.
 */
import { ABILITY_KEYS, MODULE_ID } from "../constants.mjs";
import { setting } from "../utils.mjs";

export const STATE_VERSION = 1;

const eights = () => Object.fromEntries(ABILITY_KEYS.map(k => [k, 8]));
const tens = () => Object.fromEntries(ABILITY_KEYS.map(k => [k, 10]));
const unassigned = () => Object.fromEntries(ABILITY_KEYS.map(k => [k, null]));

function firstMethod() {
  if ( setting("abilityPointBuy") ) return "pointBuy";
  if ( setting("abilityStandardArray") ) return "standardArray";
  if ( setting("abilityRoll") ) return "roll";
  return "manual";
}

export function defaultState(mode="create", actor=null) {
  return {
    version: STATE_VERSION,
    mode,
    actorId: actor?.id ?? null,
    step: mode === "create" ? "class" : "levelupClass",
    visited: [],
    level: setting("startingLevel") ?? 1,
    class: null,
    subclass: null,
    background: null,
    species: null,
    abilities: {
      method: firstMethod(),
      confirmed: false,
      pointBuy: eights(),
      standardArray: unassigned(),
      roll: { sets: null, assignment: unassigned(), rerolls: 0 },
      manual: tens()
    },
    build: null,
    buildKey: null,
    spells: {},
    equipment: {
      class: { mode: "items", choices: {}, picks: {}, gold: null },
      background: { mode: "items", choices: {}, picks: {}, gold: null }
    },
    details: {
      name: "",
      img: "",
      tokenImg: "",
      sameToken: true,
      ownerId: null,
      alignment: "",
      gender: "",
      age: "",
      height: "",
      weight: "",
      eyes: "",
      hair: "",
      skin: "",
      faith: "",
      appearance: "",
      trait: "",
      ideal: "",
      bond: "",
      flaw: "",
      backstory: ""
    },
    levelup: { target: null, applied: false }
  };
}

function draftKey(mode, actorId) {
  return [MODULE_ID, "draft", game.world?.id, game.user?.id, mode, actorId ?? ""].join(".");
}

export function loadDraft(mode="create", actorId=null) {
  try {
    const raw = globalThis.localStorage?.getItem(draftKey(mode, actorId));
    const state = raw ? JSON.parse(raw) : null;
    return state?.version === STATE_VERSION ? state : null;
  } catch {
    return null;
  }
}

export function saveDraft(state) {
  try {
    globalThis.localStorage?.setItem(draftKey(state.mode, state.actorId), JSON.stringify(state));
  } catch(err) {
    // Storage can be full or blocked; the wizard still works without drafts.
    console.warn("Character Genesis | could not save draft", err);
  }
}

export function clearDraft(mode="create", actorId=null) {
  try {
    globalThis.localStorage?.removeItem(draftKey(mode, actorId));
  } catch { /* ignore */ }
}

/** True if the player has made any meaningful choice worth confirming before exit. */
export function hasProgress(state) {
  return !!(state.class || state.background || state.species || state.build || state.details?.name
    || state.levelup?.target);
}
