// Grid helpers shared by the simulation, the renderer's previews and the
// playtest bot: footprints, ports, line placement rules and routing. Pure
// functions over RoomState, so a preview and the server's verdict agree.
import { BUILDINGS, CLAIM_SIZE, LINE_RANGE, MAX_LINE_TILES, PATH_SPEED, PLAYER_SPEED, STAGES, type BuildingType, type LineKind } from "./content.ts";
import type { Building, Claim, RoomState, Tile } from "./protocol.ts";

export const DIRS: [number, number][] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];

export const inBounds = (s: Pick<RoomState, "w">, x: number, y: number): boolean => x >= 0 && y >= 0 && x < s.w && y < s.w;

export const footprint = (b: Pick<Building, "x" | "y" | "type">): [number, number][] => {
  const n = BUILDINGS[b.type].size;
  const out: [number, number][] = [];
  for (let dy = 0; dy < n; dy++) for (let dx = 0; dx < n; dx++) out.push([b.x + dx, b.y + dy]);
  return out;
};

/** Tiles orthogonally touching a building's footprint, outside it. */
export function touching(s: Pick<RoomState, "w">, b: Pick<Building, "x" | "y" | "type">): number[] {
  const n = BUILDINGS[b.type].size;
  const out: number[] = [];
  for (let k = 0; k < n; k++) {
    for (const [x, y] of [
      [b.x + k, b.y - 1],
      [b.x + k, b.y + n],
      [b.x - 1, b.y + k],
      [b.x + n, b.y + k],
    ])
      if (inBounds(s, x, y)) out.push(y * s.w + x);
  }
  return out;
}

export const hasLine = (t: Tile, kind: LineKind): boolean =>
  kind === "cable" ? !!t.cb : kind === "pipe" ? !!t.pp : kind === "belt" ? !!t.bt : !!t.pa;

export const lineOwner = (t: Tile, kind: LineKind): string | undefined =>
  kind === "cable" ? t.cb : kind === "pipe" ? t.pp?.[0] : kind === "belt" ? t.bt?.o : t.pa?.[0];

export const claimAt = (s: Pick<RoomState, "claims">, x: number, y: number): Claim | undefined =>
  s.claims.find((c) => x >= c.x && y >= c.y && x < c.x + CLAIM_SIZE && y < c.y + CLAIM_SIZE);

/** Why a line of this kind can't go on this tile (for this player), or null. */
export function lineTileProblem(s: RoomState, kind: LineKind, x: number, y: number, pid: string | undefined): string | null {
  if (!inBounds(s, x, y)) return "off the edge of the map";
  const t = s.tiles[y * s.w + x];
  if (t.b) return "a building stands there: go around it";
  if (t.t === 1) return "can't lay it across water";
  if (t.t === 3) return "can't lay it on the star itself";
  if (kind === "path" && t.t === 2) return "nothing to walk on out there";
  const c = claimAt(s, x, y);
  if (c && pid && c.owner !== pid) return `that's ${s.players[c.owner]?.name ?? "someone"}'s land`;
  return null;
}

/** Shortest orthogonal route for a line, reusing tiles that already carry it. */
export function route(s: RoomState, kind: LineKind, from: [number, number], to: [number, number], pid: string | undefined): [number, number][] | null {
  const ok = (x: number, y: number): boolean => lineTileProblem(s, kind, x, y, pid) === null;
  if (!ok(from[0], from[1]) || !ok(to[0], to[1])) return null;
  const start = from[1] * s.w + from[0];
  const goal = to[1] * s.w + to[0];
  const prev = new Map<number, number>([[start, -1]]);
  const queue = [start];
  for (let qi = 0; qi < queue.length && !prev.has(goal); qi++) {
    const i = queue[qi];
    const x = i % s.w;
    const y = Math.floor(i / s.w);
    for (const [dx, dy] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      const ni = ny * s.w + nx;
      if (!inBounds(s, nx, ny) || prev.has(ni) || !ok(nx, ny)) continue;
      prev.set(ni, i);
      queue.push(ni);
    }
  }
  if (!prev.has(goal)) return null;
  const path: [number, number][] = [];
  for (let i = goal; i !== -1; i = prev.get(i)!) path.push([i % s.w, Math.floor(i / s.w)]);
  path.reverse();
  return path.length <= MAX_LINE_TILES ? path : null;
}

/**
 * Shortest orthogonal route for a line from any of `starts` to any of
 * `goals` (tile indices), reusing tiles that already carry it. Used by the
 * playtest bot to connect a machine to a grid; the server checks the path it
 * sends like any other.
 */
export function routeBetween(s: RoomState, kind: LineKind, starts: number[], goals: Set<number>, pid: string | undefined): [number, number][] | null {
  const ok = (i: number): boolean => lineTileProblem(s, kind, i % s.w, Math.floor(i / s.w), pid) === null;
  const prev = new Map<number, number>();
  const queue: number[] = [];
  for (const i of starts) if (ok(i) && !prev.has(i)) {
    prev.set(i, -1);
    queue.push(i);
  }
  let hit = -1;
  for (let qi = 0; qi < queue.length; qi++) {
    const i = queue[qi];
    if (goals.has(i)) {
      hit = i;
      break;
    }
    const x = i % s.w;
    const y = Math.floor(i / s.w);
    for (const [dx, dy] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      const ni = ny * s.w + nx;
      if (!inBounds(s, nx, ny) || prev.has(ni) || !ok(ni)) continue;
      prev.set(ni, i);
      queue.push(ni);
    }
  }
  if (hit < 0) return null;
  const path: [number, number][] = [];
  for (let i = hit; i !== -1; i = prev.get(i)!) path.push([i % s.w, Math.floor(i / s.w)]);
  path.reverse();
  return path.length <= MAX_LINE_TILES ? path : null;
}

/** Direction index from one tile to an orthogonal neighbour. */
export const dirTo = (a: [number, number], b: [number, number]): 0 | 1 | 2 | 3 =>
  (DIRS.findIndex(([dx, dy]) => a[0] + dx === b[0] && a[1] + dy === b[1]) as 0 | 1 | 2 | 3);

/** Belt directions along a path: each tile points at the next; the last keeps going (or `last`). */
export function beltDirs(path: [number, number][], last?: 0 | 1 | 2 | 3): (0 | 1 | 2 | 3)[] {
  const out: (0 | 1 | 2 | 3)[] = [];
  for (let k = 0; k < path.length; k++) {
    if (k < path.length - 1) out.push(dirTo(path[k], path[k + 1]));
    else out.push(last ?? (k > 0 ? out[k - 1] : 0));
  }
  return out;
}

/** Connected components of tiles carrying `kind` (orthogonal adjacency). */
export function components(s: RoomState, kind: "cable" | "pipe"): { comp: Int32Array; sizes: number[] } {
  const comp = new Int32Array(s.tiles.length).fill(-1);
  const sizes: number[] = [];
  for (let i = 0; i < s.tiles.length; i++) {
    if (comp[i] >= 0 || !hasLine(s.tiles[i], kind)) continue;
    const id = sizes.length;
    let n = 0;
    const stack = [i];
    comp[i] = id;
    while (stack.length) {
      const j = stack.pop()!;
      n++;
      const x = j % s.w;
      const y = Math.floor(j / s.w);
      for (const [dx, dy] of DIRS) {
        const nx = x + dx;
        const ny = y + dy;
        const nj = ny * s.w + nx;
        if (inBounds(s, nx, ny) && comp[nj] < 0 && hasLine(s.tiles[nj], kind)) {
          comp[nj] = id;
          stack.push(nj);
        }
      }
    }
    sizes.push(n);
  }
  return { comp, sizes };
}

export const buildingAt = (s: RoomState, x: number, y: number): Building | undefined => {
  if (!inBounds(s, x, y)) return undefined;
  const id = s.tiles[y * s.w + x].b;
  return id ? s.buildings.find((b) => b.id === id) : undefined;
};

/** Can a line route be planned from this player's range? Shared with the client preview. */
export function linePathProblem(s: RoomState, kind: LineKind, path: [number, number][], p: { id: string; x: number; y: number } | undefined): string | null {
  if (path.length < 1 || path.length > MAX_LINE_TILES) return `a line is 1 to ${MAX_LINE_TILES} tiles`;
  const seen = new Set<number>();
  for (let k = 0; k < path.length; k++) {
    const [x, y] = path[k];
    if (!Number.isInteger(x) || !Number.isInteger(y)) return "malformed line";
    const why = lineTileProblem(s, kind, x, y, p?.id);
    if (why) return why;
    const i = y * s.w + x;
    if (seen.has(i)) return "a line can't cross itself";
    seen.add(i);
    if (k > 0 && Math.abs(x - path[k - 1][0]) + Math.abs(y - path[k - 1][1]) !== 1) return "a line runs tile to tile, no gaps";
    if (p && Math.hypot(x - p.x, y - p.y) > LINE_RANGE) return "too far away: walk closer";
  }
  return null;
}

export const isStageBuilding = (stage: number, type: BuildingType): boolean => STAGES[stage].buildings.includes(type);

/** Walking speed at a position: faster along a path. Shared by the server and the browser's prediction. */
export function speedAt(s: Pick<RoomState, "w" | "tiles">, x: number, y: number): number {
  const tx = Math.round(x);
  const ty = Math.round(y);
  const t = inBounds(s, tx, ty) ? s.tiles[ty * s.w + tx] : undefined;
  return PLAYER_SPEED * (t?.pa ? PATH_SPEED : 1);
}
