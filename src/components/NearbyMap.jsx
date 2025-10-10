import {useCallback, useEffect, useMemo, useState} from "react";
import {MapContainer, TileLayer} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import "../emoji-marker.css";
import "./NearbyMap.scss";
import useIsMobile from "../hooks/useIsMobile";
import useAmenityMarkers from "../hooks/useAmenityMarkers";
import MapRefresher from "./MapRefresher";
import {filtersConfig} from "../config/filtersConfig";

export default function NearbyMap() {
    const [center, setCenter] = useState([52.520008, 13.404954]); // Berlin fallback
    const [radius] = useState(1200);
    const [points, setPoints] = useState([]);
    const [filters, setFilters] = useState({toilets: true, fountains: true, glass: true});
    const [isLoading, setIsLoading] = useState(true);
    const [isLocating, setIsLocating] = useState(false);
    const [locateMessage, setLocateMessage] = useState("");
    const isMobile = useIsMobile();

    // Consolidated interaction props for MapContainer to reduce repetition
    const interactionProps = useMemo(() => (
        isMobile
            ? {
                zoomControl: false,
                scrollWheelZoom: false,
                touchZoom: true,
                doubleClickZoom: false,
                boxZoom: false,
                keyboard: false,
                tap: false,
            }
            : {}
    ), [isMobile]);

    // Browser geolocation (initial attempt)
    useEffect(() => {
        if (!("geolocation" in navigator)) return;
        navigator.geolocation.getCurrentPosition(
            (pos) => setCenter([pos.coords.latitude, pos.coords.longitude]),
            () => {
            },
            {enableHighAccuracy: true, maximumAge: 10000, timeout: 8000}
        );
    }, []);

    const handleLocateMe = useCallback(() => {
        setIsLocating(true);
        setLocateMessage("");

        const done = (lat, lng, message) => {
            setCenter([lat, lng]);
            setIsLocating(false);
            if (message) setLocateMessage(message);
        };

        const failFallback = (reason) => {
            // Fallback to approximate IP-based geolocation
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 6000);
            fetch("https://ipapi.co/json/", {signal: controller.signal})
                .then((r) => (r.ok ? r.json() : Promise.reject(new Error("ipapi failed"))))
                .then((data) => {
                    if (data && typeof data.latitude === "number" && typeof data.longitude === "number") {
                        done(data.latitude, data.longitude, "Approximate location (IP-based)");
                    } else {
                        throw new Error("IP data missing");
                    }
                })
                .catch(() => {
                    setIsLocating(false);
                    setLocateMessage(reason || "Unable to get your location");
                })
                .finally(() => clearTimeout(timer));
        };

        if ("geolocation" in navigator && navigator.geolocation) {
            const opts = {enableHighAccuracy: true, maximumAge: 5000, timeout: 10000};
            navigator.geolocation.getCurrentPosition(
                (pos) => done(pos.coords.latitude, pos.coords.longitude),
                (err) => {
                    let msg = "Location denied or unavailable";
                    if (err && err.message) {
                        msg = err.message;
                    } else if (typeof location !== "undefined" && location.protocol !== "https:") {
                        msg = "Location requires HTTPS; using approximate location";
                    }
                    failFallback(msg);
                },
                opts
            );
        } else {
            failFallback("Geolocation not available; using approximate location");
        }
    }, []);

    const markers = useAmenityMarkers(points, filters);

    return (
        <div className="nearby-map-root">
            <div className="filters-panel" aria-label="Filters">
                {isMobile ? (
                    <>
                        {filtersConfig.map(({key, label}) => (
                            <button
                                key={key}
                                type="button"
                                onClick={() => setFilters((f) => ({...f, [key]: !f[key]}))}
                                aria-pressed={!!filters[key]}
                                title={`Toggle ${label.replace(/^[^\s]+\s/, '').toLowerCase()}`}
                                className={`filter-btn ${filters[key] ? 'active' : ''}`}
                            >
                                {label}
                            </button>
                        ))}
                    </>
                ) : (
                    <>
                        {filtersConfig.map(({key, label}) => (
                            <label key={key} className="filter-label">
                                <input
                                    type="checkbox"
                                    checked={!!filters[key]}
                                    onChange={(e) => setFilters((f) => ({...f, [key]: e.target.checked}))}
                                />
                                {label}
                            </label>
                        ))}
                    </>
                )}
                <button
                    type="button"
                    onClick={handleLocateMe}
                    disabled={isLocating}
                    title={"Locate me"}
                    className="filter-btn"
                >
                    {isLocating ? "Locating..." : (isMobile ? "📍 Locate" : "📍 Locate me")}
                </button>
                {locateMessage && (
                    <span
                        className="location-status"
                        role="status"
                        aria-live="polite"
                    >
                        {locateMessage}
                    </span>
                )}
                {isLoading && (
                    <span
                        className="loading-status"
                        role="status"
                        aria-live="polite"
                    >
                        Loading...
                    </span>
                )}
            </div>
            <MapContainer
                key={isMobile ? 'mobile' : 'desktop'}
                center={[center[0], center[1]]}
                zoom={15}
                className="map-container"
                {...interactionProps}
            >
                <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <MapRefresher center={center} radius={radius} filters={filters} onData={setPoints}
                              onLoading={setIsLoading}/>
                {markers}
            </MapContainer>
        </div>
    );
}
