import { describe, expect, it } from "vitest";
import { BUILDINGS, CLAIM_SIZE, FAMILIES, LOBBY, PACES, PIPE_LEAK_EVERY, STAGES, type BuildingType, type Pace } from "../shared/content.ts";
import type { Building, Command, LedgerEntry, RoomState, StageSummary } from "../shared/protocol.ts";
import { DIRS, claimAt, dirTo, footprint, routeBetween, touching } from "../shared/layout.ts";
import { applyCommand, bundleOk, claimProblem, createRoom, goodsOk, join, leave, ledgerHolds, newChanges, placementProblem, tick, totalRemaining, type Changes } from "../shared/sim.ts";
import { complete } from "../shared/world.ts";
import { decide, newMemory, type Strategy } from "../scripts/brain.ts";

// The authoritative simulation, exercised directly: no browser, no socket.

let n = 0;
const id = (): string => `c${n++}`;

function room(pace: "normal" | "rapid" = "rapid", players = ["a"]): { s: RoomState; ch: Changes } {
  const s = createRoom("TESTS", 7, pace);
  const ch = newChanges();
  for (const p of players) join(s, p, `tok-${p}`, p.toUpperCase(), ch);
  return { s, ch };
}

const depositIdx = (s: RoomState): number => s.tiles.findIndex((t) => t.d && t.amt > 0);
const at = (s: RoomState, i: number): [number, number] => [i % s.w, Math.floor(i / s.w)];
const freeTile = (s: RoomState, size = 1): [number, number] => {
  const p = Object.values(s.players)[0];
  for (let r = 1; r < s.w; r++)
    for (let y = Math.round(p.y) - r; y <= Math.round(p.y) + r; y++)
      for (let x = Math.round(p.x) - r; x <= Math.round(p.x) + r; x++) {
        let ok = true;
        for (let dy = 0; dy < size && ok; dy++)
          for (let dx = 0; dx < size && ok; dx++) {
            const t = s.tiles[(y + dy) * s.w + x + dx];
            if (x + dx < 0 || y + dy < 0 || x + dx >= s.w || y + dy >= s.w || !t || t.d || t.b || t.t !== 0) ok = false;
          }
        if (ok) return [x, y];
      }
  throw new Error("no free tile");
};
/** Lay a cable between two buildings, standing at its midpoint. */
function cable(s: RoomState, ch: Changes, pid: string, a: Building, b: Building, kind: "cable" | "pipe" = "cable"): void {
  const free = (q: Building): number[] => touching(s, q).filter((i) => !s.tiles[i].b);
  const path = routeBetween(s, kind, free(a), new Set(free(b)), pid);
  expect(path).not.toBeNull();
  const [mx, my] = path![Math.floor(path!.length / 2)];
  stand(s, pid, mx, my);
  expect(applyCommand(s, pid, id(), s.gen, { k: "line", kind, q: 0, path: path! }, ch)).toEqual({ ok: true });
}
const stand = (s: RoomState, pid: string, x: number, y: number): void => {
  s.players[pid].x = x;
  s.players[pid].y = y;
};

/** A bot that only ever harvests by hand: the path that must always finish a stage. */
function harvestBot(s: RoomState, ch: Changes, pid: string): void {
  const p = s.players[pid];
  let best = -1;
  let bd = Infinity;
  s.tiles.forEach((t, i) => {
    if (!t.d || t.amt <= 0) return;
    const d = Math.hypot((i % s.w) - p.x, Math.floor(i / s.w) - p.y);
    if (d < bd) [bd, best] = [d, i];
  });
  if (best < 0) return;
  const [x, y] = at(s, best);
  if (bd > 1.5) applyCommand(s, pid, id(), s.gen, { k: "move", dx: x - p.x, dy: y - p.y }, ch);
  else {
    applyCommand(s, pid, id(), s.gen, { k: "move", dx: 0, dy: 0 }, ch);
    applyCommand(s, pid, id(), s.gen, { k: "harvest", x, y }, ch);
  }
}

describe("resource accounting", () => {
  it("keeps initial = remaining + extracted + destroyed through a whole campaign, and reaches the ending", () => {
    const { s, ch } = room("rapid", ["a", "b"]);
    const boundaries: number[] = [];
    while (s.phase.k !== "ended" && s.tick < 100_000) {
      if (s.phase.k === "play") {
        harvestBot(s, ch, "a");
        harvestBot(s, ch, "b");
      }
      const before = s.gen;
      tick(s, ch);
      if (s.gen !== before) boundaries.push(s.gen);
      expect(ledgerHolds(s)).toBe(true);
      expect(bundleOk(s.inventory)).toBe(true);
    }
    expect(s.phase.k).toBe("ended");
    // exactly one transition per exhausted stage
    expect(boundaries).toEqual([2, 3, 4, 5]);
    expect(s.history.map((h) => h.stage)).toEqual(STAGES.map((st) => st.id));
    for (const h of s.history) for (const f of FAMILIES) expect(h.ledger[f].remaining).toBe(0);
  });

  it("charges a building's cost once and salvages strictly less than it", () => {
    const { s, ch } = room();
    s.inventory = { matter: 100, mineral: 100, coolant: 100 };
    const [x, y] = freeTile(s, 2);
    expect(applyCommand(s, "a", id(), s.gen, { k: "build", x, y, type: "city" }, ch)).toEqual({ ok: true });
    expect(s.inventory.matter).toBe(100 - BUILDINGS.city.cost.matter!);
    expect(applyCommand(s, "a", id(), s.gen, { k: "demolish", x, y }, ch)).toEqual({ ok: true });
    expect(s.inventory.matter).toBeLessThan(100);
    expect(s.inventory.mineral).toBeLessThan(100);
  });

  it("never lets a furnace's smoke make stock vanish off the books", () => {
    const { s, ch } = room("rapid");
    s.inventory = { matter: 200, mineral: 200, coolant: 0 };
    const grove = s.tiles.findIndex((t) => t.d === "matter");
    const [gx, gy] = at(s, grove);
    // find a free tile within two of the grove for the furnace
    let spot: [number, number] | null = null;
    for (let dy = -2; dy <= 2 && !spot; dy++)
      for (let dx = -2; dx <= 2 && !spot; dx++) {
        const t = s.tiles[(gy + dy) * s.w + gx + dx];
        if (t && !t.d && !t.b && t.t === 0) spot = [gx + dx, gy + dy];
      }
    expect(spot).not.toBeNull();
    stand(s, "a", spot![0], spot![1]);
    expect(applyCommand(s, "a", id(), s.gen, { k: "build", x: spot![0], y: spot![1], type: "furnace" }, ch).ok).toBe(true);
    const [cx, cy] = freeTile(s, 2);
    expect(applyCommand(s, "a", id(), s.gen, { k: "build", x: cx, y: cy, type: "city" }, ch).ok).toBe(true);
    for (let i = 0; i < 60; i++) tick(s, ch);
    // a furnace burns only for a grid that needs it: cable it to the homes
    cable(s, ch, "a", s.buildings.find((b) => b.type === "furnace")!, s.buildings.find((b) => b.type === "city")!);
    for (let i = 0; i < 200; i++) tick(s, ch);
    expect(s.ledger.matter.destroyed).toBeGreaterThan(0);
    expect(ledgerHolds(s)).toBe(true);
  });
});

describe("conflicts resolve to one outcome", () => {
  it("two players placing on the same tile: one building, one charge", () => {
    const { s, ch } = room("rapid", ["a", "b"]);
    s.inventory = { matter: 100, mineral: 100, coolant: 100 };
    const [x, y] = freeTile(s, 2);
    stand(s, "b", s.players.a.x, s.players.a.y);
    const r1 = applyCommand(s, "a", id(), s.gen, { k: "build", x, y, type: "city" }, ch);
    const r2 = applyCommand(s, "b", id(), s.gen, { k: "build", x, y, type: "plaza" }, ch);
    expect(r1.ok).toBe(true);
    expect(r2).toEqual({ ok: false, reason: "something is already built here" });
    expect(s.buildings.filter((b) => b.owner)).toHaveLength(1);
    expect(s.inventory.matter).toBe(100 - BUILDINGS.city.cost.matter!);
  });

  it("two players spending the same shared balance: the second is refused, nothing goes negative", () => {
    const { s, ch } = room("rapid", ["a", "b"]);
    s.inventory = { matter: 12, mineral: 6, coolant: 0 }; // exactly one city
    const [x, y] = freeTile(s, 2);
    stand(s, "b", s.players.a.x, s.players.a.y);
    expect(applyCommand(s, "a", id(), s.gen, { k: "build", x, y, type: "city" }, ch).ok).toBe(true);
    const [x2, y2] = freeTile(s, 2);
    const r = applyCommand(s, "b", id(), s.gen, { k: "build", x: x2, y: y2, type: "city" }, ch);
    expect(r.ok).toBe(false);
    expect(bundleOk(s.inventory)).toBe(true);
  });

  it("two players harvesting the last unit: one gets it, and the stage ends exactly once", () => {
    const { s, ch } = room("normal", ["a", "b"]);
    const last = depositIdx(s);
    s.tiles.forEach((t, i) => {
      if (t.d && i !== last) {
        s.ledger[t.d].remaining -= t.amt;
        s.ledger[t.d].extracted += t.amt;
        t.amt = 0;
      }
    });
    const t = s.tiles[last];
    s.ledger[t.d!].remaining -= t.amt - 1;
    s.ledger[t.d!].extracted += t.amt - 1;
    t.amt = 1;
    expect(ledgerHolds(s)).toBe(true);
    const [x, y] = at(s, last);
    stand(s, "a", x, y);
    stand(s, "b", x, y);
    const r1 = applyCommand(s, "a", id(), s.gen, { k: "harvest", x, y }, ch);
    const r2 = applyCommand(s, "b", id(), s.gen, { k: "harvest", x, y }, ch);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(false);
    expect(s.history).toHaveLength(1);
    expect(s.phase.k).toBe("transition");
  });
});

describe("commands", () => {
  it("applies a retried command id once", () => {
    const { s, ch } = room("normal");
    const i = depositIdx(s);
    const [x, y] = at(s, i);
    stand(s, "a", x, y);
    const before = s.tiles[i].amt;
    applyCommand(s, "a", "same", s.gen, { k: "harvest", x, y }, ch);
    s.players.a.nextHarvest = 0;
    expect(applyCommand(s, "a", "same", s.gen, { k: "harvest", x, y }, ch)).toEqual({ ok: true });
    expect(s.tiles[i].amt).toBe(before - 1);
  });

  it("receipts only applied commands, so a refused one can be retried for real", () => {
    const { s, ch } = room("normal");
    const i = depositIdx(s);
    const [x, y] = at(s, i);
    stand(s, "a", x, y);
    const before = s.tiles[i].amt;
    applyCommand(s, "a", "first", s.gen, { k: "harvest", x, y }, ch);
    expect(applyCommand(s, "a", "again", s.gen, { k: "harvest", x, y }, ch)).toEqual({ ok: false, reason: "too fast" });
    s.players.a.nextHarvest = 0;
    expect(applyCommand(s, "a", "again", s.gen, { k: "harvest", x, y }, ch)).toEqual({ ok: true });
    expect(s.tiles[i].amt).toBe(before - 2);
  });

  it("counts seats by who's connected, so departed browsers never fill a room", () => {
    const { s, ch } = room("normal", ["p0", "p1", "p2", "p3", "p4", "p5", "p6", "p7"]);
    expect(join(s, "late", "tok-late", "Late", ch)).toBeNull();
    leave(s, "p3", ch);
    expect(join(s, "late", "tok-late", "Late", ch)).not.toBeNull();
    for (let k = 0; k < 40; k++) {
      leave(s, "late", ch);
      expect(join(s, `v${k}`, `t${k}`, "Visitor", ch)).not.toBeNull();
      leave(s, `v${k}`, ch);
    }
    expect(Object.keys(s.players).length).toBeLessThanOrEqual(32);
    expect(s.players.p0).toBeDefined();
  });

  it("rejects commands addressed to a previous stage", () => {
    const { s, ch } = room();
    const i = depositIdx(s);
    const [x, y] = at(s, i);
    stand(s, "a", x, y);
    expect(applyCommand(s, "a", id(), s.gen - 1, { k: "harvest", x, y }, ch).ok).toBe(false);
  });

  it("rejects malformed, out-of-range, and unauthorised commands", () => {
    const { s, ch } = room("rapid", ["a", "b"]);
    s.inventory = { matter: 100, mineral: 100, coolant: 100 };
    const bad = (c: unknown, pid = "a"): boolean => applyCommand(s, pid, id(), s.gen, c as never, ch).ok;
    expect(bad({ k: "move", dx: Number.NaN, dy: 0 })).toBe(false);
    expect(bad({ k: "move", dx: Infinity, dy: 0 })).toBe(false);
    expect(bad({ k: "harvest", x: 1.5, y: 2 })).toBe(false);
    expect(bad({ k: "harvest", x: -1, y: 0 })).toBe(false);
    expect(bad({ k: "build", x: 0, y: 0, type: "palace" })).toBe(false);
    expect(bad({ k: "build", x: 0, y: 0, type: "relay" })).toBe(false); // not on Earth
    expect(bad({ k: "emote", e: "<script>" })).toBe(false);
    expect(bad({ k: "teleport" })).toBe(false);
    expect(applyCommand(s, "nobody", id(), s.gen, { k: "emote", e: "wave" }, ch).ok).toBe(false);
    // far away
    const far = s.tiles.findIndex((t, i) => t.d && Math.hypot((i % s.w) - s.players.a.x, Math.floor(i / s.w) - s.players.a.y) > 5);
    expect(bad({ k: "harvest", x: far % s.w, y: Math.floor(far / s.w) })).toBe(false);
    // only the builder or the host takes a building down
    const [x, y] = freeTile(s, 1);
    stand(s, "b", s.players.a.x, s.players.a.y);
    expect(applyCommand(s, "b", id(), s.gen, { k: "build", x, y, type: "plaza" }, ch).ok).toBe(true);
    expect(s.hostId).toBe("a");
    const [x2, y2] = freeTile(s, 1);
    expect(applyCommand(s, "a", id(), s.gen, { k: "build", x: x2, y: y2, type: "plaza" }, ch).ok).toBe(true);
    expect(applyCommand(s, "b", id(), s.gen, { k: "demolish", x: x2, y: y2 }, ch)).toEqual({ ok: false, reason: "only its builder or the host can take this down" });
    expect(applyCommand(s, "a", id(), s.gen, { k: "demolish", x, y }, ch).ok).toBe(true);
  });

  it("never builds on a deposit, so no building can trap stock", () => {
    const { s, ch } = room();
    s.inventory = { matter: 100, mineral: 100, coolant: 100 };
    const i = depositIdx(s);
    const [x, y] = at(s, i);
    stand(s, "a", x, y);
    const r = applyCommand(s, "a", id(), s.gen, { k: "build", x, y, type: "plaza" }, ch);
    expect(r.ok).toBe(false);
  });

  it("lets a spent deposit be built on", () => {
    const { s, ch } = room();
    s.inventory = { matter: 100, mineral: 100, coolant: 100 };
    const i = s.tiles.findIndex((t) => t.d && t.t === 0);
    const [x, y] = at(s, i);
    stand(s, "a", x, y);
    s.ledger[s.tiles[i].d!].extracted += s.tiles[i].amt;
    s.ledger[s.tiles[i].d!].remaining -= s.tiles[i].amt;
    s.tiles[i].amt = 0;
    expect(applyCommand(s, "a", id(), s.gen, { k: "build", x, y, type: "plaza" }, ch)).toEqual({ ok: true });
  });

  it("cleans names: control characters stripped, length capped", () => {
    const { s, ch } = room();
    const [x, y] = freeTile(s, 1);
    applyCommand(s, "a", id(), s.gen, { k: "mark", x, y, name: "  Old\u0000 Oak‮<b>and a very long name indeed</b>" }, ch);
    const name = s.tiles[y * s.w + x].mark?.name ?? "";
    expect(name.length).toBeLessThanOrEqual(24);
    expect(name).not.toMatch(/[\u0000-\u001f]/);
  });
});

describe("the restraint ending", () => {
  const toUniverse = (s: RoomState, ch: Changes): void => {
    while (STAGES[s.stage].id !== "universe" || s.phase.k !== "play") {
      if (s.phase.k === "play") harvestBot(s, ch, "a");
      tick(s, ch);
    }
  };

  it("ends the campaign with stock left only when everyone here agrees, and keeps the books", () => {
    const { s, ch } = room("rapid", ["a", "b"]);
    toUniverse(s, ch);
    expect(applyCommand(s, "a", id(), s.gen, { k: "stop", on: true }, ch)).toEqual({ ok: true });
    expect(s.phase.k).toBe("play");
    // harvesting takes a vote back
    const i = depositIdx(s);
    const [x, y] = at(s, i);
    stand(s, "a", x, y);
    s.players.a.nextHarvest = 0;
    applyCommand(s, "a", id(), s.gen, { k: "harvest", x, y }, ch);
    expect(s.players.a.stop).toBe(false);
    applyCommand(s, "a", id(), s.gen, { k: "stop", on: true }, ch);
    applyCommand(s, "b", id(), s.gen, { k: "stop", on: true }, ch);
    expect(s.phase).toEqual({ k: "ended", how: "restraint" });
    expect(totalRemaining(s)).toBeGreaterThan(0);
    expect(ledgerHolds(s)).toBe(true);
    expect(s.history.at(-1)!.stage).toBe("universe");
  });

  it("never ends because a holdout's connection dropped; someone still here confirms", () => {
    const { s, ch } = room("rapid", ["a", "b"]);
    toUniverse(s, ch);
    applyCommand(s, "a", id(), s.gen, { k: "stop", on: true }, ch);
    leave(s, "b", ch);
    expect(s.phase.k).toBe("play");
    applyCommand(s, "a", id(), s.gen, { k: "stop", on: true }, ch);
    expect(s.phase).toEqual({ k: "ended", how: "restraint" });
  });

  it("isn't offered before the last world", () => {
    const { s, ch } = room();
    expect(applyCommand(s, "a", id(), s.gen, { k: "stop", on: true }, ch).ok).toBe(false);
  });
});

describe("stage transitions", () => {
  const exhaust = (s: RoomState, ch: Changes): void => {
    while (totalRemaining(s) > 0 && s.tick < 50_000) {
      harvestBot(s, ch, "a");
      tick(s, ch);
    }
  };

  it("refuses mutations while the world changes, then admits the next stage's", () => {
    const { s, ch } = room();
    exhaust(s, ch);
    expect(s.phase.k).toBe("transition");
    const i = s.tiles.findIndex((t) => !t.d && !t.b);
    expect(applyCommand(s, "a", id(), s.gen, { k: "mark", x: i % s.w, y: Math.floor(i / s.w), name: "Late" }, ch).ok).toBe(false);
    const gen = s.gen;
    while (s.phase.k === "transition") tick(s, ch);
    expect(s.gen).toBe(gen + 1);
    expect(STAGES[s.stage].id).toBe("mars");
    expect(totalRemaining(s)).toBeGreaterThan(0);
  });

  it("a crash mid-transition recovers to the same single next stage, with no doubled carryover", () => {
    const { s, ch } = room();
    // play through to the Sun's exhaustion so the Bottled Sun carryover is in play
    while (!(STAGES[s.stage].id === "sun" && s.phase.k === "transition")) {
      if (s.phase.k === "play") harvestBot(s, ch, "a");
      tick(s, ch);
    }
    const saved = JSON.stringify(s); // what the server persisted at the boundary
    while (s.phase.k === "transition") tick(s, ch);
    const restored = JSON.parse(saved) as RoomState;
    const ch2 = newChanges();
    while (restored.phase.k === "transition") tick(restored, ch2);
    expect(restored.gen).toBe(s.gen);
    expect(restored.reserve).toBe(s.reserve);
    expect(restored.reserve).toBe(s.history.at(-1)!.ledger.matter.extracted * 4);
    expect(JSON.stringify(restored.tiles)).toBe(JSON.stringify(s.tiles));
    expect(restored.history).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// The factory chain, claims, networks and the Green Lobby (crit 10's brief).

/** A fresh Earth room with plenty in the stockpile, the lobby sent home, and player a standing at the centre. */
function stocked(players = ["a"]): { s: RoomState; ch: Changes } {
  const r = room("rapid", players);
  r.s.inventory = { matter: 500, mineral: 500, coolant: 500 };
  r.s.lobby.bank = { matter: 0, mineral: 0, coolant: 0 };
  r.s.lobby.bankStart = { matter: 0, mineral: 0, coolant: 0 };
  return r;
}
const ok = (r: { ok: boolean }): void => expect(r).toEqual({ ok: true });
const cmd = (s: RoomState, ch: Changes, pid: string, c: Command) => applyCommand(s, pid, id(), s.gen, c, ch);
const econ = (s: RoomState, ch: Changes, n = 1): void => {
  for (let i = 0; i < n * PACES[s.pace].econEvery; i++) tick(s, ch);
};
/** Build and finish a building at a free spot near player a; returns it. */
function put(s: RoomState, ch: Changes, type: BuildingType, pid = "a", eff = false, at?: [number, number]): Building {
  let spot = at;
  if (!spot) {
    try {
      spot = freeTile(s, BUILDINGS[type].size + 2).map((v) => v + 1) as [number, number];
    } catch {
      spot = freeTile(s, BUILDINGS[type].size);
    }
  }
  const [x, y] = spot;
  stand(s, pid, x, y);
  const r = cmd(s, ch, pid, { k: "build", x, y, type, eff });
  expect(r).toEqual({ ok: true });
  const b = s.buildings.find((q) => q.x === x && q.y === y)!;
  b.work = b.need ?? BUILDINGS[type].build * 10;
  return b;
}
/** A powered, staffed factory: homes, a Sun Garden, cables. */
function factoryRoom(): { s: RoomState; ch: Changes; f: Building } {
  const { s, ch } = stocked();
  const home = put(s, ch, "city");
  const sun = put(s, ch, "solar");
  const f = put(s, ch, "factory");
  cable(s, ch, "a", sun, f);
  cable(s, ch, "a", home, f);
  econ(s, ch, 2);
  return { s, ch, f };
}
const claimFor = (s: RoomState, ch: Changes, pid: string): [number, number] => {
  for (let y = 0; y + CLAIM_SIZE <= s.w; y++)
    for (let x = 0; x + CLAIM_SIZE <= s.w; x++) {
      stand(s, pid, x + 1.5, y + 1.5);
      if (claimProblem(s, x, y, s.players[pid]) !== null) continue;
      let clear = true;
      for (let dy = 1; dy <= 2; dy++) for (let dx = 1; dx <= 2; dx++) {
        const t = s.tiles[(y + dy) * s.w + x + dx];
        if (t.t !== 0 || t.b || (t.d && t.amt > 0)) clear = false;
      }
      if (!clear) continue;
      ok(cmd(s, ch, pid, { k: "claim", x, y }));
      return [x, y];
    }
  throw new Error("nowhere to claim");
};

describe("the datacentre is earned", () => {
  it("is refused without goods, outside a claim, and on someone else's claim", () => {
    const { s, ch } = stocked(["a", "b"]);
    const [cx, cy] = claimFor(s, ch, "a");
    stand(s, "a", cx + 1, cy + 1);
    expect(cmd(s, ch, "a", { k: "build", x: cx + 1, y: cy + 1, type: "datacentre" })).toEqual({ ok: false, reason: "needs 6 wire (have 0)" });
    s.goods = { wire: 12, frame: 4, kit: 0 };
    // outside any claim
    const [fx, fy] = freeTile(s, 4);
    const outside = claimAt(s, fx + 1, fy + 1) ? null : [fx + 1, fy + 1];
    if (outside) {
      stand(s, "a", outside[0], outside[1]);
      expect(cmd(s, ch, "a", { k: "build", x: outside[0], y: outside[1], type: "datacentre" }).ok).toBe(false);
      expect(placementProblem(s, "datacentre", outside[0], outside[1], s.players.a)).toMatch(/claim this ground first/);
    }
    // someone else's
    stand(s, "b", cx + 1, cy + 1);
    expect(cmd(s, ch, "b", { k: "build", x: cx + 1, y: cy + 1, type: "datacentre" })).toEqual({ ok: false, reason: "that's A's land" });
    // the owner, with the parts
    stand(s, "a", cx + 1, cy + 1);
    ok(cmd(s, ch, "a", { k: "build", x: cx + 1, y: cy + 1, type: "datacentre" }));
    expect(s.goods).toMatchObject({ wire: 6, frame: 2 });
  });

  it("is reachable on every world from the starter crate, with no compute and no goods to begin with", () => {
    for (let stage = 0; stage < STAGES.length; stage++) {
      const s = createRoom("BOOTS", 11, "rapid");
      const ch = newChanges();
      join(s, "a", "t", "A", ch);
      join(s, "b", "t2", "B", ch);
      while (s.stage < stage) {
        for (const t of s.tiles) if (t.d && t.amt) {
          s.ledger[t.d].remaining -= t.amt;
          s.ledger[t.d].extracted += t.amt;
          t.amt = 0;
        }
        tick(s, ch);
        while (s.phase.k === "transition") tick(s, ch);
      }
      if (STAGES[stage].energySource === "bottled") s.reserve = 1500;
      expect(s.goods).toEqual({ wire: 0, frame: 0, kit: 0 });
      expect(s.econ.computeSupply).toBe(0);
      const mem = { a: newMemory(), b: newMemory() };
      while (s.stage === stage && s.phase.k === "play" && !s.buildings.some((b) => b.type === "datacentre" && b.owner && complete(b)) && s.tick < 30_000) {
        if (s.tick % 8 === 0) for (const pid of ["a", "b"] as const) for (const c of decide(s, pid, "rush", mem[pid])) applyCommand(s, pid, id(), s.gen, c, ch);
        tick(s, ch);
        expect(ledgerHolds(s)).toBe(true);
      }
      const where = `${STAGES[stage].id}`;
      expect(s.buildings.some((b) => b.type === "factory" && complete(b)), where).toBe(true);
      expect(s.buildings.some((b) => b.type === "datacentre" && b.owner && complete(b)), where).toBe(true);
    }
  });
});

describe("factories", () => {
  it("turn ore into wire from their own input buffer, and the natural ledger doesn't move", () => {
    const { s, ch, f } = factoryRoom();
    const before = structuredClone(s.ledger);
    const ore = s.inventory.mineral;
    stand(s, "a", f.x, f.y);
    ok(cmd(s, ch, "a", { k: "set", x: f.x, y: f.y, recipe: "wire" }));
    ok(cmd(s, ch, "a", { k: "tend", x: f.x, y: f.y }));
    expect(s.inventory.mineral).toBe(ore - f.buf!.mineral!);
    econ(s, ch, 1);
    expect(f.status).toBe("making wire");
    econ(s, ch, 3);
    expect(f.out!.wire).toBeGreaterThan(0);
    ok(cmd(s, ch, "a", { k: "tend", x: f.x, y: f.y }));
    expect(s.goods.wire).toBeGreaterThan(0);
    expect(s.ledger).toEqual(before);
    expect(ledgerHolds(s)).toBe(true);
  });

  it("consume exactly their recipe, and switching, reconnecting or a save/load never duplicates a batch", () => {
    const { s, ch, f } = factoryRoom();
    stand(s, "a", f.x, f.y);
    ok(cmd(s, ch, "a", { k: "set", x: f.x, y: f.y, recipe: "frame" }));
    f.buf = { mineral: 4, matter: 3 };
    econ(s, ch, 1);
    expect(f.job).toMatchObject({ r: "frame", n: 1 });
    expect(f.buf).toMatchObject({ mineral: 0, matter: 0 });
    // switch mid-batch: the committed batch finishes as started, nothing refunded or doubled
    ok(cmd(s, ch, "a", { k: "set", x: f.x, y: f.y, recipe: "wire" }));
    leave(s, "a", ch);
    join(s, "a", "tok-a", "A", ch);
    const saved = JSON.parse(JSON.stringify(s)) as RoomState;
    econ(s, ch, 3);
    econ(saved, newChanges(), 3);
    for (const r of [s, saved]) {
      const g = r.buildings.find((q) => q.id === f.id)!;
      expect((g.out!.frame ?? 0) + r.goods.frame).toBe(1);
      expect(g.out!.wire ?? 0).toBe(0);
    }
  });

  it("say what they're missing: inputs, power, and a full output", () => {
    const { s, ch, f } = factoryRoom();
    econ(s, ch, 1);
    expect(f.status).toMatch(/^idle: no metal ore/);
    f.buf = { mineral: 12 };
    f.out = { wire: 12 };
    f.recipe = "wire";
    econ(s, ch, 1);
    expect(f.status).toMatch(/output full/);
    f.out = {};
    const cableTiles = s.tiles.map((t, i) => (t.cb ? i : -1)).filter((i) => i >= 0);
    for (const i of cableTiles) delete s.tiles[i].cb;
    econ(s, ch, 1);
    expect(f.status).toMatch(/no power: not cabled/);
  });

  it("with a kit, make more parts from the same ore than without, more slowly", () => {
    const run = (kit: boolean): { wire: number; ticks: number } => {
      const { s, ch, f } = factoryRoom();
      f.kit = kit;
      f.recipe = "wire";
      f.buf = { mineral: 12 };
      let n = 0;
      while ((f.buf.mineral ?? 0) >= 3 || f.job) {
        econ(s, ch, 1);
        n++;
      }
      return { wire: f.out!.wire ?? 0, ticks: n };
    };
    const quick = run(false);
    const eff = run(true);
    expect(eff.wire).toBeGreaterThan(quick.wire);
    expect(eff.ticks).toBeGreaterThan(quick.ticks);
  });
});

describe("claims", () => {
  it("never block walking or a hand harvest, and never capture someone else's building", () => {
    const { s, ch } = stocked(["a", "b"]);
    // b's building first; a's claim can't swallow it
    const plaza = put(s, ch, "plaza", "b");
    stand(s, "a", plaza.x, plaza.y);
    expect(claimProblem(s, plaza.x - 1, plaza.y - 1, s.players.a)).toMatch(/B's: claim around it/);
    // a claim over a deposit: b still harvests it
    const dep = s.tiles.findIndex((t, i) => t.d && t.amt > 0 && t.t === 0 && i % s.w > 1 && i % s.w < s.w - 3 && Math.floor(i / s.w) > 1 && Math.floor(i / s.w) < s.w - 3);
    const [dx, dy] = at(s, dep);
    stand(s, "a", dx, dy);
    let claimed = false;
    for (const [ox, oy] of [[1, 1], [0, 0], [2, 2], [1, 0], [0, 1]]) if (!claimed && !claimProblem(s, dx - ox, dy - oy, s.players.a)) {
      ok(cmd(s, ch, "a", { k: "claim", x: dx - ox, y: dy - oy }));
      claimed = true;
    }
    expect(claimed).toBe(true);
    stand(s, "b", dx, dy);
    const amt = s.tiles[dep].amt;
    ok(cmd(s, ch, "b", { k: "harvest", x: dx, y: dy }));
    expect(s.tiles[dep].amt).toBeLessThan(amt);
    // and walking across it is just walking
    s.players.b.x = dx;
    s.players.b.y = dy;
    ok(cmd(s, ch, "b", { k: "move", dx: 1, dy: 0 }));
    tick(s, ch);
    expect(s.players.b.x).toBeGreaterThan(dx);
    // but b can't build on it; the host can give it up
    s.hostId = "b";
    ok(cmd(s, ch, "b", { k: "unclaim", x: dx, y: dy }));
    expect(s.claims).toHaveLength(0);
  });

  it("are capped per player", () => {
    const { s, ch } = stocked();
    claimFor(s, ch, "a");
    claimFor(s, ch, "a");
    expect(() => claimFor(s, ch, "a")).toThrow();
  });
});

describe("salvage and refunds", () => {
  it("returns strictly less than the cost, goods and kits included, and buffers exactly once", () => {
    const { s, ch } = stocked();
    s.goods = { wire: 20, frame: 10, kit: 2 };
    const [cx, cy] = claimFor(s, ch, "a");
    const dc = put(s, ch, "datacentre", "a", true, [cx + 1, cy + 1]);
    ok(cmd(s, ch, "a", { k: "tend", x: dc.x, y: dc.y }));
    const tank = dc.tank!;
    expect(tank).toBeGreaterThan(0);
    const before = { ...s.inventory, ...s.goods };
    ok(cmd(s, ch, "a", { k: "demolish", x: dc.x, y: dc.y }));
    const cost = { ...BUILDINGS.datacentre.cost } as Record<string, number>;
    for (const [k, v] of Object.entries({ wire: 2, frame: 1 })) cost[k] = (cost[k] ?? 0) + v;
    for (const [k, v] of Object.entries(cost)) {
      const back = (k in s.goods ? s.goods[k as "wire"] : s.inventory[k as "matter"]) - (before as Record<string, number>)[k];
      expect(back - (k === "coolant" ? tank : 0)).toBeLessThan(v);
    }
    expect(s.inventory.coolant - before.coolant).toBe(tank);
    // a kit fitted later is part of what was paid, and it comes back at less than one
    const f = put(s, ch, "factory");
    ok(cmd(s, ch, "a", { k: "upgrade", x: f.x, y: f.y }));
    const kits = s.goods.kit;
    ok(cmd(s, ch, "a", { k: "demolish", x: f.x, y: f.y }));
    expect(s.goods.kit).toBe(kits);
  });
});

describe("harvesting", () => {
  it("intensive is faster but destroys real stock; careful takes less and wastes nothing, down to the last units", () => {
    const run = (mode: "careful" | "intensive"): { got: number; destroyed: number } => {
      const { s, ch } = room("normal");
      s.lobby.bank = { matter: 0, mineral: 0, coolant: 0 };
      s.lobby.bankStart = { matter: 0, mineral: 0, coolant: 0 };
      ok(cmd(s, ch, "a", { k: "set", mode }));
      const i = depositIdx(s);
      const [x, y] = at(s, i);
      stand(s, "a", x, y);
      const f = s.tiles[i].d!;
      for (let k = 0; k < 5; k++) {
        s.players.a.nextHarvest = 0;
        cmd(s, ch, "a", { k: "harvest", x, y });
      }
      expect(ledgerHolds(s)).toBe(true);
      return { got: s.inventory[f], destroyed: s.ledger[f].destroyed };
    };
    const careful = run("careful");
    const intensive = run("intensive");
    expect(intensive.got).toBeGreaterThan(careful.got);
    expect(intensive.destroyed).toBeGreaterThan(0);
    expect(careful.destroyed).toBe(0);
    // with one or two units left, both can take what's there; intensive wastes only what's left over
    for (const [left, mode, got, lost] of [[1, "intensive", 1, 0], [2, "intensive", 2, 0], [2, "careful", 1, 0], [1, "careful", 1, 0]] as const) {
      const { s, ch } = room("normal");
      const i = depositIdx(s);
      const t = s.tiles[i];
      s.ledger[t.d!].remaining -= t.amt - left;
      s.ledger[t.d!].extracted += t.amt - left;
      t.amt = left;
      ok(cmd(s, ch, "a", { k: "set", mode }));
      const [x, y] = at(s, i);
      stand(s, "a", x, y);
      const inv = s.inventory[t.d!];
      ok(cmd(s, ch, "a", { k: "harvest", x, y }));
      expect(s.inventory[t.d!] - inv).toBe(got);
      expect(s.ledger[t.d!].destroyed).toBe(lost);
      expect(ledgerHolds(s)).toBe(true);
    }
  });
});

describe("networks", () => {
  it("a disconnected machine draws no power from anywhere, and an empty tank idles a datacentre", () => {
    const { s, ch } = stocked();
    s.goods = { wire: 12, frame: 4, kit: 0 };
    put(s, ch, "furnace");
    put(s, ch, "city");
    const [cx, cy] = claimFor(s, ch, "a");
    const dc = put(s, ch, "datacentre", "a", false, [cx + 1, cy + 1]);
    econ(s, ch, 2);
    expect(dc.status).toBe("idle: no power: not cabled to a generator");
    expect(s.econ.unwired).toBeGreaterThan(0);
    cable(s, ch, "a", s.buildings.find((b) => b.type === "furnace")!, dc);
    cable(s, ch, "a", s.buildings.find((b) => b.type === "city")!, dc);
    econ(s, ch, 2);
    expect(dc.status).toMatch(/tank empty/);
    expect(s.econ.computeSupply).toBe(0);
    dc.tank = 5;
    econ(s, ch, 1);
    expect(dc.status).toBe("ok");
  });

  it("pipes move coolant from a pump to a tank and cheap pipe leaks exactly by its counter", () => {
    const { s, ch } = stocked();
    const pond = s.tiles.findIndex((t) => t.d === "coolant" && t.amt > 0);
    const [px, py] = at(s, pond);
    // a pump beside the pond, on dry ground
    let spot: [number, number] | null = null;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [2, 0], [0, 2], [-2, 0], [0, -2]]) {
      const t = s.tiles[(py + dy) * s.w + px + dx];
      if (!spot && t && t.t === 0 && !t.d && !t.b && Math.abs(dx) + Math.abs(dy) === 1) spot = [px + dx, py + dy];
    }
    if (!spot) for (let i = 0; i < s.tiles.length && !spot; i++) {
      const x = i % s.w, y = Math.floor(i / s.w);
      const t = s.tiles[i];
      if (t.t === 0 && !t.d && !t.b && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => s.tiles[(y + dy) * s.w + x + dx]?.d === "coolant")) spot = [x, y];
    }
    const pump = put(s, ch, "intake", "a", false, spot!);
    const sun = put(s, ch, "solar");
    cable(s, ch, "a", sun, pump);
    put(s, ch, "city");
    s.goods = { wire: 12, frame: 4, kit: 0 };
    const [cx, cy] = claimFor(s, ch, "a");
    const dc = put(s, ch, "datacentre", "a", false, [cx + 1, cy + 1]);
    cable(s, ch, "a", pump, dc, "pipe");
    const pipeTiles = s.tiles.filter((t) => t.pp).length;
    const coolantBefore = s.ledger.coolant.extracted;
    for (let k = 0; k < 40; k++) {
      econ(s, ch, 1);
      expect(ledgerHolds(s)).toBe(true);
    }
    expect(dc.tank).toBeGreaterThan(0);
    const pumped = s.ledger.coolant.extracted - coolantBefore;
    const inTanks = (pump.tank ?? 0) + (dc.tank ?? 0);
    // what was pumped is in a tank, was drunk, or leaked: nothing appears or vanishes
    expect(inTanks + s.ops.coolantLost).toBe(pumped);
    expect(s.ops.coolantLost).toBe(Math.floor((s.leak + s.ops.coolantLost * PIPE_LEAK_EVERY) / PIPE_LEAK_EVERY));
    expect(pipeTiles).toBeGreaterThan(0);
  });

  it("belts carry whole items, stop when full, and conserve them through forks and merges", () => {
    const { s, ch } = stocked();
    const store = put(s, ch, "store");
    const free = touching(s, store).filter((i) => !s.tiles[i].b && s.tiles[i].t === 0 && !s.tiles[i].d);
    // a belt three tiles long ending at the store
    const end = free[0];
    const ex = end % s.w;
    const ey = Math.floor(end / s.w);
    const toStore = dirTo([ex, ey], [store.x, store.y]);
    const back: [number, number] = [ex - DIRS[toStore][0], ey - DIRS[toStore][1]];
    const back2: [number, number] = [back[0] - DIRS[toStore][0], back[1] - DIRS[toStore][1]];
    stand(s, "a", ex, ey);
    ok(cmd(s, ch, "a", { k: "line", kind: "belt", q: 0, path: [back2, back, [ex, ey]], d: toStore }));
    // load the far end by hand (as a harvester would) and watch it arrive, a tile per tick
    s.tiles[back2[1] * s.w + back2[0]].bt!.it = "mineral";
    s.tiles[back2[1] * s.w + back2[0]].bt!.n = 1;
    const inv = s.inventory.mineral;
    econ(s, ch, 1);
    expect(s.inventory.mineral).toBe(inv);
    econ(s, ch, 2);
    expect(s.inventory.mineral).toBe(inv + 1);
    // a belt into nothing blocks, and keeps its item
    const t = s.tiles[ey * s.w + ex];
    t.bt!.d = ((toStore + 2) % 4) as 0 | 1 | 2 | 3;
    t.bt!.it = "matter";
    t.bt!.n = 1;
    s.tiles[back[1] * s.w + back[0]].bt!.it = "matter";
    s.tiles[back[1] * s.w + back[0]].bt!.n = 1;
    const held = (): number => s.tiles.reduce((a, q) => a + (q.bt?.n ?? 0), 0) + s.inventory.matter;
    const total = held();
    for (let k = 0; k < 5; k++) econ(s, ch, 1);
    expect(held()).toBe(total);
    // taking a loaded belt up returns its load once, separately from salvage
    const mat = s.inventory.matter;
    const load = t.bt!.n;
    ok(cmd(s, ch, "a", { k: "unline", x: ex, y: ey, kind: "belt" }));
    expect(s.inventory.matter).toBe(mat + load + 0);
  });
});

describe("belt splitters", () => {
  it("a belt branched off another makes a splitter that alternates items between both ways, conserving them", () => {
    const { s, ch } = stocked();
    // find a clear 7x5 patch of ground for a T of belts
    let o: [number, number] | null = null;
    for (let y = 1; y < s.w - 6 && !o; y++)
      for (let x = 1; x < s.w - 8 && !o; x++) {
        let clear = true;
        for (let dy = 0; dy < 5 && clear; dy++) for (let dx = 0; dx < 7 && clear; dx++) {
          const t = s.tiles[(y + dy) * s.w + x + dx];
          if (t.t !== 0 || t.b || (t.d && t.amt > 0)) clear = false;
        }
        if (clear) o = [x, y];
      }
    expect(o).not.toBeNull();
    const [ox, oy] = o!;
    stand(s, "a", ox + 3, oy + 2);
    // a straight belt running east, ending in open ground, and a branch going south from its middle
    ok(cmd(s, ch, "a", { k: "line", kind: "belt", q: 0, path: [[ox, oy + 1], [ox + 1, oy + 1], [ox + 2, oy + 1], [ox + 3, oy + 1], [ox + 4, oy + 1], [ox + 5, oy + 1]] }));
    ok(cmd(s, ch, "a", { k: "line", kind: "belt", q: 0, path: [[ox + 2, oy + 1], [ox + 2, oy + 2], [ox + 2, oy + 3], [ox + 2, oy + 4]] }));
    const hub = s.tiles[(oy + 1) * s.w + ox + 2].bt!;
    expect(hub.sp).toBe(1);
    expect(hub.d).toBe(0);
    // feed five ore in at the start, one per tick, and count what reaches each end
    const ends = { east: 0, south: 0 };
    const total = (): number => s.tiles.reduce((a, t) => a + (t.bt?.n ?? 0), 0) + ends.east + ends.south;
    let fed = 0;
    for (let k = 0; k < 30; k++) {
      const start = s.tiles[(oy + 1) * s.w + ox].bt!;
      if (fed < 6 && start.n === 0) {
        start.it = "mineral";
        start.n = 1;
        fed++;
      }
      econ(s, ch, 1);
      for (const [name, x, y] of [["east", ox + 5, oy + 1], ["south", ox + 2, oy + 4]] as const) {
        const t = s.tiles[y * s.w + x].bt!;
        if (t.n) {
          ends[name] += t.n;
          t.n = 0;
          delete t.it;
        }
      }
      expect(total()).toBe(fed);
    }
    expect(ends.east + ends.south).toBe(6);
    expect(ends.east).toBe(3);
    expect(ends.south).toBe(3);
  });
});

describe("the Green Lobby", () => {
  it("replants a harvested tile, caps what it puts back per family, and goes home when the bank runs dry", () => {
    const { s, ch } = room("rapid");
    const bank0 = { ...s.lobby.bankStart };
    expect(bank0.matter).toBeGreaterThan(0);
    // harvest a grove half down by hand, then let the lobby work
    const i = s.tiles.findIndex((t) => t.d === "matter" && t.amt > 0);
    const t = s.tiles[i];
    const took = Math.floor(t.amt / 2);
    t.amt -= took;
    s.ledger.matter.remaining -= took;
    s.ledger.matter.extracted += took;
    // the log line comes when a visit ends, with the amount put back
    for (let k = 0; k < 1000 && !ch.events.some((e) => e.action === "lobby_restore"); k++) {
      tick(s, ch);
      expect(ledgerHolds(s)).toBe(true);
    }
    expect(s.ledger.matter.restored).toBeGreaterThan(0);
    const ev = ch.events.find((e) => e.action === "lobby_restore")!;
    expect(ev).toMatchObject({ family: "matter", x: i % s.w, y: Math.floor(i / s.w) });
    expect(LOBBY.names).toContain(ev.name);
    // strip the island so there is plenty to replant, then let the bank empty
    for (const q of s.tiles) if (q.d && q.amt > 1) {
      const k = q.amt - 1;
      q.amt = 1;
      s.ledger[q.d].remaining -= k;
      s.ledger[q.d].extracted += k;
    }
    for (let k = 0; k < 20000 && !s.lobby.spent; k++) {
      tick(s, ch);
      expect(ledgerHolds(s)).toBe(true);
    }
    expect(s.lobby.spent).toBe(true);
    expect(s.lobby.agents).toHaveLength(0);
    for (const f of FAMILIES) {
      expect(s.ledger[f].restored).toBe(bank0[f]);
      expect(s.lobby.bank[f]).toBe(0);
    }
  });

  it("pickets a datacentre site for a bounded while, and the site still finishes", () => {
    const { s, ch } = room("rapid");
    s.inventory = { matter: 500, mineral: 500, coolant: 500 };
    s.goods = { wire: 12, frame: 4, kit: 0 };
    const [cx, cy] = claimFor(s, ch, "a");
    stand(s, "a", cx + 1, cy + 1);
    ok(cmd(s, ch, "a", { k: "build", x: cx + 1, y: cy + 1, type: "datacentre" }));
    const dc = s.buildings.find((b) => b.type === "datacentre")!;
    for (let k = 0; k < 4000 && !complete(dc); k++) tick(s, ch);
    expect(complete(dc)).toBe(true);
    expect(dc.picket ?? 0).toBeLessThanOrEqual(LOBBY.picketTicks);
    expect(ledgerHolds(s)).toBe(true);
  });

  it("never stops a world from ending, and stops the moment it does", () => {
    const { s, ch } = room("rapid", ["a"]);
    while (s.phase.k === "play" && s.tick < 60_000) {
      harvestBot(s, ch, "a");
      tick(s, ch);
      expect(ledgerHolds(s)).toBe(true);
    }
    expect(s.phase.k).toBe("transition");
    expect(s.lobby.agents).toHaveLength(0);
    const sum = s.history[0];
    for (const f of FAMILIES) expect(sum.ledger[f].remaining).toBe(0);
    expect(FAMILIES.some((f) => sum.ledger[f].restored > 0)).toBe(true);
  });
});

describe("rushed and sustainable play", () => {
  /** One Earth, two bots of a strategy, until it's spent; returns what it measured. */
  function earth(strat: Strategy, pace: Pace = "normal") {
    const s = createRoom("STRAT", 7, pace);
    const ch = newChanges();
    join(s, "a", "ta", "A", ch);
    join(s, "b", "tb", "B", ch);
    const mem = { a: newMemory(), b: newMemory() };
    while (s.stage === 0 && s.phase.k === "play" && s.tick < 80_000) {
      if (s.tick % 8 === 0) for (const pid of ["a", "b"] as const) for (const c of decide(s, pid, strat, mem[pid])) applyCommand(s, pid, id(), s.gen, c, ch);
      tick(s, ch);
      ch.events.length = 0;
    }
    expect(ledgerHolds(s)).toBe(true);
    return { h: s.history[0], s };
  }

  it("the rush reaches compute sooner and wastes more; the sustainable route gets more useful work from the same world", () => {
    const rush = earth("rush");
    const green = earth("green");
    const sum = (h: StageSummary, k: "extracted" | "destroyed") => FAMILIES.reduce((a, f) => a + h.ledger[f][k], 0);
    // both walked the chain: factory, datacentre, automation
    for (const r of [rush, green]) {
      expect(r.h.ops!.firstFactory).not.toBeNull();
      expect(r.h.ops!.firstDatacentre).not.toBeNull();
      expect(r.h.ops!.firstAutomation).not.toBeNull();
    }
    expect(rush.h.ops!.firstDatacentre!).toBeLessThan(green.h.ops!.firstDatacentre!);
    expect(sum(rush.h, "destroyed")).toBeGreaterThan(sum(green.h, "destroyed") * 5);
    expect(sum(green.h, "extracted")).toBeGreaterThan(sum(rush.h, "extracted"));
    // and the green machine stays useful for longer
    expect(green.h.ops!.busy).toBeGreaterThan(rush.h.ops!.busy);
    // the rush never bought an efficiency kit
    expect(rush.s.buildings.some((b) => b.kit)).toBe(false);
  }, 60_000);

  it("both strategies finish a whole campaign, the books balancing on every tick", () => {
    for (const strat of ["rush", "green"] as const) {
      const s = createRoom("CAMPN", 7, "rapid");
      const ch = newChanges();
      join(s, "a", "ta", "A", ch);
      join(s, "b", "tb", "B", ch);
      let mem = { a: newMemory(), b: newMemory() };
      let gen = s.gen;
      while (s.phase.k !== "ended" && s.tick < 400_000) {
        if (s.phase.k === "play" && s.tick % 8 === 0) for (const pid of ["a", "b"] as const) for (const c of decide(s, pid, strat, mem[pid])) applyCommand(s, pid, id(), s.gen, c, ch);
        tick(s, ch);
        ch.events.length = 0;
        if (s.gen !== gen) {
          gen = s.gen;
          mem = { a: newMemory(), b: newMemory() };
        }
        expect(ledgerHolds(s)).toBe(true);
        expect(bundleOk(s.inventory) && goodsOk(s)).toBe(true);
      }
      expect(s.phase).toEqual({ k: "ended", how: "consumed" });
      expect(s.history.map((h) => h.stage)).toEqual(STAGES.map((st) => st.id));
      // every world got a datacentre built through the chain
      for (const h of s.history) expect(h.ops!.firstDatacentre, `${strat} ${h.stage}`).not.toBeNull();
    }
  }, 120_000);

  it("an equal Bottled Sun makes more parts through an efficient factory before it runs out", () => {
    const run = (kit: boolean): number => {
      const { s, ch } = stocked();
      while (STAGES[s.stage].id !== "system") {
        for (const t of s.tiles) if (t.d && t.amt) {
          s.ledger[t.d].remaining -= t.amt;
          s.ledger[t.d].extracted += t.amt;
          t.amt = 0;
        }
        tick(s, ch);
        while (s.phase.k === "transition") tick(s, ch);
      }
      s.inventory = { matter: 500, mineral: 500, coolant: 500 };
      s.reserve = 120;
      const depot = s.buildings.find((b) => b.type === "depot")!;
      stand(s, "a", depot.x, depot.y + 2);
      const home = put(s, ch, "city");
      const f = put(s, ch, "factory");
      cable(s, ch, "a", depot, f);
      cable(s, ch, "a", home, f);
      f.kit = kit;
      f.recipe = "wire";
      // a factory with a full output draws nothing: idle machines leave the reserve alone
      f.out = { wire: 12 };
      const held = s.reserve;
      econ(s, ch, 5);
      expect(s.reserve).toBe(held);
      f.out = {};
      for (let k = 0; k < 2000 && s.reserve > 0; k++) {
        f.buf = { mineral: 12 };
        f.out = {};
        econ(s, ch, 1);
      }
      expect(s.reserve).toBe(0);
      return f.made ?? 0;
    };
    const quick = run(false);
    const efficient = run(true);
    expect(quick).toBeGreaterThan(0);
    expect(efficient).toBeGreaterThan(quick);
  });
});

describe("saved rooms from before the factory chain", () => {
  it("load with no goods, no claims, zero restored, and their datacentres kept and running", async () => {
    const { migrate } = await import("../server/migrate.ts");
    const { s, ch } = room("rapid");
    // what a schema-1 room looked like: no goods, claims, lobby, ops, restored, mode
    const old = JSON.parse(JSON.stringify(s)) as Record<string, unknown> & RoomState;
    old.v = 1;
    for (const f of FAMILIES) delete (old.ledger[f] as Partial<LedgerEntry>).restored;
    for (const k of ["goods", "claims", "nextClaimId", "lobby", "ops", "leak"]) delete old[k];
    delete (old.econ as Partial<RoomState["econ"]>).unwired;
    delete (old.econ as Partial<RoomState["econ"]>).drawn;
    for (const p of Object.values(old.players)) delete (p as Partial<typeof p>).mode;
    const [x, y] = freeTile(old, 2);
    old.inventory = { matter: 50, mineral: 50, coolant: 50 };
    old.buildings.push({ id: 90, type: "datacentre", x, y, owner: "a", work: 60, status: "ok" });
    old.buildings.push({ id: 91, type: "city", x: x, y: y + 3, owner: "a", work: 50, status: "ok" });
    old.buildings.push({ id: 92, type: "solar", x: x + 3, y: y, owner: "a", work: 40, status: "ok" });
    for (const b of old.buildings) for (const [fx, fy] of footprint(b)) if (old.tiles[fy * old.w + fx]) old.tiles[fy * old.w + fx].b = b.id;
    const m = migrate(old, 1);
    expect(m.goods).toEqual({ wire: 0, frame: 0, kit: 0 });
    expect(m.claims).toEqual([]);
    for (const f of FAMILIES) expect(m.ledger[f].restored).toBe(0);
    expect(m.buildings.find((b) => b.id === 90)?.type).toBe("datacentre");
    expect(ledgerHolds(m)).toBe(true);
    econ(m, ch, 3);
    expect(m.buildings.find((b) => b.id === 90)!.status).toBe("ok");
    expect(m.econ.computeSupply).toBeGreaterThan(0);
  });
});
