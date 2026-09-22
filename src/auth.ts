import type { Context, Next } from "hono";
import type { Env } from "./types";

// Cloudflare Access sits in front of /admin* at the edge and refuses
// unauthenticated requests before they ever reach this Worker. This check is
// pure defense-in-depth (and doubles as an audit trail via `actorEmail`).
export async function requireAccessIdentity(c: Context<{ Bindings: Env }>, next: Next) {
  const email = c.req.header("Cf-Access-Authenticated-User-Email");
  if (!email) {
    return c.json({ error: "Nicht authentifiziert. Zugriff nur über /admin via Cloudflare Access." }, 403);
  }
  c.set("actorEmail" as never, email as never);
  await next();
}

export function actorEmail(c: Context): string {
  return (c.get("actorEmail" as never) as string) ?? "unknown";
}
