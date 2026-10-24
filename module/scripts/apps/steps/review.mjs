/**
 * Final review and character creation.
 */
import Step from "./base.mjs";
import { DEFAULT_PORTRAIT, TEMPLATES } from "../../constants.mjs";
import { summarize } from "../../engine/summary.mjs";
import { assembleActor, createCharacter } from "../../engine/finalize.mjs";
import { t } from "../../utils.mjs";

export default class ReviewStep extends Step {
  static id = "review";
  static template = TEMPLATES.review;

  creating = false;

  get available() {
    return this.app.mode === "create";
  }

  get complete() {
    return false;
  }

  /** Earlier steps that still need attention. */
  problems() {
    const visible = this.app.visibleSteps;
    return visible.slice(0, visible.indexOf(this)).filter(s => !s.complete).map(s => ({ id: s.id, label: s.label }));
  }

  async prepare() {
    const actor = this.app.workingActor;
    const summary = summarize(actor);
    const d = this.state.details;
    const spellNames = [];
    for ( const picks of Object.values(this.state.spells ?? {}) ) {
      for ( const uuid of [...picks.cantrips, ...picks.spells] ) {
        const index = fromUuidSync(uuid);
        if ( index ) spellNames.push({ name: index.name, img: index.img, prepared: picks.prepared.includes(uuid) });
      }
    }
    const equipment = await this.app.stepById("equipment")?.prepare?.();
    const problems = this.problems();
    return {
      summary,
      name: d.name?.trim() || t("Defaults.Name"),
      portrait: d.img || this.app.docs.species?.img || DEFAULT_PORTRAIT,
      alignment: d.alignment,
      chosenSpells: spellNames,
      equipment: equipment?.preview ?? [],
      currency: equipment?.currency ?? "",
      problems,
      ready: !problems.length && !!summary,
      creating: this.creating
    };
  }

  async onAction(action) {
    if ( action === "create" ) return this.create();
  }

  async create() {
    if ( this.creating ) return;
    const problems = this.problems();
    if ( problems.length ) {
      ui.notifications.warn(t("Review.Problems", { steps: problems.map(p => p.label).join(", ") }));
      return;
    }
    this.creating = true;
    this.app.busy(t("Review.Creating"));
    try {
      const data = await assembleActor(this.app);
      const actor = await createCharacter(data);
      ui.notifications.info(t("Review.Created", { name: actor.name }));
      await this.app.finish();
      actor.sheet?.render(true);
    } catch(err) {
      console.error(err);
      ui.notifications.error(t("Review.Failed", { error: err.message }));
    } finally {
      this.creating = false;
      this.app.busy(null);
    }
  }
}
