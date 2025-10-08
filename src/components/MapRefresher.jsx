import {useCallback, useEffect, useRef} from "react";
import {useMap} from "react-leaflet";
import {CACHE, CACHE_TTL_MS, fetchOverpass, keyFor, normalizeFilters} from "../utils/overpass";

export default function MapRefresher({center, radius, filters, onData, onLoading}) {
    const map = useMap();
    const abortRef = useRef(null);
    const pendingRef = useRef(0); // track concurrent in-flight requests to avoid loading flicker

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
        const k = keyFor(lat, lng, r, filters);
        const now = Date.now();
        const cached = CACHE.get(k);
        if (cached && (now - cached.at) < CACHE_TTL_MS) {
            console.log(`[Cache][Hit] ${k}`);
            onData(cached.data);
            // For cache hits, only hide loading if there are no pending network requests
            if (typeof onLoading === "function" && pendingRef.current === 0) onLoading(false);
            return Promise.resolve();
        }
        console.log(`[Cache][Miss] ${k}`);
        // Cancel any in-flight request
        if (abortRef.current) abortRef.current.abort();
        const ctrl = new AbortController();
        abortRef.current = ctrl;
        // mark this request as pending and update loading state accordingly
        pendingRef.current += 1;
        if (typeof onLoading === "function") onLoading(true);
        return fetchOverpass(lat, lng, r, ctrl.signal, normalizeFilters(filters))
            .then((data) => {
                CACHE.set(k, {at: Date.now(), data});
                onData(data);
            })
            .catch(() => {
                // ignore (likely aborted); keep current data
            })
            .finally(() => {
                // decrement pending counter and update loading state based on remaining requests
                pendingRef.current = Math.max(0, pendingRef.current - 1);
                if (typeof onLoading === "function") onLoading(pendingRef.current > 0);
            });
    }, [onData, filters, onLoading]);

    useEffect(() => {
        if (!center) return;
        // Recenter the map when the external center changes (e.g., geolocation resolves)
        try {
            if (map && typeof map.setView === "function") {
                const z = typeof map.getZoom === "function" ? map.getZoom() : 15;
                map.setView([center[0], center[1]], z, {animate: true});
            }
        } catch {
            // no-op: safe guard if map isn't ready
        }
        const r = computeViewportRadius();
        doFetch(center[0], center[1], r);
        return () => {
            if (abortRef.current) abortRef.current.abort();
        };
    }, [center, radius, onData, computeViewportRadius, doFetch, map]);

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
