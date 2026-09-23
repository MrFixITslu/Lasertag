import { createApp } from "./app";
process.umask(0o077);
const production = process.env.NODE_ENV === "production";
const { app, db } = createApp({
  databasePath: process.env.DATABASE_PATH ?? "./data/bookings.sqlite",
  adminUsername: process.env.ADMIN_USERNAME ?? "admin",
  adminPassword: process.env.ADMIN_PASSWORD ?? "",
  publicOrigin: process.env.PUBLIC_ORIGIN ?? "http://localhost:5173",
  secureCookies: production || process.env.COOKIE_SECURE === "true",
  trustProxy: production ? 1 : 0,
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
