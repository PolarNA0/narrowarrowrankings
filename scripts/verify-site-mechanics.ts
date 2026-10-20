/**
 * Verify the four stateful puzzle mechanics against the REAL site sim
 * (createReplayEngine), not a reimplementation:
 *   - switch + door: a shut door blocks, the switch opens it and the arrow passes
 *   - one-way gate: blocked from the blocked side, passable from the other
 *   - blink: solid while on, passable while off
 *   - breakable: blocks until touched, then the arrow gets through
 * and that snapshot/restore keeps a door's open state and a broken wall.
 */
import { readFileSync } from "node:fs";
import { initSync } from "@/lib/physics/rust.js";
import { createReplayEngine, levelGeometry, type RawLevelData } from "@/lib/replay-sim";
import {
  defaultObstacle,
  nalvlToRawLevelData,
  nalvlToGameData,
  rawLevelDataToNalvl,
  type NalvlLevel,
} from "@/lib/nalvl";
import { parseLevelData } from "@/routes/api/site-levels";

initSync({ module: readFileSync(new URL("../src/lib/physics/rust_bg.wasm", import.meta.url)) });

type Obstacle = NonNullable<RawLevelData["obstacles"]>[number];

const SIDE_WALLS: Obstacle[] = [
  {
    obstacle_type: "wall",
    wall_type: "normal",
    wall_thickness: 8,
    points: [
      { x: 200, y: 200 },
      { x: 200, y: -2000 },
    ],
  },
  {
    obstacle_type: "wall",
    wall_type: "normal",
    wall_thickness: 8,
    points: [
      { x: -200, y: 200 },
      { x: -200, y: -2000 },
    ],
  },
];

/** The wall the arrow flies into, at y=-80. */
const BARRIER: Obstacle = {
  obstacle_type: "wall",
  wall_type: "normal",
  wall_thickness: 8,
  points: [
    { x: -60, y: -80 },
    { x: 60, y: -80 },
  ],
};

function level(extra: Obstacle[], barrier: Obstacle = BARRIER): RawLevelData {
  return { map_name: "mech", game_mode: "speedrun", obstacles: [barrier, ...SIDE_WALLS, ...extra] };
}

async function run(data: RawLevelData, n: number) {
  const engine = await createReplayEngine(data, "narrow");
  if (!engine) throw new Error("engine failed");
  engine.reset();
  let last = engine.read();
  for (let i = 0; i < n; i++) last = engine.step(0);
  const result = { x: last.x, y: last.y, code: engine.code(), timeline: engine.timeline() };
  engine.free();
  return result;
}

const TICKS = 900;
const results: string[] = [];
function check(label: string, ok: boolean, detail: string) {
  results.push(`${ok ? "PASS" : "FAIL"}  ${label}  ${detail}`);
}

// --- switch + door -----------------------------------------------------------
// A switch box right at the spawn; a door on the barrier. The arrow flies into
// the switch, which opens the door, so it should get well past y=-80.
const switchBox: Obstacle = {
  obstacle_type: "wall",
  points: [
    { x: -80, y: -5 },
    { x: 80, y: -5 },
    { x: 80, y: -40 },
    { x: -80, y: -40 },
  ],
  switch_group: "g",
  switch_action: "on",
};
const door: Obstacle = { ...BARRIER, switch_group: "g", door_start_open: false };

const shut = await run(level([], door), TICKS);
const opened = await run(level([switchBox], door), TICKS);
check("switch+door: shut door blocks", shut.y > -80, `end y=${shut.y.toFixed(1)} (barrier at -80)`);
check(
  "switch+door: switch opens the door and the arrow passes",
  opened.y < -120,
  `end y=${opened.y.toFixed(1)}, fires=${opened.timeline.switchFires.length}`,
);
check(
  "switch+door: the fire is recorded in the timeline",
  opened.timeline.switchFires.length === 1 && opened.timeline.switchFires[0].open === true,
  JSON.stringify(opened.timeline.switchFires),
);

// --- one-way gate ------------------------------------------------------------
// Normal (0,1) points toward +y, where the arrow starts, so it is passable.
const gatePass: Obstacle = { ...BARRIER, gate_normal: { x: 0, y: 1 } };
// Normal (0,-1) points away, so the arrow is on the blocked side.
const gateBlock: Obstacle = { ...BARRIER, gate_normal: { x: 0, y: -1 } };

const gateOk = await run(level([], gatePass), TICKS);
const gateNo = await run(level([], gateBlock), TICKS);
check(
  "one-way: passable side lets the arrow through",
  gateOk.y < -120,
  `end y=${gateOk.y.toFixed(1)}`,
);
check("one-way: blocked side stops the arrow", gateNo.y > -80, `end y=${gateNo.y.toFixed(1)}`);

// --- blink -------------------------------------------------------------------
const blinkOff: Obstacle = { ...BARRIER, blink_period: 120, blink_duty: 0 };
const blinkOn: Obstacle = { ...BARRIER, blink_period: 120, blink_duty: 1 };
const blinkHalf: Obstacle = { ...BARRIER, blink_period: 120, blink_duty: 0.5 };

const bOff = await run(level([], blinkOff), TICKS);
const bOn = await run(level([], blinkOn), TICKS);
const bHalf = await run(level([], blinkHalf), TICKS);
check(
  "blink: duty 0 (always off) lets the arrow through",
  bOff.y < -120,
  `end y=${bOff.y.toFixed(1)}`,
);
check("blink: duty 1 (always on) blocks the arrow", bOn.y > -80, `end y=${bOn.y.toFixed(1)}`);
check("blink: duty 0.5 is timed", Number.isFinite(bHalf.y), `end y=${bHalf.y.toFixed(1)}`);

// A long period with the duty split and a phase pin makes the window
// deterministic: the arrow either arrives inside the solid half or the open
// half, and the real engine must agree with `blinkSolidAt` either way.
const blinkSolidNow: Obstacle = {
  ...BARRIER,
  blink_period: 100000,
  blink_duty: 0.5,
  blink_phase: 0,
};
const blinkOpenNow: Obstacle = {
  ...BARRIER,
  blink_period: 100000,
  blink_duty: 0.5,
  blink_phase: 50000,
};
const bSolidNow = await run(level([], blinkSolidNow), TICKS);
const bOpenNow = await run(level([], blinkOpenNow), TICKS);
check(
  "blink: solid half of the cycle blocks",
  bSolidNow.y > -80,
  `end y=${bSolidNow.y.toFixed(1)}`,
);
check("blink: open half of the cycle passes", bOpenNow.y < -120, `end y=${bOpenNow.y.toFixed(1)}`);

// --- switch action variants --------------------------------------------------
// "off" closes a door that starts open; "toggle" flips the authored state. Both
// must drive the same group the door reads.
const doorOpenStart: Obstacle = { ...BARRIER, switch_group: "g", door_start_open: true };
const offSwitch: Obstacle = { ...switchBox, switch_action: "off" };
const toggleSwitch: Obstacle = { ...switchBox, switch_action: "toggle" };

const startsOpen = await run(level([], doorOpenStart), TICKS);
check(
  "door: starts open passes with no switch",
  startsOpen.y < -120,
  `end y=${startsOpen.y.toFixed(1)}`,
);
const offRun = await run(level([offSwitch], doorOpenStart), TICKS);
check(
  "switch action 'off': closes a door that started open",
  offRun.y > -80,
  `end y=${offRun.y.toFixed(1)}, fires=${offRun.timeline.switchFires.length}`,
);
const toggleRun = await run(level([toggleSwitch], door), TICKS);
check(
  "switch action 'toggle': flips the authored state (opens a shut door)",
  toggleRun.y < -120,
  `end y=${toggleRun.y.toFixed(1)}, fires=${toggleRun.timeline.switchFires.length}`,
);

// A switch is one-shot per *group*. Two "on" switches in the same group, both on
// the path, is the discriminating case: a per-group guard fires only the first
// (fires=1), while firing on every entry would record both (fires=2). The door
// state is identical either way, so only the fire count can tell them apart.
const switchLower: Obstacle = {
  ...switchBox,
  points: switchBox.points.map((p) => ({ x: p.x, y: p.y - 260 })),
};
const twoSwitches = await run(level([switchBox, switchLower], door), TICKS);
check(
  "switch is one-shot per group: two boxes, one fire",
  twoSwitches.y < -120 && twoSwitches.timeline.switchFires.length === 1,
  `end y=${twoSwitches.y.toFixed(1)}, fires=${twoSwitches.timeline.switchFires.length}`,
);

// --- breakable ---------------------------------------------------------------
const breakable: Obstacle = { ...BARRIER, breakable: true };
const solid = await run(level([]), TICKS);
const broke = await run(level([], breakable), TICKS);
check(
  "breakable: gets further than a solid wall",
  broke.y < solid.y - 20,
  `solid y=${solid.y.toFixed(1)} vs breakable y=${broke.y.toFixed(1)}`,
);
check(
  "breakable: the break is recorded in the timeline",
  broke.timeline.brokenAt.length === 1,
  JSON.stringify(broke.timeline.brokenAt),
);

// --- snapshot/restore --------------------------------------------------------
// Snapshot after the switch has fired, restore, and confirm the door stays open
// (a lost open flag would re-shut the door and the tail would diverge).
const eng = await createReplayEngine(level([switchBox], door), "narrow");
if (!eng) throw new Error("engine failed");
eng.reset();
for (let i = 0; i < 120; i++) eng.step(0);
const snap = eng.snapshot();
eng.restore(snap);
for (let i = 0; i < 780; i++) eng.step(0);
const viaRestore = eng.read();
eng.free();
check(
  "snapshot/restore keeps the door open",
  viaRestore.y < -120,
  `end y=${viaRestore.y.toFixed(1)} vs straight ${opened.y.toFixed(1)}`,
);

// --- nalvl round-trip + game-export stripping --------------------------------
const authored: NalvlLevel = {
  format: "nalvl",
  formatVersion: 1,
  name: "mech",
  gameMode: "speedrun",
  obstacles: [
    {
      id: "a",
      kind: "switch",
      points: [
        { x: -80, y: -5 },
        { x: 80, y: -5 },
        { x: 80, y: -40 },
      ],
      switchGroup: "g",
      switchAction: "on",
    },
    {
      id: "b",
      kind: "door",
      wallType: "normal",
      thickness: 8,
      points: [
        { x: -60, y: -80 },
        { x: 60, y: -80 },
      ],
      switchGroup: "g",
      doorStartOpen: false,
    },
    {
      id: "c",
      kind: "gate",
      wallType: "normal",
      thickness: 8,
      points: [
        { x: -60, y: -200 },
        { x: 60, y: -200 },
      ],
      gateNormal: { x: 0, y: 1 },
    },
    {
      id: "d",
      kind: "blink",
      wallType: "normal",
      thickness: 8,
      points: [
        { x: -60, y: -320 },
        { x: 60, y: -320 },
      ],
      blinkPeriod: 120,
      blinkDuty: 0.5,
    },
    {
      id: "e",
      kind: "breakable",
      wallType: "normal",
      thickness: 8,
      points: [
        { x: -60, y: -440 },
        { x: 60, y: -440 },
      ],
    },
  ],
};
const raw = nalvlToRawLevelData(authored);
const geom = levelGeometry(raw);
check(
  "nalvl: lowers to one of each mechanic",
  geom.doors?.length === 1 &&
    geom.switches?.length === 1 &&
    geom.gates?.length === 1 &&
    geom.blinks?.length === 1 &&
    geom.breakables?.length === 1,
  `doors=${geom.doors?.length} switches=${geom.switches?.length} gates=${geom.gates?.length} blinks=${geom.blinks?.length} breakables=${geom.breakables?.length}`,
);
const game = nalvlToGameData(authored);
const leaked = game.obstacles.some((o) => {
  const x = o as Record<string, unknown>;
  return (
    x.switch_group != null ||
    x.gate_normal != null ||
    x.blink_period != null ||
    x.breakable === true
  );
});
check("nalvl: game export carries no site-only fields", !leaked, `leaked=${leaked}`);
const back = rawLevelDataToNalvl(raw, "mech");
check(
  "nalvl: round-trip preserves the kinds",
  back.obstacles.map((o) => o.kind).join(",") === "switch,door,gate,blink,breakable",
  back.obstacles.map((o) => o.kind).join(","),
);

// --- editor defaults ---------------------------------------------------------
// The editor's `defaultObstacle` must produce an obstacle the sim actually
// recognises; a default missing its site field would draw as a plain wall. A
// switch is a sensor *polygon*, so the editor authors it as a box (4 points).
for (const kind of ["switch", "door", "gate", "blink", "breakable"] as const) {
  const pts =
    kind === "switch"
      ? [
          { x: -60, y: 0 },
          { x: 60, y: 0 },
          { x: 60, y: -40 },
          { x: -60, y: -40 },
        ]
      : [
          { x: -60, y: 0 },
          { x: 60, y: 0 },
        ];
  const o = defaultObstacle(kind, pts);
  const raw1 = nalvlToRawLevelData({
    format: "nalvl",
    formatVersion: 1,
    name: "d",
    gameMode: "speedrun",
    obstacles: [o],
  });
  const g = levelGeometry(raw1);
  const n =
    kind === "switch"
      ? g.switches?.length
      : kind === "door"
        ? g.doors?.length
        : kind === "gate"
          ? g.gates?.length
          : kind === "blink"
            ? g.blinks?.length
            : g.breakables?.length;
  check(`editor default '${kind}' is recognised by the sim`, n === 1, `count=${n}`);
}
// A left-to-right horizontal gate default must be passable for an arrow below
// it (the draw direction rotated 90° CCW is (0,1)), the documented default.
const gateDefault = defaultObstacle("gate", [
  { x: -60, y: 0 },
  { x: 60, y: 0 },
]);
check(
  "editor gate default faces (0,1)",
  gateDefault.gateNormal?.x === 0 && gateDefault.gateNormal?.y === 1,
  JSON.stringify(gateDefault.gateNormal),
);

// --- publish whitelist -------------------------------------------------------
// `parseLevelData` must carry every site field through; a miss here downgrades a
// published puzzle piece to a plain wall and the level plays wrong.
const published = parseLevelData({
  map_name: "publish",
  game_mode: "speedrun",
  obstacles: [
    {
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
      switch_group: "g",
      switch_action: "on",
    },
    {
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
      switch_group: "g",
      door_start_open: true,
    },
    {
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
      gate_normal: { x: 0, y: 1 },
    },
    {
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
      blink_period: 120,
      blink_duty: 0.25,
      blink_phase: 7,
    },
    {
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
      breakable: true,
    },
  ],
});
if ("error" in published) {
  check("publish whitelist: payload accepted", false, published.error);
} else {
  const obs = published.obstacles as Array<Record<string, unknown>>;
  check(
    "publish whitelist: switch fields survive",
    obs[0].switch_group === "g" && obs[0].switch_action === "on",
    JSON.stringify({ g: obs[0].switch_group, a: obs[0].switch_action }),
  );
  check(
    "publish whitelist: door fields survive",
    obs[1].switch_group === "g" && obs[1].door_start_open === true,
    JSON.stringify({ g: obs[1].switch_group, o: obs[1].door_start_open }),
  );
  check(
    "publish whitelist: gate normal survives",
    (obs[2].gate_normal as { y?: number } | undefined)?.y === 1,
    JSON.stringify(obs[2].gate_normal),
  );
  check(
    "publish whitelist: blink fields survive",
    obs[3].blink_period === 120 && obs[3].blink_duty === 0.25 && obs[3].blink_phase === 7,
    JSON.stringify({
      p: obs[3].blink_period,
      d: obs[3].blink_duty,
      ph: obs[3].blink_phase,
    }),
  );
  check(
    "publish whitelist: breakable survives",
    obs[4].breakable === true,
    JSON.stringify(obs[4].breakable),
  );
}

console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
