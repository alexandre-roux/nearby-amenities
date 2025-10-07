import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {MapContainer, Marker, Popup, TileLayer, useMap} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "../emoji-marker.css";

// ---------- Emoji DivIcons ----------
function emojiDivIcon(emoji, extraClass = "") {
    return L.divIcon({
        className: "", // avoid default leaflet icon class
        html: `<div class="emoji-marker ${extraClass}" aria-hidden="true">${emoji}</div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 30],  // bottom-center so the "pin" sits on the point
        popupAnchor: [0, -28],
    });
}

const ICONS = {
    water: emojiDivIcon("🚰", "emoji-water"),
    toilet: emojiDivIcon("🚻", "emoji-toilet"),
    recycle: emojiDivIcon("♻️", "emoji-recycle"),
};

// ---------- Overpass helpers ----------
function buildOverpassQL(lat, lon, radiusMeters = 1000, opts = {}) {
    const {toilets = true, fountains = true, glass = true} = opts || {};
    const parts = [];
    if (toilets) parts.push(`nwr["amenity"="toilets"](around:${radiusMeters},${lat},${lon});`);
    if (fountains) parts.push(`nwr["amenity"="drinking_water"](around:${radiusMeters},${lat},${lon});`);
    if (glass) {
        parts.push(`nwr["amenity"="recycling"]["recycling:glass"="yes"](around:${radiusMeters},${lat},${lon});`);
        parts.push(`nwr["amenity"="recycling"]["recycling:glass_bottles"="yes"](around:${radiusMeters},${lat},${lon});`);
    }
    // If nothing selected, return an empty harmless query that yields no results
    if (parts.length === 0) {
        return `
[out:json][timeout:25];
node(0,0,0,0);
out;
`;
    }
    return `
[out:json][timeout:25];
(
  ${parts.join("\n  ")}
);
out center 80;
`;
}

async function fetchOverpass(lat, lon, radius = 1000, signal, opts) {
    const ql = buildOverpassQL(lat, lon, radius, opts);
    const startedAt = Date.now();
    const timestamp = new Date(startedAt).toISOString();
    console.log(`[Request] ${timestamp} -> Overpass: lat=${lat}, lon=${lon}, radius=${radius}`);

    // Helper sleep that respects AbortSignal
    const sleep = (ms) => new Promise((resolve, reject) => {
        const id = setTimeout(resolve, ms);
        if (signal) {
            const onAbort = () => {
                clearTimeout(id);
                reject(new DOMException("Aborted", "AbortError"));
            };
            if (signal.aborted) {
                clearTimeout(id);
                return reject(new DOMException("Aborted", "AbortError"));
            }
            signal.addEventListener("abort", onAbort, {once: true});
        }
    });

    const maxAttempts = 3; // 1 initial + up to 2 retries on 504
    let attempt = 0;
    let lastError;

    while (attempt < maxAttempts) {
        attempt++;
        let res;
        try {
            res = await fetch("https://overpass-api.de/api/interpreter", {
                method: "POST",
                headers: {"Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"},
                body: new URLSearchParams({data: ql}),
                signal,
            });
        } catch (e) {
            // Network/abort errors: do not retry unless specifically a 504 response, which this isn't
            const duration = Date.now() - startedAt;
            console.log(`[Request][Failed] ${timestamp} (after ${duration}ms) Overpass fetch error on attempt ${attempt}:`, e);
            lastError = e;
            break;
        }

        if (!(res.status === 504 && attempt < maxAttempts)) {
            if (!res.ok) {
                const duration = Date.now() - startedAt;
                console.log(`[Request][Failed] ${timestamp} (after ${duration}ms) Overpass HTTP ${res.status} on attempt ${attempt}`);
                throw new Error(`Overpass error ${res.status}`);
            }
            const json = await res.json();
            const duration = Date.now() - startedAt;
            console.log(`[Request][Success] ${timestamp} (in ${duration}ms) Overpass returned ${Array.isArray(json.elements) ? json.elements.length : 0} elements on attempt ${attempt}`);
            return (json.elements || [])
                .map((el) => {
                    const latLng = el.type === "node" ? {lat: el.lat, lon: el.lon} : el.center;
                    return {
                        id: `${el.type}/${el.id}`,
                        lat: latLng?.lat,
                        lon: latLng?.lon,
                        tags: el.tags || {},
                        type: el.type,
                    };
                })
                .filter((p) => p.lat && p.lon);
        } else {
            const backoff = 400 * Math.pow(2, attempt - 1); // 400ms, 800ms
            console.log(`[Request][Retry] ${timestamp} Overpass HTTP 504 on attempt ${attempt}. Retrying in ${backoff}ms...`);
            await sleep(backoff);
        }
    }

    // If we exit the loop without returning, either we exhausted retries on 504 or had a network error
    throw lastError || new Error("Overpass request failed after retries");
}

function pickIcon(tags) {
    if (tags.amenity === "drinking_water") return ICONS.water;
    if (tags.amenity === "toilets") return ICONS.toilet;
    if (
        tags.amenity === "recycling" &&
        (tags["recycling:glass"] === "yes" || tags["recycling:glass_bottles"] === "yes")
    )
        return ICONS.recycle;
    return ICONS.recycle; // fallback
}

function MapRefresher({center, radius, onData, filters}) {
    const map = useMap();
    const abortRef = useRef(null);

    // Helper to compute a suitable radius based on current map viewport
    const computeViewportRadius = useCallback(() => {
        const base = typeof radius === "number" ? radius : 0;
        if (!map || typeof map.getBounds !== "function" || typeof map.getCenter !== "function") {
            return base || 1000;
        }
        const bounds = map.getBounds();
        const c = map.getCenter();
        if (!bounds || !c || typeof bounds.getNorthEast !== "function" || typeof c.distanceTo !== "function") {
            return base || 1000;
        }
        const ne = bounds.getNorthEast();
        const dynamic = c.distanceTo(ne);
        // Add a small buffer (10%) to avoid frequent re-fetches during tiny zoom changes
        return Math.max(base, Math.ceil(dynamic * 1.1));
    }, [map, radius]);

    const doFetch = useCallback((lat, lng, r) => {
        // Cancel any in-flight request
        if (abortRef.current) abortRef.current.abort();
        const ctrl = new AbortController();
        abortRef.current = ctrl;
        return fetchOverpass(lat, lng, r, ctrl.signal, filters).then(onData).catch(() => {
        });
    }, [onData, filters]);

    useEffect(() => {
        if (!center) return;
        const r = computeViewportRadius();
        doFetch(center[0], center[1], r);
        return () => {
            if (abortRef.current) abortRef.current.abort();
        };
    }, [center, radius, onData, computeViewportRadius, doFetch]);

    // Refetch when the map moves or zooms (light debounce) with updated radius
    useEffect(() => {
        let t;

        function trigger() {
            clearTimeout(t);
            t = setTimeout(() => {
                const c = map.getCenter();
                const r = computeViewportRadius();
                doFetch(c.lat, c.lng, r);
            }, 300);
        }

        map.on("moveend", trigger);
        map.on("zoomend", trigger);
        return () => {
            map.off("moveend", trigger);
            map.off("zoomend", trigger);
            clearTimeout(t);
        };
    }, [map, radius, onData, computeViewportRadius, doFetch]);

    return null;
}

export default function NearbyMap() {
    const [center, setCenter] = useState([52.520008, 13.404954]); // Berlin fallback
    const [radius] = useState(1200);
    const [points, setPoints] = useState([]);
    const [filters, setFilters] = useState({toilets: true, fountains: true, glass: true});

    // Browser geolocation
    useEffect(() => {
        if (!("geolocation" in navigator)) return;
        navigator.geolocation.getCurrentPosition(
            (pos) => setCenter([pos.coords.latitude, pos.coords.longitude]),
            () => {
            },
            {enableHighAccuracy: true, maximumAge: 10000, timeout: 8000}
        );
    }, []);

    const markers = useMemo(
        () =>
            points.map((p) => (
                <Marker key={p.id} position={[p.lat, p.lon]} icon={pickIcon(p.tags)}
                        title={p.tags.name || p.tags.operator || "Point"}>
                    <Popup>
                        <b>{p.tags.name || p.tags.operator || "Point"}</b>
                        <br/>
                        {p.tags.amenity === "toilets" && <>🚻 Toilets</>}
                        {p.tags.amenity === "drinking_water" && <>🚰 Drinking water</>}
                        {p.tags.amenity === "recycling" && <>♻️ Recycling (glass accepted)</>}
                    </Popup>
                </Marker>
            )),
        [points]
    );

    const toggle = (key) => setFilters((f) => ({...f, [key]: !f[key]}));

    const btnStyle = (active) => ({
        padding: "6px 10px",
        marginRight: 8,
        borderRadius: 6,
        border: "1px solid #ccc",
        background: active ? "#1e90ff" : "#fff",
        color: active ? "#fff" : "#333",
        cursor: "pointer"
    });

    return (
        <div style={{height: "100vh", width: "100%", position: "relative"}}>
            <div style={{
                position: "absolute",
                top: 10,
                left: 10,
                zIndex: 1000,
                background: "rgba(255,255,255,0.9)",
                padding: 8,
                borderRadius: 8,
                boxShadow: "0 1px 4px rgba(0,0,0,0.1)"
            }}>
                <button title="Toggle toilets" onClick={() => toggle("toilets")} style={btnStyle(filters.toilets)}>🚻
                    Toilets
                </button>
                <button title="Toggle drinking fountains" onClick={() => toggle("fountains")}
                        style={btnStyle(filters.fountains)}>🚰 Fountains
                </button>
                <button title="Toggle glass recycling" onClick={() => toggle("glass")}
                        style={btnStyle(filters.glass)}>♻️ Glass
                </button>
            </div>
            <MapContainer center={[center[0], center[1]]} zoom={15} style={{height: "100%", width: "100%"}}
                          scrollWheelZoom>
                <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <MapRefresher center={center} radius={radius} onData={setPoints} filters={filters}/>
                {markers}
            </MapContainer>
        </div>
    );
}
