# My-Librarium

A responsive frontend for an existing Librarium installation, with a visual map of physical bookcases. The deployed frontend source, including shelf sorting and the local-agent panel, is tracked here alongside its live API adapter.

## Login and real books

`dist/live.js` signs in through `/api/v1/auth/login`, stores the access token in sessionStorage for this browser tab, lists accessible libraries, and loads every page of their books. It unwraps Librarium's `{ "data": ... }` response envelope before reading tokens, libraries, shelves or books. Invalid credentials and API errors remain visible at all screen sizes. Poisoned `undefined` tokens from the previous adapter are cleared automatically.

Collection tabs come from the authenticated account's libraries. Books use database UUIDs, including grid and shelf-dialog links. Title/author edits, creation and physical shelf assignment use the API. Removing a book retires the library copy through Librarium. Test writes against a disposable library before using them with valuable records. The regression suite does not write to a live database.

Shelf paint, labels, sorting plans and local-agent review state still use browser storage. Series catalogue loading and ISBN/cover-provider lookup are not implemented by this adapter. An empty series screen does not imply books are missing. Decorative spines do not represent real book counts. Sign in again when the backend session expires.

## Docker

Keep the existing Librarium backend and database running. This project does not create a replacement database.

```sh
docker compose up -d --build
```

Open `http://SERVER-IP:3002`. Nginx serves the frontend and forwards `/api/` to the existing Librarium upstream. The default is `http://host.docker.internal:3000`, the original Librarium web service which already proxies API requests. Override `LIBRARIUM_UPSTREAM` with a reachable origin when needed, for example `http://192.168.1.187:3000`. Use an origin without a trailing slash or path so `/api/v1/...` is preserved. The API container's HTTP origin also works when both containers share a network.

The official Nginx image substitutes the upstream environment variable into `nginx.conf` at startup. Keep this same-origin API proxy behind your domain. A plain static Python server displays the page but cannot proxy login or catalogue requests.

If an older deployment mounts `my-librarium_site_data` over `/usr/share/nginx/html`, rebuilding the image alone does not update those files. Update the adapter in the volume or bind-mount the fixed `dist/live.js` over `/usr/share/nginx/html/live.js` and recreate only the frontend container. Preserve the existing volume and additional frontend files. A versioned read-only bind mount allows rollback by removing just that mount.

## Verification

```sh
node --check dist/live.js
node --test tests/live.test.cjs
```

Tests cover enveloped login/catalogue responses, bearer authentication, pagination below the requested page size, UUID book links, collection selection, invalid login, malformed responses, poisoned sessions, empty membership and API errors. After deployment, refresh, sign in, select each library, open a book and compare counts with the original app.

## Source and upstream

- `dist/index.html`: responsive frontend and existing local workflows.
- `dist/live.js`: live authentication, catalogue and book-action adapter.
- `Dockerfile`, `nginx.conf`, `compose.yaml`: hosting and API proxy.
- `tests/live.test.cjs`: isolated regression tests; no production credentials or records.

The UI requests Google Fonts and falls back to local fonts. No hosted access tokens or production data are included.

Upstream: https://github.com/FireBall1725/librarium-web and https://github.com/FireBall1725/librarium-api. Upstream Librarium is AGPL-3.0-only; its backend/client source is not bundled here. Preserve applicable licences if upstream code is incorporated.
