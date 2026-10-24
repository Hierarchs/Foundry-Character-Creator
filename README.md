# Character Genesis

A cinematic, full-screen character creator and level-up wizard for **Foundry VTT V14** and the
**dnd5e** system (5.2+, verified against 6.0.6).

- **Cinematic flow.** Class → Subclass → Background → Species → Abilities → Features & Choices →
  Spells → Equipment → Details → Review. The order follows the Player's Handbook, with splash art or
  background video behind every option.
- **Point it at your packs.** In *Content Sources*, tick the compendium packs to use (or press
  *Auto-detect*) and the wizard handles the rest. Book modules, D&D Beyond imports, homebrew, and the
  SRD all work, and nothing is hard-coded. Any category your packs don't cover (e.g. weapons for
  equipment picks) falls back to all packs, and premium copies win over SRD reprints.
- **Class art.** 21 transparent character figures ship with the module and stand in front of the scene
  on the class screen. Matching identifiers (bard, monk, rogue, spellsword, nightblade…) are picked up
  automatically, and core classes use aliases (wizard → mage, fighter → warrior, cleric → healer,
  paladin → crusader, ranger → scout, druid → pilgrim, warlock → nightblade, artificer → battlemage).
- **Two themes.** *Cinematic* (dark and gold) or *Oblivion*: parchment pages, inked IM Fell type, and
  bronze double-line frames inspired by The Elder Scrolls IV: Oblivion's menus. Pick it with the
  **Theme** setting; it switches live.
- **Scene backdrops.** Each step has its own landscape (sewers → Ayleid ruins → Shivering Isles →
  Cloud Ruler → Kvatch → the Imperial City for the review). Art assigned to a specific option still
  wins. Reassign scenes in `module/scripts/data/backdrops.mjs`, or turn off *Scene Backdrops*.
- **Native Advancement.** Background, species, and class are applied by dnd5e's own
  `AdvancementManager`, so skills, languages, feats, fighting styles, and expertise work for any content
  that uses standard Advancements. The wizard pre-answers what it already knows (subclass, hit points),
  and everything else appears as the system's own step dialogs, themed to match.
- **Level-up & multiclassing.** Advance an existing class or take a new one, with multiclass
  prerequisites checked. Subclass and new spells are chosen in the same cinematic UI.
- **Spell gallery.** Card-based browsing, search, and level/school filters. Limits come from the
  class's own data, falling back to SRD tables; GMs can override them per class.
- **Starting equipment.** Class and background packages with "choose A or B" options and "any
  martial weapon" style picks, or starting gold instead.
- **Rust rules engine.** Point buy, standard array, rolled sets, spell slots and limits, multiclass
  prerequisites, starting-equipment resolution, HP, and XP all run in a Rust → WebAssembly module
  with 43 unit tests.

## Layout

```
rules/        Rust rules engine (compiled to module/wasm/genesis_rules.wasm)
xtask/        Rust build tool: build, package, install, dev server
module/       The Foundry module itself (this folder is what gets installed)
  scripts/    ES modules: wizard app, steps, compendium/art access, advancement driver
  templates/  Handlebars templates
  styles/     genesis.css
  wasm/       Built rules engine
dev/          Browser harness with a mock Foundry runtime + SRD 5.2 fixtures (not shipped)
```

## Building

Requires Rust with the wasm target (`rustup target add wasm32-unknown-unknown`).

```bash
cargo test -p genesis-rules
```

```bash
cargo xtask build
```

`cargo xtask build` compiles the engine and copies it to `module/wasm/`. To produce an installable zip
(`dist/character-genesis.zip` plus `dist/module.json`):

```bash
cargo xtask package
```

## Installing

**Hosted server (The Forge, Molten, a VPS, etc.):** run `cargo xtask package`. Then either upload
`dist/character-genesis.zip` with your host's module/file importer, or unzip it into
`Data/modules/character-genesis/` on the server. Restart the world and enable **Character Genesis** in
*Manage Modules*.

**Install by manifest URL:** `module.json` already points at this repo's latest GitHub release.
Attach `dist/module.json` and `dist/character-genesis.zip` to a release. Then paste this into Foundry's
*Install Module* dialog:
`https://github.com/Hierarchs/Foundry-Character-Creator/releases/latest/download/module.json`

**Local Foundry:** copy the module into a local Data folder (it defaults to `%LOCALAPPDATA%\FoundryVTT\Data`):

```bash
cargo xtask install "C:\path\to\FoundryVTT\Data"
```

## Using it

- **Create Character** button at the top of the Actors sidebar.
- Players without a character are offered the wizard when they log in. This can be turned off.
- **Level Up (Genesis)** in a character sheet's header menu, or right-click a character in the sidebar.
- Macros: `CharacterGenesis.create()` and `CharacterGenesis.levelUp(actor)`.

Players who lack Foundry's *Create New Actors* permission can still finish the wizard. An online GM's
client creates the actor and gives them ownership (setting: *Create Through GM*).

## GM configuration

*Configure Settings → Character Genesis* covers rules edition, starting level, allowed ability
methods, point-buy budget, rerolls, HP after level 1, multiclass prerequisites, starting gold,
default backdrop, the character folder, and more. It also has three menus:

- **Content Sources.** Lists every Item compendium with what it contains (classes, subclasses,
  species, backgrounds, spells, feats, equipment). Ticked packs are the only source for the categories
  they contain and are shown whatever the Rules Edition setting says. With nothing ticked, the wizard
  uses dnd5e's Compendium Browser sources.
- **Spell Rules.** Per class: casting type (known / prepared / pact / spellbook), progression, the
  spell list to draw from, replacements per level, and the cantrip and spell counts for levels 1–20.
  Saved rules override both the class data and the built-in tables.
- **Artwork.** A backdrop image or webm/mp4 video and a character figure for any class, subclass,
  species, or background, plus focal position. Overrides are keyed by identifier, so they apply to
  every reprint. The default figure aliases live in `module/scripts/data/bundled-art.mjs`.

### Where the content and art come from

- Options come from dnd5e's Compendium Browser index, so the GM's *Compendium Browser Sources* setting
  also controls what the wizard shows. *Rules Edition* filters 2014 / 2024 content.
- Spell lists come from dnd5e's spell-list registry (`class:wizard`, ...), which the SRD and official
  books populate. A class without a registered list shows all spells and suggests setting one in Spell
  Rules.
- Art is resolved in this order:
  1. a GM override;
  2. an `art` flag on the item (`flags["character-genesis"].art`);
  3. any module answering the `characterGenesis.resolveArt` hook;
  4. the first image in the item's description;
  5. the default backdrop.

  Official book modules that embed art in their descriptions are picked up automatically. Otherwise,
  use the Artwork menu.

## Development harness

`cargo xtask serve` builds the engine and serves the repo at <http://localhost:30777/>. The harness
loads the real module code on top of a small mock of Foundry/dnd5e (`dev/foundry-shim.mjs`) with
1,287 SRD 5.2 items, so every screen can be clicked through in a normal browser. The mock advancement
manager auto-completes; in Foundry the real dnd5e dialogs appear instead.

To regenerate the fixtures from a dnd5e checkout:

```bash
node dev/tools/build-fixtures.mjs <dnd5e-checkout> <folder-with-js-yaml>
```

## Status and known gaps

- Built against the dnd5e 6.0.6 source and exercised end to end in the harness. It has **not yet run
  on a live V14 server**, so expect small API mismatches on first load. Check the browser console
  (F12) for `Character Genesis |` messages.
- On level-up, classes that may swap spells (bard, sorcerer, warlock, ...; set per class in Spell
  Rules → Replace / Level) can mark known spells to forget and pick replacements.
- Starting gear marked "if proficient" is only granted when the character has that weapon, armor, or
  tool proficiency; otherwise it's shown struck through.

## License

Code is MIT (see `LICENSE`). The dev fixtures contain SRD 5.2 material (CC-BY-4.0) and are not
part of the packaged module.
