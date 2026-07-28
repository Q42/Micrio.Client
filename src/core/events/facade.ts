import type { HTMLMicrioElement } from '$core/element';
import type { Models } from '$types/models';
import type { MicrioImage } from '$core/image';

import { Browser } from '$utils/browser';
import { get, writable, type Writable } from '$core/store';

import { DragHandler } from './drag';
import { PinchHandler } from './pinch';
import { PointerPinchHandler } from './pointer-pinch';
import { GestureHandler } from './gesture';
import { WheelHandler } from './wheel';
import { KeyboardHandler } from './keyboard';
import { DoubleTapHandler } from './doubletap';
import {
	type EventContext,
	type EventStateVars,
} from './shared';

/**
 * Handles user input events (mouse, touch, keyboard, wheel, gestures) for the Micrio viewer.
 * Translates browser events into camera movements (pan, zoom), dispatches custom Micrio events,
 * and manages interaction states like panning, pinching, and enabled/disabled states.
 * Accessed via `micrio.events`.
 * @author Marcel Duin <marcel@micr.io>
 */
export class Events implements EventContext {

	/** @internal The Micrio `<canvas>` element where most events are captured. */
	_el: HTMLCanvasElement;

	/** Writable store indicating if event handling is currently enabled. Set to false during tours or animations. */
	enabled: Writable<boolean> = writable(false);

	/** Getter for the current value of the {@link enabled} store. */
	get $enabled(): boolean { return get(this.enabled) };

	/** Flag indicating if the main event listeners are currently attached. */
	#hooked: boolean = false;

	/** @internal Flag indicating if the user is currently panning (dragging). */
	_panning: boolean = false;

	/** @internal Flag indicating if the user is currently pinching. */
	_pinching: boolean = false;

	/** @internal Flag indicating if the user is currently zooming via mouse wheel. */
	_wheeling: boolean = false;

	/** @internal Flag indicating if Ctrl/Cmd key is required for mouse wheel zoom. */
	_controlZoom: boolean = false;

	/** @internal Flag indicating if two fingers are required for touch panning. */
	_twoFingerPan: boolean = false;

	/** @internal Stores the previous scale during pinch gestures for calculating zoom delta. */
	_pScale: number = 1;

	/** @internal Flag indicating if the browser supports touch events. */
	_hasTouch: boolean = Browser.hasTouch && ('ontouchstart' in self);

	/** @internal Flag indicating if the user has explicitly used Ctrl/Cmd + wheel for zooming (differentiates from trackpad pinch). */
	_hasUsedCtrl: boolean = false;

	/** Cached settings object from the first loaded image. */
	#settings: Models.ImageInfo.Settings | undefined;

	/** Array of currently visible MicrioImage instances. */
	#visible: MicrioImage[] | undefined;

	/** @internal Internal state variables for managing complex interactions like drag, pinch, double-tap. */
	_vars: EventStateVars = {
		_drag: { _prev: undefined, _start: [0, 0, 0], _image: undefined },
		_dbltap: { _lastTapped: 0 },
		_pinch: { _image: undefined, _sDst: 0, _wasPanning: false },
	};

	/** @internal Current pinch zoom factor relative to the start of the pinch. Undefined when not pinching. */
	_pinchFactor: number | undefined;

	/** @internal Map tracking active pointers for multi-touch pinch detection (pointer ID -> coordinates). */
	_activePointers: Map<number, { x: number, y: number }> = new Map();

	/** @internal Stores the ID of the pointer currently captured for dragging. */
	_capturedPointerId: number | undefined;

	/** @internal The main HTMLMicrioElement instance. */
	_micrio: HTMLMicrioElement;

	// Handler modules
	#dragHandler: DragHandler;
	#pinchHandler: PinchHandler;
	#pointerPinchHandler: PointerPinchHandler;
	#gestureHandler: GestureHandler;
	#wheelHandler: WheelHandler;
	#keyboardHandler: KeyboardHandler;
	#doubleTapHandler: DoubleTapHandler;

	/**
	 * The Events constructor.
	 * @param micrio The main HTMLMicrioElement instance.
	 */
	constructor(
		micrio: HTMLMicrioElement,
	) {
		this._micrio = micrio;
		this._el = micrio.canvas.element;

		// Initialize handler modules
		this.#dragHandler = new DragHandler(this);
		this.#pinchHandler = new PinchHandler(this, this.#dragHandler);
		this.#pointerPinchHandler = new PointerPinchHandler(this, this.#dragHandler);
		this.#gestureHandler = new GestureHandler(this);
		this.#wheelHandler = new WheelHandler(this);
		this.#keyboardHandler = new KeyboardHandler(this);
		this.#doubleTapHandler = new DoubleTapHandler(this);

		// Subscribe to the enabled store to automatically hook/unhook listeners
		this.enabled.subscribe(v => {
			if (v) this.hook();
			else this.unhook();
		});

		// Keep track of visible images
		micrio._visible.subscribe(v => this.#visible = v);

		// Get settings from the first loaded image and enable events if configured
		micrio.current.subscribe(c => {
			if (c && !this.#settings) {
				this.#settings = c.$settings as Models.ImageInfo.Settings;
				if (!c.error && this.#settings.hookEvents) this.enabled.set(true);
			}
		});
	}

	// --- EventContext implementation ---

	/** @internal */
	_isEnabled(): boolean { return this.$enabled; }

	/**
	 * Checks if the user is currently interacting with the map via panning, pinching, or wheeling.
	 * @returns True if the user is actively navigating.
	*/
	get isNavigating(): boolean { return this._panning || this._pinching || this._wheeling; }

	/**
	 * @internal Dispatches a custom event on the main `<micr-io>` element.
	 * @param type The event type string.
	 * @param detail Optional event detail payload.
	 */
	_dispatch<K extends string & keyof Models.MicrioEventDetails>(type: K, detail?: Models.MicrioEventDetails[K]): void {
		this._micrio.dispatchEvent(new CustomEvent(type, detail !== undefined ? { detail } : undefined))
	}

	/**
	 * @internal Determines which MicrioImage instance is under the given screen coordinates.
	 * @param c Screen coordinates {x, y}.
	 * @returns The MicrioImage instance under the coordinates, or the main current image as fallback.
	 */
	_getImage(c: { x: number, y: number }): MicrioImage | undefined {
		if (!this.#visible) return;
		const w = this._micrio.offsetWidth, h = this._micrio.offsetHeight,
			x = Math.max(0, Math.min(1, c.x / w)), y = Math.max(0, Math.min(1, c.y / h));
		const candidates = this.#visible.filter(i => !i._noImage && !i._isPassiveSecondary);
		// When a grid controller exists, use its own image-under-cursor detection
		const gridCtrl = this._micrio._canvases.find(i => i.grid);
		if (gridCtrl) return gridCtrl.grid?._getImageAt(c.x, c.y) ?? this._micrio.$current;
		// Default: find the visible image under the cursor by area
		const t = candidates.length == 1 ? candidates[0] : candidates.find(({ grid, opts: { area } }) =>
			grid ? false : area ? x >= area[0] && x <= area[0] + area[2] && y >= area[1] && y <= area[1] + area[3] : false
		);
		return t && !t.grid ? t : this._micrio.$current;
	}

	/** @internal */
	_getVisible(): MicrioImage[] | undefined { return this.#visible; }

	/** Hooks all necessary event listeners based on current settings. */
	hook(): void {
		if (this.#hooked) return;
		this.#hooked = true;

		const s = this.#settings;
		if (!s) return;

		// Apply settings
		this._twoFingerPan = !!s.twoFingerPan;
		if (this._twoFingerPan) this._micrio.setAttribute('data-can-pan', '');
		else this._micrio.removeAttribute('data-can-pan');

		// Hook specific event types based on settings
		if (s?.hookKeys) this.hookKeys();
		if (s.hookDrag) this.hookDrag();
		if (!s.noZoom) this.hookZoom();
	}

	/** Unhooks all attached event listeners. */
	unhook(): void {
		if (!this.#hooked) return;
		this.#hooked = false;

		// Clear pointer tracking state
		this._activePointers.clear();

		// Unhook specific event types
		this.unhookDrag();
		this.unhookZoom();
		this.unhookKeys();
	}

	/** Hooks keyboard event listeners. */
	hookKeys(): void { this.#keyboardHandler.hook(); }

	/** Unhooks keyboard event listeners. */
	unhookKeys(): void { this.#keyboardHandler.unhook(); }

	/** Hooks zoom-related event listeners (pinch, scroll, double-tap/click). */
	hookZoom(): void {
		const s = this.#settings;
		this._controlZoom = !!s?.controlZoom;
		if (!s || s.hookPinch) this.hookPinch();
		if (!s || s.hookScroll || this._controlZoom) this.hookScroll();
		// Add double-tap/click listeners
		if (this._micrio.canvas.$isMobile) this.#doubleTapHandler.hookTap();
		else this.#doubleTapHandler.hookClick();
	}

	/** Unhooks zoom-related event listeners. */
	unhookZoom(): void {
		this.unhookPinch();
		this.unhookScroll();
		if (this._micrio.canvas.$isMobile) this.#doubleTapHandler.unhookTap();
		else this.#doubleTapHandler.unhookClick();
	}

	/** Flag indicating if scroll listeners are attached. */
	get scrollHooked(): boolean { return this.#wheelHandler.hooked; }

	/** Hooks mouse wheel/scroll event listeners. */
	hookScroll(): void { this.#wheelHandler.hook(); }

	/** Unhooks mouse wheel/scroll event listeners. */
	unhookScroll(): void { this.#wheelHandler.unhook(); }

	/** Hooks touch pinch and macOS gesture event listeners. */
	hookPinch(): void {
		// Use touch events on iOS (most reliable there), pointer events everywhere else
		if (Browser.iOS && this._hasTouch) {
			this.#pinchHandler.hook();
		} else {
			this.#pointerPinchHandler.hook();
		}
		this.#gestureHandler.hook();
	}

	/** Unhooks touch pinch and macOS gesture event listeners. */
	unhookPinch(): void {
		if (Browser.iOS && this._hasTouch) {
			this.#pinchHandler.unhook();
		} else {
			this.#pointerPinchHandler.unhook();
		}
		this.#gestureHandler.unhook();
	}

	/** Hooks pointer down/move/up listeners for drag panning. */
	hookDrag(): void { this.#dragHandler.hook(); }

	/** Unhooks pointer listeners for drag panning. */
	unhookDrag(): void { this.#dragHandler.unhook(); }

}
