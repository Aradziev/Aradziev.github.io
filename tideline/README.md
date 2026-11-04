# Tideline

A free, installable tide chart. Swipe the curve to move through time; the readout, moon, sun times, wind and swell follow the centered marker.

- Tides: NOAA CO-OPS predictions (6-minute curve for reference stations, high/low for subordinate ones), MLLW, feet. 3,500+ US stations, searchable or nearest-to-you.
- Wind, air temp, swell, sea temperature: Open-Meteo (free, no key, non-commercial use).
- Works offline for anything already viewed (tides are cached per station per month).

## Put it online (free, about 5 minutes)

It has to be served over HTTPS to install and to use location. Easiest: GitHub Pages.

1. Create a free account at github.com, then a new public repository named `tideline`.
2. On the repo page choose "uploading an existing file", drag in every file from this folder, and commit.
3. Settings → Pages → Source: "Deploy from a branch", Branch: `main` / root → Save.
4. After a minute it's live at `https://<your-username>.github.io/tideline/`.

Alternative: Netlify Drop (app.netlify.com/drop) — drag the folder onto the page.

## Install on your phone

- iPhone (Safari): open the link → Share → Add to Home Screen.
- Android (Chrome): open the link → ⋮ menu → Install app / Add to Home screen.

## Updating

Change files and re-upload. Bump `CACHE` in `sw.js` (e.g. `tideline-v2`) so installed copies pick up the new version.

Not for navigation.
