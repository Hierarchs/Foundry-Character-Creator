/**
 * Ability scores: point buy, standard array, rolled (4d6 drop lowest), or manual entry.
 * All arithmetic and validation runs in the Rust rules engine.
 */
import Step from "./base.mjs";
import { ABILITY_ICONS, ABILITY_KEYS, TEMPLATES } from "../../constants.mjs";
import { Rules } from "../../rules.mjs";
import { backgroundAbilities, fixedBonuses } from "../../data/describe.mjs";
import { loc, setting, signed, t } from "../../utils.mjs";

const METHODS = [
  ["pointBuy", "abilityPointBuy"],
  ["standardArray", "abilityStandardArray"],
  ["roll", "abilityRoll"],
  ["manual", "abilityManual"]
];

const unassigned = () => Object.fromEntries(ABILITY_KEYS.map(k => [k, null]));

export default class AbilitiesStep extends Step {
  static id = "abilities";
  static template = TEMPLATES.abilities;

  get available() {
    return this.app.mode === "create";
  }

  get methods() {
    const enabled = METHODS.filter(([, key]) => setting(key)).map(([m]) => m);
    return enabled.length ? enabled : ["pointBuy"];
  }

  get method() {
    const chosen = this.state.abilities.method;
    return this.methods.includes(chosen) ? chosen : this.methods[0];
  }

  get data() {
    return this.state.abilities;
  }

  /** Evaluate the active method. Returns `{ valid, scores, ... }`. */
  evaluate() {
    const a = this.data;
    switch ( this.method ) {
      case "pointBuy": {
        const r = Rules.pointBuy(a.pointBuy, { budget: setting("pointBuyBudget") });
        const scores = Object.fromEntries(Object.entries(r.abilities).map(([k, v]) => [k, v.score]));
        return { valid: r.valid, scores, pointBuy: r };
      }
      case "standardArray": {
        const r = Rules.assign(a.standardArray);
        return { valid: r.valid, scores: r.scores, assign: r };
      }
      case "roll": {
        if ( !a.roll.sets ) return { valid: false, scores: unassigned(), sets: null };
        const sets = Rules.rolledSets(a.roll.sets);
        const r = Rules.assign(a.roll.assignment, sets.map(s => s.total));
        return { valid: r.valid, scores: r.scores, assign: r, sets };
      }
      default: {
        const r = Rules.manualScores(a.manual, 3, 18);
        return { valid: r.valid, scores: r.scores, errors: r.errors };
      }
    }
  }

  /** Base scores if the current method produces a valid set, else null. */
  baseScores() {
    try {
      const result = this.evaluate();
      return result.valid ? result.scores : null;
    } catch {
      return null;
    }
  }

  get complete() {
    return !!this.baseScores();
  }

  get incompleteMessage() {
    return t("Abilities.Incomplete");
  }

  async validate() {
    const result = this.evaluate();
    if ( (this.method === "pointBuy") && result.valid && (result.pointBuy.remaining > 0) ) {
      return foundry.applications.api.DialogV2.confirm({
        window: { title: t("Abilities.Title") },
        content: `<p>${t("Abilities.PointsLeft", { points: result.pointBuy.remaining })}</p>`,
        rejectClose: false
      });
    }
    return true;
  }

  async prepare() {
    const result = this.evaluate();
    const method = this.method;
    const bgAbilities = new Set(backgroundAbilities(this.app.docs.background));
    const fixed = fixedBonuses(this.app.docs.species);
    const values = method === "standardArray" ? result.assign.values
      : method === "roll" ? (result.sets?.map(s => s.total) ?? []) : [];
    const assignment = method === "standardArray" ? this.data.standardArray : this.data.roll.assignment;

    const cards = ABILITY_KEYS.map(key => {
      const config = CONFIG.DND5E.abilities?.[key] ?? {};
      const score = result.scores?.[key] ?? null;
      const mod = score === null ? null : Rules.modifier(score);
      const pb = result.pointBuy?.abilities?.[key];
      const hints = [];
      if ( fixed[key] ) hints.push({ text: `${signed(fixed[key])} ${this.app.docs.species?.name ?? ""}`.trim(), kind: "fixed" });
      if ( bgAbilities.size && (bgAbilities.size < 6) && bgAbilities.has(key) ) hints.push({ text: t("Abilities.BackgroundHint"), kind: "background" });
      return {
        key,
        label: loc(config.label ?? key),
        abbr: loc(config.abbreviation ?? key).toUpperCase(),
        icon: ABILITY_ICONS[key],
        score: score ?? "—",
        hasScore: score !== null,
        mod: mod === null ? "" : signed(mod),
        negative: (mod ?? 0) < 0,
        canIncrease: !!pb?.canIncrease,
        canDecrease: !!pb?.canDecrease,
        nextCost: pb?.nextCost ?? null,
        options: values.map((value, index) => ({
          index,
          value,
          selected: assignment?.[key] === index,
          taken: (assignment?.[key] !== index) && Object.values(assignment ?? {}).includes(index)
        })),
        manual: this.data.manual[key],
        hints
      };
    });

    return {
      method,
      methods: this.methods.map(m => ({ id: m, label: t(`Abilities.Method.${m}`), active: m === method })),
      multipleMethods: this.methods.length > 1,
      heading: t(`Abilities.Method.${method}`),
      subtitle: t(`Abilities.Subtitle.${method}`),
      cards,
      pointBuy: result.pointBuy ? {
        remaining: result.pointBuy.remaining,
        budget: result.pointBuy.budget,
        overspent: result.pointBuy.remaining < 0
      } : null,
      roll: method === "roll" ? {
        rolled: !!result.sets,
        canRoll: !result.sets || setting("allowReroll"),
        sets: (result.sets ?? []).map((s, i) => ({
          index: i,
          total: s.total,
          dice: s.dice.map((d, di) => ({ value: d, dropped: s.dropped.includes(di) }))
        }))
      } : null,
      showAssign: (method === "standardArray") || (method === "roll" && !!result.sets),
      isManual: method === "manual",
      isPointBuy: method === "pointBuy",
      valid: result.valid,
      bgName: bgAbilities.size && (bgAbilities.size < 6) ? this.app.docs.background?.name : null
    };
  }

  #changed() {
    // Scores feed the advancement build, so a change makes any existing build stale.
    if ( this.state.build && !this.app.buildCurrent ) this.app.invalidateBuild();
    return this.app.refresh({ chrome: true });
  }

  async onAction(action, event, target) {
    const key = target.dataset.ability;
    switch ( action ) {
      case "method":
        this.data.method = target.dataset.method;
        return this.#changed();
      case "increase":
      case "decrease": {
        const delta = action === "increase" ? 1 : -1;
        const result = this.evaluate();
        const info = result.pointBuy?.abilities?.[key];
        if ( !info || ((delta > 0) && !info.canIncrease) || ((delta < 0) && !info.canDecrease) ) return;
        this.data.pointBuy[key] = info.score + delta;
        return this.#changed();
      }
      case "rollAbilities":
        return this.roll();
      case "resetAbilities":
        if ( this.method === "pointBuy" ) this.data.pointBuy = Object.fromEntries(ABILITY_KEYS.map(k => [k, 8]));
        if ( this.method === "standardArray" ) this.data.standardArray = unassigned();
        if ( this.method === "roll" ) this.data.roll.assignment = unassigned();
        return this.#changed();
    }
  }

  async roll() {
    const data = this.data.roll;
    if ( data.sets && !setting("allowReroll") ) {
      ui.notifications.warn(t("Abilities.NoReroll"));
      return;
    }
    const rolls = [];
    for ( let i = 0; i < 6; i++ ) rolls.push(await new Roll("4d6").evaluate());
    data.sets = rolls.map(r => r.dice[0].results.map(d => d.result));
    data.assignment = unassigned();
    data.rerolls = (data.rerolls ?? 0) + 1;
    if ( setting("rollsToChat") ) {
      const totals = Rules.rolledSets(data.sets).map(s => s.total).join(", ");
      await ChatMessage.implementation.create({
        speaker: ChatMessage.implementation.getSpeaker({ user: game.user }),
        flavor: t("Abilities.RollFlavor"),
        content: `<p>${t("Abilities.RollResult", { totals })}</p>`,
        rolls,
        sound: CONFIG.sounds?.dice
      });
    }
    return this.#changed();
  }

  onInput(event) {
    const el = event.target;
    if ( el.dataset.assign ) {
      if ( event.type !== "change" ) return;
      const assignment = this.method === "roll" ? this.data.roll.assignment : this.data.standardArray;
      const key = el.dataset.assign;
      const value = el.value === "" ? null : Number(el.value);
      // Picking a value another ability holds swaps the two, which is how people expect arrays to work.
      const holder = Object.keys(assignment).find(k => (k !== key) && (value !== null) && (assignment[k] === value));
      if ( holder ) assignment[holder] = assignment[key];
      assignment[key] = value;
      return this.#changed();
    }
    if ( el.dataset.manual && (event.type === "change") ) {
      this.data.manual[el.dataset.manual] = Math.round(Number(el.value) || 0);
      return this.#changed();
    }
  }
}
