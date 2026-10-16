// Saved-state migrations, applied by server/store.ts when a row's schema is
// older than SCHEMA_VERSION. Pure functions over parsed JSON, so the spec can
// run them without a database.
import { FAMILIES } from "../shared/content.ts";
import type { Ledger, RoomState } from "../shared/protocol.ts";
import { newLobby } from "../shared/lobby.ts";
import { emptyOps } from "../shared/sim.ts";
import { emptyGoods } from "../shared/world.ts";

type Json = Record<string, unknown>;

const withRestored = (l: Json): Ledger => {
  for (const f of FAMILIES) {
    const e = l[f] as Json;
    e.restored ??= 0;
  }
  return l as unknown as Ledger;
};

/**
 * Schema 1 -> 2: the factory chain, claims, networks and the Green Lobby.
 * The room keeps its world, buildings (datacentres included) and stockpile,
 * and gets no goods, no claims and zero restored stock. Its existing
 * buildings are marked `legacy`: they share one grid of their own, cool
 * from the stockpile and deliver into it, as they did before, so loading an
 * old room never strands its economy. New buildings follow the new rules.
 */
export function migrate1to2(raw: Json): RoomState {
  const s = raw as unknown as RoomState & Json;
  s.v = 2;
  withRestored(s.ledger as unknown as Json);
  for (const h of (s.history ?? []) as unknown as Json[]) withRestored(h.ledger as Json);
  if (s.phase?.k === "transition") withRestored(s.phase.summary.ledger as unknown as Json);
  s.goods = emptyGoods();
  s.claims = [];
  s.nextClaimId = 1;
  s.ops = emptyOps();
  s.leak = 0;
  s.lobby = newLobby(s.stage, s.ledger);
  s.econ = { ...s.econ, unwired: 0, drawn: 0 };
  for (const b of s.buildings) {
    b.legacy = true;
    if (b.type === "extractor") b.mode = "intensive";
  }
  for (const p of Object.values(s.players)) p.mode ??= "careful";
  return s;
}

export function migrate(raw: Json, from: number): RoomState {
  let s = raw;
  if (from < 2) s = migrate1to2(s) as unknown as Json;
  return s as unknown as RoomState;
}
