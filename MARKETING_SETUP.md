# CombatZone SLU — business and marketing workspace

## Why this approach

| Approach | Benefits | Trade-offs |
| --- | --- | --- |
| Separate CRM, design and social tools | Mature tools; quick integrations | Multiple subscriptions, accounts and screens |
| Custom editor, delivery network and social platform replacement | Complete control | Excessive maintenance and server load; cannot bypass platform requirements |
| **One CombatZone workspace plus official delivery APIs** | Booking context, permissions, branded creation and reports in one app | One-time sender/platform setup; platforms retain approval and visibility rules |

The third approach is implemented. Daily creation, event management, email sends and supported social publishing are available in `/admin`. This is a focused campaign studio, not a full nonlinear video editor or a replacement for the platforms' account setup/approval process.

## Access model

| Capability | Owner / administrator | Staff | Staff granted finance |
| --- | --- | --- | --- |
| Booking contacts, schedule, notes and status | Yes | Yes | Yes |
| Booking operations KPIs | Yes | Yes | Yes |
| Booking price snapshots, payments, refunds, finance KPIs | Yes | No | Yes |
| Staff accounts and finance grants | Yes | No | No |
| Events, media, campaigns, audiences, email, social and marketing KPIs | Yes | No | No |
| Audit log and KPI target configuration | Yes | No | No |

The original `.env` owner login remains available. Administrators add users by name, email and password (16–256 characters). Passwords are salted and hashed; no password is displayed after creation. Share initial credentials privately. Staff sign in at `/admin` using their email. The screen exposes only permitted sections, and the server independently checks every request. Finance is off by default for staff. Administrators always have finance access; use the staff role for someone who must not see financial data.

Changing role, finance permission, active status or password immediately revokes that account's sessions. Administrators cannot edit their own access; another administrator or the original owner can. Restarting the app revokes all sessions. Do not record sensitive financial amounts in shared booking notes: operational notes are deliberately visible to the booking team.

## Income

In **Income**, choose a booking and record money already received or refunded. Amounts are stored in integer cents, in the booking's existing XCD or USD currency. Currencies are never added together or converted silently. Refunds cannot exceed net recorded payments. Repeated submissions using the same request key do not duplicate the payment.

The ledger is append-only. Correct an incorrect payment with an opposite entry and an explanatory note. Estimates, remaining estimates and credits are separate from collected cash. An estimate is not an invoice; this is not a tax/general-ledger accounting package and it does not charge cards. Cancelled bookings keep their payment history. CSV exports label amounts as cents.

## Campaign Lab

1. Choose Birthday, Corporate or Community styling; choose portrait, square or landscape.
2. Edit headline, supporting line, call to action, colour and footer. Upload licensed images or footage, including your Falcon footage.
3. Export a JPEG, or create a 12-second silent promotional clip with animated type and an optional video background. Keep the tab foregrounded while recording.
4. The exported asset is saved into the media library. JPEG export also downloads immediately. Browser video downloads may be WebM; the server copy is converted to MP4. Use **Download attachment** to retrieve the normalised file.
5. Attach the finished asset, edit the caption and save the campaign. Saved designs can be reopened or reused through **New draft**.
6. Select a channel and explicitly publish the saved version. Save edits before publishing.

Source uploads: JPEG/PNG/WebP up to 15 MB; MP4/WebM up to 80 MB. FFmpeg decodes and normalises images to JPEG and video to H.264/AAC MP4, limits dimensions and caps videos at 60 seconds. Only one upload is processed at a time, with two video encoding threads and a 120-second processing limit. Docker includes FFmpeg. Install it separately for local development. Uploaded media persists in `/app/data/media` inside `booking_data`.

The studio uses template-based copy assistance; it does not generate new gameplay footage with AI, remove backgrounds, mix audio, or provide multi-track editing. The landing page's YouTube embed is not a downloadable source for the editor: upload your own licensed source clip.

## Events

Select **Public event**, set the date and location, attach artwork/video and check **Publish event on landing page**. Save to publish. Only live, non-expired events appear in the landing page event board; drafts never appear. Events are marketing listings, not automatic calendar reservations. The customer still submits a normal booking request. Uncheck the live option and save to remove the listing.

Media becomes publicly accessible at an unguessable `/uploads/` URL when used in a live event, email or social post. Unpublishing an event does not revoke an already shared asset URL or remove a post from another platform. Do not upload private customer documents to the marketing library.

## Email setup and workflow

Configure these variables in `.env` (or the Portainer stack environment), then recreate the container:

```dotenv
SMTP_HOST=your-smtp-provider-host
SMTP_PORT=587
SMTP_USER=your-smtp-username
SMTP_PASSWORD='your-smtp-password'
SMTP_FROM='CombatZone SLU <your-verified-sender-address>'
MAIL_BUSINESS_ADDRESS='Your actual business postal address'
```

Use your provider's verified sending domain/address and its SPF/DKIM/DMARC instructions. TLS is required: port 465 uses implicit TLS; other ports use STARTTLS. Credentials remain server-side and must never have a `VITE_` prefix.

Add potential clients under **Audience**, with a segment and permission/source notes. Importing booking contacts includes only those who opted into marketing, and never restores unsubscribed contacts. It does not import every booking contact automatically.

Create an introduction or special-offer draft in **Email**, personalise with `{{name}}`, and optionally attach JPEG campaign artwork. The app sends branded HTML plus plain-text fallback, a booking CTA, your postal address and an unsubscribe link. The tracked HTML CTA records unique campaign/contact clicks and can attribute a later booking in the same browser tab. Direct URLs in manually written copy are not tracked automatically. Images use public HTTPS URLs; the recipient's email client may block images.

A send requires confirmation and an audience of 1–100 subscribed contacts. Every recipient receives a separate email; recipients are never placed together in To/CC. SMTP acceptance is recorded separately from confirmed inbox delivery. Review results with **View delivery results**. Bounces and open rates are not measured in this release.

There are no automatic retries after an ambiguous SMTP result. On restart, interrupted/queued deliveries are marked unknown for manual review. Check the provider before creating a new campaign for those addresses. This deliberately avoids duplicate promotional emails. No scheduled/recurring sends are implemented.

Unsubscribe links show a confirmation page on GET, then suppress on POST, so ordinary link previews do not unsubscribe people. Suppression is checked again immediately before each message is sent. Keep your audience permission/source records accurate.

## Official social publishing connections

Connections reports whether required configuration exists, not whether it has been validated by a provider. There is no OAuth connect wizard in this release. Generate/authorise credentials using each provider's official developer tools, place them in server configuration, and recreate the container. Tokens with limited lifetimes require renewal. The adapter code is present; live publishing must be verified with your approved accounts before use.

| Channel | Environment | Requirements / behaviour |
| --- | --- | --- |
| Facebook | `FACEBOOK_PAGE_ID`, `FACEBOOK_PAGE_TOKEN`, `META_GRAPH_VERSION` (default `v25.0`) | A Page access token with appropriate Page posting permissions; text, JPEG/photo or MP4/video posts. Video results are submitted, not assumed published. |
| Instagram | `INSTAGRAM_ACCOUNT_ID`, `INSTAGRAM_TOKEN`, `META_GRAPH_VERSION` | Facebook Login integration: professional Instagram account linked to a Facebook Page, content-publishing permissions and approved app access as applicable. JPEG or MP4 Reel. Caption/title combined ≤2,200 characters. Polls processing briefly before publishing; slow processing requires review. |
| TikTok | `TIKTOK_ACCESS_TOKEN` | Content Posting API `video.publish`, approved app and verified public media URL domain/prefix. Load creator options, select visibility explicitly, then publish MP4. Own-business promotion disclosure is enabled. Comments, Duets and Stitches are disabled. Unaudited clients may be limited to private visibility; internal-only integrations may not qualify for audit. |
| YouTube | `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN` | OAuth upload scope, authorised channel and configured API project. MP4 upload with explicit visibility and made-for-kids choice. Unverified projects may be restricted to private uploads. Title ≤100 characters. |

Platform processing, quotas, media specifications and app reviews still apply. This does not purchase ads, boost posts, automatically import platform insights, or bypass provider approvals. Downloads and editable captions remain available if a channel cannot be connected. Never describe an unconfirmed submission as published.

The publishing log records IDs and outcomes. **Reconcile verified outcome** is for an administrator who has checked the destination account: record published, or confirmed failed to allow another attempt. Unknown results are not retried automatically. Social credentials are not sent to the browser or recorded in audit messages.

Official references:
- https://developers.facebook.com/docs/pages-api/posts/
- https://developers.facebook.com/docs/instagram-platform/content-publishing/
- https://developers.tiktok.com/doc/content-posting-api-get-started
- https://developers.tiktok.com/doc/content-posting-api-reference-direct-post
- https://developers.google.com/youtube/v3/docs/videos/insert

## KPI definitions and coverage

Use **KPIs** to select a reporting period (up to 366 days), compare eligible metrics to the preceding equal-length period, inspect daily demand and export values/definitions. All reporting days use Saint Lucia time. Request status metrics are cohort metrics: requests created in the selected period, using their current status. They are not historical status snapshots. Counts labelled snapshot are all-time current state and have no comparison. Null means not measured, never zero.

| Group | Tracked metrics |
| --- | --- |
| Booking operations | Requests; confirmed/completed requests; confirmation rate; cancellation rate; first saved staff action time; repeat-request rate by email; pending backlog; pending events whose date passed; upcoming confirmed events; booked players at completed events; daily request trend; demand by mission and area |
| Finance, per currency | Payments received; refunds; net cash received; average gross receipts per paying booking; confirmed/completed estimate remaining; customer credits versus estimates |
| Marketing | Tracked landing visitors and booking starts; landing-to-request rate; subscribed and suppressed contacts; new contacts; email campaigns; SMTP acceptances; uncertain email results; unique tracked CTA click rate; email-attributed requests; confirmed social publications; submitted social videos; uncertain social outcomes |

Admins can set targets for request count, confirmation/cancellation rates, response hours, repeat requests and tracked conversion rate. Response hours and cancellation rate are maximum targets; the others are minimum targets. Request targets apply to whichever reporting window is selected, so use a consistent window length. CSV money values are cents and preserve currency in the section name.

Visitor measurement uses random browser-tab IDs, stored hashed server-side and deduplicated per day/event. It is not a count of unique people. It honours Do Not Track and the landing-footer opt-out. No IP address or user-agent is stored in the analytics table. Tracking begins after deployment; blocked tracking, new tabs and historical gaps affect conversion rates. Requests can still be counted if browser tracking is disabled. Attribution is last clicked email campaign within the tab and is indicative, not a causal claim. Link scanners can inflate click rates.

Explicitly unavailable: platform reach/impressions/followers/engagement and ad spend, email inbox-delivery/bounce/open rates, profit, acquisition cost/ROAS, actual attendance and capacity utilisation. These need insights/webhook, expense, check-in or capacity data sources. They are disclosed in the dashboard rather than fabricated.

## Deploy and back up

The app remains on port **5173** and only external **proxy_network**. Nginx accepts public HTTP 80 / HTTPS 443 and forwards to `lasertag:5173`. Set `PUBLIC_ORIGIN=https://combatzone.v79sl.com`; keep HTTPS enabled for admin cookies.

Back up the existing database before the upgrade. Schema additions preserve existing bookings and the owner account. Media files now require a backup too. For a consistent complete backup, stop the service briefly and copy `/app/data` from the stopped container:

```bash
cd ~/Lasertag
mkdir -p backups
backup_dir="backups/combatzone-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup_dir"
docker compose stop lasertag
docker cp lasertag:/app/data "$backup_dir/data"
docker compose start lasertag
```

Also preserve `.env` securely outside Git. The existing online SQLite backup script backs up the database only, not media. Do not run `docker compose down -v`. Restore data and matching code together if rolling back; do not simply overwrite a running SQLite database.

After merging:

```bash
git pull origin main
docker compose up -d --build lasertag
docker compose logs --tail=50 lasertag
```

In Nginx Proxy Manager's proxy-host Advanced settings, support uploads/conversion:

```nginx
client_max_body_size 85m;
proxy_read_timeout 180s;
proxy_send_timeout 180s;
```

Use one application instance for the SQLite store and bounded media/email workers. A Docker rebuild is required to install FFmpeg; changing only environment variables does not install it. Allow disk space for source media and backups. The same persistent volume holds financial records, users, audience data, media, campaigns and KPIs.

## Verification and release limits

Automated tests exercise existing bookings/security plus role boundaries, financial redaction, session revocation, payment idempotency/refund limits, event drafts, stale updates, opt-in imports/suppression, campaign sends using a mocked mail transport, unsubscribe/click tracking, KPI calculations/access and actual FFmpeg image conversion. No real marketing messages or posts are sent by tests.

Live SMTP delivery, platform OAuth/app approvals, actual social posting, Nginx/Docker deployment and browser recording/layout must be checked on the target installation. The development browser cannot reach this environment's localhost preview. Do not treat untested platform configuration as a ready connection. Begin with your own test audience and private/test posts after connecting accounts.
