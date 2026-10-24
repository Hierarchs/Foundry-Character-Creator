/**
 * Level-up mode: pick a class to advance (or a new one to multiclass into), optionally a subclass,
 * apply the level through dnd5e's Advancement engine on the real actor, then pick new spells.
 */
import Step from "./base.mjs";
import { TEMPLATES } from "../../constants.mjs";
import { Rules } from "../../rules.mjs";
import { getDocument, getEntries } from "../../data/compendium.mjs";
import { resolveArt } from "../../data/art.mjs";
import { addNewClass, cancelActiveAdvancement, itemDataFrom, levelUpExisting } from "../../engine/advancement.mjs";
import { castingClasses, spellItemData } from "../../engine/spells.mjs";
import { loc, setting, t } from "../../utils.mjs";

function requirementOf(identifier, label, primaryAbility) {
  return {
    identifier,
    label,
    primary: Array.from(primaryAbility?.value ?? []),
    all: !!primaryAbility?.all
  };
}

function describeFailure(failure) {
  const abilities = failure.missing.map(k => loc(CONFIG.DND5E.abilities?.[k]?.label ?? k));
  const joiner = failure.all ? ` ${t("LevelUp.And")} ` : ` ${t("LevelUp.Or")} `;
  return t("LevelUp.Requires", { name: failure.label, abilities: abilities.join(joiner) });
}

export class LevelUpClassStep extends Step {
  static id = "levelupClass";
  static template = TEMPLATES.levelupClass;

  get available() {
    return this.app.mode === "levelup";
  }

  get complete() {
    return !!this.state.levelup.target;
  }

  get incompleteMessage() {
    return t("LevelUp.PickClass");
  }

  get canGoBack() {
    return !this.state.levelup.applied;
  }

  async prepare() {
    const actor = this.app.actor;
    const level = actor.system.details.level ?? 0;
    const target = this.state.levelup.target;
    const owned = Object.values(actor.classes ?? {});
    const abilities = Object.fromEntries(Object.entries(actor.system.abilities ?? {}).map(([k, a]) => [k, a.value]));
    const current = owned.map(c => requirementOf(c.identifier, c.name, c.system.primaryAbility));
    const policy = setting("multiclassPrereqs");

    const existing = owned.map(c => ({
      target: `existing:${c.id}`,
      name: c.name,
      img: c.img,
      level: c.system.levels,
      next: c.system.levels + 1,
      subclass: c.subclass?.name ?? "",
      selected: target === `existing:${c.id}`
    }));

    const ownedIds = new Set(owned.map(c => c.identifier));
    const others = (await getEntries("class")).filter(e => !ownedIds.has(e.identifier)).map(e => {
      const check = policy === "off" ? { ok: true, failures: [] } : Rules.multiclassCheck({
        abilities,
        current,
        target: requirementOf(e.identifier, e.name, e.index.system?.primaryAbility)
      });
      return {
        target: `new:${e.uuid}`,
        name: e.name,
        img: e.img,
        ok: check.ok,
        blocked: !check.ok && (policy === "enforce"),
        reasons: check.failures.map(describeFailure),
        selected: target === `new:${e.uuid}`
      };
    });

    return {
      name: actor.name,
      img: actor.img,
      level,
      nextLevel: level + 1,
      maxed: level >= 20,
      existing,
      others,
      applied: this.state.levelup.applied,
      policyWarn: policy === "warn"
    };
  }

  async onAction(action, event, target) {
    if ( action !== "levelTarget" || this.state.levelup.applied ) return;
    const choice = target.dataset.target;
    if ( target.dataset.blocked === "true" ) {
      ui.notifications.warn(t("LevelUp.Blocked"));
      return;
    }
    if ( this.state.levelup.target !== choice ) {
      this.state.levelup.target = choice;
      this.state.subclass = null;
      this.state.spells = {};
      await this.app.syncLevelup();
    }
    return this.app.refresh({ chrome: true });
  }
}

/* -------------------------------------------- */

export class LevelUpApplyStep extends Step {
  static id = "levelupApply";
  static template = TEMPLATES.features;

  running = false;

  get available() {
    return this.app.mode === "levelup";
  }

  get complete() {
    return this.state.levelup.applied;
  }

  get incompleteMessage() {
    return t("LevelUp.ApplyFirst");
  }

  get canGoBack() {
    return !this.state.levelup.applied;
  }

  async backdrop() {
    const doc = this.app.levelup?.classDoc;
    if ( !doc ) return null;
    return resolveArt({ uuid: doc.uuid, type: "class", identifier: doc.identifier }, doc);
  }

  async prepare() {
    const lu = this.app.levelup ?? {};
    const { draft: state } = this.app;
    return {
      levelup: true,
      sources: [{
        kind: "class",
        label: t("Steps.class"),
        name: lu.name ?? "—",
        img: lu.img,
        detail: t("LevelUp.FromTo", { from: lu.newLevel - 1, to: lu.newLevel }),
        running: this.running,
        done: state.levelup.applied
      }],
      built: state.levelup.applied,
      running: this.running,
      canBuild: !!lu.name && !state.levelup.applied
    };
  }

  async onAction(action) {
    if ( action === "cancelBuild" ) return cancelActiveAdvancement();
    if ( (action !== "build") || this.running || this.state.levelup.applied ) return;
    const lu = this.app.levelup;
    if ( !lu ) return;
    this.running = true;
    await this.app.refresh();
    let ok = false;
    try {
      ok = lu.classItem
        ? await levelUpExisting(this.app.actor, lu.classItem, { subclassUuid: this.state.subclass })
        : await addNewClass(this.app.actor, lu.classDoc, { subclassUuid: this.state.subclass });
    } catch(err) {
      console.error(err);
      ui.notifications.error(t("Features.Failed", { error: err.message }));
    } finally {
      this.running = false;
    }
    if ( ok ) {
      this.state.levelup.applied = true;
      await this.app.syncLevelup();
      await this.app.refresh({ chrome: true });
      return this.app.next();
    }
    return this.app.refresh({ chrome: true });
  }
}

/* -------------------------------------------- */

export class LevelUpDoneStep extends Step {
  static id = "levelupDone";
  static template = TEMPLATES.levelupDone;

  finishing = false;

  get available() {
    return this.app.mode === "levelup";
  }

  get complete() {
    return false;
  }

  get canGoBack() {
    return !this.state.levelup.applied;
  }

  async prepare() {
    const actor = this.app.actor;
    const lu = this.app.levelup ?? {};
    const picks = this.state.spells?.[this.state.levelup.identifier];
    const names = [...(picks?.cantrips ?? []), ...(picks?.spells ?? [])].map(u => fromUuidSync(u)?.name).filter(Boolean);
    return {
      name: actor.name,
      img: actor.img,
      level: actor.system.details.level,
      className: lu.name,
      classLevel: lu.newLevel,
      hp: actor.system.attributes.hp.max,
      spells: names,
      replaced: (picks?.replace ?? []).map(id => actor.items.get(id)?.name).filter(Boolean),
      applied: this.state.levelup.applied
    };
  }

  async onAction(action) {
    if ( (action !== "finishLevelUp") || this.finishing ) return;
    this.finishing = true;
    try {
      const actor = this.app.actor;
      const identifier = this.state.levelup.identifier;
      const caster = castingClasses(actor).find(c => c.identifier === identifier);
      const picks = this.state.spells?.[identifier];
      const forget = (picks?.replace ?? []).filter(id => actor.items.has(id));
      if ( forget.length ) await actor.deleteEmbeddedDocuments("Item", forget);
      if ( caster && picks ) {
        const items = await spellItemData(caster, picks, itemDataFrom);
        if ( items.length ) await actor.createEmbeddedDocuments("Item", items);
      }
      ui.notifications.info(t("LevelUp.Done", { name: actor.name, level: actor.system.details.level }));
      await this.app.finish();
      actor.sheet?.render(true);
    } catch(err) {
      console.error(err);
      ui.notifications.error(t("Review.Failed", { error: err.message }));
    } finally {
      this.finishing = false;
    }
  }
}

/** Resolve the level-up target into documents and derived flags for the wizard. */
export async function resolveLevelupTarget(app) {
  const { draft: state, actor } = app;
  const target = state.levelup.target;
  if ( !target ) return null;
  const split = target.indexOf(":");
  const kind = target.slice(0, split);
  const ref = target.slice(split + 1);
  let classItem = null;
  let classDoc = null;

  if ( kind === "existing" ) {
    classItem = actor.items.get(ref);
    if ( !classItem ) return null;
  } else {
    classDoc = await getDocument(ref);
    if ( !classDoc ) return null;
  }
  const source = classItem ?? classDoc;
  const identifier = source.identifier ?? source.system.identifier;

  // Remember the new level when the target is picked; after applying, the class item already has it.
  if ( !state.levelup.applied || !state.levelup.newLevel ) {
    state.levelup.newLevel = classItem ? classItem.system.levels + 1 : 1;
  }
  state.levelup.identifier = identifier;
  const newLevel = state.levelup.newLevel;

  // Subclass gallery appears when this level unlocks the subclass and the class doesn't have one.
  const subclassAdv = (classItem ?? classDoc).advancement?.byType?.Subclass?.[0];
  const unlock = subclassAdv?.level ?? subclassAdv?.levels?.[0] ?? null;
  const hasSubclass = !!classItem?.subclass && !state.levelup.applied;
  const subclassUnlock = (unlock !== null) && (unlock === newLevel) && !hasSubclass && !state.levelup.applied;

  return {
    classItem,
    classDoc: classDoc ?? (classItem?._stats?.compendiumSource ? await getDocument(classItem._stats.compendiumSource).catch(() => null) : null) ?? classItem,
    identifier,
    name: source.name,
    img: source.img,
    newLevel,
    subclassUnlock,
    casting: castingClasses(actor).some(c => c.identifier === identifier)
  };
}
