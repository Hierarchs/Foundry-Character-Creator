/**
 * Assemble the finished character from the wizard state and create it.
 */
import { DEFAULT_PORTRAIT, MODULE_ID } from "../constants.mjs";
import { Rules } from "../rules.mjs";
import { itemDataFrom } from "./advancement.mjs";
import { castingClasses, spellItemData } from "./spells.mjs";
import { equipmentItemData, hasStartingEquipment, resolveSelection } from "./equipment.mjs";
import { requestCreation, targetFolder } from "./socket.mjs";
import { setting, t, textToHTML } from "../utils.mjs";

/**
 * @param {import("../apps/wizard.mjs").default} app
 * @returns {Promise<object>} Actor creation data.
 */
export async function assembleActor(app) {
  const { draft: state, docs } = app;
  if ( !app.buildCurrent ) throw new Error(t("Errors.NotBuilt"));
  const data = foundry.utils.deepClone(state.build);
  delete data._id;
  data.items ??= [];
  const d = state.details;

  // Identity
  data.name = d.name?.trim() || t("Defaults.Name");
  data.img = d.img || DEFAULT_PORTRAIT;
  const tokenSrc = d.sameToken ? data.img : (d.tokenImg || data.img);
  data.prototypeToken = foundry.utils.mergeObject(data.prototypeToken ?? {}, {
    name: data.name,
    actorLink: true,
    disposition: CONST.TOKEN_DISPOSITIONS.FRIENDLY,
    texture: { src: tokenSrc },
    sight: { enabled: true }
  });

  // Details
  foundry.utils.mergeObject(data, {
    "system.details.alignment": d.alignment ?? "",
    "system.details.gender": d.gender ?? "",
    "system.details.age": d.age ?? "",
    "system.details.height": d.height ?? "",
    "system.details.weight": d.weight ?? "",
    "system.details.eyes": d.eyes ?? "",
    "system.details.hair": d.hair ?? "",
    "system.details.skin": d.skin ?? "",
    "system.details.faith": d.faith ?? "",
    "system.details.appearance": d.appearance ?? "",
    "system.details.trait": d.trait ?? "",
    "system.details.ideal": d.ideal ?? "",
    "system.details.bond": d.bond ?? "",
    "system.details.flaw": d.flaw ?? "",
    "system.details.biography.value": textToHTML(d.backstory)
  });

  // Spells
  const preview = new Actor.implementation(foundry.utils.deepClone(data));
  for ( const caster of castingClasses(preview) ) {
    const picks = state.spells?.[caster.identifier];
    if ( picks ) data.items.push(...await spellItemData(caster, picks, itemDataFrom));
  }

  // Equipment & coins
  const currency = foundry.utils.deepClone(data.system?.currency ?? {});
  const defaultCurrency = CONFIG.DND5E.defaultCurrency ?? "gp";
  for ( const kind of ["class", "background"] ) {
    const doc = docs[kind];
    const sel = state.equipment?.[kind];
    if ( !doc || !sel ) continue;
    const useGold = !hasStartingEquipment(doc) || (sel.mode === "gold");
    if ( useGold ) {
      if ( sel.gold ) currency[defaultCurrency] = (currency[defaultCurrency] ?? 0) + sel.gold;
      continue;
    }
    const resolved = resolveSelection(doc, sel);
    data.items.push(...await equipmentItemData(resolved.grants, itemDataFrom));
    for ( const [key, amount] of Object.entries(resolved.currency) ) currency[key] = (currency[key] ?? 0) + amount;
  }
  foundry.utils.setProperty(data, "system.currency", currency);

  // Start at full health and at the experience threshold for the starting level.
  const prepared = new Actor.implementation(foundry.utils.deepClone(data));
  const level = prepared.system.details?.level || state.level || 1;
  foundry.utils.setProperty(data, "system.attributes.hp.value", prepared.system.attributes?.hp?.max ?? 1);
  foundry.utils.setProperty(data, "system.details.xp.value", Rules.xpForLevel(level));

  // Ownership & provenance
  const ownerId = (game.user.isGM && d.ownerId) ? d.ownerId : game.user.id;
  data.ownership = { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE, [ownerId]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER };
  foundry.utils.setProperty(data, `flags.${MODULE_ID}`, {
    created: Date.now(),
    method: state.abilities.method,
    rulesVersion: Rules.version()
  });
  return data;
}

/**
 * Create the character, via the GM relay if this user may not create actors.
 * @returns {Promise<Actor>}
 */
export async function createCharacter(data) {
  let actor;
  if ( game.user.can("ACTOR_CREATE") ) {
    data.folder = targetFolder();
    actor = await Actor.implementation.create(data, { keepEmbeddedIds: true });
  } else {
    if ( !setting("playerCreation") ) throw new Error(t("Errors.NoPermission"));
    actor = await requestCreation(data);
  }
  if ( !actor ) throw new Error(t("Errors.CreateFailed"));

  if ( !game.user.isGM && setting("assignCharacter") && !game.user.character ) {
    await game.user.update({ character: actor.id }).catch(() => {});
  }
  return actor;
}
