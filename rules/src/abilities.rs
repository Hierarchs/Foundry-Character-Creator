//! Ability score generation: point buy, standard array, rolled sets, and manual entry.

use crate::ABILITIES;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub type Scores = BTreeMap<String, i32>;

/// Ability modifier for a score, rounding toward negative infinity (8 -> -1, 9 -> -1, 10 -> 0).
pub fn modifier(score: i32) -> i32 {
    (score - 10).div_euclid(2)
}

/* -------------------------------------------- */
/*  Point Buy                                   */
/* -------------------------------------------- */

/// Standard point-buy costs from the Player's Handbook (scores 8 through 15).
pub const STANDARD_COSTS: [(i32, i32); 8] =
    [(8, 0), (9, 1), (10, 2), (11, 3), (12, 4), (13, 5), (14, 7), (15, 9)];

pub const STANDARD_BUDGET: i32 = 27;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PointBuyRequest {
    pub scores: Scores,
    #[serde(default = "default_budget")]
    pub budget: i32,
    /// Optional custom cost table keyed by score (JSON object keys are strings).
    #[serde(default)]
    pub costs: Option<BTreeMap<String, i32>>,
}

fn default_budget() -> i32 {
    STANDARD_BUDGET
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PointBuyAbility {
    pub score: i32,
    pub cost: i32,
    pub r#mod: i32,
    pub can_increase: bool,
    pub can_decrease: bool,
    /// Additional points the next increase would cost, if one is possible.
    pub next_cost: Option<i32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PointBuyResult {
    pub budget: i32,
    pub spent: i32,
    pub remaining: i32,
    pub min: i32,
    pub max: i32,
    pub valid: bool,
    pub errors: Vec<String>,
    pub abilities: BTreeMap<String, PointBuyAbility>,
}

fn cost_table(custom: &Option<BTreeMap<String, i32>>) -> Result<BTreeMap<i32, i32>, String> {
    match custom {
        None => Ok(STANDARD_COSTS.iter().copied().collect()),
        Some(map) if map.is_empty() => Ok(STANDARD_COSTS.iter().copied().collect()),
        Some(map) => map
            .iter()
            .map(|(k, v)| {
                k.parse::<i32>()
                    .map(|score| (score, *v))
                    .map_err(|_| format!("Invalid point-buy score key \"{k}\""))
            })
            .collect(),
    }
}

pub fn point_buy(req: &PointBuyRequest) -> Result<PointBuyResult, String> {
    let costs = cost_table(&req.costs)?;
    let min = *costs.keys().next().ok_or("Point-buy cost table is empty")?;
    let max = *costs.keys().last().unwrap_or(&min);

    let mut errors = Vec::new();
    let mut spent = 0;
    for key in ABILITIES {
        let score = req.scores.get(key).copied().unwrap_or(min);
        match costs.get(&score) {
            Some(c) => spent += c,
            None => errors.push(format!("{key} score {score} is outside the point-buy range {min}-{max}")),
        }
    }

    let mut abilities = BTreeMap::new();
    for key in ABILITIES {
        let score = req.scores.get(key).copied().unwrap_or(min);
        let cost = costs.get(&score).copied().unwrap_or(0);
        let next = costs.get(&(score + 1)).map(|n| n - cost);
        abilities.insert(
            key.to_string(),
            PointBuyAbility {
                score,
                cost,
                r#mod: modifier(score),
                can_increase: next.is_some_and(|n| spent + n <= req.budget),
                can_decrease: costs.contains_key(&(score - 1)),
                next_cost: next,
            },
        );
    }

    if spent > req.budget {
        errors.push(format!("Spent {spent} points but only {} are available", req.budget));
    }

    Ok(PointBuyResult {
        budget: req.budget,
        spent,
        remaining: req.budget - spent,
        min,
        max,
        valid: errors.is_empty(),
        errors,
        abilities,
    })
}

/* -------------------------------------------- */
/*  Standard Array & Rolled Sets                */
/* -------------------------------------------- */

pub const STANDARD_ARRAY: [i32; 6] = [15, 14, 13, 12, 10, 8];

/// Assigning a fixed pool of values (standard array or rolled totals) to abilities by slot index.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssignmentRequest {
    /// Ability key -> index into `values`, or null when unassigned.
    #[serde(default)]
    pub assignment: BTreeMap<String, Option<usize>>,
    /// Defaults to the standard array when omitted.
    #[serde(default)]
    pub values: Option<Vec<i32>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssignmentResult {
    pub values: Vec<i32>,
    pub scores: BTreeMap<String, Option<i32>>,
    pub mods: BTreeMap<String, Option<i32>>,
    pub unused: Vec<usize>,
    pub valid: bool,
    pub errors: Vec<String>,
}

pub fn assign(req: &AssignmentRequest) -> AssignmentResult {
    let values = req.values.clone().unwrap_or_else(|| STANDARD_ARRAY.to_vec());
    let mut used = vec![false; values.len()];
    let mut errors = Vec::new();
    let mut scores = BTreeMap::new();
    let mut mods = BTreeMap::new();

    for key in ABILITIES {
        let slot = req.assignment.get(key).copied().flatten();
        let score = match slot {
            Some(i) if i >= values.len() => {
                errors.push(format!("{key} refers to value #{i}, which does not exist"));
                None
            }
            Some(i) if used[i] => {
                errors.push(format!("Value #{i} ({}) is assigned more than once", values[i]));
                None
            }
            Some(i) => {
                used[i] = true;
                Some(values[i])
            }
            None => None,
        };
        scores.insert(key.to_string(), score);
        mods.insert(key.to_string(), score.map(modifier));
    }

    let unused: Vec<usize> = used.iter().enumerate().filter(|(_, u)| !**u).map(|(i, _)| i).collect();
    if scores.values().any(Option::is_none) {
        errors.push("Every ability needs a value".into());
    }
    AssignmentResult { values, scores, mods, unused, valid: errors.is_empty(), errors }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RolledSetsRequest {
    /// Raw dice for each set, e.g. six sets of 4d6.
    pub sets: Vec<Vec<i32>>,
    /// How many of the lowest dice to discard per set (1 for "4d6 drop lowest").
    #[serde(default = "one")]
    pub drop_lowest: usize,
}

fn one() -> usize {
    1
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RolledSet {
    pub dice: Vec<i32>,
    pub kept: Vec<i32>,
    /// Indexes into `dice` that were discarded.
    pub dropped: Vec<usize>,
    pub total: i32,
}

pub fn rolled_sets(req: &RolledSetsRequest) -> Vec<RolledSet> {
    req.sets
        .iter()
        .map(|dice| {
            let mut order: Vec<usize> = (0..dice.len()).collect();
            // Stable sort keeps the earliest of equal dice, so the first low die is the one dropped.
            order.sort_by_key(|&i| dice[i]);
            let mut dropped: Vec<usize> = order.into_iter().take(req.drop_lowest.min(dice.len())).collect();
            dropped.sort_unstable();
            let kept: Vec<i32> =
                dice.iter().enumerate().filter(|(i, _)| !dropped.contains(i)).map(|(_, d)| *d).collect();
            RolledSet { total: kept.iter().sum(), dice: dice.clone(), kept, dropped }
        })
        .collect()
}

/* -------------------------------------------- */
/*  Manual Entry & Final Scores                 */
/* -------------------------------------------- */

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManualRequest {
    pub scores: Scores,
    #[serde(default = "manual_min")]
    pub min: i32,
    #[serde(default = "manual_max")]
    pub max: i32,
}

fn manual_min() -> i32 {
    3
}
fn manual_max() -> i32 {
    18
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScoresResult {
    pub scores: Scores,
    pub mods: Scores,
    pub valid: bool,
    pub errors: Vec<String>,
}

pub fn manual(req: &ManualRequest) -> ScoresResult {
    let mut errors = Vec::new();
    let mut scores = Scores::new();
    let mut mods = Scores::new();
    for key in ABILITIES {
        let score = req.scores.get(key).copied().unwrap_or(10);
        if score < req.min || score > req.max {
            errors.push(format!("{key} must be between {} and {}", req.min, req.max));
        }
        scores.insert(key.into(), score);
        mods.insert(key.into(), modifier(score));
    }
    ScoresResult { scores, mods, valid: errors.is_empty(), errors }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinalRequest {
    pub base: Scores,
    #[serde(default)]
    pub bonuses: Scores,
    #[serde(default = "cap")]
    pub cap: i32,
}

fn cap() -> i32 {
    20
}

/// Combine base scores with bonuses (species, background, feats), capping at `cap`.
/// A base score that already exceeds the cap is left alone rather than lowered.
pub fn final_scores(req: &FinalRequest) -> ScoresResult {
    let mut scores = Scores::new();
    let mut mods = Scores::new();
    for key in ABILITIES {
        let base = req.base.get(key).copied().unwrap_or(10);
        let bonus = req.bonuses.get(key).copied().unwrap_or(0);
        let total = if bonus > 0 { (base + bonus).min(req.cap.max(base)) } else { base + bonus };
        scores.insert(key.into(), total);
        mods.insert(key.into(), modifier(total));
    }
    ScoresResult { scores, mods, valid: true, errors: vec![] }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn all(score: i32) -> Scores {
        ABILITIES.iter().map(|k| (k.to_string(), score)).collect()
    }

    #[test]
    fn modifiers_round_down() {
        assert_eq!(modifier(1), -5);
        assert_eq!(modifier(8), -1);
        assert_eq!(modifier(9), -1);
        assert_eq!(modifier(10), 0);
        assert_eq!(modifier(11), 0);
        assert_eq!(modifier(15), 2);
        assert_eq!(modifier(20), 5);
        assert_eq!(modifier(30), 10);
    }

    #[test]
    fn point_buy_starts_with_full_budget() {
        let r = point_buy(&PointBuyRequest { scores: all(8), budget: 27, costs: None }).unwrap();
        assert_eq!(r.spent, 0);
        assert_eq!(r.remaining, 27);
        assert!(r.valid);
        assert!(r.abilities["str"].can_increase);
        assert!(!r.abilities["str"].can_decrease);
        assert_eq!(r.abilities["str"].r#mod, -1);
    }

    #[test]
    fn point_buy_classic_spread_is_exactly_27() {
        // 15, 15, 15, 8, 8, 8 = 9 * 3 = 27
        let mut s = all(8);
        for k in ["str", "dex", "con"] {
            s.insert(k.into(), 15);
        }
        let r = point_buy(&PointBuyRequest { scores: s, budget: 27, costs: None }).unwrap();
        assert_eq!(r.spent, 27);
        assert_eq!(r.remaining, 0);
        assert!(r.valid);
        // Nothing can increase any more: maxed or out of points.
        assert!(r.abilities.values().all(|a| !a.can_increase));
    }

    #[test]
    fn point_buy_blocks_increase_that_would_overspend() {
        let mut s = all(8);
        s.insert("str".into(), 15);
        s.insert("dex".into(), 15);
        s.insert("con".into(), 13); // 9 + 9 + 5 = 23, 4 left
        s.insert("int".into(), 12); // +4 = 27
        let r = point_buy(&PointBuyRequest { scores: s, budget: 27, costs: None }).unwrap();
        assert_eq!(r.remaining, 0);
        assert!(!r.abilities["wis"].can_increase);
        assert!(r.abilities["int"].can_decrease);
    }

    #[test]
    fn point_buy_flags_out_of_range_and_overspend() {
        let mut s = all(15);
        s.insert("str".into(), 16);
        let r = point_buy(&PointBuyRequest { scores: s, budget: 27, costs: None }).unwrap();
        assert!(!r.valid);
        assert_eq!(r.errors.len(), 2);
    }

    #[test]
    fn point_buy_custom_costs() {
        let costs: BTreeMap<String, i32> = [("10", 0), ("11", 1), ("12", 2)]
            .into_iter()
            .map(|(k, v)| (k.to_string(), v))
            .collect();
        let r = point_buy(&PointBuyRequest { scores: all(10), budget: 3, costs: Some(costs) }).unwrap();
        assert_eq!((r.min, r.max), (10, 12));
        assert_eq!(r.abilities["cha"].next_cost, Some(1));
    }

    #[test]
    fn standard_array_assignment() {
        let assignment: BTreeMap<String, Option<usize>> =
            ABILITIES.iter().enumerate().map(|(i, k)| (k.to_string(), Some(i))).collect();
        let r = assign(&AssignmentRequest { assignment, values: None });
        assert!(r.valid, "{:?}", r.errors);
        assert_eq!(r.scores["str"], Some(15));
        assert_eq!(r.scores["cha"], Some(8));
        assert!(r.unused.is_empty());
    }

    #[test]
    fn standard_array_rejects_duplicates_and_gaps() {
        let mut assignment = BTreeMap::new();
        assignment.insert("str".to_string(), Some(0));
        assignment.insert("dex".to_string(), Some(0));
        let r = assign(&AssignmentRequest { assignment, values: None });
        assert!(!r.valid);
        assert_eq!(r.scores["dex"], None);
        assert_eq!(r.unused, vec![1, 2, 3, 4, 5]);
    }

    #[test]
    fn rolled_sets_drop_lowest() {
        let r = rolled_sets(&RolledSetsRequest { sets: vec![vec![6, 1, 4, 1], vec![3, 3, 3, 3]], drop_lowest: 1 });
        assert_eq!(r[0].total, 11);
        assert_eq!(r[0].dropped, vec![1]);
        assert_eq!(r[1].total, 9);
        assert_eq!(r[1].kept.len(), 3);
    }

    #[test]
    fn final_scores_cap_at_twenty() {
        let mut base = all(10);
        base.insert("str".into(), 19);
        base.insert("dex".into(), 21); // already above cap from e.g. a manual entry
        let mut bonuses = Scores::new();
        bonuses.insert("str".into(), 2);
        bonuses.insert("dex".into(), 1);
        bonuses.insert("con".into(), -2);
        let r = final_scores(&FinalRequest { base, bonuses, cap: 20 });
        assert_eq!(r.scores["str"], 20);
        assert_eq!(r.scores["dex"], 21);
        assert_eq!(r.scores["con"], 8);
        assert_eq!(r.mods["con"], -1);
    }

    #[test]
    fn manual_range() {
        let mut s = all(10);
        s.insert("int".into(), 2);
        let r = manual(&ManualRequest { scores: s, min: 3, max: 18 });
        assert!(!r.valid);
    }
}
