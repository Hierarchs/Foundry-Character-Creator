/**
 * Loader and thin JS facade for the Rust rules engine (genesis_rules.wasm).
 *
 * The wasm module exposes a four-function C ABI and speaks JSON, so there is no generated glue:
 * we copy the request into linear memory, call `genesis_call`, and read the response back out.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** @type {WebAssembly.Exports|null} */
let exports = null;

/**
 * Instantiate the engine. Safe to call more than once.
 * @param {string|URL|ArrayBuffer|Uint8Array} source  URL of the .wasm file, or its bytes.
 * @returns {Promise<void>}
 */
export async function initRules(source) {
  if ( exports ) return;
  let bytes = source;
  if ( (typeof source === "string") || (source instanceof URL) ) {
    // fetch + instantiate (not instantiateStreaming) so a server sending the wrong MIME type still works.
    const response = await fetch(source);
    if ( !response.ok ) throw new Error(`Could not load rules engine from ${source} (${response.status})`);
    bytes = await response.arrayBuffer();
  }
  const { instance } = await WebAssembly.instantiate(bytes, {});
  exports = instance.exports;
}

/** @returns {boolean} */
export function rulesReady() {
  return exports !== null;
}

/**
 * Run one rules command.
 * @param {string} cmd   Command name (see rules/src/api.rs).
 * @param {*} [args]     JSON-serializable arguments.
 * @returns {*}          The command's `data` payload.
 * @throws {Error}       If the engine is not loaded or the command fails.
 */
export function callRules(cmd, args={}) {
  if ( !exports ) throw new Error("Character Genesis rules engine is not loaded");
  const input = encoder.encode(JSON.stringify({ cmd, args }));
  const inPtr = exports.genesis_alloc(input.length);
  new Uint8Array(exports.memory.buffer, inPtr, input.length).set(input);
  let outPtr = 0;
  let outLen = 0;
  try {
    outPtr = exports.genesis_call(inPtr, input.length);
    outLen = exports.genesis_result_len();
    // Copy before freeing: memory.buffer can be detached by growth on the next allocation.
    const text = decoder.decode(new Uint8Array(exports.memory.buffer, outPtr, outLen).slice());
    const response = JSON.parse(text);
    if ( !response.ok ) throw new Error(`Rules engine: ${response.error}`);
    return response.data;
  } finally {
    exports.genesis_free(inPtr, Math.max(input.length, 1));
    if ( outPtr ) exports.genesis_free(outPtr, Math.max(outLen, 1));
  }
}

/* -------------------------------------------- */
/*  Typed helpers                               */
/* -------------------------------------------- */

/** Rules facade used throughout the module. Each method maps to one command in rules/src/api.rs. */
export const Rules = {
  version: () => callRules("version").version,
  modifier: score => callRules("modifier", Number(score) || 0),
  pointBuy: (scores, { budget, costs }={}) => callRules("pointBuy", { scores, budget, costs }),
  assign: (assignment, values) => callRules("assign", { assignment, values }),
  rolledSets: (sets, dropLowest=1) => callRules("rolledSets", { sets, dropLowest }),
  manualScores: (scores, min, max) => callRules("manualScores", { scores, min, max }),
  finalScores: (base, bonuses={}, cap=20) => callRules("finalScores", { base, bonuses, cap }),
  spellSlots: (classes, rules) => callRules("spellSlots", { classes, rules }),
  spellLimits: args => callRules("spellLimits", args),
  maxSpellLevel: (progression, level, rules) => callRules("maxSpellLevel", { progression, level, rules }),
  spellRuleDefaults: rules => callRules("spellRuleDefaults", { rules }),
  multiclassCheck: args => callRules("multiclassCheck", args),
  resolveEquipment: (entries, selection) => callRules("resolveEquipment", { entries, selection }),
  proficiencyBonus: level => callRules("proficiencyBonus", { level }),
  xpForLevel: level => callRules("xpForLevel", { level }),
  hitPoints: args => callRules("hitPoints", args)
};
