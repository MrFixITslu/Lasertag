# CombatZone SLU

Mobile laser tag marketing, booking requests and a private booking-management
console for Saint Lucia.

- `/` — Falcon gameplay landing page.
- `/#booking` — customer booking request form.
- `/admin` — password-protected booking dashboard.

Customer submissions are stored as **Pending** and receive a reference. Only an
admin can confirm them. Online payment, automatic customer emails and customer
accounts are not included. Prices and package timings remain provisional.

## Admin features

Search by name, email or reference; filter by status/date; view customer and venue
details; confirm, complete, cancel or reschedule requests; keep private notes;
review activity history. Booking lists are paginated. The dashboard uses the
same combat theme as the landing and booking pages.

Confirmed schedules cannot overlap. Conflict checks include each mission's play
time, rotation extension and 60-minute operating buffer. The system assumes one
mobile operation and conservatively allocates that buffer after the event. It
does not calculate travel times. Final venue suitability, travel and customer
communication are the operator's responsibility.

## Deploy on your server

**Migration from the old static container:** Nginx Proxy Manager must now forward
to **`lasertag:5173`**, with Nginx accepting public HTTP traffic on port 80. The only Docker network remains the
existing external **`proxy_network`**. No host ports are published.

After merging and pulling the change:

```bash
cp .env.example .env
chmod 600 .env
nano .env
```

Set:

- `PUBLIC_ORIGIN=https://combatzone.v79sl.com` — exact public scheme and hostname.
- `ADMIN_USERNAME=admin` — or your preferred username.
- `ADMIN_PASSWORD=` — your own unique password, 16–256 characters. Do not leave blank.

Keep `.env` private and out of Git. In Compose `.env`, single-quote a password
containing `$` to prevent interpolation. Never put credentials in `VITE_` variables.
There is no default admin password, and startup fails if the password is missing
or too short. Do not paste credentials into issues or screenshots.

```bash
docker network inspect proxy_network
docker compose up -d --build
```

Nginx Proxy Manager must be on the same `proxy_network`. Set the Proxy Host:

| Setting | Value |
| --- | --- |
| Domain | `combatzone.v79sl.com` |
| Scheme | `http` |
| Forward hostname | `lasertag` |
| Forward port | `5173` |
| SSL | Select/request your certificate; enable Force SSL |

Visit `https://combatzone.v79sl.com/admin` and sign in with the `.env` credentials.
Secure admin cookies require HTTPS. The server trusts one reverse-proxy hop;
Nginx Proxy Manager must overwrite the forwarding headers. If adding a CDN or
other proxy layer, review the trust configuration before deploying.

```bash
docker compose ps
docker compose exec lasertag node -e "fetch('http://127.0.0.1:5173/health').then(async r=>console.log(r.status,await r.text()))"
docker inspect lasertag --format '{{json .NetworkSettings.Networks}}'
```

The network output should contain only `proxy_network`. The service runs as the
non-root `node` user with a read-only container filesystem; the data volume and
`/tmp` are writable. The old container Nginx is replaced by the Node application.
The optional `deploy/proxy-nginx.conf.example` is for a separate Nginx container.

## Data, backups and recovery

SQLite stores requests, historical package/price snapshots, internal notes and
admin activity in `/app/data/bookings.sqlite`. The named `booking_data` volume
survives container rebuilds. **Do not run `docker compose down -v`** on production:
that removes the booking volume. Back up before server or application changes.

Create a consistent online backup, then copy it off the server:

```bash
docker compose exec lasertag node scripts/backup.mjs /app/data/backups/bookings-backup.sqlite
docker cp lasertag:/app/data/backups/bookings-backup.sqlite ./bookings-backup.sqlite
```

Use a new backup filename each time (the script refuses to overwrite files).
Store copies securely: they contain customer contact details. A backup inside
the same volume alone does not protect against server/disk loss.

To restore, stop the service, preserve the current data volume, and replace
`bookings.sqlite` with the selected backup in the volume. Remove stale
`bookings.sqlite-wal` / `bookings.sqlite-shm` sidecars **only while the service is
stopped**, set ownership for UID/GID 1000 (the image's `node` user), then start and
verify the restored booking list. Test recovery with a separate data volume first.

To reset the admin password, change `ADMIN_PASSWORD` in `.env` and run
`docker compose up -d --force-recreate`. Sessions expire after eight hours and
are revoked at each server restart, so password rotation invalidates old sessions.

## Development and checks

Node 24+ is required. Copy `.env.example` to `.env`, set a password, and change
`PUBLIC_ORIGIN` to `http://localhost:5173` for development. Use that exact URL
when opening Vite; `127.0.0.1` is a different origin.

```bash
npm ci
npm run dev:server
```

In another terminal:

```bash
npm run dev
```

Vite proxies `/api` to the backend on port 3000. `dev:server` compiles the backend
and starts it; restart it after server changes. `npm run preview` alone is only
a static frontend preview and cannot manage bookings. For a complete built local
preview, build and run the server with `PUBLIC_ORIGIN=http://localhost:3000` and
open `http://localhost:3000`:

```bash
PUBLIC_ORIGIN=http://localhost:3000 npm start
```

```bash
npm run build
npm test
```

See `PRODUCTION_READINESS.md` for the verification scope and remaining limits.
See `LANDING-MEDIA.md` for media attribution and playback behaviour.

## Business workspace, marketing and KPIs

The `/admin` workspace now includes staff accounts and finance grants, a payment/refund ledger, Campaign Lab, public events, email audiences/campaigns, official social publishing adapters and a role-aware KPI dashboard. See [MARKETING_SETUP.md](MARKETING_SETUP.md) for permissions, KPI definitions, connection requirements, limitations, media backup and deployment instructions.

The studio needs FFmpeg (included in Docker). Existing online database backups do not include uploaded media; back up `/app/data/media` as well. SMTP and social credentials are optional, server-side configuration. Without them, bookings, income, design exports, events and internal KPIs work, but external sends/publishing remain disabled.
