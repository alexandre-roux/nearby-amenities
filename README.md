# Nearby Amenities Map

## Overview

I couldn't find a basic straight to the point app to show me where is the next toilet or the next fountain, so I decided
to build my own using OpensStreetMap and the Overpass API.
The app centers on your location (with permission) and queries the Overpass API, displaying emoji-styled markers for a
quick visual scan.

- Toilets: 🚻
- Drinking water: 🚰
- Glass recycling: ♻️

## Live Demo

Try out the application here: [Nearby Amenities Live Demo](https://nearby-amenities.netlify.app/)

## Quick start

Prerequisites:

- Node.js 18+ (or 20+ recommended)
- Yarn or npm (instructions use Yarn; npm equivalents provided)

Install dependencies:

- Yarn: `yarn`
- npm: `npm install`

Start the dev server:

- Yarn: `yarn dev`
- npm: `npm run dev`

Then open the printed local URL (usually http://localhost:5173).

Build for production:

- Yarn: `yarn build`
- npm: `npm run build`

Preview the production build locally:

- Yarn: `yarn preview`
- npm: `npm run preview`

## How it works

- UI: React 19 with Vite for dev/build.
- Map: Leaflet via react-leaflet, using OpenStreetMap raster tiles.
- Data: Overpass API queries for amenities within a configurable radius around the current map center. The code
  currently requests:
    - amenity=toilets
    - amenity=drinking_water
    - amenity=recycling with recycling:glass=yes or recycling:glass_bottles=yes
- Markers: Custom emoji-based Leaflet DivIcons (see `src/emoji-marker.css`).
- Location: Browser Geolocation API is used on load to center near the user. If permission is denied or unavailable, the
  map falls back to Berlin.
- Fetch behavior: Initial fetch for the center; subsequent refetches when the map moves (lightly debounced).

## Project structure (key files)

- `index.html` — sets up the root and includes Leaflet CSS.
- `src/main.tsx` — app entry point; mounts React to `#root`.
- `src/App.tsx` — renders the `NearbyMap` component and app shell.
- `src/components/NearbyMap.tsx` — map UI, filters, geolocation, and markers.
- `src/components/NearbyMap.scss` — styles for the NearbyMap component.
- `src/components/MapRefresher.tsx` — listens to map move/zoom and fetches data with caching.
- `src/hooks/useIsMobile.ts` — detects mobile to adjust map interactions and UI.
- `src/hooks/useAmenityMarkers.tsx` — builds Marker and Popup elements from Overpass data.
- `src/utils/overpass.ts` — Overpass QL builder, fetch with retries/backoff, and in-memory cache.
- `src/utils/icons.ts` — emoji-based Leaflet DivIcons and `pickIcon` helper.
- `src/config/filtersConfig.ts` — filter keys and labels used by the UI.
- `src/emoji-marker.css` — styles for the emoji marker badges.
- `src/index.css` — global base styles and layout.
- `public/` — static assets served as-is.
- `vite.config.js` — Vite configuration.
- `eslint.config.js` — ESLint configuration.
- `tsconfig.json`, `vite-env.d.ts` — TypeScript configuration.
- `package.json` — scripts and dependencies.

## Configuration

- Radius: Defaults to 1200 meters in `NearbyMap.tsx`. Change the `radius` state if you want a different search area.
- Initial center: Defaults to Berlin `[52.520008, 13.404954]` until geolocation resolves.
- Overpass endpoint: Uses `https://overpass-api.de/api/interpreter` by default. If you need to point to a different
  instance, change the `fetchOverpass` URL.

## Permissions and privacy

- The app requests access to your location to center the map near you. Declining the permission still loads the map
  using the default center.
- Queries are sent to the Overpass API; map tiles are fetched from OpenStreetMap tile servers. Your IP and standard
  request metadata go to those services. No personal data is stored by this frontend beyond what your browser retains.

## Attribution and usage terms

- Map data © OpenStreetMap contributors. See https://www.openstreetmap.org/copyright
- Tiles: https://tile.openstreetmap.org usage policies apply.
- Overpass API: Please be mindful of rate limits and fair-use guidelines. Consider self-hosting if you expect higher
  traffic.
- This app includes proper attribution in the map’s bottom-right control (handled by Leaflet/TileLayer attribution).

## Accessibility notes

- Emoji markers include `aria-hidden="true"` inside the visual element but the Marker has a `title` and the Popup shows
  a text label derived from name/operator, improving assistive context. Additional improvements (keyboard navigation,
  larger hit areas) can be added if needed.

## Troubleshooting

- Blank map or gray tiles: Ensure network access to tile servers and that Leaflet CSS is loaded (index.html has a
  `<link>` to Leaflet 1.9.4 CSS).
- Location not found: Check browser permissions; try HTTPS and a secure context. Some desktop setups block geolocation
  on `http://localhost` unless configured.
- Overpass errors or no results: The public Overpass instance may be throttling or timing out. Try again later, reduce
  radius, or point to a different Overpass endpoint.
- Build fails: Ensure Node 18+ and remove lockfile mismatches (e.g., delete `node_modules` and reinstall).

## Scripts

- `yarn dev` — start Vite dev server
- `yarn build` — build production assets
- `yarn preview` — preview the production build
- `yarn lint` — run ESLint
- `yarn test` — run tests once with Vitest
- `yarn test:watch` — run tests in watch mode
- `yarn coverage` — run tests with coverage report

npm equivalents are available via `npm run <script>`.

## Testing

This project uses Vitest and Testing Library for unit tests.

- Install deps: `yarn` (or `npm install`)
- Run once: `yarn test` (or `npm run test`)
- Watch mode: `yarn test:watch`
- Coverage: `yarn coverage`

The test environment is jsdom and is configured via vite.config.js. A small setup file at `src/test/setup.ts` enables
jest-dom matchers.

## Contributing

Issues and small PRs are welcome. If you plan larger changes (e.g., new amenity types, clustering, offline tiles),
please open an issue first to discuss scope and data/usage implications.

## License

This project is licensed under the MIT License. See the LICENSE file for details.
