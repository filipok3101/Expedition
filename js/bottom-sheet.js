/**
 * BottomSheet — reusable mobile bottom-sheet with snap states.
 *
 * Usage:
 *   const sheet = new BottomSheet({
 *     element: document.getElementById('my-sheet'),
 *     states: ['peek', 'half', 'full'],
 *     initial: 'peek'
 *   });
 *   sheet.snapTo('half');
 *   sheet.on('snap', state => console.log('now in', state));
 *
 * Element must contain `.bsheet-handle-area` for drag/tap, plus
 * `.bsheet-content` for scrollable body. CSS sets heights via
 * --bsheet-peek / --bsheet-half / --bsheet-full custom properties.
 */

const STATE_VARS = { peek: '--bsheet-peek', half: '--bsheet-half', full: '--bsheet-full' };
// Funkcja (nie stała) — window.innerHeight zmienia się po rotacji ekranu
const fallbackHeight = state =>
    state === 'peek' ? 84
    : state === 'half' ? window.innerHeight * 0.52
    : window.innerHeight * 0.92;

export class BottomSheet {
    constructor({ element, states = ['peek', 'half', 'full'], initial = 'peek' }) {
        this.el = element;
        this.states = states;
        this.state = initial;
        this.handleArea = element.querySelector('.bsheet-handle-area');
        if (!this.handleArea) throw new Error('BottomSheet: .bsheet-handle-area required');
        this._listeners = {};
        this._dragStartY = null;
        this._dragStartHeight = null;
        this._tapTimer = null;
        this._setupListeners();
        this.snapTo(initial, /*animate*/ false);
    }

    /** Snap to a named state (peek/half/full). animate=false skips transition. */
    snapTo(state, animate = true) {
        if (!this.states.includes(state)) return;
        if (!animate) this.el.dataset.dragging = 'true';
        this.el.style.height = ''; // clear any inline drag-height
        this.el.dataset.state = state;
        this.state = state;
        if (!animate) {
            requestAnimationFrame(() => { this.el.dataset.dragging = 'false'; });
        }
        this._emit('snap', state);
    }

    /** Cycle to the next state in order: peek → half → full → peek. */
    cycle() {
        const i = this.states.indexOf(this.state);
        this.snapTo(this.states[(i + 1) % this.states.length]);
    }

    /** Subscribe to events: 'snap' fires whenever the state changes. */
    on(event, fn) {
        (this._listeners[event] ||= []).push(fn);
        return () => { this._listeners[event] = this._listeners[event].filter(f => f !== fn); };
    }

    _emit(event, ...args) {
        (this._listeners[event] || []).forEach(fn => fn(...args));
    }

    _setupListeners() {
        const onDown = (e) => {
            const y = e.touches ? e.touches[0].clientY : e.clientY;
            this._dragStartY = y;
            this._dragStartHeight = this.el.getBoundingClientRect().height;
            this._dragStartTime = performance.now();
            this.el.dataset.dragging = 'true';
            e.preventDefault();
        };

        const onMove = (e) => {
            if (this._dragStartY === null) return;
            const y = e.touches ? e.touches[0].clientY : e.clientY;
            const delta = this._dragStartY - y; // up = positive
            const newHeight = Math.max(60, Math.min(window.innerHeight, this._dragStartHeight + delta));
            this.el.style.height = newHeight + 'px';
            e.preventDefault();
        };

        const onUp = (e) => {
            if (this._dragStartY === null) return;
            const endY = e.changedTouches ? e.changedTouches[0].clientY : (e.clientY ?? this._dragStartY);
            const moved = this._dragStartY - endY; // up = positive
            const elapsed = performance.now() - this._dragStartTime;
            const isTap = Math.abs(moved) < 6 && elapsed < 250;

            this.el.dataset.dragging = 'false';

            if (isTap) {
                this.el.style.height = '';
                this.cycle();
            } else {
                this._snapToNearest(moved);
            }

            this._dragStartY = null;
            this._dragStartHeight = null;
        };

        this.handleArea.addEventListener('mousedown', onDown);
        this.handleArea.addEventListener('touchstart', onDown, { passive: false });
        document.addEventListener('mousemove', onMove);
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('mouseup', onUp);
        document.addEventListener('touchend', onUp);
        document.addEventListener('touchcancel', onUp);
    }

    _snapToNearest(directionDelta) {
        const currentHeight = this.el.getBoundingClientRect().height;
        const stateHeights = this.states.map(s => this._stateHeight(s));

        // Strong gesture (>60px) → bias toward direction
        if (Math.abs(directionDelta) > 60) {
            const currentIdx = this.states.indexOf(this.state);
            const targetIdx = directionDelta > 0
                ? Math.min(currentIdx + 1, this.states.length - 1)
                : Math.max(currentIdx - 1, 0);
            this.snapTo(this.states[targetIdx]);
            return;
        }

        // Otherwise snap to absolute-nearest by height
        let bestState = this.states[0], bestDiff = Infinity;
        this.states.forEach((s, i) => {
            const diff = Math.abs(currentHeight - stateHeights[i]);
            if (diff < bestDiff) { bestDiff = diff; bestState = s; }
        });
        this.snapTo(bestState);
    }

    _stateHeight(state) {
        const cssVar = STATE_VARS[state];
        if (!cssVar) return fallbackHeight(state);
        const val = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
        if (!val) return fallbackHeight(state);
        if (val.endsWith('px')) return parseFloat(val);
        if (val.endsWith('svh') || val.endsWith('vh') || val.endsWith('dvh')) {
            return parseFloat(val) * window.innerHeight / 100;
        }
        if (val.endsWith('%')) return parseFloat(val) * window.innerHeight / 100;
        return parseFloat(val) || fallbackHeight(state);
    }
}
