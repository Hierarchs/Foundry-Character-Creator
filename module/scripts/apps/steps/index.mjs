import { BackgroundStep, ClassStep, SpeciesStep, SubclassStep } from "./gallery.mjs";
import AbilitiesStep from "./abilities.mjs";
import FeaturesStep from "./features.mjs";
import SpellsStep from "./spells.mjs";
import EquipmentStep from "./equipment.mjs";
import DetailsStep from "./details.mjs";
import ReviewStep from "./review.mjs";
import { LevelUpApplyStep, LevelUpClassStep, LevelUpDoneStep } from "./levelup.mjs";

/**
 * Step order follows the Player's Handbook: class, origin (background & species), ability scores,
 * then the details that depend on them.
 */
export function createSteps(app) {
  const order = app.mode === "levelup"
    ? [LevelUpClassStep, SubclassStep, LevelUpApplyStep, SpellsStep, LevelUpDoneStep]
    : [ClassStep, SubclassStep, BackgroundStep, SpeciesStep, AbilitiesStep, FeaturesStep, SpellsStep,
      EquipmentStep, DetailsStep, ReviewStep];
  return order.map(StepClass => new StepClass(app));
}
