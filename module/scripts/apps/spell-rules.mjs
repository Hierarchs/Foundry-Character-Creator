/**
 * GM editor for per-class spellcasting rules: casting type, progression, spell list, replacements,
 * and the cantrips / spells-per-level tables. Saved overrides take priority over both class data
 * and the Rust engine's built-in tables.
 */
import { MODULE_ID, TEMPLATES } from "../constants.mjs";
import { Rules } from "../rules.mjs";
import { activeRules, getEntries } from "../data/compendium.mjs";
import { t } from "../utils.mjs";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

const CASTING = ["known", "prepared", "pact", "spellbook"];
const PROGRESSION = ["full", "half", "third", "artificer", "pact"];
const LEVELS = Array.from({ length: 20 }, (_, i) => i + 1);

export default class SpellRulesConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "genesis-spell-rules",
    classes: ["genesis-config", "genesis-spell-rules"],
    tag: "div",
    window: { title: "GENESIS.SpellRules.Title", icon: "fa-solid fa-hat-wizard", resizable: true },
    position: { width: 1100, height: 760 },
    actions: {
      saveRule: SpellRulesConfig.#onSave,
      resetRule: SpellRulesConfig.#onReset,
      addRule: SpellRulesConfig.#onAdd
    }
  };

  static PARTS = {
    body: { template: TEMPLATES.spellRules, scrollable: [".rule-list"] }
  };

  /** Identifiers whose rows are expanded, kept across re-renders. */
  #open = new Set();

  async #rows() {
    const rules = activeRules() === "2014" ? "2014" : "2024";
    const overrides = game.settings.get(MODULE_ID, "spellRules") ?? {};
    const defaults = new Map(Rules.spellRuleDefaults(rules).map(r => [r.identifier, r]));
    const rows = new Map();

    // Casters found in the world's compendiums.
    const classes = [...await getEntries("class"), ...await getEntries("subclass")]
      .filter(e => (e.index.system?.spellcasting?.progression ?? "none") !== "none");
    for ( const entry of classes ) {
      if ( rows.has(entry.identifier) ) continue;
      rows.set(entry.identifier, {
        identifier: entry.identifier,
        label: entry.name,
        rule: defaults.get(entry.identifier) ?? {
          identifier: entry.identifier, label: entry.name, rules, casting: "prepared",
          progression: entry.index.system.spellcasting.progression, spellList: entry.identifier,
          replacePerLevel: 0, cantrips: Array(20).fill(0), spells: Array(20).fill(0)
        }
      });
    }
    for ( const [id, rule] of defaults ) if ( !rows.has(id) ) rows.set(id, { identifier: id, label: rule.label, rule });
    for ( const [id, rule] of Object.entries(overrides) ) {
      const row = rows.get(id) ?? { identifier: id, label: rule.label || id };
      row.rule = rule;
      row.custom = true;
      rows.set(id, row);
    }
    return Array.from(rows.values()).sort((a, b) => a.label.localeCompare(b.label, game.i18n.lang));
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const rows = (await this.#rows()).map(row => {
      const r = row.rule;
      return {
        ...row,
        open: this.#open.has(row.identifier),
        casting: CASTING.map(c => ({ value: c, label: t(`Spells.Casting.${c}`), selected: r.casting === c })),
        castingLabel: t(`Spells.Casting.${r.casting}`),
        progression: PROGRESSION.map(p => ({ value: p, label: t(`SpellRules.Progression.${p}`), selected: r.progression === p })),
        progressionLabel: t(`SpellRules.Progression.${r.progression}`),
        spellList: r.spellList,
        replacePerLevel: r.replacePerLevel ?? 0,
        cantrips: LEVELS.map(l => ({ level: l, value: r.cantrips?.[l - 1] ?? 0 })),
        spells: LEVELS.map(l => ({ level: l, value: r.spells?.[l - 1] ?? "" })),
        formula: r.formula && !r.spells ? t("SpellRules.Formula", { divisor: r.formula.divisor }) : null,
        spellsLabel: r.casting === "known" ? t("Spells.Counter.known") : t("Spells.Counter.prepared")
      };
    });
    return Object.assign(context, { rows, levels: LEVELS, edition: activeRules() });
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.element.querySelectorAll("details.rule-row").forEach(el => {
      el.addEventListener("toggle", () => {
        if ( el.open ) this.#open.add(el.dataset.id);
        else this.#open.delete(el.dataset.id);
      });
    });
  }

  static async #onSave(event, target) {
    const row = target.closest(".rule-row");
    const id = row.dataset.id;
    const read = name => row.querySelector(`[name="${name}"]`)?.value ?? "";
    const table = prefix => LEVELS.map(l => read(`${prefix}.${l}`));
    const spellsRaw = table("spells");
    const existing = (await this.#rows()).find(r => r.identifier === id)?.rule ?? {};
    const rule = {
      ...existing,
      identifier: id,
      label: existing.label ?? id,
      casting: read("casting"),
      progression: read("progression"),
      spellList: read("spellList").trim() || id,
      replacePerLevel: Math.max(0, Number(read("replacePerLevel")) || 0),
      cantrips: table("cantrips").map(v => Math.max(0, Number(v) || 0)),
      // Leaving every spells cell blank keeps a formula-based rule (e.g. 2014 clerics).
      spells: spellsRaw.every(v => v === "") ? (existing.formula ? null : Array(20).fill(0))
        : spellsRaw.map(v => Math.max(0, Number(v) || 0))
    };
    if ( rule.spells ) rule.formula = null;
    // Round-trip through the engine to make sure the rule is well formed.
    Rules.spellLimits({ identifier: id, level: 1, rule });
    const all = foundry.utils.deepClone(game.settings.get(MODULE_ID, "spellRules") ?? {});
    all[id] = rule;
    await game.settings.set(MODULE_ID, "spellRules", all);
    ui.notifications.info(t("SpellRules.Saved", { name: rule.label }));
    this.render();
  }

  static async #onReset(event, target) {
    const id = target.closest(".rule-row").dataset.id;
    const all = foundry.utils.deepClone(game.settings.get(MODULE_ID, "spellRules") ?? {});
    delete all[id];
    await game.settings.set(MODULE_ID, "spellRules", all);
    this.render();
  }

  static async #onAdd() {
    const identifier = await DialogV2.prompt({
      window: { title: t("SpellRules.AddTitle") },
      content: `<label>${t("SpellRules.Identifier")} <input type="text" name="identifier" placeholder="blood-hunter" autofocus></label>`,
      ok: { callback: (event, button) => button.form.elements.identifier.value.trim().slugify?.({ strict: true }) ?? button.form.elements.identifier.value.trim() },
      rejectClose: false
    });
    if ( !identifier ) return;
    const all = foundry.utils.deepClone(game.settings.get(MODULE_ID, "spellRules") ?? {});
    all[identifier] ??= {
      identifier, label: identifier, rules: activeRules() === "2014" ? "2014" : "2024", casting: "known",
      progression: "full", spellList: identifier, replacePerLevel: 1, cantrips: Array(20).fill(0), spells: Array(20).fill(0)
    };
    await game.settings.set(MODULE_ID, "spellRules", all);
    this.#open.add(identifier);
    this.render();
  }
}
