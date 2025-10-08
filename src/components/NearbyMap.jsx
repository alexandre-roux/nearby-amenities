import React, {useEffect, useMemo, useRef, useState} from "react";
import {MapContainer, Marker, Popup, TileLayer, useMap, useMapEvent} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "../emoji-marker.css";

/**
 * NearbyMap.jsx
 * - Fetches nearby POIs (toilets, drinking water, glass recycling) from Overpass.
 * - Viewport-aware radius (recomputed on move/zoom).
 * - In-memory response de-dup cache keyed by rounded center+radius+filters.
 * - Recenter map when geolocation resolves (MapContainer doesn't do this by itself).
 * - Handles 429/5xx with Retry-After & mirror fallback. Aborts on unmount.
 * - Emoji-based DivIcons with lightweight popups.
 */

const DEFAULT_CENTER = [52.520008, 13.404954]; // Berlin
const DEFAULT_ZOOM = 14;

const OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.openstreetmap.ru/api/interpreter",
];

export default function NearbyMap(props) {
    const [center, setCenter] = useState(props.initialCenter || DEFAULT_CENTER);
    const [zoom, setZoom] = useState(props.initialZoom || DEFAULT_ZOOM);
    const [radius, setRadius] = useState(1200);
    const [markers, setMarkers] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    // If caller provides filters, use them; otherwise offer simple internal toggles
    const [filters, setFilters] = useState(
        props.filters ?? {toilets: true, fountains: true, glass: true}
    );

    const cacheRef = useRef(new Map());

    // --- Geolocation: set initial center, then recenter via <RecenterOnChange />
    useEffect(() => {
        if (!navigator.geolocation) return;
        const success = (pos) => {
            const {latitude, longitude} = pos.coords;
            setCenter([latitude, longitude]);
        };
        const err = () => {
        }; // silently ignore
        navigator.geolocation.getCurrentPosition(success, err, {
            enableHighAccuracy: true,
            maximumAge: 12_000,
            timeout: 10_000,
        });
    }, []);

    // --- Recenter when `center` changes AFTER initial render
    function RecenterOnChange({center}) {
        const map = useMap();
        useEffect(() => {
            if (center) map.setView(center);
        }, [center, map]);
        return null;
    }

    // --- Emoji Icons
    const emojiIcon = (emoji) =>
        L.divIcon({
            html: `<span>${emoji}</span>`,
            className: "emoji-marker",
            iconSize: [24, 24],
            iconAnchor: [12, 12],
        });

    const icons = useMemo(
        () => ({
            toilet: emojiIcon("🚻"),
            water: emojiIcon("🚰"),
            glass: emojiIcon("♻️"),
            default: emojiIcon("📍"),
        }),
        []
    );

    function pickIcon(tags) {
        if (!tags) return icons.default;
        if (tags.amenity === "toilets") return icons.toilet;
        if (tags.amenity === "drinking_water") return icons.water;
        // recycling tags vary; check any form of glass
        if (
            tags.recycling === "glass" ||
            tags["recycling:glass"] === "yes" ||
            tags["recycling:glass_bottles"] === "yes" ||
            tags["recycling:glass_packaging"] === "yes" ||
            tags["recycling:material"] === "glass"
        )
            return icons.glass;
        return icons.default;
    }

    // --- Overpass query builder
    function buildQuery(lat, lng, r, options) {
        const wantsToilets = options?.toilets;
        const wantsWater = options?.fountains;
        const wantsGlass = options?.glass;

        const parts = [];

        if (wantsToilets) {
            parts.push(
                `nwr["amenity"="toilets"](around:${r},${lat},${lng});`
            );
        }
        if (wantsWater) {
            parts.push(
                `nwr["amenity"="drinking_water"](around:${r},${lat},${lng});`
            );
        }
        if (wantsGlass) {
            // Capture common glass recycling tags
            parts.push(
                [
                    `nwr["recycling"="glass"](around:${r},${lat},${lng});`,
                    `nwr["recycling:glass"="yes"](around:${r},${lat},${lng});`,
                    `nwr["recycling:glass_bottles"="yes"](around:${r},${lat},${lng});`,
                    `nwr["recycling:glass_packaging"="yes"](around:${r},${lat},${lng});`,
                    `nwr["recycling:material"="glass"](around:${r},${lat},${lng});`,
                ].join("")
            );
        }

        // If no filters selected, avoid querying everything; default to nothing
        if (parts.length === 0) return null;

        // Request JSON with center for ways/relations
        return `
      [out:json][timeout:25];
      (
        ${parts.join("\n")}
      );
      out center tags;
    `;
    }

    // --- Overpass fetcher with mirrors, retries, exponential backoff + Retry-After
    async function fetchOverpass(lat, lng, r, signal, options) {
        const query = buildQuery(lat, lng, r, options);
        if (!query) return [];

        let lastError = null;

        for (let endpointIndex = 0; endpointIndex < OVERPASS_ENDPOINTS.length; endpointIndex++) {
            const endpoint = OVERPASS_ENDPOINTS[endpointIndex];

            for (let attempt = 0; attempt < 3; attempt++) {
                try {
                    const res = await fetch(endpoint, {
                        method: "POST",
                        headers: {"Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"},
                        body: new URLSearchParams({data: query}),
                        signal,
                    });

                    if (!res.ok) {
                        // Respect Retry-After if present
                        if (res.status === 429 || res.status >= 500) {
                            const retryAfter = res.headers.get("Retry-After");
                            if (retryAfter) {
                                if (/^\d+$/.test(retryAfter)) {
                                    await sleep(Number(retryAfter) * 1000);
                                } else {
                                    // small default if date-string or unexpected
                                    await sleep(800);
                                }
                            }
                        }

                        // For 4xx/5xx, decide to retry or switch mirror
                        if (res.status === 504 && attempt < 2) {
                            // Gateway timeout: exponential backoff
                            await sleep(400 * Math.pow(2, attempt));
                            continue;
                        }

                        // Switch mirror on classic rate-limit/overload
                        if ((res.status === 429 || res.status >= 500) && attempt === 2) {
                            lastError = new Error(`Overpass error ${res.status} at ${endpoint}`);
                            break; // break attempts, try next mirror
                        }

                        // Other non-OK statuses: try next attempt quickly
                        lastError = new Error(`HTTP ${res.status} from ${endpoint}`);
                        continue;
                    }

                    const json = await res.json();
                    return normalizeElements(json?.elements || []);
                } catch (e) {
                    // Network error or abort
                    if (signal?.aborted) throw new Error("Request aborted");
                    lastError = e;
                    // Backoff before retrying same mirror
                    await sleep(300 * Math.pow(2, attempt));
                }
            }
            // go to next mirror if previous loop didn't return
        }

        throw lastError || new Error("Overpass request failed");
    }

    function normalizeElements(elements) {
        // Map OSM elements into unified points
        // Support node (lat/lon), way/relation with center
        return elements
            .map((el) => {
                let lat = el.lat ?? el.center?.lat;
                let lon = el.lon ?? el.center?.lon;
                if (typeof lat !== "number" || typeof lon !== "number") return null;
                return {
                    id: `${el.type}/${el.id}`,
                    type: el.type,
                    osmid: el.id,
                    lat,
                    lon,
                    tags: el.tags || {},
                };
            })
            .filter(Boolean);
    }

    // --- Cache helpers
    function cacheKey(lat, lng, r, opts) {
        return [
            lat.toFixed(4),
            lng.toFixed(4),
            Math.round(r / 50),
            opts?.toilets ? 1 : 0,
            opts?.fountains ? 1 : 0,
            opts?.glass ? 1 : 0,
        ].join("|");
    }

    async function fetchWithCache(lat, lng, r, signal, options) {
        const key = cacheKey(lat, lng, r, options);
        const cache = cacheRef.current;
        if (cache.has(key)) return cache.get(key);

        const p = (async () => {
            try {
                const data = await fetchOverpass(lat, lng, r, signal, options);
                cache.set(key, data);
                return data;
            } catch (e) {
                cache.delete(key); // let future attempts refetch
                throw e;
            }
        })();

        // Store in-flight promise to dedupe concurrent callers
        cache.set(key, p);
        return p;
    }

    // --- Map-driven refresh
    function MapRefresher({onData, onLoading, options}) {
        const map = useMapEvent("moveend", () => {
            const c = map.getCenter();
            const bounds = map.getBounds();
            const estRadius = Math.ceil(c.distanceTo(bounds.getNorthEast()) / 2);
            if (estRadius !== radius) setRadius(estRadius);
        });

        // initialize radius once the map is ready
        useEffect(() => {
            const c = map.getCenter();
            const bounds = map.getBounds();
            const estRadius = Math.ceil(c.distanceTo(bounds.getNorthEast()) / 2);
            if (estRadius !== radius) setRadius(estRadius);
            // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [map]);

        // (re)fetch when viewport or filters change
        useEffect(() => {
            const ctrl = new AbortController();
            onLoading?.(true);
            setError(null);
            const c = map.getCenter();
            fetchWithCache(c.lat, c.lng, radius, ctrl.signal, options)
                .then(onData)
                .catch((e) => {
                    if (ctrl.signal.aborted) return;
                    setError(e?.message || "Request failed");
                })
                .finally(() => onLoading?.(false));

            return () => ctrl.abort();
            // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [map, radius, options?.toilets, options?.fountains, options?.glass]);

        return null;
    }

    // --- UI bits
    function LocateButton() {
        const map = useMap();
        return (
            <button
                type="button"
                onClick={() => map.setView(center, Math.max(15, map.getZoom()))}
                title="Recenter to your location"
                style={floatingButtonStyle}
            >
                Locate me
            </button>
        );
    }

    // Merge external filters into local (if provided later)
    useEffect(() => {
        if (props.filters) setFilters(props.filters);
    }, [props.filters]);

    const floatingPanelStyle = {
        position: "absolute",
        zIndex: 1000,
        top: 12,
        left: 12,
        padding: 10,
        borderRadius: 10,
        background: "rgba(255,255,255,0.95)",
        boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
        display: "flex",
        gap: 10,
        alignItems: "center",
        fontSize: 14,
    };

    const floatingButtonStyle = {
        position: "absolute",
        zIndex: 1000,
        top: 12,
        right: 12,
        padding: "8px 10px",
        borderRadius: 8,
        background: "white",
        border: "1px solid #ddd",
        cursor: "pointer",
        fontSize: 12,
        boxShadow: "0 2px 6px rgba(0,0,0,0.12)",
    };

    return (
        <div className="nearby-map-wrapper" style={{position: "relative", width: "100%", height: "100%"}}>
            {/* Simple filter toggles if caller didn't provide their own UI */}
            {!props.filters && (
                <div style={floatingPanelStyle} aria-label="Filters">
                    <label style={{display: "flex", gap: 6, alignItems: "center"}}>
                        <input
                            type="checkbox"
                            checked={!!filters.toilets}
                            onChange={(e) => setFilters((f) => ({...f, toilets: e.target.checked}))}
                        />
                        🚻 Toilets
                    </label>
                    <label style={{display: "flex", gap: 6, alignItems: "center"}}>
                        <input
                            type="checkbox"
                            checked={!!filters.fountains}
                            onChange={(e) => setFilters((f) => ({...f, fountains: e.target.checked}))}
                        />
                        🚰 Water
                    </label>
                    <label style={{display: "flex", gap: 6, alignItems: "center"}}>
                        <input
                            type="checkbox"
                            checked={!!filters.glass}
                            onChange={(e) => setFilters((f) => ({...f, glass: e.target.checked}))}
                        />
                        ♻️ Glass
                    </label>
                    {loading && <span style={{opacity: 0.7}}>Loading…</span>}
                </div>
            )}

            <MapContainer
                center={center}
                zoom={zoom}
                style={{width: "100%", height: "100%"}}
                whenCreated={(map) => {
                    // optional: expose map via ref
                }}
            >
                <RecenterOnChange center={center}/>
                <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> contributors'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />

                <MapRefresher
                    onData={(data) => setMarkers(data)}
                    onLoading={setLoading}
                    options={filters}
                />

                {/* Markers */}
                {markers.map((m) => (
                    <Marker
                        key={m.id}
                        position={[m.lat, m.lon]}
                        icon={pickIcon(m.tags)}
                        // assistive name fallback via title
                        title={m.tags.name || readableTitle(m.tags)}
                    >
                        <Popup>
                            <strong>{m.tags.name || readableTitle(m.tags)}</strong>
                            <br/>
                            {renderTagsSummary(m.tags)}
                            <br/>
                            <a
                                href={`https://www.openstreetmap.org/${m.type}/${m.osmid}`}
                                target="_blank"
                                rel="noreferrer"
                            >
                                View on OSM ↗
                            </a>
                        </Popup>
                    </Marker>
                ))}

                <LocateButton/>
            </MapContainer>
        </div>
    );
}

// --- helpers
function renderTagsSummary(tags = {}) {
    const bits = [];
    if (tags.opening_hours) bits.push(`Hours: ${tags.opening_hours}`);
    if (tags.wheelchair) bits.push(`Wheelchair: ${tags.wheelchair}`);
    if (tags.operator) bits.push(`Operator: ${tags.operator}`);
    if (tags.fee === "yes") bits.push("Fee: yes");
    if (tags.access) bits.push(`Access: ${tags.access}`);
    if (!bits.length) return "No extra details";
    return bits.join(" · ");
}

function readableTitle(tags = {}) {
    if (tags.amenity === "toilets") return "Public toilets";
    if (tags.amenity === "drinking_water") return "Drinking water";
    if (
        tags.recycling === "glass" ||
        tags["recycling:glass"] === "yes" ||
        tags["recycling:glass_bottles"] === "yes" ||
        tags["recycling:glass_packaging"] === "yes" ||
        tags["recycling:material"] === "glass"
    )
        return "Glass recycling";
    return "Point of interest";
}

function sleep(ms) {
    return new Promise((res) => setTimeout(res, ms));
}
