import {useMemo} from 'react';
import {Marker, Popup} from 'react-leaflet';
import {pickIcon} from '../utils/icons';
import type {Filters, OverpassPoint} from '../utils/overpass';

export default function useAmenityMarkers(points: OverpassPoint[], filters: Filters) {
    return useMemo(
        () =>
            points
                .filter((p) => {
                    const a = p.tags.amenity;
                    if (a === 'toilets') return !!filters.toilets;
                    if (a === 'drinking_water') return !!filters.fountains;
                    if (a === 'recycling') return !!filters.glass;
                    return false;
                })
                .map((p) => (
                    <Marker key={p.id} position={[p.lat, p.lon]} icon={pickIcon(p.tags)}
                            title={p.tags.name || p.tags.operator || 'Point'}>
                        <Popup>
                            <b>{p.tags.name || p.tags.operator || 'Point'}</b>
                            <br/>
                            {p.tags.amenity === 'toilets' && <span>🚻 Toilets</span>}
                            {p.tags.amenity === 'drinking_water' && <span>🚰 Drinking water</span>}
                            {p.tags.amenity === 'recycling' && <span>♻️ Recycling (glass accepted)</span>}
                        </Popup>
                    </Marker>
                )),
        [points, filters],
    );
}
