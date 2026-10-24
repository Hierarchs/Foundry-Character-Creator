/**
 * Starting equipment: presents a class/background `startingEquipment` tree as choices, resolves the
 * player's selection through the Rust engine, and turns the result into embedded item data.
 */
import { Rules } from "../rules.mjs";
import { getCategoryOptions } from "../data/compendium.mjs";

const CATEGORY_TYPES = new Set(["weapon", "armor", "tool", "focus"]);

function plainEntries(doc) {
  return (doc?.system?.startingEquipment ?? []).map(e => (typeof e.toObject === "function" ? e.toObject() : e));
}

/** Name and image for an item UUID, loading the document if its pack index isn't cached. */
export async function itemInfo(uuid) {
  let info = null;
  try {
    info = fromUuidSync(uuid) ?? await fromUuid(uuid);
  } catch { /* Missing or inaccessible compendium. */ }
  return { name: info?.name ?? uuid, img: info?.img ?? "icons/svg/item-bag.svg" };
}

export function hasStartingEquipment(doc) {
  return plainEntries(doc).length > 0;
}

/** Resolve a selection without building a view (used for validation and final assembly). */
export function resolveSelection(doc, selection={}) {
  return Rules.resolveEquipment(plainEntries(doc), {
    choices: selection.choices ?? {},
    picks: selection.picks ?? {}
  });
}

function childrenOf(entries, id) {
  return entries.filter(e => e.group === id).sort((a, b) => a.sort - b.sort);
}

function label(entry, depth) {
  try {
    return entry.generateLabel?.({ depth }) ?? entry.label ?? "";
  } catch {
    return entry.label ?? entry.type;
  }
}

/**
 * Build a render tree for the equipment template.
 * @param {Item} doc
 * @param {{ choices: object, picks: object }} selection
 */
export async function equipmentView(doc, selection={}) {
  const entries = Array.from(doc?.system?.startingEquipment ?? []);
  const resolved = resolveSelection(doc, selection);
  const active = new Set(resolved.active);

  const build = async (entry, depth) => {
    const node = {
      id: entry._id,
      type: entry.type,
      depth,
      label: label(entry, depth),
      active: active.has(entry._id),
      count: entry.count ?? 1
    };
    const children = childrenOf(entries, entry._id);
    if ( entry.type === "OR" ) {
      node.isChoice = true;
      node.chosen = selection.choices?.[entry._id] ?? (children.length === 1 ? children[0]._id : null);
      node.options = await Promise.all(children.map(async (c, i) => ({
        ...(await build(c, depth + 1)),
        letter: String.fromCharCode(65 + i),
        selected: node.chosen === c._id
      })));
    } else if ( entry.type === "AND" ) {
      node.isGroup = true;
      node.children = await Promise.all(children.map(c => build(c, depth + 1)));
    } else if ( CATEGORY_TYPES.has(entry.type) ) {
      node.isPick = true;
      node.picked = selection.picks?.[entry._id] ?? "";
      node.options = (await getCategoryOptions(entry.type, entry.key))
        .map(o => ({ ...o, selected: o.uuid === node.picked }));
    } else if ( entry.type === "linked" ) {
      node.isItem = true;
      Object.assign(node, await itemInfo(entry.key));
      node.uuid = entry.key;
    } else if ( entry.type === "currency" ) {
      node.isCurrency = true;
      node.currency = (entry.key || "gp").toUpperCase();
    }
    return node;
  };

  const roots = entries.filter(e => !e.group).sort((a, b) => a.sort - b.sort);
  return { nodes: await Promise.all(roots.map(r => build(r, 1))), resolved };
}

/** Evaluate a wealth formula ("55", "5d4 * 10") to a number of coins. */
export async function rollWealth(formula, { toChat=false, flavor }={}) {
  const roll = new Roll(String(formula || "0"));
  await roll.evaluate();
  if ( toChat && !roll.isDeterministic ) await roll.toMessage({ flavor });
  return Math.max(0, Math.floor(roll.total));
}

/**
 * An entry's count is the total number of units ("20× Arrows" on an item that is already a stack
 * of 20), so it replaces the item's quantity rather than multiplying it. Without a count the item's
 * own quantity (e.g. a bundle) is kept.
 */
function applyCount(data, count) {
  if ( !data.system || !(count > 1) ) return;
  data.system.quantity = count;
}

/**
 * Item data for resolved grants, including container contents (packs come with their gear).
 * @param {{ uuid: string, count: number }[]} grants
 * @param {Function} itemDataFrom
 */
export async function equipmentItemData(grants, itemDataFrom) {
  const out = [];
  const Item5e = CONFIG.Item.documentClass;
  for ( const grant of grants ) {
    const doc = await fromUuid(grant.uuid);
    if ( !doc ) continue;
    if ( (doc.type === "container") && Item5e.createWithContents ) {
      const created = await Item5e.createWithContents([doc]);
      if ( created?.length ) {
        applyCount(created[0], grant.count);
        out.push(...created);
        continue;
      }
    }
    const data = itemDataFrom(doc);
    applyCount(data, grant.count);
    out.push(data);
  }
  return out;
}
