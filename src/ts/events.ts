import type { HTMLMicrioElement } from './element';
import type { Models } from '../types/models';
import type { MicrioImage } from './image';

import { Browser, once } from './utils';
import { get, writable, type Writable } from 'svelte/store';

import {
	DragHandler,
	PinchHandler,
	PointerPinchHandler,
	GestureHandler,
	WheelHandler,
	KeyboardHandler,
	DoubleTapHandler,
	UpdateHandler,
	type EventContext,
	type EventStateVars,
} from './events/index';

// Re-export UpdateEvents for backwards compatibility
export { UpdateEvents } from './events/index';

/**
 * Handles user input events (mouse, touch, keyboard, wheel, gestures) for the Micrio viewer.
 * Translates browser events into camera movements (pan, zoom), dispatches custom Micrio events,
 * and manages interaction states like panning, pinching, and enabled/disabled states.
 * Accessed via `micrio.events`.
 * @author Marcel Duin <marcel@micr.io>
 */
export class Events implements EventContext {

	/** The Micrio `<canvas>` element where most events are captured.
	 * @internal
	*/
	el: HTMLCanvasElement;

	/** Writable Svelte store indicating if event handling is currently enabled. Set to false during tours or animations. */
	enabled: Writable<boolean> = writable(false);

	/** Getter for the current value of the {@link enabled} store. */
	get $enabled(): boolean { return get(this.enabled) };

	/** Flag indicating if the main event listeners are currently attached.
	 * @internal
	*/
	private hooked: boolean = false;

	/** Flag indicating if the user is currently panning (dragging).
	 * @internal
	*/
	private panning: boolean = false;

	/** Flag indicating if the user is currently pinching.
	 * @internal
	*/
	private pinching: boolean = false;

	/** Flag indicating if a click event originated from outside the core interaction (e.g., UI button).
	 * Used to potentially differentiate UI clicks from map clicks.
	 * @internal
	*/
	clicked: boolean = false;

	/** Flag indicating if the user is currently zooming via mouse wheel.
	 * @internal
	*/
	private wheeling: boolean = false;

	/** Flag indicating if Ctrl/Cmd key is required for mouse wheel zoom.
	 * @internal
	*/
	private controlZoom: boolean = false;

	/** Flag indicating if two fingers are required for touch panning.
	 * @internal
	*/
	private twoFingerPan: boolean = false;

	/** Stores the previous scale during pinch gestures for calculating zoom delta.
	 * @internal
	*/
	pScale: number = 1;

	/** Flag indicating if the browser supports touch events.
	 * @internal
	*/
	hasTouch: boolean = Browser.hasTouch && ('ontouchstart' in self);

	/** Flag indicating if the user has explicitly used Ctrl/Cmd + wheel for zooming (differentiates from trackpad pinch).
	 * @internal
	*/
	hasUsedCtrl: boolean = false;

	/** Cached settings object from the first loaded image.
	 * @internal
	*/
	private settings: Models.ImageInfo.Settings | undefined;

	/** Array of currently visible MicrioImage instances.
	 * @internal
	*/
	private visible: MicrioImage[] | undefined;

	/** Internal state variables for managing complex interactions like drag, pinch, double-tap.
	 * @internal
	*/
	vars: EventStateVars = {
		drag: { prev: undefined, start: [0, 0, 0] },
		dbltap: { lastTapped: 0 },
		pinch: { image: undefined, sDst: 0, wasPanning: false },
		updates: { to: -1, stack: [] }
	};

	/** Current pinch zoom factor relative to the start of the pinch. Undefined when not pinching. */
	pinchFactor: number | undefined;

	/** Map tracking active pointers for multi-touch pinch detection (pointer ID -> coordinates).
	 * @internal
	 */
	activePointers: Map<number, { x: number, y: number }> = new Map();

	/** Stores the ID of the pointer currently captured for dragging. @internal */
	capturedPointerId: number | undefined;

	// Handler modules
	private dragHandler: DragHandler;
	private pinchHandler: PinchHandler;
	private pointerPinchHandler: PointerPinchHandler;
	private gestureHandler: GestureHandler;
	private wheelHandler: WheelHandler;
	private keyboardHandler: KeyboardHandler;
	private doubleTapHandler: DoubleTapHandler;
	private updateHandler: UpdateHandler;

	/**
	 * The Events constructor.
	 * @param micrio The main HTMLMicrioElement instance.
	 * @internal
	 */
	constructor(
		/** @internal */
		public micrio: HTMLMicrioElement,
	) {
		this.el = micrio.canvas.element;

		// Initialize handler modules
		this.dragHandler = new DragHandler(this);
		this.pinchHandler = new PinchHandler(this, this.dragHandler);
		this.pointerPinchHandler = new PointerPinchHandler(this, this.dragHandler);
		this.gestureHandler = new GestureHandler(this);
		this.wheelHandler = new WheelHandler(this);
		this.keyboardHandler = new KeyboardHandler(this);
		this.doubleTapHandler = new DoubleTapHandler(this);
		this.updateHandler = new UpdateHandler(this);

		// Subscribe to the enabled store to automatically hook/unhook listeners
		this.enabled.subscribe(v => {
			if (v) this.hook();
			else this.unhook();
		});

		// Keep track of visible images
		micrio.visible.subscribe(v => this.visible = v);

		// Get settings from the first loaded image and enable events if configured
		micrio.current.subscribe(c => {
			if (c && !this.settings) once(c.info).then(info => {
				if (!info) return;
				this.settings = c.$settings as Models.ImageInfo.Settings;
				if (!c.error && this.settings.hookEvents) this.enabled.set(true);
			})
		});
	}

	// --- EventContext implementation ---

	isEnabled(): boolean { return this.$enabled; }
	isPanning(): boolean { return this.panning; }
	isPinching(): boolean { return this.pinching; }
	setPanning(value: boolean): void { this.panning = value; }
	setPinching(value: boolean): void { this.pinching = value; }
	isWheeling(): boolean { return this.wheeling; }
	setWheeling(value: boolean): void { this.wheeling = value; }
	isControlZoom(): boolean { return this.controlZoom; }
	isTwoFingerPan(): boolean { return this.twoFingerPan; }
	getVisible(): MicrioImage[] | undefined { return this.visible; }
	setCapturedPointerId(id: number | undefined): void { this.capturedPointerId = id; }
	setPinchFactor(value: number | undefined): void { this.pinchFactor = value; }
	setPScale(value: number): void { this.pScale = value; }
	setHasUsedCtrl(value: boolean): void { this.hasUsedCtrl = value; }

	/**
	 * Checks if the user is currently interacting with the map via panning, pinching, or wheeling.
	 * @returns True if the user is actively navigating.
	*/
	get isNavigating(): boolean { return this.panning || this.pinching || this.wheeling || this.clicked; }

	/**
	 * Dispatches a custom event on the main `<micr-io>` element.
	 * @internal
	 * @param type The event type string.
	 * @param detail Optional event detail payload.
	 */
	dispatch<K extends keyof Models.MicrioEventDetails>(type: K, detail?: Models.MicrioEventDetails[K]): void {
		this.micrio.dispatchEvent(new CustomEvent(type, detail !== undefined ? { detail } : undefined))
	}

	/**
	 * Determines which MicrioImage instance is under the given screen coordinates.
	 * Handles split-screen layouts.
	 * @internal
	 * @param c Screen coordinates {x, y}.
	 * @returns The MicrioImage instance under the coordinates, or the main current image as fallback.
	 */
	getImage(c: { x: number, y: number }): MicrioImage | undefined {
		if (!this.visible) return;
		const w = this.micrio.offsetWidth, h = this.micrio.offsetHeight,
			x = Math.max(0, Math.min(1, c.x / w)), y = Math.max(0, Math.min(1, c.y / h));
		const hasSplitScreen = this.visible?.find(i => !!i.opts.secondaryTo);
		const t = this.visible.length == 1 ? this.visible[0] : this.visible.find(({ grid, opts: { area } }) =>
			hasSplitScreen && grid ? false : area ? x >= area[0] && x <= area[2] && y >= area[1] && y <= area[3] : false
		);
		if (t && t.opts.secondaryTo && t.opts.isPassive && t.opts.area) {
			c.x -= t.opts.area[0] * w;
			c.y -= t.opts.area[1] * h;
		}
		return t && !t.grid && (!t.opts.secondaryTo || !t.opts.isPassive) ? t : this.micrio.$current;
	}

	/** Hooks all necessary event listeners based on current settings. */
	public hook(): void {
		if (this.hooked) return;
		this.hooked = true;

		const s = this.settings;
		if (!s) return;

		// Apply settings
		this.twoFingerPan = !!s.twoFingerPan;
		if (this.twoFingerPan) this.micrio.setAttribute('data-can-pan', '');
		else this.micrio.removeAttribute('data-can-pan');

		// Hook specific event types based on settings
		if (s?.hookKeys) this.hookKeys();
		if (s.hookDrag) this.hookDrag();
		if (!s.noZoom) this.hookZoom();

		this.hookUpdate();
	}

	/** Unhooks all attached event listeners. */
	public unhook(): void {
		if (!this.hooked) return;
		this.hooked = false;

		// Clear pointer tracking state
		this.activePointers.clear();

		// Unhook specific event types
		this.unhookDrag();
		this.unhookZoom();
		this.unhookKeys();
		this.unhookUpdate();
	}

	/** Hooks keyboard event listeners. */
	public hookKeys(): void { this.keyboardHandler.hook(); }

	/** Unhooks keyboard event listeners. */
	public unhookKeys(): void { this.keyboardHandler.unhook(); }

	/** Hooks zoom-related event listeners (pinch, scroll, double-tap/click). */
	public hookZoom(): void {
		const s = this.settings;
		this.controlZoom = !!s?.controlZoom;
		if (!s || s.hookPinch) this.hookPinch();
		if (!s || s.hookScroll || this.controlZoom) this.hookScroll();
		// Add double-tap/click listeners
		if (this.micrio.canvas.$isMobile) this.doubleTapHandler.hookTap();
		else this.doubleTapHandler.hookClick();
	}

	/** Unhooks zoom-related event listeners. */
	public unhookZoom(): void {
		this.unhookPinch();
		this.unhookScroll();
		if (this.micrio.canvas.$isMobile) this.doubleTapHandler.unhookTap();
		else this.doubleTapHandler.unhookClick();
	}

	/** Flag indicating if scroll listeners are attached. @internal */
	public get scrollHooked(): boolean { return this.wheelHandler.hooked; }

	/** Hooks mouse wheel/scroll event listeners. */
	public hookScroll(): void { this.wheelHandler.hook(); }

	/** Unhooks mouse wheel/scroll event listeners. */
	public unhookScroll(): void { this.wheelHandler.unhook(); }

	/** Hooks touch pinch and macOS gesture event listeners. */
	public hookPinch(): void {
		// Use touch events on iOS (most reliable there), pointer events everywhere else
		if (Browser.iOS && this.hasTouch) {
			this.pinchHandler.hook();
		} else {
			this.pointerPinchHandler.hook();
		}
		this.gestureHandler.hook();
	}

	/** Unhooks touch pinch and macOS gesture event listeners. */
	public unhookPinch(): void {
		if (Browser.iOS && this.hasTouch) {
			this.pinchHandler.unhook();
		} else {
			this.pointerPinchHandler.unhook();
		}
		this.gestureHandler.unhook();
	}

	/** Hooks pointer down/move/up listeners for drag panning. */
	public hookDrag(): void { this.dragHandler.hook(); }

	/** Unhooks pointer listeners for drag panning. */
	public unhookDrag(): void { this.dragHandler.unhook(); }

	/** Hooks listeners for events that should trigger a debounced 'update' event. @internal */
	private hookUpdate(): void { this.updateHandler.hook(); }

	/** Unhooks listeners for the debounced 'update' event. @internal */
	private unhookUpdate(): void { this.updateHandler.unhook(); }
}
