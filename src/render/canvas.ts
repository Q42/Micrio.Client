import type { Writable } from '$core/store'
import type { Models } from '$types/models'
import type { HTMLMicrioElement } from '$core/element'
import type { Camera } from '$core/camera'

import { Browser } from '$utils/browser'
import { get, writable } from '$core/store'
import { createElement } from '$utils/dom'

/** An inline style value and its priority, used to restore temporary styles verbatim. @internal */
type StylePair = [value: string, priority: string]

/** The area of the canvas that an image covers, and the view reproducing it. @internal */
export interface ImageCrop {
	/** Horizontal offset in CSS pixels, relative to the canvas element. */
	left: number
	/** Vertical offset in CSS pixels, relative to the canvas element. */
	top: number
	/** Width in CSS pixels. */
	width: number
	/** Height in CSS pixels. */
	height: number
	/** The camera view (in image coordinates) that reproduces exactly this area. */
	view: Models.Camera.View
}

/**
 * Manages the HTML `<canvas>` element used for WebGL rendering,
 * handles resizing, and provides viewport information.
 * Accessed via `micrio.canvas`.
 */
export class Canvas {
	/** The main WebGL rendering `<canvas>` element. */
	readonly element: HTMLCanvasElement = createElement('canvas')

	/** ResizeObserver instance for detecting element resize events.
	 * @internal
	 * @readonly
	 */
	#resizeObserver?: ResizeObserver

	/** Bound form of {@link onresize}, so the same reference can be added and removed as a listener. @internal */
	#onResize = () => {
		this.onresize()
	}

	/** Saved inline box styles, used to restore the canvas after a temporary crop. @internal */
	#savedBox?: { left: StylePair; top: StylePair; width: StylePair; height: StylePair }

	/**
	 * True while the canvas is temporarily sized to the area the image covers, so that the
	 * browser's native context menu "Copy image" action copies only the image itself
	 * instead of the full canvas with its transparent padding.
	 */
	#cropMode = false

	/** Object containing current viewport dimensions, position, and ratios. */
	readonly viewport: Models.Canvas.ViewRect = {
		width: 0, // Rendered width in CSS pixels
		height: 0, // Rendered height in CSS pixels
		left: 0, // Left offset relative to viewport
		top: 0, // Top offset relative to viewport
		ratio: 0, // Device pixel ratio used for rendering buffer
		scale: 0, // CSS scale factor applied to the element (if any)
		portrait: false, // Is the viewport currently in portrait orientation?
	}

	/** Writable store indicating if the client is likely a mobile device. */
	readonly isMobile: Writable<boolean> = writable<boolean>(false)

	/** Getter for the current value of the {@link isMobile} store. */
	get $isMobile(): boolean {
		return get(this.isMobile)
	}

	/**
	 * Creates a Canvas controller instance.
	 * @param micrio The main HTMLMicrioElement instance.
	 */
	#micrio: HTMLMicrioElement

	constructor(micrio: HTMLMicrioElement) {
		this.#micrio = micrio
		this.element.className = 'micrio'
		// Use ResizeObserver if available for more reliable resize detection
		if (globalThis.ResizeObserver !== undefined) {
			this.#resizeObserver = new globalThis.ResizeObserver(this.#onResize)
		}
	}

	/**
	 * Inserts the `<canvas>` element into the DOM within the `<micr-io>` element.
	 * @internal
	 */
	place() {
		if (this.element.parentNode) {
			return
		} // Already placed
		// Insert after the preview image if it exists, otherwise as the first child
		const img = this.#micrio.querySelector('img.preview')
		this.#micrio.insertBefore(this.element, img ? img.nextSibling : this.#micrio.firstChild)
	}

	/**
	 * Hooks up resize event listeners (ResizeObserver or window resize).
	 * @internal
	 */
	hook(): void {
		this.onresize() // Initial resize calculation

		// Attach appropriate listener
		if (this.#resizeObserver) {
			this.#resizeObserver.observe(this.element)
		} else {
			window.addEventListener('resize', this.#onResize)
		}
	}

	/**
	 * Unhooks resize event listeners.
	 * @internal
	 */
	unhook(): void {
		if (this.#resizeObserver) {
			this.#resizeObserver.unobserve(this.element)
		} else {
			window.removeEventListener('resize', this.#onResize)
		}
	}

	/**
	 * Resize event handler. Calculates new viewport dimensions, updates the canvas buffer size,
	 * notifies WebGL and engine controllers, and dispatches a 'resize' event.
	 * @internal
	 */
	onresize(): void {
		// Get current rendered dimensions and position
		const box = this.element.getBoundingClientRect()

		let { width } = box
		let { height } = box

		// Exit if element has no dimensions (e.g., display: none)
		if (!width || !height) {
			return
		}

		// Account for potential CSS transforms affecting getBoundingClientRect
		const st = globalThis.getComputedStyle(this.element)
		const originalW = Number.parseFloat(st.width)
		// Adjust height based on width ratio if transform applied
		if (!Number.isNaN(originalW)) {
			height = (Number.parseFloat(st.height) * width) / Math.max(1, originalW)
		}

		// Calculate CSS scale factor (relevant if micr-io element itself is scaled)
		// Assume scale 1 for static images to avoid issues?
		// A temporary crop resizes the canvas on purpose, so it must keep the scale it had
		// instead of being mistaken for a CSS scale on the host element.
		const { offsetWidth } = this.#micrio
		let scale = Math.floor(width) / offsetWidth
		if (Object.hasOwn(this.#micrio.dataset, 'static') || !offsetWidth) {
			scale = 1
		} else if (this.#cropMode) {
			scale = this.viewport.scale || 1
		}
		// Adjust dimensions based on scale
		width /= scale
		height /= scale

		// Get device pixel ratio for high-resolution rendering
		const ratio = scale !== 1 ? 1 : this.getRatio() // Use ratio 1 if CSS scaled

		const c = this.viewport // Reference to viewport state object
		// Exit if dimensions and ratio haven't changed
		if (c.width === width && c.height === height && c.ratio === ratio && c.scale === scale) {
			return
		}

		// Update viewport state object
		c.width = width
		c.height = height
		c.ratio = ratio
		c.scale = scale
		c.top = box.top
		c.left = box.left
		c.portrait = globalThis.matchMedia('(orientation: portrait)')?.matches ?? height > width // Check orientation

		// Update canvas buffer dimensions
		if (this.#micrio._webgl.gl) {
			this.element.width = width * ratio
			this.element.height = height * ratio
			// Update WebGL viewport
			this.#micrio._webgl.gl.viewport(0, 0, c.width * c.ratio, c.height * c.ratio)
			// Resize postprocessing framebuffer if active
			this.#micrio._webgl._postprocessor?._resize()

			// Notify engine of resize
			this.#micrio._engine._resize(c)
		}

		// Dispatch 'resize' event with bounding box info
		// (suppressed for the temporary context menu crop, which is not a real resize)
		if (!this.#cropMode) {
			this.#micrio.events._dispatch('resize', box)
		}

		// Update mobile flag (only when it actually changed)
		const mobile = /mobile/i.test(navigator.userAgent)
		if (mobile !== this.$isMobile) {
			this.isMobile.set(mobile)
		}
	}

	/**
	 * Gets the appropriate device pixel ratio for rendering.
	 * Clamped between 1 and 2, disabled on iOS and if `noRetina` setting is true.
	 * @param s Optional image settings object to check for `noRetina`.
	 * @returns The calculated device pixel ratio.
	 */
	getRatio = (s: Partial<Models.ImageInfo.Settings> = this.#micrio.$current?.$settings ?? {}): number =>
		(!Browser.iOS &&
			!s?.noRetina && // Check conditions
			globalThis.devicePixelRatio &&
			Math.max(1, Math.min(2, globalThis.devicePixelRatio))) || // Get ratio and clamp
		1 // Default to 1

	/**
	 * Calculates the area of the canvas that the given camera's image actually covers, in
	 * CSS pixels relative to the canvas element, plus the camera view that reproduces
	 * exactly that area.
	 *
	 * This is purely geometric: as soon as any edge of the image's drawn rectangle falls
	 * inside the canvas rectangle, the image does not fill the canvas and there is
	 * something to crop - whether that is because the image is zoomed out, or because it
	 * is zoomed in past one axis while still leaving a margin on the other.
	 *
	 * Returns `undefined` when the image is not (meaningfully) on screen, or when it
	 * already covers the entire canvas.
	 * @param camera The camera of the image to measure.
	 * @internal
	 */
	_imageCrop(camera: Camera): ImageCrop | undefined {
		// Unscaled CSS pixels, matching what the camera reports (and unaffected by any CSS
		// transform on the micr-io element, which the viewport already compensates for)
		const h = this.viewport.height,
			w = this.viewport.width
		if (!w || !h) {
			return undefined
		}

		// Image corners in canvas-element-relative CSS pixels
		const [ix0, iy0] = camera.getXY(0, 0)
		const [ix1, iy1] = camera.getXY(1, 1)

		// The part of the image that falls within the canvas
		const left = Math.max(0, Math.min(ix0, ix1))
		const top = Math.max(0, Math.min(iy0, iy1))
		const right = Math.min(w, Math.max(ix0, ix1))
		const bottom = Math.min(h, Math.max(iy0, iy1))

		const width = right - left
		const height = bottom - top

		if (width < 1 || height < 1) {
			return undefined
		} // Image not (or barely) on screen
		// Nothing to crop when the image already covers the whole canvas
		if (left <= 0.5 && top <= 0.5 && right >= w - 0.5 && bottom >= h - 0.5) {
			return undefined
		}

		// The image coordinates of this region, so the cropped rendering is identical
		const [vx0, vy0] = camera.getCoo(left, top, false, true)
		const [vx1, vy1] = camera.getCoo(right, bottom, false, true)

		return { left, top, width, height, view: [vx0, vy0, vx1 - vx0, vy1 - vy0] }
	}

	/**
	 * Temporarily sizes the canvas element to the given area, so that the browser's native
	 * context menu "Copy image" item copies only that area instead of the full canvas.
	 * Reverts with {@link _exitCropMode}.
	 *
	 * While active, the CSS scale compensation in {@link onresize} is left untouched so the
	 * drawing buffer matches the cropped area at the same pixel density as before.
	 * @param crop The area to crop to, relative to the canvas element.
	 * @internal
	 */
	_enterCropMode(crop: ImageCrop): void {
		if (this.#cropMode) {
			return
		}
		const el = this.element
		const st = el.style
		this.#savedBox = {
			left: [st.getPropertyValue('left'), st.getPropertyPriority('left')],
			top: [st.getPropertyValue('top'), st.getPropertyPriority('top')],
			width: [st.getPropertyValue('width'), st.getPropertyPriority('width')],
			height: [st.getPropertyValue('height'), st.getPropertyPriority('height')],
		}
		// The stylesheet sizes the canvas using `!important`, so the inline values need it too
		st.setProperty('left', `${el.offsetLeft + crop.left}px`, 'important')
		st.setProperty('top', `${el.offsetTop + crop.top}px`, 'important')
		st.setProperty('width', `${crop.width}px`, 'important')
		st.setProperty('height', `${crop.height}px`, 'important')
		this.#cropMode = true
		this.onresize()
	}

	/**
	 * Restores the canvas element's original box after {@link _enterCropMode}.
	 * Does nothing when the canvas is not in crop mode.
	 * @internal
	 */
	_exitCropMode(): void {
		if (!this.#cropMode) {
			return
		}
		const saved = this.#savedBox
		const st = this.element.style
		this.#savedBox = undefined
		if (saved) {
			for (const k of ['left', 'top', 'width', 'height'] as const) {
				const [value, priority] = saved[k]
				if (value) {
					st.setProperty(k, value, priority)
				} else {
					st.removeProperty(k)
				}
			}
		}
		this.#cropMode = false
		this.onresize()
	}

	/**
	 * Sets virtual offset margins in the engine controller.
	 * This likely affects how viewports are calculated or limited.
	 * @param width The horizontal offset margin in pixels.
	 * @param height The vertical offset margin in pixels.
	 */
	setMargins(width: number, height: number): void {
		if (!this.#micrio._engine.ready) {
			return
		}
		this.#micrio._engine.el._areaWidth = width
		this.#micrio._engine.el._areaHeight = height
	}
}
