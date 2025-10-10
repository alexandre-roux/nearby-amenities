export type FilterKey = 'toilets' | 'fountains' | 'glass';

export const filtersConfig: { key: FilterKey; label: string }[] = [
    {key: 'toilets', label: '🚻 Toilets'},
    {key: 'fountains', label: '🚰 Water'},
    {key: 'glass', label: '♻️ Glass'},
];
