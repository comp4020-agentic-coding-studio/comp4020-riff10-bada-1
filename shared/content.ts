// All balance and stage content lives here as data. Units are whole numbers
// throughout (no floats in the economy), so inventories can't drift, go
// negative or overflow: every natural stock is finite and every inventory is
// bounded by the stock it came from, except the Bottled Sun reserve, which is
// bounded by the Sun's own stock (see SUN_TO_RESERVE).

export const FAMILIES = ["matter", "mineral", "coolant"] as const;
export type Family = (typeof FAMILIES)[number];
export type Bundle = Record<Family, number>;

/** Manufactured goods: whole-number stores outside the natural-stock ledger. */
export const GOODS = ["wire", "frame", "kit"] as const;
export type Good = (typeof GOODS)[number];
export type Goods = Record<Good, number>;
/** Anything that can sit in a stockpile, a buffer or on a belt. */
export const ITEMS = [...FAMILIES, ...GOODS] as const;
export type Item = Family | Good;
export type Cost = Partial<Record<Item, number>>;
export const isItem = (v: unknown): v is Item => typeof v === "string" && (ITEMS as readonly string[]).includes(v);
export const isGood = (v: unknown): v is Good => typeof v === "string" && (GOODS as readonly string[]).includes(v);

export const BUILDING_TYPES = [
  "extractor",
  "furnace",
  "solar",
  "city",
  "datacentre",
  "habitat",
  "radiator",
  "relay",
  "plaza",
  "depot",
  "engine",
  "factory",
  "store",
  "intake",
] as const;
export type BuildingType = (typeof BUILDING_TYPES)[number];

export interface BuildingDef {
  size: 1 | 2;
  /** raw stock and manufactured goods, paid from the shared stockpile */
  cost: Cost;
  /** construction time in economy ticks */
  build: number;
  energy: number; // + produces, - consumes (per economy tick)
  workers: number; // + houses, - employs
  compute: number; // + produces, - consumes
  coolantUse?: number; // coolant drawn from inventory per economy tick
  fuelUse?: number; // matter drawn per economy tick
  /** extraction per economy tick from adjacent deposits */
  extract?: number;
  /** tiles of life lost per economy tick, Chebyshev radius */
  pollution?: { radius: number; amount: number; burnsMatter?: number };
  heat?: number;
  cooling?: number;
  pressureRadius?: number;
  relayRange?: number;
  /** protected shared utility: nobody can demolish it */
  protected?: boolean;
  /** energy released into the reserve when this is rendered down */
  renderValue?: number;
  tall?: boolean;
  /** local coolant tank: filled by hand (tend) or by pipes from an intake */
  tank?: number;
  /** can take an efficiency kit (built efficiently, or retrofitted later) */
  kit?: string;
  /** can be built out in open space */
  floats?: boolean;
  /** a Datacentre must sit entirely inside its builder's claim */
  needsClaim?: boolean;
  blurb: string;
}

export const BUILDINGS: Record<BuildingType, BuildingDef> = {
  extractor: {
    size: 1,
    cost: { mineral: 6, matter: 4 },
    build: 3,
    energy: -1,
    workers: 0,
    compute: -1,
    extract: 1,
    pollution: { radius: 1, amount: 4 },
    heat: 2,
    kit: "careful extraction at full speed: 2 a tick, nothing wasted",
    blurb: "Harvests a neighbouring deposit into its own hopper. Needs power and compute; belt the hopper away or collect it.",
  },
  furnace: {
    size: 1,
    cost: { mineral: 8 },
    build: 3,
    energy: 5,
    workers: -1,
    compute: 0,
    fuelUse: 1,
    pollution: { radius: 2, amount: 3, burnsMatter: 1 },
    tall: true,
    kit: "a cleaner burn: half the fuel, smoke reaches only 1 tile",
    blurb: "Burns matter for lots of power, lit only when its grid needs it. Its smoke browns the land and kills nearby groves.",
  },
  solar: {
    size: 2,
    cost: { mineral: 10, coolant: 2 },
    build: 4,
    energy: 2,
    workers: 0,
    compute: 0,
    blurb: "Clean, slow power that takes a lot of ground.",
  },
  city: {
    size: 2,
    cost: { matter: 12, mineral: 6 },
    build: 5,
    energy: -1,
    workers: 4,
    compute: -1,
    tall: true,
    blurb: "Homes for 4 workers, no power needed. Cabled to power and served with compute, it houses 7.",
  },
  datacentre: {
    size: 2,
    cost: { mineral: 4, matter: 4, wire: 6, frame: 2 },
    build: 6,
    energy: -2,
    workers: -2,
    compute: 4,
    coolantUse: 1,
    heat: 3,
    tall: true,
    tank: 30,
    needsClaim: true,
    kit: "recirculating cooling: drinks half the coolant for the same compute",
    blurb: "Turns power, workers and coolant into compute. Needs parts from a factory, and your own claimed ground.",
  },
  habitat: {
    size: 2,
    cost: { mineral: 12, coolant: 4 },
    build: 5,
    energy: -1,
    workers: 0,
    compute: 0,
    coolantUse: 1,
    pressureRadius: 4,
    tall: true,
    tank: 30,
    kit: "a sealed dome: half the ice for the same air",
    blurb: "A sealed dome. Machines only run inside the air it holds.",
  },
  radiator: {
    size: 1,
    cost: { mineral: 8 },
    build: 3,
    energy: -1,
    workers: 0,
    compute: 0,
    cooling: 5,
    blurb: "Sheds heat so collectors don't throttle.",
  },
  relay: {
    size: 1,
    floats: true,
    cost: { mineral: 4, matter: 2 },
    build: 2,
    energy: 0,
    workers: 0,
    compute: 0,
    relayRange: 5,
    blurb: "Links machines to the Depot, powered by the link itself. Miners off the network ship nothing.",
  },
  plaza: {
    size: 1,
    cost: { matter: 2 },
    build: 1,
    energy: 0,
    workers: 0,
    compute: 0,
    blurb: "A bench and some bunting. A city beside a plaza houses one more worker.",
  },
  depot: {
    size: 2,
    cost: {},
    build: 0,
    energy: 0,
    workers: 0,
    compute: 0,
    relayRange: 6,
    protected: true,
    tall: true,
    blurb: "The Cooperative's shared depot, and the tap on the Bottled Sun: cable a grid to it to power machines.",
  },
  engine: {
    size: 2,
    cost: {},
    build: 0,
    energy: 0,
    workers: 0,
    compute: 4,
    renderValue: 160,
    tall: true,
    blurb: "A whole spent world, running as compute, and a tap on the Bottled Sun: cable machines to it for power. Render it down for a burst of energy.",
  },
  factory: {
    size: 2,
    cost: { mineral: 8, matter: 6 },
    build: 4,
    energy: -2,
    workers: -1,
    compute: 0,
    heat: 2,
    tall: true,
    kit: "unlocks efficient recipes: more parts from the same ore and 1 less power, more slowly",
    blurb: "Turns raw stock into parts. Load it by hand (F) or feed it with belts. Needs power and workers, never compute.",
  },
  store: {
    size: 1,
    cost: { matter: 4 },
    build: 1,
    energy: 0,
    workers: 0,
    compute: 0,
    blurb: "The end of a belt: whatever arrives goes into the shared stockpile.",
  },
  intake: {
    size: 1,
    floats: true,
    cost: { mineral: 4 },
    build: 2,
    energy: -1,
    workers: 0,
    compute: 0,
    blurb: "Pumps coolant from a deposit beside it into its tank. Pipes carry it to datacentres; or collect it by hand.",
  },
};

/** Production recipes. `ticks` are economy ticks per batch. */
export type Recipe = "wire" | "frame" | "kit";
export const RECIPES: Record<Recipe, { quick: { in: Cost; out: number; ticks: number }; efficient: { in: Cost; out: number; ticks: number } }> = {
  wire: { quick: { in: { mineral: 3 }, out: 2, ticks: 1 }, efficient: { in: { mineral: 3 }, out: 3, ticks: 2 } },
  frame: { quick: { in: { mineral: 4, matter: 3 }, out: 1, ticks: 1 }, efficient: { in: { mineral: 3, matter: 2 }, out: 1, ticks: 2 } },
  kit: { quick: { in: { wire: 2, frame: 1 }, out: 1, ticks: 2 }, efficient: { in: { wire: 2, frame: 1 }, out: 1, ticks: 2 } },
};
export const RECIPE_LIST = Object.keys(RECIPES) as Recipe[];
/** what the factory's default ("auto") recipe aims to have in hand: the next datacentre's parts */
export const NEXT_DATACENTRE: Partial<Record<Good, number>> = { wire: 6, frame: 2 };
/** per-item cap on a factory's input buffer and on any machine's output hopper */
export const INPUT_CAP = 12;
export const OUTPUT_CAP = 12;
export const HOPPER_CAP = 10;
export const INTAKE_TANK = 20;
/** coolant a pump lifts from the deposit beside it per economy tick */
export const INTAKE_RATE = 2;
/** how close a player stands to load, fill or collect from a machine (F) */
export const TEND_RANGE = 3;
/**
 * How a kit changes a building's power: a furnace gives up power for its cleaner burn; a
 * factory on its efficient recipes runs slower motors and draws less. Everywhere else
 * a kit's price is the parts it costs.
 */
export const KIT_POWER: Partial<Record<BuildingType, number>> = { furnace: 1, factory: -1 };

/** Networks laid tile by tile. q 0 is cheap, q 1 the efficient version. */
export type LineKind = "cable" | "pipe" | "belt" | "path";
export const LINE_KINDS: LineKind[] = ["cable", "pipe", "belt", "path"];
export const LINES: Record<LineKind, { cost: [Cost, Cost | null]; q: [string, string | null]; life: [number, number]; blurb: string }> = {
  cable: { cost: [{ mineral: 1 }, null], q: ["cable", null], life: [60, 60], blurb: "Joins generators to machines: anything touching a cable is on its grid. Every 16 tiles of cable loses 1 power." },
  pipe: { cost: [{ mineral: 1 }, { mineral: 1, wire: 1 }], q: ["cheap pipe", "sealed pipe"], life: [50, 75], blurb: "Carries coolant from a pump to tanks, 6 a tick. Cheap pipe leaks more the longer it runs; sealed pipe doesn't leak." },
  belt: { cost: [{ mineral: 1, matter: 1 }, { mineral: 1, matter: 1, wire: 1 }], q: ["belt", "fast belt"], life: [40, 55], blurb: "Moves items one tile a tick toward its arrow, into a factory, a tank or a store. A fast belt carries two." },
  path: { cost: [{ matter: 1 }, { matter: 2, mineral: 1 }], q: ["rough track", "laid path"], life: [25, 80], blurb: "Walk 60% faster along it. A rough track tramples the ground; a laid path costs more and barely marks it." },
};
/** a long cable network loses this many tiles' worth per power unit each tick */
export const CABLE_LOSS_TILES = 16;
/** cheap pipe leaks 1 coolant per this many (units × cheap tiles) carried */
export const PIPE_LEAK_EVERY = 160;
/** coolant a pipe network can move per economy tick */
export const PIPE_BUDGET = 6;
export const PATH_SPEED = 1.6;
export const MAX_LINE_TILES = 32;
export const LINE_RANGE = 14;

/** Claims: a square of ground that only its owner (or the host) builds on. */
export const CLAIM_SIZE = 4;
export const CLAIMS_PER_PLAYER = 2;
export const CLAIM_COST: Cost = { matter: 3 };

/** Hand harvesting: careful takes one, intensive takes two and wastes one. */
export const HARVEST_MODES = {
  careful: { useful: 1, waste: 0, scar: 0 },
  intensive: { useful: 2, waste: 1, scar: 4 },
} as const;
export type HarvestMode = keyof typeof HARVEST_MODES;

/** The Green Lobby: server-run agents who put stock back from a finite seed bank. */
export const LOBBY = {
  names: ["Fern", "Moss", "Sorrel", "Wren", "Bramble", "Linden", "Clover", "Yarrow"],
  /** share of each family's initial stock the seed bank holds, per stage; absent: the lobby stays home */
  bankShare: {
    earth: { matter: 0.12, mineral: 0.04, coolant: 0.1 },
    mars: { coolant: 0.05 },
  } as Partial<Record<string, Partial<Record<Family, number>>>>,
  /** how many walk the map: a few at the start, more per running factory and per datacentre */
  base: 2,
  perFactory: 1,
  perDatacentre: 2,
  max: 7,
  speed: 2.2, // tiles a second
  /** economy ticks of picketing a site can take in all; while picketed it rises at half speed */
  picketTicks: 20,
  /** units a lobbyist puts back per economy tick while planting, and at most per visit */
  plant: 1,
  visit: 6,
  /** what a replanted tile is called, by family */
  places: { matter: "grove", mineral: "ore pit", coolant: "pond" } as Record<Family, string>,
  signs: ["Leave it be", "Water for herons", "Trees not servers", "Enough is plenty", "Grow, don't mine"],
  shouts: ["Not on our pond!", "Compute can wait!", "Who asked the trees?", "Plenty is enough!"],
};

export type StageId = "earth" | "mars" | "sun" | "system" | "universe";
export type Mechanic = "pollution" | "pressure" | "heat" | "relay" | "legacy";
export type Avatar = "person" | "suit" | "drone" | "probe" | "wisp";

export interface FamilySpec {
  label: string;
  /** number of deposit tiles generated */
  tiles: number;
  perTile: number;
}

export interface StageDef {
  id: StageId;
  name: string;
  tagline: string;
  size: number;
  mechanic: Mechanic;
  avatar: Avatar;
  energySource: "local" | "bottled";
  families: Record<Family, FamilySpec>;
  buildings: BuildingType[];
  names: Partial<Record<BuildingType, string>>;
  goods: Record<Good, string>;
  starter: Bundle;
  landmarks: string[];
  /** solar output multiplier for this stage */
  solarScale: number;
  palette: {
    sky: [string, string];
    lush: [number, number, number];
    dead: [number, number, number];
    matter: string;
    mineral: string;
    coolant: string;
  };
  arrival: string;
  departure: string;
}

export const STAGES: StageDef[] = [
  {
    id: "earth",
    name: "Earth",
    tagline: "A meadow island with a pond, a few groves and an old oak.",
    size: 24,
    mechanic: "pollution",
    avatar: "person",
    energySource: "local",
    families: {
      matter: { label: "timber", tiles: 34, perTile: 29 },
      mineral: { label: "metal ore", tiles: 16, perTile: 32 },
      coolant: { label: "fresh water", tiles: 14, perTile: 22 },
    },
    buildings: ["city", "plaza", "furnace", "solar", "factory", "store", "datacentre", "extractor", "intake"],
    names: {
      city: "Cottages",
      furnace: "Furnace",
      solar: "Sun Garden",
      datacentre: "Datacentre",
      extractor: "Harvester",
      plaza: "Plaza",
      factory: "Factory",
      store: "Store",
      intake: "Pump",
    },
    goods: { wire: "wire", frame: "frame", kit: "efficiency kit" },
    starter: { matter: 0, mineral: 0, coolant: 0 },
    landmarks: ["The Old Oak", "Heron Pond", "Picnic Hill", "Rust Knoll"],
    solarScale: 1,
    palette: {
      sky: ["#bfe7ff", "#fdf3d8"],
      lush: [126, 196, 104],
      dead: [150, 128, 104],
      matter: "#3f8f4f",
      mineral: "#9c7f6a",
      coolant: "#5bb6e8",
    },
    arrival: "The Plenty Cooperative welcomes you to Earth. Everything here is yours to use.",
    departure: "Earth is spent. The Cooperative thanks you for your growth.",
  },
  {
    id: "mars",
    name: "Mars",
    tagline: "Rust dunes over buried ice. Nothing runs outside a dome.",
    size: 26,
    mechanic: "pressure",
    avatar: "suit",
    energySource: "local",
    families: {
      matter: { label: "regolith", tiles: 30, perTile: 29 },
      mineral: { label: "iron", tiles: 18, perTile: 32 },
      coolant: { label: "buried ice", tiles: 18, perTile: 26 },
    },
    buildings: ["habitat", "solar", "city", "factory", "store", "datacentre", "extractor", "intake", "plaza"],
    names: {
      habitat: "Dome",
      solar: "Solar Field",
      city: "Hab Block",
      datacentre: "Cold Datacentre",
      extractor: "Rover Drill",
      plaza: "Garden Pod",
      factory: "Pressure Factory",
      store: "Airlock Store",
      intake: "Ice Melter",
    },
    goods: { wire: "wire", frame: "pressure frame", kit: "efficiency kit" },
    starter: { matter: 24, mineral: 46, coolant: 16 },
    landmarks: ["First Footprint", "Ice Cathedral", "Olympus Lookout"],
    solarScale: 2,
    palette: {
      sky: ["#f2b08a", "#5a2a2a"],
      lush: [214, 120, 74],
      dead: [110, 84, 76],
      matter: "#c4683e",
      mineral: "#7d5a50",
      coolant: "#dff6ff",
    },
    arrival: "Mars. The ice under the dust is everything: air, water, coolant.",
    departure: "The ice is gone. Mars can no longer hold anyone, including you.",
  },
  {
    id: "sun",
    name: "The Sun",
    tagline: "Collector platforms in the corona. The star itself is the deposit.",
    size: 28,
    mechanic: "heat",
    avatar: "drone",
    energySource: "local",
    families: {
      matter: { label: "plasma", tiles: 44, perTile: 26 },
      mineral: { label: "magnetics", tiles: 16, perTile: 29 },
      coolant: { label: "shade", tiles: 14, perTile: 22 },
    },
    buildings: ["solar", "city", "factory", "store", "datacentre", "radiator", "extractor", "intake", "plaza"],
    names: {
      solar: "Collector Wing",
      radiator: "Radiator",
      datacentre: "Furnace Mind",
      city: "Crew Ring",
      extractor: "Plasma Scoop",
      plaza: "Viewing Deck",
      factory: "Assembly Platform",
      store: "Cargo Bay",
      intake: "Shade Vane",
    },
    goods: { wire: "superconductor", frame: "heat shield", kit: "efficiency kit" },
    starter: { matter: 24, mineral: 40, coolant: 10 },
    landmarks: ["Morning", "The Last Noon"],
    solarScale: 4,
    palette: {
      sky: ["#ffcf6b", "#7a2410"],
      lush: [255, 196, 92],
      dead: [92, 60, 52],
      matter: "#ffe27a",
      mineral: "#7b6cff",
      coolant: "#2b3a66",
    },
    arrival: "The Sun. It has powered everything you have ever done. It is now a deposit.",
    departure: "The Sun goes out. What's left of it is bottled, and the bottle is all there is.",
  },
  {
    id: "system",
    name: "The Solar System",
    tagline: "Asteroids, comets and two spent worlds, under a dead star.",
    size: 30,
    mechanic: "relay",
    avatar: "probe",
    energySource: "bottled",
    families: {
      matter: { label: "volatiles", tiles: 34, perTile: 26 },
      mineral: { label: "asteroid metal", tiles: 22, perTile: 29 },
      coolant: { label: "comet ice", tiles: 16, perTile: 22 },
    },
    buildings: ["city", "relay", "factory", "store", "datacentre", "extractor", "intake", "plaza"],
    names: {
      relay: "Relay",
      datacentre: "Orbital Datacentre",
      city: "Station",
      extractor: "Asteroid Miner",
      plaza: "Observation Ring",
      depot: "Cooperative Depot",
      factory: "Orbital Factory",
      store: "Cargo Bay",
      intake: "Comet Tap",
    },
    goods: { wire: "relay wire", frame: "truss", kit: "efficiency kit" },
    starter: { matter: 20, mineral: 40, coolant: 10 },
    landmarks: ["Ceres Pier", "The Long Comet"],
    solarScale: 0,
    palette: {
      sky: ["#141a33", "#05060c"],
      lush: [138, 132, 160],
      dead: [64, 62, 74],
      matter: "#9fe3d0",
      mineral: "#c9a76a",
      coolant: "#cfe8ff",
    },
    arrival: "No sunlight now. Every machine draws on the Bottled Sun, and it does not refill.",
    departure: "The Solar System is spent. The Cooperative looks further out.",
  },
  {
    id: "universe",
    name: "The Universe",
    tagline: "Galaxies as deposits. Your old worlds hum along as compute.",
    size: 32,
    mechanic: "legacy",
    avatar: "wisp",
    energySource: "bottled",
    families: {
      matter: { label: "starlight", tiles: 40, perTile: 26 },
      mineral: { label: "stellar cores", tiles: 20, perTile: 29 },
      coolant: { label: "dark cold", tiles: 16, perTile: 22 },
    },
    buildings: ["city", "factory", "store", "datacentre", "extractor", "intake", "plaza"],
    names: {
      datacentre: "Matrioshka Shell",
      city: "Mind City",
      extractor: "Galaxy Siphon",
      plaza: "Memorial",
      engine: "World Engine",
      factory: "Cosmic Foundry",
      store: "Store",
      intake: "Cold Tap",
    },
    goods: { wire: "light thread", frame: "shell lattice", kit: "efficiency kit" },
    starter: { matter: 30, mineral: 50, coolant: 10 },
    landmarks: ["Andromeda", "The Quiet Arm"],
    solarScale: 0,
    palette: {
      sky: ["#0b0820", "#000000"],
      lush: [120, 110, 200],
      dead: [30, 30, 38],
      matter: "#fff1b8",
      mineral: "#ff9dd2",
      coolant: "#6fd0ff",
    },
    arrival: "The Universe. Every star is a deposit. The worlds you finished are machinery now.",
    departure: "Nothing left.",
  },
];

/** energy units banked per unit of plasma extracted from the Sun */
export const SUN_TO_RESERVE = 4;

export const TICK_MS = 100;
export const MAX_PLAYERS = 8;
/** identities a room remembers; past this the longest-gone is forgotten */
export const MAX_IDENTITIES = 32;
export const PACES = {
  // normal: one economy tick a second; harvest yields 1
  normal: { econEvery: 10, harvestYield: 1, transitionTicks: 90 },
  // the accelerated development preset: same rules, the economy five times
  // faster and a hand harvest worth ten
  rapid: { econEvery: 2, harvestYield: 10, transitionTicks: 50 },
} as const;
export type Pace = keyof typeof PACES;

export const PLAYER_SPEED = 4; // tiles per second
export const HARVEST_RANGE = 2.2; // tiles
export const BUILD_RANGE = 8; // tiles
export const HARVEST_COOLDOWN_TICKS = 8;
export const MARKS_PER_PLAYER = 3;
export const SALVAGE_RATE = 0.5;
/** heat at which collectors throttle to half output (the Sun) */
export const HEAT_LIMIT = 70;

export const EMOTES = ["wave", "heart", "laugh", "wow", "sad", "point"] as const;
export type Emote = (typeof EMOTES)[number];

export const itemLabel = (stage: StageDef, item: Item): string => (isGood(item) ? stage.goods[item] : stage.families[item as Family].label);

/** Efficient construction: extra parts and time for less damage and the building's kit benefit built in. */
export const EFFICIENT_EXTRA: Cost = { wire: 2, frame: 1 };
export const EFFICIENT_BUILD = 1.5;
/** the life a building leaves its footprint, standard and efficient */
export const BUILD_SCAR = { standard: 15, efficient: 45 };

export function buildingName(stage: StageDef, type: BuildingType): string {
  return stage.names[type] ?? type[0].toUpperCase() + type.slice(1);
}
