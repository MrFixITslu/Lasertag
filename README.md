# Laser Tag Booking Experience

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
npm install
npm run dev
```

Build:

```bash
npm run build
```
