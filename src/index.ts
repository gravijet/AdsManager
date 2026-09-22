import { Hono } from "hono";
import type { Env } from "./types";
import publicRoutes from "./routes/public";
import adminRoutes from "./routes/admin";

const app = new Hono<{ Bindings: Env }>();

app.route("/", publicRoutes);
app.route("/admin", adminRoutes);

app.notFound((c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
