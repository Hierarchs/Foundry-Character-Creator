// Compile the module's compendium packs with the official Foundry CLI.
// Usage: node tools/build-packs.mjs   (set FVTT_CLI to the CLI's entry file if it isn't installed locally)
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { birthsignItems } from "./birthsigns.mjs";

const cli = await import(process.env.FVTT_CLI ? pathToFileURL(process.env.FVTT_CLI).href : "@foundryvtt/foundryvtt-cli");
const PACKS = { birthsigns: birthsignItems() };

for ( const [name, docs] of Object.entries(PACKS) ) {
  const src = join("build", "packs", name);
  const dest = join("module", "packs", name);
  await rm(src, { recursive: true, force: true });
  await rm(dest, { recursive: true, force: true });
  await mkdir(src, { recursive: true });
  for ( const doc of docs ) await writeFile(join(src, `${doc._id}.json`), JSON.stringify(doc, null, 2));
  await cli.compilePack(src, dest, { log: false });
  console.log(`pack  ${dest} (${docs.length} documents)`);
}
