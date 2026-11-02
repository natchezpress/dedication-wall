# web/ — the dedication maker and the wall

The maker is a static site built with Vite; the wall is a Cloudflare Worker in front of it, with D1 for the records and R2 for the photos. Backgrounds are read from `../assets/backgrounds` (served at `/backgrounds/`).

## Run locally
```
cd web
npm install
npm run dev
```

## Cloudflare settings (Workers & Pages → Create → Connect GitHub → this repo)
| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Root directory | `web` |
| Build command | `npm run build` (Vite, then `scripts/migrate.mjs` applies D1 migrations) |
| Deploy command | `npx wrangler deploy` on `main`; `npx wrangler preview` on every other branch |

`wrangler.jsonc` points the Worker at `dist/` as static assets and binds D1 (`DB`) and R2 (`PHOTOS`). Branch previews get their own database and bucket through the `previews` block; `POSTING_ENABLED` is false in production until launch and true on previews.

## Secrets (typed in the dashboard, never in the repo)
`SESSION_SECRET`, `ADMIN_TOKEN`, `ANTHROPIC_API_KEY` (screening), `RESEND_API_KEY` and `MAIL_FROM` (email), `MAILERLITE_API_KEY` and `MAILERLITE_GROUP_ID` (newsletter).

## Domain
Live at **https://dedication.jetsonsjourney.com** (Worker → Domains → Add Domain). A Worker custom domain needs the whole zone on Cloudflare, so jetsonsjourney.com's nameservers were moved from Wix to Cloudflare on 2026-10-28 (martin/maya.ns.cloudflare.com); its old records (GitHub Pages bounce to brockalston.com/jetsonsjourney, www CNAME, MX, SPF) were copied over as DNS-only. brockalston.com stays on Wix untouched. Test URL: https://your-dogs-journey.brock-535.workers.dev.

## Layout
- `index.html` — landing (Jetson's entry No. 1) and the four-step maker
- `src/compose.js` — the canvas composition at 1648×2944 and the three cuts (9:16, 4:5, 1:1)
- `src/windows.js` — date windows (fixed ranges, Easter, Mother's/Father's Day weeks)
- `src/lines.js` — the curated line bank behind "Need help finding the words?"
- `src/main.js` — picker, photo pan/zoom, share and save, request-a-background
- `src/worker.js` — the wall: sign-in links, posting, screening, dog pages, hearts, invites, removal, admin, the Monday digest
- `src/lib.js` — time, ids, sessions, mail (Resend), screening (Anthropic)
- `src/pages.js` — server-rendered wall, dog and simple pages
- `migrations/` — the D1 schema
- `scripts/migrate.mjs` — applies migrations to the production or preview database per branch
