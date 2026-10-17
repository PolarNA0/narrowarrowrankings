import { createFileRoute } from "@tanstack/react-router";
import { readAllTasBoards } from "@/lib/tas-board.server";

/**
 * Every level's TAS board in one request. The record tracker needs to fold TAS
 * submissions into its timeline, and fetching a board per level would be one
 * request per level on every page load — this is a single read of the
 * `tas_boards` collection instead.
 */
export const Route = createFileRoute("/api/tas-leaderboards")({
  server: {
    handlers: {
      GET: async () => {
        const boards = await readAllTasBoards();
        return Response.json(boards, {
          headers: { "cache-control": "no-store" },
        });
      },
    },
  },
});
