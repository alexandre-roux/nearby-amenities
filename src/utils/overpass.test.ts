import {describe, expect, it} from 'vitest';
import {buildOverpassQL, keyFor, normalizeFilters, roundCoord, roundRadius} from './overpass';

describe('overpass utilities', () => {
    it('normalizes filters with defaults to false', () => {
        expect(normalizeFilters(undefined)).toEqual({toilets: false, fountains: false, glass: false});
        expect(normalizeFilters({toilets: true})).toEqual({toilets: true, fountains: false, glass: false});
    });

    it('rounds coordinates to 4 decimal places', () => {
        expect(roundCoord(52.520008)).toBeCloseTo(52.52, 4);
        expect(roundCoord(13.404954)).toBeCloseTo(13.405, 4);
    });

    it('rounds radius to nearest 100m bucket', () => {
        expect(roundRadius(0)).toBe(0);
        expect(roundRadius(149)).toBe(100);
        expect(roundRadius(150)).toBe(200);
        expect(roundRadius(1200)).toBe(1200);
    });

    it('builds cache key including rounded coords, radius and filters', () => {
        const k = keyFor(52.520008, 13.404954, 1234, {toilets: true, fountains: false, glass: true});
        // 52.52,13.405|1200|t1f0g1
        expect(k).toMatch(/^52\.52,13\.405\|1200\|t1f0g1$/);
    });

    it('builds empty harmless query when no filters are enabled', () => {
        const q = buildOverpassQL(52.52, 13.405, 1000, {toilets: false, fountains: false, glass: false});
        expect(q).toContain('node(0,0,0,0);');
    });

    it('includes expected queries when filters are enabled', () => {
        const q = buildOverpassQL(52.52, 13.405, 800, {toilets: true, fountains: true, glass: true});
        expect(q).toContain('nwr["amenity"="toilets"](around:800,52.52,13.405);');
        expect(q).toContain('nwr["amenity"="drinking_water"](around:800,52.52,13.405);');
        expect(q).toContain('nwr["amenity"="recycling"]["recycling:glass"="yes"](around:800,52.52,13.405);');
        expect(q).toContain('nwr["amenity"="recycling"]["recycling:glass_bottles"="yes"](around:800,52.52,13.405);');
    });
});
