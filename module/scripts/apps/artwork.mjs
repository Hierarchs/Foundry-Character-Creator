/**
 * GM editor for splash art / background video per class, subclass, species, and background.
 * Overrides are stored by `type:identifier` so they apply to every reprint of the same option.
 */
import { MODULE_ID, TEMPLATES } from "../constants.mjs";
import { getEntries } from "../data/compendium.mjs";
import { artKey, resolveArt } from "../data/art.mjs";
import { isVideo, t } from "../utils.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const GROUPS = [["class", "class"], ["subclass", "subclass"], ["race", "species"], ["background", "background"]];
const POSITIONS = ["center", "top", "bottom", "left", "right"];

export default class ArtworkConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "genesis-artwork",
    classes: ["genesis-config", "genesis-artwork"],
    tag: "div",
    window: { title: "GENESIS.Artwork.Title", icon: "fa-solid fa-image", resizable: true },
    position: { width: 900, height: 760 },
    actions: {
      browseArt: ArtworkConfig.#onBrowse,
      clearArt: ArtworkConfig.#onClear,
      artTab: ArtworkConfig.#onTab
    }
  };

  static PARTS = {
    body: { template: TEMPLATES.artwork, scrollable: [".art-list"] }
  };

  #tab = "class";

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const overrides = game.settings.get(MODULE_ID, "artwork") ?? {};
    const [type, label] = GROUPS.find(([g]) => g === this.#tab);
    const entries = await getEntries(type);
    const rows = entries.map(entry => {
      const key = artKey(entry);
      const override = overrides[key] ?? {};
      const art = resolveArt(entry, null);
      return {
        key,
        name: entry.name,
        img: entry.img,
        book: entry.book,
        src: override.src ?? "",
        figure: override.figure ?? "",
        figurePreview: art.figure,
        preview: art.src,
        video: isVideo(art.src),
        source: art.source ? t(`Artwork.Source.${art.source}`) : t("Artwork.Source.none"),
        positions: POSITIONS.map(p => ({ value: p, label: t(`Artwork.Position.${p}`), selected: (override.position ?? "center") === p }))
      };
    });
    return Object.assign(context, {
      tabs: GROUPS.map(([g, l]) => ({ id: g, label: t(`Steps.${l}`), active: g === this.#tab })),
      rows,
      groupLabel: t(`Steps.${label}`)
    });
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.element.querySelectorAll("[data-art-key]").forEach(row => {
      row.querySelectorAll("input[name=src], input[name=figure], select[name=position]").forEach(input => {
        input.addEventListener("change", () => this.#save(row.dataset.artKey, this.#read(row)));
      });
    });
  }

  #read(row) {
    return {
      src: row.querySelector("input[name=src]").value.trim(),
      figure: row.querySelector("input[name=figure]").value.trim(),
      position: row.querySelector("select[name=position]").value
    };
  }

  async #save(key, value) {
    const all = foundry.utils.deepClone(game.settings.get(MODULE_ID, "artwork") ?? {});
    if ( !value.figure ) delete value.figure;
    if ( !value.src && !value.figure ) delete all[key];
    else all[key] = value;
    await game.settings.set(MODULE_ID, "artwork", all);
    this.render();
  }

  static #onTab(event, target) {
    this.#tab = target.dataset.tab;
    this.render();
  }

  static #onBrowse(event, target) {
    const row = target.closest("[data-art-key]");
    const field = target.dataset.field ?? "src";
    const input = row.querySelector(`input[name=${field}]`);
    const FilePicker = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
    const picker = new FilePicker({
      type: field === "figure" ? "image" : "imagevideo",
      current: input.value,
      callback: path => {
        input.value = path;
        this.#save(row.dataset.artKey, this.#read(row));
      }
    });
    return picker.browse?.() ?? picker.render(true);
  }

  static #onClear(event, target) {
    return this.#save(target.closest("[data-art-key]").dataset.artKey, { src: "", figure: "" });
  }
}
