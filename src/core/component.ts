import type { Readable, Subscriber } from './store';
import { defer, skipFirst } from './store';
import type { HTMLMicrioElement } from './element';
import type { MicrioImage } from './image';

/**
 * Context values provided by an element, keyed by the element itself.
 * Held in a WeakMap so the elements stay collectable and no `any`-indexed
 * property is needed on the base class.
 * @internal
 */
const provided = new WeakMap<HTMLElement, Map<string, unknown>>();

/** True when `value` is the `<micr-io>` custom element. @internal */
function isMicrioElement(value: unknown): value is HTMLMicrioElement {
	return value instanceof HTMLElement && value.tagName.toLowerCase() === 'micr-io';
}

/**
 * Abstract base class for all Micrio custom HTML elements.
 * Provides a standard lifecycle and prop/render pattern, store subscription helpers,
 * and a context (provide/inject) system for parent-child communication.
 */
export abstract class MicrioElement<_P extends object = Record<string, unknown>> extends HTMLElement {
	/** The custom element tag name registered via `customElements.define`. @internal */
	static tag: string;
	/** @internal */
	static _markerImages = new Map<string, MicrioImage>();

	#_unsubs: (() => void)[] = [];
	#_renderKey: string | null = null;

	/** Protected props storage for use with the standard setProps/render pattern.
	 * Partial because props arrive incrementally through `_setProps`.
	 * @internal
	*/
	protected _props: Partial<_P> = {};

	/** Lifecycle hook called when the element is added to the DOM. Calls _onMount and _render. @internal */
	connectedCallback(): void {
		this._onMount?.();
		this._render?.();
	}

	/** Lifecycle hook called when the element is removed from the DOM. Calls _onDestroy and cleans up subscriptions. @internal */
	disconnectedCallback(): void {
		this._onDestroy?.();
		this.#cleanup();
	}

	/** @internal */
	_onMount?(): void;
	/** @internal */
	_onDestroy?(): void;

	/**
	 * Override in subclasses to receive props.
	 * The base implementation merges into `_props` and calls `_render()` when connected.
	 * @internal
	 */
	_setProps(props: Partial<_P>): void {
		Object.assign(this._props, props);
		if (this.isConnected) {this._render();}
	}

	/** Override in subclasses for render logic. Called on mount and after setProps.
	 * @internal
	*/
	protected _render(): void {}

	/**
	 * Register a cleanup function to be called automatically on disconnect.
	 * Every component should use this instead of maintaining private cleanup arrays.
	 * @internal
	 */
	protected _addCleanup(fn: () => void): void {
		this.#_unsubs.push(fn);
	}

	/**
	 * Call at the start of render(). If `key` matches the last render,
	 * the render is skipped and `_syncDisplay()` is called instead.
	 * Returns `true` if the render should proceed, `false` if skipped.
	 * @internal
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
	 * @internal
	 */
	protected _syncDisplay?(): void;

	// ─── Store helpers ────────────────────────────────────────────

	/** @internal */
	protected _watch<T>(store: Readable<T>, fn: (value: T) => void, opts?: { skipFirst?: boolean; defer?: boolean }): void {
		let sub: Subscriber<T> = fn;
		if (opts?.skipFirst) {sub = skipFirst(sub);}
		if (opts?.defer) {sub = defer(sub);}
		this._addCleanup(store.subscribe(sub));
	}

	/** Subscribe but skip the very first emission (useful when onMount already sets initial state)
	 * @internal
	*/
	protected _watchLater<T>(store: Readable<T>, fn: (value: T) => void): void {
		this._watch(store, fn, { skipFirst: true });
	}

	/** Subscribe with microtask-level coalescing, skipping the initial emission
	 * @internal
	*/
	protected _watchLazy<T>(store: Readable<T>, fn: (value: T) => void): void {
		this._watch(store, fn, { skipFirst: true, defer: true });
	}

	/** Subscribe with a pre-built subscriber wrapper (for use with defer, skipFirst, etc.)
	 * @internal
	*/
	protected _watchWith<T>(store: Readable<T>, fn: Subscriber<T>): void {
		this._addCleanup(store.subscribe(fn));
	}

	// ─── Context (provide / inject) ───────────────────────────────

	/** @internal */
	protected _provide(key: string, value: unknown): void {
		let map = provided.get(this);
		if (!map) {provided.set(this, map = new Map());}
		map.set(key, value);
	}

	/** @internal */
	protected _inject(key: string): unknown {
		const map = provided.get(this);
		if (map?.has(key)) {return map.get(key);}
		let el = this.parentElement;
		while (el) {
			const parentMap = provided.get(el);
			if (parentMap?.has(key)) {return parentMap.get(key);}
			el = el.parentElement;
		}
		return undefined;
	}

	/** @internal */
	protected _getMicrio(): HTMLMicrioElement | undefined {
		const micrio = this._inject('micrio');
		return isMicrioElement(micrio) ? micrio : undefined;
	}

	#cleanup(): void {
		for (const fn of this.#_unsubs) {fn();}
		this.#_unsubs = [];
	}
}
