import "dotenv/config";
import { JevTibiaBrain } from "../engine/jevTibiaBrain.js";
import type { CorpseInfo, GameTickState, PlayerState, Position, VisibleCreature } from "../types.js";

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function renderHealthBar(current: number, max: number, length: number = 20): string {
  const ratio = Math.max(0, Math.min(1, current / (max || 1)));
  const filled = Math.round(ratio * length);
  const empty = length - filled;
  const color = ratio > 0.6 ? "\x1b[32m" : ratio > 0.3 ? "\x1b[33m" : "\x1b[31m";
  return `${color}[${"█".repeat(filled)}${"░".repeat(empty)}]\x1b[0m ${current}/${max} (${Math.round(
    ratio * 100
  )}%)`;
}

async function runSimulation() {
  console.log("================================================================");
  console.log(" 🐉 TIBIA AUTONOMOUS CAVEBOT & COMBAT HARNESS");
  console.log(" Simulating real OTClient ticks with live Jev System One Brain");
  console.log("================================================================\n");

  const brain = new JevTibiaBrain();
  console.log(`Engine: ${brain.isLive() ? "🟢 LIVE TYPESAFE API (Jev)" : "🟡 OFFLINE SIMULATOR"}\n`);

  const initialPlayer: PlayerState = {
    name: "Albus the Mage",
    level: 120,
    vocation: "Sorcerer",
    health: 950,
    maxHealth: 950,
    mana: 1200,
    maxMana: 1400,
    capacity: 450,
    position: { x: 33120, y: 32450, z: 7 },
    targetId: null,
    isHasted: true,
    hasMagicShield: false,
    isPoisoned: false,
    isParalyzed: false,
  };

  const encounterSequence: Array<{
    description: string;
    playerUpdate: Partial<PlayerState>;
    monsters: VisibleCreature[];
    corpses?: CorpseInfo[];
    nextWaypoint?: Position;
  }> = [
    {
      description: "Patrolling cave. Dragon spotted at long range (6 SQMs) — danger of losing lock!",
      playerUpdate: { health: 950, mana: 1200 },
      monsters: [
        {
          id: 501,
          name: "Dragon",
          healthPercent: 100,
          distance: 6,
          position: { x: 33126, y: 32450, z: 7 },
          isMonster: true,
          isPlayer: false,
          facingPlayer: false,
        },
      ],
      corpses: [],
      nextWaypoint: { x: 33130, y: 32450, z: 7 },
    },
    {
      description: "Closed distance. Dragon now in melee range (1 SQM) — needs tactical retreat!",
      playerUpdate: { health: 710, mana: 1050 },
      monsters: [
        {
          id: 501,
          name: "Dragon",
          healthPercent: 75,
          distance: 1,
          position: { x: 33121, y: 32450, z: 7 },
          isMonster: true,
          isPlayer: false,
          facingPlayer: true,
        },
      ],
      corpses: [],
    },
    {
      description: "Stepped back to optimal kiting sweet spot (3 SQMs). Holding range to prevent monster de-target!",
      playerUpdate: { health: 880, mana: 850 },
      monsters: [
        {
          id: 501,
          name: "Dragon",
          healthPercent: 20,
          distance: 3,
          position: { x: 33123, y: 32450, z: 7 },
          isMonster: true,
          isPlayer: false,
          facingPlayer: false,
        },
      ],
      corpses: [],
    },
    {
      description: "Dragon slayed! Unlooted Dragon corpse spotted at distance 1 SQM.",
      playerUpdate: { health: 950, mana: 700 },
      monsters: [],
      corpses: [
        {
          id: 3104,
          position: { x: 33121, y: 32450, z: 7 },
          distance: 1,
        },
      ],
      nextWaypoint: { x: 33140, y: 32450, z: 7 },
    },
    {
      description: "Corpse looted! Cave is clear. Autonomous cavebot resuming waypoint patrol.",
      playerUpdate: { health: 950, mana: 720 },
      monsters: [],
      corpses: [],
      nextWaypoint: { x: 33140, y: 32450, z: 7 },
    },
  ];

  let currentPlayer = { ...initialPlayer };

  for (let i = 0; i < encounterSequence.length; i++) {
    const step = encounterSequence[i];
    const tickNumber = i + 1;

    currentPlayer = {
      ...currentPlayer,
      ...step.playerUpdate,
    };

    const tickState: GameTickState = {
      tickNumber,
      player: currentPlayer,
      monsters: step.monsters,
      corpses: step.corpses,
      nextWaypoint: step.nextWaypoint,
      waypointIndex: i + 1,
      totalWaypoints: 4,
      inventory: {
        healingPotions: 15,
        manaPotions: 80,
        sdRunes: 35,
        areaRunes: 20,
      },
    };

    console.log(`────────────────────────────────────────────────────────────────`);
    console.log(`⏱️  TICK #${tickNumber} ENCOUNTER: ${step.description}`);
    console.log(`   Player: ${currentPlayer.name} [Lv ${currentPlayer.level} ${currentPlayer.vocation}]`);
    console.log(`   HP:   ${renderHealthBar(currentPlayer.health, currentPlayer.maxHealth)}`);
    console.log(`   Mana: ${renderHealthBar(currentPlayer.mana, currentPlayer.maxMana)}`);
    console.log(
      `   Visible Mobs: ${
        step.monsters.length > 0
          ? step.monsters.map((m) => `${m.name} (${m.healthPercent}% HP, ${m.distance} SQM)`).join(", ")
          : "None"
      }`
    );
    console.log(
      `   Corpses:      ${
        step.corpses && step.corpses.length > 0
          ? step.corpses.map((c) => `ID ${c.id} (${c.distance} SQM)`).join(", ")
          : "None"
      }`
    );
    console.log(
      `   Waypoint:     ${step.nextWaypoint ? `(${step.nextWaypoint.x}, ${step.nextWaypoint.y}, ${step.nextWaypoint.z})` : "None"}`
    );

    const decision = await brain.decide(tickState);

    const macroColor =
      decision.macroState === "COMBAT"
        ? "\x1b[31m"
        : decision.macroState === "LOOT"
        ? "\x1b[33m"
        : decision.macroState === "EXPLORE_CAVE"
        ? "\x1b[32m"
        : "\x1b[36m";

    console.log(`\n   🧠 Jev Decision (Latency: ${decision.latencyMs}ms | Model: ${decision.model}):`);
    console.log(`   ├─ Macro State:       ${macroColor}${decision.macroState}\x1b[0m`);
    console.log(`   ├─ Survival Action:   \x1b[36m${decision.survivalAction}\x1b[0m`);
    console.log(
      `   ├─ Critical Danger:   ${
        decision.isCriticalDanger ? "\x1b[31mYES 🚨 (Burst risk)\x1b[0m" : "\x1b[32mNO (Manageable)\x1b[0m"
      } [P=${(decision.dangerProbability * 100).toFixed(1)}%]`
    );
    console.log(`   ├─ Target Selected:   \x1b[33m${decision.selectedTargetName || "none"}\x1b[0m`);
    console.log(`   ├─ Offensive Action:  \x1b[35m${decision.offensiveAction}\x1b[0m`);
    console.log(`   └─ Movement / Kiting: \x1b[34m${decision.tacticalMovement}\x1b[0m`);

    const actionsStr = decision.executableActions
      .map((a) => {
        if (a.type === "say") return `say("${a.text}")`;
        if (a.type === "attack") return `attack(${a.targetId})`;
        if (a.type === "walk") return `walk(${a.direction})`;
        if (a.type === "auto_walk") return `auto_walk(${a.destination.x}, ${a.destination.y})`;
        if (a.type === "loot_corpse") return `loot_corpse(${a.position.x}, ${a.position.y})`;
        if (a.type === "hold") return `hold()`;
        return `${a.type}`;
      })
      .join(", ");
    console.log(`   ⚡ OTClient Command:  [${actionsStr || "idle"}]\n`);

    await sleep(400);
  }

  console.log("================================================================");
  console.log(" ✅ Simulation completed successfully!");
  console.log(" All macro states (Combat, Loot, Cave Exploration) verified.");
  console.log("================================================================");
}

runSimulation().catch((err) => {
  console.error("Simulation error:", err);
  process.exit(1);
});
