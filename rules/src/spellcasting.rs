//! Spell slots, castable spell levels, and how many spells a class may pick.

use crate::Rules;
use crate::spell_tables::{Casting, Progression, SpellRule, default_rule};
use serde::{Deserialize, Serialize};

/// Spell slots by caster level (index 0 = caster level 1), each listing slots for spell levels 1-9.
#[rustfmt::skip]
const SLOT_TABLE: [[u8; 9]; 20] = [
    [2, 0, 0, 0, 0, 0, 0, 0, 0],
    [3, 0, 0, 0, 0, 0, 0, 0, 0],
    [4, 2, 0, 0, 0, 0, 0, 0, 0],
    [4, 3, 0, 0, 0, 0, 0, 0, 0],
    [4, 3, 2, 0, 0, 0, 0, 0, 0],
    [4, 3, 3, 0, 0, 0, 0, 0, 0],
    [4, 3, 3, 1, 0, 0, 0, 0, 0],
    [4, 3, 3, 2, 0, 0, 0, 0, 0],
    [4, 3, 3, 3, 1, 0, 0, 0, 0],
    [4, 3, 3, 3, 2, 0, 0, 0, 0],
    [4, 3, 3, 3, 2, 1, 0, 0, 0],
    [4, 3, 3, 3, 2, 1, 0, 0, 0],
    [4, 3, 3, 3, 2, 1, 1, 0, 0],
    [4, 3, 3, 3, 2, 1, 1, 0, 0],
    [4, 3, 3, 3, 2, 1, 1, 1, 0],
    [4, 3, 3, 3, 2, 1, 1, 1, 0],
    [4, 3, 3, 3, 2, 1, 1, 1, 1],
    [4, 3, 3, 3, 3, 1, 1, 1, 1],
    [4, 3, 3, 3, 3, 2, 1, 1, 1],
    [4, 3, 3, 3, 3, 2, 2, 1, 1],
];

/// Pact Magic `(slots, slot level)` by warlock level.
#[rustfmt::skip]
const PACT_TABLE: [(u8, u8); 20] = [
    (1, 1), (2, 1), (2, 2), (2, 2), (2, 3), (2, 3), (2, 4), (2, 4), (2, 5), (2, 5),
    (3, 5), (3, 5), (3, 5), (3, 5), (3, 5), (3, 5), (4, 5), (4, 5), (4, 5), (4, 5),
];

fn clamp_level(level: u8) -> u8 {
    level.min(20)
}

/// Caster level a class contributes. Single-class casters use their own class table, which rounds
/// partial casters up once they have spellcasting; multiclassing uses the PHB's combination rules.
pub fn caster_level(progression: Progression, levels: u8, rules: Rules, single_class: bool) -> u8 {
    let l = clamp_level(levels);
    let ceil = |d: u8| l.div_ceil(d);
    match progression {
        Progression::None | Progression::Pact => 0,
        Progression::Full => l,
        Progression::Artificer => ceil(2),
        Progression::Half => match (rules, single_class) {
            // 2014 paladins and rangers gain spellcasting at level 2.
            (Rules::Legacy, true) if l < 2 => 0,
            (Rules::Legacy, true) => ceil(2),
            (Rules::Legacy, false) => l / 2,
            (Rules::Modern, _) => ceil(2),
        },
        Progression::Third => match single_class {
            true if l < 3 => 0,
            true => ceil(3),
            false => l / 3,
        },
    }
}

/// Highest spell level a class can learn or prepare on its own (cantrip-only = 0).
pub fn max_spell_level(progression: Progression, levels: u8, rules: Rules) -> u8 {
    if levels == 0 {
        return 0;
    }
    if progression == Progression::Pact {
        return PACT_TABLE[(clamp_level(levels) - 1) as usize].1;
    }
    highest_slot(caster_level(progression, levels, rules, true))
}

fn slots_for(caster_level: u8) -> [u8; 9] {
    if caster_level == 0 { [0; 9] } else { SLOT_TABLE[(clamp_level(caster_level) - 1) as usize] }
}

fn highest_slot(caster_level: u8) -> u8 {
    slots_for(caster_level).iter().rposition(|&s| s > 0).map_or(0, |i| i as u8 + 1)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CasterClass {
    #[serde(default)]
    pub identifier: String,
    pub progression: Progression,
    pub levels: u8,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlotsRequest {
    pub classes: Vec<CasterClass>,
    #[serde(default)]
    pub rules: Rules,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PactSlots {
    pub slots: u8,
    pub level: u8,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SlotsResult {
    pub caster_level: u8,
    /// Slots for spell levels 1-9.
    pub slots: [u8; 9],
    pub pact: Option<PactSlots>,
}

/// Combined spell slots for a (possibly multiclassed) character.
pub fn slots(req: &SlotsRequest) -> SlotsResult {
    let casters: Vec<&CasterClass> = req
        .classes
        .iter()
        .filter(|c| !matches!(c.progression, Progression::None | Progression::Pact) && c.levels > 0)
        .collect();
    let single = casters.len() == 1;
    let caster_level: u8 = casters
        .iter()
        .map(|c| caster_level(c.progression, c.levels, req.rules, single))
        .sum::<u8>()
        .min(20);
    let pact_levels: u8 = req
        .classes
        .iter()
        .filter(|c| c.progression == Progression::Pact)
        .map(|c| c.levels)
        .sum::<u8>()
        .min(20);
    let pact = (pact_levels > 0).then(|| {
        let (slots, level) = PACT_TABLE[(pact_levels - 1) as usize];
        PactSlots { slots, level }
    });
    SlotsResult { caster_level, slots: slots_for(caster_level), pact }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LimitsRequest {
    pub identifier: String,
    pub level: u8,
    #[serde(default)]
    pub rules: Rules,
    /// Spellcasting ability modifier, used by formula-based (2014) preparation.
    #[serde(default)]
    pub ability_mod: i32,
    /// GM override from the Spell Rules setting; replaces the built-in table when present.
    #[serde(default)]
    pub rule: Option<SpellRule>,
    /// Progression read from the class item, used when there is no rule at all.
    #[serde(default)]
    pub progression: Option<Progression>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LimitsResult {
    /// False when neither an override nor a built-in table exists for this class.
    pub known_class: bool,
    pub casting: Option<Casting>,
    pub progression: Progression,
    pub spell_list: String,
    pub cantrips: u8,
    /// Leveled spells known (known casters) or prepared (prepared/pact/spellbook casters).
    pub spells: u8,
    /// Spells to record in a wizard's spellbook, if the class uses one.
    pub spellbook: Option<u8>,
    pub max_spell_level: u8,
    pub replace_per_level: u8,
}

pub fn limits(req: &LimitsRequest) -> LimitsResult {
    let level = clamp_level(req.level.max(1));
    let idx = (level - 1) as usize;
    let rule = req.rule.clone().or_else(|| default_rule(&req.identifier, req.rules));

    let Some(rule) = rule else {
        let progression = req.progression.unwrap_or_default();
        return LimitsResult {
            known_class: false,
            casting: None,
            progression,
            spell_list: req.identifier.clone(),
            cantrips: 0,
            spells: 0,
            spellbook: None,
            max_spell_level: max_spell_level(progression, level, req.rules),
            replace_per_level: 0,
        };
    };

    let max_level = max_spell_level(rule.progression, level, rule.rules);
    let at = |table: &Vec<u8>| table.get(idx).copied().unwrap_or(0);
    let spells = match (&rule.spells, rule.formula) {
        _ if max_level == 0 => 0,
        (Some(table), _) => at(table),
        (None, Some(f)) => {
            let n = req.ability_mod + i32::from(level / f.divisor.max(1));
            n.max(i32::from(f.min)).clamp(0, 255) as u8
        }
        (None, None) => 0,
    };
    let spellbook = rule.spellbook.map(|b| {
        b.start.saturating_add(b.per_level.saturating_mul(level - 1)).max(spells)
    });

    LimitsResult {
        known_class: true,
        casting: Some(rule.casting),
        progression: rule.progression,
        spell_list: rule.spell_list.clone(),
        cantrips: at(&rule.cantrips),
        spells,
        spellbook,
        max_spell_level: max_level,
        replace_per_level: rule.replace_per_level,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn class(progression: Progression, levels: u8) -> CasterClass {
        CasterClass { identifier: String::new(), progression, levels }
    }

    #[test]
    fn full_caster_slots() {
        let r = slots(&SlotsRequest { classes: vec![class(Progression::Full, 5)], rules: Rules::Modern });
        assert_eq!(r.slots[..3], [4, 3, 2]);
        assert_eq!(r.pact, None);
    }

    #[test]
    fn half_caster_rounding_differs_by_edition() {
        // A level 1 paladin has slots in 2024 but not in 2014.
        assert_eq!(max_spell_level(Progression::Half, 1, Rules::Modern), 1);
        assert_eq!(max_spell_level(Progression::Half, 1, Rules::Legacy), 0);
        assert_eq!(max_spell_level(Progression::Half, 5, Rules::Legacy), 2);
        assert_eq!(max_spell_level(Progression::Half, 17, Rules::Modern), 5);
    }

    #[test]
    fn third_casters_match_eldritch_knight_table() {
        assert_eq!(max_spell_level(Progression::Third, 2, Rules::Modern), 0);
        assert_eq!(max_spell_level(Progression::Third, 3, Rules::Modern), 1);
        assert_eq!(max_spell_level(Progression::Third, 7, Rules::Modern), 2);
        assert_eq!(max_spell_level(Progression::Third, 13, Rules::Modern), 3);
        assert_eq!(max_spell_level(Progression::Third, 19, Rules::Modern), 4);
    }

    #[test]
    fn multiclass_combines_caster_levels() {
        // Wizard 3 / Paladin 4 (2014): 3 + 2 = caster level 5.
        let r = slots(&SlotsRequest {
            classes: vec![class(Progression::Full, 3), class(Progression::Half, 4)],
            rules: Rules::Legacy,
        });
        assert_eq!(r.caster_level, 5);
        // Fighter (EK) 4 / Rogue (AT) 4: 1 + 1 = 2.
        let r = slots(&SlotsRequest {
            classes: vec![class(Progression::Third, 4), class(Progression::Third, 4)],
            rules: Rules::Modern,
        });
        assert_eq!(r.caster_level, 2);
    }

    #[test]
    fn pact_magic_is_separate() {
        let r = slots(&SlotsRequest {
            classes: vec![class(Progression::Pact, 5), class(Progression::Full, 1)],
            rules: Rules::Modern,
        });
        assert_eq!(r.caster_level, 1);
        assert_eq!(r.pact, Some(PactSlots { slots: 2, level: 3 }));
        assert_eq!(max_spell_level(Progression::Pact, 11, Rules::Modern), 5);
    }

    #[test]
    fn limits_from_defaults() {
        let r = limits(&LimitsRequest {
            identifier: "wizard".into(),
            level: 1,
            rules: Rules::Modern,
            ability_mod: 3,
            rule: None,
            progression: None,
        });
        assert!(r.known_class);
        assert_eq!((r.cantrips, r.spells, r.spellbook, r.max_spell_level), (3, 4, Some(6), 1));
    }

    #[test]
    fn legacy_formula_uses_modifier() {
        let r = limits(&LimitsRequest {
            identifier: "cleric".into(),
            level: 3,
            rules: Rules::Legacy,
            ability_mod: 3,
            rule: None,
            progression: None,
        });
        assert_eq!(r.spells, 6);
        // Level 1 legacy paladin can't prepare anything yet even with the minimum of 1.
        let r = limits(&LimitsRequest {
            identifier: "paladin".into(),
            level: 1,
            rules: Rules::Legacy,
            ability_mod: 2,
            rule: None,
            progression: None,
        });
        assert_eq!(r.spells, 0);
    }

    #[test]
    fn unknown_class_reports_progression_only() {
        let r = limits(&LimitsRequest {
            identifier: "blood-hunter".into(),
            level: 5,
            rules: Rules::Modern,
            ability_mod: 0,
            rule: None,
            progression: Some(Progression::Half),
        });
        assert!(!r.known_class);
        assert_eq!(r.max_spell_level, 2);
    }
}
