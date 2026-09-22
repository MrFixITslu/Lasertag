# Laser Tag Booking Experience

**Launch status: preview only. Real bookings and payments are unavailable.** See [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md) for verified fixes and remaining blockers.

Tactical, mobile-first booking experience for the Saint Lucia laser tag business.

## V1 product goals

- Tactical mission-control visual direction with animated HUD micro-interactions.
- Direct booking for public, birthday/private, and community/festival missions.
- Request-a-Mission flow for corporate and resort events.
- Minimum 6 players; 12 players can play simultaneously.
- Larger groups rotate in squads, with provisional +30 minutes per additional group of up to 6 players.
- Fixed start-time selection between 8:00 AM and 4:00 PM.
- One-hour operational buffer around each booking for setup and teardown.
- Island-wide deployment/location capture.
- Full-payment checkout flow behind a payment-provider abstraction.
- Lightweight customer account model designed to support loyalty and future self-service booking management.
- Weather preference: customers may opt in to play in light rain when conditions remain safe.
- Reduced-motion support.

## Important V1 note

This repository starts as an interactive booking prototype. Payment processing, persistent accounts, real availability, travel-time rules, and production authentication are intentionally abstracted behind interfaces so they can be connected to the final providers later.

Package durations in the initial UI are configurable data and should be checked against the final approved commercial package sheet before production launch.

## Development

```bash
npm ci
npm run dev
```

Build:

```bash
npm run build
```


## Docker deployment behind host Nginx

The production container serves the built Vite app with Nginx inside the container.

Host port mapping:

```text
127.0.0.1:5173 -> container:80
```

This keeps port 5173 private to the server. The host Nginx instance remains the public entry point on port 80.

Build and start:

```bash
git pull origin main
docker compose up -d --build
```

Check the container locally:

```bash
curl http://127.0.0.1:5173/health
curl -I http://127.0.0.1:5173/
```

A host Nginx example is provided at:

```text
deploy/host-nginx.conf.example
```

The production hostname is `combatzone.v79sl.com`. Copy the provided config into the host Nginx configuration, enable the site, then reload Nginx.

Example:

```bash
sudo cp deploy/host-nginx.conf.example /etc/nginx/sites-available/combatzone
sudo ln -s /etc/nginx/sites-available/combatzone /etc/nginx/sites-enabled/combatzone
sudo nginx -t
sudo systemctl reload nginx
```

Public URL:

```text
http://combatzone.v79sl.com
```

Once DNS resolves correctly, add HTTPS with Certbot:

```bash
sudo certbot --nginx -d combatzone.v79sl.com
```

For future deployments:

```bash
cd /path/to/Lasertag
git pull origin main
docker compose up -d --build
```

The container uses `restart: unless-stopped`, so it returns automatically after server or Docker restarts.
