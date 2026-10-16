#!/usr/bin/env node
// A playtest bot that joins a room over the real protocol and plays it with
// the decisions in scripts/brain.ts: gather, homes, power, factory, parts,
// claim, datacentre, automation, on every world. Used to drive a room through
// every stage while real browsers watch, and to measure pacing.
//
//   node scripts/playbot.ts <room> [baseUrl] [name] [rush|green|hand]
import WebSocket from "ws";
import { STAGES } from "../shared/content.ts";
import { PROTOCOL_VERSION, type RoomState, type ServerMsg, type Snapshot } from "../shared/protocol.ts";
import { decide, newMemory, type Strategy } from "./brain.ts";

const [room, base = "http://localhost:8080", name = "Bot", strat = "rush"] = process.argv.slice(2);
if (!room || !["rush", "green", "hand"].includes(strat)) {
  console.error("usage: node scripts/playbot.ts <room> [baseUrl] [name] [rush|green|hand]");
  process.exit(1);
}

const ws = new WebSocket(base.replace(/^http/, "ws") + "/ws", { headers: { origin: new URL(base).origin } });
let s: Snapshot | null = null;
let you = "";
let inc = "";
let n = 0;
let mem = newMemory();
const started = Date.now();

const send = (c: object): void => {
  if (s) ws.send(JSON.stringify({ t: "cmd", id: `${name}-${n++}`, inc, gen: s.gen, c }));
};

ws.on("open", () => ws.send(JSON.stringify({ t: "hello", v: PROTOCOL_VERSION, room, name })));
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString()) as ServerMsg;
  if (m.t === "welcome") {
    const fresh = !s || s.gen !== m.snap.gen;
    s = m.snap;
    you = m.you;
    inc = m.inc;
    if (fresh) {
      mem = newMemory();
      console.log(`${((Date.now() - started) / 1000).toFixed(0)}s: ${STAGES[s.stage].name}${s.phase.k === "ended" ? " (ended)" : ""}`);
    }
  } else if (m.t === "delta" && s) {
    if (m.seq !== s.seq + 1) {
      ws.send(JSON.stringify({ t: "sync" }));
      return;
    }
    s.seq = m.seq;
    s.tick = m.tick;
    for (const p of m.players) s.players[p.id] = p;
    for (const [id, x, y] of m.moves ?? []) if (s.players[id]) Object.assign(s.players[id], { x, y });
    for (const [i, t] of m.tiles ?? []) s.tiles[i] = t;
    for (const b of m.buildings ?? []) {
      const at = s.buildings.findIndex((q) => q.id === b.id);
      if (at >= 0) s.buildings[at] = b;
      else s.buildings.push(b);
    }
    if (m.removed) s.buildings = s.buildings.filter((b) => !m.removed!.includes(b.id));
    if (m.lobby) s.lobby = m.lobby;
    if (m.meta) Object.assign(s, m.meta);
  } else if (m.t === "ack" && !m.ok && process.env.VERBOSE) console.log(`refused: ${m.reason}`);
});
ws.on("close", () => process.exit(0));

setInterval(() => {
  if (!s || s.phase.k !== "play") return;
  for (const c of decide(s as unknown as RoomState, you, strat as Strategy, mem)) send(c);
}, 820);
