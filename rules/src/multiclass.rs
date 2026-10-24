//! Multiclassing prerequisites.
//!
//! Both editions require a minimum score (13) in the primary ability of the class being entered and
//! of every class the character already has. dnd5e stores this per class as
//! `system.primaryAbility = { value: Set<ability>, all: bool }`, so the rule is entirely data-driven.

use crate::abilities::Scores;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassRequirement {
    pub identifier: String,
    #[serde(default)]
    pub label: String,
    /// Primary ability keys. Empty means the class has no requirement.
    #[serde(default)]
    pub primary: Vec<String>,
    /// True if every listed ability must meet the minimum, false if any one is enough.
    #[serde(default)]
    pub all: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckRequest {
    pub abilities: Scores,
    /// Classes the character already has.
    #[serde(default)]
    pub current: Vec<ClassRequirement>,
    pub target: ClassRequirement,
    #[serde(default = "minimum")]
    pub minimum: i32,
}

fn minimum() -> i32 {
    13
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Failure {
    pub identifier: String,
    pub label: String,
    pub all: bool,
    /// Abilities that fall short of the minimum.
    pub missing: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckResult {
    pub ok: bool,
    /// True when the target is a class the character already has (a normal level-up).
    pub existing: bool,
    pub failures: Vec<Failure>,
}

fn evaluate(req: &ClassRequirement, abilities: &Scores, min: i32) -> Option<Failure> {
    if req.primary.is_empty() {
        return None;
    }
    let short: Vec<String> =
        req.primary.iter().filter(|a| abilities.get(*a).copied().unwrap_or(0) < min).cloned().collect();
    let met = if req.all { short.is_empty() } else { short.len() < req.primary.len() };
    (!met).then(|| Failure {
        identifier: req.identifier.clone(),
        label: if req.label.is_empty() { req.identifier.clone() } else { req.label.clone() },
        all: req.all,
        missing: short,
    })
}

pub fn check(req: &CheckRequest) -> CheckResult {
    let existing = req.current.iter().any(|c| c.identifier == req.target.identifier);
    if existing {
        return CheckResult { ok: true, existing, failures: vec![] };
    }
    let failures: Vec<Failure> = std::iter::once(&req.target)
        .chain(req.current.iter())
        .filter_map(|c| evaluate(c, &req.abilities, req.minimum))
        .collect();
    CheckResult { ok: failures.is_empty(), existing, failures }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scores(pairs: &[(&str, i32)]) -> Scores {
        let mut s: Scores = crate::ABILITIES.iter().map(|k| (k.to_string(), 10)).collect();
        for (k, v) in pairs {
            s.insert(k.to_string(), *v);
        }
        s
    }

    fn class(id: &str, primary: &[&str], all: bool) -> ClassRequirement {
        ClassRequirement {
            identifier: id.into(),
            label: String::new(),
            primary: primary.iter().map(|s| s.to_string()).collect(),
            all,
        }
    }

    #[test]
    fn fighter_into_wizard_needs_both() {
        let req = CheckRequest {
            abilities: scores(&[("str", 15), ("int", 12)]),
            current: vec![class("fighter", &["str", "dex"], false)],
            target: class("wizard", &["int"], false),
            minimum: 13,
        };
        let r = check(&req);
        assert!(!r.ok);
        assert_eq!(r.failures.len(), 1);
        assert_eq!(r.failures[0].identifier, "wizard");
        assert_eq!(r.failures[0].missing, vec!["int"]);
    }

    #[test]
    fn any_vs_all_primary_abilities() {
        // Fighter: Strength OR Dexterity. Paladin: Strength AND Charisma.
        let s = scores(&[("dex", 14), ("str", 13), ("cha", 12)]);
        assert!(evaluate(&class("fighter", &["str", "dex"], false), &s, 13).is_none());
        let fail = evaluate(&class("paladin", &["str", "cha"], true), &s, 13).unwrap();
        assert_eq!(fail.missing, vec!["cha"]);
    }

    #[test]
    fn leveling_an_existing_class_is_always_allowed() {
        let r = check(&CheckRequest {
            abilities: scores(&[]),
            current: vec![class("wizard", &["int"], false)],
            target: class("wizard", &["int"], false),
            minimum: 13,
        });
        assert!(r.ok && r.existing);
    }

    #[test]
    fn classes_without_requirements_pass() {
        let r = check(&CheckRequest {
            abilities: scores(&[]),
            current: vec![],
            target: class("homebrew", &[], false),
            minimum: 13,
        });
        assert!(r.ok);
    }
}
