/**
 * GM menu for pointing the wizard at specific compendium packs. Each Item pack is listed with what it
 * contains; the checked packs become the only source for every category they cover, and anything they
 * don't cover (e.g. weapons for "any martial weapon" picks) falls back to all sources automatically.
 */
import { MODULE_ID, TEMPLATES } from "../constants.mjs";
import { t } from "../utils.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const GEAR = new Set(["weapon", "equipment", "tool", "consumable", "container", "loot"]);
const CHIPS = ["class", "subclass", "race", "background", "spell", "feat", "gear"];
const CHARACTER_TYPES = ["class", "subclass", "race", "background", "spell", "feat"];

function packageTitle(pack) {
  const { packageName, packageType } = pack.metadata;
  if ( packageType === "system" ) return game.system.title ?? packageName;
  if ( packageType === "world" ) return game.world.title ?? packageName;
  return game.modules.get(packageName)?.title ?? packageName;
}

export default class SourcesConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "genesis-sources",
    classes: ["genesis-config", "genesis-sources"],
    tag: "div",
    window: { title: "GENESIS.Sources.Title", icon: "fa-solid fa-books", resizable: true },
    position: { width: 760, height: 720 },
    actions: {
      autoDetect: SourcesConfig.#onAutoDetect,
      selectAll: SourcesConfig.#onSelectAll,
      clearAll: SourcesConfig.#onClearAll,
      saveSources: SourcesConfig.#onSave
    }
  };

  static PARTS = {
    body: { template: TEMPLATES.sources, scrollable: [".source-list"] }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const selected = new Set(game.settings.get(MODULE_ID, "packs") ?? []);
    const packs = game.packs.filter(p => p.metadata.type === "Item");
    const rows = await Promise.all(packs.map(async pack => {
      const counts = {};
      for ( const entry of await pack.getIndex() ) {
        const key = GEAR.has(entry.type) ? "gear" : entry.type;
        counts[key] = (counts[key] ?? 0) + 1;
      }
      return {
        id: pack.collection,
        label: pack.metadata.label,
        packageTitle: packageTitle(pack),
        packageType: pack.metadata.packageType,
        checked: selected.has(pack.collection),
        character: CHARACTER_TYPES.some(k => counts[k]),
        chips: CHIPS.filter(k => counts[k]).map(k => ({ key: k, label: t(`Sources.Types.${k}`), count: counts[k] }))
      };
    }));

    // Group by package: modules and the world first (where books and homebrew live), then the system.
    const order = { module: 0, world: 1, system: 2 };
    const groups = new Map();
    for ( const row of rows.sort((a, b) => (order[a.packageType] ?? 3) - (order[b.packageType] ?? 3)
      || a.packageTitle.localeCompare(b.packageTitle) || a.label.localeCompare(b.label)) ) {
      if ( !groups.has(row.packageTitle) ) groups.set(row.packageTitle, { title: row.packageTitle, packs: [] });
      groups.get(row.packageTitle).packs.push(row);
    }
    return Object.assign(context, {
      groups: Array.from(groups.values()),
      status: selected.size ? t("Sources.StatusSome", { count: selected.size }) : t("Sources.StatusNone")
    });
  }

  #checkboxes() {
    return Array.from(this.element.querySelectorAll("input[name=pack]"));
  }

  static #onAutoDetect() {
    for ( const box of this.#checkboxes() ) box.checked = box.dataset.character === "true";
  }

  static #onSelectAll() {
    for ( const box of this.#checkboxes() ) box.checked = true;
  }

  static #onClearAll() {
    for ( const box of this.#checkboxes() ) box.checked = false;
  }

  static async #onSave() {
    const packs = this.#checkboxes().filter(b => b.checked).map(b => b.value);
    await game.settings.set(MODULE_ID, "packs", packs);
    ui.notifications.info(packs.length ? t("Sources.StatusSome", { count: packs.length }) : t("Sources.StatusNone"));
    return this.close();
  }
}
