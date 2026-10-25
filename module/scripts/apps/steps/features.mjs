/**
 * Features & Choices: hands the selected background, species, and class to dnd5e's Advancement
 * engine (skills, languages, feats, fighting styles, ...) and shows what the character gained.
 */
import Step from "./base.mjs";
import { TEMPLATES } from "../../constants.mjs";
import { buildCharacter, cancelActiveAdvancement } from "../../engine/advancement.mjs";
import { summarize } from "../../engine/summary.mjs";
import { t } from "../../utils.mjs";

export default class FeaturesStep extends Step {
  static id = "features";
  static template = TEMPLATES.features;

  /** Which source is currently in the advancement manager. */
  running = null;

  get available() {
    return this.app.mode === "create";
  }

  get complete() {
    return this.app.buildCurrent;
  }

  get incompleteMessage() {
    return t("Features.Incomplete");
  }

  async prepare() {
    const { docs, draft: state } = this.app;
    const order = ["background", "species", ...(docs.birthsign ? ["birthsign"] : []), "class"];
    const doneUpTo = this.running ? order.indexOf(this.running) : -1;
    const built = this.app.buildCurrent;
    const sources = order.map((kind, i) => {
      const doc = docs[kind];
      let detail = "";
      if ( kind === "class" ) {
        detail = t("Features.ClassDetail", { level: state.level });
        if ( docs.subclass ) detail += ` • ${docs.subclass.name}`;
      }
      return {
        kind,
        label: this.app.stepById(kind)?.label ?? t(`Steps.${kind}`),
        name: doc?.name ?? t("Features.None"),
        img: doc?.img,
        detail,
        missing: !doc,
        running: this.running === kind,
        done: built || (this.running && (i < doneUpTo))
      };
    });
    return {
      sources,
      built,
      stale: !!state.build && !built,
      running: !!this.running,
      canBuild: !!docs.class && !!this.app.baseScores(),
      summary: built ? summarize(this.app.workingActor) : null
    };
  }

  async onAction(action) {
    if ( action === "build" ) return this.build();
    if ( action === "cancelBuild" ) return cancelActiveAdvancement();
  }

  async build() {
    if ( this.running ) return;
    const { docs, draft: state } = this.app;
    const base = this.app.baseScores();
    if ( !docs.class || !base ) {
      ui.notifications.warn(t("Features.Missing"));
      return;
    }
    const baseData = {
      name: state.details.name?.trim() || t("Defaults.Name"),
      type: "character",
      ownership: { default: 0, [game.user.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER },
      system: { abilities: Object.fromEntries(Object.entries(base).map(([k, v]) => [k, { value: v }])) }
    };

    this.app.invalidateBuild();
    let data = null;
    let failed = false;
    try {
      data = await buildCharacter(baseData, {
        background: docs.background,
        species: docs.species,
        birthsign: docs.birthsign,
        cls: docs.class,
        level: state.level,
        subclassUuid: state.subclass
      }, kind => {
        this.running = kind;
        this.app.refresh();
      });
    } catch(err) {
      failed = true;
      console.error(err);
      ui.notifications.error(t("Features.Failed", { error: err.message }));
    } finally {
      this.running = null;
    }

    if ( data ) {
      state.build = data;
      state.buildKey = this.app.buildKey();
      ui.notifications.info(t("Features.Done"));
    } else if ( !failed ) {
      ui.notifications.info(t("Features.Cancelled"));
    }
    await this.app.refresh({ chrome: true });
  }
}
