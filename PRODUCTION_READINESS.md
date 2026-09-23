# Operational scope and verification

Updated for persistent booking requests and `/admin`.

## Implemented

- Server-validated customer submissions with server-calculated prices and timing;
  stored mission/price snapshots preserve the request's original estimate.
- SQLite persistence on a dedicated Docker volume, WAL mode and online backups.
- Customer reference receipt, retry deduplication, bounded input sizes, public
  request rate limiting and no unauthenticated booking-list/detail endpoint.
- Admin password hashing for verification, random server-side session tokens
  stored only as hashes, HttpOnly/SameSite cookies, HTTPS-only production cookies,
  eight-hour expiry, logout/restart revocation, login throttling, Origin validation
  and CSRF validation for authenticated writes.
- Search, status/date filtering, pagination, details, status updates, rescheduling,
  private notes, activity history and stale-update protection.
- Transactional confirmed-event conflict checks including the operating buffer.
- Shared combat theme and responsive admin layout; accessible labels and errors.
- Non-root Node service on port 5173, no host port exposure, external proxy_network
  only, read-only root filesystem, persistent writable data volume, health check.

## Verified automatically

Production frontend/server builds and existing calculation tests. API integration
tests cover authentication, secure cookies, login throttling, origin/CSRF checks,
logout revocation, server-side validation, price tampering, 15-minute community
base time, retry deduplication, customer-data access, restart persistence,
conflicting confirmations, optimistic concurrency, rescheduling, cancellation,
future-event completion rejection and activity history.

The built server was smoke-tested for `/`, `/admin`, `/admin/`, health and private
API access. The online backup command produced a database passing SQLite integrity
checks. The production dependency audit reported zero known vulnerabilities at the
time of this change; the Compose YAML was checked for the single external network,
private port and persistent volume.

## Not included / deployment checks still required

- No online payments, refunds, invoices or automatic customer emails. Admin changes
  must be communicated to customers separately. Pending is not a reservation.
- One configured admin account; no multi-user roles, MFA or self-service password
  reset. Rotate credentials through server configuration.
- One mobile operation: no multi-fleet resource allocation or travel routing.
- No automatic deletion/retention policy or customer portal. Set an appropriate
  business retention process for stored customer details and backups.
- Live Docker/Nginx Proxy Manager/TLS deployment, browser visual checks and full
  browser interactions must be checked on the user's server. The available cloud
  browser cannot access the local development preview; Docker is unavailable here.
- Perform a restore drill using the documented backup procedure and a separate
  volume before relying on the production backup routine.

Package pricing, rotation rules, venue suitability and timings require the
operator's commercial approval; this implementation does not certify them.


## Business workspace update

- Staff/admin roles with optional finance access enforced server-side; changed permissions revoke sessions.
- Payment/refund ledger uses integer cents and original booking currencies; estimates are not income.
- Uploaded media is normalised with FFmpeg and retained in the persistent data volume. Back up media and database together.
- SMTP and official social publishing need provider credentials/approvals. No live delivery has been verified in this environment.
- KPI definitions, historical gaps, permission scope and unmeasured metrics are explicit; no invented reach, open rates, profit or ROAS.
- Browser video recording/rendered layout and Docker/Nginx deployment still need target-host checks. See MARKETING_SETUP.md.
