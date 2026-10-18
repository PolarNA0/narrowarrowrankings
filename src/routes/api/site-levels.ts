import { createFileRoute } from "@tanstack/react-router";
import {
  addSiteLevel,
  listSiteLevels,
  type SiteLevelData,
  type SiteLevelObstacle,
  type SiteLevelRecord,
} from "@/lib/site-levels.server";

/** Hard caps so a hostile upload cannot store an unbounded payload. */
const MAX_OBSTACLES = 2000;
const MAX_POINTS_PER_OBSTACLE = 256;

interface UploadBody {
  name?: unknown;
  author?: unknown;
  arrowName?: unknown;
  data?: unknown;
}

/** A 10-char id, url-safe. Not a security boundary, just a stable handle. */
function newLevelId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function validName(v: unknown, max = 48): string | null {
  const s = String(v ?? "").trim();
  return s.length >= 1 && s.length <= max ? s : null;
}

/**
 * Validate the authored level payload. Wind/suction fields are allowed (that is
 * the whole point of a site level); everything else is checked for shape so the
 * physics layer never receives a malformed obstacle.
 */
function parseLevelData(raw: unknown): SiteLevelData | { error: string } {
  const d = raw as { obstacles?: unknown; map_name?: unknown; game_mode?: unknown } | null;
  if (!d || typeof d !== "object") return { error: "Missing level data." };
  if (!Array.isArray(d.obstacles)) return { error: "Level data has no obstacles." };
  if (d.obstacles.length === 0) return { error: "The level has no obstacles to play." };
  if (d.obstacles.length > MAX_OBSTACLES) return { error: "That level has too many obstacles." };

  const obstacles: SiteLevelObstacle[] = [];
  for (const o of d.obstacles) {
    const ob = o as SiteLevelObstacle | null;
    if (!ob || !Array.isArray(ob.points) || ob.points.length === 0) {
      return { error: "An obstacle is missing its points." };
    }
    if (ob.points.length > MAX_POINTS_PER_OBSTACLE) {
      return { error: "An obstacle has too many points." };
    }
    const points = ob.points.map((p) => ({
      x: Math.round(Number(p?.x) * 100) / 100,
      y: Math.round(Number(p?.y) * 100) / 100,
    }));
    if (points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) {
      return { error: "An obstacle has a non-numeric point." };
    }
    const field = ob.field_type === "wind" || ob.field_type === "suction" ? ob.field_type : null;
    obstacles.push({
      points,
      ...(field ? { obstacle_type: "field", field_type: field } : {}),
      ...(Number.isFinite(Number(ob.field_direction))
        ? { field_direction: Number(ob.field_direction) }
        : {}),
      ...(Number.isFinite(Number(ob.field_strength))
        ? { field_strength: Number(ob.field_strength) }
        : {}),
      ...(typeof ob.obstacle_type === "string" ? { obstacle_type: ob.obstacle_type } : {}),
      ...(typeof ob.wall_type === "string" ? { wall_type: ob.wall_type } : {}),
      ...(Number.isFinite(Number(ob.wall_thickness))
        ? { wall_thickness: Number(ob.wall_thickness) }
        : {}),
      ...(typeof ob.zone_type === "string" ? { zone_type: ob.zone_type } : {}),
      ...(Number.isFinite(Number(ob.zone_direction))
        ? { zone_direction: Number(ob.zone_direction) }
        : {}),
      ...(typeof ob.portal_id === "string" ? { portal_id: ob.portal_id } : {}),
      ...(typeof ob.side === "string" ? { side: ob.side } : {}),
    });
  }

  return {
    map_name: validName(d.map_name, 64) ?? "Site Level",
    game_mode: typeof d.game_mode === "string" ? d.game_mode : "speedrun",
    obstacles,
  };
}

export const Route = createFileRoute("/api/site-levels")({
  server: {
    handlers: {
      GET: async () => {
        const levels = await listSiteLevels();
        return Response.json({ levels }, { headers: { "cache-control": "no-store" } });
      },
      POST: async ({ request }) => {
        let body: UploadBody;
        try {
          body = (await request.json()) as UploadBody;
        } catch {
          return Response.json({ error: "Invalid JSON body" }, { status: 400 });
        }

        const name = validName(body.name);
        if (!name) return Response.json({ error: "Give the level a name (1-48 chars)." }, { status: 400 });
        const author = validName(body.author, 32);
        if (!author) {
          return Response.json({ error: "Enter a valid author name (1-32 chars)." }, { status: 400 });
        }
        const arrowName = validName(body.arrowName, 32) ?? "Narrow Arrow";

        const data = parseLevelData(body.data);
        if ("error" in data) return Response.json({ error: data.error }, { status: 400 });

        const now = new Date().toISOString();
        const record: SiteLevelRecord = {
          id: newLevelId(),
          name,
          author,
          arrowName,
          createdAt: now,
          updatedAt: now,
          data,
        };

        let levels;
        try {
          levels = await addSiteLevel(record);
        } catch {
          return Response.json({ error: "Could not publish that level." }, { status: 500 });
        }

        const saved = levels.find((l) => l.id === record.id);
        return Response.json({ level: saved ?? null, levels });
      },
    },
  },
});
