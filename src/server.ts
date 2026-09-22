import "dotenv/config";
import http from "node:http";
import { JevTibiaBrain } from "./engine/jevTibiaBrain.js";
import type { GameTickState, JevDecisionReport } from "./types.js";

const PORT = parseInt(process.env.PORT || "3000", 10);
const brain = new JevTibiaBrain();

let totalTicks = 0;
let totalLatency = 0;

console.log("================================================================");
console.log(" 🛡️  JEV TIBIA 8.60 BOT SERVER");
console.log(" Autonomous Decision Engine powered by TypeSafe AI (Jev)");
console.log("================================================================");
console.log(`Status: ${brain.isLive() ? "🟢 Live Jev API Connected" : "🟡 Offline / Simulated Mode"}`);
console.log(`Listening for OTClient ticks on http://localhost:${PORT}/tick\n`);

const server = http.createServer(async (req, res) => {
  // Enable CORS for web viewers or local tooling
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ready",
        isLive: brain.isLive(),
        totalTicks,
        averageLatencyMs: totalTicks > 0 ? Math.round(totalLatency / totalTicks) : 0,
      })
    );
    return;
  }

  if (req.method === "POST" && req.url === "/tick") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });

    req.on("end", async () => {
      try {
        const state: GameTickState = JSON.parse(body);
        totalTicks++;

        const decision: JevDecisionReport = await brain.decide(state);
        totalLatency += decision.latencyMs;

        // Visual Terminal telemetry log
        const hpPercent = Math.round((state.player.health / (state.player.maxHealth || 1)) * 100);
        const manaPercent = Math.round((state.player.mana / (state.player.maxMana || 1)) * 100);
        const mobCount = state.monsters ? state.monsters.length : 0;
        const corpseCount = state.corpses ? state.corpses.length : 0;

        console.log(
          `[Tick #${state.tickNumber.toString().padStart(4, "0")}] ` +
            `[${decision.macroState}] ` +
            `HP: ${hpPercent}% (${state.player.health}/${state.player.maxHealth}) | ` +
            `MP: ${manaPercent}% (${state.player.mana}/${state.player.maxMana}) | ` +
            `Mobs: ${mobCount} | Corpses: ${corpseCount} | ` +
            `Jev: ${decision.latencyMs}ms (${decision.model})`
        );

        if (decision.isCriticalDanger) {
          console.log(`   🚨 [DANGER ALERT] Threat probability: ${(decision.dangerProbability * 100).toFixed(1)}%!`);
        }

        console.log(
          `   👉 State: [${decision.macroState}] | ` +
            `Survival: [${decision.survivalAction}] | ` +
            `Target: [${decision.selectedTargetName || "none"}] | ` +
            `Offense: [${decision.offensiveAction}] | ` +
            `Move: [${decision.tacticalMovement}]`
        );

        const actionSummary = decision.executableActions
          .map((a) => (a.type === "say" ? `say("${a.text}")` : `${a.type}`))
          .join(", ");
        console.log(`   ⚡ Actions to OTClient: [${actionSummary || "idle"}]\n`);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: "ok",
            actions: decision.executableActions,
            decision,
          })
        );
      } catch (err: any) {
        console.error("Error processing tick:", err.message);
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not Found");
});

const HOST = process.env.HOST || "0.0.0.0";

server.listen(PORT, HOST, () => {
  console.log(`Server ready on http://${HOST}:${PORT}`);
});

export { server, brain };
