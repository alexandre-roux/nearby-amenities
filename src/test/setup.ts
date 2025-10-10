// Vitest setup for DOM testing
import '@testing-library/jest-dom/vitest';

// Mock Leaflet in tests to avoid requiring the real library/runtime
// This keeps unit tests lightweight and prevents Vite SSR helper issues
import {vi} from 'vitest';

vi.mock('leaflet', () => {
    const divIcon = (options: any) => ({__type: 'DivIcon', options});

    class DivIcon {
    }

    return {
        __esModule: true,
        default: {divIcon},
        DivIcon,
        divIcon,
        // minimal shims for types Leaflet might export
        point: (x: number, y: number) => ({x, y}),
    };
});

// Minimal mock for @testing-library/react to avoid pulling in @testing-library/dom
vi.mock('@testing-library/react', () => {
    // basic render using react-dom/client
    const ReactDOM = require('react-dom/client');
    const {act} = require('react-dom/test-utils');
    const render = (ui: any) => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = ReactDOM.createRoot(container);
        act(() => {
            root.render(ui);
        });
        return {
            container,
            unmount: () => {
                act(() => root.unmount());
                container.remove();
            },
        };
    };
    const screen = {
        getByTestId: (id: string) => {
            const el = document.querySelector(`[data-testid="${id}"]`);
            if (!el) throw new Error(`Unable to find an element by: [data-testid="${id}"]`);
            return el as HTMLElement;
        },
    };
    return {render, screen};
});

