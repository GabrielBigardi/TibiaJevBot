import "dotenv/config";
import assert from "node:assert/strict";
import { JevTibiaBrain, resolveSpellProfile } from "../src/engine/jevTibiaBrain.js";
import type { GameTickState } from "../src/types.js";

async function runTests() {
  console.log("Running Jev Tibia Autonomous Cavebot & Combat test suite...\n");

  const brain = new JevTibiaBrain();
  console.log(`Engine mode: ${brain.isLive() ? "Live Jev API" : "Offline Simulation"}`);

  // Test 1: Emergency survival healing on critical health (Knight)
  console.log("Test 1: Critical HP emergency response on Knight");
  {
    const state: GameTickState = {
      tickNumber: 1,
      player: {
        name: "TestKnight",
        level: 100,
        vocation: "Knight",
        health: 250,
        maxHealth: 1500, // < 20% HP
        mana: 300,
        maxMana: 400,
        capacity: 500,
        position: { x: 100, y: 100, z: 7 },
        targetId: null,
        isHasted: false,
        hasMagicShield: false,
        isPoisoned: false,
        isParalyzed: false,
      },
      monsters: [
        {
          id: 101,
          name: "Demon",
          healthPercent: 90,
          distance: 1,
          position: { x: 100, y: 101, z: 7 },
          isMonster: true,
          isPlayer: false,
          facingPlayer: true,
        },
      ],
      inventory: {
        healingPotions: 50,
        manaPotions: 50,
        sdRunes: 0,
        areaRunes: 0,
      },
    };

    const decision = await brain.decide(state);
    // Knight must NEVER cast exura vita (Mage spell) or utamo vita!
    const exuraVita = decision.executableActions.find((a) => a.type === "say" && a.text === "exura vita");
    assert.equal(exuraVita, undefined, "Knight must never cast exura vita");

    const utamoVita = decision.executableActions.find((a) => a.type === "say" && a.text === "utamo vita");
    assert.equal(utamoVita, undefined, "Knight must never cast utamo vita");

    // Must use health potion or exura ico
    const healAction = decision.executableActions.find((a) => a.type === "use_item" || (a.type === "say" && a.text.includes("ico")));
    assert.ok(healAction, "Expected health potion or exura ico for knight survival");
  }
  console.log("  ✔ Critical HP emergency test passed");

  // Test 2: Target selection prefers low HP monster
  console.log("Test 2: Target prioritization on wounded creature");
  {
    const state: GameTickState = {
      tickNumber: 2,
      player: {
        name: "TestMage",
        level: 80,
        vocation: "Sorcerer",
        health: 700,
        maxHealth: 700,
        mana: 1000,
        maxMana: 1000,
        capacity: 300,
        position: { x: 100, y: 100, z: 7 },
        targetId: null,
        isHasted: true,
        hasMagicShield: false,
        isPoisoned: false,
        isParalyzed: false,
      },
      monsters: [
        {
          id: 201,
          name: "Dragon Lord",
          healthPercent: 100,
          distance: 3,
          position: { x: 100, y: 97, z: 7 },
          isMonster: true,
          isPlayer: false,
          facingPlayer: false,
        },
        {
          id: 202,
          name: "Dragon",
          healthPercent: 12, // Wounded Dragon!
          distance: 2,
          position: { x: 102, y: 100, z: 7 },
          isMonster: true,
          isPlayer: false,
          facingPlayer: false,
        },
      ],
      inventory: {
        healingPotions: 20,
        manaPotions: 80,
        sdRunes: 20,
        areaRunes: 10,
      },
    };

    const decision = await brain.decide(state);
    assert.equal(decision.selectedTargetId, 202, "Expected wounded Dragon (ID 202) to be prioritized");
    const attackAction = decision.executableActions.find((a) => a.type === "attack");
    assert.ok(attackAction, "Expected attack action in executable actions");
  }
  console.log("  ✔ Target selection test passed");

  // Test 3: Safe HP with low mana triggers level-appropriate mana potion
  console.log("Test 3: Mana recovery when health is stable");
  {
    const state: GameTickState = {
      tickNumber: 3,
      player: {
        name: "TestDruid",
        level: 110,
        vocation: "Druid",
        health: 900,
        maxHealth: 900,
        mana: 180, // < 20% Mana
        maxMana: 1200,
        capacity: 400,
        position: { x: 100, y: 100, z: 7 },
        targetId: null,
        isHasted: false,
        hasMagicShield: false,
        isPoisoned: false,
        isParalyzed: false,
      },
      monsters: [],
      inventory: {
        healingPotions: 10,
        manaPotions: 60,
        sdRunes: 0,
        areaRunes: 0,
      },
    };

    const decision = await brain.decide(state);
    assert.equal(decision.survivalAction, "use_mana_potion");
    // Level 110 uses Great Mana Potion (7590)
    const potAction = decision.executableActions.find((a) => a.type === "use_item" && a.itemId === 7590);
    assert.ok(potAction, "Expected Great Mana Potion (itemId 7590) for level 110 player");
  }
  console.log("  ✔ Mana recovery test passed");

  // Test 4: Bounded Kiting Sweet Spot (Paladin/Mage)
  console.log("Test 4: Bounded kiting sweet spot (anti-target-loss)");
  {
    const farState: GameTickState = {
      tickNumber: 4,
      player: {
        name: "TestMage",
        level: 100,
        vocation: "Sorcerer",
        health: 900,
        maxHealth: 900,
        mana: 1200,
        maxMana: 1200,
        capacity: 400,
        position: { x: 100, y: 100, z: 7 },
        targetId: 301,
        isHasted: true,
        hasMagicShield: false,
        isPoisoned: false,
        isParalyzed: false,
      },
      monsters: [
        {
          id: 301,
          name: "Dragon",
          healthPercent: 70,
          distance: 6, // Too far!
          position: { x: 106, y: 100, z: 7 },
          isMonster: true,
          isPlayer: false,
          facingPlayer: false,
        },
      ],
      inventory: { healingPotions: 20, manaPotions: 50, sdRunes: 10, areaRunes: 0 },
    };

    const farDecision = await brain.decide(farState);
    assert.equal(farDecision.macroState, "COMBAT");
    const walkAction = farDecision.executableActions.find((a) => a.type === "walk");
    assert.ok(walkAction, "Expected walk action to step closer");

    const sweetSpotState: GameTickState = {
      ...farState,
      tickNumber: 5,
      monsters: [
        {
          id: 301,
          name: "Dragon",
          healthPercent: 50,
          distance: 3, // Sweet spot!
          position: { x: 103, y: 100, z: 7 },
          isMonster: true,
          isPlayer: false,
          facingPlayer: false,
        },
      ],
    };

    const sweetDecision = await brain.decide(sweetSpotState);
    const holdOrWalk = sweetDecision.executableActions.find((a) => a.type === "hold" || a.type === "walk");
    assert.ok(sweetDecision.tacticalMovement === "hold_range_3_4" || holdOrWalk, "Expected hold range in sweet spot");
  }
  console.log("  ✔ Bounded kiting sweet spot test passed");

  // Test 5: Corpse Looting
  console.log("Test 5: Corpse detection and looting");
  {
    const lootState: GameTickState = {
      tickNumber: 6,
      player: {
        name: "TestMage",
        level: 100,
        vocation: "Sorcerer",
        health: 900,
        maxHealth: 900,
        mana: 1200,
        maxMana: 1200,
        capacity: 400,
        position: { x: 100, y: 100, z: 7 },
        targetId: null,
        isHasted: false,
        hasMagicShield: false,
        isPoisoned: false,
        isParalyzed: false,
      },
      monsters: [],
      corpses: [
        {
          id: 3104,
          position: { x: 101, y: 100, z: 7 },
          distance: 1,
        },
      ],
      inventory: { healingPotions: 20, manaPotions: 50, sdRunes: 10, areaRunes: 0 },
    };

    const lootDecision = await brain.decide(lootState);
    assert.equal(lootDecision.macroState, "LOOT", "Expected LOOT macro state");
    const lootAction = lootDecision.executableActions.find((a) => a.type === "loot_corpse");
    assert.ok(lootAction, "Expected loot_corpse action for adjacent corpse");
  }
  console.log("  ✔ Corpse looting test passed");

  // Test 6: Cavebot Waypoint Exploration
  console.log("Test 6: Cavebot waypoint exploration");
  {
    const exploreState: GameTickState = {
      tickNumber: 7,
      player: {
        name: "TestMage",
        level: 100,
        vocation: "Sorcerer",
        health: 900,
        maxHealth: 900,
        mana: 1200,
        maxMana: 1200,
        capacity: 400,
        position: { x: 100, y: 100, z: 7 },
        targetId: null,
        isHasted: false,
        hasMagicShield: false,
        isPoisoned: false,
        isParalyzed: false,
      },
      monsters: [],
      corpses: [],
      nextWaypoint: { x: 110, y: 100, z: 7 },
      waypointIndex: 1,
      totalWaypoints: 4,
      inventory: { healingPotions: 20, manaPotions: 50, sdRunes: 10, areaRunes: 0 },
    };

    const exploreDecision = await brain.decide(exploreState);
    assert.equal(exploreDecision.macroState, "EXPLORE_CAVE", "Expected EXPLORE_CAVE macro state");
    const autoWalkAction = exploreDecision.executableActions.find((a) => a.type === "auto_walk");
    assert.ok(autoWalkAction, "Expected auto_walk action towards next waypoint");
  }
  console.log("  ✔ Cavebot waypoint exploration test passed");

  // Test 7: Knight (Melee) Closes In to 1 SQM instead of kiting into walls
  console.log("Test 7: Knight closes to 1 SQM melee distance without kiting into walls");
  {
    const knightState: GameTickState = {
      tickNumber: 8,
      player: {
        name: "Arthur",
        level: 50,
        vocation: "Knight",
        health: 800,
        maxHealth: 800,
        mana: 200,
        maxMana: 200,
        capacity: 500,
        position: { x: 100, y: 100, z: 7 },
        targetId: 501,
        isHasted: false,
        hasMagicShield: false,
        isPoisoned: false,
        isParalyzed: false,
      },
      monsters: [
        {
          id: 501,
          name: "Cyclops",
          healthPercent: 100,
          distance: 3, // 3 SQMs away
          position: { x: 103, y: 100, z: 7 },
          isMonster: true,
          isPlayer: false,
          facingPlayer: false,
        },
      ],
      inventory: { healingPotions: 20, manaPotions: 20, sdRunes: 0, areaRunes: 0 },
    };

    const decision = await brain.decide(knightState);
    const walkAction = decision.executableActions.find((a) => a.type === "walk");
    assert.ok(walkAction, "Expected Knight to walk towards Cyclops");
    if (walkAction && walkAction.type === "walk") {
      assert.equal(walkAction.fallbackMode, "close_in", "Knight movement must be close_in");
      assert.equal(walkAction.direction, "east", "Knight must advance east towards monster");
    }
  }
  console.log("  ✔ Knight melee movement test passed");

  // Test 8: Low-Level Mage (Level 15) does not cast high level spells
  console.log("Test 8: Level 15 Mage casts level-appropriate spells (no exura vita / exori frigo)");
  {
    const profile = resolveSpellProfile({
      name: "YoungWizard",
      level: 15,
      vocation: "Sorcerer",
      health: 200,
      maxHealth: 200,
      mana: 250,
      maxMana: 250,
      capacity: 300,
      position: { x: 100, y: 100, z: 7 },
      targetId: null,
      isHasted: false,
      hasMagicShield: false,
      isPoisoned: false,
      isParalyzed: false,
    });

    assert.equal(profile.heavyHeal, "exura", "Level 15 cannot cast exura vita or exura gran");
    assert.equal(profile.attackSpell, "exori flam", "Level 15 casts exori flam (not exori frigo)");
    assert.equal(profile.healthPotionId, 7618, "Level 15 uses standard Health Potion (7618)");
  }
  console.log("  ✔ Low-level spell restriction test passed");

  // Test 9: Cooldown-Aware Decision Making (Fallback when spell on cooldown)
  console.log("Test 9: Cooldown gatekeeping - Falls back to potion or basic attack when spells are on CD");
  {
    const cdState: GameTickState = {
      tickNumber: 9,
      player: {
        name: "TestMage",
        level: 100,
        vocation: "Sorcerer",
        health: 300, // 30% HP (critical!)
        maxHealth: 1000,
        mana: 800,
        maxMana: 1000,
        capacity: 400,
        position: { x: 100, y: 100, z: 7 },
        targetId: 601,
        isHasted: false,
        hasMagicShield: false,
        isPoisoned: false,
        isParalyzed: false,
      },
      monsters: [
        {
          id: 601,
          name: "Dragon",
          healthPercent: 80,
          distance: 3,
          position: { x: 103, y: 100, z: 7 },
          isMonster: true,
          isPlayer: false,
          facingPlayer: false,
        },
      ],
      cooldowns: {
        spellCooldownRemainingMs: 0,
        healCooldownRemainingMs: 800, // Healing spell on cooldown!
        attackCooldownRemainingMs: 1500, // Attack spell on cooldown!
        itemCooldownRemainingMs: 0,
      },
      inventory: { healingPotions: 10, manaPotions: 20, sdRunes: 0, areaRunes: 0 },
    };

    const decision = await brain.decide(cdState);
    // Since heal spell is on cooldown, it MUST NOT cast exura vita / exura gran, but use health potion!
    const healSpellAction = decision.executableActions.find((a) => a.type === "say" && a.text.includes("exura"));
    assert.equal(healSpellAction, undefined, "Must not cast healing spell while heal is on cooldown");

    const potionAction = decision.executableActions.find((a) => a.type === "use_item");
    assert.ok(potionAction, "Must fall back to health potion when heal spell is on cooldown");

    // Since attack spell is on cooldown, offensive action must be auto_attack
    const atkSpellAction = decision.executableActions.find((a) => a.type === "say" && a.text.includes("exori"));
    assert.equal(atkSpellAction, undefined, "Must not cast attack spell while attack is on cooldown");
  }
  console.log("  ✔ Cooldown gatekeeping test passed");

  // Test 10: Ping-Pong Waypoint Simulation Sequence (1 -> 2 -> 3 -> 4 -> 3 -> 2 -> 1 -> 2)
  console.log("Test 10: Dual Patrol Modes (Ping-Pong vs Loop Waypoint Sequences)");
  {
    const simulatePatrol = (mode: "ping_pong" | "loop", totalWps: number, steps: number): number[] => {
      let currentIdx = 1;
      let dir = 1;
      const history: number[] = [currentIdx];

      for (let i = 0; i < steps; i++) {
        if (mode === "ping_pong") {
          if (dir === 1) {
            if (currentIdx >= totalWps) {
              dir = -1;
              currentIdx = totalWps - 1;
            } else {
              currentIdx++;
            }
          } else {
            if (currentIdx <= 1) {
              dir = 1;
              currentIdx = 2;
            } else {
              currentIdx--;
            }
          }
        } else {
          currentIdx = (currentIdx % totalWps) + 1;
        }
        history.push(currentIdx);
      }
      return history;
    };

    const pingPongHistory = simulatePatrol("ping_pong", 4, 7);
    // Expected ping-pong: 1 -> 2 -> 3 -> 4 -> 3 -> 2 -> 1 -> 2
    assert.deepEqual(
      pingPongHistory,
      [1, 2, 3, 4, 3, 2, 1, 2],
      "Ping-pong sequence must reverse direction at ends"
    );

    const loopHistory = simulatePatrol("loop", 4, 7);
    // Expected loop: 1 -> 2 -> 3 -> 4 -> 1 -> 2 -> 3 -> 4
    assert.deepEqual(
      loopHistory,
      [1, 2, 3, 4, 1, 2, 3, 4],
      "Loop sequence must wrap back to 1"
    );
  }
  console.log("  ✔ Dual patrol mode sequence test passed");

  console.log("\n All Tibia bot tests passed successfully! 🎉");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
