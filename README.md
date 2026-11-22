# DRoom

3D home planner that furnishes a floor plan with real store products and returns a shopping list with one total.

- `app/` — the planner: 2D plan editor for a multi-room home, automatic furnishing per room against one home budget, 3D and walk views, shopping list. Plain JS, no build step; open `app/index.html` through any static server.
- `interior-planner/` — browser prototype of the layout engine (room, style, budget → furnished 3D room + list). Test catalog, placeholder models.
- `landing/` — early-access landing page for the ad test (dark sales-page style). Set `CHECKOUT_URL` in the script at the bottom of `landing/index.html`.

Both pages are written as page fragments (no `<html>` wrapper) and load three.js / fonts from CDNs.

## Develop

```bash
npm test
```

```bash
npm start
```

`npm start` builds `dist/` and serves it at http://localhost:8080 (landing at `/`, planner at `/app/`) together with the photo render API. Copy `.env.example` to `.env` and set `OPENAI_API_KEY` to turn photo render on. Needs Node 22.9 or newer; no dependencies.

- `server/index.js` — static files, `POST /api/render`, `GET /api/health`.
- `server/render.js` — request checks, prompt, call to the image model.

State of the project and the plan: `docs/ROADMAP.md`.
