# My-Librarium

A responsive household book-library frontend prototype with a visual map of physical bookcases.

## Current status

This is the latest standalone prototype, not a fork of the Librarium backend. It uses sample books and browser localStorage. It does **not** connect to the live Librarium API, database, ISBN lookup, cover providers, series catalogue sync, or automatic series identification yet. Changes are local to each browser/device; clearing browser storage resets them. Do not use it as the only record of your real collection.

## Features

- Separate Safi, Adam and Caleb collections.
- Book grid, search and recently added.
- Add/edit/delete books, duplicate warnings, deletion undo, local cover upload.
- Move books between collections and physical shelf locations.
- Horizontally swipeable A–I bookcases, with a shared bottom baseline.
- Physical paint colours, category colours, shelf labels and approximate capacities.
- Per-bookcase top enclosure selector: no top, no top/sides, fully enclosed.
- Varied decorative book spines (reshuffle on refresh; they do not represent actual inventory).
- Series with ordered entered volumes, owned/missing indicators, reading progress, arcs and manual linking.
- Local-agent workspace with focused catalogue checks, a persistent verification queue, and explicit confirm/reject controls.
- One-button physical shelf optimiser that minimises movement, respects capacity and protected spaces, keeps series together, and generates a shelf-by-shelf checklist.
- Separate **Initial plan** and **Full rearrange** modes. Full rearrange creates contiguous category zones, plans reliable book moves first, then walks through shelf-category label changes.
- Resumable move plans: tick each physical move when complete to update its recorded location and unlock the next instruction.
- Compact phone/tablet navigation and responsive dialogs.

Layout: left A–E, right F–I, with A and F nearest the headboard. Default capacity is approximately 17 books per shelf. Sample series volume lists are partial examples, not authoritative catalogues.

## Run locally

No build or npm dependencies are required.

```sh
python3 -m http.server 8080 --directory dist
```

Open http://localhost:8080.

## Run with Docker

```sh
docker compose up -d --build
```

Open http://SERVER-IP:3001. Change the host port in compose.yaml if it is already used. The container serves static files only; records remain in the browser, not Docker storage. No access control is provided by this standalone container, so use your normal private network/reverse-proxy access controls.

## Source

- `dist/index.html` — complete editable HTML/CSS/JavaScript source.
- `Dockerfile`, `nginx.conf`, `compose.yaml` — optional static hosting.
- No Sites identity, credentials, production data or hosted access tokens are included.

The UI currently requests fonts from Google Fonts and falls back to local fonts when unavailable.

## Next integration work

Connect authentication and book/series actions to the existing Librarium API; verify compatibility with the installed version; implement reliable create verification, automatic series suggestions, metadata/cover lookup and persistent shared shelf settings. The current local agent is a deterministic, review-first planner operating on browser data; connecting a local model can later extend its reasoning without changing the confirmation workflow.

Upstream projects:
- https://github.com/FireBall1725/librarium-web
- https://github.com/FireBall1725/librarium-api

Upstream Librarium is AGPL-3.0-only. Its backend and client source are not bundled here; preserve applicable licences if upstream code is incorporated.

