import type { Writable } from '$core/store'
import type { Models } from '$types/models'
import type { Camera } from './camera'
import type { MicrioMain } from '$layout/main'

import { deepCopy } from '$utils/object'
import { fetchJson } from '$utils/fetch'
import { idIsV5 } from '$utils/id'
import { MicrioError, getErrorMessage } from '$core/error'
import { DataLoader } from '$utils/dataLoader'
import { VERSION } from './version'
import { ATTRIBUTE_OPTIONS as AO, DEFAULT_SETTINGS, localStorageKeys } from './globals'
import { writable, get, tick } from '$core/store'
import { Frame } from './frame'
import { Engine } from '$render/engine'
import { WebGL } from '$render/webgl'
import { Canvas } from '$render/canvas'
import { Events } from '$core/events/facade'
import { MicrioImage } from './image'
import { State } from './state'

import { Gallery } from '$gallery/controller'
import { isRTL } from '$core/i18n/locale'
import { i18n, langs } from '$core/i18n/strings'
import { MicrioElement } from '$core/component'
import { openSplit, closeAllSplits } from '$core/split'
import './element.css'
import { createElement } from '$utils/dom'
import { IdleState } from '$utils/idle'

/** Compile-time flag — `true` in the core build (vite `--mode minimal`). */
declare const __CORE__: boolean

/** Loose shape of an IIIF manifest / `info.json` response, as read when opening by URL. @internal */
interface IIIFResponse {
	'@id'?: string
	id?: string
	/** Absent on anything that is not an Image API `info.json`. */
	width?: number
	height?: number
	type?: string
	tiles?: Models.ImageInfo.ImageInfo['tiles']
	preferredFormats?: string[]
	items?: IIIFItem[]
}

/** Nested IIIF manifest item (canvas → annotation page → annotation). @internal */
interface IIIFItem {
	items?: IIIFItem[]
	body?: {
		width: number
		height: number
		service?: { id?: string; preferredFormats?: string[] }[]
	}
}

/** True for a dimension an Image API response can actually be rendered from. */
function isImageSize(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value > 0
}

/** An attribute definition map from {@link AO}. @internal */
type AttributeCategory = typeof AO.STRINGS
/** A single attribute definition from {@link AO}. @internal */
type AttributeDef = AttributeCategory[string]
/** A parsed `<micr-io>` attribute value. @internal */
type AttributeValue = string | number | boolean | number[] | undefined

/** Assigns a value to a (possibly dot-separated) key path within an options object. @internal */
function setObj(obj: object, path: string, val: unknown): void {
	const p = path.split('.')
	let target: object = obj
	for (let i = 0; i < p.length - 1; i++) {
		const next: unknown = Reflect.get(target, p[i])
		if (typeof next !== 'object' || next === null) {
			throw new TypeError(`Micrio: '${p[i]}' in '${path}' is not an object`)
		}
		target = next
	}
	Reflect.set(target, p[p.length - 1], val)
}

/** Registers the Micrio UI custom element so `createElement('micrio-main')` returns its class. @internal */
declare global {
	interface HTMLElementTagNameMap {
		'micrio-main': MicrioMain
	}
}

/**
 * The main Micrio custom HTML element `<micr-io>`.
 * This class acts as the central controller for the Micrio viewer, managing
 * the WebGL canvas, compute engine, UI, state, events, and image loading.
 *
 * It orchestrates the interaction between different parts of the library and
 * exposes methods and properties for controlling the viewer.
 *
 * @example
 * ```html
 * <micr-io id="image123"></micr-io>
 * <script>
 *   const viewer = document.querySelector('micr-io');
 *   viewer.open('image456');
 *   viewer.addEventListener('marker-click', (e) => console.log(e.detail));
 * </script>
 * ```
 *
 * @author Marcel Duin <marcel@micr.io>
 */
export class HTMLMicrioElement extends MicrioElement {
	/** Observed attributes trigger `attributeChangedCallback` when changed. */
	static get observedAttributes() {
		return ['id', 'muted', 'data-limited', 'lang']
	}

	/** The Micrio library version number. */
	static VERSION: string

	/** The custom element tag name registered via `customElements.define`. @internal */
	static tag = 'micr-io'

	/** Flag indicating if the initial print/setup has occurred.
	 * @internal
	 */
	#printed = false

	/** The in-flight (or settled) initial setup, so a concurrent `open()` waits for it.
	 * @internal
	 */
	#printing: Promise<void> | undefined

	/** Bumped by `destroy()`, so an initial setup that is still awaiting an async step stops. @internal */
	#printGen = 0

	/** Array holding all instantiated {@link MicrioImage} objects managed by this element.
	 * @internal
	 */
	readonly _canvases: MicrioImage[] = []

	/**
	 * Writable store holding the currently active main {@link MicrioImage}.
	 * Use `<micr-io>.open()` to change the active image.
	 * Subscribe to this store to react to image changes.
	 * Access the current value directly using the {@link $current} getter.
	 */
	readonly current: Writable<MicrioImage | undefined> = writable()

	/** Writable store holding an array of currently visible {@link MicrioImage} instances (relevant for grid).
	 * @internal
	 */
	readonly _visible: Writable<MicrioImage[]> = writable<MicrioImage[]>([])

	/** Internal reference to the current image instance.
	 * @internal
	 */
	#current: MicrioImage | undefined

	/**
	 * Getter for the current value of the {@link current} store.
	 * Provides direct access to the active {@link MicrioImage} instance.
	 * @readonly
	 */
	get $current(): MicrioImage | undefined {
		return this.#current
	}

	/** Getter for the virtual {@link Camera} instance of the currently active image. */
	get camera(): Camera | undefined {
		return this.#current?.camera
	}

	/** The controller managing the HTML `<canvas>` element, resizing, and viewport. */
	readonly canvas: Canvas = new Canvas(this)

	/** The controller managing user input events (mouse, touch, keyboard) and dispatching custom events. */
	readonly events: Events = new Events(this)

	/** The main state manager, providing access to various application states (UI visibility, active marker, tour, etc.). See {@link State.Main}. */
	readonly state: State.Main = new State.Main()._setMicrio(this)

	/** Direct callbacks invoked on every camera move (instead of dispatching a DOM event).
	 * @internal
	 */
	readonly _onMove: ((detail: { image: MicrioImage; view: Models.Camera.View }) => void)[] = []
	/** Direct callbacks invoked on every camera zoom (instead of dispatching a DOM event).
	 * @internal
	 */
	readonly _onZoom: ((detail: { image: MicrioImage; view: Models.Camera.View }) => void)[] = []

	/** Writable store indicating if barebone texture downloading is enabled (lower quality, less bandwidth). */
	readonly barebone: Writable<boolean> = writable(false)

	/** The WebGL rendering controller.
	 * @internal
	 */
	readonly _webgl: WebGL = new WebGL(this)

	/** The compute engine controller, managing the render loop and tile drawing.
	 * @internal
	 */
	readonly _engine: Engine = new Engine(this)

	/** The root MicrioMain UI component instance.
	 * @internal
	 */
	_ui?: MicrioMain

	/** Custom settings object provided programmatically, overriding server-fetched settings. */
	defaultSettings?: Partial<Models.ImageInfo.Settings>

	/** Writable store indicating the overall loading state of the viewer.
	 * @internal
	 */
	readonly _loading: Writable<boolean> = writable(true)

	/** Writable store indicating if the viewer is currently transitioning between images.
	 * @internal
	 */
	readonly _switching: Writable<boolean> = writable(false)

	/** Writable store indicating the global muted state for audio. Synced with the `muted` attribute and localStorage.
	 * @internal
	 */
	readonly _isMuted: Writable<boolean> = writable(localStorage.getItem(localStorageKeys.globalMuted) === '1')

	/** Writable store holding the currently active language code (e.g., 'en', 'nl').
	 * @internal
	 */
	readonly _lang: Writable<string> = writable()

	/** Holds data for the current 360 space, if applicable (loaded via `data-space` attribute or API). */
	spaceData: Models.Spaces.Space | undefined

	/** Holds bundle-level marker tours, available regardless of which image is shown. */
	bundleTours: Models.ImageData.MarkerTour[] | undefined

	/** The current active gallery controller, if any. */
	gallery: Gallery | undefined

	/** If true, forces the WebGL render loop to run continuously, even when idle.
	 * @internal
	 */
	_keepRendering = false

	/** Idle state manager — sets `data-idle` on the element after inactivity. */
	#idle!: IdleState

	/** Activity callback retained so idle listeners can be removed on destroy. @internal */
	#onActivity?: () => void

	/** The lazyload observer, kept so `destroy` can disconnect it. @internal */
	#lazyObserver?: IntersectionObserver

	/** For setting first-time hooks
	 * @internal
	 */
	#initedFirst = false

	/**
	 * Called when an observed attribute changes. Handles changes to `id`, `muted`, `data-limited`, and `lang`.
	 * @internal
	 */
	attributeChangedCallback(attr: keyof Models.Attributes.MicrioCustomAttributes, _oldVal: string, newVal: string) {
		switch (attr) {
			case 'id': {
				{
					if (!this.isConnected || !newVal) {
						return
					}
					if (!this.#printed) {
						void this.#print()
					} else {
						void this.open(newVal)
					}
				}
				break
			}
			case 'muted': {
				if (get(this._isMuted) !== this.hasAttribute('muted')) {
					this._isMuted.set(this.hasAttribute('muted'))
				}
				break
			}
			case 'data-limited': {
				if (this.$current?.canvas) {
					this.$current.canvas._limited = Boolean(newVal)
				}
				break
			}
			case 'lang': {
				let prevLang = get(this._lang)
				if (prevLang !== newVal) {
					// Set the translations *before* `_lang`: everything that re-renders on
					// the language change (toolbar, controls, ...) reads `get(i18n)` while
					// doing so, and would otherwise render the previous language
					const baseLang = newVal.split('-')[0]
					i18n.set(langs[newVal] ?? langs[baseLang] ?? langs.en)
					this._lang.set(newVal)
					if (newVal) {
						if (isRTL(newVal)) {
							this.setAttribute('dir', 'rtl')
						} else {
							this.removeAttribute('dir')
						}
					}
					if (prevLang) {
						this.events._dispatch('lang-switch', newVal)
					}
					this.state._touch('lang')
				}
				break
			}
		}
	}

	/**
	 * Lifecycle hook called when the element is connected to the DOM.
	 * Provides itself as 'micrio' to descendants, positions the canvas,
	 * sets up the muted property, syncs the internal current reference,
	 * and kicks off initial loading.
	 * @internal
	 */
	_onMount(): void {
		this._provide('micrio', this)

		this.canvas.place()
		if (this.id && !this.#printed) {
			void this.#print()
		}

		if (!('muted' in this)) {
			Object.defineProperty(this, 'muted', {
				get(this: HTMLMicrioElement) {
					return get(this._isMuted)
				},
				set(this: HTMLMicrioElement, b: boolean) {
					if (b) {
						this.setAttribute('muted', '')
					} else {
						this.removeAttribute('muted')
					}
				},
			})
			this._watch(this._isMuted, (b) => {
				// @ts-expect-error -- `muted` is defined dynamically below
				this['muted'] = b
				if (b) {
					localStorage.setItem(localStorageKeys.globalMuted, '1')
					this.events._dispatch('audio-mute')
				} else {
					localStorage.removeItem(localStorageKeys.globalMuted)
					this.events._dispatch('audio-unmute')
				}
			})
		}

		const updateZoomed = () => {
			const imgs = get(this._visible).filter((i) => i.id)
			// A 3D book is hosted by its parent image, whose camera carries the
			// book3d zoom/pan overrides. The individual pages become visible as
			// the spread changes, so pick the parent for the zoomed check instead
			// of whichever single page happens to be on screen.
			// Exactly one visible image and not a book: that image is the one to test. (Spelled
			// out because `_book3d || imgs.length !== 1 ? this.#current : imgs[0]` reads as if
			// the visible-image count decided the branch on its own.)
			const singleVisible = !this._engine._book3d && imgs.length === 1
			const target = singleVisible ? imgs[0] : this.#current
			this.toggleAttribute(
				'data-zoomed',
				target?.camera !== undefined && target._placed && !target.camera.isZoomedOut(),
			)
		}

		this._watch(this.current, (c) => {
			this.#current = c
			updateZoomed()
		})

		this._watch(this._visible, () => {
			updateZoomed()
		})

		const onZoomCb = () => {
			updateZoomed()
		}
		this._onZoom.push(onZoomCb)
		this._addCleanup(() => {
			const i = this._onZoom.indexOf(onZoomCb)
			if (i >= 0) {
				this._onZoom.splice(i, 1)
			}
		})

		let shown = false
		// `_watch` emits the current value synchronously on subscribe, so the "first load
		// finished" work must be guarded by a flag rather than by unsubscribing from inside
		// the callback (the unsubscriber is not assigned yet on that first, synchronous call
		// — which also made reconnecting a loaded element throw).
		let loaded = false
		this._watch(this._loading, (v) => {
			if (v || loaded) {
				return
			}
			loaded = true
			this.dataset.loaded = ''

			this._watch(this._switching, (s) => {
				if (s) {
					this.dataset.switching = ''
				} else {
					if (!shown) {
						void tick().then(() => {
							this.events._dispatch('show', this)
						})
					}
					shown = true
					delete this.dataset.switching
				}
			})

			const img = this.querySelector('img.preview')
			if (img) {
				setTimeout(() => {
					img.remove()
				}, 500)
			}
		})

		// ── Idle detection (data-idle after inactivity) ────────────────
		// Skipped in the core build — the move listener it attaches costs CPU,
		// and the CSS that consumes `data-idle` is stubbed out there anyway.
		// `_onMount` runs again on every reconnect, so the listeners are attached once: a second
		// set would never be removed (only `destroy` removes the current closure) and the global
		// keydown would pin the detached element, its images and its engine for the page lifetime.

		if (!__CORE__ && !this.#onActivity) {
			this.#idle = new IdleState(this, {
				shouldIdle: () => {
					if (document.activeElement && this.contains(document.activeElement)) {
						return false
					}
					const buttons = this.querySelectorAll<HTMLElement>('button, micrio-button')
					for (const el of buttons) {
						if (el.matches(':hover')) {
							return false
						}
					}
					// A gallery scrub drag keeps the cursor busy even when it leaves
					// the scrubber component — don't go idle while dragging.
					if (this.querySelector('micrio-gallery[data-dragging]')) {
						return false
					}
					return true
				},
			})

			this.#onActivity = () => {
				this.#idle.activity()
			}
			for (const e of ['mousemove', 'pointerdown', 'wheel', 'focusin']) {
				this.addEventListener(e, this.#onActivity, { passive: true })
			}
			globalThis.addEventListener('keydown', this.#onActivity)
			this.#idle.activity()
		}
	}

	// Custom overloads for addEventListener to support fully typed custom Micrio events
	/* @internal */
	addEventListener<K extends keyof Models.MicrioEventMap>(
		type: K,
		listener: (this: HTMLMicrioElement, ev: Models.MicrioEventMap[K]) => void,
		options?: boolean | AddEventListenerOptions,
	): void
	/* @internal */
	addEventListener<K extends keyof HTMLElementEventMap>(
		type: K,
		listener: (this: HTMLMicrioElement, ev: HTMLElementEventMap[K]) => void,
		options?: boolean | AddEventListenerOptions,
	): void
	/* @internal */
	addEventListener(
		type: string,
		listener: (this: HTMLMicrioElement, ev: Event) => void,
		options?: boolean | AddEventListenerOptions,
	): void
	/* @internal */
	addEventListener(type: string, listener: EventListener | EventListenerObject, useCapture?: boolean): void {
		super.addEventListener(type, listener, useCapture)
	}

	// Custom overloads for removeEventListener to support fully typed custom Micrio events
	/* @internal */
	removeEventListener<K extends keyof Models.MicrioEventMap>(
		type: K,
		listener: (this: HTMLMicrioElement, ev: Models.MicrioEventMap[K]) => void,
		options?: boolean | EventListenerOptions,
	): void
	/* @internal */
	removeEventListener<K extends keyof HTMLElementEventMap>(
		type: K,
		listener: (this: HTMLMicrioElement, ev: HTMLElementEventMap[K]) => void,
		options?: boolean | EventListenerOptions,
	): void
	/* @internal */
	removeEventListener(
		type: string,
		listener: (this: HTMLMicrioElement, ev: Event) => void,
		options?: boolean | EventListenerOptions,
	): void
	/* @internal */
	removeEventListener(type: string, listener: EventListener | EventListenerObject, useCapture?: boolean): void {
		super.removeEventListener(type, listener, useCapture)
	}

	/** Pending `setTimeout` handles for content-page button actions, cancelled on destroy.
	 *  @internal
	 */
	readonly _pageButtonTimers: ReturnType<typeof globalThis.setTimeout>[] = []

	/** Destroys the Micrio instance, cleans up resources, and removes event listeners. */
	destroy(): void {
		// The split registry is module-global, so a split left open would keep both images (and,
		// through their engine, this disposed element) reachable for the life of the page. It is
		// closed synchronously here, while the engine and its canvases are still alive.
		closeAllSplits(this, true)
		this.current.set(undefined)
		this.events.enabled.set(false)
		this.state._cancelTouch()
		this.canvas.unhook()
		this._engine._unbind()
		if (this._ui) {
			this._ui.remove()
		}
		delete this._ui
		this._webgl._dispose(true)
		this.#idle?.destroy()
		if (this.#onActivity) {
			for (const e of ['mousemove', 'pointerdown', 'wheel', 'focusin'] as const) {
				this.removeEventListener(e, this.#onActivity)
			}
			globalThis.removeEventListener('keydown', this.#onActivity)
			this.#onActivity = undefined
		}
		// A page button navigates after a short delay; without this it would still mutate the
		// viewer's state after its UI is gone.
		for (const t of this._pageButtonTimers) {
			clearTimeout(t)
		}
		this._pageButtonTimers.length = 0
		this.#lazyObserver?.disconnect()
		this.#lazyObserver = undefined
		this.#printed = false
		this.#printing = undefined
		// Stop a setup that is still suspended on an async step; see `#doPrint`
		this.#printGen++
	}

	/**
	 * Fetches an IIIF document, attempts gallery creation, and falls back to a single-image BundleImage.
	 * A response that is neither a usable manifest nor an Image API `info.json` is reported as unsupported.
	 * @returns The resolved BundleImage, or `undefined` if a gallery was opened or an error occurred.
	 * @internal
	 */
	async #handleIIIF(url: string): Promise<Models.ImageBundle.BundleImage | undefined> {
		const resp = await fetchJson<IIIFResponse>(url).catch((e) => {
			this.#printError(e)
			return
		})
		if (!resp) {
			return undefined
		}

		let gallery: Gallery | null
		try {
			gallery = Gallery._fromIIIF(resp, this._engine)
		} catch (e) {
			this.#printError(e)
			return undefined
		}
		if (gallery) {
			void gallery._openOn(this)
			return undefined
		}

		// Determine id, width, height from canvas body (single-image manifest) or top-level info.json fields
		let id: unknown = resp['@id'] || resp.id || url.replace(/\/info\.json$/, '')
		let width: unknown = resp.width
		let height: unknown = resp.height

		if (resp.type === 'Manifest') {
			const body = resp.items?.[0]?.items?.[0]?.items?.[0]?.body
			const service = body?.service?.[0]
			if (body && service?.id) {
				;({ id } = service)
				;({ width, height } = body)
				resp.preferredFormats = service.preferredFormats
			}
		}

		// Every response that is neither a usable manifest nor an Image API info.json lands
		// here — a IIIF Collection, or JSON from the wrong URL. Without this guard it would
		// become an image with NaN bounds and a silently blank viewer.
		if (typeof id !== 'string' || id === '' || !isImageSize(width) || !isImageSize(height)) {
			this.#printError(
				new MicrioError('UNSUPPORTED_IIIF', {
					displayMessage: 'Not a valid IIIF manifest or Image API info.json',
				}),
			)
			return undefined
		}

		return {
			id,
			info: {
				id,
				path: id.replace(/\/[^/]*$/, ''),
				width,
				height,
				version: VERSION,
				isIIIF: true,
				is360: this.dataset.is360 === '',
				tiles: resp.tiles,
				preferredFormats: resp.preferredFormats,
			},
		}
	}

	/**
	 * Runs the element's initial setup once.
	 *
	 * The in-flight run is published as a promise so that `open()` (which a page can
	 * call while this is still resolving, e.g. right after mounting an album by id)
	 * waits for it instead of racing it.
	 * @internal
	 */
	#print(): Promise<void> {
		this.#printing ??= this.#doPrint()
		return this.#printing
	}

	/**
	 * Performs initial setup based on element attributes.
	 * Loads necessary data like galleries, grids, or archives before opening the first image.
	 * Handles lazy loading logic.
	 * @internal
	 */
	async #doPrint(): Promise<void> {
		if (this.#printed) {
			return
		}
		this.#printed = true
		// `destroy()` bumps this; a run that is suspended on an await then stops where it is.
		// Otherwise it would re-print the UI and re-init the engine after teardown, and the next
		// `#print()` would start a second, concurrent run next to it.
		const gen = this.#printGen
		const aborted = (): boolean => {
			if (gen === this.#printGen) {
				return false
			}
			this.#printed = false
			return true
		}
		// Keep this the first await: the synchronous part must not re-enter `#print`
		// before `#printing` has been assigned.
		await tick()
		if (aborted()) {
			return
		}
		const opts = this.#getOptions()
		if (!opts.settings) {
			opts.settings = {}
		}
		if (this.defaultSettings) {
			deepCopy(this.defaultSettings, opts.settings)
		}

		if (!opts.settings.noLogo) {
			this.#printUI(Boolean(opts.settings.noUI), false)
		}

		if (opts.id && idIsV5(opts.id) && !this.hasAttribute('width') && !this.hasAttribute('height')) {
			const bundle = await DataLoader._getBundleImage(opts.id).catch((error: unknown) => {
				console.error('[Micrio] Could not load the bundle for', opts.id, error)
			})
			if (aborted()) {
				return
			}
			if (bundle && bundle.info?.albumId) {
				// A failure here silently degrades the album to a single image, so it has to
				// be visible: without this the viewer just shows one picture and no reason.
				const galleryCtrl = await Gallery._fromAlbum(bundle.info.albumId, this._engine, {
					startId: opts.id,
					onProgress: (p: number) => this._ui?._setProps?.({ loadingProgress: p }),
				}).catch((error: unknown) => {
					console.error('[Micrio] Could not open the album for', opts.id, error)
					return null
				})
				if (aborted()) {
					return
				}
				if (galleryCtrl) {
					void galleryCtrl._openOn(this)
					return
				}
			}
		}

		if (opts.id && opts.id.startsWith('http')) {
			const bundle = await this.#handleIIIF(opts.id)
			if (aborted()) {
				return
			}
			if (!bundle) {
				return
			}
			bundle.settings = opts.settings
			void this.open(bundle)
			return
		}

		this._keepRendering = Boolean(opts.settings.keepRendering)
		this.events._dispatch('print', opts)

		const openBundle = () => {
			if (opts.id) {
				void this.open(opts.id)
			}
		}
		if (opts.settings.lazyload !== undefined && 'IntersectionObserver' in globalThis) {
			const observer = new IntersectionObserver(
				(e) => {
					if (e[0] === undefined || !e[0].isIntersecting) {
						return
					}
					observer.unobserve(this)
					openBundle()
				},
				{ rootMargin: `${opts.settings.lazyload * 100}% 0px` },
			)
			this.#lazyObserver = observer
			observer.observe(this)
		} else if (opts.id) {
			Frame.request(openBundle)
		}
	}

	/**
	 * Initializes or updates the MicrioMain UI component.
	 * @internal
	 * @param noHTML If true, renders a minimal UI without HTML overlays.
	 * @param noLogo If true, hides the Micrio logo.
	 */
	#printUI(noHTML: boolean, noLogo: boolean): void {
		if (!this._ui) {
			this._ui = createElement('micrio-main', { setProps: { noHTML, noLogo }, parent: this })
		} else {
			this._ui._setProps?.({ noHTML, noLogo })
		}
	}

	/**
	 * Displays an error message in the UI.
	 * @internal
	 * @param error The error (MicrioError, Error, or string) to display.
	 */
	#printError(error?: unknown): void {
		const message = getErrorMessage(error ?? 'An unknown error has occurred')
		console.error('Error:', message + (error instanceof MicrioError ? ` (${error.code}: ${error.message})` : ''))
		if (!this._ui) {
			this.#printUI(false, false)
		}
		this._ui?._setProps?.({ error: message })
		this._loading.set(false)
	}

	/**
	 * Opens a Micrio image by its Micrio ID (triggers a `bundle.json` download) or
	 * by providing a pre-resolved {@link Models.ImageBundle.BundleImage}.
	 *
	 * @param idOrInfo A Micrio image ID string or a full {@link Models.ImageBundle.BundleImage} object.
	 * @param opts Options for opening the image.
	 * @returns The {@link MicrioImage} instance being opened.
	 */
	async open(
		idOrInfo: string | Models.ImageBundle.BundleImage,
		opts: {
			/** If true, keeps the grid view active instead of focusing on the opened image. */
			gridView?: boolean
			/** An optional starting view to apply immediately. */
			startView?: Models.Camera.View
			/** For a grid focus, the transition animation to use (a marker's `gridTourTransition`). */
			transition?: Models.Grid.MarkerFocusTransition
			/** For 360 transitions, provides the direction vector from the previous image. */
			vector?: Models.Camera.Vector
			/** Optional Gallery controller, used for gallery/grid views. */
			gallery?: Gallery
		} = {},
	): Promise<MicrioImage | undefined> {
		// Wait for any setup run that is still in flight: an album is only built at
		// the end of `#print`, and opening the image before that would race it into
		// a second canvas while the gallery is being attached.
		//
		// The gallery's own `_openOn` re-enters here from inside that run, so it must
		// not wait on it (that would deadlock). It attaches the gallery before it
		// yields, so the run can then finish and every other caller sees it.
		if (opts.gallery === undefined || this.#printing === undefined) {
			await this.#print()
		}

		// ── Resolve input to a BundleImage ────────────────────────────────────

		const attrOpts = this.#getOptions()
		let bundle: Models.ImageBundle.BundleImage

		// IIIF URL: fetch manifest, attempt gallery, else extract single image info
		if (typeof idOrInfo === 'string' && idOrInfo.startsWith('http')) {
			const iiifBundle = await this.#handleIIIF(idOrInfo)
			if (!iiifBundle) {
				return this.$current
			}
			bundle = iiifBundle
		}
		// Standard bundle ID: fetch from DataLoader
		else if (typeof idOrInfo === 'string') {
			if (this.gallery) {
				const img = await this.gallery.gotoId(idOrInfo)
				return img ?? this.$current
			}
			const loaded = await DataLoader._getBundleImage(idOrInfo)
			if (!loaded) {
				this.#printError(`Image with id "${idOrInfo}" not found, published, or embeddable.`)
				return this.$current
			}
			bundle = loaded
		}
		// Already a BundleImage
		else {
			bundle = idOrInfo
		}

		// ── Merge attribute / default settings (strings only — BundleImage already carries its own) ──

		if (!bundle.settings) {
			bundle.settings = {}
		}
		if (attrOpts.settings?.gallery?.archive && !/\.\d+$/.test(attrOpts.settings.gallery.archive)) {
			delete attrOpts.settings.gallery.archive
		}
		if (typeof idOrInfo === 'string') {
			deepCopy(attrOpts.settings, bundle.settings)
			// Root attributes were spread over the info object for an id (the IIIF path resolved
			// its own bundle and never did), and `#getOptions` still parses them. Without this,
			// `data-path`, `width`, `height` and `data-version` are read and then dropped.
			if (!idOrInfo.startsWith('http')) {
				if (attrOpts.width !== undefined) {
					bundle.info.width = attrOpts.width
				}
				if (attrOpts.height !== undefined) {
					bundle.info.height = attrOpts.height
				}
				if (attrOpts.path !== undefined) {
					bundle.info.path = attrOpts.path
				}
				if (attrOpts.version !== undefined) {
					bundle.info.version = attrOpts.version
				}
			}
		}
		if (this.defaultSettings) {
			deepCopy(this.defaultSettings, bundle.settings)
		}
		if (bundle.settings?.gallery?.settings) {
			deepCopy(bundle.settings.gallery.settings, bundle.settings)
		}
		deepCopy(DEFAULT_SETTINGS, bundle.settings, { noOverwrite: true }) // Fill in any missing defaults

		// ── Deduplicate ───────────────────────────────────────────────────────

		// An *unplaced* current image falls through instead: its canvas was closed (or never
		// placed), and returning early here would leave the viewer with nothing to draw.
		if (this.$current && this.$current._placed && bundle.id === this.$current.id) {
			return this.$current
		}

		// Close any active splits when navigating away
		if (this.$current && !opts.gridView) {
			closeAllSplits(this)
		}

		if (!opts.gridView && this.$current) {
			this._switching.set(true)
		}
		this.#printUI(Boolean(bundle.settings.noUI), Boolean(bundle.settings.noLogo))

		// ── Find or create canvas ─────────────────────────────────────────────

		let c: MicrioImage | undefined = this._canvases.find((canvas) => bundle.id !== '' && canvas.id === bundle.id)
		let isInGrid = false
		const grid = this._canvases[0]?.grid
		if (!c && grid) {
			const gridImage = bundle.id ? grid._images.find((img) => img.id === bundle.id) : undefined
			isInGrid = Boolean(gridImage)
			c = bundle.id ? gridImage : this._canvases[0]
			if (isInGrid && !grid._insideGrid()) {
				this.current.set(this._canvases[0])
			}
		}
		if (!c) {
			if (this._canvases.length > 0) {
				const main = this._canvases[0]
				bundle.info.path = main._dataPath
				bundle.info.lang = this.lang
			}
			this._canvases.push((c = new MicrioImage(this._engine, bundle)))
		}

		if (opts.gallery) {
			opts.gallery._attach(c)
			this.gallery = opts.gallery
		}

		if (opts.startView) {
			c.state.view.set((bundle.settings.view = opts.startView))
			if (c._placed && c.engine.ready) {
				c.camera.setView(bundle.settings.view, { noRender: true })
			}
		}

		if (!this.lang) {
			this.lang = 'en'
		}

		if (!this._engine._book3d) {
			this._engine._load()
			if (!this._webgl.gl) {
				try {
					this._webgl._init()
				} catch (e) {
					this.#printError(e)
					return c
				}
			}
		}

		// ── Post-init ─────────────────────────────────────────────────────────

		if (!this.#initedFirst) {
			this.canvas.hook()

			switch (c.$settings?.theme) {
				case 'light': {
					this.dataset.lightMode = ''
					break
				}
				case 'os': {
					this.dataset.autoScheme = ''
					break
				}
			}

			this.#initedFirst = true
		}

		void tick().then(() => this.dispatchEvent(new CustomEvent('load', { detail: c })))

		// ── 360 vector ────────────────────────────────────────────────────────

		const e = this._engine
		e._direction = opts.vector?.direction ?? 0
		e._distanceX = opts.vector?.distanceX ?? 0
		e._distanceY = opts.vector?.distanceY ?? 0
		e._preventDirectionSet = !opts.vector

		// ── Set current / grid ────────────────────────────────────────────────

		if (isInGrid && (!opts.gridView || !grid?._current.find((img) => img.id === bundle.id))) {
			grid
				?.gridFocus(c, { view: bundle.settings?.view, transition: opts.transition })
				.then(() => {
					this.current.set(c)
				})
				// A grid focus whose transition is superseded or torn down rejects; swallow it
				.catch(() => {})
		} else {
			this.current.set(c)
		}

		if (c._noImage) {
			this._loading.set(false)
		}

		// Settings-level split screen (auto-open on load)
		if (c.$settings.micrioSplitLink && !c._noImage && !c.grid) {
			void tick().then(() => {
				const splitLink = c.$settings.micrioSplitLink
				if (this.$current !== c || !splitLink) {
					return
				}
				void openSplit(
					this,
					c,
					{ micrioId: splitLink },
					{
						isPassive: !c.$settings.noFollow,
					},
				)
			})
		}

		return c
	}

	/**
	 * Closes an opened MicrioImage and removes its canvas from the engine.
	 *
	 * The image stays in the element's list of loaded images, so opening it again (or making it
	 * `current` again) rebuilds its canvas. Closing an image that is not placed is a no-op.
	 * @param img The {@link MicrioImage} instance to close.
	 */
	close(img: MicrioImage): void {
		if (!img._placed) {
			return
		}
		this._engine._removeCanvas(img)
	}

	/**
	 * Parses HTML attributes of the `<micr-io>` element into a partial ImageInfo object.
	 * @internal
	 * @returns A partial {@link Models.ImageInfo.ImageInfo} object containing options derived from attributes.
	 */
	#getOptions(): Partial<Models.ImageInfo.ImageInfo> & { settings?: Partial<Models.ImageInfo.Settings> } {
		const sets: Partial<Models.ImageInfo.Settings> = {
			gallery: {}, // Initialize gallery settings object
		}

		const opts = {
			settings: sets as Models.ImageInfo.Settings,
			id: this.id, // Start with the element's ID
		}

		const process = (
			category: AttributeCategory,
			convert: (val: string | null, def: AttributeDef) => AttributeValue,
		): void => {
			for (const a of Object.keys(category)) {
				const d = category[a],
					val = this.getAttribute(a)
				const f = d.f || a.replace('data-', '')
				const v = convert(val, d)
				if (v !== undefined) {
					setObj(d.r ? opts : sets, f, v)
				}
			}
		}

		process(AO.STRINGS, (val) => val || undefined)
		process(AO.BOOLEANS, (val, o): boolean | undefined => {
			const tr = val !== undefined && (val === '' || val === 'true')
			if (tr || val === 'false') {
				return o.n ? !tr : tr
			}
			return undefined
		})
		process(AO.NUMBERS, (val, o): number | undefined => {
			let v: string | number | null = val
			if (o.dN !== undefined && v == null) {
				v = o.dN
			}
			if (v == null) {
				return undefined
			}
			const n = Number(v)
			return Number.isNaN(n) ? undefined : n
		})
		process(AO.ARRAYS, (val) => (val != null ? val.split(',').map(Number) : undefined))

		// Apply implications of 'static' setting
		if (sets.static) {
			sets.noUI = sets.skipMeta = true
			sets.hookEvents = false
		}

		return opts
	}

	/** Getter for the current language code. */
	get lang() {
		return get(this._lang)
	}
	/** Setter for the current language code. Triggers language change logic. */
	set lang(l: string) {
		this.setAttribute('lang', l)
	}
}
