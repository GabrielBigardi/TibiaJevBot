# 🛡️ Jev Tibia 8.60 Autonomous Bot

An autonomous game-playing decision engine for **Tibia (Open Tibia / OTServ)** powered by **TypeSafe AI's Jev** System One model.

Unlike conversational LLMs that take 2-3 seconds to generate text, Jev returns **typed probabilistic judgments in ~250ms**, making it fast enough to keep pace with Tibia's 200ms global cooldowns, monster combos, and kiting mechanics.

---

## 🏛️ Architecture (Approach A: OTClient Lua Bridge)

```
┌────────────────────────────────────────────────────────┐
│               OTClient (Tibia 8.60 Client)             │
│                                                        │
│  lua/jev_bot/jev_bot.lua                               │
│  - Polls g_game and g_map every 250ms                  │
│  - Packages HP, Mana, Position, Monsters into JSON     │
│  - Sends POST http://localhost:3000/tick               │
└───────────────────────────┬────────────────────────────┘
                            │ HTTP POST (Game Snapshot)
                            ▼
┌────────────────────────────────────────────────────────┐
│           Node.js Bot Server (src/server.ts)           │
│                                                        │
│  src/engine/jevTibiaBrain.ts                           │
│  - Parallel Jev System One questions:                  │
│    1. Survival & Healing (choice)                      │
│    2. Critical Lethal Danger (noul)                    │
│    3. Target Prioritization (choice among visible mobs)│
│    4. Offensive Spell/Rune (choice)                    │
│    5. Kiting & Tactical Movement (choice)              │
│  - Translates decisions into executable actions        │
└───────────────────────────┬────────────────────────────┘
                            │ HTTP Response (Actions JSON)
                            ▼
┌────────────────────────────────────────────────────────┐
│               OTClient Execution                       │
│  - g_game.talk("exura vita")                           │
│  - g_game.attack(creature)                             │
│  - g_game.useInventoryItemWith(3155, target)           │
│  - g_game.walk(direction)                              │
└────────────────────────────────────────────────────────┘
```

---

## 🚀 Getting Started

### 1. Test Without OTClient (Mock Game Harness)

You can immediately watch Jev fight in an Ankrahmun Dragon Lair simulation directly in your terminal:

```bash
npm run simulate
```

### 2. Run Automated Tests

Verifies critical HP emergency healing, wounded target prioritization, and mana recovery:

```bash
npm test
```

### 3. Run the Live Server

Start the server listening for ticks from OTClient on port 3000:

```bash
npm start
```

---

## 🎮 Connecting to OTClient (Real Server)

1. **Locate your OTClient directory** (e.g. `otclient-v8` or standard `otclient`).
2. **Copy the module**:
   ```bash
   cp -r lua/jev_bot <your_otclient_path>/modules/
   ```
3. **Launch OTClient** and log in to your OTServ.
4. Click the **"Jev AI Bot"** button on the top menu (or open the module) and click **"Start Jev Bot"**.
5. The bot will begin streaming ticks to `http://localhost:3000/tick` and executing Jev's decisions!

---

## 🧠 Decisions Evaluated Every Tick

In every 250ms cycle, Jev evaluates:
* **`survival_action`** (`choice`): Selects `cast_exura_vita`, `cast_exura_gran`, `cast_exura`, `use_health_potion`, `use_mana_potion`, `cast_utamo_vita`, or `none`.
* **`is_critical_danger`** (`noul`): Probabilistic judgment of whether incoming burst damage is lethal.
* **`target_selection`** (`choice`): Analyzes all visible monsters in the battle list and targets the optimal mob (e.g. wounded dragons to quickly reduce incoming damage).
* **`offensive_action`** (`choice`): Decides whether to cast single-target strike spells (`exori frigo`), Sudden Death runes (`SD`), area runes (`GFB / Avalanche`), or auto-attack.
* **`tactical_movement`** (`choice`): Decides whether to kite backwards, diagonal-step to dodge monster breath/waves, or hold ground.
