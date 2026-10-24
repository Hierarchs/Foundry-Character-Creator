/**
 * The full-screen Character Genesis wizard.
 *
 * A frameless ApplicationV2 with two Handlebars parts (`chrome` = top bar and step trail, `stage` =
 * the current step) plus a manually managed backdrop layer, so splash art and background videos can
 * cross-fade without restarting every time the stage re-renders.
 */
import { TEMPLATES } from "../constants.mjs";
import { getDocument, getSubclasses, subclassLevel } from "../data/compendium.mjs";
import { advancementInProgress, cancelActiveAdvancement } from "../engine/advancement.mjs";
import { clearDraft, defaultState, hasProgress, loadDraft, saveDraft } from "./state.mjs";
import { createSteps } from "./steps/index.mjs";
import { resolveLevelupTarget } from "./steps/levelup.mjs";
import { centerInScroller, debounce, isVideo, setting, t } from "../utils.mjs";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

const isCasterProgression = p => !!p && (p !== "none");

export default class GenesisWizard extends HandlebarsApplicationMixin(ApplicationV2) {
  /**
   * @param {object} options
   * @param {"create"|"levelup"} [options.mode]
   * @param {Actor} [options.actor]   Character being levelled up.
   * @param {object} [options.state]  Resumed draft state.
   */
  constructor({ mode="create", actor=null, state=null, ...options }={}) {
    super(options);
    this.mode = mode;
    this.actor = actor;
    this.draft = state ?? defaultState(mode, actor);
    if ( !this.draft.visited.includes(this.draft.step) ) this.draft.visited.push(this.draft.step);
    /** Loaded documents for the current selections. */
    this.docs = {};
    /** Derived facts about the current selections. */
    this.meta = { subclassLevel: null, subclassCount: 0, isCaster: false };
    this.steps = createSteps(this);
    this.persist = debounce(() => saveDraft(this.draft), 250);
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "character-genesis",
    classes: ["character-genesis"],
    tag: "div",
    window: { frame: false, positioned: false },
    actions: {
      next: GenesisWizard.#onNext,
      back: GenesisWizard.#onBack,
      goto: GenesisWizard.#onGoto,
      exit: GenesisWizard.#onExit
    }
  };

  /** @override */
  static PARTS = {
    chrome: { template: TEMPLATES.chrome },
    stage: {
      template: TEMPLATES.stage,
      scrollable: [".genesis-scroll", ".genesis-carousel-track", ".genesis-drawer-body", ".spell-grid", ".spell-inspector"]
    }
  };

  /* -------------------------------------------- */
  /*  Opening                                     */
  /* -------------------------------------------- */

  /**
   * Open the wizard, offering to resume a saved draft.
   * @param {object} [options]
   * @param {"create"|"levelup"} [options.mode]
   * @param {Actor} [options.actor]
   */
  static async open({ mode="create", actor=null }={}) {
    const id = mode === "create" ? "character-genesis" : "character-genesis-levelup";
    const existing = foundry.applications.instances?.get(id);
    if ( existing ) {
      if ( (mode === "create") || (existing.actor === actor) ) return existing.render({ force: true });
      await existing.close({ force: true });
    }

    let state = null;
    const draft = loadDraft(mode, actor?.id ?? null);
    if ( draft && hasProgress(draft) ) {
      const choice = await DialogV2.wait({
        window: { title: t("Draft.Title"), icon: "fa-solid fa-scroll" },
        content: `<p>${t("Draft.Content")}</p>`,
        buttons: [
          { action: "resume", label: t("Draft.Resume"), icon: "fa-solid fa-book-open", default: true },
          { action: "fresh", label: t("Draft.Fresh"), icon: "fa-solid fa-rotate-left" }
        ],
        rejectClose: false
      });
      if ( !choice ) return null;
      if ( choice === "resume" ) state = draft;
      else clearDraft(mode, actor?.id ?? null);
    }

    const app = new this({ mode, actor, state, id });
    if ( mode === "levelup" ) await app.syncLevelup();
    else await app.syncDocs();
    return app.render({ force: true });
  }

  /* -------------------------------------------- */
  /*  Steps & navigation                          */
  /* -------------------------------------------- */

  get visibleSteps() {
    return this.steps.filter(s => s.available);
  }

  get currentStep() {
    const visible = this.visibleSteps;
    return visible.find(s => s.id === this.draft.step) ?? visible[0];
  }

  stepById(id) {
    return this.steps.find(s => s.id === id);
  }

  canReach(target) {
    const visible = this.visibleSteps;
    const index = visible.indexOf(target);
    if ( index < 0 ) return false;
    return visible.slice(0, index).every(s => s.complete);
  }

  async goTo(id) {
    const target = this.visibleSteps.find(s => s.id === id);
    if ( !target || !this.canReach(target) ) return;
    this.draft.step = id;
    if ( !this.draft.visited.includes(id) ) this.draft.visited.push(id);
    await target.onEnter?.();
    this.persist();
    await this.render({ parts: ["chrome", "stage"] });
  }

  async next() {
    const step = this.currentStep;
    if ( step.validate && !(await step.validate()) ) return;
    if ( !step.complete ) {
      ui.notifications.warn(step.incompleteMessage ?? t("Wizard.Incomplete"));
      return;
    }
    const visible = this.visibleSteps;
    const following = visible[visible.indexOf(step) + 1];
    if ( following ) await this.goTo(following.id);
  }

  async back() {
    const visible = this.visibleSteps;
    const index = visible.indexOf(this.currentStep);
    if ( (index > 0) && (this.currentStep.canGoBack !== false) ) await this.goTo(visible[index - 1].id);
  }

  /** Re-render the stage (and optionally the step trail) after a change inside a step. */
  refresh({ chrome=false }={}) {
    this.persist();
    return this.render({ parts: chrome ? ["chrome", "stage"] : ["stage"] });
  }

  /* -------------------------------------------- */
  /*  Selections & derived data                   */
  /* -------------------------------------------- */

  /** Load documents for the current selections and recompute derived flags. */
  async syncDocs() {
    if ( this.mode === "levelup" ) return this.syncLevelup();
    const s = this.draft;
    const load = uuid => (uuid ? getDocument(uuid).catch(() => null) : Promise.resolve(null));
    const [cls, subclass, background, species] = await Promise.all([s.class, s.subclass, s.background, s.species].map(load));
    this.docs = { class: cls, subclass, background, species };

    this.meta.subclassLevel = subclassLevel(cls);
    this.meta.subclassCount = cls ? (await getSubclasses(cls.identifier ?? cls.system.identifier)).length : 0;
    this.meta.isCaster = isCasterProgression(cls?.system.spellcasting?.progression)
      || isCasterProgression(subclass?.system.spellcasting?.progression);

    // A subclass chosen for a higher starting level no longer applies if the level drops.
    if ( s.subclass && !this.subclassUnlocked ) {
      s.subclass = null;
      this.docs.subclass = null;
    }
  }

  /** Level-up mode: resolve the chosen class into documents and flags (see levelup.mjs). */
  async syncLevelup() {
    this.levelup = this.mode === "levelup" ? await resolveLevelupTarget(this) : null;
  }

  get subclassUnlocked() {
    const unlock = this.meta.subclassLevel;
    return (unlock !== null) && (this.draft.level >= unlock) && (this.meta.subclassCount > 0);
  }

  /** Base ability scores from the abilities step, or null if they aren't valid yet. */
  baseScores() {
    return this.stepById("abilities")?.baseScores() ?? null;
  }

  buildKey() {
    const s = this.draft;
    return JSON.stringify([s.class, s.subclass, s.background, s.species, s.level, this.baseScores()]);
  }

  get buildCurrent() {
    return !!this.draft.build && (this.draft.buildKey === this.buildKey());
  }

  invalidateBuild() {
    this.draft.build = null;
    this.draft.buildKey = null;
    this.draft.spells = {};
    this.#tempActor = null;
  }

  #tempActor = null;
  #tempKey = null;

  /**
   * The actor being built: a temporary actor from the captured advancement data in create mode,
   * or the real character in level-up mode.
   * @type {Actor|null}
   */
  get workingActor() {
    if ( this.mode === "levelup" ) return this.actor;
    if ( !this.buildCurrent ) return null;
    if ( !this.#tempActor || (this.#tempKey !== this.draft.buildKey) ) {
      this.#tempActor = new Actor.implementation(foundry.utils.deepClone(this.draft.build));
      this.#tempKey = this.draft.buildKey;
    }
    return this.#tempActor;
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const step = this.currentStep;
    const visible = this.visibleSteps;
    const index = visible.indexOf(step);
    return Object.assign(context, {
      mode: this.mode,
      title: this.mode === "create" ? t("Wizard.TitleCreate") : t("Wizard.TitleLevelUp", { name: this.actor?.name ?? "" }),
      canBack: (index > 0) && (step.canGoBack !== false),
      steps: visible.map((s, i) => ({
        id: s.id,
        label: s.label,
        number: i + 1,
        current: s === step,
        // Only mark steps the player has actually been through.
        complete: s.complete && (s !== step) && ((i < index) || this.draft.visited.includes(s.id)),
        reachable: (s !== step) && this.canReach(s) && (step.canGoBack !== false || i > index)
      }))
    });
  }

  /** @override */
  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    if ( partId === "stage" ) {
      const step = this.currentStep;
      context.stepId = step.id;
      context.stepTemplate = step.template;
      context.stepData = await step.prepare();
    }
    return context;
  }

  /** @override */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    this.element.insertAdjacentHTML("afterbegin", '<div class="genesis-backdrop" aria-hidden="true"></div>');
    this.element.insertAdjacentHTML("beforeend", `<div class="genesis-busy" aria-live="polite">
      <div class="genesis-busy-inner"><i class="fa-solid fa-dice-d20 fa-spin"></i><span></span></div></div>`);
    this.element.addEventListener("change", this.#onInput.bind(this));
    this.element.addEventListener("input", this.#onInput.bind(this));
    document.addEventListener("keydown", this.#keyHandler, true);
    document.body.classList.add("genesis-open");

    // The interface (and its notifications) sits underneath this overlay; borrow the notification
    // area while the wizard is open so messages stay visible.
    const notifications = document.getElementById("notifications");
    if ( notifications ) {
      this.#notificationsHome = { el: notifications, parent: notifications.parentElement, next: notifications.nextSibling };
      this.element.append(notifications);
    }
  }

  #notificationsHome = null;

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const step = this.currentStep;
    this.element.dataset.step = step.id;
    const stage = this.element.querySelector('[data-application-part="stage"]');
    if ( stage && (this.#renderedStep !== step.id) ) stage.classList.add("is-entering");
    this.#renderedStep = step.id;
    if ( stage ) step.activate?.(stage);
    centerInScroller(this.element.querySelector(".genesis-trail"), this.element.querySelector(".genesis-trail li.current"));
    this.#syncBackdrop(step);
  }

  /** @override */
  _onClose(options) {
    super._onClose(options);
    document.removeEventListener("keydown", this.#keyHandler, true);
    document.body.classList.remove("genesis-open");
    const home = this.#notificationsHome;
    if ( home?.parent ) home.parent.insertBefore(home.el, home.next?.parentNode === home.parent ? home.next : null);
    this.#notificationsHome = null;
  }

  #backdropSrc;
  #renderedStep = null;

  async #syncBackdrop(step) {
    let art = null;
    try {
      art = await step.backdrop?.();
    } catch(err) {
      console.warn("Character Genesis | backdrop failed", err);
    }
    if ( !art?.src ) {
      const fallback = setting("defaultBackdrop");
      art = { src: fallback || null, video: isVideo(fallback), position: "center" };
    }
    const container = this.element?.querySelector(".genesis-backdrop");
    if ( !container || (art.src === this.#backdropSrc) ) return;
    this.#backdropSrc = art.src;

    const layer = document.createElement("div");
    layer.className = `genesis-backdrop-layer${art.src ? "" : " is-empty"}`;
    layer.style.setProperty("--art-position", art.position ?? "center");
    if ( art.src && art.video ) {
      const video = Object.assign(document.createElement("video"), {
        src: art.src, autoplay: true, loop: true, muted: true, playsInline: true
      });
      layer.append(video);
    } else if ( art.src ) {
      const img = Object.assign(document.createElement("img"), { src: art.src, alt: "", decoding: "async" });
      img.addEventListener("error", () => layer.classList.add("is-empty"));
      layer.append(img);
    }
    container.append(layer);
    // Force a style flush so the opacity transition runs (rAF doesn't fire in background tabs).
    void layer.offsetWidth;
    layer.classList.add("is-visible");
    // Drop older layers once the new one has faded in.
    const old = Array.from(container.children).filter(c => c !== layer);
    setTimeout(() => old.forEach(o => o.remove()), 900);
  }

  /** Show or hide the busy overlay. */
  busy(message=null) {
    const el = this.element?.querySelector(".genesis-busy");
    if ( !el ) return;
    el.classList.toggle("active", !!message);
    el.querySelector("span").textContent = message ?? "";
  }

  /* -------------------------------------------- */
  /*  Events                                      */
  /* -------------------------------------------- */

  /** @override */
  _onClickAction(event, target) {
    return this.currentStep?.onAction?.(target.dataset.action, event, target);
  }

  #onInput(event) {
    if ( !event.target.closest('[data-application-part="stage"]') ) return;
    this.currentStep?.onInput?.(event);
  }

  #keyHandler = this.#onKeyDown.bind(this);

  #onKeyDown(event) {
    if ( !this.rendered || advancementInProgress() ) return;
    const active = document.activeElement;
    // Other windows (dialogs, file picker) keep their own keys.
    if ( active && (active !== document.body) && !this.element.contains(active) ) return;
    if ( ["INPUT", "TEXTAREA", "SELECT"].includes(active?.tagName) || active?.isContentEditable ) return;
    if ( this.currentStep?.onKey?.(event) ) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  static #onNext() {
    return this.next();
  }

  static #onBack() {
    return this.back();
  }

  static #onGoto(event, target) {
    return this.goTo(target.dataset.step);
  }

  static #onExit() {
    return this.close();
  }

  /** @override */
  async close(options={}) {
    if ( !options.force && hasProgress(this.draft) ) {
      const leave = await DialogV2.confirm({
        window: { title: t("Wizard.ExitTitle"), icon: "fa-solid fa-door-open" },
        content: `<p>${t("Wizard.ExitContent")}</p>`,
        rejectClose: false
      });
      if ( !leave ) return this;
    }
    if ( !options.discard ) saveDraft(this.draft);
    if ( advancementInProgress() ) await cancelActiveAdvancement();
    return super.close(options);
  }

  /** Close after a successful create/level-up and forget the draft. */
  async finish() {
    clearDraft(this.draft.mode, this.draft.actorId);
    return super.close({ force: true });
  }
}
