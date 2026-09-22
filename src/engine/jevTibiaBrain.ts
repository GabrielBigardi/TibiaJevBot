import { choice, noul, TypeSafeClient } from "@typesafe-ai/sdk";
import type { BotAction, GameTickState, JevDecisionReport, PlayerConfig, PlayerState } from "../types.js";

export interface VocationSpellProfile {
  isMelee: boolean;
  lightHeal: string | null;
  mediumHeal: string | null;
  heavyHeal: string | null;
  attackSpell: string | null;
  magicShield: string | null;
  hasteSpell: string | null;
  healthPotionId: number;
  manaPotionId: number;
}

/**
 * Resolves valid spells and items strictly according to the character's vocation and level,
 * with support for manual overrides via PlayerConfig.
 */
export function resolveSpellProfile(player: PlayerState): VocationSpellProfile {
  const level = player.level || 1;
  const rawVoc = (player.config?.vocation || player.vocation || "None").toLowerCase();

  let isMelee = false;
  let lightHeal: string | null = null;
  let mediumHeal: string | null = null;
  let heavyHeal: string | null = null;
  let attackSpell: string | null = null;
  let magicShield: string | null = null;
  let hasteSpell: string | null = null;

  // Level-appropriate potion IDs
  const healthPotionId =
    player.config?.healthPotionId || (level >= 80 ? 7591 : level >= 50 ? 7588 : 7618);
  const manaPotionId =
    player.config?.manaPotionId || (level >= 80 ? 7590 : level >= 50 ? 7589 : 7620);

  if (rawVoc.includes("knight")) {
    isMelee = true;
    // Knights: exura ico (level 8+), NO magic shield (utamo vita), heavy heal via Health Potions
    lightHeal = level >= 8 ? "exura ico" : null;
    mediumHeal = lightHeal;
    heavyHeal = null; // Knights rely on Health Potions for critical recovery
    magicShield = null; // Knights do NOT possess Utamo Vita
    hasteSpell = level >= 14 ? "utani hur" : null;

    if (level >= 80) attackSpell = "exori gran";
    else if (level >= 35) attackSpell = "exori";
    else if (level >= 28) attackSpell = "exori hur";
    else if (level >= 16) attackSpell = "exori ico";
    else attackSpell = null;
  } else if (rawVoc.includes("paladin")) {
    isMelee = false;
    lightHeal = level >= 8 ? "exura" : null;
    mediumHeal = level >= 20 ? "exura gran" : lightHeal;
    heavyHeal = level >= 60 ? "exura san" : mediumHeal;
    magicShield = level >= 14 ? "utamo vita" : null;
    hasteSpell = level >= 14 ? "utani hur" : null;

    if (level >= 40) attackSpell = "exori san";
    else if (level >= 23) attackSpell = "exori con";
    else attackSpell = null;
  } else if (rawVoc.includes("sorcerer")) {
    isMelee = false;
    lightHeal = level >= 8 ? "exura" : null;
    mediumHeal = level >= 20 ? "exura gran" : lightHeal;
    heavyHeal = level >= 30 ? "exura vita" : mediumHeal;
    magicShield = level >= 14 ? "utamo vita" : null;
    hasteSpell = level >= 14 ? "utani hur" : null;

    if (level >= 18) attackSpell = "exori frigo";
    else if (level >= 14) attackSpell = "exori flam";
    else if (level >= 12) attackSpell = "exori vis";
    else attackSpell = null;
  } else if (rawVoc.includes("druid")) {
    isMelee = false;
    lightHeal = level >= 8 ? "exura" : null;
    mediumHeal = level >= 20 ? "exura gran" : lightHeal;
    heavyHeal = level >= 30 ? "exura vita" : mediumHeal;
    magicShield = level >= 14 ? "utamo vita" : null;
    hasteSpell = level >= 14 ? "utani hur" : null;

    if (level >= 18) attackSpell = "exori frigo";
    else if (level >= 13) attackSpell = "exori tera";
    else attackSpell = null;
  } else {
    // Rookgaard / No Vocation / Unknown
    isMelee = true;
    lightHeal = level >= 8 ? "exura" : null;
    mediumHeal = lightHeal;
  }

  // Custom User Overrides from OTClient UI
  if (player.config?.healingSpell) {
    const customHeal = player.config.healingSpell.trim();
    if (customHeal.toLowerCase() === "none" || customHeal === "") {
      lightHeal = null;
      mediumHeal = null;
      heavyHeal = null;
    } else {
      lightHeal = customHeal;
      mediumHeal = customHeal;
      heavyHeal = customHeal;
    }
  }

  if (player.config?.attackSpell) {
    const customAtk = player.config.attackSpell.trim();
    if (customAtk.toLowerCase() === "none" || customAtk === "") {
      attackSpell = null;
    } else {
      attackSpell = customAtk;
    }
  }

  return {
    isMelee,
    lightHeal,
    mediumHeal,
    heavyHeal,
    attackSpell,
    magicShield,
    hasteSpell,
    healthPotionId,
    manaPotionId,
  };
}

export class JevTibiaBrain {
  private client: TypeSafeClient | null = null;
  private model: string;

  constructor(apiKey?: string, model: string = "jev-1.13.0") {
    const key = apiKey || process.env.TYPESAFE_API_KEY;
    this.model = model;

    if (!key) {
      console.warn("[JevTibiaBrain] No TYPESAFE_API_KEY provided. Operating in deterministic offline simulation mode.");
      this.client = null;
    } else {
      try {
        this.client = new TypeSafeClient({ apiKey: key });
      } catch (err) {
        console.warn("[JevTibiaBrain] Failed to initialize TypeSafeClient:", err);
      }
    }
  }

  public isLive(): boolean {
    return this.client !== null;
  }

  /**
   * Evaluates game tick through Jev System One questions in parallel
   * respecting player vocation, level constraints, sweet spot kiting, corpse looting, and cave exploration.
   */
  async decide(state: GameTickState): Promise<JevDecisionReport> {
    const startTime = Date.now();
    const profile = resolveSpellProfile(state.player);
    const hasMonsters = state.monsters && state.monsters.length > 0;
    const hasCorpses = state.corpses && state.corpses.length > 0;
    const hasWaypoints = Boolean(state.nextWaypoint);

    // Build vocation-accurate survival choices
    const survivalChoices: Record<string, string> = {};
    if (profile.heavyHeal) {
      survivalChoices["cast_heavy_heal"] = `HP is critically low (< 40%); cast ${profile.heavyHeal}`;
    }
    if (profile.mediumHeal) {
      survivalChoices["cast_medium_heal"] = `HP is moderately low (40% - 75%); cast ${profile.mediumHeal}`;
    }
    if (profile.lightHeal) {
      survivalChoices["cast_light_heal"] = `HP is slightly wounded (75% - 90%); cast ${profile.lightHeal}`;
    }
    survivalChoices["use_health_potion"] = "HP is low; drink health potion";
    survivalChoices["use_mana_potion"] = "HP is safe (> 80%) but mana is below 60%; drink mana potion";
    if (profile.magicShield) {
      survivalChoices["cast_magic_shield"] = `Severe burst danger; cast ${profile.magicShield} (magic shield)`;
    }
    survivalChoices["none"] = "HP and mana are healthy, no survival action required";

    // Build tactical movement choices based on vocation style (Melee vs Ranged)
    const movementChoices: Record<string, string> = {};
    if (profile.isMelee) {
      movementChoices["step_closer"] = "Melee fighter: close distance to 1 SQM melee contact with target";
      movementChoices["stand_ground"] = "Melee fighter: in 1 SQM melee range; stand ground and attack";
      movementChoices["step_back"] = "Emergency retreat: low HP, step back from dangerous monsters";
    } else {
      movementChoices["step_back"] = "Ranged fighter: monster is in melee (< 3 SQMs); kite back to safe distance";
      movementChoices["hold_range_3_4"] = "Ranged fighter: monster is in optimal 3-4 SQM sweet spot; hold position";
      movementChoices["step_closer"] = "Ranged fighter: monster is > 4 SQMs away; step closer so target is not lost off-screen";
    }
    movementChoices["diagonal_step"] = "Monster is facing player directly; step diagonally to dodge waves/beams";
    movementChoices["move_to_corpse"] = "Walk towards or open nearby monster corpse";
    movementChoices["navigate_waypoints"] = "Walk towards cavebot waypoint to search for monsters";

    const questions: Record<string, any> = {
      macro_state: choice(
        "Given player state, visible monsters, unlooted corpses, and waypoints, what is the bot's primary macro task right now?",
        {
          COMBAT: "Active monsters are engaging the player; combat and survival take highest priority",
          LOOT: "Unlooted monster corpses are nearby and area is safe; walk to and loot the corpse",
          EXPLORE_CAVE: "No monsters or unlooted corpses nearby; follow cavebot waypoints and explore the cave",
          RECOVER: "Area is clear but player has low HP or Mana; recover resources before proceeding",
        }
      ),
      survival_action: choice(
        "Given player's HP, Max HP, Mana, and vocation, what is the most critical survival/healing action?",
        survivalChoices
      ),
      is_critical_danger: noul(
        "Is the player in immediate danger of dying to monster burst damage within the next turn?",
        {
          true: "Player is low on health with aggressive high-damage monsters nearby",
          false: "Player is at safe health or facing minor threats",
        }
      ),
      tactical_movement: choice(
        "What movement or positioning action should the bot take?",
        movementChoices
      ),
    };

    if (hasMonsters) {
      const targetCriteria: Record<string, string> = {};
      for (const m of state.monsters) {
        targetCriteria[`mob_${m.id}`] = `${m.name} (HP: ${m.healthPercent}%, Distance: ${m.distance} SQM${
          m.facingPlayer ? ", facing player" : ""
        })`;
      }
      targetCriteria["none"] = "Do not target any monster right now";

      questions["target_selection"] = choice(
        "Which monster should the player target right now?",
        targetCriteria
      );

      const offenseChoices: Record<string, string> = {};
      if (profile.attackSpell) {
        offenseChoices["cast_attack_spell"] = `Cast ${profile.attackSpell} for damage`;
      }
      if (state.inventory.sdRunes > 0 && state.player.level >= 45) {
        offenseChoices["rune_sd"] = "Fire Sudden Death (SD) rune for high burst damage";
      }
      if (state.inventory.areaRunes > 0 && state.player.level >= 30) {
        offenseChoices["rune_area"] = "Fire area rune (GFB/Avalanche) against grouped monsters";
      }
      offenseChoices["auto_attack"] = "Standard weapon attack (0 mana cost)";

      questions["offensive_action"] = choice(
        "What offensive spell, rune, or attack should be used against the target?",
        offenseChoices
      );
    }

    let macroState: "COMBAT" | "LOOT" | "EXPLORE_CAVE" | "RECOVER" = "EXPLORE_CAVE";
    let survivalAction = "none";
    let isCriticalDanger = false;
    let dangerProbability = 0.05;
    let selectedTargetId: number | null = null;
    let selectedTargetName = "";
    let offensiveAction = "auto_attack";
    let tacticalMovement = profile.isMelee ? "step_closer" : "hold_range_3_4";
    let modelName = this.model;

    if (this.client) {
      try {
        const response = await this.client.systemOne({
          state: state as any,
          questions,
          model: this.model,
        });

        modelName = response.model || this.model;
        const answers = response.answers as any;

        if (answers.macro_state) {
          macroState = (answers.macro_state.choice as any) || "EXPLORE_CAVE";
        }
        if (answers.survival_action) {
          survivalAction = answers.survival_action.choice || "none";
        }
        if (answers.is_critical_danger) {
          dangerProbability = answers.is_critical_danger.noul ?? 0.05;
          isCriticalDanger = dangerProbability >= 0.7;
        }
        if (answers.tactical_movement) {
          tacticalMovement = answers.tactical_movement.choice || (profile.isMelee ? "step_closer" : "hold_range_3_4");
        }
        if (hasMonsters && answers.target_selection) {
          const choiceStr = answers.target_selection.choice || "";
          if (choiceStr.startsWith("mob_")) {
            const mobId = parseInt(choiceStr.replace("mob_", ""), 10);
            if (!isNaN(mobId)) {
              selectedTargetId = mobId;
              const found = state.monsters.find((m) => m.id === mobId);
              if (found) selectedTargetName = found.name;
            }
          }
        }
        if (hasMonsters && answers.offensive_action) {
          offensiveAction = answers.offensive_action.choice || "auto_attack";
        }
      } catch (err: any) {
        console.warn(`[JevTibiaBrain] Live API error: ${err.message}. Running fallback evaluation.`);
        return this.fallbackDecision(state, profile, startTime);
      }
    } else {
      return this.fallbackDecision(state, profile, startTime);
    }

    const executableActions = this.buildActions(
      state,
      profile,
      macroState,
      survivalAction,
      selectedTargetId,
      offensiveAction,
      tacticalMovement
    );

    return {
      tickNumber: state.tickNumber,
      macroState,
      survivalAction,
      isCriticalDanger,
      dangerProbability,
      selectedTargetId,
      selectedTargetName,
      offensiveAction,
      tacticalMovement,
      executableActions,
      model: modelName,
      latencyMs: Date.now() - startTime,
    };
  }

  /**
   * Deterministic fallback when running offline or on API timeout.
   */
  private fallbackDecision(state: GameTickState, profile: VocationSpellProfile, startTime: number): JevDecisionReport {
    const hpRatio = state.player.health / (state.player.maxHealth || 1);
    const manaRatio = state.player.mana / (state.player.maxMana || 1);
    const hasMonsters = state.monsters && state.monsters.length > 0;
    const hasCorpses = state.corpses && state.corpses.length > 0;
    const hasWaypoints = Boolean(state.nextWaypoint);

    let macroState: "COMBAT" | "LOOT" | "EXPLORE_CAVE" | "RECOVER" = "EXPLORE_CAVE";
    if (hasMonsters) {
      macroState = "COMBAT";
    } else if (hasCorpses) {
      macroState = "LOOT";
    } else if (manaRatio < 0.35 && hpRatio < 0.8) {
      macroState = "RECOVER";
    } else if (hasWaypoints) {
      macroState = "EXPLORE_CAVE";
    }

    let survivalAction = "none";
    let isCriticalDanger = false;
    let dangerProbability = 0.05;

    if (hpRatio < 0.4) {
      if (profile.heavyHeal && state.player.mana >= 80) {
        survivalAction = "cast_heavy_heal";
      } else {
        survivalAction = "use_health_potion";
      }
      isCriticalDanger = true;
      dangerProbability = 0.94;
    } else if (hpRatio < 0.75) {
      if (profile.mediumHeal && state.player.mana >= 40) {
        survivalAction = "cast_medium_heal";
      } else {
        survivalAction = "use_health_potion";
      }
      dangerProbability = 0.55;
    } else if (hpRatio < 0.9 && profile.lightHeal && state.player.mana >= 20) {
      survivalAction = "cast_light_heal";
      dangerProbability = 0.2;
    } else if (manaRatio < 0.6 && state.inventory.manaPotions > 0) {
      survivalAction = "use_mana_potion";
    }

    let selectedTargetId: number | null = null;
    let selectedTargetName = "";
    let offensiveAction = "auto_attack";
    let tacticalMovement = profile.isMelee ? "step_closer" : "stand_ground";

    if (hasMonsters) {
      const sorted = [...state.monsters].sort((a, b) => {
        if (a.healthPercent !== b.healthPercent) return a.healthPercent - b.healthPercent;
        return a.distance - b.distance;
      });
      const best = sorted[0];
      selectedTargetId = best.id;
      selectedTargetName = best.name;

      if (profile.attackSpell && state.player.mana >= 40) {
        offensiveAction = "cast_attack_spell";
      } else {
        offensiveAction = "auto_attack";
      }

      if (profile.isMelee) {
        // Melee vocation (Knight): close to 1 SQM distance!
        if (best.distance > 1) {
          tacticalMovement = "step_closer";
        } else {
          tacticalMovement = "stand_ground";
        }
      } else {
        // Ranged vocation (Mage/Paladin): 3-4 SQMs sweet spot
        if (best.distance < 3) {
          tacticalMovement = "step_back";
        } else if (best.distance > 4) {
          tacticalMovement = "step_closer";
        } else if (best.facingPlayer && best.distance <= 2) {
          tacticalMovement = "diagonal_step";
        } else {
          tacticalMovement = "hold_range_3_4";
        }
      }
    } else if (hasCorpses) {
      tacticalMovement = "move_to_corpse";
    } else if (hasWaypoints) {
      tacticalMovement = "navigate_waypoints";
    }

    const executableActions = this.buildActions(
      state,
      profile,
      macroState,
      survivalAction,
      selectedTargetId,
      offensiveAction,
      tacticalMovement
    );

    return {
      tickNumber: state.tickNumber,
      macroState,
      survivalAction,
      isCriticalDanger,
      dangerProbability,
      selectedTargetId,
      selectedTargetName,
      offensiveAction,
      tacticalMovement,
      executableActions,
      model: "jev-simulated-offline",
      latencyMs: Date.now() - startTime,
    };
  }

  /**
   * Translates decisions into discrete actions strictly matching player vocation and level.
   */
  private buildActions(
    state: GameTickState,
    profile: VocationSpellProfile,
    macroState: "COMBAT" | "LOOT" | "EXPLORE_CAVE" | "RECOVER",
    survivalAction: string,
    targetId: number | null,
    offensiveAction: string,
    tacticalMovement: string
  ): BotAction[] {
    const actions: BotAction[] = [];

    // 1. Survival & Healing (Priority 1)
    if (survivalAction === "cast_heavy_heal" && profile.heavyHeal) {
      actions.push({ type: "say", text: profile.heavyHeal });
    } else if (survivalAction === "cast_medium_heal" && profile.mediumHeal) {
      actions.push({ type: "say", text: profile.mediumHeal });
    } else if (survivalAction === "cast_light_heal" && profile.lightHeal) {
      actions.push({ type: "say", text: profile.lightHeal });
    } else if (survivalAction === "cast_magic_shield" && profile.magicShield) {
      actions.push({ type: "say", text: profile.magicShield });
    } else if (survivalAction === "use_health_potion") {
      actions.push({ type: "use_item", itemId: profile.healthPotionId });
    } else if (survivalAction === "use_mana_potion") {
      actions.push({ type: "use_item", itemId: profile.manaPotionId });
    }

    // 2. Targeting & Combat Attack (Priority 2)
    if (targetId && targetId !== state.player.targetId) {
      actions.push({ type: "attack", targetId });
    }

    if (targetId) {
      if (offensiveAction === "cast_attack_spell" && profile.attackSpell) {
        actions.push({ type: "say", text: profile.attackSpell });
      } else if (offensiveAction === "rune_sd" && state.player.level >= 45) {
        actions.push({ type: "use_item", itemId: 3155, targetId });
      } else if (offensiveAction === "rune_area" && state.player.level >= 30) {
        actions.push({ type: "use_item", itemId: 3191, targetId });
      }
    }

    // 3. Movement & Navigation (Priority 3)
    const targetMonster = state.monsters?.find((m) => m.id === targetId) || state.monsters?.[0];

    if (targetMonster) {
      const dist = targetMonster.distance;
      const dx = state.player.position.x - targetMonster.position.x;
      const dy = state.player.position.y - targetMonster.position.y;

      if (profile.isMelee) {
        // Melee (Knight): Close in to 1 SQM distance!
        if (dist > 1) {
          if (Math.abs(dx) >= Math.abs(dy)) {
            actions.push({
              type: "walk",
              direction: dx > 0 ? "west" : "east",
              fallbackMode: "close_in",
              targetPosition: targetMonster.position,
            });
          } else {
            actions.push({
              type: "walk",
              direction: dy > 0 ? "north" : "south",
              fallbackMode: "close_in",
              targetPosition: targetMonster.position,
            });
          }
        } else {
          // Standing right next to monster: hold ground!
          actions.push({ type: "hold" });
        }
      } else {
        // Ranged (Paladin / Mage): 3-4 SQMs sweet spot
        if (tacticalMovement === "diagonal_step") {
          actions.push({
            type: "walk",
            direction: "north_west",
            fallbackMode: "kite_away",
            targetPosition: targetMonster.position,
          });
        } else if (tacticalMovement === "step_back" || dist < 3) {
          // Step back from monster, with smart obstacle fallback
          if (Math.abs(dx) >= Math.abs(dy)) {
            actions.push({
              type: "walk",
              direction: dx >= 0 ? "east" : "west",
              fallbackMode: "kite_away",
              targetPosition: targetMonster.position,
            });
          } else {
            actions.push({
              type: "walk",
              direction: dy >= 0 ? "south" : "north",
              fallbackMode: "kite_away",
              targetPosition: targetMonster.position,
            });
          }
        } else if (tacticalMovement === "step_closer" || dist > 4) {
          // Step closer to prevent losing target off-screen
          if (Math.abs(dx) >= Math.abs(dy)) {
            actions.push({
              type: "walk",
              direction: dx >= 0 ? "west" : "east",
              fallbackMode: "close_in",
              targetPosition: targetMonster.position,
            });
          } else {
            actions.push({
              type: "walk",
              direction: dy >= 0 ? "north" : "south",
              fallbackMode: "close_in",
              targetPosition: targetMonster.position,
            });
          }
        } else {
          // In sweet spot (3-4 SQMs): hold position!
          actions.push({ type: "hold" });
        }
      }
    } else if (macroState === "LOOT" && state.corpses && state.corpses.length > 0) {
      const nearestCorpse = state.corpses[0];
      if (nearestCorpse.distance <= 1) {
        actions.push({ type: "loot_corpse", position: nearestCorpse.position });
      } else {
        actions.push({ type: "auto_walk", destination: nearestCorpse.position });
      }
    } else if (macroState === "EXPLORE_CAVE" && state.nextWaypoint) {
      actions.push({ type: "auto_walk", destination: state.nextWaypoint });
    }

    return actions;
  }
}
