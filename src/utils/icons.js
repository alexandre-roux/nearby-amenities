import L from "leaflet";

export function emojiDivIcon(emoji, extraClass = "") {
    return L.divIcon({
        className: "", // avoid default leaflet icon class
        html: `<div class="emoji-marker ${extraClass}" aria-hidden="true">${emoji}</div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 30],  // bottom-center so the "pin" sits on the point
        popupAnchor: [0, -28],
    });
}

export const ICONS = {
    water: emojiDivIcon("🚰", "emoji-water"),
    toilet: emojiDivIcon("🚻", "emoji-toilet"),
    recycle: emojiDivIcon("♻️", "emoji-recycle"),
};

export function pickIcon(tags) {
    if (tags.amenity === "drinking_water") return ICONS.water;
    if (tags.amenity === "toilets") return ICONS.toilet;
    if (tags.amenity === "recycling") return ICONS.recycle;
    return ICONS.recycle; // fallback
}
