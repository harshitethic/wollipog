import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AuthPrincipal } from "./identity.js";
import type { ControlPlaneDb } from "./db.js";
import { withVisibleCampaignChildren } from "./session-command-permissions.js";

/** An Orchestrator's view embeds its campaign's held children, and a route that returns the view it
 * changed does not write it for the requester, so every API response lists only the children the
 * requester may open. */
export function registerVisibleCampaignChildrenHook(
  app: FastifyInstance,
  deps: {
    db: Pick<ControlPlaneDb, "canAccessSession">;
    requestPrincipal: (req: FastifyRequest) => AuthPrincipal | null | undefined;
  },
): void {
  app.addHook("preSerialization", async (req, _reply, payload) => {
    const route = req.routeOptions?.url ?? req.url.split("?")[0] ?? "";
    if (!(route === "/api" || route.startsWith("/api/"))) return payload;
    return withVisibleCampaignChildren(deps.db, deps.requestPrincipal(req), payload);
  });
}
