/**
 * Starting equipment from the class and background: pick the item package (with any "choose one"
 * options and "any martial weapon" style picks), or take the starting gold instead.
 */
import Step from "./base.mjs";
import { TEMPLATES } from "../../constants.mjs";
import {
  equipmentView, hasStartingEquipment, itemInfo, proficientWith, resolveSelection, rollWealth
} from "../../engine/equipment.mjs";
import { setting, t } from "../../utils.mjs";

const emptySelection = () => ({ mode: "items", choices: {}, picks: {}, gold: null });

function isFlat(formula) {
  try {
    return new Roll(String(formula)).isDeterministic;
  } catch {
    return false;
  }
}

export default class EquipmentStep extends Step {
  static id = "equipment";
  static template = TEMPLATES.equipment;

  get available() {
    return (this.app.mode === "create") && (this.sources().length > 0);
  }

  sources() {
    return ["class", "background"]
      .map(kind => [kind, this.app.docs[kind]])
      .filter(([, doc]) => doc && (hasStartingEquipment(doc) || doc.system?.wealth));
  }

  selection(kind) {
    this.state.equipment[kind] ??= emptySelection();
    return this.state.equipment[kind];
  }

  canTakeGold(doc) {
    return !!doc.system?.wealth && (setting("allowGold") || !hasStartingEquipment(doc));
  }

  mode(kind, doc) {
    if ( !hasStartingEquipment(doc) ) return "gold";
    return (this.selection(kind).mode === "gold") && this.canTakeGold(doc) ? "gold" : "items";
  }

  get complete() {
    return this.sources().every(([kind, doc]) => {
      if ( this.mode(kind, doc) === "gold" ) return this.selection(kind).gold !== null;
      return resolveSelection(doc, this.selection(kind)).complete;
    });
  }

  get incompleteMessage() {
    return t("Equipment.Incomplete");
  }

  async onEnter() {
    // Flat starting gold (e.g. "55") needs no roll, so fill it in straight away.
    for ( const [kind, doc] of this.sources() ) {
      const s = this.selection(kind);
      if ( (this.mode(kind, doc) === "gold") && (s.gold === null) && isFlat(doc.system.wealth) ) {
        s.gold = await rollWealth(doc.system.wealth);
      }
    }
  }

  async prepare() {
    const panels = [];
    const preview = new Map();
    const currency = {};
    const addCurrency = (key, amount) => currency[key] = (currency[key] ?? 0) + amount;

    for ( const [kind, doc] of this.sources() ) {
      const s = this.selection(kind);
      const mode = this.mode(kind, doc);
      const wealth = doc.system.wealth;
      const panel = {
        kind,
        label: this.app.stepById(kind)?.label ?? t(`Steps.${kind}`),
        name: doc.name,
        img: doc.img,
        mode,
        isItems: mode === "items",
        isGold: mode === "gold",
        hasItems: hasStartingEquipment(doc),
        canGold: this.canTakeGold(doc),
        wealth,
        flatWealth: isFlat(wealth),
        gold: s.gold,
        hasGold: s.gold !== null
      };
      if ( mode === "items" ) {
        const view = await equipmentView(doc, s);
        panel.nodes = view.nodes;
        panel.complete = view.resolved.complete;
        for ( const grant of view.resolved.grants ) {
          const row = preview.get(grant.uuid) ?? { ...(await itemInfo(grant.uuid)), count: 0 };
          // "If proficient" items the character can't use are shown struck through and not granted.
          if ( grant.requiresProficiency ) {
            const doc = await fromUuid(grant.uuid).catch(() => null);
            row.unproficient = !!doc && !proficientWith(this.app.workingActor, doc);
          }
          row.count += grant.count;
          preview.set(grant.uuid, row);
        }
        for ( const [key, amount] of Object.entries(view.resolved.currency) ) addCurrency(key, amount);
      } else {
        panel.complete = s.gold !== null;
        if ( s.gold !== null ) addCurrency(CONFIG.DND5E.defaultCurrency ?? "gp", s.gold);
      }
      panels.push(panel);
    }

    return {
      panels,
      preview: Array.from(preview.values()).map(r => ({ ...r, multi: r.count > 1 })),
      currency: Object.entries(currency).filter(([, v]) => v).map(([k, v]) => `${v} ${k.toUpperCase()}`).join(", "),
      empty: !panels.length
    };
  }

  async onAction(action, event, target) {
    const kind = target.dataset.source;
    const doc = this.app.docs[kind];
    if ( !doc ) return;
    const s = this.selection(kind);
    switch ( action ) {
      case "equipMode":
        s.mode = target.dataset.mode;
        if ( (s.mode === "gold") && (s.gold === null) && isFlat(doc.system.wealth) ) s.gold = await rollWealth(doc.system.wealth);
        return this.app.refresh({ chrome: true });
      case "rollGold":
        if ( (s.gold !== null) && !setting("allowReroll") ) return;
        s.gold = await rollWealth(doc.system.wealth, {
          toChat: setting("rollsToChat"),
          flavor: t("Equipment.GoldFlavor", { name: doc.name })
        });
        return this.app.refresh({ chrome: true });
      case "equipChoose":
        s.choices[target.dataset.entry] = target.dataset.option;
        return this.app.refresh({ chrome: true });
    }
  }

  onInput(event) {
    const el = event.target;
    if ( !el.dataset.pick || (event.type !== "change") ) return;
    const s = this.selection(el.dataset.source);
    if ( el.value ) s.picks[el.dataset.pick] = el.value;
    else delete s.picks[el.dataset.pick];
    return this.app.refresh({ chrome: true });
  }
}
