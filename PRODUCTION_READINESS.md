# Production readiness review

Status: NOT ready to accept real bookings or payments.
Base reviewed: ad699f3841c6a66c1926bde2665173019ab393f7.

## Fixed in this change

- Removed simulated payment success and false request/booking confirmations. Submission now fails closed with an explicit message; no payment or reservation is claimed.
- Removed browser-local persistence of customer contact details and default marketing consent.
- Removed fabricated availability. Date and time selection now represents preference only.
- Corrected calendar dates to America/St_Lucia, including UTC-midnight/year rollover.
- Validated email and phone before progression; bounded free-text fields and player calculations.
- Calculation uses package-specific minimum/capacity and integer minor-unit pricing.
- Added keyboard focus styling, current-step semantics and notes input label.
- Added a dependency lockfile, deterministic Docker/CI installs and patched Vitest tooling.
- Added Nginx security headers, hidden-file protection, missing API 404s, and noncached HTML.

## Remaining launch blockers

1. Persistent backend: bookings, customer records, authenticated operator dashboard and audit history do not exist. Implement authoritative server validation and pricing, durable storage, access controls, rate limits, idempotency, and backup/restore verification.
2. Real scheduling: implement server-controlled availability with atomic conflict prevention, expiring payment holds, equipment capacity, setup/teardown and travel constraints. Current times are preferences, not availability.
3. Payment gateway: select a merchant provider supporting the business, configure secrets server-side, verify signed webhooks, and test success, decline, timeout, duplicate webhook, refund and reconciliation paths. Never confirm from a browser redirect alone.
4. Customer/operations communication: configure delivery and retry handling for confirmations, requests and cancellations. No request is currently sent anywhere.
5. Commercial approval: approve prices, package duration, inclusions, maximum attendance, rotation charges, taxes, travel charges, operating end times, safety/age requirements, privacy notice, cancellation/refund and weather policies. The current one-hour buffer is a total buffer; clarify whether the business intends one hour on each side before changing its calculation.
6. Deployment verification: validate Docker/Nginx configuration and container image vulnerabilities in the target runtime; verify TLS, monitoring and health checks on the actual server. Browser visual/end-to-end QA could not run because the managed browser rejected the preview connection.

The private Sites deployment is a static preview only. It does not create the missing backend or connect the user's production server.

## Verification

Run `npm ci`, `npm test`, `npm run build`, and `npm audit --audit-level=moderate`.
Regression tests cover player rotations, minimums, fixed/per-person pricing, finite bounds, contact validation and Saint Lucia date boundaries.
