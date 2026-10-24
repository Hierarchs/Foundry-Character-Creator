// Smoke test: load the real genesis_rules.wasm through the module's own loader in Node.
// Run with: node dev/wasm-smoke.mjs
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { initRules, Rules, callRules } from "../module/scripts/rules.mjs";

const bytes = await readFile(new URL("../module/wasm/genesis_rules.wasm", import.meta.url));
await initRules(bytes);

const pb = Rules.pointBuy({ str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 });
assert.equal(pb.spent, 27);
assert.equal(pb.remaining, 0);
assert.equal(pb.abilities.str.mod, 2);

const arr = Rules.assign({ str: 0, dex: 1, con: 2, int: 3, wis: 4, cha: 5 });
assert.equal(arr.valid, true);
assert.equal(arr.scores.cha, 8);

const limits = Rules.spellLimits({ identifier: "wizard", level: 1, rules: "2024", abilityMod: 3 });
assert.deepEqual([limits.cantrips, limits.spells, limits.spellbook, limits.maxSpellLevel], [3, 4, 6, 1]);

const slots = Rules.spellSlots([{ progression: "full", levels: 3 }, { progression: "pact", levels: 2 }], "2024");
assert.deepEqual(slots.slots.slice(0, 2), [4, 2]);
assert.deepEqual(slots.pact, { slots: 2, level: 1 });

const mc = Rules.multiclassCheck({
  abilities: { str: 15, dex: 10, con: 14, int: 9, wis: 10, cha: 8 },
  current: [{ identifier: "fighter", primary: ["str", "dex"], all: false }],
  target: { identifier: "wizard", label: "Wizard", primary: ["int"], all: false }
});
assert.equal(mc.ok, false);
assert.equal(mc.failures[0].identifier, "wizard");

assert.throws(() => callRules("nope"), /Unknown rules command/);

// Hammer the allocator to make sure buffers are freed and memory growth is handled.
for ( let i = 0; i < 20000; i++ ) Rules.pointBuy({ str: 8 + (i % 8) });
console.log(`rules engine v${Rules.version()} OK`);
