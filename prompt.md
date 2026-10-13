# The datacentre is the summit, not the second building

## What we want

Right now a Datacentre on Earth costs 10 stone and 6 timber, so most rooms
have one within a few minutes, and the bot builds it third. We want it to
be the **last thing a group earns on each world**: the payoff of a supply chain
and of staking out ground, not a starter building.

The new arc on every stage:

1. **Gather raw stock.** Harvest by hand and with Harvesters as now. Metal has
   to be one of the things players visibly collect. On Earth, that means the
   player sees and harvests **metal ore**: either relabel Earth's `mineral`
   family as ore, or add ore deposits. Pick the cleaner option, record it in
   `docs/DECISIONS.md`, and keep `ledgerHolds` true either way.
2. **Build a Factory and make parts.** Add a Factory building that turns raw
   inventory into **manufactured goods**. At minimum: **wire** (from metal) and
   one more part a datacentre plausibly needs, such as circuit boards (wire +
   stone/silica) or a steel frame (metal + matter). It's a real building in the
   existing economy: it needs power and workers, shows its status in the
   inspect panel, and says what it's missing when idle ("idle: no ore").
   Production is automatic per economy tick, or players choose a recipe;
   your call.
3. **Capture land.** A player claims a plot of ground (for example a 4×4
   square) with a new command. A claim is theirs: the server refuses anyone
   else's build or demolish on it, and the renderer shows the boundary in the
   owner's colour with their name. Claims cost something or are capped per
   player, so nobody grabs the whole map. Claimed ground must never make a
   deposit unreachable: walking stays free everywhere, and a claim never
   stops anyone harvesting.
4. **Build the Datacentre.** It now costs manufactured goods (wire, the
   second part, plus a little raw stock), and it can only be placed entirely
   inside a plot the builder has claimed. `placementProblem` gives a clear
   reason for each failure: "needs 6 wire (have 2)", "claim this ground
   first", "that's Ada's land".

Use the same chain on every stage, with the stage's own names (Mars, the Sun,
the Solar System and the Universe have their own words for everything already
in `STAGES[].names` and `families`). Retune each later stage's `starter`
bundle so a group can't skip the chain, and can't stall before reaching it.

## What good looks like

- A new player still gets a satisfying first ten minutes. They harvest, build
  homes, power and a Factory, and see wire appear in the shared inventory.
  The Datacentre becomes something they can see coming and plan for. The
  HUD's goal checklist (around `client/Game.tsx:537`) walks them through the
  new order.
- The build bar shows goods costs next to raw costs and greys out what can't
  be afforded, as it does now.
- Compute still matters as much as before. Harvesters still need compute, so
  automation now waits until a group has worked through the chain and claimed
  land. That's the point: dependency arrives later and costs more.
- **Every claim, build, demolish and factory batch is logged on the
  server** as one line per action with the player's id and display name, room
  and stage, so `flyctl logs` alone shows who did what. The next crit is
  narrated from those logs.
- **The ownership rule is written down.** Add a short section to
  `docs/DECISIONS.md` (or a new ADR in `docs/adr/`) covering what a claim lets
  its owner do, what it stops others doing, what the host can override, and
  why.

## Rules that still hold

Read the "What the game must never do" and "What a change must not break"
sections of `CLAUDE.md` and keep every one of them.

- The server decides. A claim, factory recipe or datacentre placement is
  validated in `shared/sim.ts`, whatever the client sends.
- Manufactured goods are a separate, whole-number, never-negative inventory.
  They don't count as natural stock, so turning ore into wire changes
  `inventory`, not the `ledger`. Salvaging a Factory or a Datacentre returns
  strictly less than it cost, goods included.
- This changes the wire format and saved state. Bump `PROTOCOL_VERSION` and
  `SCHEMA_VERSION`, and add a migration in `server/store.ts` so saved rooms
  load with no goods, no claims and their existing datacentres kept.
- Balance lives in `shared/content.ts`.

## How to finish

- Update `scripts/playbot.ts` so the bot follows the new order on every stage:
  gather, factory, parts, claim, datacentre. Run a full campaign with bots at
  `rapid` pace to prove nothing stalls, then measure normal pace on Earth with
  hand-harvest-only bots. Put the new times in `docs/DESIGN.md`, plus the new
  rows in its building table.
- Add tests in `spec/sim.test.ts` for each of these:
  - a datacentre is refused without goods
  - it is refused outside a claim
  - it is refused on someone else's claim
  - a factory turns ore into wire and the ledger still holds
  - a claim never blocks a harvest
  - salvage is below cost
- Update `README.md` (the player guide) for the new progression.
- `pnpm check` passes, `main` deploys, and you delete this `prompt.md` in your
  last commit.

## Leave alone

The stage order, the five mechanics (pollution, pressure, heat, relay,
legacy), the restraint ending and the empty-room pause. This brief only
changes how a group gets to a datacentre, so don't redesign anything else.
