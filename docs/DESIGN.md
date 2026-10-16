# Design

The question the brief keeps returning to: what does the player gain from the next act of expansion, and what becomes impossible to recover because of it? Every system below is an answer to one half of that sentence.

## Direction

Three directions were sketched in the first hour (the comparison is in [`DECISIONS.md`](DECISIONS.md)). The one chosen, **Plenty**, frames the whole campaign as a cheerful cooperative ("the Plenty Cooperative") whose memos, building names and arrival lines are friendly and never sinister. The critique lives in the gap between the copy and the land: the Cooperative thanks you for your growth while the screen browns behind it.

The emotional arc follows the brief's sequence, and each beat comes from a system rather than a speech:

| Beat | Where it comes from |
| --- | --- |
| discovery | a small island with named places, birds, flowers, a pond that shimmers |
| attachment | landmarks seeded by the Cooperative, plus up to three places each player names |
| ambition | the memo's chain, each step unlocking a visibly better machine; wire appearing in the stockpile |
| dependency | a datacentre needs a factory's parts, your own claim, workers, power and pond water; harvesters need its compute |
| acceleration | harvesters out-gather a person; the stock bars start to fall by themselves |
| loss | stumps, mud where the pond was, brown grass, the birdsong thinning out, archive lines ("Heron Pond was harvested bare") |
| no frontier | the Universe ends; the machine keeps searching; nothing is found |

## The core loop

Explore, gather by hand, house workers, power a factory, make parts, stake a claim, earn a datacentre, then lay belts and pipes so the machine feeds itself, find what's holding it back, and choose: more cheap capacity, or efficient equipment that costs parts now and saves stock later. Hand gathering never goes away (it's the recovery path), but once the first automated line runs, play shifts to layout, bottlenecks and the next improvement, with the Green Lobby replanting behind you.

## Economy

Everything is whole numbers, defined in [`shared/content.ts`](../shared/content.ts). Units are normalised per world rather than scaled up: a world holds about two thousand units whatever it is, so a galaxy and a grove are both "a deposit of about twenty-five" and no large-number representation is needed. The scale is told by the names, the map and the camera, not by digits.

- **Natural stock**: deposits on tiles, finite. Three families per world (matter, mineral, coolant), relabelled per world: timber, metal ore and fresh water on Earth; plasma, magnetics and shade on the Sun.
- **Stockpile**: the room's single shared store, in two halves: raw stock (`inventory`) and manufactured goods (`goods`: wire, frames, efficiency kits, each with its own name per world). Spending is atomic and can't go negative.
- **Local stores**: machines keep their own whole-number buffers: a factory's inputs and outputs, a harvester's hopper, a tank of coolant. Nothing reaches across the map for them: a player loads and collects by hand (`F`), or a belt or pipe connects them.
- **Capacity**: power, compute and workers are flows recomputed every economy tick, never stored. Power belongs to a cable grid, not the room. The exception is the Bottled Sun, a stored energy reserve (below).

### The chain on every world

Gather, house workers, power, a factory, parts, a claim, a datacentre, then automation and a bottleneck. The goal checklist (the Cooperative memo) walks it on every world in that world's words. Hand harvesting always works, and nothing on the chain is a gate for leaving a world: a world ends at exact exhaustion, whatever's built.

| Building | Job | Needs | Gives |
| --- | --- | --- | --- |
| Cottages (city, 2×2) | housing | nothing | 4 workers; 7 when cabled to power and served 1 compute; +1 beside a plaza |
| Furnace | power | 1 worker, 1 matter a tick, only while its grid needs more | 5 power on its own grid; smoke browns 2 tiles around and burns a nearby grove |
| Sun Garden (solar, 2×2) | power | ground | 2 power (×2 on Mars, ×4 at the Sun); none in the Solar System or Universe |
| Factory (2×2) | parts | 2 power, 1 worker, never compute | runs its recipe from its input buffer into its output buffer |
| Store | logistics | nothing | the end of a belt: whatever arrives goes into the shared stockpile |
| Pump (intake) | coolant | 1 power, a coolant deposit beside it | lifts 2 coolant a tick into its 20-unit tank |
| Datacentre (2×2) | compute | 6 wire, 2 frames, 4 ore, 4 timber; your own claim; 2 power, 2 workers, 1 coolant a tick from its 30-unit tank | 4 compute |
| Harvester (extractor) | automation | 6 ore, 4 timber; 1 power, 1 compute | takes from its richest neighbour into a 10-unit hopper: intensive 2 + destroys 1 and scars the ground, careful 1 (2 with a kit) |
| Plaza | social | nothing | +1 worker to an adjacent city |
| Dome (Mars, 2×2) | life support | 1 power, 1 ice a tick from its tank | air within 4 tiles; everything but homes and pumps needs it |
| Radiator (the Sun) | heat | 1 power | sheds 5 heat a tick |
| Relay (Solar System) | logistics | nothing | links machines within 5 tiles to the Depot network |
| Depot, World Engine | shared | none: generated with the world | the taps on the Bottled Sun: cable a grid to one for power |

The first factory costs 8 ore and 6 timber and needs only homes and a cable to a generator; it needs no compute, so the bootstrap has no circular dependency. Each later world's starter crate (`STAGES[].starter`) covers its first homes, power and factory but never a single manufactured good, so nobody skips the chain and nobody stalls before it.

### Recipes

| Recipe | Quick | Efficient (with a kit) |
| --- | --- | --- |
| Wire | 3 ore → 2 wire, 1 tick | 3 ore → 3 wire, 2 ticks |
| Frame | 4 ore + 3 timber → 1 frame, 1 tick | 3 ore + 2 timber → 1 frame, 2 ticks |
| Efficiency kit | 2 wire + 1 frame → 1 kit, 2 ticks | same |

A factory's default recipe ("parts for the next datacentre") makes whichever of wire and frames is furthest short of 6 and 2, counting what's in the stockpile, its own buffer and the batch it's on, then pauses. A chosen recipe can carry a target that pauses it. A batch commits its inputs when it starts and finishes as started: changing the recipe, a reconnect or a save and reload never refunds or duplicates it. A factory with nothing it can make draws no power. Its status always says which of the three things it's waiting on: inputs ("idle: no metal ore (needs 3, has 1)"), power or workers, or a full output.

### Fast and sustainable

| Choice | Rushed | Sustainable |
| --- | --- | --- |
| hand harvesting (`M`) | intensive: 2 useful, 1 destroyed, the tile scarred | careful: 1 useful, nothing wasted; always takes the last unit |
| harvesters | intensive by default | careful: 1 a tick; 2 with a kit |
| power on Earth | furnace: 5 power, burns timber and groves | Sun Garden: 2 power, clean, takes ground |
| construction | standard: cheap, quick, leaves 15% life | efficient: +2 wire, +1 frame, 1.5× the work, leaves 45% life, kit built in |
| pipes | cheap: 1 ore a tile, leaks | sealed: +1 wire a tile, no leak |
| belts, paths | cheap and narrow; a rough track tramples the ground | fast belt carries 2; a laid path barely marks it |

An efficiency kit fitted to a building (or built in by efficient construction) does one specific thing, named in its inspect panel: a factory gets the efficient recipes and draws 1 less power; a datacentre or dome drinks half the coolant; a harvester runs careful at full speed; a furnace burns half the fuel, its smoke reaches 1 tile, and it gives up 1 power. Fitting one costs a real kit, improves future operation and undoes no earlier damage. Collateral loss is recorded as `destroyed`, useful output as `extracted`, and both come off the deposit; consuming stock already in a store never counts twice.

### Networks

| Network | Mechanism | Choice |
| --- | --- | --- |
| Cable | anything touching a cable is on its grid; a grid has only what its own generators (or a Bottled Sun tap) make; every 16 tiles lose 1 power | short shared runs cost less and lose less |
| Pipe | a connected pipe network moves 6 coolant a tick from pump tanks to the emptiest tanks touching it | cheap pipe loses 1 unit per 160 (unit × cheap tile) carried, counted in a saved accumulator; sealed loses nothing |
| Belt | each tile points one way; whole items move one tile per economy tick (two on a fast belt); a tile holds one kind of item; a full destination stops it, shown with a cross | machines push their output onto belts that start beside them, round-robin; merges take turns; a belt laid off the side of another turns that tile into a splitter that alternates items between straight on and the branch |
| Path | walking is 60% faster on it, and the browser predicts it the same way | a rough track is cheap and tramples; a laid path costs more and barely marks the ground |

Lines go on open ground, around buildings and water, up to 32 tiles, and different kinds can share a tile without joining. Taking a line tile up (`X`) refunds half its cost and returns whatever was riding it, once. Machine allocation runs in building-id order and grids in tile order, so the same machine never wins because of whose message arrived first.

**Idle states are text, not colour.** Every idle building shows a `!` (or `~` when throttled) and its inspect panel says why: "idle: no power: not cabled to a generator", "idle: tank empty: pipe in fresh water, or fill it by hand (F)", "idle: hopper full (belt it away, or collect it with F)". The stockpile panel names the commonest reason across the whole machine.

**Bad decisions are recoverable.** Hand harvesting needs nothing, so the room can always gather. Taking a building down refunds half of what it cost, goods and fitted kits included, rounded down, so always strictly less; what it held comes back separately and exactly once. Spent deposits become buildable ground. Nothing invents resources except the Green Lobby's finite seed bank.

## Claims

A claim is a 4×4 square, 3 timber, at most two per player per world. Only its owner (or the host) builds or takes things down on it, and a datacentre has to sit entirely inside its builder's own claim. A claim never stops anyone walking, harvesting or connecting a line at its edge, and it can't be drawn over another player's building or line. The full rule, and why, is in [`DECISIONS.md`](DECISIONS.md#who-owns-what).

## The Green Lobby

Server-run environmental agents with straw hats and placards ("Trees not servers", "Enough is plenty") who walk the map on the server's tick, so every browser sees the same lobbyist in the same place. A lobbyist walks to the most harvested-down deposit near them and puts stock back, 1 a tick and up to 6 a visit, from a seed bank that holds a fixed share of the world's initial stock per family (Earth: 12% of timber, 4% of ore, 10% of water; Mars: 5% of its ice). Every unit is recorded as `restored`, so each family's books read `initial + restored = remaining + extracted + destroyed`, and `restored` can never exceed the bank it started with.

There are two at first, one more for every running factory and two more for every datacentre, up to seven. An unfinished datacentre site draws one to picket it: standing beside it, it rises at half speed for at most 20 economy ticks in all, then the picket gives up. It never takes anything and never blocks completion. When the bank runs dry the lobby packs up and goes home, and a world spent at exact exhaustion moves on before anyone can plant in it again. The HUD shows who's out, what's left in the bank, and a log line for each visit ("Fern replanted the Old Oak's grove (+6)"). Why only Earth and Mars: [`DECISIONS.md`](DECISIONS.md#the-green-lobby-across-worlds).

## Environment

Each tile carries a `life` value from 0 to 100, owned by the server:

- harvesting a deposit drops its tile's life with its remaining stock (a tree becomes a stump, a pond tile becomes mud), and a deposit harvested bare takes 15 life from each neighbour
- a building turns its footprint to 15 life (plazas excepted)
- operating harvesters scar a 1-tile radius, furnaces a 2-tile radius, every economy tick
- the land holds only as much life as its world has left: every tile's life is capped at `15 + 85 × (0.6 × share of all stock left + 0.4 × share of coolant left)`, so the whole island dries as it's consumed, not just the tiles anyone touched, and draining the pond (the world's water) costs more than its share

In the first full playthrough with only local damage, Earth ended at 82% living land: still a green island. Capping by coolant alone ended the same playthrough at 12%, brown to the edges, but bots that drained the pond first browned the island before anything was built, so loss arrived before attachment. The blended cap makes desolation track overall consumption in whatever order it happens.

The renderer turns that into grass that drains from green to brown, wilting trees, a shrinking pond, fewer birds and butterflies (count ∝ life^1.5), fewer bird calls, quieter wind and water, a rising machine hum, and thinner, slower music. The Sun dims the entire scene as its plasma goes; in the Universe the background stars go out as galaxies are siphoned.

**Memory.** Landmarks are named tiles. When a named tile is harvested bare, burnt, built over, or left behind at the end of a world, an archive line records it ("The Old Oak was harvested bare", "Picnic Hill became a Furnace"). Every transition shows that world's ledger and its lost places; the ending lists all of them.

The Green Lobby is the one source of new stock, and it's bounded by its seed bank (above). Sustainable machinery saves inputs; it never creates them. The one collective act of conservation is still the restraint ending (below).

## Stages and transitions

Each world is data in `STAGES` plus one mechanic switch in the economy tick. Map sizes (24, 26, 28, 30, 32 tiles square) grow with each stage; profiling showed even the largest is cheap (see [`TESTING.md`](TESTING.md)), so they're sized for pacing, not performance.

**Exhaustion is exact.** A world ends when every deposit tile's remaining stock is zero, and nothing else counts: inventory, power, scenery. Each family keeps a ledger, `initial + restored = remaining + extracted + destroyed`, asserted every tick in the spec. Buildings can't be placed on a deposit with stock left, and nothing blocks movement, so no deposit can ever be trapped or unreachable. The survey overlay (`V`) outlines every remaining deposit and an arrow points at the nearest.

**Transition.** The server takes the last unit, records the world's summary and archive, switches the room to `transition` (mutations refused), persists, and broadcasts. Nine seconds later (five on the rapid preset) it generates the next world from the room's seed, increments the stage generation, persists, and sends everyone a fresh snapshot. No final payment, no readiness vote, so an absent player can't block anyone. Carried forward: identity, colour, stats, the history and archive, and the Bottled Sun. Each world starts with a small Cooperative "starter crate" of materials; inventory from the old world stays behind.

**The Sun's legacy.** Every unit of plasma extracted becomes 4 units of the Bottled Sun; plasma an intensive scoop destroyed becomes nothing. The Solar System and Universe have no solar power at all; every machine there draws on that finite reserve through a cable to the Depot or a World Engine, only as much as its grid needs that tick, and the HUD shows the draw and the runtime left at that rate. So consuming the Sun carefully, and running efficient machines afterwards, determines how long automation lasts. When it runs out, machines go idle and the room gathers by hand again. In the Universe the host can render down a World Engine (one of your spent worlds, running as compute) for 160 energy, a one-way act recorded in the archive.

**The ending.** When the Universe is empty the room enters `ended` for good. The camera pulls back over the dark map, the music stops (ambience and hum continue), and a card reads: "There is nothing left. The machine runs perfectly. It has no input. Somewhere in its last datacentre, a process is still searching for a next frontier." Below it, a search line blinks "0 found", then a table of every world (used, wasted, put back by the lobby, left, parts made, how long its datacentres ran), the archive of named places, and who did what. Players can put the card aside to look at the dead world. A new campaign is an explicit button that makes a new room; the finished one stays finished.

**The restraint ending.** In the Universe, and only there, a panel offers to stop: "N units of the Universe are left. You could stop here and leave them alone, for good." Each player votes; harvesting or building takes your vote back, so you can't vote to stop with your hands still in the till. When everyone present agrees, the campaign ends with the rest still out there (recorded in the ledger as _remaining_ and in the archive as "left alone"), the music keeps playing, and the card reads "You stopped. The Cooperative's machine idles. It could have finished. Nobody asked it to." Absent players can't block it, and a holdout's dropped connection never triggers it: if they leave, someone still here confirms by voting again. It's irreversible and it costs the full ending, so it only means something to a group that has argued about it. Restraint is offered only at the last world on purpose: by then every earlier world is already spent, so stopping saves something without pretending to undo anything.

## Multiplayer rules

- Natural stock and the stockpile are communal; buildings, lines and claims are owned, and the owner (or the host) controls them; stats (harvested, built, helped) are individual and shown at the end.
- Cooperation is mechanical, not just social: several players pressing `E` beside a site raise it faster, and dividing work (one gathers ice while another builds domes) is the only way the dependent stages flow.
- Tension is built in: the shared stockpile lets one player's furnace burn the grove another player named.
- The host is whoever created the room, or the longest-connected player when the host is away. The host can take down anyone's building and render down World Engines.
- A departed player's buildings stay up and keep working, under their name; they come back as themselves via their browser's token.
- Late joiners land in the current world at the spawn point and can do everything at once.
- Safeguards: no chat (emotes only, so no user text except names, which are cleaned and capped), only owners and hosts can demolish or reconfigure, 40 messages a second per connection, 2 KB per message, eight players per room.
- Every action is a line in the server's log, with the room, the world, the actor's id and display name: see [`ARCHITECTURE.md`](ARCHITECTURE.md#the-action-log).

## Pacing

Measured headless with two bots per room on Earth's seed 7 at normal pace (`scripts/brain.ts`, the same decisions `playbot.ts` uses), from arrival to exhaustion. "Hand" only harvests; "rush" builds furnaces, harvests intensively and never buys a kit; "green" builds Sun Gardens, harvests carefully and fits kits once its first automated line runs.

| Strategy, players | Earth ends | First factory | First datacentre | First automated delivery | Used | Wasted | Parts | Datacentre ran |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| hand, 1 | 27 min | | | | 1974 | 0 | 0 | |
| rush, 1 | 25 min | 45 s | 8.5 min | never | 1419 | 555 | 8 | 196 ticks |
| green, 1 | 26 min | 84 s | 3.7 min | 6.3 min | 1959 | 15 | 31 | 395 ticks |
| hand, 2 | 14 min | | | | 1974 | 0 | 0 | |
| rush, 2 | 8 min | 36 s | 2.2 min | 4.1 min | 1415 | 559 | 8 | 229 ticks |
| green, 2 | 15 min | 65 s | 2.8 min | 3.9 min | 1959 | 15 | 36 | 383 ticks |
| hand, 4 | 7 min | | | | 1974 | 0 | 0 | |
| rush, 4 | 4 min | 32 s | 1.4 min | 1.8 min | 1378 | 596 | 8 | 145 ticks |
| green, 4 | 9 min | 56 s | 2.1 min | 2.8 min | 1966 | 8 | 32 | 343 ticks |

"Used" is useful stock extracted, "wasted" destroyed by intensive harvesting and smoke; both include the 168 units the Green Lobby put back. A useful factory arrives in the first minute and a rushed datacentre around two minutes for two to four players, a little ahead of the brief's three-to-five-minute target, which a human group that doesn't know the recipes will spend. The trade-off holds at every size: the rush reaches compute first and wastes about a quarter of the world; the green route spends longer on setup, wastes almost nothing, makes four times the parts and keeps its datacentre running for longer (green's ten-minute snapshot at two players: 36 parts, 5 kits fitted). A lone rusher stalls on furnace fuel and gets no automation at all; a lone green player is automating at six minutes.

Whole campaigns at the rapid preset, two bots: the rush finishes all five worlds in about 11 minutes, the green route in about 18, both building a factory and a datacentre on every world and an automated line on most (Mars, where domes, datacentres and pumps fight over ice, is the hardest). An equal Bottled Sun makes measurably more parts through an efficient factory than a quick one before it runs out (asserted in the spec).

Bots don't wander, admire or argue, and the hand baseline shows the floor: two people gathering alone spend a quarter of an hour on Earth. Progress scales with player count on purpose: more hands consume faster, and the stock doesn't grow to compensate. Re-measure with `node scripts/playbot.ts` or the spec's own campaign tests after changing `shared/content.ts`.

## Visual and audio bible

- **Camera**: 2:1 isometric (tiles 64×32 world units), follows your avatar, zoom 0.5--2.2.
- **Forms**: rounded, soft dark outline (`rgba(40,30,40,0.55)`), light from the upper left (left faces lighter than right).
- **Palette**: one per world, a "lush" and a "dead" ground colour that tiles interpolate between by life; deposits in each world's three family colours.
- **Characters**: round little people on Earth, suited on Mars, drones at the Sun, probes in the Solar System, glowing wisps in the Universe; always in the player's colour with a name label (and "(you)"), facing their direction, bobbing when walking, swinging a tool when harvesting.
- **Occlusion**: tall buildings turn translucent when anyone stands behind them.
- **Interface**: warm paper cards, rounded, a small HUD, the world dominating the screen.
- **Motion**: wildlife, swaying trees, pond shimmer, factory smoke, data-centre LEDs, harvester bob, relay pulses. "Reduced motion" (defaulting to the OS setting) stops ambient animation and camera easing.
- **Sound**: procedural Web Audio on three separately controlled buses (music, ambience, effects), started only by an explicit click.
