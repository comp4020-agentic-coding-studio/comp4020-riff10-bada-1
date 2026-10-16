// The economy tick: construction, workers, electricity grids, coolant pipes,
// belts, factories, harvesters, heat and pollution. Every allocation runs in
// a fixed order (building id within each kind, grids in tile order), never in
// the order clients' messages arrived, so the same machine doesn't win by
// accident.
import {
  BUILDINGS,
  CABLE_LOSS_TILES,
  HARVEST_MODES,
  HEAT_LIMIT,
  HOPPER_CAP,
  INPUT_CAP,
  INTAKE_RATE,
  INTAKE_TANK,
  KIT_POWER,
  LOBBY,
  NEXT_DATACENTRE,
  OUTPUT_CAP,
  PIPE_BUDGET,
  PIPE_LEAK_EVERY,
  RECIPES,
  STAGES,
  buildingName,
  itemLabel,
  type BuildingType,
  type Item,
  type Recipe,
} from "./content.ts";
import type { Building, RoomState, Tile } from "./protocol.ts";
import { DIRS, components, footprint, inBounds, touching } from "./layout.ts";
import { picketing } from "./lobby.ts";
import { add, complete, destroyAt, event, have, setStatus, takeFrom, workNeeded, type Changes } from "./world.ts";

const centre = (b: Pick<Building, "x" | "y" | "type">): [number, number] => {
  const h = (BUILDINGS[b.type].size - 1) / 2;
  return [b.x + h, b.y + h];
};

export const ring = (s: RoomState, b: Building): number[] => {
  const n = BUILDINGS[b.type].size;
  const out: number[] = [];
  for (let y = b.y - 1; y <= b.y + n; y++)
    for (let x = b.x - 1; x <= b.x + n; x++) {
      if (x >= b.x && x < b.x + n && y >= b.y && y < b.y + n) continue;
      if (inBounds(s, x, y)) out.push(y * s.w + x);
    }
  return out;
};

export const within = (s: RoomState, b: Building, radius: number): number[] => {
  const [cx, cy] = centre(b);
  const out: number[] = [];
  for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++)
    for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++)
      if (inBounds(s, x, y) && Math.max(Math.abs(x - cx), Math.abs(y - cy)) <= radius + 0.5) out.push(y * s.w + x);
  return out;
};

/** Power a building needs per economy tick (a kit's trade-off included). */
export const powerNeed = (b: Building): number => {
  const def = BUILDINGS[b.type];
  if (def.energy >= 0) return 0;
  const kit = b.kit && !(b.type === "factory" && b.quick) ? KIT_POWER[b.type] ?? 0 : 0;
  return Math.max(0, -def.energy + kit);
};

/** Buildings that tap the Bottled Sun on its worlds. */
const isTap = (b: Building): boolean => b.type === "depot" || b.type === "engine";

export interface Grids {
  /** building id -> grid key ("L" for the legacy pool) */
  of: Map<number, string>;
  tiles: Map<string, number>;
}

/** Which cable grid each building is on: anything touching a cable is on that cable's grid. */
export function grids(s: RoomState): Grids {
  const { comp, sizes } = components(s, "cable");
  // a building touching two cable runs joins them
  const parent = sizes.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const touched = new Map<number, number[]>();
  for (const b of s.buildings) {
    const ids = [...new Set(touching(s, b).map((i) => comp[i]).filter((c) => c >= 0))];
    touched.set(b.id, ids);
    for (let k = 1; k < ids.length; k++) parent[find(ids[k])] = find(ids[0]);
  }
  const of = new Map<number, string>();
  const tiles = new Map<string, number>();
  sizes.forEach((n, i) => {
    const k = `g${find(i)}`;
    tiles.set(k, (tiles.get(k) ?? 0) + n);
  });
  for (const b of s.buildings) {
    if (b.legacy) of.set(b.id, "L");
    else {
      const ids = touched.get(b.id)!;
      if (ids.length) of.set(b.id, `g${find(ids[0])}`);
    }
  }
  return { of, tiles };
}

interface Grid {
  supply: number;
  /** power left to hand out this tick */
  avail: number;
  demand: number;
  loss: number;
  tap: boolean;
  solar: number;
  drawn: number;
}

export function economy(s: RoomState, ch: Changes): void {
  s.econTicks++;
  const st = STAGES[s.stage];
  const bottled = st.energySource === "bottled";
  const ops = s.ops;

  // construction: a site rises a step a tick; a picketed datacentre site at half speed, for a bounded while
  for (const b of s.buildings) {
    if (complete(b)) continue;
    const picketed = picketing(s, b) && (b.picket ?? 0) < LOBBY.picketTicks;
    if (picketed) b.picket = (b.picket ?? 0) + 1;
    if (!picketed || s.econTicks % 2 === 0) b.work = Math.min(workNeeded(b), b.work + 10);
    ch.buildings.add(b.id);
    if (picketed) setStatus(b, "under construction: picketed, building at half speed", ch);
    else setStatus(b, "under construction", ch);
    if (complete(b)) setStatus(b, "starting up", ch);
  }
  const built = s.buildings.filter(complete).sort((a, b) => a.id - b.id);
  // milestones, whether a site finished on its own or with players' help
  if (ops.firstFactory === null && built.some((b) => b.type === "factory" && b.owner)) ops.firstFactory = s.tick - s.stageStartTick;
  if (ops.firstDatacentre === null && built.some((b) => b.type === "datacentre" && b.owner)) ops.firstDatacentre = s.tick - s.stageStartTick;
  const of = (t: BuildingType): Building[] => built.filter((b) => b.type === t);
  const plazaTiles = new Set(of("plaza").flatMap((b) => ring(s, b)));

  // workers: homes house 3 unpowered, 6 when cabled to power and served compute, +1 beside a plaza
  let workers = 0;
  for (const city of of("city")) {
    const served = city.status === "ok";
    const byPlaza = footprint(city).some(([x, y]) => plazaTiles.has(y * s.w + x));
    workers += BUILDINGS.city.workers + (served ? 3 : 0) + (byPlaza ? 1 : 0);
  }
  const workersSupply = workers;

  // electricity: each grid has its own supply; nothing draws across a gap
  const G = grids(s);
  const grid = new Map<string, Grid>();
  const g = (k: string): Grid => {
    let v = grid.get(k);
    if (!v) {
      v = { supply: 0, avail: 0, demand: 0, loss: 0, tap: false, solar: 0, drawn: 0 };
      grid.set(k, v);
    }
    return v;
  };
  for (const [k, n] of G.tiles) g(k).loss = Math.floor(n / CABLE_LOSS_TILES);
  for (const b of built) {
    const k = G.of.get(b.id);
    if (!k) continue;
    g(k).demand += powerNeed(b);
    if (isTap(b) || (b.legacy && bottled)) g(k).tap = true;
  }
  for (const p of of("solar")) {
    const k = G.of.get(p.id);
    const out = BUILDINGS.solar.energy * st.solarScale;
    if (!k || out === 0) {
      setStatus(p, out === 0 ? "idle: no sunlight here" : "idle: not cabled to anything (lay a cable)", ch);
      continue;
    }
    g(k).supply += out;
    g(k).solar += out;
    setStatus(p, "ok", ch);
  }
  // furnaces light only when their grid needs more, in id order
  for (const f of of("furnace")) {
    const k = G.of.get(f.id);
    const gr = k ? g(k) : null;
    const out = BUILDINGS.furnace.energy - (f.kit ? KIT_POWER.furnace ?? 0 : 0);
    if (!gr) setStatus(f, "idle: not cabled to anything (lay a cable)", ch);
    else if (gr.supply >= gr.demand + gr.loss) setStatus(f, "banked: its grid has enough power", ch);
    else if (workers < 1) setStatus(f, "idle: no workers (build homes)", ch);
    else if (s.inventory.matter < 1) setStatus(f, `idle: no ${st.families.matter.label} to burn`, ch);
    else {
      workers--;
      // a kit burns cleaner: one unit every other tick
      const burn = f.kit ? ((f.acc = (f.acc ?? 0) + 1) % 2 === 0 ? 0 : 1) : 1;
      s.inventory.matter -= burn;
      if (burn) ch.meta = true;
      gr.supply += out;
      setStatus(f, "ok", ch);
    }
  }
  let reserve = s.reserve;
  for (const gr of [...grid.values()]) {
    if (bottled && gr.tap) {
      // the Bottled Sun: drawn only as needed, and it doesn't refill
      const want = Math.max(0, gr.demand + gr.loss - gr.supply);
      const take = Math.min(want, reserve);
      reserve -= take;
      gr.drawn = take;
      gr.supply += take;
    }
    gr.avail = Math.max(0, gr.supply - (gr.demand > 0 ? gr.loss : 0));
  }
  for (const d of of("depot")) setStatus(d, bottled ? (reserve > 0 ? "ok" : "idle: the Bottled Sun is empty") : "ok", ch);

  // World Engines compute whether or not anything is cabled to them, and tap the reserve when something is
  let compute = 0;
  for (const e of of("engine")) {
    compute += BUILDINGS.engine.compute;
    setStatus(e, "ok", ch);
  }

  let unwired = 0;
  const tankUse = (b: Building, use: number): number => {
    if (!use) return 0;
    // a kit halves the draw: one unit every other tick
    if (b.kit) return (b.acc = (b.acc ?? 0) + 1) % 2 === 0 ? 0 : use;
    return use;
  };
  const coolantHave = (b: Building): number => (b.legacy ? s.inventory.coolant : b.tank ?? 0);
  const take = (b: Building, opts: { pressure?: Set<number>; network?: Set<number>; cool?: boolean } = {}): boolean => {
    const def = BUILDINGS[b.type];
    const need = powerNeed(b);
    const k = G.of.get(b.id);
    const gr = k ? grid.get(k) : undefined;
    let why: string | null = null;
    if (opts.pressure && !opts.pressure.size) why = "idle: no air: no dome is running";
    else if (opts.pressure && !footprint(b).some(([x, y]) => opts.pressure!.has(y * s.w + x))) why = "idle: outside a dome's air";
    else if (opts.network && !opts.network.has(b.id)) why = "idle: not linked to the Depot (build relays)";
    else if (need > 0 && !gr) {
      why = "idle: no power: not cabled to a generator";
      unwired++;
    } else if (need > 0 && gr!.avail < need) why = bottled && reserve === 0 ? "idle: the Bottled Sun is empty" : "idle: no power: its grid is overloaded";
    else if (workers < -def.workers) why = "idle: no workers (build homes)";
    else if (compute < -def.compute) why = "idle: no compute (build a datacentre)";
    else if (opts.cool && (def.coolantUse ?? 0) > coolantHave(b)) why = b.legacy ? `idle: no ${st.families.coolant.label} for cooling` : `idle: tank empty: pipe in ${st.families.coolant.label}, or fill it by hand (F)`;
    if (why) {
      setStatus(b, why, ch);
      return false;
    }
    if (gr) gr.avail -= need;
    workers += Math.min(0, def.workers);
    compute += Math.min(0, def.compute);
    if (opts.cool) {
      const use = tankUse(b, def.coolantUse ?? 0);
      if (b.legacy) s.inventory.coolant -= use;
      else b.tank = (b.tank ?? 0) - use;
      ops.coolantUsed += use;
      if (use) ch.meta = true;
    }
    ops.energyUsed += need;
    setStatus(b, "ok", ch);
    return true;
  };

  // pumps lift coolant from the deposit beside them into their own tanks
  for (const p of of("intake")) {
    const beside = ring(s, p).filter((i) => s.tiles[i].d === "coolant" && s.tiles[i].amt > 0);
    const room = INTAKE_TANK - (p.tank ?? 0);
    if (beside.length === 0) {
      setStatus(p, `idle: no ${st.families.coolant.label} left beside it`, ch);
      continue;
    }
    if (room <= 0) {
      setStatus(p, "idle: tank full (pipe it away, or collect it with F)", ch);
      continue;
    }
    if (!take(p)) continue;
    beside.sort((a, b) => s.tiles[b].amt - s.tiles[a].amt || a - b);
    const into: Partial<Record<Item, number>> = {};
    takeFrom(s, beside[0], Math.min(INTAKE_RATE, room), 0, ch, into);
    const got = into.coolant ?? 0;
    p.tank = (p.tank ?? 0) + got;
    p.made = (p.made ?? 0) + got;
    ch.buildings.add(p.id);
  }
  pipes(s, ch);

  // Mars: air comes from domes
  let pressure: Set<number> | undefined;
  if (st.mechanic === "pressure") {
    pressure = new Set();
    for (const h of of("habitat")) if (take(h, { cool: true })) for (const i of within(s, h, BUILDINGS.habitat.pressureRadius!)) pressure.add(i);
  }
  // Solar System: relays link machines to the depot
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

  let running = 0;
  for (const d of of("datacentre"))
    if (take(d, { pressure, cool: true })) {
      compute += BUILDINGS.datacentre.compute;
      running++;
    }
  if (running) ops.busy++;
  const computeSupply = compute;
  for (const r of of("radiator")) take(r);

  // a factory with nothing it can make draws nothing: idle machines don't consume as if producing
  for (const f of of("factory")) {
    const why = factoryIdle(s, f);
    if (why) setStatus(f, why, ch);
    else factory(s, f, take(f, { pressure }), ch);
  }

  const throttled = st.mechanic === "heat" && s.heat >= HEAT_LIMIT;
  let heat = 0;
  for (const x of of("extractor")) {
    const hopper = Object.values(x.out ?? {}).reduce((a, v) => a + (v ?? 0), 0);
    if (!x.legacy && hopper >= HOPPER_CAP) {
      setStatus(x, "idle: hopper full (belt it away, or collect it with F)", ch);
      continue;
    }
    const targets = ring(s, x).filter((i) => s.tiles[i].d && s.tiles[i].amt > 0);
    if (targets.length === 0) {
      setStatus(x, "idle: nothing left to harvest beside it", ch);
      continue;
    }
    if (!take(x, { pressure, network })) continue;
    heat += BUILDINGS.extractor.heat ?? 0;
    if (throttled && s.econTicks % 2 === 0) {
      setStatus(x, "throttled: too hot (build radiators)", ch);
      continue;
    }
    targets.sort((a, b) => s.tiles[b].amt - s.tiles[a].amt || a - b);
    const mode = HARVEST_MODES[x.mode ?? "intensive"];
    // careful with a kit: full speed, nothing wasted; careful without: one a tick
    const useful = x.mode === "careful" ? (x.kit ? 2 : 1) : mode.useful;
    const into = x.legacy ? s.inventory : (x.out ??= {});
    const [got] = takeFrom(s, targets[0], Math.min(useful, x.legacy ? useful : HOPPER_CAP - hopper), mode.waste, ch, into);
    x.made = (x.made ?? 0) + got;
    if (mode.scar) for (const i of ring(s, x)) {
      const t = s.tiles[i];
      if (t.t === 2 || t.life === 0) continue;
      t.life = Math.max(0, t.life - mode.scar);
      ch.tiles.add(i);
    }
    ch.buildings.add(x.id);
  }
  for (const city of of("city")) {
    const k = G.of.get(city.id);
    const gr = k ? grid.get(k) : undefined;
    const need = powerNeed(city);
    if (gr && gr.avail >= need && compute >= -BUILDINGS.city.compute) {
      gr.avail -= need;
      compute += BUILDINGS.city.compute;
      ops.energyUsed += need;
      setStatus(city, "ok", ch);
    } else setStatus(city, !gr ? "unserved: not cabled to power (houses 4)" : gr.avail < need ? "unserved: no power to spare (houses 4)" : "unserved: no compute (houses 4)", ch);
  }
  for (const p of of("plaza")) setStatus(p, "ok", ch);
  for (const p of of("store")) setStatus(p, "ok", ch);

  // power actually generated where something used it, and what the cables lost
  for (const gr of grid.values()) {
    if (gr.demand === 0) continue;
    const gen = gr.supply - gr.drawn;
    ops.energyGen += gen;
    ops.solarGen += Math.min(gr.solar, gen);
    ops.energyUsed += Math.min(gr.loss, gr.supply);
    ops.cableLoss += Math.min(gr.loss, gr.supply);
  }
  if (bottled) {
    // only what was handed out leaves the reserve; unused draw goes back
    let back = 0;
    for (const gr of grid.values()) if (gr.drawn) back += Math.min(gr.drawn, gr.avail);
    reserve += back;
    if (reserve !== s.reserve) ch.meta = true;
    s.reserve = reserve;
  }

  belts(s, ch);

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
    const radius = b.type === "furnace" && b.kit ? 1 : pol.radius;
    for (const i of within(s, b, radius)) {
      const t = s.tiles[i];
      if (t.t === 2 || t.life === 0) continue;
      t.life = Math.max(0, t.life - pol.amount);
      ch.tiles.add(i);
    }
    if (pol.burnsMatter) {
      const grove = within(s, b, radius).find((i) => s.tiles[i].d === "matter" && s.tiles[i].amt > 0);
      if (grove !== undefined) destroyAt(s, grove, pol.burnsMatter, ch, "burnt away in the smoke");
    }
  }

  const econ = {
    energySupply: [...grid.values()].reduce((a, v) => a + v.supply, 0),
    energyUsed: [...grid.values()].reduce((a, v) => a + (v.supply - v.avail), 0),
    computeSupply,
    computeUsed: computeSupply - compute,
    workersSupply,
    workersUsed: workersSupply - workers,
    unwired,
    drawn: [...grid.values()].reduce((a, v) => a + v.drawn - Math.min(v.drawn, v.avail), 0),
  };
  if (JSON.stringify(econ) !== JSON.stringify(s.econ)) ch.meta = true;
  s.econ = econ;
}

/** The recipe a factory will start next, or why it won't. */
export function nextRecipe(s: RoomState, f: Building): { r: Recipe } | { why: string } {
  const st = STAGES[s.stage];
  const inHand = (r: Recipe): number => have(s, r) + (f.out?.[r] ?? 0) + (f.job?.r === r ? f.job.n : 0);
  if (!f.recipe || f.recipe === "auto") {
    const short = (["wire", "frame"] as Recipe[])
      .map((r) => ({ r, gap: (NEXT_DATACENTRE[r] ?? 0) - inHand(r) }))
      .filter((x) => x.gap > 0)
      .sort((a, b) => b.gap / (NEXT_DATACENTRE[b.r] ?? 1) - a.gap / (NEXT_DATACENTRE[a.r] ?? 1));
    if (!short.length) return { why: `paused: parts for the next ${buildingName(st, "datacentre")} are in hand` };
    // make what it has the inputs for, shortest first
    const ready = short.find((x) => Object.entries(recipeOf(f, x.r).in).every(([k, v]) => (f.buf?.[k as Item] ?? 0) >= (v ?? 0)));
    return { r: (ready ?? short[0]).r };
  }
  if (f.target && inHand(f.recipe) >= f.target) return { why: `paused: target of ${f.target} ${itemLabel(st, f.recipe)} reached` };
  return { r: f.recipe };
}

export const recipeOf = (f: Building, r: Recipe): { in: Partial<Record<Item, number>>; out: number; ticks: number } =>
  f.kit && !f.quick ? RECIPES[r].efficient : RECIPES[r].quick;

/** Why a factory can't do anything this tick (before power is considered), or null. */
function factoryIdle(s: RoomState, f: Building): string | null {
  if (f.job) return null;
  const st = STAGES[s.stage];
  const next = nextRecipe(s, f);
  if ("why" in next) return next.why;
  const rec = recipeOf(f, next.r);
  if ((f.out?.[next.r] ?? 0) + rec.out > OUTPUT_CAP) return "idle: output full (collect it with F, or belt it to a store)";
  const missing = Object.entries(rec.in).find(([k, v]) => (f.buf?.[k as Item] ?? 0) < (v ?? 0));
  if (missing) return `idle: no ${itemLabel(st, missing[0] as Item)} (needs ${missing[1]}, has ${f.buf?.[missing[0] as Item] ?? 0}): load it with F or belt it in`;
  return null;
}

function factory(s: RoomState, f: Building, powered: boolean, ch: Changes): void {
  const st = STAGES[s.stage];
  f.buf ??= {};
  f.out ??= {};
  if (f.job) {
    if (!powered) return; // the batch waits, inputs committed, progress kept
    f.job.left--;
    if (f.job.left > 0) {
      setStatus(f, `making ${itemLabel(st, f.job.r)}`, ch);
      ch.buildings.add(f.id);
      return;
    }
    const { r, n } = f.job;
    f.out[r] = (f.out[r] ?? 0) + n;
    f.made = (f.made ?? 0) + n;
    s.ops.goods += n;
    delete f.job;
    ch.buildings.add(f.id);
    const owner = f.owner ? s.players[f.owner] : undefined;
    event(ch, f.owner ?? "cooperative", owner?.name ?? "the Cooperative", "factory_batch", { machine: f.id, made: `${n} ${r}`, x: f.x, y: f.y });
  }
  const next = nextRecipe(s, f);
  if ("why" in next) {
    if (powered) setStatus(f, next.why, ch);
    return;
  }
  const rec = recipeOf(f, next.r);
  if ((f.out[next.r] ?? 0) + rec.out > OUTPUT_CAP) {
    if (powered) setStatus(f, "idle: output full (collect it with F, or belt it to a store)", ch);
    return;
  }
  const missing = Object.entries(rec.in).find(([k, v]) => (f.buf![k as Item] ?? 0) < (v ?? 0));
  if (missing) {
    if (powered) setStatus(f, `idle: no ${itemLabel(st, missing[0] as Item)} (needs ${missing[1]}, has ${f.buf[missing[0] as Item] ?? 0}): load it with F or belt it in`, ch);
    return;
  }
  if (!powered) return;
  for (const [k, v] of Object.entries(rec.in)) f.buf[k as Item] = (f.buf[k as Item] ?? 0) - (v ?? 0);
  // the committed inputs travel with the batch, so a refund returns exactly them whatever the settings become
  f.job = { r: next.r, n: rec.out, left: rec.ticks, eff: !!(f.kit && !f.quick), in: { ...rec.in } };
  setStatus(f, `making ${itemLabel(st, next.r)}`, ch);
  ch.buildings.add(f.id);
}

/**
 * Coolant pipes: each connected pipe network moves up to PIPE_BUDGET a tick
 * from the pumps touching it to the tanks touching it, emptiest tank first.
 * Cheap pipe leaks: every PIPE_LEAK_EVERY (units x cheap tiles crossed), one
 * unit is lost, counted in a persisted accumulator so nothing rounds to zero.
 */
function pipes(s: RoomState, ch: Changes): void {
  const { comp, sizes } = components(s, "pipe");
  if (!sizes.length) return;
  const cheap = new Array(sizes.length).fill(0);
  s.tiles.forEach((t, i) => {
    if (t.pp && t.pp[1] === 0) cheap[comp[i]]++;
  });
  const sources = new Map<number, Building[]>();
  const sinks = new Map<number, Building[]>();
  for (const b of [...s.buildings].sort((a, c) => a.id - c.id)) {
    if (!complete(b) || b.legacy) continue;
    const nets = [...new Set(touching(s, b).map((i) => comp[i]).filter((c) => c >= 0))];
    for (const n of nets) {
      if (b.type === "intake") (sources.get(n) ?? sources.set(n, []).get(n)!).push(b);
      else if (BUILDINGS[b.type].tank) (sinks.get(n) ?? sinks.set(n, []).get(n)!).push(b);
    }
  }
  for (let n = 0; n < sizes.length; n++) {
    const src = sources.get(n) ?? [];
    const dst = sinks.get(n) ?? [];
    if (!src.length || !dst.length) continue;
    let budget = PIPE_BUDGET;
    while (budget > 0) {
      const from = src.filter((b) => (b.tank ?? 0) > 0).sort((a, b) => (b.tank ?? 0) - (a.tank ?? 0) || a.id - b.id)[0];
      const to = dst.filter((b) => (b.tank ?? 0) < BUILDINGS[b.type].tank!).sort((a, b) => (a.tank ?? 0) - (b.tank ?? 0) || a.id - b.id)[0];
      if (!from || !to) break;
      from.tank = (from.tank ?? 0) - 1;
      budget--;
      s.leak += cheap[n];
      if (s.leak >= PIPE_LEAK_EVERY) {
        s.leak -= PIPE_LEAK_EVERY;
        s.ops.coolantLost++;
        s.ops.coolantUsed++;
      } else to.tank = (to.tank ?? 0) + 1;
      ch.buildings.add(from.id);
      ch.buildings.add(to.id);
      ch.meta = true;
    }
  }
}

/** A splitter's exits: its own arrow, then any side neighbour that is a belt leading away from it. */
function splitExits(s: RoomState, i: number): (0 | 1 | 2 | 3)[] {
  const bt = s.tiles[i].bt!;
  const out: (0 | 1 | 2 | 3)[] = [bt.d];
  for (const side of [((bt.d + 1) % 4) as 0 | 1 | 2 | 3, ((bt.d + 3) % 4) as 0 | 1 | 2 | 3]) {
    const j = ahead(s, i, side);
    const n = j === null ? undefined : s.tiles[j].bt;
    if (n && ahead(s, j!, n.d) !== i) out.push(side);
  }
  return out;
}

/** Where a belt tile delivers: the tile it points at. */
const ahead = (s: RoomState, i: number, d: 0 | 1 | 2 | 3): number | null => {
  const x = (i % s.w) + DIRS[d][0];
  const y = Math.floor(i / s.w) + DIRS[d][1];
  return inBounds(s, x, y) ? y * s.w + x : null;
};

const capOf = (t: Tile): number => (t.bt?.q ? 2 : 1);

/** How many of an item a building would accept from a belt right now. */
function accepts(s: RoomState, b: Building, item: Item): number {
  if (!complete(b)) return 0;
  if (b.type === "store") return 1_000_000;
  if (b.type === "factory") {
    const want = new Set<string>();
    if (b.recipe && b.recipe !== "auto") for (const k of Object.keys(recipeOf(b, b.recipe).in)) want.add(k);
    else for (const r of ["wire", "frame"] as Recipe[]) for (const k of Object.keys(recipeOf(b, r).in)) want.add(k);
    return want.has(item) ? Math.max(0, INPUT_CAP - (b.buf?.[item] ?? 0)) : 0;
  }
  // legacy buildings cool from the stockpile; their tanks take nothing
  if (BUILDINGS[b.type].tank && item === "coolant" && !b.legacy) return Math.max(0, BUILDINGS[b.type].tank! - (b.tank ?? 0));
  return 0;
}

function deliver(s: RoomState, b: Building, item: Item, n: number, ch: Changes): void {
  if (b.type === "store") add(s, item, n);
  else if (b.type === "factory") (b.buf ??= {})[item] = (b.buf[item] ?? 0) + n;
  else b.tank = (b.tank ?? 0) + n;
  ch.buildings.add(b.id);
  ch.meta = true;
  s.ops.firstAutomation ??= s.tick - s.stageStartTick;
}

/**
 * Belts: whole items move one tile per economy tick toward their arrow (two
 * on a fast belt). A tile holds one kind of item. Items can't move twice in
 * a tick, a full destination stops delivery, and nothing is ever deleted or
 * duplicated: a blocked belt just waits. Machines with an output hopper push
 * onto any belt leading away from them, round-robin.
 */
function belts(s: RoomState, ch: Changes): void {
  const beltTiles: number[] = [];
  s.tiles.forEach((t, i) => {
    if (t.bt) beltTiles.push(i);
  });
  if (!beltTiles.length) return;
  const arrived = new Set<number>();
  const moved = new Set<number>();
  // alternate the scan direction so merging belts take turns
  if (s.econTicks % 2) beltTiles.reverse();
  let progress = true;
  while (progress) {
    progress = false;
    for (const i of beltTiles) {
      const t = s.tiles[i];
      const bt = t.bt!;
      if (moved.has(i) || arrived.has(i) || !bt.it || bt.n <= 0) continue;
      // a splitter tries its exits in turn, starting from the one after last time
      const exits = bt.sp ? splitExits(s, i) : [bt.d];
      const item = bt.it;
      let blocked = true;
      for (let e = 0; e < exits.length && blocked; e++) {
        const j = ahead(s, i, exits[((bt.r ?? 0) + e) % exits.length]);
        if (j === null) continue;
        const n = s.tiles[j];
        let k = 0;
        if (n.bt && !n.b) {
          const room = n.bt.it && n.bt.it !== item ? 0 : capOf(n) - n.bt.n;
          k = arrived.has(j) ? 0 : Math.min(room, bt.n, capOf(t));
          if (k > 0) {
            n.bt.it = item;
            n.bt.n += k;
            arrived.add(j);
            ch.tiles.add(j);
          }
        } else if (n.b) {
          const b = s.buildings.find((q) => q.id === n.b)!;
          k = Math.min(accepts(s, b, item), bt.n, capOf(t));
          if (k > 0) deliver(s, b, item, k, ch);
        }
        if (k > 0) {
          bt.n -= k;
          if (bt.n === 0) delete bt.it;
          moved.add(i);
          ch.tiles.add(i);
          blocked = false;
          progress = true;
          if (bt.sp) bt.r = ((bt.r ?? 0) + e + 1) % exits.length;
        }
      }
      const bk = blocked ? 1 : undefined;
      if (bt.bk !== bk) {
        if (bk) bt.bk = 1;
        else delete bt.bk;
        ch.tiles.add(i);
      }
    }
  }
  // clear stale blocked flags on empty tiles
  for (const i of beltTiles) {
    const bt = s.tiles[i].bt!;
    if (!bt.it && bt.bk) {
      delete bt.bk;
      ch.tiles.add(i);
    }
  }
  // machines push their output onto belts that start beside them (a belt passing by picks nothing up)
  const fed = new Set<number>();
  for (const i of beltTiles) {
    const j = ahead(s, i, s.tiles[i].bt!.d);
    if (j !== null && s.tiles[j].bt) fed.add(j);
  }
  for (const b of [...s.buildings].sort((a, c) => a.id - c.id)) {
    if (!complete(b) || !b.out) continue;
    const exits = touching(s, b).filter((i) => {
      const bt = s.tiles[i].bt;
      if (!bt || arrived.has(i) || fed.has(i)) return false;
      const j = ahead(s, i, bt.d);
      return j === null || s.tiles[j].b !== b.id;
    });
    if (!exits.length) continue;
    const items = (Object.keys(b.out) as Item[]).filter((k) => (b.out![k] ?? 0) > 0).sort();
    for (let k = 0; k < exits.length; k++) {
      const i = exits[((b.rr ?? 0) + k) % exits.length];
      const bt = s.tiles[i].bt!;
      // a factory sends its goods; a harvester its whole hopper, one kind per tile
      const item = bt.it ?? items.find((it) => (b.out![it] ?? 0) > 0);
      if (!item || (b.out[item] ?? 0) <= 0) continue;
      const room = capOf(s.tiles[i]) - bt.n;
      const n = Math.min(room, b.out[item]!);
      if (n <= 0) continue;
      bt.it = item;
      bt.n += n;
      b.out[item]! -= n;
      ch.tiles.add(i);
      ch.buildings.add(b.id);
    }
    b.rr = ((b.rr ?? 0) + 1) % 1024;
  }
}

/** Items riding a belt tile, for refunds and totals. */
export const beltLoad = (t: Tile): [Item, number] | null => (t.bt?.it && t.bt.n > 0 ? [t.bt.it, t.bt.n] : null);

/** Every whole item held outside the stockpile: machine buffers, hoppers, tanks and belts. */
export function heldItems(s: RoomState): Partial<Record<Item, number>> {
  const out: Partial<Record<Item, number>> = {};
  const put = (k: Item, n: number): void => {
    out[k] = (out[k] ?? 0) + n;
  };
  for (const b of s.buildings) {
    for (const st of [b.buf, b.out]) if (st) for (const [k, v] of Object.entries(st)) put(k as Item, v ?? 0);
    if (b.tank) put("coolant", b.tank);
  }
  for (const t of s.tiles) {
    const l = beltLoad(t);
    if (l) put(l[0], l[1]);
  }
  return out;
}
