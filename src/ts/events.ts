import type { HTMLMicrioElement } from './element';
import type { Models } from '../types/models';
import type { MicrioImage } from './image';

import { Browser, once, pyth } from './utils';
import { get, writable, type Writable } from 'svelte/store';

/** Type alias for common event types handled. */
type AllEvents = WheelEvent|MouseEvent|TouchEvent;

/** Internal state variables used by the Events controller. */
type EventStateVars = {
	/** Dragging state */
	drag: {
		/** Previous pointer coordinates [x, y] during drag. */
		prev: number[]|undefined,
		/** Start coordinates and timestamp [x, y, time] of the drag. */
		start: number[]
	},
	/** Double-tap state */
	dbltap: {
		/** Timestamp of the last tap. */
		lastTapped: number
	},
	/** Pinching state */
	pinch: {
		/** The image being pinched (relevant for split-screen). */
		image:MicrioImage|undefined,
		/** Initial distance between pinch points. */
		sDst: number;
		/** Was panning active before pinching started? */
		wasPanning: boolean;
	},
	/** State for debouncing 'update' events. */
	updates: {
		/** Timeout ID for the debounced update. */
		to: number,
		/** Stack of event types that triggered the update. */
		stack: string[]
	}
};

/** Flag indicating if passive event listeners are supported (assumed true). */
const supportsPassive = true; // TODO: Add actual feature detection?
/** Event listener options for passive listeners. */
const _eventPassive:AddEventListenerOptions = {passive: true};
/** Event listener options for passive, capturing listeners. */
const _eventPassiveCapture:AddEventListenerOptions = {passive: true, capture: true};
/** Event listener options for non-passive listeners (allowing preventDefault). */
const _noEventPassive:AddEventListenerOptions = {passive: false};

/** Utility function to stop event propagation and prevent default browser behavior. */
function cancelPrevent(e:AllEvents){
	e.stopPropagation();
	e.preventDefault();
}

/**
 * List of internal Micrio event types that should trigger a debounced 'update' event.
 * The 'update' event signals that the overall state relevant for external integrations might have changed.
 * @internal
 * @readonly
 */
export const UpdateEvents:(keyof Models.MicrioEventMap)[] = [
	'move',
	'marker-open',
	'marker-opened',
	'marker-closed',
	'tour-start',
	'tour-step',
	'tour-stop',
	'tour-event',
	'media-play',
	'media-pause',
	'splitscreen-start',
	'splitscreen-stop',
];

/**
 * Handles user input events (mouse, touch, keyboard, wheel, gestures) for the Micrio viewer.
 * Translates browser events into camera movements (pan, zoom), dispatches custom Micrio events,
 * and manages interaction states like panning, pinching, and enabled/disabled states.
 * Accessed via `micrio.events`.
 * @author Marcel Duin <marcel@micr.io>
 */
 export class Events {

	/** The Micrio `<canvas>` element where most events are captured.
	 * @internal
	*/
	private el:HTMLCanvasElement;

	/** Writable Svelte store indicating if event handling is currently enabled. Set to false during tours or animations. */
	enabled:Writable<boolean> = writable(false);

	/** Getter for the current value of the {@link enabled} store. */
	get $enabled() : boolean { return get(this.enabled) };

	/** Flag indicating if the main event listeners are currently attached.
	 * @internal
	*/
	private hooked:boolean = false;

	/** Flag indicating if drag-related event listeners are attached.
	 * @internal
	*/
	private hookedDrag:boolean = false;

	/** Flag indicating if the user is currently panning (dragging).
	 * @internal
	*/
	private panning:boolean = false;

	/** Flag indicating if the user is currently pinching.
	 * @internal
	*/
	private pinching:boolean = false;

	/** Flag indicating if a click event originated from outside the core interaction (e.g., UI button).
	 * Used to potentially differentiate UI clicks from map clicks.
	 * @internal
	*/
	clicked: boolean = false;

	/** Flag indicating if the user is currently zooming via mouse wheel.
	 * @internal
	*/
	private wheeling:boolean = false;

	/** Flag indicating if Ctrl/Cmd key is required for mouse wheel zoom.
	 * @internal
	*/
	private controlZoom:boolean = false;

	/** Flag indicating if two fingers are required for touch panning.
	 * @internal
	*/
	private twoFingerPan:boolean = false;

	/** Stores the previous scale during pinch gestures for calculating zoom delta.
	 * @internal
	*/
	private pScale:number = 1;

	/** Timeout ID for debouncing the 'wheelend' event.
	 * @internal
	*/
	private wheelEndTo:number = -1;

	/** Flag indicating if the browser supports touch events.
	 * @internal
	*/
	private hasTouch:boolean = Browser.hasTouch && ('ontouchstart' in self);

	/** Flag indicating if the user has explicitly used Ctrl/Cmd + wheel for zooming (differentiates from trackpad pinch).
	 * @internal
	*/
	private hasUsedCtrl:boolean = false;

	/** Cached settings object from the first loaded image.
	 * @internal
	*/
	private settings:Models.ImageInfo.Settings|undefined;

	/** Array of currently visible MicrioImage instances.
	 * @internal
	*/
	private visible:MicrioImage[]|undefined;

	/** Internal state variables for managing complex interactions like drag, pinch, double-tap.
	 * @internal
	*/
	private vars:EventStateVars = {
		drag: { prev: undefined, start: [0,0,0] },
		dbltap: { lastTapped: 0 },
		pinch: { image: undefined, sDst: 0, wasPanning: false },
		updates: { to: -1, stack: [] }
	};

	/** Current pinch zoom factor relative to the start of the pinch. Undefined when not pinching. */
	pinchFactor: number|undefined;

	/**
	 * The Events constructor.
	 * @param micrio The main HTMLMicrioElement instance.
	 * @internal
	 */
	constructor(
		/** @internal */
		private micrio:HTMLMicrioElement,
	) {
		this.el = micrio.canvas.element;

		// Bind event handler methods to the class instance
		this.dStart = this.dStart.bind(this);
		this.dMove = this.dMove.bind(this);
		this.dStop = this.dStop.bind(this);
		this.pStart = this.pStart.bind(this);
		this.pMove = this.pMove.bind(this);
		this.pStop = this.pStop.bind(this);
		this.gesture = this.gesture.bind(this);
		this.keydown = this.keydown.bind(this);
		this.wheel = this.wheel.bind(this);
		this.wheelEnd = this.wheelEnd.bind(this);
		this.dbltap = this.dbltap.bind(this);
		this.dblclick = this.dblclick.bind(this);
		this.updateEvent = this.updateEvent.bind(this);
		this.dispatchUpdate = this.dispatchUpdate.bind(this);

		// Subscribe to the enabled store to automatically hook/unhook listeners
		this.enabled.subscribe(v => {
			if(v) this.hook();
			else this.unhook();
		});

		// Keep track of visible images
		micrio.visible.subscribe(v => this.visible = v);

		// Get settings from the first loaded image and enable events if configured
		micrio.current.subscribe(c => {
			if(c && !this.settings) once(c.info).then(info => { if(!info) return;
				this.settings = c.$settings as Models.ImageInfo.Settings;
				if(!c.error && this.settings.hookEvents) this.enabled.set(true);
			})
		});
	}

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
	dispatch<K extends keyof Models.MicrioEventDetails>(type:K, detail?:Models.MicrioEventDetails[K]) : void {
		this.micrio.dispatchEvent(new CustomEvent(type, detail !== undefined ? { detail } : undefined))
	}

	/**
	 * Determines which MicrioImage instance is under the given screen coordinates.
	 * Handles split-screen layouts.
	 * @internal
	 * @param c Screen coordinates {x, y}.
	 * @returns The MicrioImage instance under the coordinates, or the main current image as fallback.
	 */
	private getImage(c:{x:number,y:number}) : MicrioImage|undefined {
		if(!this.visible) return;
		const w = this.micrio.offsetWidth, h = this.micrio.offsetHeight,
			x = Math.max(0, Math.min(1, c.x/w)), y = Math.max(0, Math.min(1, c.y/h)); // Normalize coordinates
		const hasSplitScreen = this.visible?.find(i => !!i.opts.secondaryTo);
		// Find the image whose area contains the coordinates
		const t = this.visible.length == 1 ? this.visible[0] : this.visible.find(({grid,opts:{area}}) =>
			hasSplitScreen && grid ? false : area ? x >= area[0] && x <= area[2] && y >= area[1] && y <= area[3] : false
		);
		// Adjust coordinates if interacting with a passive split-screen image
		if(t && t.opts.secondaryTo && t.opts.isPassive && t.opts.area) { c.x-=t.opts.area[0]*w; c.y-=t.opts.area[1]*h; }
		// Return the found image, or the main current image if interacting with grid or passive split
		return t && !t.grid && (!t.opts.secondaryTo || !t.opts.isPassive) ? t : this.micrio.$current;
	}

	/** Hooks all necessary event listeners based on current settings. */
	public hook() : void {
		if(this.hooked) return; // Already hooked
		this.hooked = true;

		const s = this.settings;
		if(!s) return; // Settings not loaded yet

		// Apply settings
		this.twoFingerPan = !!s.twoFingerPan;
		if(this.twoFingerPan) this.micrio.setAttribute('data-can-pan','');
		else this.micrio.removeAttribute('data-can-pan');

		// Hook specific event types based on settings
		if(s?.hookKeys) this.hookKeys();
		if(s.hookDrag) this.hookDrag();
		if(!s.noZoom) this.hookZoom(); // Hook zoom only if not disabled

		this.hookUpdate(); // Hook listeners for the debounced 'update' event
	}

	/** Unhooks all attached event listeners. */
	public unhook() : void {
		if(!this.hooked) return; // Already unhooked
		this.hooked = false;

		// Unhook specific event types
		this.unhookDrag();
		this.unhookZoom();
		this.unhookKeys();
		this.unhookUpdate();
	}

	/** Hooks keyboard event listeners. */
	public hookKeys() : void { document.addEventListener('keydown', this.keydown); }

	/** Unhooks keyboard event listeners. */
	public unhookKeys() : void { document.removeEventListener('keydown', this.keydown); }

	/** Hooks zoom-related event listeners (pinch, scroll, double-tap/click). */
	public hookZoom() : void {
		const s = this.settings;
		this.controlZoom = !!s?.controlZoom; // Check if Ctrl key is required for scroll zoom
		if(!s||s.hookPinch) this.hookPinch();
		if(!s||s.hookScroll || this.controlZoom) this.hookScroll();
		// Add double-tap/click listeners
		if(this.micrio.canvas.$isMobile) this.el.addEventListener('touchstart', this.dbltap);
		else this.el.addEventListener('dblclick', this.dblclick);
	}

	/** Unhooks zoom-related event listeners. */
	public unhookZoom() : void {
		this.unhookPinch();
		this.unhookScroll();
		if(this.micrio.canvas.$isMobile) this.el.removeEventListener('touchstart', this.dbltap);
		else this.el.removeEventListener('dblclick', this.dblclick);
	}

	/** Flag indicating if scroll listeners are attached. @internal */
	public scrollHooked:boolean = false;

	/** Hooks mouse wheel/scroll event listeners. */
	public hookScroll() : void {
		if(this.scrollHooked) return;
		// Use non-passive listener to allow preventDefault for scroll hijacking
		this.micrio.addEventListener('wheel', this.wheel, _noEventPassive);
		this.scrollHooked = true;
	}

	/** Unhooks mouse wheel/scroll event listeners. */
	public unhookScroll() : void {
		this.micrio.removeEventListener('wheel', this.wheel, _noEventPassive);
		this.scrollHooked = false;
	}

	/** Hooks touch pinch and macOS gesture event listeners. */
	public hookPinch() : void {
		if(this.hasTouch) { // Standard touch events
			this.el.addEventListener('touchstart', this.pStart, _eventPassive);
		}

		// macOS specific gesture events for trackpad pinch
		if(Browser.OSX) {
			this.micrio.addEventListener('gesturestart', this.gesture, _noEventPassive);
			this.micrio.addEventListener('gesturechange', this.gesture, _noEventPassive);
			this.micrio.addEventListener('gestureend', this.gesture, _noEventPassive);
		}
	}

	/** Unhooks touch pinch and macOS gesture event listeners. */
	public unhookPinch() : void {
		this.el.removeEventListener('touchstart', this.pStart, _eventPassive);
		if(Browser.OSX) { // Commented out - handled by wheel event
			this.micrio.removeEventListener('gesturestart', this.gesture, _noEventPassive);
			this.micrio.removeEventListener('gesturechange', this.gesture, _noEventPassive);
			this.micrio.removeEventListener('gestureend', this.gesture, _noEventPassive);
		}
	}

	/** Hooks pointer down/move/up listeners for drag panning. */
	public hookDrag() : void {
		if(this.hookedDrag) return;
		this.hookedDrag = true;

		this.micrio.addEventListener('dragstart', cancelPrevent); // Prevent default image dragging
		this.micrio.addEventListener('pointerdown', this.dStart, _eventPassive); // Start drag on pointer down

		this.micrio.setAttribute('data-hooked',''); // Indicate events are hooked
	}

	/** Unhooks pointer listeners for drag panning. */
	public unhookDrag(){
		if(!this.hookedDrag) return;
		this.hookedDrag = false;

		this.micrio.removeEventListener('pointerdown', this.dStart, _eventPassive);
		this.micrio.removeEventListener('dragstart', cancelPrevent);

		this.micrio.removeAttribute('data-hooked');
	}

	/** Stores the ID of the pointer currently captured for dragging. @internal */
	capturedPointerId:number|undefined;

	/**
	 * Handles the start of a drag/pan operation (pointerdown).
	 * @internal
	 * @param e The PointerEvent.
	 * @param force If true, forces drag start even if target isn't the canvas.
	*/
	private dStart(e:PointerEvent,force=false) : void {
		// Ignore non-primary buttons or touch events if twoFingerPan is enabled
		if(e.button != 0 || (e.pointerType == 'touch' && this.twoFingerPan)) return;

		// Ignore if interaction didn't start on the canvas element (unless forced or target has scroll-through)
		if(!force && e.target != this.el && !(e.target instanceof Element && e.target.closest('[data-scroll-through]'))) return;

		// Ignore if Omni object and shift key is pressed (likely for multi-select or other interaction)
		if(this.micrio.$current?.isOmni && e.shiftKey) return;

		// Handle potential conflicts with pinching
		if(this.panning) {
			// If already panning and a second touch starts, stop panning to allow pinch
			if(e instanceof TouchEvent && e.touches.length > 1) this.dStop();
			return;
		}

		// Determine the target image under the pointer
		const img = this.getImage({x:e.clientX, y:e.clientY});
		if(!img) return; // Exit if no image found

		this.panning = true; // Set panning state

		// Store start coordinates and time
		this.vars.drag.start = [e.clientX, e.clientY, performance.now()];

		// Add move and up listeners to the main element to track movement outside the canvas
		this.micrio.addEventListener('pointermove', this.dMove, _eventPassive);
		this.micrio.addEventListener('pointerup', this.dStop, _eventPassive);

		this.micrio.setAttribute('data-panning',''); // Add panning attribute for styling
		this.micrio.wasm.e._panStart(img.ptr); // Notify Wasm pan started
		this.micrio.wasm.render(); // Trigger render
		this.dispatch('panstart'); // Dispatch custom event
	}

	/**
	 * Handles pointer movement during a drag/pan operation.
	 * @internal
	 * @param e The PointerEvent.
	*/
	private dMove(e:PointerEvent) : void {
		const cX = e.clientX, cY = e.clientY; // Current coordinates

		// Capture pointer only after significant movement to allow double-click
		const moved = pyth(this.vars.drag.start[0]-e.clientX,this.vars.drag.start[1]-e.clientY);
		if(!this.capturedPointerId && moved > 10)
			this.micrio.setPointerCapture(this.capturedPointerId = e.pointerId);

		// Calculate delta and call camera pan if previous coordinates exist
		if(this.vars.drag.prev)
			this.getImage({x:cX, y:cY})?.camera.pan(this.vars.drag.prev[0] - cX, this.vars.drag.prev[1] - cY);

		// Store current coordinates as previous for next move event
		this.vars.drag.prev = [cX, cY];
	}

	/**
	 * Handles the end of a drag/pan operation (pointerup).
	 * @internal
	 * @param e Optional PointerEvent.
	 * @param noKinetic If true, prevents kinetic coasting animation.
	 * @param noDispatch If true, suppresses the 'panend' event.
	*/
	private dStop(e?:PointerEvent, noKinetic:boolean=false, noDispatch:boolean=false) : void {
		if(!this.panning) return; // Exit if not panning

		this.panning = false; // Clear panning state
		this.vars.drag.prev = undefined; // Clear previous coordinates

		// Remove listeners
		this.micrio.removeEventListener('pointermove', this.dMove, _eventPassive);
		this.micrio.removeEventListener('pointerup', this.dStop, _eventPassive);
		// Release pointer capture if active
		if(this.capturedPointerId) this.micrio.releasePointerCapture(this.capturedPointerId);
		this.capturedPointerId = undefined;

		this.micrio.removeAttribute('data-panning'); // Remove panning attribute

		// Notify Wasm pan stopped (triggers kinetic animation if enabled and not suppressed)
		if(e && noKinetic==false) {
			const img = this.getImage({x:e.clientX, y:e.clientY});
			if(img) {
				this.micrio.wasm.e._panStop(img.ptr);
				this.micrio.wasm.render();
			}
		}

		// Dispatch 'panend' event unless suppressed
		if(!noDispatch) this.dispatch('panend', !e ? undefined : {
			'duration': performance.now() - this.vars.drag.start[2],
			'movedX': e.clientX - this.vars.drag.start[0],
			'movedY': e.clientY - this.vars.drag.start[1]
		});
	}

	// --- Pinching ---

	/**
	 * Handles the start of a touch pinch gesture (touchstart with two fingers).
	 * @internal
	 * @param e The TouchEvent.
	*/
	private pStart(e:TouchEvent|Event) : void {
		if(!Browser.hasTouch || !(e instanceof TouchEvent)) return; // Ensure touch event

		// Ignore if twoFingerPan is enabled and less than two touches
		if(this.twoFingerPan && e.touches.length < 2)
			return;

		// If already pinching or not exactly two touches, stop any existing pinch
		if(this.pinching || e.touches.length != 2) {
			this.pStop(e);
			return;
		}

		e.stopPropagation(); // Prevent bubbling
		if(!supportsPassive) e.preventDefault(); // Prevent default pinch zoom if passive listeners not supported

		// Stop panning if it was active before pinch started
		this.vars.pinch.wasPanning = this.panning;
		this.dStop(undefined, false, true); // Stop pan without kinetic effect or event

		const t = e.touches; // Touch points

		this.pinching = true; // Set pinching state

		// Add move/end listeners to the window to capture movement outside the element
		self.addEventListener('touchmove', this.pMove, _eventPassiveCapture);
		self.addEventListener('touchend', this.pStop, _eventPassiveCapture);

		this.micrio.setAttribute('data-pinching',''); // Add pinching attribute for styling
		// Store target image and initial pinch distance
		this.vars.pinch.image = this.getImage({x:t[0].clientX, y:t[0].clientY});
		this.vars.pinch.sDst = pyth(t[0].clientX-t[1].clientX, t[0].clientY-t[1].clientY);
		this.pinchFactor = undefined; // Reset pinch factor
		// Notify Wasm pinch started
		if(this.vars.pinch.image) this.micrio.wasm.e._pinchStart(this.vars.pinch.image.ptr);
		this.micrio.wasm.render(); // Trigger render

		this.dispatch('pinchstart'); // Dispatch custom event
		// Dispatch panstart if twoFingerPan is enabled
		if(this.twoFingerPan) this.dispatch('panstart');
	}

	/**
	 * Handles touch movement during a pinch gesture.
	 * @internal
	 * @param e The TouchEvent.
	*/
	private pMove(e:TouchEvent|Event) : void {
		if(!Browser.hasTouch || !(e instanceof TouchEvent)) return; // Ensure touch event
		const t = e.touches;
		if(t?.length < 2) return; // Need at least two touches

		// Get coordinates of the two touch points
		const coo = {x:t[0].clientX, y:t[0].clientY};
		const coo2 = {x:t[1].clientX, y:t[1].clientY};
		const v = this.vars.pinch;
		const i = v.image;
		if(!i) return; // Exit if no target image

		// Adjust coordinates if pinching on a passive split-screen image
		if(i?.opts.secondaryTo && i.opts.isPassive && i.opts.area) {
			const dX = i.opts.area[0]*this.micrio.offsetWidth;
			const dY = i.opts.area[1]*this.micrio.offsetHeight;
			coo.x-=dX; coo2.x-=dX;
			coo.y-=dY; coo2.y-=dY;
		}
		// Calculate current pinch factor relative to start distance
		this.pinchFactor = pyth(t[0].clientX-t[1].clientX, t[0].clientY-t[1].clientY) / v.sDst;
		// Notify Wasm of pinch movement
		this.micrio.wasm.e._pinch(i.ptr, coo.x, coo.y, coo2.x, coo2.y);
	}

	/**
	 * Handles the end of a touch pinch gesture (touchend).
	 * @internal
	 * @param e The TouchEvent or MouseEvent (can be triggered by gestureend).
	*/
	private pStop(e:MouseEvent|TouchEvent) : void {
		if(!this.pinching) return; // Exit if not pinching
		this.pinching = false; // Clear pinching state

		// Remove listeners
		self.removeEventListener('touchmove', this.pMove, _eventPassiveCapture);
		self.removeEventListener('touchend', this.pStop, _eventPassiveCapture);

		this.micrio.removeAttribute('data-pinching'); // Remove pinching attribute

		// Notify Wasm pinch stopped (triggers kinetic zoom/pan)
		const i = this.vars.pinch.image;
		if(i) {
			this.micrio.wasm.e._pinchStop(i.ptr, performance.now()); // Add timestamp
			this.micrio.wasm.render();
		}
		this.vars.pinch.image = undefined;
		this.pinchFactor = undefined;

		this.dispatch('pinchend'); // Dispatch custom event
		// Dispatch panend if twoFingerPan was enabled and panning wasn't active before pinch
		if(this.twoFingerPan && !this.vars.pinch.wasPanning) this.dispatch('panend');

		// If one finger remains after pinch, potentially restart panning
		if(e instanceof TouchEvent && e.touches.length == 1) this.dStart(e as unknown as PointerEvent, true);
	}

	// --- macOS Gesture Events ---

	/**
	 * Handles macOS trackpad gesture events (gesturestart, gesturechange, gestureend).
	 * Translates gesture scale/rotation into zoom/pan actions.
	 * @internal
	 * @param e The GestureEvent (or generic Event).
	*/
	private gesture(e:Event) : void {
		/** @ts-ignore */
		const scale:number = e['scale'];
		if(scale == 1) return;
		const diff = this.pScale - scale;
		this.pScale = scale;

		e.stopPropagation();
		e.preventDefault();

		if(e.type=='gesturechange') {
			const mE = e as MouseEvent;
			this.getImage({x:mE.clientX, y:mE.clientY})?.camera.zoom(diff*this.micrio.canvas.viewport.height, 0, mE.clientX, mE.clientY);
		}
	}

	// --- Mouse Wheel ---

	/**
	 * Handles mouse wheel events for zooming.
	 * @internal
	 * @param e The WheelEvent.
	 * @param force Force handling even if conditions normally prevent it.
	 * @param offX Optional X offset for zoom focus.
	*/
	private wheel(e:WheelEvent|Event, force:boolean=false, offX:number=0) : void {
		if(!(e instanceof WheelEvent)) return; // Ensure WheelEvent
		// Check if zoom is allowed based on settings and modifier keys
		if(this.controlZoom && !e.ctrlKey) return;
		if(!force && e.target instanceof Element && e.target != this.el && !e.target.classList.contains('marker') && !e.target.closest('[data-scroll-through]')) return;

		let delta = e.deltaY;

		if(e.ctrlKey) this.hasUsedCtrl = true;

		const isControlZoomWithMouse = this.controlZoom && (delta*10 % 1 == 0);
		const isTouchPad = this.hasUsedCtrl && !isControlZoomWithMouse;
		const isZoom = Browser.firefox || e.ctrlKey || !isTouchPad;

		if(this.twoFingerPan && this.micrio.$current?.camera.isZoomedOut()) return;

		// Prevent default scroll page behavior
		e.stopPropagation();
		e.preventDefault();

		// Trackpad pinch zoom amplify
		if((Browser.OSX || isTouchPad) && e.ctrlKey) delta *= 10;

		const coo = {x:e.clientX, y:e.clientY};
		const image = this.getImage(coo);
		if(!image) return;

		// Do scroll/pinch zoom
		if(isZoom) {
			const c = this.micrio.canvas.viewport;
			let offY:number = 0;

			// TODO FIX ME
			const box = this.micrio.getBoundingClientRect();
			image.camera.zoom(delta * 1/Math.sqrt(c.scale), 0, coo.x - offX-box.left, coo.y-box.top-offY);
		}
		// Pan x/y
		else image.camera.pan(e.deltaX, e.deltaY);
		this.wheeling = true;

		// Debounce wheel end event
		clearTimeout(this.wheelEndTo);
		this.wheelEndTo = setTimeout(this.wheelEnd, 50) as unknown as number;
	}

	/** Clears the wheeling state after a short delay. @internal */
	private wheelEnd() : void {
		this.wheeling = false;
	}

	// --- Double Tap/Click ---

	/**
	 * Handles double-tap detection on touch devices.
	 * @internal
	 * @param e The TouchEvent.
	*/
	private dbltap(e:TouchEvent|Event) : void {
		if(!Browser.hasTouch || !(e instanceof TouchEvent)) return;
		const now = performance.now();

		// If tap occurs within 250ms of the previous tap, trigger double-click logic
		if(e.touches.length == 1 && now - this.vars.dbltap.lastTapped < 250) {
			e.stopPropagation();
			e.preventDefault();
			this.dblclick(e);
		}
		this.vars.dbltap.lastTapped = now; // Store timestamp of this tap
	}

	/**
	 * Handles double-click (mouse) or double-tap (touch) events for zooming.
	 * Zooms in if zoomed out, zooms out fully otherwise.
	 * @internal
	 * @param e The MouseEvent or TouchEvent.
	*/
	private dblclick(e:MouseEvent|TouchEvent) : void {
		const t = e instanceof TouchEvent ? e.touches[0] : e; // Get coordinates from event
		const img = this.getImage({x:t.clientX, y:t.clientY}); // Get target image
		// Use zoom method with negative delta to zoom in, providing click coordinates
		img?.camera.zoom(-300, 500, t.clientX, t.clientY, 1, !this.micrio.$current?.album).catch(() => {});
	}

	// --- Keyboard ---

	/**
	 * Handles keydown events for keyboard navigation (arrows, +/-).
	 * @internal
	 * @param e The KeyboardEvent.
	*/
	private keydown(e:KeyboardEvent) : void {
		if(this.panning || this.pinching || !this.micrio.$current?.camera) return;
		const c = this.micrio.$current.camera;
		const hWidth = this.micrio.offsetWidth/ 2;
		const hHeight = this.micrio.offsetHeight / 2;
		const dur = 150;
		let dX = 0;
		let dY = 0;

		switch(e.key) {
			case 'ArrowUp': dY-=hHeight; break;
			case 'ArrowDown': dY+=hHeight; break;
			case 'ArrowLeft': dX-=hWidth; break;
			case 'ArrowRight': dX+=hWidth; break;
			case '+': case '=': c.zoom(-200,dur); break; // Zoom in
			case '-': case '_': c.zoom(200,dur); break; // Zoom out
			default: return; // Ignore other keys
		}
		e.preventDefault(); // Prevent default browser key actions
		e.stopPropagation();

		if(dX!=0 || dY!=0) c.pan(dX, dY, dur);
	}

	// --- Update Event Dispatching ---

	/** Hooks listeners for events that should trigger a debounced 'update' event. @internal */
	private hookUpdate() : void {
		UpdateEvents.forEach(t => this.micrio.addEventListener(t, this.updateEvent));
	}

	/** Unhooks listeners for the debounced 'update' event. @internal */
	private unhookUpdate() : void {
		UpdateEvents.forEach(t => this.micrio.removeEventListener(t, this.updateEvent));
	}

	/**
	 * Event listener callback that queues the event type and triggers the debounced dispatch.
	 * @internal
	 * @param e The Event object.
	*/
	private updateEvent(e:Event) : void {
		// Don't fire non-user move events
		if(e.type == 'move' && !this.isNavigating) return;

		// Add event type to stack if not already present
		const s = this.vars.updates.stack;
		if(s[s.length-1] != e.type) s.push(e.type);
		// Clear existing timeout and set a new one
		clearTimeout(this.vars.updates.to);
		if(this.vars.updates.to < 0) this.vars.updates.to = setTimeout(this.dispatchUpdate) as unknown as number;
	}

	/**
	 * Dispatches the 'update' event with the accumulated event types and current state.
	 * Clears the event stack.
	 * @internal
	*/
	private dispatchUpdate() : void {
		const v = this.vars.updates;
		clearTimeout(v.to);
		v.to = -1;

		if(v.stack.length) {
			this.dispatch('update', v.stack);
			v.stack.length = 0; // Clear stack
			v.to = <any>setTimeout(this.dispatchUpdate, 500) as number;
		}
	}
}
