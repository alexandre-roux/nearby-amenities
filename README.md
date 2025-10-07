# Nearby Amenities Map (React + Leaflet)

Find nearby public toilets, drinking water, and glass recycling points on an interactive map. The app centers on your
location (with permission) and queries OpenStreetMap data via the Overpass API, displaying emoji-styled markers for a
quick visual scan.

- Toilets: 🚻
- Drinking water: 🚰
- Glass recycling: ♻️

Current local date/time: 2025-10-07 14:08

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

- `index.html` — includes Leaflet CSS and bootstraps the React app.
- `src/App.jsx` — renders the map component.
- `src/components/NearbyMap.js` — main logic: icons, Overpass query, fetch, markers, and map.
- `src/emoji-marker.css` — styles for the emoji markers.
- `package.json` — scripts and dependencies.

## Configuration

- Radius: Defaults to 1200 meters in `NearbyMap.js`. Change the `radius` state if you want a different search area.
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

npm equivalents are available via `npm run <script>`.

## Contributing

Issues and small PRs are welcome. If you plan larger changes (e.g., new amenity types, clustering, offline tiles),
please open an issue first to discuss scope and data/usage implications.

## License

No explicit license file is present. Until a license is added, treat this repository as All Rights Reserved by the
author. If you intend to reuse code, please add a license file (e.g., MIT) and attribution as appropriate.
