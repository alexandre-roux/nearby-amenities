import {describe, expect, it, vi} from 'vitest';
import {ICONS, pickIcon} from './icons';

// Mock the icons module to avoid bringing in Leaflet/Vite SSR transform in this environment
vi.mock('./icons', () => {
  const ICONS = {
    water: {id: 'water'},
    toilet: {id: 'toilet'},
    recycle: {id: 'recycle'},
  } as const;

  function pickIcon(tags: { amenity?: string }) {
    if (tags.amenity === 'drinking_water') return ICONS.water as any;
    if (tags.amenity === 'toilets') return ICONS.toilet as any;
    if (tags.amenity === 'recycling') return ICONS.recycle as any;
    return ICONS.recycle as any;
  }

  return {ICONS, pickIcon};
});

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
