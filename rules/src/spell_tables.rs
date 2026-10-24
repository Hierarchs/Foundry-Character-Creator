//! Built-in spell-count tables per class.
//!
//! These are a fallback for content that does not carry its own "cantrips known" / "max prepared"
//! scale values, and the starting point for the GM's Spell Rules editor. Numbers for the core
//! classes match the SRD 5.1 and SRD 5.2 class tables shipped with the dnd5e system.

use crate::Rules;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Casting {
    /// Learns a fixed list of spells (2014 bard, sorcerer, warlock, ranger...).
    Known,
    /// Prepares a number of spells from the whole class list.
    Prepared,
    /// Warlock Pact Magic.
    Pact,
    /// Wizard: prepares from a personal spellbook.
    Spellbook,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Progression {
    #[default]
    None,
    Full,
    Half,
    Third,
    Artificer,
    Pact,
}

/// `ability modifier + level / divisor` (minimum `min`), used by 2014 prepared casters.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Formula {
    pub divisor: u8,
    pub min: u8,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpellbookSize {
    pub start: u8,
    pub per_level: u8,
}

/// Fully expanded spellcasting rule for one class. This is also the JSON shape stored in the
/// GM's Spell Rules setting, so overrides round-trip through the same struct.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpellRule {
    pub identifier: String,
    pub label: String,
    #[serde(default)]
    pub rules: Rules,
    pub casting: Casting,
    pub progression: Progression,
    pub spell_list: String,
    #[serde(default)]
    pub replace_per_level: u8,
    /// Cantrips known at class levels 1-20.
    pub cantrips: Vec<u8>,
    /// Spells known/prepared at class levels 1-20; `None` when `formula` is used instead.
    #[serde(default)]
    pub spells: Option<Vec<u8>>,
    #[serde(default)]
    pub formula: Option<Formula>,
    #[serde(default)]
    pub spellbook: Option<SpellbookSize>,
}

/// Expand `(level, value)` breakpoints into a 20-entry table.
pub fn expand(points: &[(u8, u8)]) -> Vec<u8> {
    (1..=20u8)
        .map(|lvl| points.iter().filter(|(l, _)| *l <= lvl).map(|(_, v)| *v).last().unwrap_or(0))
        .collect()
}

struct Def {
    id: &'static str,
    label: &'static str,
    rules: Rules,
    casting: Casting,
    progression: Progression,
    list: &'static str,
    replace: u8,
    cantrips: &'static [(u8, u8)],
    spells: Option<&'static [(u8, u8)]>,
    formula: Option<Formula>,
    spellbook: Option<SpellbookSize>,
}

// ---- SRD 5.2 (2024) ----------------------------------------------------------------------------

const FULL_PREPARED_24: &[(u8, u8)] = &[
    (1, 4), (2, 5), (3, 6), (4, 7), (5, 9), (6, 10), (7, 11), (8, 12), (9, 14), (10, 15), (11, 16),
    (13, 17), (15, 18), (17, 19), (18, 20), (19, 21), (20, 22),
];
const SORCERER_PREPARED_24: &[(u8, u8)] = &[
    (1, 2), (2, 4), (3, 6), (4, 7), (5, 9), (6, 10), (7, 11), (8, 12), (9, 14), (10, 15), (11, 16),
    (13, 17), (15, 18), (17, 19), (18, 20), (19, 21), (20, 22),
];
const WIZARD_PREPARED_24: &[(u8, u8)] = &[
    (1, 4), (2, 5), (3, 6), (4, 7), (5, 9), (6, 10), (7, 11), (8, 12), (9, 14), (10, 15), (11, 16),
    (13, 17), (14, 18), (15, 19), (16, 21), (17, 22), (18, 23), (19, 24), (20, 25),
];
const HALF_PREPARED_24: &[(u8, u8)] = &[
    (1, 2), (2, 3), (3, 4), (4, 5), (5, 6), (7, 7), (9, 9), (11, 10), (13, 11), (15, 12), (17, 14), (19, 15),
];
const WARLOCK_PREPARED: &[(u8, u8)] = &[
    (1, 2), (2, 3), (3, 4), (4, 5), (5, 6), (6, 7), (7, 8), (8, 9), (9, 10), (11, 11), (13, 12), (15, 13),
    (17, 14), (19, 15),
];
const THIRD_SPELLS: &[(u8, u8)] = &[
    (3, 3), (4, 4), (7, 5), (8, 6), (10, 7), (11, 8), (13, 9), (14, 10), (16, 11), (19, 12), (20, 13),
];

const C_2_3_4: &[(u8, u8)] = &[(1, 2), (4, 3), (10, 4)];
const C_3_4_5: &[(u8, u8)] = &[(1, 3), (4, 4), (10, 5)];
const C_4_5_6: &[(u8, u8)] = &[(1, 4), (4, 5), (10, 6)];
const C_ARTIFICER: &[(u8, u8)] = &[(1, 2), (10, 3), (14, 4)];
const C_EK: &[(u8, u8)] = &[(3, 2), (10, 3)];
const C_AT: &[(u8, u8)] = &[(3, 3), (10, 4)];
const NONE: &[(u8, u8)] = &[];

// ---- SRD 5.1 (2014) ----------------------------------------------------------------------------

const BARD_KNOWN_14: &[(u8, u8)] = &[
    (1, 4), (2, 5), (3, 6), (4, 7), (5, 8), (6, 9), (7, 10), (8, 11), (9, 12), (10, 14), (11, 15),
    (13, 16), (14, 18), (15, 19), (17, 20), (18, 22),
];
const SORCERER_KNOWN_14: &[(u8, u8)] = &[
    (1, 2), (2, 3), (3, 4), (4, 5), (5, 6), (6, 7), (7, 8), (8, 9), (9, 10), (10, 11), (11, 12),
    (13, 13), (15, 14), (17, 15),
];
const RANGER_KNOWN_14: &[(u8, u8)] = &[
    (2, 2), (3, 3), (5, 4), (7, 5), (9, 6), (11, 7), (13, 8), (15, 9), (17, 10), (19, 11),
];

const MOD_PLUS_LEVEL: Formula = Formula { divisor: 1, min: 1 };
const MOD_PLUS_HALF: Formula = Formula { divisor: 2, min: 1 };
const WIZARD_BOOK: SpellbookSize = SpellbookSize { start: 6, per_level: 2 };

use Casting::*;
use Progression as P;
use Rules::{Legacy, Modern};

#[rustfmt::skip]
const DEFS: &[Def] = &[
    // 2024
    Def { id: "artificer", label: "Artificer", rules: Modern, casting: Prepared, progression: P::Artificer, list: "artificer", replace: 1, cantrips: C_ARTIFICER, spells: Some(HALF_PREPARED_24), formula: None, spellbook: None },
    Def { id: "bard", label: "Bard", rules: Modern, casting: Prepared, progression: P::Full, list: "bard", replace: 1, cantrips: C_2_3_4, spells: Some(FULL_PREPARED_24), formula: None, spellbook: None },
    Def { id: "cleric", label: "Cleric", rules: Modern, casting: Prepared, progression: P::Full, list: "cleric", replace: 0, cantrips: C_3_4_5, spells: Some(FULL_PREPARED_24), formula: None, spellbook: None },
    Def { id: "druid", label: "Druid", rules: Modern, casting: Prepared, progression: P::Full, list: "druid", replace: 0, cantrips: C_2_3_4, spells: Some(FULL_PREPARED_24), formula: None, spellbook: None },
    Def { id: "eldritch-knight", label: "Eldritch Knight", rules: Modern, casting: Prepared, progression: P::Third, list: "wizard", replace: 1, cantrips: C_EK, spells: Some(THIRD_SPELLS), formula: None, spellbook: None },
    Def { id: "paladin", label: "Paladin", rules: Modern, casting: Prepared, progression: P::Half, list: "paladin", replace: 1, cantrips: NONE, spells: Some(HALF_PREPARED_24), formula: None, spellbook: None },
    Def { id: "ranger", label: "Ranger", rules: Modern, casting: Prepared, progression: P::Half, list: "ranger", replace: 1, cantrips: NONE, spells: Some(HALF_PREPARED_24), formula: None, spellbook: None },
    Def { id: "sorcerer", label: "Sorcerer", rules: Modern, casting: Prepared, progression: P::Full, list: "sorcerer", replace: 1, cantrips: C_4_5_6, spells: Some(SORCERER_PREPARED_24), formula: None, spellbook: None },
    Def { id: "arcane-trickster", label: "Arcane Trickster", rules: Modern, casting: Prepared, progression: P::Third, list: "wizard", replace: 1, cantrips: C_AT, spells: Some(THIRD_SPELLS), formula: None, spellbook: None },
    Def { id: "warlock", label: "Warlock", rules: Modern, casting: Pact, progression: P::Pact, list: "warlock", replace: 1, cantrips: C_2_3_4, spells: Some(WARLOCK_PREPARED), formula: None, spellbook: None },
    Def { id: "wizard", label: "Wizard", rules: Modern, casting: Spellbook, progression: P::Full, list: "wizard", replace: 0, cantrips: C_3_4_5, spells: Some(WIZARD_PREPARED_24), formula: None, spellbook: Some(WIZARD_BOOK) },
    // 2014
    Def { id: "artificer", label: "Artificer", rules: Legacy, casting: Prepared, progression: P::Artificer, list: "artificer", replace: 0, cantrips: C_ARTIFICER, spells: None, formula: Some(MOD_PLUS_HALF), spellbook: None },
    Def { id: "bard", label: "Bard", rules: Legacy, casting: Known, progression: P::Full, list: "bard", replace: 1, cantrips: C_2_3_4, spells: Some(BARD_KNOWN_14), formula: None, spellbook: None },
    Def { id: "cleric", label: "Cleric", rules: Legacy, casting: Prepared, progression: P::Full, list: "cleric", replace: 0, cantrips: C_3_4_5, spells: None, formula: Some(MOD_PLUS_LEVEL), spellbook: None },
    Def { id: "druid", label: "Druid", rules: Legacy, casting: Prepared, progression: P::Full, list: "druid", replace: 0, cantrips: C_2_3_4, spells: None, formula: Some(MOD_PLUS_LEVEL), spellbook: None },
    Def { id: "eldritch-knight", label: "Eldritch Knight", rules: Legacy, casting: Known, progression: P::Third, list: "wizard", replace: 1, cantrips: C_EK, spells: Some(THIRD_SPELLS), formula: None, spellbook: None },
    Def { id: "paladin", label: "Paladin", rules: Legacy, casting: Prepared, progression: P::Half, list: "paladin", replace: 0, cantrips: NONE, spells: None, formula: Some(MOD_PLUS_HALF), spellbook: None },
    Def { id: "ranger", label: "Ranger", rules: Legacy, casting: Known, progression: P::Half, list: "ranger", replace: 1, cantrips: NONE, spells: Some(RANGER_KNOWN_14), formula: None, spellbook: None },
    Def { id: "sorcerer", label: "Sorcerer", rules: Legacy, casting: Known, progression: P::Full, list: "sorcerer", replace: 1, cantrips: C_4_5_6, spells: Some(SORCERER_KNOWN_14), formula: None, spellbook: None },
    Def { id: "arcane-trickster", label: "Arcane Trickster", rules: Legacy, casting: Known, progression: P::Third, list: "wizard", replace: 1, cantrips: C_AT, spells: Some(THIRD_SPELLS), formula: None, spellbook: None },
    Def { id: "warlock", label: "Warlock", rules: Legacy, casting: Pact, progression: P::Pact, list: "warlock", replace: 1, cantrips: C_2_3_4, spells: Some(WARLOCK_PREPARED), formula: None, spellbook: None },
    Def { id: "wizard", label: "Wizard", rules: Legacy, casting: Spellbook, progression: P::Full, list: "wizard", replace: 0, cantrips: C_3_4_5, spells: None, formula: Some(MOD_PLUS_LEVEL), spellbook: Some(WIZARD_BOOK) },
];

fn to_rule(d: &Def) -> SpellRule {
    SpellRule {
        identifier: d.id.into(),
        label: d.label.into(),
        rules: d.rules,
        casting: d.casting,
        progression: d.progression,
        spell_list: d.list.into(),
        replace_per_level: d.replace,
        cantrips: expand(d.cantrips),
        spells: d.spells.map(expand),
        formula: d.formula,
        spellbook: d.spellbook,
    }
}

/// Built-in rule for a class identifier, preferring the requested edition and falling back to
/// the other one (homebrew reprints often reuse identifiers across editions).
pub fn default_rule(identifier: &str, rules: Rules) -> Option<SpellRule> {
    DEFS.iter()
        .find(|d| d.id == identifier && d.rules == rules)
        .or_else(|| DEFS.iter().find(|d| d.id == identifier))
        .map(to_rule)
}

/// All built-in rules for one edition, sorted by label.
pub fn defaults(rules: Rules) -> Vec<SpellRule> {
    let mut out: Vec<SpellRule> = DEFS.iter().filter(|d| d.rules == rules).map(to_rule).collect();
    out.sort_by(|a, b| a.label.cmp(&b.label));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expand_fills_gaps_and_leading_zeroes() {
        let t = expand(&[(3, 2), (10, 3)]);
        assert_eq!(t.len(), 20);
        assert_eq!(&t[..4], &[0, 0, 2, 2]);
        assert_eq!(t[9], 3);
        assert_eq!(t[19], 3);
    }

    #[test]
    fn modern_wizard_matches_srd() {
        let w = default_rule("wizard", Rules::Modern).unwrap();
        let spells = w.spells.unwrap();
        assert_eq!(spells[0], 4);
        assert_eq!(spells[11], 16); // level 12 carries level 11's value
        assert_eq!(spells[19], 25);
        assert_eq!(w.cantrips[0], 3);
        assert_eq!(w.cantrips[3], 4);
        assert_eq!(w.casting, Casting::Spellbook);
    }

    #[test]
    fn legacy_cleric_uses_formula() {
        let c = default_rule("cleric", Rules::Legacy).unwrap();
        assert!(c.spells.is_none());
        assert_eq!(c.formula, Some(MOD_PLUS_LEVEL));
    }

    #[test]
    fn unknown_edition_falls_back() {
        assert!(default_rule("bard", Rules::Legacy).is_some());
        assert!(default_rule("fighter", Rules::Modern).is_none());
    }

    #[test]
    fn every_table_has_twenty_levels() {
        for rules in [Rules::Modern, Rules::Legacy] {
            for rule in defaults(rules) {
                assert_eq!(rule.cantrips.len(), 20, "{}", rule.identifier);
                if let Some(s) = &rule.spells {
                    assert_eq!(s.len(), 20, "{}", rule.identifier);
                    assert!(s.windows(2).all(|w| w[0] <= w[1]), "{} not monotonic", rule.identifier);
                }
                assert!(rule.spells.is_some() || rule.formula.is_some(), "{}", rule.identifier);
            }
        }
    }
}
