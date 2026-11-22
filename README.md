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

## Store feeds

`app/js/stores.js` connects stores to the planner. IKEA and The Home Depot are built in; any other store can be added by name.
A store is filled from a product feed (CSV or JSON) imported in the **Stores** panel. Nothing is fetched from a store's site.

Columns (the usual spellings are accepted, e.g. `title`, `product_type`, `width_cm`, `Depth (in)`, `link`):

| Column | Notes |
| --- | --- |
| `sku`, `name`, `category`, `price` | `category` is matched by keywords to a planner category; `droom_category` may name one directly (`sofa`, `bed`, ...) |
| `width`, `depth`, `height`, `unit` | or one `dimensions` column such as `80 x 36 x 33 in`; without a unit the store default is used (IKEA cm, Home Depot in) |
| `url`, `image`, `color`, `style` | only http(s) links are kept |
| `price_unit`, `coverage_sqft`, `price_per_sqft` | flooring and tile need a price per sq ft, or a box price with its coverage |

A product is placed in the smallest layout size it fits inside. Rows the planner cannot use are counted by reason in the import message.
