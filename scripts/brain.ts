// The playtest bot's decisions, as a pure function of the room: what one
// player should do next. scripts/playbot.ts sends these over the real
// protocol; spec/sim.test.ts applies them directly to run whole campaigns.
// Two strategies follow the same chain (homes, power, factory, parts,
// claim, datacentre, automation) and differ in how they do each step:
//
//   rush:  intensive harvesting, furnaces, standard builds, cheap pipe
//   green: careful harvesting, Sun Gardens, efficiency kits, sealed pipe
//
// It only ever reads state and proposes commands; the server decides.
import { BUILDINGS, CLAIM_SIZE, FAMILIES, HARVEST_RANGE, LINES, NEXT_DATACENTRE, STAGES, TEND_RANGE, type BuildingType, type Cost, type Family, type Item, type LineKind } from "../shared/content.ts";
import type { Building, Command, RoomState } from "../shared/protocol.ts";
import { DIRS, claimAt, components, dirTo, footprint, inBounds, routeBetween, touching } from "../shared/layout.ts";
import { buildCost, claimProblem, placementProblem } from "../shared/sim.ts";
import { nextRecipe, recipeOf } from "../shared/economy.ts";
import { complete, have } from "../shared/world.ts";

export type Strategy = "rush" | "green" | "hand";

export interface Memory {
  /** a place the bot is walking to, and why */
  goal?: [number, number];
  /** commands it already tried and was refused, by key, so it doesn't loop */
  failed: Map<string, number>;
  step: number;
}

export const newMemory = (): Memory => ({ failed: new Map(), step: 0 });

type Act = Command[];
/** A walking intent that slows on arrival: the bot decides every 0.8 s, so full speed would overshoot. */
const toward = (me: { x: number; y: number }, x: number, y: number): Command => {
  const dx = x - me.x;
  const dy = y - me.y;
  const d = Math.hypot(dx, dy);
  // about 3.2 tiles pass between decisions at full speed: aim to stop a tile short
  const k = d < 1e-6 ? 0 : Math.min(1, Math.max(0.15, (d - 1) / 3.2)) / d;
  return { k: "move", dx: dx * k, dy: dy * k };
};
const dist = (ax: number, ay: number, bx: number, by: number): number => Math.hypot(ax - bx, ay - by);
const centreOf = (b: Pick<Building, "x" | "y" | "type">): [number, number] => {
  const h = (BUILDINGS[b.type].size - 1) / 2;
  return [b.x + h, b.y + h];
};

export function decide(s: RoomState, pid: string, strat: Strategy, mem: Memory): Act {
  mem.step++;
  const me = s.players[pid];
  if (!me || s.phase.k !== "play") return [];
  const st = STAGES[s.stage];
  const mine = s.buildings.filter((b) => b.owner === pid);
  const ours = s.buildings.filter((b) => b.owner);
  const has = (t: BuildingType): Building[] => ours.filter((b) => b.type === t);
  const done = (t: BuildingType): Building[] => has(t).filter(complete);
  const base = baseOf(s);
  const out: Act = [];
  const wantMode = strat === "rush" ? "intensive" : "careful";
  if (me.mode !== wantMode && strat !== "hand") out.push({ k: "set", mode: wantMode });
  if (strat === "hand") return out.concat(gather(s, pid, mem, null));

  const tried = (key: string): boolean => (mem.failed.get(key) ?? 0) > mem.step;
  const walkTo = (x: number, y: number): Act => [toward(me, x, y)];
  const stop: Command = { k: "move", dx: 0, dy: 0 };
  const within = (x: number, y: number, r: number): boolean => dist(me.x, me.y, x, y) <= r;

  /** Build if affordable; walk over if not in range. Null when it can't yet (gather instead). */
  const build = (type: BuildingType, spot: [number, number] | null, eff = false): Act | null => {
    if (!spot) return null;
    const cost = buildCost(type, eff);
    if (!affordable(s, cost)) return gather(s, pid, mem, cost);
    const h = (BUILDINGS[type].size - 1) / 2;
    if (!within(spot[0] + h, spot[1] + h, 6)) return walkTo(spot[0] + h, spot[1] + h);
    mem.failed.set(`b${type}${spot}`, mem.step + 6);
    return [stop, { k: "build", x: spot[0], y: spot[1], type, eff }];
  };

  // the "tried" mark is set only when the command is actually sent, so walking over never counts as trying;
  // and a tend that would move nothing is never attempted
  const tend = (b: Building): Act => {
    if (!tendUseful(s, b)) return gather(s, pid, mem, b.type === "factory" ? { mineral: 8, matter: 6 } : { coolant: 10 });
    const [cx, cy] = centreOf(b);
    if (!within(cx, cy, TEND_RANGE)) return walkTo(cx, cy);
    mem.failed.set(`t${b.id}`, mem.step + 2);
    return [stop, { k: "tend", x: b.x, y: b.y }];
  };

  const lay = (kind: LineKind, path: [number, number][] | null, q: 0 | 1, d?: 0 | 1 | 2 | 3): Act | null => {
    if (!path || tried(`l${kind}${path[0]}`)) return null;
    const cost = lineCost(s, kind, path, q);
    if (!affordable(s, cost)) return gather(s, pid, mem, cost);
    const [mx, my] = path[Math.floor(path.length / 2)];
    const far = path.some(([x, y]) => dist(me.x, me.y, x, y) > 13);
    if (far) return walkTo(mx, my);
    mem.failed.set(`l${kind}${path[0]}`, mem.step + 6);
    return [stop, { k: "line", kind, q, path, d }];
  };

  // a building under construction nearby: lend a hand
  const site = mine.find((b) => !complete(b));

  const powerKind: BuildingType | null = st.energySource === "bottled" ? null : st.id === "earth" && strat === "rush" ? "furnace" : "solar";
  const eff = (t: BuildingType): boolean => strat === "green" && !!BUILDINGS[t].kit && t !== "extractor" && t !== "habitat" && t !== "furnace" && have(s, "wire") >= 2 && have(s, "frame") >= 1 && done("datacentre").length > 0;

  // 0. the Universe with the Bottled Sun spent: the host renders a World Engine down for power, for good
  if (st.mechanic === "legacy" && s.reserve < 40 && s.hostId === pid && !tried("render")) {
    const engine = s.buildings.find((b) => b.type === "engine");
    if (engine) {
      const [cx, cy] = centreOf(engine);
      mem.failed.set("render", mem.step + 20);
      return out.concat([toward(me, cx, cy), { k: "demolish", x: engine.x, y: engine.y }]);
    }
  }
  // 1. Mars: air before anything else can run
  if (st.mechanic === "pressure" && !has("habitat").length) {
    const a = build("habitat", findSpot(s, "habitat", base, pid));
    if (a) return out.concat(a);
  }
  // 2. homes
  if (!has("city").length) {
    const a = build("city", findSpot(s, "city", base, pid, airOk(s)));
    if (a) return out.concat(a);
  }
  // 3. power
  if (powerKind && !has(powerKind).length) {
    const a = build(powerKind, findSpot(s, powerKind, base, pid, powerKind === "furnace" ? awayFromGroves(s) : undefined));
    if (a) return out.concat(a);
  }
  // 3b. more power when a grid is overloaded (the Sun's collectors heat things up, so radiators come with them)
  // more generators only help when the ones there are actually burning: a furnace out of fuel needs timber, not company
  const fuelless = ours.some((b) => b.type === "furnace" && b.status.includes("to burn"));
  const starved = !fuelless && ours.some((b) => complete(b) && /no power: its grid is overloaded|no power to spare/.test(b.status));
  if (powerKind && starved && has(powerKind).length < 5 && has(powerKind).every(complete)) {
    const a = build(powerKind, findSpot(s, powerKind, base, pid, airOk(s)));
    if (a) return out.concat(a);
  }
  if (st.mechanic === "heat" && s.heat >= 50 && has("radiator").length < has("solar").length && has("radiator").every(complete)) {
    const a = build("radiator", findSpot(s, "radiator", base, pid));
    if (a) return out.concat(a);
  }
  if (fuelless && s.inventory.matter < 4) return out.concat(gather(s, pid, mem, { matter: 12 }));
  // 4. a factory
  if (!has("factory").length) {
    const a = build("factory", findSpot(s, "factory", base, pid, airOk(s)));
    if (a) return out.concat(a);
  }
  if (site && within(...centreOf(site), 2) && !tried(`help${site.id}`)) {
    mem.failed.set(`help${site.id}`, mem.step + 1);
    return out.concat([stop, { k: "harvest", x: site.x, y: site.y }]);
  }
  // 5. cable everything that needs power to a grid that has some
  const cable = connect(s, pid, "cable");
  if (cable) {
    const a = lay("cable", cable, 0);
    if (a) return out.concat(a);
  }
  // 6. pipe coolant to every tank that drinks (domes first), from a pump beside the richest water nearby
  const livePump = (q: Building): boolean => !complete(q) || (q.tank ?? 0) > 0 || !q.status.includes("left beside it");
  for (const b of [...done("habitat"), ...done("datacentre")]) {
    if (b.legacy) continue;
    const pump = has("intake").find((q) => livePump(q) && dist(...centreOf(q), ...centreOf(b)) < 16);
    if (!pump && has("intake").filter(livePump).length >= 2) break;
    if (!pump && (has("intake").some((q) => !complete(q)) || has("intake").length >= 10)) break;
    // a dry pump is taken down for half its cost before a new one goes up beside fresh water
    const dry = mine.find((q) => q.type === "intake" && complete(q) && !livePump(q) && !(q.tank ?? 0));
    if (!pump && dry && !tried(`d${dry.id}`)) {
      mem.failed.set(`d${dry.id}`, mem.step + 10);
      const [cx, cy] = centreOf(dry);
      if (!within(cx, cy, 7)) return out.concat(walkTo(cx, cy));
      return out.concat([stop, { k: "demolish", x: dry.x, y: dry.y }]);
    }
    if (!pump) {
      const a = build("intake", intakeSpot(s, centreOf(b), pid));
      if (a) return out.concat(a);
      break;
    }
    if (!complete(pump)) break;
    // join the pump to the tank, or to a pipe that already reaches it
    const goals = new Set(freeTouch(s, b));
    const { comp } = components(s, "pipe");
    const reach = new Set(touching(s, b).map((i) => comp[i]).filter((c) => c >= 0));
    if (touching(s, pump).some((i) => reach.has(comp[i]))) continue;
    s.tiles.forEach((t, i) => {
      if (t.pp && reach.has(comp[i])) goals.add(i);
    });
    const path = routeBetween(s, "pipe", freeTouch(s, pump), goals, pid);
    const q: 0 | 1 = strat === "green" && have(s, "wire") >= (path?.length ?? 99) + 2 ? 1 : 0;
    const a = lay("pipe", path, q);
    if (a) return out.concat(a);
  }
  // until the pipes run, keep domes and datacentres cooled by hand
  for (const b of [...done("habitat"), ...done("datacentre")])
    if ((b.tank ?? 0) < 8 && s.inventory.coolant >= 4 && !b.legacy && !(pipedIn(s, b) && s.buildings.some((q) => q.type === "intake" && (q.tank ?? 0) > 0))) return out.concat(tend(b));
  if (done("habitat").some((h) => (h.tank ?? 0) < 6) && s.inventory.coolant < 4 && !done("intake").some((q) => (q.tank ?? 0) > 0)) return out.concat(gather(s, pid, mem, { coolant: 10 }));

  const factory = done("factory")[0];
  const dcs = has("datacentre");
  const parts = (NEXT_DATACENTRE.wire ?? 0) + (NEXT_DATACENTRE.frame ?? 0);
  // 7. feed the factory and collect its parts, until the first datacentre is paid for
  if (factory && dcs.length === 0) {
    const outQ = Object.values(factory.out ?? {}).reduce((a, v) => a + (v ?? 0), 0);
    const goodsHave = have(s, "wire") + have(s, "frame");
    const next = nextRecipe(s, factory);
    const missing = "r" in next && !factory.job ? Object.entries(recipeOf(factory, next.r).in).filter(([k, v]) => (factory.buf?.[k as Item] ?? 0) < (v ?? 0)) : [];
    const canLoad = missing.some(([k]) => have(s, k as Item) > 0);
    if ((outQ > 0 || canLoad) && !tried(`t${factory.id}`)) return out.concat(tend(factory));
    if (missing.length && goodsHave < parts) {
      const want: Cost = {};
      for (const [k, v] of missing) if ((FAMILIES as readonly string[]).includes(k)) want[k as Item] = (v ?? 0) * 2;
      return out.concat(gather(s, pid, mem, want));
    }
  }
  // 8. stake ground and build the datacentre on it
  if (!dcs.length) {
    let claim = s.claims.find((c) => c.owner === pid);
    // one claim per room is enough for the first datacentre: whoever stakes it builds it
    const someone = s.claims.find((c) => c.owner !== pid && s.players[c.owner]?.connected);
    if (!claim && !someone) {
      const spot = findClaim(s, base, pid);
      if (spot) {
        if (!affordable(s, { matter: 3 })) return out.concat(gather(s, pid, mem, { matter: 3 }));
        if (!within(spot[0] + 1.5, spot[1] + 1.5, 6)) return out.concat(walkTo(spot[0] + 1.5, spot[1] + 1.5));
        return out.concat([stop, { k: "claim", x: spot[0], y: spot[1] }]);
      }
    } else if (claim) {
      const spot = dcSpotIn(s, claim, pid);
      const a = build("datacentre", spot, eff("datacentre"));
      if (a) return out.concat(a);
    }
  }
  const dc = done("datacentre")[0];
  // 9. green: make a kit (2 wire + 1 frame) and fit it, factory first, then the datacentre and harvesters
  // kits come once the first automated line runs: invest after the loop works, not instead of it
  if (strat === "green" && factory && dc && s.ops.firstAutomation !== null) {
    // the factory first (on Mars, the dome: a sealed dome halves the colony's ice), then the datacentre and harvesters
    const first = st.mechanic === "pressure" ? done("habitat").slice(0, 1) : [];
    const target = [...first, factory, dc, ...done("extractor")].find((b) => !b.kit);
    const kitOut = factory.out?.kit ?? 0;
    if (target && s.goods.kit > 0) {
      const [cx, cy] = centreOf(target);
      if (!within(cx, cy, 6)) return out.concat(walkTo(cx, cy));
      if (!tried(`u${target.id}`)) {
        mem.failed.set(`u${target.id}`, mem.step + 4);
        return out.concat([stop, { k: "upgrade", x: target.x, y: target.y }]);
      }
    } else if (target) {
      const wantKit = have(s, "wire") + (factory.buf?.wire ?? 0) >= 2 && have(s, "frame") + (factory.buf?.frame ?? 0) >= 1;
      const recipe = wantKit || factory.job?.r === "kit" || kitOut > 0 ? "kit" : "auto";
      if (factory.recipe !== recipe && !tried(`r${factory.id}${recipe}`)) {
        mem.failed.set(`r${factory.id}${recipe}`, mem.step + 6);
        return out.concat([{ k: "set", x: factory.x, y: factory.y, recipe, target: recipe === "kit" ? 1 : 0 }]);
      }
      if (tendUseful(s, factory) && !tried(`t${factory.id}`)) return out.concat(tend(factory));
      if (recipe === "auto" && factory.status.startsWith("idle: no ")) return out.concat(gather(s, pid, mem, { mineral: 8, matter: 6 }));
    } else if (factory.recipe === "kit" && !tried(`r${factory.id}auto`)) {
      mem.failed.set(`r${factory.id}auto`, mem.step + 30);
      return out.concat([{ k: "set", x: factory.x, y: factory.y, recipe: "auto", target: 0 }]);
    }
  }
  // 9b. more homes when machines wait on workers (a second Cottages, then more)
  const noWorkers = ours.some((b) => complete(b) && b.status.includes("no workers"));
  if (noWorkers && has("city").length < 4 && has("city").every(complete)) {
    const a = build("city", findSpot(s, "city", base, pid, airOk(s)));
    if (a) return out.concat(a);
  }
  // 10. automate: harvesters belted to a store or straight into the factory
  if (dc && (s.econ.computeSupply > s.econ.computeUsed || has("extractor").length || st.mechanic === "pressure")) {
    const xs = has("extractor");
    const cap = st.mechanic === "relay" ? 4 : 3;
    if (xs.length < cap && s.econ.computeSupply - s.econ.computeUsed >= 1 && xs.every(complete)) {
      const spot = extractorSpot(s, base, pid);
      if (!spot && st.mechanic === "pressure" && has("habitat").length < 3 && has("habitat").every(complete)) {
        // Mars: a second dome over the nearest deposits, so drills have air
        const a = build("habitat", domeSpot(s, base, pid));
        if (a) return out.concat(a);
      }
      if (!spot && st.mechanic === "relay" && has("relay").length < 6 && has("relay").every(complete)) {
        // the Solar System: extend the relay network out toward the belt first
        const a = build("relay", relaySpot(s, base, pid));
        if (a) return out.concat(a);
      }
      const a = build("extractor", spot);
      if (a) return out.concat(a);
    }
    for (const x of done("extractor")) {
      if (x.mode !== (strat === "rush" ? "intensive" : "careful") && !tried(`m${x.id}`)) {
        mem.failed.set(`m${x.id}`, mem.step + 20);
        return out.concat([{ k: "set", x: x.x, y: x.y, mode: strat === "rush" ? "intensive" : "careful" }]);
      }
      if (beltedOut(s, x) || tried(`belt${x.id}`)) continue;
      // belt the hopper to a store (or straight into the factory) beside it
      const store = has("store").find((b) => dist(...centreOf(b), ...centreOf(x)) < 9);
      if (!store) {
        const a = build("store", findSpot(s, "store", centreOf(x), pid, (bx, by) => dist(bx, by, ...centreOf(x)) >= 2.5));
        if (a) return out.concat(a);
        continue;
      }
      if (!complete(store)) continue;
      const goals = new Set(freeTouch(s, store));
      const path = routeBetween(s, "belt", freeTouch(s, x), goals, pid);
      if (!path) {
        mem.failed.set(`belt${x.id}`, mem.step + 40);
        continue;
      }
      const last = path[path.length - 1];
      const into = footprint(store).find(([fx, fy]) => Math.abs(fx - last[0]) + Math.abs(fy - last[1]) === 1)!;
      const a = lay("belt", path, 0, dirTo(last, into));
      if (a) {
        mem.failed.set(`belt${x.id}`, mem.step + 3);
        return out.concat(a);
      }
    }
    // collect hoppers that have no belt yet
    const full = done("extractor").find((x) => !beltedOut(s, x) && Object.values(x.out ?? {}).reduce((a, v) => a + (v ?? 0), 0) >= 6);
    if (full && !tried(`t${full.id}`)) {
      return out.concat(tend(full));
    }
  }
  if (site && !tried(`help${site.id}`)) {
    mem.failed.set(`help${site.id}`, mem.step + 1);
    const [cx, cy] = centreOf(site);
    if (!within(cx, cy, 2)) return out.concat(walkTo(cx, cy));
    return out.concat([stop, { k: "harvest", x: site.x, y: site.y }]);
  }
  return out.concat(gather(s, pid, mem, null));
}

/** Would a tend at this building move anything? Mirrors the server's tend command. */
function tendUseful(s: RoomState, b: Building): boolean {
  if (Object.values(b.out ?? {}).some((v) => (v ?? 0) > 0)) return true;
  if (b.type === "intake") return (b.tank ?? 0) > 0;
  if (b.type === "factory") {
    const recipes = b.job ? [b.job.r] : b.recipe && b.recipe !== "auto" ? [b.recipe] : (["wire", "frame"] as const);
    return recipes.some((r) => Object.entries(recipeOf(b, r).in).some(([k, need]) => have(s, k as Item) > 0 && (b.buf?.[k as Item] ?? 0) < Math.min(12, (need ?? 0) * 2)));
  }
  const tank = BUILDINGS[b.type].tank;
  return !!tank && !b.legacy && (b.tank ?? 0) < tank && s.inventory.coolant > 0;
}

const lineCost = (s: RoomState, kind: LineKind, path: [number, number][], q: 0 | 1): Cost => {
  const n = path.filter(([x, y]) => {
    const t = s.tiles[y * s.w + x];
    return kind === "cable" ? !t.cb : kind === "pipe" ? !t.pp : kind === "belt" ? !t.bt : !t.pa;
  }).length;
  const out: Cost = {};
  for (const [k, v] of Object.entries(LINES[kind].cost[q] ?? {})) out[k as Item] = (v ?? 0) * n;
  return out;
};

const affordable = (s: RoomState, c: Cost): boolean => Object.entries(c).every(([k, v]) => have(s, k as Item) >= (v ?? 0));

/** Harvest toward a cost: the family it's shortest of, or the nearest deposit. */
function gather(s: RoomState, pid: string, mem: Memory, cost: Cost | null): Act {
  const me = s.players[pid];
  let fam: Family | null = null;
  if (cost) {
    let worst = 0;
    for (const f of FAMILIES) {
      const gap = (cost[f] ?? 0) - s.inventory[f];
      if (gap > worst) [worst, fam] = [gap, f];
    }
  }
  const pickDry = (): number => {
    let best = -1;
    let bd = Infinity;
    s.tiles.forEach((t, i) => {
      if (!t.d || t.amt <= 0 || t.d === "coolant") return;
      const d = dist(i % s.w, Math.floor(i / s.w), me.x, me.y);
      if (d < bd) [bd, best] = [d, i];
    });
    return best;
  };
  const pick = (f: Family | null): number => {
    let best = -1;
    let bd = Infinity;
    s.tiles.forEach((t, i) => {
      if (!t.d || t.amt <= 0 || (f && t.d !== f)) return;
      const d = dist(i % s.w, Math.floor(i / s.w), me.x, me.y);
      if (d < bd) [bd, best] = [d, i];
    });
    return best;
  };
  // coolant is only gathered when it's what's wanted: hand-scooping the pond starves the pumps
  let i = fam ? pick(fam) : pickDry();
  if (i < 0) i = pick(null);
  if (i < 0) return [{ k: "move", dx: 0, dy: 0 }];
  const [x, y] = [i % s.w, Math.floor(i / s.w)];
  if (dist(me.x, me.y, x, y) > HARVEST_RANGE - 0.4) return [toward(me, x, y)];
  void mem;
  return [{ k: "move", dx: 0, dy: 0 }, { k: "harvest", x, y }];
}

/** Where the room builds: the spawn point. */
function baseOf(s: RoomState): [number, number] {
  const c = (s.w - 1) / 2;
  const st = STAGES[s.stage];
  if (st.id === "sun") return [c, s.w - 5];
  if (st.id === "universe") return [c, c];
  return [c, c];
}

type Pred = (x: number, y: number) => boolean;

function airOk(s: RoomState): Pred | undefined {
  if (STAGES[s.stage].mechanic !== "pressure") return undefined;
  // the economy's own rule: any footprint tile within a dome's radius of its centre (top-left given; 2x2 assumed generous)
  const r = BUILDINGS.habitat.pressureRadius! + 0.5;
  return (x, y) => s.buildings.some((h) => h.type === "habitat" && [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]].some(([tx, ty]) => Math.max(Math.abs(h.x + 0.5 - tx), Math.abs(h.y + 0.5 - ty)) <= r - 1));
}

function awayFromGroves(s: RoomState): Pred {
  return (x, y) => {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      if (!inBounds(s, x + dx, y + dy)) continue;
      const t = s.tiles[(y + dy) * s.w + x + dx];
      if (t.d === "matter" && t.amt > 0) return true; // a rushed furnace doesn't care
    }
    return true;
  };
}

/** Is this spot free of anything that would make the base hard to wire up? */
const roomy = (s: RoomState, type: BuildingType, x: number, y: number): boolean => {
  // keep a one-tile ring around 2x2 buildings clear of other buildings, so cables can pass
  const n = BUILDINGS[type].size;
  for (let yy = y - 1; yy <= y + n; yy++)
    for (let xx = x - 1; xx <= x + n; xx++) {
      if (!inBounds(s, xx, yy)) continue;
      const t = s.tiles[yy * s.w + xx];
      if (t.b) return false;
    }
  return true;
};

function findSpot(s: RoomState, type: BuildingType, near: [number, number], pid: string, ok?: Pred): [number, number] | null {
  let best: [number, number] | null = null;
  let bd = Infinity;
  for (let y = 0; y < s.w; y++)
    for (let x = 0; x < s.w; x++) {
      const d = dist(x, y, near[0], near[1]);
      if (d >= bd || d < 1.5) continue;
      // keep ordinary buildings off claimed ground, so the claim stays free for its datacentre
      if (footprint({ type, x, y }).some(([fx, fy]) => claimAt(s, fx, fy))) continue;
      if (!roomy(s, type, x, y)) continue;
      if (ok && !ok(x, y)) continue;
      if (placementProblem(s, type, x, y, { id: pid, x, y }) && !/^needs /.test(placementProblem(s, type, x, y, { id: pid, x, y })!)) continue;
      [bd, best] = [d, [x, y]];
    }
  return best;
}

function findClaim(s: RoomState, near: [number, number], pid: string): [number, number] | null {
  let best: [number, number] | null = null;
  let bd = Infinity;
  for (let y = 0; y + CLAIM_SIZE <= s.w; y++)
    for (let x = 0; x + CLAIM_SIZE <= s.w; x++) {
      const d = dist(x + 1.5, y + 1.5, near[0], near[1]);
      if (d >= bd) continue;
      const why = claimProblem(s, x, y, { id: pid, x: x + 1.5, y: y + 1.5 });
      if (why && !/^needs /.test(why)) continue;
      if (!dcSpotIn(s, { id: 0, owner: pid, x, y }, pid, true)) continue;
      [bd, best] = [d, [x, y]];
    }
  return best;
}

function dcSpotIn(s: RoomState, c: { id: number; owner: string; x: number; y: number }, pid: string, hypothetical = false): [number, number] | null {
  for (const [dx, dy] of [[1, 1], [0, 1], [1, 0], [2, 1], [1, 2], [0, 0], [2, 2], [0, 2], [2, 0]]) {
    const x = c.x + dx;
    const y = c.y + dy;
    let free = true;
    for (const [fx, fy] of footprint({ type: "datacentre", x, y })) {
      const t = s.tiles[fy * s.w + fx];
      if (!t || t.b || (t.d && t.amt > 0) || t.t !== 0 || t.cb || t.pp || t.bt || t.pa) free = false;
    }
    if (!free) continue;
    const air = airOk(s);
    if (air && !air(x, y)) continue;
    if (hypothetical) return [x, y];
    const why = placementProblem(s, "datacentre", x, y, { id: pid, x, y });
    if (!why || /^needs /.test(why)) return [x, y];
  }
  return null;
}

function intakeSpot(s: RoomState, near: [number, number], pid: string): [number, number] | null {
  let best: [number, number] | null = null;
  let score = -Infinity;
  for (let y = 0; y < s.w; y++)
    for (let x = 0; x < s.w; x++) {
      let water = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if ((!dx && !dy) || !inBounds(s, x + dx, y + dy)) continue;
          const t = s.tiles[(y + dy) * s.w + x + dx];
          if (t.d === "coolant") water += t.amt;
        }
      if (water < 6) continue;
      const v = water - dist(x, y, near[0], near[1]) * 4;
      if (v <= score || claimAt(s, x, y)) continue;
      const why = placementProblem(s, "intake", x, y, { id: pid, x, y });
      if (why && !/^needs /.test(why)) continue;
      [score, best] = [v, [x, y]];
    }
  return best;
}

function extractorSpot(s: RoomState, near: [number, number], pid: string): [number, number] | null {
  let best: [number, number] | null = null;
  let score = -Infinity;
  const st = STAGES[s.stage];
  for (let y = 0; y < s.w; y++)
    for (let x = 0; x < s.w; x++) {
      let stock = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!inBounds(s, x + dx, y + dy)) continue;
        const t = s.tiles[(y + dy) * s.w + x + dx];
        if (t.d && t.d !== "coolant" && t.amt > 0) stock += t.amt;
      }
      if (stock === 0) continue;
      const v = stock - dist(x, y, near[0], near[1]) * 3;
      if (v <= score) continue;
      if (st.mechanic === "pressure" && !airOk(s)!(x, y)) continue;
      if (st.mechanic === "relay" && !s.buildings.some((r) => BUILDINGS[r.type].relayRange && Math.max(Math.abs(r.x - x), Math.abs(r.y - y)) <= BUILDINGS[r.type].relayRange! - 1)) continue;
      if (claimAt(s, x, y)) continue;
      const why = placementProblem(s, "extractor", x, y, { id: pid, x, y });
      if (why && !/^needs /.test(why)) continue;
      [score, best] = [v, [x, y]];
    }
  return best;
}

/** A dome spot whose air would cover deposits a drill could reach. */
function domeSpot(s: RoomState, base: [number, number], pid: string): [number, number] | null {
  let best: [number, number] | null = null;
  let score = -Infinity;
  const r = BUILDINGS.habitat.pressureRadius!;
  for (let y = 0; y < s.w - 1; y++)
    for (let x = 0; x < s.w - 1; x++) {
      let stock = 0;
      for (let dy = -r + 1; dy <= r; dy++) for (let dx = -r + 1; dx <= r; dx++) {
        if (!inBounds(s, x + dx, y + dy)) continue;
        const t = s.tiles[(y + dy) * s.w + x + dx];
        if (t.d && t.d !== "coolant" && t.amt > 0) stock += t.amt;
      }
      const v = stock - dist(x, y, base[0], base[1]) * 8;
      if (v <= score || footprint({ type: "habitat", x, y }).some(([fx, fy]) => claimAt(s, fx, fy))) continue;
      const why = placementProblem(s, "habitat", x, y, { id: pid, x, y });
      if (why && !/^needs /.test(why)) continue;
      [score, best] = [v, [x, y]];
    }
  return best;
}

/** A relay spot inside the network's reach, as far out toward the deposits as it goes. */
function relaySpot(s: RoomState, base: [number, number], pid: string): [number, number] | null {
  const nodes = s.buildings.filter((b) => BUILDINGS[b.type].relayRange && complete(b));
  let best: [number, number] | null = null;
  let score = -Infinity;
  for (let y = 0; y < s.w; y++)
    for (let x = 0; x < s.w; x++) {
      const linked = nodes.some((r) => Math.max(Math.abs(r.x - x), Math.abs(r.y - y)) <= BUILDINGS[r.type].relayRange! - 1);
      if (!linked) continue;
      let stock = 0;
      for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) {
        if (!inBounds(s, x + dx, y + dy)) continue;
        const t = s.tiles[(y + dy) * s.w + x + dx];
        if (t.d && t.d !== "coolant" && t.amt > 0) stock += t.amt;
      }
      const v = stock - dist(x, y, base[0], base[1]);
      if (v <= score || claimAt(s, x, y)) continue;
      const why = placementProblem(s, "relay", x, y, { id: pid, x, y });
      if (why && !/^needs /.test(why)) continue;
      [score, best] = [v, [x, y]];
    }
  return best;
}

/** Touching tiles a line could start or end on. */
const freeTouch = (s: RoomState, b: Building): number[] => touching(s, b).filter((i) => !s.tiles[i].b);

/** A cable route joining an unpowered machine of this player's to a grid with power, or null. */
function connect(s: RoomState, pid: string, kind: "cable"): [number, number][] | null {
  const needs = s.buildings
    .filter((b) => b.owner === pid && !b.legacy && (BUILDINGS[b.type].energy < 0 || BUILDINGS[b.type].energy > 0) && b.type !== "relay")
    .filter((b) => !touching(s, b).some((i) => s.tiles[i].cb));
  if (!needs.length) return null;
  const sources = s.buildings.filter((b) => BUILDINGS[b.type].energy > 0 || b.type === "depot" || b.type === "engine");
  for (const b of needs) {
    // generators join the nearest consumer; consumers join any cable or generator
    const goals = new Set<number>();
    s.tiles.forEach((t, i) => {
      if (t.cb) goals.add(i);
    });
    const others = BUILDINGS[b.type].energy > 0 ? s.buildings.filter((q) => q.owner && BUILDINGS[q.type].energy < 0 && q.id !== b.id) : sources.filter((q) => q.id !== b.id);
    for (const q of others) for (const i of freeTouch(s, q)) goals.add(i);
    if (!goals.size) continue;
    const path = routeBetween(s, kind, freeTouch(s, b), goals, pid);
    if (path) return path;
  }
  return null;
}

/** A pipe already joins this tank to a pump. */
function pipedIn(s: RoomState, b: Building): boolean {
  return touching(s, b).some((i) => !!s.tiles[i].pp);
}

/** A belt already leads away from this machine. */
function beltedOut(s: RoomState, b: Building): boolean {
  return touching(s, b).some((i) => {
    const bt = s.tiles[i].bt;
    if (!bt) return false;
    const x = (i % s.w) + DIRS[bt.d][0];
    const y = Math.floor(i / s.w) + DIRS[bt.d][1];
    return !inBounds(s, x, y) || s.tiles[y * s.w + x].b !== b.id;
  });
}
