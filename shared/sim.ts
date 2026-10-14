// The authoritative room simulation. Pure functions over a JSON-serialisable
// RoomState, so it runs (and is tested) without a browser or a socket. The
// server owns the only live copy of each room and calls these in order: one
// command or one tick at a time, which is what serialises every mutation.
import {
  BUILDINGS,
  BUILD_RANGE,
  EMOTES,
  FAMILIES,
  HARVEST_COOLDOWN_TICKS,
  HARVEST_RANGE,
  HEAT_LIMIT,
  MARKS_PER_PLAYER,
  MAX_IDENTITIES,
  MAX_PLAYERS,
  PACES,
  PLAYER_SPEED,
  SALVAGE_RATE,
  STAGES,
  SUN_TO_RESERVE,
  TICK_MS,
  buildingName,
  type Bundle,
  type BuildingType,
  type Family,
  type Pace,
} from "./content.ts";
import type { Building, Command, Ledger, Player, RoomState, StageSummary, Tile } from "./protocol.ts";
import { SCHEMA_VERSION } from "./protocol.ts";
import { generateStage } from "./worldgen.ts";

/** What changed during one call: the server turns this into a delta. */
export interface Changes {
  tiles: Set<number>;
  buildings: Set<number>;
  removed: number[];
  meta: boolean;
  log: number;
  /** a stage boundary or the ending: save now, then broadcast a fresh snapshot */
  boundary: boolean;
}

export const newChanges = (): Changes => ({ tiles: new Set(), buildings: new Set(), removed: [], meta: false, log: 0, boundary: false });

export type Result = { ok: true } | { ok: false; reason: string };
const no = (reason: string): Result => ({ ok: false, reason });
const OK: Result = { ok: true };

const emptyLedger = (): Ledger =>
  Object.fromEntries(FAMILIES.map((f) => [f, { initial: 0, remaining: 0, extracted: 0, destroyed: 0 }])) as Ledger;

function ledgerFor(tiles: Tile[]): Ledger {
  const l = emptyLedger();
  for (const t of tiles) if (t.d) {
    l[t.d].initial += t.init;
    l[t.d].remaining += t.amt;
  }
  return l;
}

/**
 * The land holds only as much life as its world has left: every tile's life
 * is capped by how much of the world remains (60%) and how much of its water,
 * its coolant, remains (40%). So the whole land dries as it's consumed, in
 * whatever order, not just the tiles anyone touched, and draining the pond
 * costs more than its share. Derived from the ledger on both sides, so it
 * costs no traffic.
 */
export const lifeCap = (ledger: Ledger): number => {
  const frac = (rem: number, init: number): number => (init ? rem / init : 0);
  const total = FAMILIES.reduce((a, f) => a + ledger[f].remaining, 0);
  const initial = FAMILIES.reduce((a, f) => a + ledger[f].initial, 0);
  const left = 0.6 * frac(total, initial) + 0.4 * frac(ledger.coolant.remaining, ledger.coolant.initial);
  return Math.round(15 + 85 * left);
};

export const effectiveLife = (t: Tile, cap: number): number => Math.min(t.life, cap);

export const averageLife = (s: Pick<RoomState, "tiles" | "ledger">): number => {
  const cap = lifeCap(s.ledger);
  const land = s.tiles.filter((t) => t.t === 0 || t.t === 1 || t.t === 3);
  return Math.round(land.reduce((a, t) => a + effectiveLife(t, cap), 0) / Math.max(1, land.length));
};

export function createRoom(code: string, seed: number, pace: Pace): RoomState {
  const g = generateStage(seed, 0);
  const s: RoomState = {
    v: SCHEMA_VERSION,
    code,
    seed,
    pace,
    hostId: null,
    tick: 0,
    seq: 0,
    gen: 1,
    stage: 0,
    stageStartTick: 0,
    lifeStart: 100,
    econTicks: 0,
    phase: { k: "play" },
    w: STAGES[0].size,
    tiles: g.tiles,
    buildings: g.buildings,
    nextBuildingId: g.buildings.length + 1,
    inventory: { ...STAGES[0].starter },
    ledger: ledgerFor(g.tiles),
    econ: { energySupply: 0, energyUsed: 0, computeSupply: 0, computeUsed: 0, workersSupply: 0, workersUsed: 0 },
    heat: 0,
    reserve: 0,
    history: [],
    archive: [],
    players: {},
    tokens: {},
    receipts: {},
    log: [],
  };
  s.lifeStart = averageLife(s);
  return s;
}

export const spawnPoint = (s: RoomState): { x: number; y: number } => {
  const st = STAGES[s.stage];
  const c = (st.size - 1) / 2;
  if (st.id === "sun") return { x: c, y: st.size - 4 };
  if (st.id === "system") return { x: c, y: c + 2 };
  return { x: c, y: c };
};

function log(s: RoomState, ch: Changes, text: string): void {
  s.log.push({ tick: s.tick, text });
  if (s.log.length > 40) s.log.splice(0, s.log.length - 40);
  ch.log++;
}

const cleanText = (raw: unknown, max: number): string | null => {
  if (typeof raw !== "string") return null;
  // printable characters only; collapse whitespace; hard length cap
  const t = raw.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
  return t.length > 0 ? t : null;
};
export const cleanName = (raw: unknown): string => cleanText(raw, 16) ?? "Guest";

/** Add a player, or return the existing one. Returns null when the room is full. */
export function join(s: RoomState, id: string, token: string, name: string, ch: Changes): Player | null {
  const existing = s.players[id];
  if (existing) {
    existing.connected = true;
    if (!s.hostId || !s.players[s.hostId]?.connected) s.hostId = id;
    log(s, ch, `${existing.name} is back.`);
    ch.meta = true;
    return existing;
  }
  // capacity is seats at the table, not every browser that ever visited
  if (Object.values(s.players).filter((q) => q.connected).length >= MAX_PLAYERS) return null;
  if (Object.keys(s.players).length >= MAX_IDENTITIES) {
    // forget the longest-gone identity; its buildings stay, credited to "someone"
    const gone = Object.values(s.players)
      .filter((q) => !q.connected)
      .sort((a, b) => a.joinedTick - b.joinedTick)[0];
    delete s.players[gone.id];
    delete s.tokens[gone.id];
    delete s.receipts[gone.id];
  }
  const used = new Set(Object.values(s.players).map((p) => p.colour));
  let colour = 0;
  while (used.has(colour)) colour++;
  const sp = spawnPoint(s);
  const n = Object.keys(s.players).length;
  // two browsers called "Ada" stay tellable apart
  const taken = new Set(Object.values(s.players).map((q) => q.name));
  let unique = cleanName(name);
  for (let k = 2; taken.has(unique); k++) unique = `${cleanName(name).slice(0, 13)} ${k}`;
  const p: Player = {
    id,
    name: unique,
    colour,
    x: sp.x + (n % 3) - 1,
    y: sp.y + Math.floor(n / 3) * 0.8,
    dx: 0,
    dy: 0,
    facing: 2,
    act: null,
    connected: true,
    joinedTick: s.tick,
    nextHarvest: 0,
    nextEmote: 0,
    marks: 0,
    stats: { harvested: 0, built: 0, helped: 0 },
  };
  s.players[id] = p;
  s.tokens[id] = token;
  s.receipts[id] = [];
  if (!s.hostId || !s.players[s.hostId]?.connected) s.hostId = id;
  log(s, ch, `${p.name} arrived.`);
  ch.meta = true;
  return p;
}

/** A player's connection dropped. Their buildings and stats stay; the host role moves on. */
export function leave(s: RoomState, id: string, ch: Changes): void {
  const p = s.players[id];
  if (!p) return;
  p.connected = false;
  p.dx = p.dy = 0;
  if (s.hostId === id) {
    const next = Object.values(s.players)
      .filter((q) => q.connected)
      .sort((a, b) => a.joinedTick - b.joinedTick)[0];
    s.hostId = next ? next.id : id;
  }
  log(s, ch, `${p.name} stepped away.`);
  ch.meta = true;
}

const centre = (b: Pick<Building, "x" | "y" | "type">): [number, number] => {
  const h = (BUILDINGS[b.type].size - 1) / 2;
  return [b.x + h, b.y + h];
};

const isInt = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n);
const tileAt = (s: RoomState, x: number, y: number): Tile | undefined => (inBounds(s, x, y) ? s.tiles[y * s.w + x] : undefined);
const near = (p: Player, x: number, y: number, range: number): boolean => Math.hypot(p.x - x, p.y - y) <= range;
const complete = (b: Building): boolean => b.work >= BUILDINGS[b.type].build * 10;

export const isHost = (s: RoomState, id: string): boolean => s.hostId === id;

/** Why a building can't go here, or null if it can. Shared by server and the ghost preview. */
export function placementProblem(s: RoomState, type: BuildingType, x: number, y: number, p?: Player): string | null {
  const st = STAGES[s.stage];
  if (!st.buildings.includes(type)) return `nothing like that can be built on ${st.name}`;
  const def = BUILDINGS[type];
  for (const [fx, fy] of footprint({ type, x, y })) {
    const t = tileAt(s, fx, fy);
    if (!t) return "off the edge of the map";
    if (t.b) return "something is already built here";
    if (t.d && t.amt > 0) return `there's ${st.families[t.d].label} here: harvest it first`;
    if (t.t === 1) return "can't build on water";
    if (t.t === 3) return "can't build on the star itself";
    if (t.t === 2 && type !== "relay") return "nothing to build on: only relays float in open space";
  }
  if (p && !near(p, x + (def.size - 1) / 2, y + (def.size - 1) / 2, BUILD_RANGE)) return "too far away: walk closer";
  for (const f of FAMILIES) {
    const need = def.cost[f] ?? 0;
    if (s.inventory[f] < need) return `needs ${need} ${st.families[f].label} (have ${s.inventory[f]})`;
  }
  return null;
}

function remember(s: RoomState, tile: Tile, fate: string, ch: Changes): void {
  if (!tile.mark) return;
  s.archive.push({ stage: STAGES[s.stage].id, name: tile.mark.name, fate });
  log(s, ch, `${tile.mark.name} ${fate}.`);
  delete tile.mark;
  ch.meta = true;
}

function takeFrom(s: RoomState, idx: number, amount: number, ch: Changes): number {
  const tile = s.tiles[idx];
  if (!tile.d || tile.amt <= 0) return 0;
  const took = Math.min(amount, tile.amt);
  tile.amt -= took;
  s.ledger[tile.d].remaining -= took;
  s.ledger[tile.d].extracted += took;
  s.inventory[tile.d] += took;
  tile.life = Math.min(tile.life, Math.round((tile.amt / tile.init) * 60));
  ch.tiles.add(idx);
  ch.meta = true;
  if (tile.amt === 0) {
    remember(s, tile, "was harvested bare", ch);
    // a grove or pond gone leaves the ground around it poorer
    const x = idx % s.w;
    const y = Math.floor(idx / s.w);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const n = tileAt(s, x + dx, y + dy);
        if (!n || n.t === 2 || (dx === 0 && dy === 0)) continue;
        n.life = Math.max(0, n.life - 15);
        ch.tiles.add((y + dy) * s.w + x + dx);
      }
  }
  return took;
}

function receipt(s: RoomState, pid: string, cmdId: string): void {
  const r = (s.receipts[pid] ??= []);
  r.push(cmdId);
  if (r.length > 64) r.splice(0, r.length - 64);
}

export function applyCommand(s: RoomState, pid: string, cmdId: string, gen: number, c: Command, ch: Changes): Result {
  const p = s.players[pid];
  if (!p) return no("not in this room");
  if (typeof cmdId !== "string" || cmdId.length < 1 || cmdId.length > 40) return no("bad command id");
  if (gen !== s.gen) return no("that was meant for a world that's gone");
  if (!c || typeof c !== "object") return no("malformed command");

  if (c.k === "move") {
    // continuous intent, idempotent by nature: not receipted
    if (typeof c.dx !== "number" || typeof c.dy !== "number" || !Number.isFinite(c.dx) || !Number.isFinite(c.dy)) return no("malformed move");
    const len = Math.hypot(c.dx, c.dy);
    p.dx = len > 1 ? c.dx / len : c.dx;
    p.dy = len > 1 ? c.dy / len : c.dy;
    return OK;
  }

  if (s.phase.k !== "play") return no(s.phase.k === "ended" ? "there is nothing left" : "the world is changing: wait a moment");
  // a retry of a command that was applied is acknowledged again, not applied again;
  // only applied commands are receipted, so a refused one can be retried for real
  if (s.receipts[pid]?.includes(cmdId)) return OK;
  const res = mutate(s, p, c, ch);
  if (res.ok) receipt(s, pid, cmdId);
  return res;
}

function mutate(s: RoomState, p: Player, c: Exclude<Command, { k: "move" }>, ch: Changes): Result {
  const pid = p.id;
  const st = STAGES[s.stage];

  switch (c.k) {
    case "harvest": {
      if (!isInt(c.x) || !isInt(c.y) || !inBounds(s, c.x, c.y)) return no("off the map");
      if (s.tick < p.nextHarvest) return no("too fast");
      if (!near(p, c.x, c.y, HARVEST_RANGE)) return no("too far away");
      const idx = c.y * s.w + c.x;
      const tile = s.tiles[idx];
      if (tile.b) {
        const b = s.buildings.find((q) => q.id === tile.b)!;
        if (complete(b)) return no(`the ${buildingName(st, b.type)} is already built`);
        b.work = Math.min(BUILDINGS[b.type].build * 10, b.work + 5);
        ch.buildings.add(b.id);
        p.stats.helped++;
        p.nextHarvest = s.tick + HARVEST_COOLDOWN_TICKS;
        p.act = { k: "build", until: s.tick + 4 };
        return OK;
      }
      if (!tile.d || tile.amt <= 0) return no("nothing to harvest there");
      const took = takeFrom(s, idx, PACES[s.pace].harvestYield, ch);
      withdraw(s, p, ch);
      p.stats.harvested += took;
      p.nextHarvest = s.tick + HARVEST_COOLDOWN_TICKS;
      p.act = { k: "harvest", until: s.tick + 4 };
      p.facing = facingTo(c.x - p.x, c.y - p.y, p.facing);
      checkExhausted(s, ch);
      return OK;
    }
    case "build": {
      if (!isInt(c.x) || !isInt(c.y) || typeof c.type !== "string" || !(c.type in BUILDINGS)) return no("malformed build");
      const problem = placementProblem(s, c.type, c.x, c.y, p);
      if (problem) return no(problem);
      const def = BUILDINGS[c.type];
      // payment and occupancy commit together: nothing between them can fail
      for (const f of FAMILIES) s.inventory[f] -= def.cost[f] ?? 0;
      const b: Building = { id: s.nextBuildingId++, type: c.type, x: c.x, y: c.y, owner: pid, work: 0, status: "under construction" };
      s.buildings.push(b);
      for (const [fx, fy] of footprint(b)) {
        const idx = fy * s.w + fx;
        const tile = s.tiles[idx];
        tile.b = b.id;
        if (c.type !== "plaza") tile.life = Math.min(tile.life, 15);
        ch.tiles.add(idx);
        remember(s, tile, `became a ${buildingName(st, c.type)}`, ch);
      }
      ch.buildings.add(b.id);
      ch.meta = true;
      withdraw(s, p, ch);
      p.stats.built++;
      p.act = { k: "build", until: s.tick + 6 };
      log(s, ch, `${p.name} started a ${buildingName(st, c.type)}.`);
      return OK;
    }
    case "demolish": {
      if (!isInt(c.x) || !isInt(c.y)) return no("malformed demolish");
      const tile = tileAt(s, c.x, c.y);
      if (!tile?.b) return no("nothing built there");
      const b = s.buildings.find((q) => q.id === tile.b)!;
      const def = BUILDINGS[b.type];
      if (def.protected) return no("the Depot is shared: nobody can take it down");
      if (def.renderValue) {
        if (!isHost(s, pid)) return no("only the host can render down a world");
        s.reserve += def.renderValue;
        s.archive.push({ stage: st.id, name: b.name ?? "A world", fate: `was rendered down for ${def.renderValue} energy` });
        log(s, ch, `${p.name} rendered down ${b.name}.`);
      } else {
        if (b.owner !== pid && !isHost(s, pid)) return no("only its builder or the host can take this down");
        // lossy salvage: always strictly less than the cost, so no refund loop
        for (const f of FAMILIES) s.inventory[f] += Math.floor((def.cost[f] ?? 0) * SALVAGE_RATE);
        log(s, ch, `${p.name} took down a ${buildingName(st, b.type)}.`);
      }
      for (const [fx, fy] of footprint(b)) {
        const idx = fy * s.w + fx;
        s.tiles[idx].b = 0;
        ch.tiles.add(idx);
      }
      s.buildings = s.buildings.filter((q) => q.id !== b.id);
      ch.removed.push(b.id);
      ch.meta = true;
      return OK;
    }
    case "emote": {
      if (!(EMOTES as readonly string[]).includes(c.e)) return no("unknown emote");
      if (s.tick < p.nextEmote) return no("too fast");
      p.act = { k: "emote", e: c.e, until: s.tick + 25 };
      p.nextEmote = s.tick + 8;
      return OK;
    }
    case "mark": {
      if (!isInt(c.x) || !isInt(c.y)) return no("malformed mark");
      const tile = tileAt(s, c.x, c.y);
      const name = cleanText(c.name, 24);
      if (!tile) return no("off the map");
      if (!name) return no("give the place a name");
      if (tile.b) return no("pick somewhere nothing is built");
      if (tile.mark) return no(`that's already ${tile.mark.name}`);
      if (p.marks >= MARKS_PER_PLAYER) return no(`you can name ${MARKS_PER_PLAYER} places per world`);
      if (!near(p, c.x, c.y, BUILD_RANGE)) return no("too far away");
      tile.mark = { name, by: p.name };
      p.marks++;
      ch.tiles.add(c.y * s.w + c.x);
      log(s, ch, `${p.name} named a place ${name}.`);
      return OK;
    }
    case "stop": {
      if (STAGES[s.stage].id !== "universe") return no("there's always another world, until the last one");
      if (typeof c.on !== "boolean") return no("malformed vote");
      // a dropped connection never ends the campaign: if a holdout leaves, someone
      // still here confirms by voting again
      if (p.stop !== c.on) {
        p.stop = c.on;
        log(s, ch, c.on ? `${p.name} wants to stop here and leave the rest alone.` : `${p.name} wants to keep going.`);
        ch.meta = true;
      }
      checkRestraint(s, ch);
      return OK;
    }
    default:
      return no("unknown command");
  }
}

function withdraw(s: RoomState, p: Player, ch: Changes): void {
  if (!p.stop) return;
  p.stop = false;
  log(s, ch, `${p.name} went back to work.`);
}

/**
 * The restraint ending: if everyone present in the Universe agrees to stop,
 * the campaign ends with what's left still out there. It can't be undone, and
 * absent players can't block it (or make it happen) by staying away.
 */
export function checkRestraint(s: RoomState, ch: Changes): void {
  if (s.phase.k !== "play" || STAGES[s.stage].id !== "universe") return;
  const here = Object.values(s.players).filter((p) => p.connected);
  if (here.length === 0 || !here.every((p) => p.stop)) return;
  const left = totalRemaining(s);
  if (left === 0) return;
  s.history.push({
    stage: "universe",
    ledger: structuredClone(s.ledger),
    lifeStart: s.lifeStart,
    lifeEnd: averageLife(s),
    buildings: s.buildings.filter((b) => b.owner).length,
    ticks: s.tick - s.stageStartTick,
    lost: s.archive.filter((a) => a.stage === "universe").map((a) => a.name),
  });
  for (const t of s.tiles) if (t.mark) s.archive.push({ stage: "universe", name: t.mark.name, fate: "is still there" });
  s.archive.push({ stage: "universe", name: `${left} units of the Universe`, fate: "were left alone" });
  s.phase = { k: "ended", how: "restraint" };
  for (const p of Object.values(s.players)) p.dx = p.dy = 0;
  log(s, ch, "You stopped. The rest is still out there.");
  ch.meta = true;
  ch.boundary = true;
}

export function facingTo(dx: number, dy: number, fallback: number): number {
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return fallback;
  return (Math.round((Math.atan2(dy, dx) / (Math.PI * 2)) * 8) + 8) % 8;
}

function checkExhausted(s: RoomState, ch: Changes): void {
  if (s.phase.k !== "play") return;
  if (FAMILIES.some((f) => s.ledger[f].remaining > 0)) return;
  const st = STAGES[s.stage];
  const lost: string[] = [];
  for (const t of s.tiles) if (t.mark) {
    lost.push(t.mark.name);
    s.archive.push({ stage: st.id, name: t.mark.name, fate: `was left behind on spent ${st.name}` });
    delete t.mark;
  }
  const summary: StageSummary = {
    stage: st.id,
    ledger: structuredClone(s.ledger),
    lifeStart: s.lifeStart,
    lifeEnd: averageLife(s),
    buildings: s.buildings.filter((b) => b.owner).length,
    ticks: s.tick - s.stageStartTick,
    lost: [...s.archive.filter((a) => a.stage === st.id).map((a) => a.name)],
  };
  s.history.push(summary);
  s.phase = { k: "transition", until: s.tick + PACES[s.pace].transitionTicks, summary };
  log(s, ch, st.departure);
  ch.meta = true;
  ch.boundary = true;
}

function nextStage(s: RoomState, ch: Changes): void {
  const leaving = STAGES[s.stage];
  if (s.stage === STAGES.length - 1) {
    s.phase = { k: "ended", how: "consumed" };
    for (const p of Object.values(s.players)) p.dx = p.dy = 0;
    log(s, ch, "The engine keeps searching for a next frontier. There isn't one.");
    ch.meta = true;
    ch.boundary = true;
    return;
  }
  if (leaving.id === "sun") s.reserve += s.ledger.matter.extracted * SUN_TO_RESERVE;
  s.stage++;
  s.gen++;
  const st = STAGES[s.stage];
  const g = generateStage(s.seed, s.stage);
  s.w = st.size;
  s.tiles = g.tiles;
  s.buildings = g.buildings;
  s.nextBuildingId = g.buildings.length + 1;
  s.inventory = { ...st.starter };
  s.ledger = ledgerFor(g.tiles);
  s.heat = 0;
  s.stageStartTick = s.tick;
  s.lifeStart = averageLife(s);
  s.phase = { k: "play" };
  const sp = spawnPoint(s);
  Object.values(s.players).forEach((p, i) => {
    p.x = sp.x + (i % 3) - 1;
    p.y = sp.y + Math.floor(i / 3) * 0.8;
    p.dx = p.dy = 0;
    p.act = null;
    p.marks = 0;
  });
  s.receipts = Object.fromEntries(Object.keys(s.players).map((id) => [id, []]));
  log(s, ch, st.arrival);
  ch.meta = true;
  ch.boundary = true;
}

/** One server tick (TICK_MS). Movement every tick; the economy every PACES[pace].econEvery. */
export function tick(s: RoomState, ch: Changes): void {
  s.tick++;
  const dt = TICK_MS / 1000;
  for (const p of Object.values(s.players)) {
    if (p.act && p.act.until <= s.tick) p.act = null;
    if (!p.connected || s.phase.k === "ended" || (p.dx === 0 && p.dy === 0)) continue;
    p.x = Math.max(0, Math.min(s.w - 1, p.x + p.dx * PLAYER_SPEED * dt));
    p.y = Math.max(0, Math.min(s.w - 1, p.y + p.dy * PLAYER_SPEED * dt));
    p.facing = facingTo(p.dx, p.dy, p.facing);
  }
  if (s.phase.k === "transition") {
    if (s.tick >= s.phase.until) nextStage(s, ch);
    return;
  }
  if (s.phase.k === "ended") return;
  if (s.tick % PACES[s.pace].econEvery === 0) economy(s, ch);
}

const setStatus = (b: Building, status: string, ch: Changes): void => {
  if (b.status !== status) {
    b.status = status;
    ch.buildings.add(b.id);
  }
};

const ring = (s: RoomState, b: Building): number[] => {
  const n = BUILDINGS[b.type].size;
  const out: number[] = [];
  for (let y = b.y - 1; y <= b.y + n; y++)
    for (let x = b.x - 1; x <= b.x + n; x++) {
      if (x >= b.x && x < b.x + n && y >= b.y && y < b.y + n) continue;
      if (inBounds(s, x, y)) out.push(y * s.w + x);
    }
  return out;
};

const within = (s: RoomState, b: Building, radius: number): number[] => {
  const [cx, cy] = centre(b);
  const out: number[] = [];
  for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++)
    for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++)
      if (inBounds(s, x, y) && Math.max(Math.abs(x - cx), Math.abs(y - cy)) <= radius + 0.5) out.push(y * s.w + x);
  return out;
};

function economy(s: RoomState, ch: Changes): void {
  s.econTicks++;
  const st = STAGES[s.stage];
  const built = s.buildings.filter(complete);
  for (const b of s.buildings) if (!complete(b)) {
    b.work = Math.min(BUILDINGS[b.type].build * 10, b.work + 10);
    ch.buildings.add(b.id);
    // a finished building earns its real status on the next tick, not a free one now
    if (complete(b)) setStatus(b, "starting up", ch);
  }
  const of = (t: BuildingType): Building[] => built.filter((b) => b.type === t);
  const plazaTiles = new Set(of("plaza").flatMap((b) => ring(s, b)));

  // workers: cities house 2, or 5 when served last tick, +1 beside a plaza
  let workers = 0;
  for (const city of of("city")) {
    const served = city.status === "ok";
    const byPlaza = footprint(city).some(([x, y]) => plazaTiles.has(y * s.w + x));
    workers += 2 + (served ? 3 : 0) + (byPlaza ? 1 : 0);
  }
  const workersSupply = workers;

  // energy
  let energy = 0;
  for (const f of of("furnace")) {
    if (workers < 1) setStatus(f, "idle: no workers (build homes)", ch);
    else if (s.inventory.matter < 1) setStatus(f, `idle: no ${st.families.matter.label} to burn`, ch);
    else {
      workers--;
      s.inventory.matter--;
      energy += BUILDINGS.furnace.energy;
      setStatus(f, "ok", ch);
    }
  }
  for (const p of of("solar")) {
    energy += BUILDINGS.solar.energy * st.solarScale;
    setStatus(p, "ok", ch);
  }
  if (st.energySource === "bottled") energy = s.reserve;
  const energySupply = st.energySource === "bottled" ? s.reserve : energy;

  let compute = 0;
  for (const e of of("engine")) {
    compute += BUILDINGS.engine.compute;
    setStatus(e, "ok", ch);
  }

  const take = (b: Building, opts: { pressure?: Set<number>; network?: Set<number> } = {}): boolean => {
    const def = BUILDINGS[b.type];
    let why: string | null = null;
    if (opts.pressure && !footprint(b).some(([x, y]) => opts.pressure!.has(y * s.w + x))) why = "idle: outside a dome's air";
    else if (opts.network && !opts.network.has(b.id)) why = "idle: not linked to the Depot (build relays)";
    else if (energy < -def.energy) why = st.energySource === "bottled" ? "idle: the Bottled Sun is empty" : "idle: no power";
    else if (workers < -def.workers) why = "idle: no workers (build homes)";
    else if (compute < -def.compute) why = "idle: no compute (build a datacentre)";
    else if ((def.coolantUse ?? 0) > s.inventory.coolant) why = `idle: no ${st.families.coolant.label} for cooling`;
    if (why) {
      setStatus(b, why, ch);
      return false;
    }
    energy += Math.min(0, def.energy);
    workers += Math.min(0, def.workers);
    compute += Math.min(0, def.compute);
    s.inventory.coolant -= def.coolantUse ?? 0;
    setStatus(b, "ok", ch);
    return true;
  };

  // Mars: air comes from domes
  let pressure: Set<number> | undefined;
  if (st.mechanic === "pressure") {
    pressure = new Set();
    for (const h of of("habitat")) if (take(h)) for (const i of within(s, h, BUILDINGS.habitat.pressureRadius!)) pressure.add(i);
  }
  // Solar System: relays link to the depot
  let network: Set<number> | undefined;
  if (st.mechanic === "relay") {
    const nodes = [...of("depot"), ...of("relay").filter((r) => take(r))];
    network = new Set();
    const linked: Building[] = nodes.filter((n) => n.type === "depot");
    for (const n of linked) network.add(n.id);
    for (let i = 0; i < linked.length; i++) {
      const [ax, ay] = centre(linked[i]);
      const range = BUILDINGS[linked[i].type].relayRange!;
      for (const b of built) {
        if (network.has(b.id)) continue;
        const [bx, by] = centre(b);
        if (Math.max(Math.abs(ax - bx), Math.abs(ay - by)) <= range) {
          network.add(b.id);
          if (b.type === "relay" && b.status === "ok") linked.push(b);
        }
      }
    }
  }

  for (const d of of("datacentre")) if (take(d, { pressure })) compute += BUILDINGS.datacentre.compute;
  const computeSupply = compute;
  for (const r of of("radiator")) take(r);

  const throttled = st.mechanic === "heat" && s.heat >= HEAT_LIMIT;
  let heat = 0;
  for (const x of of("extractor")) {
    if (!take(x, { pressure, network })) continue;
    heat += BUILDINGS.extractor.heat ?? 0;
    if (throttled && s.econTicks % 2 === 0) {
      setStatus(x, "throttled: too hot (build radiators)", ch);
      continue;
    }
    const targets = ring(s, x).filter((i) => s.tiles[i].d && s.tiles[i].amt > 0);
    if (targets.length === 0) {
      setStatus(x, "idle: nothing left to harvest beside it", ch);
      continue;
    }
    targets.sort((a, b) => s.tiles[b].amt - s.tiles[a].amt);
    takeFrom(s, targets[0], BUILDINGS.extractor.extract!, ch);
  }
  for (const city of of("city")) {
    const def = BUILDINGS.city;
    if (energy >= -def.energy && compute >= -def.compute) {
      energy += def.energy;
      compute += def.compute;
      setStatus(city, "ok", ch);
    } else setStatus(city, energy < -def.energy ? "unserved: no power (houses fewer)" : "unserved: no compute (houses fewer)", ch);
  }
  for (const p of of("plaza")) setStatus(p, "ok", ch);

  if (st.energySource === "bottled") s.reserve = Math.max(0, energy);

  // the Sun: heat builds with collectors and computation, radiators shed it
  if (st.mechanic === "heat") {
    for (const b of built) if (b.status === "ok" && b.type !== "extractor") heat += BUILDINGS[b.type].heat ?? 0;
    heat += of("solar").length * 4;
    for (const r of of("radiator")) if (r.status === "ok") heat -= BUILDINGS.radiator.cooling!;
    const next = Math.max(0, Math.min(100, s.heat + heat - 2));
    if (next !== s.heat) ch.meta = true;
    s.heat = next;
  }

  // pollution: smoke browns the land and burns groves; extraction scars around it
  for (const b of built) {
    const pol = BUILDINGS[b.type].pollution;
    if (!pol || b.status !== "ok") continue;
    for (const i of within(s, b, pol.radius)) {
      const t = s.tiles[i];
      if (t.t === 2 || t.life === 0) continue;
      t.life = Math.max(0, t.life - pol.amount);
      ch.tiles.add(i);
    }
    if (pol.burnsMatter) {
      const grove = within(s, b, pol.radius).find((i) => s.tiles[i].d === "matter" && s.tiles[i].amt > 0);
      if (grove !== undefined) {
        const t = s.tiles[grove];
        const burnt = Math.min(pol.burnsMatter, t.amt);
        t.amt -= burnt;
        s.ledger.matter.remaining -= burnt;
        s.ledger.matter.destroyed += burnt;
        t.life = Math.min(t.life, Math.round((t.amt / t.init) * 60));
        ch.tiles.add(grove);
        if (t.amt === 0) remember(s, t, "burnt away in the smoke", ch);
      }
    }
  }

  const econ = {
    energySupply,
    energyUsed: energySupply - Math.max(0, energy),
    computeSupply,
    computeUsed: computeSupply - compute,
    workersSupply,
    workersUsed: workersSupply - workers,
  };
  if (JSON.stringify(econ) !== JSON.stringify(s.econ)) ch.meta = true;
  s.econ = econ;
  checkExhausted(s, ch);
}

/** Total across families; used by tests and the HUD. */
export const totalRemaining = (s: RoomState): number => FAMILIES.reduce((a, f) => a + s.ledger[f].remaining, 0);

/** initial = remaining + extracted + destroyed, per family, and remaining matches the tiles. */
export function ledgerHolds(s: RoomState): boolean {
  for (const f of FAMILIES) {
    const l = s.ledger[f];
    const onTiles = s.tiles.reduce((a, t) => a + (t.d === f ? t.amt : 0), 0);
    if (l.initial !== l.remaining + l.extracted + l.destroyed || onTiles !== l.remaining) return false;
  }
  return true;
}

export const bundleOk = (b: Bundle): boolean => FAMILIES.every((f) => Number.isSafeInteger(b[f]) && b[f] >= 0);
export type { Family };
