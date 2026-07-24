/**
 * DOM and general utility functions.
 * @author Marcel Duin <marcel@micr.io>
 */

export const SVG_NS = 'http://www.w3.org/2000/svg';

export interface ElementOptions {
	className?: string;
	textContent?: string;
	innerHTML?: string;
	id?: string;
	dataset?: Record<string, string>;
	attrs?: Record<string, string | null | undefined>;
	style?: Partial<CSSStyleDeclaration> | string;
	props?: Record<string, unknown>;
	events?: Record<string, EventListenerOrEventListenerObject>;
	children?: (Node | string | number | false | null | undefined)[];
	parent?: Node;
	setProps?: Record<string, unknown>;
	ns?: string;
}

export function createElement<K extends keyof HTMLElementTagNameMap>(tag: K, options?: ElementOptions): HTMLElementTagNameMap[K];
export function createElement(tag: string, options?: ElementOptions): HTMLElement;
export function createElement(tag: string, options: ElementOptions = {}): HTMLElement {
	const el = options.ns
		? document.createElementNS(options.ns, tag) as HTMLElement
		: document.createElement(tag);

	if (options.className) {
		if (el instanceof SVGElement) el.setAttribute('class', options.className);
		else el.className = options.className;
	}
	if (options.textContent !== undefined) el.textContent = options.textContent;
	if (options.innerHTML !== undefined) el.innerHTML = options.innerHTML;
	if (options.id) el.id = options.id;
	if (options.dataset) for (const [k, v] of Object.entries(options.dataset)) el.dataset[k] = v;
	if (options.attrs) for (const [k, v] of Object.entries(options.attrs)) {
		if (v == null) el.removeAttribute(k);
		else el.setAttribute(k, v);
	}
	if (options.style) {
		if (typeof options.style === 'string') el.style.cssText = options.style;
		else Object.assign(el.style, options.style);
	}
	if (options.props) Object.assign(el, options.props);
	if (options.events) for (const [type, handler] of Object.entries(options.events)) el.addEventListener(type, handler);
	if (options.children) for (const child of options.children) {
		if (child == null || child === false) continue;
		if (typeof child === 'string' || typeof child === 'number') el.append(String(child));
		else el.append(child);
	}
	if (options.setProps) (el as any)._setProps?.(options.setProps);
	if (options.parent) options.parent.appendChild(el);

	return el;
}

export function createSvgElement<K extends keyof SVGElementTagNameMap>(tag: K, options?: ElementOptions): SVGElementTagNameMap[K];
export function createSvgElement(tag: string, options?: ElementOptions): SVGElement;
export function createSvgElement(tag: string, options: ElementOptions = {}): SVGElement {
	return createElement(tag, { ...options, ns: SVG_NS }) as unknown as SVGElement;
}

/**
 * Returns a Promise that resolves after a specified number of milliseconds.
 * @internal
 * @param ms The number of milliseconds to wait. If 0, resolves immediately.
 */
export const sleep = (ms: number) => new Promise<void>(ok => ms ? setTimeout(ok, ms) : ok());

/** Returns a Promise that resolves after the next browser paint (two animation frames). */
export const afterFrame = () => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));

/** Set of script URLs already loaded or currently loading. @internal */
const loaded = new Set<string>();

/**
 * Loads an external JavaScript file dynamically. Ensures scripts are loaded only once per session.
 * @internal
 * @param src The URL of the script to load.
 * @param cbFunc Optional global callback function name to be called upon script load.
 * @param targetObj Optional target object (if provided, assumes script is already loaded).
 * @returns A Promise that resolves when the script is loaded, or rejects on error.
 */
/**
 * Loads an external JavaScript API dynamically if not already present.
 * Checks for the API on `self` (window), loads the script if missing,
 * then verifies the API was loaded successfully.
 * @internal
 * @param windowKey The key on `window` to check (e.g., `'YT'`, `'Vimeo'`, `'Hls'`).
 * @param url The script URL to load.
 * @param cbFunc Optional global callback function name for script load.
 */
export async function loadExternalAPI(windowKey: string, url: string, cbFunc?: string): Promise<void> {
	if (!(windowKey in self)) {
		await loadScript(url, cbFunc);
	}
	if (!(windowKey in self)) {
		throw new Error(`Failed to load ${windowKey} API from ${url}`);
	}
}

export const loadScript = (src: string, cbFunc?: string, targetObj?: unknown) => new Promise<void>((ok, err) => {
	if (targetObj || loaded.has(src)) return ok();
	const script = document.createElement('script');
	const onload = () => { loaded.add(src); ok(); };
	if (cbFunc) (self as unknown as Record<string, () => void>)[cbFunc] = onload;
	else script.onload = onload;
	script.onerror = () => err?.();
	script.async = true;
	script.defer = true;
	if (self.crossOriginIsolated) script.crossOrigin = 'anonymous';
	script.src = src;
	document.head.appendChild(script);
});

