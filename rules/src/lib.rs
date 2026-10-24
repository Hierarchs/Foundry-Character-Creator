//! Rules engine for Character Genesis.
//!
//! Everything in here is pure D&D 5e arithmetic with no knowledge of Foundry. The JavaScript side
//! of the module sends JSON commands through a tiny C ABI (see [`abi`]) and gets JSON back, which
//! keeps the boundary trivial and lets every rule be unit-tested natively with `cargo test`.

pub mod abi;
pub mod abilities;
pub mod api;
pub mod equipment;
pub mod multiclass;
pub mod progression;
pub mod spell_tables;
pub mod spellcasting;

/// Which edition of the rules a piece of content follows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize, Default)]
pub enum Rules {
    #[serde(rename = "2014")]
    Legacy,
    #[default]
    #[serde(rename = "2024")]
    Modern,
}

/// The six ability keys used by the dnd5e system, in sheet order.
pub const ABILITIES: [&str; 6] = ["str", "dex", "con", "int", "wis", "cha"];
