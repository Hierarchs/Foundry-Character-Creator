/**
 * Cinematic gallery steps: Class, Subclass, Background, Species.
 * One entry is "focused" while browsing (arrow keys / carousel); "Confirm Selection" commits it.
 */
import Step from "./base.mjs";
import { GALLERY_TYPES, TEMPLATES } from "../../constants.mjs";
import { getDocument, getEntries, getSubclasses } from "../../data/compendium.mjs";
import { resolveArt } from "../../data/art.mjs";
import { describe } from "../../data/describe.mjs";
import { centerInScroller, setting, t, worldRules } from "../../utils.mjs";

export class GalleryStep extends Step {
  static template = TEMPLATES.gallery;

  /** @type {"class"|"subclass"|"background"|"species"} */
  static kind;

  focus = null;
  drawer = false;
  /** Carousel filter text and whether the carousel is expanded into a grid of every option. */
  search = "";
  expanded = false;
  #stage = null;
  #entries = null;
  #entriesKey = null;

  get kind() {
    return this.constructor.kind;
  }

  get selected() {
    return this.state[this.kind];
  }

  set selected(uuid) {
    this.state[this.kind] = uuid;
  }

  get complete() {
    return !!this.selected;
  }

  get incompleteMessage() {
    return t(`Gallery.${this.kind}.Incomplete`);
  }

  /** Changes whenever the list of entries must be reloaded. */
  get entriesKey() {
    return this.kind;
  }

  async loadEntries() {
    return getEntries(GALLERY_TYPES[this.kind]);
  }

  async entries() {
    const key = this.entriesKey;
    if ( !this.#entries || (this.#entriesKey !== key) ) {
      this.#entries = await this.loadEntries();
      this.#entriesKey = key;
    }
    return this.#entries;
  }

  async focusEntry() {
    const entries = await this.entries();
    return entries.find(e => e.uuid === this.focus) ?? entries.find(e => e.uuid === this.selected) ?? entries[0] ?? null;
  }

  async onEnter() {
    const entry = await this.focusEntry();
    this.focus = entry?.uuid ?? null;
  }

  /** Extra controls under the title (e.g. the starting level picker). */
  async extras() {
    return null;
  }

  async prepare() {
    const entries = await this.entries();
    const entry = await this.focusEntry();
    this.focus = entry?.uuid ?? null;
    const doc = entry ? await getDocument(entry.uuid) : null;
    const info = await describe(doc);
    this.#prefetch(entries, entry);
    const books = new Set(entries.map(e => e.book));
    const index = entries.indexOf(entry);
    return {
      kind: this.kind,
      heading: t(`Gallery.${this.kind}.Heading`),
      empty: !entries.length,
      emptyHint: t(`Gallery.${this.kind}.Empty`),
      entries: entries.map(e => ({
        uuid: e.uuid,
        name: e.name,
        img: e.img,
        focused: e.uuid === entry?.uuid,
        selected: e.uuid === this.selected,
        book: books.size > 1 ? e.book : "",
        search: `${e.name} ${books.size > 1 ? e.book : ""}`.toLowerCase()
      })),
      search: this.search,
      expanded: this.expanded,
      focus: entry ? {
        uuid: entry.uuid,
        name: entry.name,
        img: entry.img,
        book: entry.book,
        rules: entry.rules,
        isSelected: entry.uuid === this.selected,
        figure: resolveArt(entry, doc).figure,
        ...info
      } : null,
      position: entries.length ? `${index + 1} / ${entries.length}` : "",
      drawer: this.drawer,
      extras: await this.extras(entry, doc)
    };
  }

  /** Warm the cache for neighbours so arrowing through the gallery feels instant. */
  #prefetch(entries, entry) {
    const i = entries.indexOf(entry);
    for ( const offset of [-1, 1] ) {
      const neighbour = entries[(i + offset + entries.length) % entries.length];
      if ( neighbour ) getDocument(neighbour.uuid).catch(() => {});
    }
  }

  async backdrop() {
    const entry = await this.focusEntry();
    if ( !entry ) return null;
    return resolveArt(entry, await getDocument(entry.uuid));
  }

  async onAction(action, event, target) {
    switch ( action ) {
      case "focus":
        // Picking from the full grid returns to the cinematic view of that option.
        if ( this.expanded ) {
          this.expanded = false;
          this.search = "";
          if ( target.dataset.uuid === this.focus ) return this.app.refresh();
        }
        return this.setFocus(target.dataset.uuid);
      case "cycle": return this.cycle(Number(target.dataset.dir) || 1);
      case "expand":
        this.expanded = !this.expanded;
        this.#stage?.querySelector(".genesis-gallery")?.classList.toggle("expanded", this.expanded);
        target.setAttribute("aria-pressed", String(this.expanded));
        if ( this.expanded ) this.#stage?.querySelector("[name=gallerySearch]")?.focus();
        return;
      case "drawer":
        this.drawer = !this.drawer;
        return this.app.refresh();
      case "confirm": return this.confirm();
    }
  }

  async setFocus(uuid) {
    if ( !uuid || (uuid === this.focus) ) return;
    this.focus = uuid;
    await this.app.refresh();
  }

  async cycle(direction) {
    const entries = await this.entries();
    if ( !entries.length ) return;
    const i = entries.findIndex(e => e.uuid === this.focus);
    const next = entries[(i + direction + entries.length) % entries.length];
    return this.setFocus(next.uuid);
  }

  async confirm() {
    if ( !this.focus ) return;
    const changed = this.selected !== this.focus;
    this.selected = this.focus;
    if ( changed ) this.onSelectionChanged();
    await this.app.syncDocs();
    await this.app.next();
  }

  /** Reset anything that depended on the previous choice. */
  onSelectionChanged() {
    this.app.invalidateBuild();
  }

  /** Jump to the first / last / ±5th visible (search-matching) option. */
  async jump(where) {
    const visible = this.#visibleUuids();
    if ( !visible.length ) return;
    const i = Math.max(0, visible.indexOf(this.focus));
    const target = { first: 0, last: visible.length - 1, back: Math.max(0, i - 5), forward: Math.min(visible.length - 1, i + 5) }[where];
    return this.setFocus(visible[target]);
  }

  #visibleUuids() {
    return Array.from(this.#stage?.querySelectorAll(".genesis-thumb:not([hidden])") ?? []).map(t => t.dataset.uuid);
  }

  onKey(event) {
    switch ( event.key ) {
      case "ArrowLeft": this.cycle(-1); return true;
      case "ArrowRight": this.cycle(1); return true;
      case "Home": this.jump("first"); return true;
      case "End": this.jump("last"); return true;
      case "PageUp": this.jump("back"); return true;
      case "PageDown": this.jump("forward"); return true;
      case "Enter": this.confirm(); return true;
      case "Escape":
        if ( !this.expanded ) return false;
        this.onAction("expand", event, this.#stage.querySelector("[data-action=expand]"));
        return true;
      default: {
        // Typing a letter anywhere in the gallery starts a search.
        const input = this.#stage?.querySelector("[name=gallerySearch]");
        if ( !input || (event.key.length !== 1) || event.ctrlKey || event.metaKey || event.altKey ) return false;
        input.focus();
        input.value += event.key;
        this.search = input.value;
        this.#applySearch();
        return true;
      }
    }
  }

  onInput(event) {
    if ( event.target.name !== "gallerySearch" ) return;
    this.search = event.target.value;
    this.#applySearch();
  }

  #applySearch() {
    const query = this.search.trim().toLowerCase();
    for ( const thumb of this.#stage?.querySelectorAll(".genesis-thumb") ?? [] ) {
      thumb.hidden = !!query && !thumb.dataset.search.includes(query);
    }
  }

  activate(element) {
    this.#stage = element;
    this.#applySearch();
    const track = element.querySelector(".genesis-carousel-track");
    centerInScroller(track, element.querySelector(".genesis-thumb.focused"));
    // A vertical mouse wheel scrolls the strip sideways (the grid view scrolls normally).
    track?.addEventListener("wheel", event => {
      if ( this.expanded || (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) ) return;
      track.scrollLeft += event.deltaY;
      event.preventDefault();
    }, { passive: false });
    const input = element.querySelector("[name=gallerySearch]");
    input?.addEventListener("keydown", event => {
      if ( event.key === "Enter" ) {
        event.preventDefault();
        event.stopPropagation();
        const first = this.#visibleUuids()[0];
        if ( !first ) return;
        this.expanded = false;
        this.search = "";
        if ( first === this.focus ) this.app.refresh();
        else this.setFocus(first);
      } else if ( event.key === "Escape" ) {
        event.stopPropagation();
        input.value = "";
        this.search = "";
        this.#applySearch();
        input.blur();
      }
    });
  }
}

/* -------------------------------------------- */

export class ClassStep extends GalleryStep {
  static id = "class";
  static kind = "class";

  get available() {
    return this.app.mode === "create";
  }

  async extras() {
    if ( !setting("allowLevelChoice") ) return null;
    const max = Math.max(1, setting("maxStartingLevel") ?? 20);
    return {
      levelPicker: true,
      levels: Array.from({ length: max }, (_, i) => ({ value: i + 1, selected: (i + 1) === this.state.level }))
    };
  }

  onSelectionChanged() {
    super.onSelectionChanged();
    this.state.subclass = null;
    this.state.equipment.class = { mode: "items", choices: {}, picks: {}, gold: null };
  }

  async onInput(event) {
    if ( event.target.name !== "level" ) return super.onInput(event);
    this.state.level = Math.clamp?.(Number(event.target.value), 1, 20) ?? Number(event.target.value);
    this.app.invalidateBuild();
    await this.app.syncDocs();
    await this.app.refresh({ chrome: true });
  }
}

export class SubclassStep extends GalleryStep {
  static id = "subclass";
  static kind = "subclass";

  get classIdentifier() {
    if ( this.app.mode === "levelup" ) return this.state.levelup.identifier;
    const cls = this.app.docs.class;
    return cls?.identifier ?? cls?.system.identifier ?? null;
  }

  get available() {
    if ( this.app.mode === "levelup" ) return !!this.app.levelup?.subclassUnlock;
    return this.app.subclassUnlocked;
  }

  get entriesKey() {
    return `subclass:${this.classIdentifier}`;
  }

  async loadEntries() {
    return this.classIdentifier ? getSubclasses(this.classIdentifier) : [];
  }

  get canGoBack() {
    return (this.app.mode !== "levelup") || !this.state.levelup.applied;
  }
}

export class BackgroundStep extends GalleryStep {
  static id = "background";
  static kind = "background";

  get available() {
    return this.app.mode === "create";
  }

  onSelectionChanged() {
    super.onSelectionChanged();
    this.state.equipment.background = { mode: "items", choices: {}, picks: {}, gold: null };
  }
}

export class SpeciesStep extends GalleryStep {
  static id = "species";
  static kind = "species";

  get available() {
    return this.app.mode === "create";
  }

  get label() {
    return worldRules() === "2014" ? t("Steps.race") : t("Steps.species");
  }
}
