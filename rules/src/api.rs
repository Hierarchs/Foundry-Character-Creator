//! JSON command dispatcher. Requests look like `{"cmd": "pointBuy", "args": {...}}` and responses
//! are either `{"ok": true, "data": ...}` or `{"ok": false, "error": "..."}`.

use crate::{Rules, abilities, equipment, multiclass, progression, spell_tables, spellcasting};
use serde::Deserialize;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};

#[derive(Deserialize)]
struct Request {
    cmd: String,
    #[serde(default)]
    args: Value,
}

fn parse<T: DeserializeOwned>(args: Value) -> Result<T, String> {
    serde_json::from_value(args).map_err(|e| format!("Invalid arguments: {e}"))
}

fn to_value<T: serde::Serialize>(v: T) -> Result<Value, String> {
    serde_json::to_value(v).map_err(|e| e.to_string())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LevelArgs {
    level: u8,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RulesArgs {
    #[serde(default)]
    rules: Rules,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MaxLevelArgs {
    progression: spell_tables::Progression,
    level: u8,
    #[serde(default)]
    rules: Rules,
}

fn run(cmd: &str, args: Value) -> Result<Value, String> {
    match cmd {
        "version" => Ok(json!({ "version": env!("CARGO_PKG_VERSION") })),
        "modifier" => {
            let score: i32 = parse(args)?;
            Ok(json!(abilities::modifier(score)))
        }
        "pointBuy" => to_value(abilities::point_buy(&parse(args)?)?),
        "assign" => to_value(abilities::assign(&parse(args)?)),
        "rolledSets" => to_value(abilities::rolled_sets(&parse(args)?)),
        "manualScores" => to_value(abilities::manual(&parse(args)?)),
        "finalScores" => to_value(abilities::final_scores(&parse(args)?)),
        "spellSlots" => to_value(spellcasting::slots(&parse(args)?)),
        "spellLimits" => to_value(spellcasting::limits(&parse(args)?)),
        "maxSpellLevel" => {
            let a: MaxLevelArgs = parse(args)?;
            Ok(json!(spellcasting::max_spell_level(a.progression, a.level, a.rules)))
        }
        "spellRuleDefaults" => {
            let a: RulesArgs = parse(args)?;
            to_value(spell_tables::defaults(a.rules))
        }
        "multiclassCheck" => to_value(multiclass::check(&parse(args)?)),
        "resolveEquipment" => to_value(equipment::resolve(&parse(args)?)),
        "proficiencyBonus" => {
            let a: LevelArgs = parse(args)?;
            Ok(json!(progression::proficiency_bonus(a.level)))
        }
        "xpForLevel" => {
            let a: LevelArgs = parse(args)?;
            Ok(json!(progression::xp_for_level(a.level)))
        }
        "hitPoints" => to_value(progression::hit_points(&parse(args)?)),
        other => Err(format!("Unknown rules command \"{other}\"")),
    }
}

pub fn error_response(message: &str) -> String {
    json!({ "ok": false, "error": message }).to_string()
}

pub fn dispatch(input: &str) -> String {
    let request: Request = match serde_json::from_str(input) {
        Ok(r) => r,
        Err(e) => return error_response(&format!("Malformed request: {e}")),
    };
    match run(&request.cmd, request.args) {
        Ok(data) => json!({ "ok": true, "data": data }).to_string(),
        Err(e) => error_response(&e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn call(input: Value) -> Value {
        serde_json::from_str(&dispatch(&input.to_string())).unwrap()
    }

    #[test]
    fn round_trip_point_buy() {
        let out = call(json!({
            "cmd": "pointBuy",
            "args": { "scores": { "str": 15, "dex": 14, "con": 13, "int": 12, "wis": 10, "cha": 8 } }
        }));
        assert_eq!(out["ok"], true);
        // 9 + 7 + 5 + 4 + 2 + 0
        assert_eq!(out["data"]["spent"], 27);
        assert_eq!(out["data"]["abilities"]["dex"]["mod"], 2);
    }

    #[test]
    fn unknown_command_is_an_error() {
        let out = call(json!({ "cmd": "nope" }));
        assert_eq!(out["ok"], false);
        assert!(out["error"].as_str().unwrap().contains("nope"));
    }

    #[test]
    fn malformed_json_is_an_error() {
        let out: Value = serde_json::from_str(&dispatch("{not json")).unwrap();
        assert_eq!(out["ok"], false);
    }

    #[test]
    fn spell_limits_with_override() {
        let out = call(json!({
            "cmd": "spellLimits",
            "args": {
                "identifier": "bard", "level": 2, "rules": "2024",
                "rule": {
                    "identifier": "bard", "label": "Bard", "casting": "known", "progression": "full",
                    "spellList": "bard", "cantrips": vec![5; 20], "spells": vec![9; 20]
                }
            }
        }));
        assert_eq!(out["ok"], true, "{out}");
        assert_eq!(out["data"]["cantrips"], 5);
        assert_eq!(out["data"]["spells"], 9);
        assert_eq!(out["data"]["casting"], "known");
    }

    #[test]
    fn defaults_listing() {
        let out = call(json!({ "cmd": "spellRuleDefaults", "args": { "rules": "2014" } }));
        let list = out["data"].as_array().unwrap();
        assert!(list.iter().any(|r| r["identifier"] == "warlock" && r["casting"] == "pact"));
    }
}
