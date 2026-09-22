# CombatZone SLU landing media

## Approved creative direction

The user selected NETRONIC **Falcon** footage on 22 September 2026. There is no
outstanding Phantom footage requirement.

The homepage uses animated mission headlines, a decorative targeting display,
an interactive occasion selector and a Falcon equipment section. Mission facts
come from `src/data/missions.ts`, including 15-minute Community / Festival Play.
All Enter / Explore Packages links go to `#booking`. Selecting an occasion opens
its marketing brief; the customer selects their actual package in booking.

## Sources and attribution

Official video: “Outdoor laser tag with FALCON assault rifle by LASERTAG.NET”:
https://www.youtube.com/watch?v=JPc3ajSWqJA
Listed at https://lasertag.net/about-us/video . Uses YouTube's embed player,
not a copied video file. Gameplay is illustrative NETRONIC footage, not a claim
that scenes were filmed by CombatZone SLU or in Saint Lucia.

Falcon product photo:
https://netronic.net/images/media/photos-and-videos-slider-img-2.webp
Source: https://netronic.net/en/media — “Open for use with NETRONIC attribution.”
Stored locally at `public/media/netronic-falcon.webp`, credited on the page.
The earlier general poster remains available but is no longer used by the page.

## Playback and accessibility

Background video autoplays muted where the browser permits it. Pause Motion
removes that iframe and stops decorative animation. Reduced-motion users start
with the local product photo and static text, without a background video request.
Opening Watch the Action replaces the background stream with one full player in
a native modal dialog. That player provides sound, pause, seeking and fullscreen
controls. Escape or the close button dismisses it. The dialog has a direct
YouTube link if embedding is unavailable. Closing the dialog removes playback.
The page is usable with static imagery when autoplay or YouTube is unavailable.
Third-party YouTube requests occur when a player is mounted.

The nginx policy permits only `https://www.youtube-nocookie.com` for frames.
This change does not enable reservations or payments; booking remains a preview.
