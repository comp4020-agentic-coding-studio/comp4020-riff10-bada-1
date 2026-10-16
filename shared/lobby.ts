// The Green Lobby: server-run environmental agents who walk the map and put
// stock back into harvested deposits from a finite, per-family seed bank,
// and picket datacentre sites. Every unit they plant is recorded as
// `restored` in the ledger, so initial + restored = remaining + extracted +
// destroyed, and restored can never exceed the bank they started with.
import { BUILDINGS, FAMILIES, LOBBY, STAGES, TICK_MS, buildingName, type Bundle, type Family } from "./content.ts";
import type { Building, Ledger, Lobby, Lobbyist, RoomState } from "./protocol.ts";
import { bankTotal, complete, event, isIdle, log, type Changes } from "./world.ts";

export function newLobby(stage: number, ledger: Ledger): Lobby {
  const share = LOBBY.bankShare[STAGES[stage].id] ?? {};
  const bank = Object.fromEntries(FAMILIES.map((f) => [f, Math.floor((share[f] ?? 0) * ledger[f].initial)])) as Bundle;
  return { bank, bankStart: { ...bank }, agents: [], next: 1 };
}

const hashInt = (n: number): number => {
  let h = (n * 374761393) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
};

/** How many lobbyists the room has earned: a few at first, more per running factory and per datacentre. */
export function lobbyTarget(s: RoomState): number {
  if (bankTotal(s.lobby.bank) === 0) return 0;
  const factories = s.buildings.filter((b) => b.type === "factory" && complete(b) && !isIdle(b)).length;
  const dcs = s.buildings.filter((b) => b.type === "datacentre" && b.owner).length;
  return Math.min(LOBBY.max, LOBBY.base + LOBBY.perFactory * factories + LOBBY.perDatacentre * dcs);
}

const placeName = (s: RoomState, i: number): string => {
  const t = s.tiles[i];
  const kind = LOBBY.places[t.d as Family];
  const named = t.mark?.name ?? t.was;
  return named ? `${named}'s ${kind}` : `a ${kind}`;
};

function say(s: RoomState, a: Lobbyist, text: string): void {
  a.say = text;
  a.sayUntil = s.tick + 40;
}

/** Movement: every server tick, so every browser sees the same lobbyist in the same place. */
export function lobbyMove(s: RoomState, ch: Changes): void {
  const step = (LOBBY.speed * TICK_MS) / 1000;
  for (const a of s.lobby.agents) {
    if (a.say && (a.sayUntil ?? 0) <= s.tick) {
      delete a.say;
      delete a.sayUntil;
      ch.lobby = true;
    }
    const goal = a.task.k === "walk" || a.task.k === "picket" ? [a.task.x, a.task.y] : null;
    if (!goal) continue;
    const dx = goal[0] - a.x;
    const dy = goal[1] - a.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.05) continue;
    const k = Math.min(1, step / d);
    a.x = Math.round((a.x + dx * k) * 100) / 100;
    a.y = Math.round((a.y + dy * k) * 100) / 100;
    ch.lobby = true;
  }
}

const at = (a: Lobbyist, x: number, y: number): boolean => Math.hypot(a.x - x, a.y - y) < 0.3;

/** A free tile beside a building, for a picket line. */
function besideSite(s: RoomState, b: Building, k: number): [number, number] {
  const n = BUILDINGS[b.type].size;
  const spots: [number, number][] = [];
  for (let i = 0; i < n; i++) spots.push([b.x + i, b.y + n], [b.x + n, b.y + i], [b.x + i, b.y - 1], [b.x - 1, b.y + i]);
  const ok = spots.filter(([x, y]) => x >= 0 && y >= 0 && x < s.w && y < s.w);
  return ok[k % ok.length] ?? [b.x, b.y];
}

/** Economy-tick decisions: arrive, plant, picket, and choose what to do next. */
export function lobbyAct(s: RoomState, ch: Changes): void {
  const L = s.lobby;
  const st = STAGES[s.stage];
  const target = lobbyTarget(s);
  // arrivals walk in from the island's edge
  while (L.agents.length < target) {
    const id = L.next++;
    const h = hashInt(s.seed + id * 31);
    const name = LOBBY.names[(id - 1) % LOBBY.names.length];
    const edge = h % 4;
    const along = (h >>> 3) % s.w;
    const [x, y] = edge === 0 ? [along, 0] : edge === 1 ? [s.w - 1, along] : edge === 2 ? [along, s.w - 1] : [0, along];
    const a: Lobbyist = { id, name, sign: LOBBY.signs[(h >>> 7) % LOBBY.signs.length], x, y, task: { k: "idle" } };
    L.agents.push(a);
    log(s, ch, `${name} of the Green Lobby arrived on ${st.name}.`);
    event(ch, `lobby:${name}`, name, "lobby_arrive", { x, y });
    ch.lobby = true;
  }
  if (bankTotal(L.bank) === 0 && L.agents.length) {
    // the seed bank is spent: they go home and say so once
    if (!L.spent) {
      L.spent = true;
      log(s, ch, "The Green Lobby's seed bank is empty. They pack up their signs and go home.");
      event(ch, "lobby", "Green Lobby", "lobby_bank_empty");
    }
    L.agents = [];
    ch.lobby = true;
    ch.meta = true;
    return;
  }
  const taken = new Set<number>();
  const picketed = new Set<number>();
  for (const a of L.agents) {
    if (a.task.k === "plant") taken.add(a.task.i);
    if (a.task.k === "walk" && a.task.i !== undefined) taken.add(a.task.i);
    if (a.task.k === "picket") picketed.add(a.task.b);
  }

  for (const a of L.agents) {
    const task = a.task;
    if (task.k === "walk") {
      if (!at(a, task.x, task.y)) continue;
      if (task.i !== undefined) a.task = { k: "plant", i: task.i, got: 0 };
      else a.task = { k: "idle" };
      ch.lobby = true;
    }
    if (a.task.k === "plant") {
      const p = a.task;
      const t = s.tiles[p.i];
      const f = t.d;
      const room = f && !t.b ? Math.min(LOBBY.plant, L.bank[f], t.init - t.amt, LOBBY.visit - p.got) : 0;
      if (f && room > 0) {
        t.amt += room;
        L.bank[f] -= room;
        s.ledger[f].restored += room;
        s.ledger[f].remaining += room;
        t.life = Math.min(100, Math.max(t.life, Math.round((t.amt / t.init) * 60)) + 6);
        p.got += room;
        ch.tiles.add(p.i);
        ch.meta = true;
      }
      if (!f || room <= 0 || p.got >= LOBBY.visit || t.amt >= t.init) {
        if (p.got > 0 && f) {
          const where = placeName(s, p.i);
          const verb = f === "matter" ? "replanted" : f === "coolant" ? "refilled" : "backfilled";
          log(s, ch, `${a.name} ${verb} ${where} (+${p.got}).`);
          event(ch, `lobby:${a.name}`, a.name, "lobby_restore", { family: f, amount: p.got, x: p.i % s.w, y: Math.floor(p.i / s.w), bank_left: L.bank[f] });
          if (hashInt(s.tick + a.id) % 3 === 0) say(s, a, LOBBY.shouts[hashInt(a.id + s.tick) % LOBBY.shouts.length]);
        }
        a.task = { k: "idle" };
      }
      ch.lobby = true;
      continue;
    }
    if (a.task.k === "picket") {
      const b = s.buildings.find((q) => q.id === (a.task as { b: number }).b);
      if (!b || complete(b) || (b.picket ?? 0) >= LOBBY.picketTicks) {
        if (b && !complete(b)) {
          log(s, ch, `${a.name} gave up picketing the ${buildingName(st, b.type)}.`);
          event(ch, `lobby:${a.name}`, a.name, "lobby_picket_end", { building: b.id });
        }
        a.task = { k: "idle" };
        ch.lobby = true;
      }
      continue;
    }
    // idle: picket a datacentre site that still has protest left in it, else replant
    const site = s.buildings
      .filter((b) => b.type === "datacentre" && !complete(b) && (b.picket ?? 0) < LOBBY.picketTicks && !picketed.has(b.id))
      .sort((p, q) => p.id - q.id)[0];
    if (site) {
      const [x, y] = besideSite(s, site, a.id);
      a.task = { k: "picket", b: site.id, x, y };
      picketed.add(site.id);
      say(s, a, LOBBY.shouts[a.id % LOBBY.shouts.length]);
      log(s, ch, `${a.name} is picketing the ${buildingName(st, site.type)} site: "${a.sign}".`);
      event(ch, `lobby:${a.name}`, a.name, "lobby_picket", { building: site.id, owner: site.owner ?? "", x: site.x, y: site.y });
      ch.lobby = true;
      continue;
    }
    let best = -1;
    let score = Infinity;
    s.tiles.forEach((t, i) => {
      if (!t.d || t.b || t.amt >= t.init || L.bank[t.d] <= 0 || taken.has(i)) return;
      // the most harvested-down nearby place first
      const v = Math.hypot((i % s.w) - a.x, Math.floor(i / s.w) - a.y) - (1 - t.amt / t.init) * 6;
      if (v < score) [score, best] = [v, i];
    });
    if (best >= 0) {
      taken.add(best);
      a.task = { k: "walk", x: best % s.w, y: Math.floor(best / s.w), i: best };
      ch.lobby = true;
    }
  }
}

/** Is anyone picketing this site right now (standing beside it)? */
export const picketing = (s: RoomState, b: Building): boolean =>
  s.lobby.agents.some((a) => a.task.k === "picket" && a.task.b === b.id && at(a, a.task.x, a.task.y));
