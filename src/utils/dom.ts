/**
 * DOM and general utility functions.
 * @author Marcel Duin <marcel@micr.io>
 */

import { Frame } from '$core/frame'

/** SVG namespace URI. @internal */
export const SVG_NS = 'http://www.w3.org/2000/svg'

/** The `allow` attribute value for every iframe Micrio renders, enabling the permissions its supported players (YouTube, Vimeo, DRM video, geolocation-aware embeds) require. @internal */
export const IFRAME_ALLOW = 'autoplay; fullscreen; encrypted-media; geolocation'

/** Options for creating DOM elements with properties, attributes, events, and children. @internal */
export interface ElementOptions {
	className?: string
	textContent?: string
	innerHTML?: string
	id?: string
	dataset?: Record<string, string>
	attrs?: Record<string, string | null | undefined>
	style?: Partial<CSSStyleDeclaration> | string
	props?: Record<string, unknown>
	events?: Record<string, EventListenerOrEventListenerObject>
	children?: (Node | string | number | false | null | undefined)[]
	parent?: ParentNode
	setProps?: Record<string, unknown>
	ns?: string
}

/** Creates an HTML element with the given tag and options, applying attributes, styles, events, and children. @internal */
export function createElement<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	options?: ElementOptions,
): HTMLElementTagNameMap[K]
/* @internal */
export function createElement(tag: string, options: ElementOptions & { ns: string }): SVGElement
/* @internal */
export function createElement(tag: string, options?: ElementOptions): HTMLElement
/* @internal */
export function createElement(tag: string, options: ElementOptions = {}): HTMLElement | SVGElement {
	if (options.ns) {
		const el = document.createElementNS(options.ns, tag)
		if (!(el instanceof SVGElement)) {
			throw new Error(`Could not create SVG element: ${tag}`)
		}
		applyOptions(el, options)
		return el
	}
	const el = document.createElement(tag)
	applyOptions(el, options)
	return el
}

/** Applies the given options to a created element. @internal */
function applyOptions(el: HTMLElement | SVGElement, options: ElementOptions): void {
	if (options.className) {
		if (el instanceof SVGElement) {
			el.setAttribute('class', options.className)
		} else {
			el.className = options.className
		}
	}
	if (options.textContent !== undefined) {
		el.textContent = options.textContent
	}
	if (options.innerHTML !== undefined) {
		el.innerHTML = options.innerHTML
	}
	if (options.id) {
		el.id = options.id
	}
	if (options.dataset) {
		for (const [k, v] of Object.entries(options.dataset)) {
			el.dataset[k] = v
		}
	}
	if (options.attrs) {
		for (const [k, v] of Object.entries(options.attrs)) {
			if (v == null) {
				el.removeAttribute(k)
			} else {
				el.setAttribute(k, v)
			}
		}
	}
	if (options.style !== undefined && options.style !== '') {
		if (typeof options.style === 'string') {
			el.style.cssText = options.style
		} else {
			Object.assign(el.style, options.style)
		}
	}
	if (options.props) {
		Object.assign(el, options.props)
	}
	if (options.events) {
		for (const [type, handler] of Object.entries(options.events)) {
			el.addEventListener(type, handler)
		}
	}
	if (options.children) {
		for (const child of options.children) {
			if (child == null || child === false) {
				continue
			}
			if (typeof child === 'string' || typeof child === 'number') {
				el.append(String(child))
			} else {
				el.append(child)
			}
		}
	}
	if (options.setProps && '_setProps' in el && typeof el._setProps === 'function') {
		el._setProps(options.setProps)
	}
	if (options.parent) {
		options.parent.append(el)
	}
}

/** Creates an SVG element with the given tag and options. @internal */
export function createSvgElement<K extends keyof SVGElementTagNameMap>(
	tag: K,
	options?: ElementOptions,
): SVGElementTagNameMap[K]
/* @internal */
export function createSvgElement(tag: string, options?: ElementOptions): SVGElement
/* @internal */
export function createSvgElement(tag: string, options: ElementOptions = {}): SVGElement {
	return createElement(tag, { ...options, ns: SVG_NS })
}

/**
 * Returns a Promise that resolves after a specified number of milliseconds.
 * @internal
 * @param ms The number of milliseconds to wait. If 0, resolves immediately.
 */
export const sleep = (ms: number) =>
	new Promise<void>((ok) => {
		if (ms) {
			setTimeout(ok, ms)
		} else {
			ok()
		}
	})

/** Returns a Promise that resolves after the next browser paint (two frames). @internal */
export const afterFrame = (): Promise<void> => Frame.afterPaint()

/** Set of script URLs already loaded successfully. @internal */
const loaded = new Set<string>()

/** In-flight script loads by URL, so two concurrent callers share one request. @internal */
const inFlight = new Map<string, Promise<void>>()

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
	if (!(windowKey in globalThis)) {
		await loadScript(url, cbFunc)
	}
	if (!(windowKey in globalThis)) {
		throw new Error(`Failed to load ${windowKey} API from ${url}`)
	}
}

/**
 * Dynamically loads an external script, ensuring it is loaded only once per session.
 * @internal
 * @param src The URL of the script to load.
 * @param cbFunc Optional global callback function name to be called upon script load.
 * @param targetObj If provided, the script is assumed to be already loaded.
 * @returns A Promise that resolves when the script is loaded, or rejects on error.
 */
export const loadScript = (src: string, cbFunc?: string, targetObj?: unknown): Promise<void> => {
	if (targetObj !== undefined || loaded.has(src)) {
		return Promise.resolve()
	}
	// Two embeds can ask for the same API in the same tick (two YouTube players mounting
	// together). Injecting the script twice installs a second `cbFunc` global, and the API calls
	// it once — so the first caller's promise would never settle. Sharing the in-flight promise
	// is what keeps both of them resolvable.
	const pending = inFlight.get(src)
	if (pending) {
		return pending
	}
	const promise = new Promise<void>((ok, err) => {
		const script = document.createElement('script')
		// Only the first signal counts: a script that errors after its callback already
		// ran is not an error, and vice versa.
		let settled = false
		const settle = (failed: boolean) => {
			if (settled) {
				return
			}
			settled = true
			if (cbFunc) {
				Reflect.deleteProperty(globalThis, cbFunc)
			}
			if (failed) {
				err(new Error(`Failed to load ${src}`))
				return
			}
			loaded.add(src)
			ok()
		}
		const onload = () => {
			settle(false)
		}
		if (cbFunc) {
			Object.assign(globalThis, { [cbFunc]: onload })
		} else {
			script.addEventListener('load', onload)
		}
		// Wired even when a callback name is used: that callback is only ever reached
		// through the script's own load notification, so without this listener a script
		// that fails to load rejects nothing and every caller awaiting this hangs.
		script.addEventListener('error', () => {
			settle(true)
		})
		script.async = true
		script.defer = true
		if (globalThis.crossOriginIsolated) {
			script.crossOrigin = 'anonymous'
		}
		script.src = src
		document.head.append(script)
	}).finally(() => {
		// A failed load is not remembered, so the next caller still retries it
		inFlight.delete(src)
	})
	inFlight.set(src, promise)
	return promise
}
