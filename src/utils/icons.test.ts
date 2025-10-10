import {describe, expect, it} from 'vitest';
import {ICONS, pickIcon} from './icons';

describe('icons.pickIcon', () => {
    it('returns water icon for drinking_water amenity', () => {
        expect(pickIcon({amenity: 'drinking_water'})).toBe(ICONS.water);
    });

    it('returns toilet icon for toilets amenity', () => {
        expect(pickIcon({amenity: 'toilets'})).toBe(ICONS.toilet);
    });

    it('returns recycle icon for recycling amenity', () => {
        expect(pickIcon({amenity: 'recycling'})).toBe(ICONS.recycle);
    });

    it('falls back to recycle icon for unknown amenity', () => {
        // @ts-expect-error test unknown value
        expect(pickIcon({amenity: 'unknown'})).toBe(ICONS.recycle);
    });
});
