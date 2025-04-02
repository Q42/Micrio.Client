import type { Writable } from 'svelte/store';
import type { Models } from '../types/models';
import type { HTMLMicrioElement } from './element';

import { Browser } from './utils';
import { get, writable } from 'svelte/store';

/**
 * Manages the HTML `<canvas>` element used for WebGL rendering,
 * handles resizing, and provides viewport information.
 * Accessed via `micrio.canvas`.
 */
export class Canvas {
	/** The main WebGL rendering `<canvas>` element. */
	readonly element:HTMLCanvasElement = document.createElement('canvas');

	/** ResizeObserver instance for detecting element resize events.
	 * @internal
	 * @readonly
	*/
	private resizeObserver?:ResizeObserver;

	/** Flag indicating if a resize operation is currently in progress.
	 * @internal
	*/
	resizing:boolean = false;

	/** Flag indicating if 360 content has been displayed, requiring perspective CSS.
	 * @internal
	*/
	private hasPerspective:boolean = false;

	/** Object containing current viewport dimensions, position, and ratios. */
	readonly viewport:Models.Canvas.ViewRect = {
		width:0, // Rendered width in CSS pixels
		height:0, // Rendered height in CSS pixels
		left:0, // Left offset relative to viewport
		top:0, // Top offset relative to viewport
		ratio:0, // Device pixel ratio used for rendering buffer
		scale:0, // CSS scale factor applied to the element (if any)
		portrait:false // Is the viewport currently in portrait orientation?
	};

	/** Writable Svelte store indicating if the client is likely a mobile device. */
	readonly isMobile:Writable<boolean> = writable<boolean>(false);

	/** Getter for the current value of the {@link isMobile} store. */
	get $isMobile():boolean { return get(this.isMobile) };

	/**
	 * Creates a Canvas controller instance.
	 * @param micrio The main HTMLMicrioElement instance.
	 */
	constructor(private micrio:HTMLMicrioElement) {
		this.onresize = this.onresize.bind(this); // Bind resize handler
		// Use ResizeObserver if available for more reliable resize detection
		if(self.ResizeObserver) this.resizeObserver = new self.ResizeObserver(this.onresize);
		this.element.className = 'micrio'; // Add class for potential styling
	}

	/**
	 * Inserts the `<canvas>` element into the DOM within the `<micr-io>` element.
	 * @internal
	*/
	place(){
		if(this.element.parentNode) return; // Already placed
		// Insert after the preview image if it exists, otherwise as the first child
		const img = this.micrio.querySelector('img.preview');
		this.micrio.insertBefore(this.element,img ? img.nextSibling : this.micrio.firstChild);
	}

	/**
	 * Hooks up resize event listeners (ResizeObserver or window resize).
	 * @internal
	*/
	hook() : void {
		this.onresize(); // Initial resize calculation

		// Attach appropriate listener
		if(this.resizeObserver) this.resizeObserver.observe(this.element);
		else window.addEventListener('resize', this.onresize);
	}

	/**
	 * Unhooks resize event listeners.
	 * @internal
	*/
	unhook() : void {
		if(this.resizeObserver) this.resizeObserver.unobserve(this.element);
		else window.removeEventListener('resize', this.onresize);
	}

	/**
	 * Resize event handler. Calculates new viewport dimensions, updates the canvas buffer size,
	 * notifies WebGL and Wasm controllers, and dispatches a 'resize' event.
	 * @internal
	 */
	onresize() : void {
		/** @ts-ignore Check if presenting in VR - If in VR, don't resize based on window */
		// TODO: Re-evaluate if this VR check is still necessary or correctly implemented.
		// if(this.micrio.webgl.display?.['isPresenting']) return;

		// Get current rendered dimensions and position
		const box = this.element.getBoundingClientRect();

		// Track if 360 content has ever been loaded to apply perspective CSS
		if(this.micrio.$current?.is360) this.hasPerspective = true;

		let width = box.width;
		let height = box.height;

		// Exit if element has no dimensions (e.g., display: none)
		if(!width || !height) return;

		// Account for potential CSS transforms affecting getBoundingClientRect
		const st = self.getComputedStyle(this.element);
		const originalW = parseFloat(st.width);
		// Adjust height based on width ratio if transform applied
		if(!isNaN(originalW)) {
			height = parseFloat(st.height) * width / Math.max(1, originalW);
		}

		// Calculate CSS scale factor (relevant if micr-io element itself is scaled)
		// Assume scale 1 for static images to avoid issues?
		const scale = this.micrio.hasAttribute('data-static') ? 1 : Math.floor(width) / this.micrio.offsetWidth;
		// Adjust dimensions based on scale
		width /= scale;
		height /= scale;

		// Get device pixel ratio for high-resolution rendering
		const ratio = scale != 1 ? 1 : this.getRatio(); // Use ratio 1 if CSS scaled

		const c = this.viewport; // Reference to viewport state object
		// Exit if dimensions and ratio haven't changed
		if(c.width == width && c.height == height && c.ratio == ratio && c.scale == scale) return;

		// Apply perspective CSS if 360 content has been shown
		if(this.hasPerspective) this.micrio.style.perspective = height / 2 + 'px';

		// Update viewport state object
		c.width = width;
		c.height = height;
		c.ratio = ratio;
		c.scale = scale;
		c.top = box.top;
		c.left = box.left;
		c.portrait = window.matchMedia('(orientation: portrait)')?.matches ?? (height > width); // Check orientation

		this.resizing = true; // Set resizing flag
		// Update canvas buffer dimensions
		this.element.width = width * ratio;
		this.element.height = height * ratio;
		// Update WebGL viewport
		this.micrio.webgl.gl.viewport(0, 0, c.width*c.ratio, c.height*c.ratio);
		// Resize postprocessing framebuffer if active
		this.micrio.webgl.postpocessor?.resize();

		// Notify Wasm of resize
		this.micrio.wasm.resize(c);
		this.resizing = false; // Clear resizing flag

		// Dispatch 'resize' event with bounding box info
		this.micrio.events.dispatch('resize', box);

		// Update mobile flag (debounced slightly)
		// TODO: Consider if userAgent check is reliable enough or if width check is better.
		setTimeout(() => this.isMobile.set(/mobile/i.test(navigator.userAgent)), 10);
	}

	/**
	 * Gets the appropriate device pixel ratio for rendering.
	 * Clamped between 1 and 2, disabled on iOS and if `noRetina` setting is true.
	 * @param s Optional image settings object to check for `noRetina`.
	 * @returns The calculated device pixel ratio.
	 */
	public getRatio = (s:Partial<Models.ImageInfo.Settings> = this.micrio.$current?.$settings ?? {}) : number => !Browser.iOS && !s?.noRetina // Check conditions
		&& self.devicePixelRatio && Math.max(1, Math.min(2, self.devicePixelRatio)) // Get ratio and clamp
		|| 1; // Default to 1

	/**
	 * Sets virtual offset margins in the Wasm controller.
	 * This likely affects how viewports are calculated or limited.
	 * @param width The horizontal offset margin in pixels.
	 * @param height The vertical offset margin in pixels.
	*/
	public setMargins(width:number, height:number) : void {
		if (!this.micrio.wasm.e) return; // Ensure Wasm is ready
		this.micrio.wasm.e.setArea(this.micrio.wasm.getPtr(), width, height);
	}

}
