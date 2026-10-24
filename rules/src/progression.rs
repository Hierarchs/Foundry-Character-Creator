//! Level-based numbers: proficiency bonus, experience thresholds, and a hit point preview.

use serde::{Deserialize, Serialize};

/// Experience required to reach each character level (index 0 = level 1).
pub const XP_THRESHOLDS: [u32; 20] = [
    0, 300, 900, 2_700, 6_500, 14_000, 23_000, 34_000, 48_000, 64_000, 85_000, 100_000, 120_000, 140_000,
    165_000, 195_000, 225_000, 265_000, 305_000, 355_000,
];

pub fn proficiency_bonus(level: u8) -> u8 {
    2 + (level.clamp(1, 20) - 1) / 4
}

pub fn xp_for_level(level: u8) -> u32 {
    XP_THRESHOLDS[(level.clamp(1, 20) - 1) as usize]
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HpClass {
    /// Hit die size, e.g. 8 for a d8.
    pub hit_die: u8,
    pub levels: u8,
    /// The character's first class takes the maximum at level 1.
    #[serde(default)]
    pub original: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HpRequest {
    pub classes: Vec<HpClass>,
    #[serde(default)]
    pub con_mod: i32,
    /// Flat bonus per level (e.g. Dwarven Toughness, Tough feat).
    #[serde(default)]
    pub per_level_bonus: i32,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HpResult {
    pub max: i32,
    pub level: u8,
}

/// Fixed-value hit points: maximum at first level, then the PHB average (die / 2 + 1).
/// Every level is worth at least 1 hit point regardless of a negative modifier.
pub fn hit_points(req: &HpRequest) -> HpResult {
    let mut max = 0;
    let mut level = 0u8;
    let has_original = req.classes.iter().any(|c| c.original);
    for (i, c) in req.classes.iter().enumerate() {
        let first_is_max = c.original || (!has_original && i == 0);
        for l in 1..=c.levels {
            let die = i32::from(c.hit_die);
            let base = if first_is_max && l == 1 { die } else { die / 2 + 1 };
            max += (base + req.con_mod + req.per_level_bonus).max(1);
            level = level.saturating_add(1);
        }
    }
    HpResult { max, level }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn proficiency() {
        assert_eq!(proficiency_bonus(1), 2);
        assert_eq!(proficiency_bonus(4), 2);
        assert_eq!(proficiency_bonus(5), 3);
        assert_eq!(proficiency_bonus(17), 6);
        assert_eq!(proficiency_bonus(20), 6);
    }

    #[test]
    fn xp() {
        assert_eq!(xp_for_level(1), 0);
        assert_eq!(xp_for_level(5), 6_500);
        assert_eq!(xp_for_level(20), 355_000);
    }

    #[test]
    fn hp_fighter_wizard() {
        // Fighter 3 (d10) + Wizard 2 (d6), CON +2:
        // fighter: 10+2, 6+2, 6+2 = 28 ; wizard: 4+2, 4+2 = 12
        let r = hit_points(&HpRequest {
            classes: vec![
                HpClass { hit_die: 10, levels: 3, original: true },
                HpClass { hit_die: 6, levels: 2, original: false },
            ],
            con_mod: 2,
            per_level_bonus: 0,
        });
        assert_eq!(r, HpResult { max: 40, level: 5 });
    }

    #[test]
    fn hp_never_below_one_per_level() {
        let r = hit_points(&HpRequest {
            classes: vec![HpClass { hit_die: 6, levels: 2, original: true }],
            con_mod: -5,
            per_level_bonus: 0,
        });
        assert_eq!(r.max, 2);
    }
}
