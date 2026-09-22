export interface Position {
  x: number;
  y: number;
  z: number;
}

export interface PlayerConfig {
  vocation?: string;
  healingSpell?: string;
  attackSpell?: string;
  healthPotionId?: number;
  manaPotionId?: number;
}

export interface PlayerState {
  name: string;
  level: number;
  vocation: "Knight" | "Paladin" | "Sorcerer" | "Druid" | "None" | string;
  health: number;
  maxHealth: number;
  mana: number;
  maxMana: number;
  capacity: number;
  position: Position;
  targetId: number | null;
  isHasted: boolean;
  hasMagicShield: boolean;
  isPoisoned: boolean;
  isParalyzed: boolean;
  config?: PlayerConfig;
}

export interface VisibleCreature {
  id: number;
  name: string;
  healthPercent: number;
  distance: number;
  position: Position;
  isMonster: boolean;
  isPlayer: boolean;
  facingPlayer: boolean;
}

export interface CorpseInfo {
  id: number;
  position: Position;
  distance: number;
}

export interface CooldownState {
  spellCooldownRemainingMs?: number;
  healCooldownRemainingMs?: number;
  attackCooldownRemainingMs?: number;
  itemCooldownRemainingMs?: number;
}

export interface InventoryState {
  healingPotions: number;
  manaPotions: number;
  sdRunes: number;
  areaRunes: number; // GFB or Avalanche
}

export interface GameTickState {
  tickNumber: number;
  player: PlayerState;
  monsters: VisibleCreature[];
  corpses?: CorpseInfo[];
  nextWaypoint?: Position | null;
  waypointIndex?: number;
  totalWaypoints?: number;
  patrolMode?: "loop" | "ping_pong";
  cooldowns?: CooldownState;
  inventory: InventoryState;
  surroundingSQMs?: {
    northBlocked?: boolean;
    southBlocked?: boolean;
    eastBlocked?: boolean;
    westBlocked?: boolean;
  };
}

export type BotAction =
  | { type: "say"; text: string }
  | { type: "attack"; targetId: number }
  | { type: "use_item"; itemId: number; targetId?: number }
  | {
      type: "walk";
      direction:
        | "north"
        | "south"
        | "east"
        | "west"
        | "north_east"
        | "north_west"
        | "south_east"
        | "south_west";
      fallbackMode?: "kite_away" | "close_in";
      targetPosition?: Position;
    }
  | { type: "auto_walk"; destination: Position }
  | { type: "loot_corpse"; position: Position }
  | { type: "hold" };

export interface JevDecisionReport {
  tickNumber: number;
  macroState: "COMBAT" | "LOOT" | "EXPLORE_CAVE" | "RECOVER";
  survivalAction: string;
  isCriticalDanger: boolean;
  dangerProbability: number;
  selectedTargetId: number | null;
  selectedTargetName?: string;
  offensiveAction: string;
  tacticalMovement: string;
  executableActions: BotAction[];
  model: string;
  latencyMs: number;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
}
