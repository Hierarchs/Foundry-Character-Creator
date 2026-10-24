// Builds dev/fixtures/srd.json for the browser harness from a dnd5e system checkout.
//
// The data is the SRD 5.2 content shipped with the dnd5e system (CC-BY-4.0, Wizards of the Coast).
// It is only used by the dev harness and is never packaged into the module.
//
// Usage: node dev/tools/build-fixtures.mjs <dnd5e-checkout> <folder containing node_modules/js-yaml>
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const [repo, yamlHome] = process.argv.slice(2);
if ( !repo || !yamlHome ) {
  console.error("usage: node dev/tools/build-fixtures.mjs <dnd5e-checkout> <js-yaml install dir>");
  process.exit(2);
}
const yaml = createRequire(join(yamlHome, "package.json"))("js-yaml");
const here = dirname(fileURLToPath(import.meta.url));
const PACKS = ["classes24", "origins24", "feats24", "spells24", "equipment24"];
const KEEP = [
  "identifier", "description", "source", "hd", "spellcasting", "primaryAbility", "startingEquipment", "wealth",
  "advancement", "classIdentifier", "type", "movement", "senses", "level", "school", "properties", "activation",
  "range", "duration", "materials", "rarity", "price", "quantity", "levels", "method", "prepared", "armor"
];

async function walk(dir) {
  const out = [];
  for ( const entry of await readdir(dir, { withFileTypes: true }) ) {
    const path = join(dir, entry.name);
    if ( entry.isDirectory() ) out.push(...await walk(path));
    else if ( entry.name.endsWith(".yml") && !entry.name.startsWith("_") ) out.push(path);
  }
  return out;
}

const items = [];
for ( const pack of PACKS ) {
  for ( const file of await walk(join(repo, "packs/_source", pack)) ) {
    const doc = yaml.load(await readFile(file, "utf8"));
    if ( !doc?._id || !doc.type ) continue;
    const system = {};
    for ( const key of KEEP ) if ( key in (doc.system ?? {}) ) system[key] = doc.system[key];
    if ( system.description?.value?.length > 8000 ) system.description.value = `${system.description.value.slice(0, 8000)}…`;
    items.push({
      _id: doc._id,
      uuid: `Compendium.dnd5e.${pack}.Item.${doc._id}`,
      pack: `dnd5e.${pack}`,
      name: doc.name,
      type: doc.type,
      img: doc.img,
      system
    });
  }
}

// Class spell lists from the SRD chapter 7 journal.
const spellLists = {};
const journal = yaml.load(await readFile(join(repo, "packs/_source/content24/chapter-7/spells.yml"), "utf8"));
for ( const page of journal.pages ?? [] ) {
  if ( page.type !== "spells" ) continue;
  spellLists[`${page.system.type}:${page.system.identifier}`] = page.system.spells ?? [];
}

await mkdir(join(here, "../fixtures"), { recursive: true });
const target = join(here, "../fixtures/srd.json");
await writeFile(target, JSON.stringify({
  attribution: "System Reference Document 5.2 by Wizards of the Coast LLC, licensed CC-BY-4.0, via the dnd5e Foundry system.",
  items,
  spellLists
}));
const counts = items.reduce((c, i) => (c[i.type] = (c[i.type] ?? 0) + 1, c), {});
console.log(`wrote ${items.length} items`, counts, `and ${Object.keys(spellLists).length} spell lists`);
