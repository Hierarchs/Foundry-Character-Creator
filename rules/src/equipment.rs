//! Resolve a class or background's `system.startingEquipment` tree into concrete grants.
//!
//! dnd5e stores starting equipment as a flat list of entries linked by `group`:
//! - `AND` grants every child, `OR` grants exactly one chosen child,
//! - `linked` is a specific item UUID, `currency` adds coins,
//! - `weapon` / `armor` / `tool` / `focus` are "any X" categories the player picks an item for.
//! Top-level entries are all granted (legacy lists use several top-level ORs).

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    #[serde(rename = "_id")]
    pub id: String,
    #[serde(default)]
    pub group: Option<String>,
    #[serde(default)]
    pub sort: i64,
    pub r#type: String,
    #[serde(default)]
    pub count: Option<f64>,
    #[serde(default)]
    pub key: Option<String>,
    #[serde(default)]
    pub requires_proficiency: bool,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Selection {
    /// OR entry id -> chosen child entry id.
    #[serde(default)]
    pub choices: BTreeMap<String, String>,
    /// Category entry id -> chosen item UUID.
    #[serde(default)]
    pub picks: BTreeMap<String, String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveRequest {
    pub entries: Vec<Entry>,
    #[serde(default)]
    pub selection: Selection,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Grant {
    pub uuid: String,
    pub count: u32,
    /// Entry that produced this grant (for UI highlighting).
    pub entry: String,
    pub requires_proficiency: bool,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum Pending {
    /// An OR group still needs a choice.
    Choice { entry: String, options: Vec<String> },
    /// A category entry ("any simple weapon") still needs an item.
    Pick { entry: String, category: String, key: Option<String>, count: u32 },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveResult {
    pub grants: Vec<Grant>,
    pub currency: BTreeMap<String, f64>,
    pub pending: Vec<Pending>,
    pub complete: bool,
    /// Entries that are part of the active selection path (chosen OR branches and their contents).
    pub active: Vec<String>,
}

const CATEGORIES: [&str; 4] = ["weapon", "armor", "tool", "focus"];
/// dnd5e caps nesting at four levels; refuse anything deeper (or cyclic) instead of recursing forever.
const MAX_DEPTH: usize = 8;

fn count_of(e: &Entry) -> u32 {
    e.count.filter(|c| c.is_finite() && *c >= 1.0).map_or(1, |c| c.round() as u32)
}

struct Resolver<'a> {
    entries: &'a [Entry],
    selection: &'a Selection,
    grants: Vec<Grant>,
    currency: BTreeMap<String, f64>,
    pending: Vec<Pending>,
    active: Vec<String>,
}

impl<'a> Resolver<'a> {
    fn children(&self, id: &str) -> Vec<&'a Entry> {
        let mut c: Vec<&Entry> = self.entries.iter().filter(|e| e.group.as_deref() == Some(id)).collect();
        c.sort_by_key(|e| e.sort);
        c
    }

    fn grant(&mut self, uuid: &str, count: u32, entry: &Entry) {
        if let Some(g) = self.grants.iter_mut().find(|g| g.uuid == uuid) {
            g.count += count;
        } else {
            self.grants.push(Grant {
                uuid: uuid.to_string(),
                count,
                entry: entry.id.clone(),
                requires_proficiency: entry.requires_proficiency,
            });
        }
    }

    fn visit(&mut self, entry: &'a Entry, depth: usize) {
        if depth > MAX_DEPTH {
            return;
        }
        self.active.push(entry.id.clone());
        match entry.r#type.as_str() {
            "AND" => {
                for child in self.children(&entry.id) {
                    self.visit(child, depth + 1);
                }
            }
            "OR" => {
                let options = self.children(&entry.id);
                // A one-option OR is not really a choice.
                let chosen = match options.as_slice() {
                    [only] => Some(*only),
                    _ => self
                        .selection
                        .choices
                        .get(&entry.id)
                        .and_then(|id| options.iter().copied().find(|o| &o.id == id)),
                };
                match chosen {
                    Some(child) => self.visit(child, depth + 1),
                    None if options.is_empty() => {}
                    None => self.pending.push(Pending::Choice {
                        entry: entry.id.clone(),
                        options: options.iter().map(|o| o.id.clone()).collect(),
                    }),
                }
            }
            "linked" => {
                if let Some(uuid) = entry.key.as_deref().filter(|k| !k.is_empty()) {
                    self.grant(uuid, count_of(entry), entry);
                }
            }
            "currency" => {
                let denomination = entry.key.clone().filter(|k| !k.is_empty()).unwrap_or_else(|| "gp".into());
                *self.currency.entry(denomination).or_insert(0.0) += entry.count.unwrap_or(0.0);
            }
            category if CATEGORIES.contains(&category) => match self.selection.picks.get(&entry.id) {
                Some(uuid) if !uuid.is_empty() => self.grant(&uuid.clone(), count_of(entry), entry),
                _ => self.pending.push(Pending::Pick {
                    entry: entry.id.clone(),
                    category: category.to_string(),
                    key: entry.key.clone().filter(|k| !k.is_empty()),
                    count: count_of(entry),
                }),
            },
            _ => {}
        }
    }
}

pub fn resolve(req: &ResolveRequest) -> ResolveResult {
    let mut r = Resolver {
        entries: &req.entries,
        selection: &req.selection,
        grants: vec![],
        currency: BTreeMap::new(),
        pending: vec![],
        active: vec![],
    };
    let mut roots: Vec<&Entry> =
        req.entries.iter().filter(|e| e.group.as_deref().is_none_or(str::is_empty)).collect();
    roots.sort_by_key(|e| e.sort);
    for root in roots {
        r.visit(root, 0);
    }
    let complete = r.pending.is_empty();
    ResolveResult { grants: r.grants, currency: r.currency, pending: r.pending, complete, active: r.active }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn e(id: &str, group: &str, sort: i64, ty: &str, key: &str, count: Option<f64>) -> Entry {
        Entry {
            id: id.into(),
            group: (!group.is_empty()).then(|| group.into()),
            sort,
            r#type: ty.into(),
            count,
            key: (!key.is_empty()).then(|| key.into()),
            requires_proficiency: false,
        }
    }

    /// Mirrors the SRD 5.2 wizard: AND(2 daggers, OR(arcane focus quarterstaff), robe, pack, 5 gp).
    fn wizard() -> Vec<Entry> {
        vec![
            e("and", "", 1, "AND", "", None),
            e("dagger", "and", 2, "linked", "Item.dagger", Some(2.0)),
            e("or", "and", 3, "OR", "", None),
            e("staff", "or", 6, "linked", "Item.staff", None),
            e("robe", "and", 4, "linked", "Item.robe", None),
            e("pack", "and", 5, "linked", "Item.pack", None),
            e("gold", "and", 7, "currency", "gp", Some(5.0)),
        ]
    }

    #[test]
    fn wizard_needs_no_choices() {
        let r = resolve(&ResolveRequest { entries: wizard(), selection: Selection::default() });
        assert!(r.complete, "{:?}", r.pending);
        let uuids: Vec<&str> = r.grants.iter().map(|g| g.uuid.as_str()).collect();
        assert_eq!(uuids, vec!["Item.dagger", "Item.staff", "Item.robe", "Item.pack"]);
        assert_eq!(r.grants[0].count, 2);
        assert_eq!(r.currency["gp"], 5.0);
    }

    fn legacy_fighter() -> Vec<Entry> {
        vec![
            e("armor", "", 1, "OR", "", None),
            e("chain", "armor", 1, "linked", "Item.chain", None),
            e("leatherset", "armor", 2, "AND", "", None),
            e("leather", "leatherset", 1, "linked", "Item.leather", None),
            e("longbow", "leatherset", 2, "linked", "Item.longbow", None),
            e("weapons", "", 2, "AND", "", None),
            e("martial", "weapons", 1, "weapon", "mar", Some(2.0)),
        ]
    }

    #[test]
    fn choices_and_picks_are_reported_until_made() {
        let r = resolve(&ResolveRequest { entries: legacy_fighter(), selection: Selection::default() });
        assert!(!r.complete);
        assert_eq!(r.pending.len(), 2);
        assert!(matches!(&r.pending[0], Pending::Choice { entry, options } if entry == "armor" && options.len() == 2));
        assert!(matches!(&r.pending[1], Pending::Pick { category, key, count, .. }
            if category == "weapon" && key.as_deref() == Some("mar") && *count == 2));
    }

    #[test]
    fn chosen_branch_is_granted() {
        let mut selection = Selection::default();
        selection.choices.insert("armor".into(), "leatherset".into());
        selection.picks.insert("martial".into(), "Item.longsword".into());
        let r = resolve(&ResolveRequest { entries: legacy_fighter(), selection });
        assert!(r.complete);
        let uuids: Vec<(&str, u32)> = r.grants.iter().map(|g| (g.uuid.as_str(), g.count)).collect();
        assert_eq!(uuids, vec![("Item.leather", 1), ("Item.longbow", 1), ("Item.longsword", 2)]);
        assert!(r.active.contains(&"leatherset".to_string()));
        assert!(!r.active.contains(&"chain".to_string()));
    }

    #[test]
    fn stale_choice_is_ignored() {
        let mut selection = Selection::default();
        selection.choices.insert("armor".into(), "does-not-exist".into());
        let r = resolve(&ResolveRequest { entries: legacy_fighter(), selection });
        assert!(matches!(&r.pending[0], Pending::Choice { .. }));
    }

    #[test]
    fn cyclic_groups_terminate() {
        let entries = vec![e("a", "", 0, "AND", "", None), e("b", "a", 0, "AND", "", None)];
        let mut cyclic = entries.clone();
        cyclic[0].group = Some("b".into()); // a <-> b, with no root
        cyclic.push(e("root", "", 0, "AND", "", None));
        cyclic[1].group = Some("root".into());
        let r = resolve(&ResolveRequest { entries: cyclic, selection: Selection::default() });
        assert!(r.complete);
    }

    #[test]
    fn duplicate_linked_items_stack() {
        let entries = vec![
            e("and", "", 0, "AND", "", None),
            e("x", "and", 1, "linked", "Item.dart", Some(10.0)),
            e("y", "and", 2, "linked", "Item.dart", Some(5.0)),
        ];
        let r = resolve(&ResolveRequest { entries, selection: Selection::default() });
        assert_eq!(r.grants.len(), 1);
        assert_eq!(r.grants[0].count, 15);
    }
}
