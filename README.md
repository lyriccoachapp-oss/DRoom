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

## Collecting Home Depot finishing materials

`tools/collect-homedepot.js` builds a feed of tile, flooring, wallpaper and paint through SerpApi's Home Depot engines
(the provider the CRM already uses). It needs `SERPAPI_KEY`; every search page and every product costs one request, and
answers are cached under `catalog/.cache-homedepot` so reruns are free for products already seen.

```bash
SERPAPI_KEY=... node tools/collect-homedepot.js --kinds tile,floor --pages 2 --images catalog/img
```

`tools/specs.js` turns a title and a specification table into piece size, box coverage, colour, finish and use.
The result, `catalog/homedepot.json`, is imported in the planner under Stores, The Home Depot. Floor tile and flooring are
used now (piece size, price per sq ft, boxes to buy, tile drawn at its real size); wall tile and wallpaper are collected
but wait until walls take finishes. `catalog/` is not committed.

## Collecting IKEA furniture

IKEA has no product API, so `tools/collect-ikea.js` reads its public product pages: addresses from the product sitemaps,
facts from the structured data each page publishes (article number, name, price, width, depth, height, photos, and a link
to a 3D model where one exists). It follows robots.txt (no search pages), reads one page every 1.5 s, caches under
`catalog/.cache-ikea`, and stops on a 403 or 429.

```bash
node tools/collect-ikea.js --kinds sofa,bed,wardrobe --limit 40 --images catalog/img
```

Import `catalog/ikea.json` in the planner under Stores, IKEA. Products larger than the sizes the planner lays out are
left out on import until the layout takes real product dimensions.

### Running the Home Depot collector on GitHub

The `collect catalog` workflow (Actions tab, run by hand) runs the collector with the repository secret `SERPAPI_KEY`
and prints the feed into the run log as well as attaching it. Canada (`ca`) gives prices in CAD with sizes and box
coverage read from titles; the US site (`us`) adds full specifications. `tools/merge-homedepot.js` fills Canadian rows
with the specifications of the same model on the US site. In the planner, The Home Depot takes the Canadian feed and
The Home Depot US (off by default, prices in USD) the US feed.

## Code check

`app/js/codecheck.js` checks the plan against the National Building Code of Canada 2020, Part 9, as adopted in Nova
Scotia by N.S. Reg. 198/2024: ceiling height (9.5.3.1.), hallway width (9.5.4.1.), doorway widths (Table 9.5.5.1.,
9.5.5.3.), bedroom egress (9.9.10.1.), required plumbing fixtures (9.31.4.1. as amended in Nova Scotia), smoke alarm
placement (9.10.19.) and switched lighting (9.34.2.2.). Results appear on the Build tab with the article each comes
from; smoke alarms are drawn on the Build drawing and counted in the takeoff. Values were read from the NRC's
published code text and the Nova Scotia regulation. It is a design aid, not a permit review.

## Project files and the PDF report

**Save** writes the home to a `droom-project.json` file (rooms, style, budget, units, construction settings and the
store products the plan uses); **Open** reads it back, on any computer, even without the store feeds. **PDF report**
makes a letter-size PDF: summary, floor plan, a 3D view, the estimate by room with quantities, boxes, store and a
link to each product, and the code check. `app/js/report.js`; jsPDF 2.5.1 is loaded from cdnjs on first use.

## Floors and stairs

Each room has a `floor` (0 is the ground floor). The Rooms panel has floor tabs and **+ Floor**; the plan, the 3D view
and the Build drawing show one floor at a time (the floor below is drawn faintly, and stairwells from below show as
open), while the shopping list, the estimate and the takeoff cover the whole home. A **Stairs** room holds a straight
flight to the floor above: `stairOf` in `layout.js` picks risers of at most 200 mm and treads of 255-355 mm for the
storey height (wall height plus 0.3 m), with a bottom landing at the door end. The code check adds stair width,
steps, flight height, headroom, the landing at the top, doorways to stairs (810 mm), doors that open to nowhere on an
upper floor, and stairs to every upper floor. The takeoff puts the foundation and slab under the ground floor only and
adds floor framing and stairs.
