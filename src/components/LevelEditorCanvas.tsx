/**
 * The Level Editor's canvas: renders a `NalvlLevel` and handles direct
 * manipulation (place, select, move, drag a vertex, delete, box-select).
 *
 * It renders the level's own obstacles rather than the flattened
 * `SimGeometry`, because editing needs per-obstacle identity and per-point
 * handles that the flattened form discards. Colours come from the shared
 * `wallVisual` vocabulary so the editor matches the replay renderer.
 *
 * All interaction is imperative (pointer events + a canvas), so dragging never
 * re-renders React at pointer-move rate; a drag is previewed locally and only
 * committed to the level (via `onChange`) on pointer-up.
 */

import * as React from "react";
import { wallVisual, withAlpha } from "@/lib/replay-visuals";
import { paintForceFields, type FieldParticle } from "@/lib/replay-paint";
import {
  defaultObstacle,
  levelBounds,
  type NalvlLevel,
  type NalvlObstacle,
  type NalvlPoint,
  type NalvlWallType,
  type NalvlZoneType,
} from "@/lib/nalvl";

export type EditorTool =
  "select" | "wall" | "zone" | "portal" | "wind" | "suction" | "accelerator" | "pan";

export interface LevelEditorCanvasHandle {
  redraw(): void;
  fit(): void;
  zoomBy(factor: number): void;
  /** Centre the camera on the arrow's spawn (the world origin). */
  centerOnOrigin(): void;
}

export interface LevelEditorCanvasProps {
  level: NalvlLevel;
  tool: EditorTool;
  wallType: NalvlWallType;
  zoneType: NalvlZoneType;
  /** Direction (radians) a newly drawn wind field blows in. */
  fieldDirection: number;
  /** Strength (velocity/tick) of a newly drawn field. */
  fieldStrength: number;
  /** Target speed (velocity/tick) of a newly drawn accelerator wire. */
  acceleratorSpeed: number;
  /** Push (velocity/tick) of a newly drawn accelerator wire. */
  acceleratorAccel: number;
  /** Snap every placed/dragged point to this world-unit grid (0 = free). */
  snap: number;
  selectedIds: string[];
  onSelect(ids: string[]): void;
  onChange(level: NalvlLevel): void;
  height?: number;
  className?: string;
}

interface Camera {
  x: number;
  y: number;
  scale: number;
}

type Drag =
  | { kind: "pan"; startX: number; startY: number; camX: number; camY: number }
  | { kind: "vertex"; id: string; index: number; point: NalvlPoint }
  | { kind: "move"; ids: string[]; last: NalvlPoint }
  | { kind: "marquee"; start: NalvlPoint; cursor: NalvlPoint; additive: boolean }
  | { kind: "create"; points: NalvlPoint[]; cursor: NalvlPoint };

const HANDLE_PX = 9;
// Grab radius for a body/vertex. Deliberately generous — the old 8px target was
// the main reason the editor felt finicky, especially with a finger.
const HIT_PX = 11;
/** Extra world-space slop so a wall thinner than a finger is still grabbable. */
const MIN_HIT_WORLD = 6;

function dist2(ax: number, ay: number, bx: number, by: number) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

/** Distance in world units from point P to segment AB. */
function pointSegDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const vx = bx - ax;
  const vy = by - ay;
  const len2 = vx * vx + vy * vy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * vx + (py - ay) * vy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

export const LevelEditorCanvas = React.forwardRef<LevelEditorCanvasHandle, LevelEditorCanvasProps>(
  function LevelEditorCanvas(
    {
      level,
      tool,
      wallType,
      zoneType,
      fieldDirection,
      fieldStrength,
      acceleratorSpeed,
      acceleratorAccel,
      snap,
      selectedIds,
      onSelect,
      onChange,
      height = 520,
      className,
    },
    ref,
  ) {
    const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
    const camRef = React.useRef<Camera>({ x: 0, y: 0, scale: 0.5 });
    const dragRef = React.useRef<Drag | null>(null);
    const propsRef = React.useRef({
      level,
      tool,
      wallType,
      zoneType,
      fieldDirection,
      fieldStrength,
      acceleratorSpeed,
      acceleratorAccel,
      snap,
      selectedIds,
    });
    propsRef.current = {
      level,
      tool,
      wallType,
      zoneType,
      fieldDirection,
      fieldStrength,
      acceleratorSpeed,
      acceleratorAccel,
      snap,
      selectedIds,
    };
    const drawRef = React.useRef<() => void>(() => {});

    // Stable particle pool for the field previews (levels with no fields ignore
    // it). Built once so a redraw does not reshuffle the particles.
    const editorParticlesRef = React.useRef<FieldParticle[] | null>(null);
    if (!editorParticlesRef.current) {
      editorParticlesRef.current = Array.from({ length: 64 }, () => ({
        seed: Math.random(),
        phase: Math.random(),
      }));
    }
    const editorParticles = editorParticlesRef.current;

    // screen <-> world helpers bound to the current camera + canvas size.
    const view = React.useRef({ width: 1, height: 1, dpr: 1 });

    const toScreen = React.useCallback((p: NalvlPoint) => {
      const cam = camRef.current;
      return {
        x: (p.x - cam.x) * cam.scale + view.current.width / 2,
        y: (p.y - cam.y) * cam.scale + view.current.height / 2,
      };
    }, []);

    const toWorld = React.useCallback((sx: number, sy: number): NalvlPoint => {
      const cam = camRef.current;
      return {
        x: (sx - view.current.width / 2) / cam.scale + cam.x,
        y: (sy - view.current.height / 2) / cam.scale + cam.y,
      };
    }, []);

    // Snap a world point to the editor's grid (no-op when snap is 0/off).
    const snapWorld = React.useCallback((p: NalvlPoint): NalvlPoint => {
      const s = propsRef.current.snap;
      if (!s) return p;
      return { x: Math.round(p.x / s) * s, y: Math.round(p.y / s) * s };
    }, []);

    const fit = React.useCallback(() => {
      const b = levelBounds(propsRef.current.level);
      const w = Math.max(1, b.maxX - b.minX);
      const h = Math.max(1, b.maxY - b.minY);
      const cam = camRef.current;
      cam.x = (b.minX + b.maxX) / 2;
      cam.y = (b.minY + b.maxY) / 2;
      cam.scale = Math.min(view.current.width / (w * 1.25), view.current.height / (h * 1.25), 4);
      drawRef.current();
    }, []);

    React.useImperativeHandle(
      ref,
      () => ({
        redraw: () => drawRef.current(),
        fit,
        zoomBy: (factor: number) => {
          camRef.current.scale = Math.max(0.05, Math.min(8, camRef.current.scale * factor));
          drawRef.current();
        },
        centerOnOrigin: () => {
          camRef.current.x = 0;
          camRef.current.y = 0;
          drawRef.current();
        },
      }),
      [fit],
    );

    const drawObstacle = React.useCallback(
      (ctx: CanvasRenderingContext2D, o: NalvlObstacle, selected: boolean, cam: Camera) => {
        const pts = o.points.map(toScreen);
        if (pts.length === 0) return;

        // Wind/suction fields share the "faint white area with particles"
        // look with the replay renderer, so the editor previews exactly what
        // test-play and Play will show.
        if (o.kind === "wind" || o.kind === "suction") {
          paintForceFields(
            ctx,
            [
              {
                kind: o.kind,
                points: o.points,
                direction: o.fieldDirection,
                strength: o.fieldStrength ?? 0,
              },
            ],
            {
              tx: (x) => (x - cam.x) * cam.scale + view.current.width / 2,
              ty: (y) => (y - cam.y) * cam.scale + view.current.height / 2,
              scale: cam.scale,
              mode: "lines",
            },
            editorParticles,
            // A fixed time keeps the editor's particles still between redraws
            // (a drag repaints at pointer rate, which would otherwise flicker).
            0.25,
          );
          if (selected) {
            ctx.save();
            ctx.strokeStyle = "#38bdf8";
            ctx.fillStyle = "#38bdf8";
            ctx.lineWidth = 2;
            for (const p of pts) {
              ctx.beginPath();
              ctx.arc(p.x, p.y, HANDLE_PX / 2, 0, Math.PI * 2);
              ctx.fill();
            }
            ctx.restore();
          }
          return;
        }

        const visual = wallVisual(
          o.kind === "zone"
            ? (o.zoneType ?? "boost")
            : o.kind === "portal"
              ? "portal"
              : o.kind === "accelerator"
                ? "accelerator"
                : (o.wallType ?? "normal"),
        );
        ctx.save();
        if (o.kind === "zone") {
          ctx.beginPath();
          pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
          ctx.closePath();
          ctx.globalAlpha = 0.22;
          ctx.fillStyle = visual.color;
          ctx.fill();
          ctx.globalAlpha = 0.7;
          ctx.setLineDash([6, 4]);
          ctx.strokeStyle = visual.color;
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.setLineDash([]);
        } else if (o.kind === "accelerator") {
          // A wire: glow + dashed core, matching the replay renderer.
          const a = pts[0];
          const b = pts[1] ?? pts[0];
          ctx.lineCap = "round";
          ctx.strokeStyle = withAlpha(visual.color, 0.18);
          ctx.lineWidth = Math.max(6, 7 * cam.scale);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
          ctx.strokeStyle = visual.color;
          ctx.lineWidth = Math.max(1.5, visual.width * cam.scale);
          ctx.setLineDash([9, 5]);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
          ctx.setLineDash([]);
        } else {
          // A thin wall would otherwise be a hairline at low zoom, so the drawn
          // stroke is floored at ~4px on screen. This is the single biggest
          // "the editor is finicky" fix: you can now see and grab what you drew.
          const core = Math.max(4, (o.thickness ?? 8) * cam.scale);
          ctx.strokeStyle = visual.color;
          ctx.lineCap = "round";
          if (pts.length === 1) {
            ctx.fillStyle = visual.color;
            ctx.beginPath();
            ctx.arc(pts[0].x, pts[0].y, core / 2, 0, Math.PI * 2);
            ctx.fill();
          } else {
            ctx.lineWidth = o.wallType === "finish" ? core * 2 : core;
            ctx.beginPath();
            pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
            ctx.stroke();
            if (o.kind === "portal" && pts.length >= 2) {
              // Arrowhead at the second point showing travel direction.
              const a = pts[0];
              const b = pts[1];
              const ang = Math.atan2(b.y - a.y, b.x - a.x);
              ctx.beginPath();
              ctx.moveTo(b.x, b.y);
              ctx.lineTo(b.x - 12 * Math.cos(ang - 0.4), b.y - 12 * Math.sin(ang - 0.4));
              ctx.lineTo(b.x - 12 * Math.cos(ang + 0.4), b.y - 12 * Math.sin(ang + 0.4));
              ctx.closePath();
              ctx.fillStyle = visual.color;
              ctx.fill();
            }
          }
        }
        // Moving-block preview: the wall's travel line and a ghost of the wall at
        // the far end, so the author can see where it will slide.
        if (o.kind === "wall" && o.motionPeriod != null && (o.motionDx || o.motionDy)) {
          const ox = (o.motionDx ?? 0) * cam.scale;
          const oy = (o.motionDy ?? 0) * cam.scale;
          ctx.save();
          ctx.setLineDash([4, 4]);
          ctx.globalAlpha = 0.55;
          ctx.strokeStyle = "#fbbf24";
          ctx.lineWidth = 1.5;
          const p0 = pts[0];
          ctx.beginPath();
          ctx.moveTo(p0.x, p0.y);
          ctx.lineTo(p0.x + ox, p0.y + oy);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.globalAlpha = 0.3;
          ctx.beginPath();
          pts.forEach((p, i) =>
            i === 0 ? ctx.moveTo(p.x + ox, p.y + oy) : ctx.lineTo(p.x + ox, p.y + oy),
          );
          ctx.stroke();
          ctx.restore();
        }
        if (selected) {
          ctx.strokeStyle = "#38bdf8";
          ctx.fillStyle = "#38bdf8";
          ctx.lineWidth = 2;
          for (const p of pts) {
            ctx.beginPath();
            ctx.arc(p.x, p.y, HANDLE_PX / 2, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.restore();
      },
      [toScreen, editorParticles],
    );

    // The engine always spawns the arrow at the world origin, facing -y (up the
    // screen). Nothing in the level payload moves it, so the author needs to see
    // it: a run that starts inside a wall dies on tick 0 and looks like a bug.
    const drawSpawn = React.useCallback(
      (ctx: CanvasRenderingContext2D) => {
        const c = toScreen({ x: 0, y: 0 });
        const r = Math.max(14, 30 * camRef.current.scale);
        ctx.save();
        ctx.translate(c.x, c.y);
        // Faint halo.
        const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 1.6);
        halo.addColorStop(0, "rgba(56,189,248,0.30)");
        halo.addColorStop(1, "rgba(56,189,248,0)");
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(0, 0, r * 1.6, 0, Math.PI * 2);
        ctx.fill();
        // Crosshair.
        ctx.strokeStyle = "rgba(56,189,248,0.85)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(-r, 0);
        ctx.lineTo(r, 0);
        ctx.moveTo(0, -r);
        ctx.lineTo(0, r);
        ctx.stroke();
        // The arrow: a narrow chevron pointing up (-y), the spawn heading.
        ctx.fillStyle = "#38bdf8";
        ctx.strokeStyle = "rgba(2,6,23,0.85)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, -r * 0.75);
        ctx.lineTo(r * 0.45, r * 0.55);
        ctx.lineTo(0, r * 0.2);
        ctx.lineTo(-r * 0.45, r * 0.55);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        // Label.
        ctx.font = "600 11px ui-sans-serif, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillStyle = "rgba(226,232,240,0.95)";
        ctx.fillText("START", 0, -r * 0.9);
        ctx.restore();
      },
      [toScreen],
    );

    const draw = React.useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const { width, height: h, dpr } = view.current;
      const cam = camRef.current;
      const {
        level: lvl,
        selectedIds: sel,
        tool: t,
        wallType: wt,
        zoneType: zt,
      } = propsRef.current;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#07070b";
      ctx.fillRect(0, 0, width, h);

      // World grid at the current snap spacing, snapped so it scrolls with the
      // camera; falls back to 100 units when snapping is off.
      const step = propsRef.current.snap || 100;
      const tl = toWorld(0, 0);
      const br = toWorld(width, h);
      ctx.strokeStyle = "rgba(148,163,184,0.10)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = Math.floor(tl.x / step) * step; x <= br.x; x += step) {
        const s = toScreen({ x, y: 0 });
        ctx.moveTo(s.x, 0);
        ctx.lineTo(s.x, h);
      }
      for (let y = Math.floor(tl.y / step) * step; y <= br.y; y += step) {
        const s = toScreen({ x: 0, y });
        ctx.moveTo(0, s.y);
        ctx.lineTo(width, s.y);
      }
      ctx.stroke();
      // Axes.
      ctx.strokeStyle = "rgba(148,163,184,0.25)";
      ctx.beginPath();
      const origin = toScreen({ x: 0, y: 0 });
      ctx.moveTo(origin.x, 0);
      ctx.lineTo(origin.x, h);
      ctx.moveTo(0, origin.y);
      ctx.lineTo(width, origin.y);
      ctx.stroke();

      for (const o of lvl.obstacles) drawObstacle(ctx, o, sel.includes(o.id), cam);

      drawSpawn(ctx);

      // Preview of an in-progress create drag.
      const drag = dragRef.current;
      if (drag?.kind === "create") {
        const pts = drag.points.map(toScreen);
        const cur = toScreen(drag.cursor);
        ctx.save();
        ctx.strokeStyle = "#38bdf8";
        ctx.fillStyle = "rgba(56,189,248,0.2)";
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 4]);
        if (t === "zone" || t === "wind" || t === "suction") {
          ctx.beginPath();
          ctx.rect(pts[0].x, pts[0].y, cur.x - pts[0].x, cur.y - pts[0].y);
          ctx.fill();
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          ctx.lineTo(cur.x, cur.y);
          ctx.stroke();
        }
        ctx.restore();
      }

      // Box-select rectangle.
      if (drag?.kind === "marquee") {
        const a = toScreen(drag.start);
        const b = toScreen(drag.cursor);
        ctx.save();
        ctx.fillStyle = "rgba(56,189,248,0.14)";
        ctx.strokeStyle = "rgba(56,189,248,0.9)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 4]);
        ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
        ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
        ctx.restore();
      }
      void wt;
      void zt;
    }, [drawObstacle, drawSpawn, toScreen, toWorld]);

    drawRef.current = draw;

    React.useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const parent = canvas.parentElement;
      if (!parent) return;
      const resize = () => {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const width = parent.clientWidth;
        view.current = { width, height, dpr };
        canvas.width = Math.max(1, Math.round(width * dpr));
        canvas.height = Math.max(1, Math.round(height * dpr));
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        draw();
      };
      resize();
      const observer = new ResizeObserver(resize);
      observer.observe(parent);
      return () => observer.disconnect();
    }, [draw, height]);

    // Fit once when the level identity changes (a new level or an import).
    const firstObstacleId = level.obstacles[0]?.id ?? "";
    const obstacleCount = level.obstacles.length;
    const levelName = level.name;
    React.useEffect(() => {
      fit();
    }, [levelName, obstacleCount, firstObstacleId, fit]);

    // ---- interaction --------------------------------------------------------

    const hitTest = (world: NalvlPoint): { id: string; index: number } | { id: string } | null => {
      const lvl = propsRef.current.level;
      const tol = Math.max(HIT_PX / camRef.current.scale, MIN_HIT_WORLD);
      // Vertices of any selected obstacle first, so a handle wins over a body.
      for (const selId of propsRef.current.selectedIds) {
        const sel = lvl.obstacles.find((o) => o.id === selId);
        if (!sel) continue;
        for (let i = 0; i < sel.points.length; i++) {
          const p = sel.points[i];
          if (dist2(p.x, p.y, world.x, world.y) <= tol * tol) return { id: sel.id, index: i };
        }
      }
      // Then any obstacle body (reverse order so the topmost wins).
      for (let i = lvl.obstacles.length - 1; i >= 0; i--) {
        const o = lvl.obstacles[i];
        if (o.points.length === 1) {
          const p = o.points[0];
          if (dist2(p.x, p.y, world.x, world.y) <= tol * tol) return { id: o.id };
        }
        for (let j = 0; j + 1 < o.points.length; j++) {
          const a = o.points[j];
          const b = o.points[j + 1];
          if (pointSegDist(world.x, world.y, a.x, a.y, b.x, b.y) <= tol) return { id: o.id };
        }
        if (o.kind === "zone" && o.points.length >= 3) {
          const a = o.points[o.points.length - 1];
          const b = o.points[0];
          if (pointSegDist(world.x, world.y, a.x, a.y, b.x, b.y) <= tol) return { id: o.id };
        }
      }
      return null;
    };

    const commitPoints = (id: string, fn: (points: NalvlPoint[]) => NalvlPoint[]) => {
      const lvl = propsRef.current.level;
      onChange({
        ...lvl,
        obstacles: lvl.obstacles.map((o) => (o.id === id ? { ...o, points: fn(o.points) } : o)),
      });
    };

    const translateMany = (ids: string[], dx: number, dy: number) => {
      const lvl = propsRef.current.level;
      const set = new Set(ids);
      onChange({
        ...lvl,
        obstacles: lvl.obstacles.map((o) =>
          set.has(o.id) ? { ...o, points: o.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) } : o,
        ),
      });
    };

    /** Obstacles with at least one vertex inside the rectangle. */
    const obstaclesInRect = (a: NalvlPoint, b: NalvlPoint): string[] => {
      const minX = Math.min(a.x, b.x);
      const maxX = Math.max(a.x, b.x);
      const minY = Math.min(a.y, b.y);
      const maxY = Math.max(a.y, b.y);
      const hit: string[] = [];
      for (const o of propsRef.current.level.obstacles) {
        if (o.points.some((p) => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY)) {
          hit.push(o.id);
        }
      }
      return hit;
    };

    // Active pointers, for pinch-zoom / two-finger pan on touch devices.
    const pointersRef = React.useRef<Map<number, { x: number; y: number }>>(new Map());
    const pinchRef = React.useRef<{ dist: number; cx: number; cy: number; cam: Camera } | null>(
      null,
    );

    const localPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const beginPinch = () => {
      const pts = [...pointersRef.current.values()];
      if (pts.length !== 2) return;
      const [a, b] = pts;
      pinchRef.current = {
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        cx: (a.x + b.x) / 2,
        cy: (a.y + b.y) / 2,
        cam: { ...camRef.current },
      };
      // Two fingers means "navigate", not "edit".
      dragRef.current = null;
    };

    const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const { x: sx, y: sy } = localPoint(e);
      pointersRef.current.set(e.pointerId, { x: sx, y: sy });
      canvas.setPointerCapture(e.pointerId);
      if (pointersRef.current.size >= 2) {
        beginPinch();
        return;
      }

      const world = snapWorld(toWorld(sx, sy));
      const t = propsRef.current.tool;

      const panning = t === "pan" || e.button === 1 || e.altKey;
      if (panning) {
        const cam = camRef.current;
        dragRef.current = { kind: "pan", startX: sx, startY: sy, camX: cam.x, camY: cam.y };
        return;
      }

      const hit = hitTest(world);
      if (t === "select") {
        if (hit && "index" in hit) {
          onSelect([hit.id]);
          dragRef.current = { kind: "vertex", id: hit.id, index: hit.index, point: world };
        } else if (hit) {
          const already = propsRef.current.selectedIds.includes(hit.id);
          if (e.shiftKey) {
            // Toggle membership; no move drag so the selection is not disturbed.
            const next = already
              ? propsRef.current.selectedIds.filter((id) => id !== hit.id)
              : [...propsRef.current.selectedIds, hit.id];
            onSelect(next);
            return;
          }
          const ids = already ? propsRef.current.selectedIds : [hit.id];
          if (!already) onSelect(ids);
          dragRef.current = { kind: "move", ids, last: world };
        } else {
          dragRef.current = { kind: "marquee", start: world, cursor: world, additive: e.shiftKey };
          if (!e.shiftKey) onSelect([]);
        }
        return;
      }

      // A draw tool: dragging from an existing handle moves it; elsewhere it
      // starts a new obstacle.
      if (hit && "index" in hit) {
        onSelect([hit.id]);
        dragRef.current = { kind: "vertex", id: hit.id, index: hit.index, point: world };
        return;
      }
      dragRef.current = { kind: "create", points: [world], cursor: world };
    };

    const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
      const { x: sx, y: sy } = localPoint(e);
      if (pointersRef.current.has(e.pointerId))
        pointersRef.current.set(e.pointerId, { x: sx, y: sy });

      // Pinch-zoom / two-finger pan.
      const pinch = pinchRef.current;
      if (pinch && pointersRef.current.size >= 2) {
        const pts = [...pointersRef.current.values()];
        const [a, b] = pts;
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const cx = (a.x + b.x) / 2;
        const cy = (a.y + b.y) / 2;
        const cam = camRef.current;
        cam.scale = Math.max(0.05, Math.min(8, pinch.cam.scale * (dist / Math.max(1, pinch.dist))));
        cam.x = pinch.cam.x - (cx - pinch.cx) / cam.scale;
        cam.y = pinch.cam.y - (cy - pinch.cy) / cam.scale;
        draw();
        return;
      }

      const drag = dragRef.current;
      if (!drag) return;
      const world = snapWorld(toWorld(sx, sy));
      if (drag.kind === "pan") {
        const cam = camRef.current;
        cam.x = drag.camX - (sx - drag.startX) / cam.scale;
        cam.y = drag.camY - (sy - drag.startY) / cam.scale;
        draw();
        return;
      }
      if (drag.kind === "vertex") {
        commitPoints(drag.id, (pts) => pts.map((p, i) => (i === drag.index ? world : p)));
        return;
      }
      if (drag.kind === "move") {
        const dx = world.x - drag.last.x;
        const dy = world.y - drag.last.y;
        drag.last = world;
        translateMany(drag.ids, dx, dy);
        return;
      }
      if (drag.kind === "create" || drag.kind === "marquee") {
        drag.cursor = world;
        draw();
      }
    };

    const endPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
      pointersRef.current.delete(e.pointerId);
      if (pointersRef.current.size < 2) pinchRef.current = null;
      const canvas = canvasRef.current;
      if (canvas && canvas.hasPointerCapture(e.pointerId))
        canvas.releasePointerCapture(e.pointerId);
    };

    const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current;
      dragRef.current = null;
      endPointer(e);
      if (!drag || (drag.kind !== "create" && drag.kind !== "marquee")) {
        draw();
        return;
      }
      if (drag.kind === "marquee") {
        const inside = obstaclesInRect(drag.start, drag.cursor);
        const next = drag.additive
          ? [...new Set([...propsRef.current.selectedIds, ...inside])]
          : inside;
        onSelect(next);
        draw();
        return;
      }
      const {
        tool: t,
        wallType: wt,
        zoneType: zt,
        fieldDirection: fd,
        fieldStrength: fs,
        acceleratorSpeed: as,
        acceleratorAccel: aa,
      } = propsRef.current;
      const start = drag.points[0];
      const end = drag.cursor;
      const moved = Math.hypot(end.x - start.x, end.y - start.y) > 8;
      const round = (p: NalvlPoint) => snapWorld({ x: Math.round(p.x), y: Math.round(p.y) });
      const lvl = propsRef.current.level;
      if (t === "zone" || t === "wind" || t === "suction") {
        if (!moved) {
          draw();
          return;
        }
        const pts = [
          round(start),
          round({ x: end.x, y: start.y }),
          round(end),
          round({ x: start.x, y: end.y }),
        ];
        const o =
          t === "zone"
            ? { ...defaultObstacle("zone", pts), zoneType: zt }
            : {
                ...defaultObstacle(t, pts),
                fieldDirection: fd,
                fieldStrength: fs,
              };
        onSelect([o.id]);
        onChange({ ...lvl, obstacles: [...lvl.obstacles, o] });
      } else if (t === "portal" || t === "accelerator") {
        if (!moved) {
          draw();
          return;
        }
        const o =
          t === "portal"
            ? defaultObstacle("portal", [round(start), round(end)])
            : {
                ...defaultObstacle("accelerator", [round(start), round(end)]),
                acceleratorSpeed: as,
                acceleratorAccel: aa,
              };
        onSelect([o.id]);
        onChange({ ...lvl, obstacles: [...lvl.obstacles, o] });
      } else {
        const pts = moved ? [round(start), round(end)] : [round(start)];
        const o = { ...defaultObstacle("wall", pts), wallType: wt };
        onSelect([o.id]);
        onChange({ ...lvl, obstacles: [...lvl.obstacles, o] });
      }
      draw();
    };

    const onPointerCancel = (e: React.PointerEvent<HTMLCanvasElement>) => {
      dragRef.current = null;
      endPointer(e);
      draw();
    };

    const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const before = toWorld(sx, sy);
      const cam = camRef.current;
      cam.scale = Math.max(0.05, Math.min(8, cam.scale * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
      const after = toWorld(sx, sy);
      cam.x += before.x - after.x;
      cam.y += before.y - after.y;
      draw();
    };

    return (
      <canvas
        ref={canvasRef}
        className={className}
        style={{ touchAction: "none", cursor: tool === "pan" ? "grab" : "crosshair" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
      />
    );
  },
);
