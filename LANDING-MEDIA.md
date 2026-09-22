# CombatZone SLU landing media

The homepage opens the cinematic marketing page. Every mission CTA navigates to
`#booking`; browser back returns home. Existing booking validation and preview-only
status remain intact. This change does not enable reservations or payments.

## Current footage

Official NETRONIC video: “Outdoor laser tag with FALCON assault rifle by
LASERTAG.NET”, https://www.youtube.com/watch?v=JPc3ajSWqJA . It is listed at
https://lasertag.net/about-us/video and uses YouTube's embed player, rather than a
copied video file. This is **FALCON footage, not verified Phantom footage**. The
visible playback link and footer credit identify it accordingly. The video is
illustrative equipment footage, not a claim that these scenes were filmed by
CombatZone SLU or in Saint Lucia.

Poster: https://netronic.net/images/media/photos-and-videos-slider-img-3.webp
Source: https://netronic.net/en/media — “Open for use with NETRONIC attribution.”
The supplied poster is stored locally and credited in the page footer.

## Replacing with the requested Phantom footage

Obtain a verified, approved Phantom gameplay MP4 from the business or supplier.
Place it in `public/media/` and set `VITE_HERO_VIDEO_URL=/media/phantom-gameplay.mp4`
at build time, then rebuild. For Docker, either set this in the build environment
or change `videoSource` in `src/Landing.tsx` to the local path before building.
Update the poster, footage label, watch link, and credit to match the new asset.
Do not label the current Falcon video as Phantom.

Use a short compressed H.264 loop with a poster. Local MP4 playback has play/pause
and mute controls. YouTube background playback is muted and the Pause Motion button
removes the player; the Watch Gameplay link opens the full video with player controls.
Reduced-motion users get the static poster without the YouTube iframe. If embedding
is blocked or autoplay is unavailable, the poster and all booking links remain usable.
The nginx policy permits only the YouTube privacy-enhanced embed host for frames
and same-origin video files. Third-party YouTube requests occur during playback.
