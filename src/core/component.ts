import type { Readable, Subscriber } from './store';
import { defer, skipFirst } from './store';
import type { HTMLMicrioElement } from './element';
import type { MicrioImage } from './image';

const PROVIDES = Symbol('micrio-provides');

export abstract class MicrioElement<_P = {}> extends HTMLElement {
	static tag: string;
	static _markerImages: Map<string, MicrioImage> = new Map();

	#_unsubs: (() => void)[] = [];
	#_renderKey: string | null = null;

	/** Protected props storage for use with the standard setProps/render pattern. */
	protected _props: Record<string, any> = {};

	connectedCallback(): void {
		this._onMount?.();
		this._render?.();
	}

	disconnectedCallback(): void {
		this._onDestroy?.();
		this.#cleanup();
	}

	_onMount?(): void;
	_onDestroy?(): void;

	/**
	 * Override in subclasses to receive props.
	 * The base implementation merges into `_props` and calls `_render()` when connected.
	 */
	_setProps(props: Record<string, any>): void {
		Object.assign(this._props, props);
		if (this.isConnected) this._render();
	}

	/** Override in subclasses for render logic. Called on mount and after setProps. */
	protected _render(): void {}

	/**
	 * Register a cleanup function to be called automatically on disconnect.
	 * Every component should use this instead of maintaining private cleanup arrays.
	 */
	protected _addCleanup(fn: () => void): void {
		this.#_unsubs.push(fn);
	}

	/**
	 * Call at the start of render(). If `key` matches the last render,
	 * the render is skipped and `_syncDisplay()` is called instead.
	 * Returns `true` if the render should proceed, `false` if skipped.
	 */
	protected _checkRenderKey(key: string): boolean {
		if (key === this.#_renderKey) {
			this._syncDisplay?.();
			return false;
		}
		this.#_renderKey = key;
		return true;
	}

	/**
	 * Called when a render was skipped due to unchanged key.
	 * Use for lightweight CSS-only updates (toggling classes, CSS vars)
	 * that should still apply even when the DOM structure doesn't change.
	 */
	protected _syncDisplay?(): void;

	// ─── Store helpers ────────────────────────────────────────────

	protected _watch<T>(store: Readable<T>, fn: (value: T) => void, opts?: { skipFirst?: boolean; defer?: boolean }): void {
		let sub: Subscriber<T> = fn;
		if (opts?.skipFirst) sub = skipFirst(fn);
		if (opts?.defer) sub = defer(fn);
		this._addCleanup(store.subscribe(sub));
	}

	/** Subscribe but skip the very first emission (useful when onMount already sets initial state) */
	protected _watchLater<T>(store: Readable<T>, fn: (value: T) => void): void {
		this._watch(store, fn, { skipFirst: true });
	}

	/** Subscribe with microtask-level coalescing, skipping the initial emission */
	protected _watchLazy<T>(store: Readable<T>, fn: (value: T) => void): void {
		this._watch(store, fn, { skipFirst: true, defer: true });
	}

	/** Subscribe with a pre-built subscriber wrapper (for use with defer, skipFirst, etc.) */
	protected _watchWith<T>(store: Readable<T>, fn: Subscriber<T>): void {
		this._addCleanup(store.subscribe(fn));
	}

	// ─── Context (provide / inject) ───────────────────────────────

	protected _provide(key: string, value: any): void {
		let map: Map<string, any> | undefined = (this as any)[PROVIDES];
		if (!map) (this as any)[PROVIDES] = map = new Map();
		map.set(key, value);
	}

	protected _inject<T>(key: string): T | undefined {
		let el: HTMLElement | null = this;
		while (el) {
			const map: Map<string, any> | undefined = (el as any)[PROVIDES];
			if (map?.has(key)) return map.get(key) as T;
			el = el.parentElement;
		}
		return undefined;
	}

	protected _getMicrio(): HTMLMicrioElement | undefined {
		return this._inject<any>('micrio');
	}

	#cleanup(): void {
		for (const fn of this.#_unsubs) fn();
		this.#_unsubs = [];
	}
}
