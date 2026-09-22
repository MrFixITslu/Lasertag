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


## Docker deployment with Nginx Proxy Manager

The app joins **only the existing external `proxy_network`** and serves HTTP on
container port **80**. It publishes no host ports. Nginx Proxy Manager must also
be attached to `proxy_network`.

Check the network and start the app:

```bash
docker network inspect proxy_network
docker compose config
docker compose up -d --build
```

If the network does not yet exist, create it once with
`docker network create proxy_network` and attach your proxy to that network.

In Nginx Proxy Manager, configure the Proxy Host:

- Domain: `combatzone.v79sl.com`
- Scheme: `http`
- Forward hostname: `lasertag`
- Forward port: `80`
- Request/select the domain's SSL certificate and enable Force SSL.

Check the running container:

```bash
docker compose ps
docker compose exec lasertag wget -qO- http://127.0.0.1/health
docker inspect lasertag --format '{{json .NetworkSettings.Networks}}'
```

The network output should contain only `proxy_network`. The localhost health
check runs **inside** the container; there is no host port 5173 mapping.

For future deployments after merging the changes:

```bash
git pull origin main
docker compose up -d --build
```

For a separately managed Nginx container on `proxy_network`, see
`deploy/proxy-nginx.conf.example`. Host-installed Nginx cannot resolve the
Docker service name; use the shared Docker network with Nginx Proxy Manager.

See `LANDING-MEDIA.md` for the Falcon video source and playback behaviour.
