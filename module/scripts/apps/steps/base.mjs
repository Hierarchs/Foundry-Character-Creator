import { t } from "../../utils.mjs";

/**
 * One screen of the wizard. Steps own their slice of `app.draft`, prepare template data, and handle
 * clicks (`data-action`) and input events inside the stage.
 */
export default class Step {
  /** @type {string} */
  static id;
  /** @type {string} */
  static template;

  /** @param {import("../wizard.mjs").default} app */
  constructor(app) {
    this.app = app;
  }

  get id() {
    return this.constructor.id;
  }

  get template() {
    return this.constructor.template;
  }

  get state() {
    return this.app.draft;
  }

  get label() {
    return t(`Steps.${this.id}`);
  }

  /** Whether the step appears in the trail at all. */
  get available() {
    return true;
  }

  /** Whether the step's requirements are met so the player can move past it. */
  get complete() {
    return true;
  }

  /** Template data for the stage. */
  async prepare() {
    return {};
  }

  /** Splash art for the backdrop ({ src, video, position }) or null for the default. */
  async backdrop() {
    return null;
  }

  /** Called when the step becomes current. */
  async onEnter() {}

  /** Handle a click on a `[data-action]` element that the app itself doesn't handle. */
  async onAction(action, event, target) {}

  /** Handle `input`/`change` events inside the stage. */
  onInput(event) {}

  /** Handle a key press; return true if it was consumed. */
  onKey(event) {
    return false;
  }

  /** Attach any extra listeners after the stage renders. */
  activate(element) {}
}
