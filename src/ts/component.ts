import type { Readable, Subscriber } from './store';
import { lazy } from './store';

const PROVIDES = Symbol('micrio-provides');

let _injectedStyles = new Set<string>();

export abstract class MicrioElement<P = {}> extends HTMLElement {
	static tag: string;
	static styles: string;
	static markerImages: Map<string, any> = new Map();

	/** Merged props object. Subclasses read from this in render(). */
	_props: Partial<P> = {};

	#_unsubs: (() => void)[] = [];
	#_renderKey: string | null = null;

	connectedCallback(): void {
		this._injectStyles();
		this.onMount?.();
	}

	disconnectedCallback(): void {
		this.onDestroy?.();
		this._cleanup();
	}

	onMount?(): void;
	onDestroy?(): void;

	/** Override to react to prop changes (called after props are merged). */
	onPropsChange?(): void;

	/** Merge partial props and trigger onPropsChange. */
	setProps(props: Partial<P>): void {
		Object.assign(this._props, props);
		this.onPropsChange?.();
	}

	/**
	 * Call at the start of render(). If `key` matches the last render,
	 * the render is skipped and `syncDisplay()` is called instead.
	 * Returns `true` if the render should proceed, `false` if skipped.
	 */
	protected checkRenderKey(key: string): boolean {
		if (key === this.#_renderKey) {
			this.syncDisplay?.();
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
	protected syncDisplay?(): void;

	// ─── Store helpers ────────────────────────────────────────────

	protected watch<T>(store: Readable<T>, fn: (value: T) => void): void {
		const unsub = store.subscribe(fn);
		this.#_unsubs.push(unsub);
	}

	/** Subscribe but skip the very first emission (useful when onMount already sets initial state) */
	protected watchLater<T>(store: Readable<T>, fn: (value: T) => void): void {
		let first = true;
		const unsub = store.subscribe(v => {
			if (first) { first = false; return; }
			fn(v);
		});
		this.#_unsubs.push(unsub);
	}

	/** Subscribe with microtask-level coalescing, skipping the initial emission */
	protected watchLazy<T>(store: Readable<T>, fn: (value: T) => void): void {
		this.watchWith(store, lazy(fn));
	}

	protected watchOnce<T>(store: Readable<T>, fn: (value: T) => void): void {
		let unsub: (() => void) | undefined;
		unsub = store.subscribe(v => {
			fn(v);
			unsub?.();
		});
		this.#_unsubs.push(unsub);
	}

	/** Subscribe with a pre-built subscriber wrapper (for use with defer, skipFirst, etc.) */
	protected watchWith<T>(store: Readable<T>, fn: Subscriber<T>): void {
		const unsub = store.subscribe(fn);
		this.#_unsubs.push(unsub);
	}

	// ─── Context (provide / inject) ───────────────────────────────

	protected provide(key: string, value: any): void {
		let map: Map<string, any> | undefined = (this as any)[PROVIDES];
		if (!map) (this as any)[PROVIDES] = map = new Map();
		map.set(key, value);
	}

	protected inject<T>(key: string): T | undefined {
		let el: HTMLElement | null = this;
		while (el) {
			const map: Map<string, any> | undefined = (el as any)[PROVIDES];
			if (map?.has(key)) return map.get(key) as T;
			el = el.parentElement;
		}
		return undefined;
	}

	// ─── CSS injection ────────────────────────────────────────────

	private _injectStyles(): void {
		const ctor = this.constructor as typeof MicrioElement;
		if (ctor.styles && !_injectedStyles.has(ctor.tag)) {
			_injectedStyles.add(ctor.tag);
			const el = document.createElement('style');
			el.textContent = ctor.styles;
			el.setAttribute('data-micrio', ctor.tag);
			document.head.appendChild(el);
		}
	}

	private _cleanup(): void {
		for (const fn of this.#_unsubs) fn();
		this.#_unsubs = [];
	}
}
