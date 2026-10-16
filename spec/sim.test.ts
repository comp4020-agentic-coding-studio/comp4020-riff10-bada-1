import { describe, expect, it } from "vitest";
import { BUILDINGS, FAMILIES, STAGES } from "../shared/content.ts";
import type { Building, RoomState } from "../shared/protocol.ts";
import { routeBetween, touching } from "../shared/layout.ts";
import { applyCommand, createRoom, join, leave, ledgerHolds, newChanges, tick, totalRemaining, bundleOk, type Changes } from "../shared/sim.ts";

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
