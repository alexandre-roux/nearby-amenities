// Utilities for interacting with Overpass API and basic caching

// Simple in-memory cache to reduce Overpass API load
export const CACHE: Map<string, { at: number; data: OverpassPoint[] } | undefined> = new Map(); // key -> { at: number, data: any }
export const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export type Filters = { toilets: boolean; fountains: boolean; glass: boolean };

export interface OverpassPoint {
    id: string;
    lat: number;
    lon: number;
    tags: Record<string, any> & { amenity?: string; name?: string; operator?: string };
    type: 'node' | 'way' | 'relation';
}

export function roundCoord(x: number): number {
    // ~11m precision per 0.0001 deg at equator; good enough to reduce churn but stay accurate
    return Math.round(x * 10000) / 10000;
}

export function roundRadius(r: number): number {
    // snap to 100m buckets
    return Math.round((r || 0) / 100) * 100;
}

export function normalizeFilters(f: Partial<Filters> | undefined | null): Filters {
    const o = f || ({} as Partial<Filters>);
    return {toilets: !!o.toilets, fountains: !!o.fountains, glass: !!o.glass};
}

export function keyFor(lat: number, lon: number, radius: number, filters?: Partial<Filters>): string {
    const f = normalizeFilters(filters);
    return `${roundCoord(lat)},${roundCoord(lon)}|${roundRadius(radius)}|t${+f.toilets}f${+f.fountains}g${+f.glass}`;
}

export function buildOverpassQL(lat: number, lon: number, radiusMeters = 1000, opts: Partial<Filters> = {}): string {
    const {toilets = true, fountains = true, glass = true} = opts || {};
    const parts: string[] = [];
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
out center;
`;
}

export async function fetchOverpass(
    lat: number,
    lon: number,
    radius = 1000,
    signal?: AbortSignal,
    opts?: Partial<Filters>
): Promise<OverpassPoint[]> {
    // Trim the query to avoid leading newlines/spaces that can cause 400 on stricter parsers
    const ql = buildOverpassQL(lat, lon, radius, opts).trim();
    const startedAt = Date.now();
    const timestamp = new Date(startedAt).toISOString();
    console.log(`[Request] ${timestamp} -> Overpass: lat=${lat}, lon=${lon}, radius=${radius}`);

    // Helper sleep that respects AbortSignal
    const sleep = (ms: number) =>
        new Promise<void>((resolve, reject) => {
            const id = setTimeout(resolve, ms);
            if (signal) {
                const onAbort = () => {
                    clearTimeout(id);
                    reject(new DOMException('Aborted', 'AbortError'));
                };
                if (signal.aborted) {
                    clearTimeout(id);
                    return reject(new DOMException('Aborted', 'AbortError'));
                }
                signal.addEventListener('abort', onAbort, {once: true});
            }
        });

    // Parse Retry-After header (seconds or HTTP-date). Returns milliseconds (capped)
    function parseRetryAfter(header: string | null): number | null {
        if (!header) return null;
        const capMs = 15000; // cap to 15s to keep UI responsive
        const s = header.trim();
        const secs = Number(s);
        if (!Number.isNaN(secs) && secs >= 0) {
            return Math.min(capMs, Math.max(0, secs * 1000));
        }
        const dateMs = Date.parse(s);
        if (!Number.isNaN(dateMs)) {
            const delta = dateMs - Date.now();
            return Math.min(capMs, Math.max(0, delta));
        }
        return null;
    }

    const maxAttempts = 3; // 1 initial + up to 2 retries on 504
    let attempt = 0;
    let lastError: unknown;

    // Try primary then fallback mirror on 400/429/5xx except 504 which we retry before switching
    const endpoints = [
        'https://overpass-api.de/api/interpreter',
        'https://overpass.kumi.systems/api/interpreter',
    ];
    let endpointIndex = 0;

    while (attempt < maxAttempts) {
        attempt++;
        let res: Response;
        try {
            res = await fetch(endpoints[endpointIndex], {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
                    Accept: 'application/json',
                },
                body: new URLSearchParams({data: ql}),
                signal,
            });
        } catch (e) {
            // Network/abort errors: do not retry unless specifically a 504 response, which this isn't
            const duration = Date.now() - startedAt;
            console.log(
                `[Request][Failed] ${timestamp} (after ${duration}ms) Overpass fetch error on attempt ${attempt}:`,
                e,
            );
            lastError = e;
            break;
        }

        // Special handling for rate limiting / maintenance with Retry-After
        if (res.status === 429 || res.status === 503) {
            const retryAfter = parseRetryAfter(res.headers.get('Retry-After'));
            if (retryAfter != null) {
                console.log(
                    `[Request][Backoff] ${timestamp} Overpass HTTP ${res.status} with Retry-After=${retryAfter}ms on ${endpoints[endpointIndex]} (attempt ${attempt}).`,
                );
                await sleep(retryAfter);
                // retry same endpoint once without consuming an extra attempt beyond the loop increment
                attempt--; // neutralize this attempt to retry same endpoint
                continue;
            }
            // No Retry-After header => fall through to mirror switch/default handling below
        }

        // Switch to fallback endpoint if 400 encountered (likely parsing quirk) or 429/5xx without usable Retry-After
        if ((res.status === 400 || res.status === 429 || (res.status >= 500 && res.status !== 504)) && endpointIndex < endpoints.length - 1) {
            const text = await res.text().catch(() => '');
            console.log(
                `[Request][Switch] ${timestamp} Overpass HTTP ${res.status} on ${endpoints[endpointIndex]} (attempt ${attempt}). Body: ${text?.slice(0, 200)}`,
            );
            endpointIndex++;
            // brief pause before retrying with new endpoint
            await sleep(200);
            // don't count this as a failed attempt toward max if it's the first endpoint; allow reattempt on new endpoint at same attempt count
            attempt--;
            continue;
        }

        if (!(res.status === 504 && attempt < maxAttempts)) {
            if (!res.ok) {
                const duration = Date.now() - startedAt;
                const text = await res.text().catch(() => '');
                console.log(
                    `[Request][Failed] ${timestamp} (after ${duration}ms) Overpass HTTP ${res.status} on attempt ${attempt}. Body: ${text?.slice(0, 200)}`,
                );
                throw new Error(`Overpass error ${res.status}`);
            }
            const json = (await res.json()) as { elements?: any[] };
            const duration = Date.now() - startedAt;
            console.log(
                `[Request][Success] ${timestamp} (in ${duration}ms) Overpass returned ${Array.isArray(json.elements) ? json.elements.length : 0} elements on attempt ${attempt}`,
            );
            return (json.elements || [])
                .map((el: any) => {
                    const latLng = el.type === 'node' ? {lat: el.lat, lon: el.lon} : el.center;
                    return {
                        id: `${el.type}/${el.id}` as string,
                        lat: latLng?.lat as number,
                        lon: latLng?.lon as number,
                        tags: (el.tags || {}) as OverpassPoint['tags'],
                        type: el.type as OverpassPoint['type'],
                    } as OverpassPoint;
                })
                .filter((p: OverpassPoint) => p.lat && p.lon);
        } else {
            const backoff = 400 * Math.pow(2, attempt - 1); // 400ms, 800ms
            console.log(
                `[Request][Retry] ${timestamp} Overpass HTTP 504 on attempt ${attempt}. Retrying in ${backoff}ms...`,
            );
            await sleep(backoff);
        }
    }

    // If we exit the loop without returning, either we exhausted retries on 504 or had a network error
    throw (lastError as Error) || new Error('Overpass request failed after retries');
}
