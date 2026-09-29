import { createApp } from "./app";
import fs from "node:fs";
process.umask(0o077);
const production = process.env.NODE_ENV === "production";
const adminPassword = process.env.ADMIN_PASSWORD ?? "";
const linkSecret = process.env.LINK_SECRET ?? "";
const platformSecretFile = process.env.V79_PLATFORM_SHARED_SECRET_FILE ?? "/run/secrets/v79-readonly-platform-token";
const platformSecret = String(process.env.V79_PLATFORM_SHARED_SECRET || "").trim() || (() => {
  try { return fs.readFileSync(platformSecretFile, "utf8").trim(); } catch { return ""; }
})();
if (
  production &&
  (linkSecret.length < 32 || linkSecret === adminPassword)
) {
  throw new Error("Production requires a separate LINK_SECRET of at least 32 characters.");
}
const { app, db } = createApp({
  databasePath: process.env.DATABASE_PATH ?? "./data/bookings.sqlite",
  adminUsername: process.env.ADMIN_USERNAME ?? "admin",
  adminPassword,
  publicOrigin: process.env.PUBLIC_ORIGIN ?? "http://localhost:5173",
  secureCookies: production || process.env.COOKIE_SECURE === "true",
  trustProxy: production ? 1 : 0,
  linkSecret: linkSecret || adminPassword,
  platformSecret,
});
const port = Number(process.env.PORT ?? 3000);
const server = app.listen(port, "0.0.0.0", () =>
  console.log(`CombatZone server listening on port ${port}`),
);
server.requestTimeout = 180_000;
server.headersTimeout = 15_000;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () =>
    server.close(async () => {
      await Promise.allSettled([...app.locals.jobs]);
      db.close();
      process.exit(0);
    }),
  );
