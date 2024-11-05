import type { HTMLMicrioElement } from './element';
import type { Models } from '../types/models';
import type { MicrioImage } from './image';

import { Browser, once, pyth } from './utils';
import { get, writable, type Writable } from 'svelte/store';

type AllEvents = WheelEvent|MouseEvent|TouchEvent;
type EventStateVars = {
	drag: { prev: number[]|undefined, start: number[] },
	dbltap: { lastTapped: number },
	pinch: { image:MicrioImage|undefined, sDst: number; },
	updates: { to: number, stack: string[] }
};

const supportsPassive = true;
const _eventPassive:AddEventListenerOptions = {passive: true};
const _eventPassiveCapture:AddEventListenerOptions = {passive: true, capture: true};
const _noEventPassive:AddEventListenerOptions = {passive: false};

function cancelPrevent(e:AllEvents){
	e.stopPropagation();
	e.preventDefault();
}

/** Events that trigger a (deferred) `update` event
 * @internal
 * @readonly
*/
export const UpdateEvents:string[] = [
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
 * Micrio user input event handler
 * @author Marcel Duin <marcel@micr.io>
 * @copyright Q42 Internet BV, Micrio, 2015 - 2024
 * @link https://micr.io/ , https://q42.nl/en/
 */
 export class Events {

	/** The Micrio <canvas> element
	 * @internal
	*/
	private el:HTMLCanvasElement;

	/** Enable/disable events */
	enabled:Writable<boolean> = writable(false);

	/** Enabled state getter */
	get $enabled() : boolean { return get(this.enabled) };

	/** Hooked state
	 * @internal
	*/
	private hooked:boolean = false;

	/** Hooked drag
	 * @internal
	*/
	private hookedDrag:boolean = false;

	/** Panning state
	 * @internal
	*/
	private panning:boolean = false;

	/** Pinching state
	 * @internal
	*/
	private pinching:boolean = false;

	/** User has clicked (externally)
	 * @internal
	*/
	clicked: boolean = false;

	/** Wheeling state
	 * @internal
	*/
	private wheeling:boolean = false;

	/** Must use CTRL-key for zooming with mousewheel
	 * @internal
	*/
	private controlZoom:boolean = false;

	/** Need 2 fingers for touch panning
	 * @internal
	*/
	private twoFingerPan:boolean = false;

	/** Track the previous scale for gesture events
	 * @internal
	*/
	private pScale:number = 1;

	/** Mousewheel deferred ending timeout reference
	 * @internal
	*/
	private wheelEndTo:number = -1;

	/** Current browser supports touch events
	 * @internal
	*/
	private hasTouch:boolean = Browser.hasTouch && ('ontouchstart' in self);

	/** User has definitely used ctrlKey to zoom (touchpad zoom gives this)
	 * @internal
	*/
	private hasUsedCtrl:boolean = false;

	/** Settings inherited from first image
	 * @internal
	*/
	private settings:Models.ImageInfo.Settings|undefined;

	/** Current visible images
	 * @internal
	*/
	private visible:MicrioImage[]|undefined;

	/** Internal state variables
	 * @internal
	*/
	private vars:EventStateVars = {
		drag: {
			prev: undefined,
			start: [0,0,0]
		},
		dbltap: {
			lastTapped: 0
		},
		pinch: {
			image: undefined,
			sDst: 0
		},
		updates: {
			to: -1,
			stack: []
		}
	};

	/** User is pinching above certain treshold */
	pinchFactor: number|undefined;

	/** The Events constructor
	 * @param micrio The Micrio instance
	 * @internal
	*/
	constructor(
		/** @internal */
		private micrio:HTMLMicrioElement,
	) {
		this.el = micrio.canvas.element;

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

		this.enabled.subscribe(v => {
			if(v) this.hook();
			else this.unhook();
		});

		micrio.visible.subscribe(v => this.visible = v);

		micrio.current.subscribe(c => {
			if(c && !this.settings) once(c.info).then(info => { if(!info) return;
				this.settings = c.$settings as Models.ImageInfo.Settings;
				if(!c.error && this.settings.hookEvents) this.enabled.set(true);
			})
		});
	}

	/** User is currently manually navigating or not
	 * @returns Whether the user is using mouse/gestures to navigate right now
	*/
	get isNavigating(): boolean { return this.panning || this.pinching || this.wheeling || this.clicked; }

	/** Fire a custom event on <micr-io>
	 * @internal
	*/
	dispatch(type:string, detail?:any) : void {
		this.micrio.dispatchEvent(new CustomEvent(type, detail !== undefined ? { detail } : undefined))
	}

	/** @internal */
	private getImage(c:{x:number,y:number}) : MicrioImage|undefined {
		if(!this.visible) return;
		const w = this.micrio.offsetWidth, h = this.micrio.offsetHeight,
			x = Math.max(0, Math.min(1, c.x/w)), y = Math.max(0, Math.min(1, c.y/h));
		const hasSplitScreen = this.visible?.find(i => !!i.opts.secondaryTo);
		const t = this.visible.length == 1 ? this.visible[0] : this.visible.find(({grid,opts:{area}}) =>
			hasSplitScreen && grid ? false : area ? x >= area[0] && x <= area[2] && y >= area[1] && y <= area[3] : false
		);
		if(t && t.opts.secondaryTo && t.opts.isPassive && t.opts.area) { c.x-=t.opts.area[0]*w; c.y-=t.opts.area[1]*h; }
		return t && !t.grid && (!t.opts.secondaryTo || !t.opts.isPassive) ? t : this.micrio.$current;
	}

	/** Hook all event listeners */
	public hook() : void {
		if(this.hooked) return;
		this.hooked = true;

		const s = this.settings;
		if(!s) return;

		this.twoFingerPan = !!s.twoFingerPan;
		if(this.twoFingerPan) this.micrio.setAttribute('data-can-pan','');
		else this.micrio.removeAttribute('data-can-pan');

		if(s?.hookKeys) this.hookKeys();
		if(s.hookDrag) this.hookDrag();
		if(!s.noZoom) this.hookZoom();

		this.hookUpdate();
	}

	/** Unhook all event listeners */
	public unhook() : void {
		if(!this.hooked) return;
		this.hooked = false;

		this.unhookDrag();
		this.unhookZoom();
		this.unhookKeys();
		this.unhookUpdate();
	}

	/** Hook keyboard event listeners */
	public hookKeys() : void { document.addEventListener('keydown', this.keydown); }

	/** Unhook keyboard event listeners */
	public unhookKeys() : void { document.removeEventListener('keydown', this.keydown); }

	/** Hook all zoom event listeners */
	public hookZoom() : void {
		const s = this.settings;
		this.controlZoom = !!s?.controlZoom;
		if(!s||s.hookPinch) this.hookPinch();
		if(!s||s.hookScroll || this.controlZoom) this.hookScroll();
		if(this.micrio.canvas.$isMobile) this.el.addEventListener('touchstart', this.dbltap);
		else this.el.addEventListener('dblclick', this.dblclick);
	}

	/** Remove all zoom event listeners */
	public unhookZoom() : void {
		this.unhookPinch();
		this.unhookScroll();
		if(this.micrio.canvas.$isMobile) this.el.removeEventListener('touchstart', this.dbltap);
		else this.el.removeEventListener('dblclick', this.dblclick);
	}

	public scrollHooked:boolean = false;

	/** Hook mousewheel / scroll event listeners */
	public hookScroll() : void {
		if(this.scrollHooked) return;
		this.micrio.addEventListener('wheel', this.wheel, _noEventPassive);
		this.scrollHooked = true;
	}

	/** Unhook mousewheel / scroll event listeners */
	public unhookScroll() : void {
		this.micrio.removeEventListener('wheel', this.wheel, _noEventPassive);
		this.scrollHooked = false;
	}

	/** Hook touch/pinch event listeners */
	public hookPinch() : void {
		if(this.hasTouch) {
			this.el.addEventListener('touchstart', this.pStart, _eventPassive);
		}

		// This is only for trackpad zooming
		if(Browser.OSX) {
			this.micrio.addEventListener('gesturestart', this.gesture, _noEventPassive);
			this.micrio.addEventListener('gesturechange', this.gesture, _noEventPassive);
			this.micrio.addEventListener('gestureend', this.gesture, _noEventPassive);
		}
	}

	/** Unhook touch/pinch event listeners */
	public unhookPinch() : void {
		this.el.removeEventListener('touchstart', this.pStart, _eventPassive);
		if(Browser.OSX) {
			this.micrio.removeEventListener('gesturestart', this.gesture, _noEventPassive);
			this.micrio.removeEventListener('gesturechange', this.gesture, _noEventPassive);
			this.micrio.removeEventListener('gestureend', this.gesture, _noEventPassive);
		}
	}

	/** Hook mouse/touch dragging event listeners */
	public hookDrag() : void {
		if(this.hookedDrag) return;
		this.hookedDrag = true;

		this.micrio.addEventListener('dragstart', cancelPrevent);
		this.micrio.addEventListener('pointerdown', this.dStart, _eventPassive);

		this.micrio.setAttribute('data-hooked','');
	}

	/** Unhook mouse/touch dragging event listeners */
	public unhookDrag(){
		if(!this.hookedDrag) return;
		this.hookedDrag = false;

		this.micrio.removeEventListener('pointerdown', this.dStart, _eventPassive);
		this.micrio.removeEventListener('dragstart', cancelPrevent);

		this.micrio.removeAttribute('data-hooked');
	}

	/** @internal */
	capturedPointerId:number|undefined;

	/** Drag start event handler
	 * @internal
	 * @param e The event
	 * @param force Force start of drag handling
	*/
	private dStart(e:PointerEvent,force=false) : void {
		if(e.button != 0 || (e.pointerType == 'touch' && this.twoFingerPan)) return;

		// Prevent dragging if not a canvas interaction
		if(!force && e.target != this.el) return;

		// Prevent dragging if omni-object and shift key pressed
		if(this.micrio.$current?.isOmni && e.shiftKey) return;

		if(this.panning) {
			if(e instanceof TouchEvent && e.touches.length > 1) this.dStop();
			return;
		}

		const img = this.getImage({x:e.clientX, y:e.clientY});
		if(!img) return;

		this.panning = true;

		this.vars.drag.start = [e.clientX, e.clientY, performance.now()];

		this.micrio.addEventListener('pointermove', this.dMove, _eventPassive);
		this.micrio.addEventListener('pointerup', this.dStop, _eventPassive);

		this.micrio.setAttribute('data-panning','');
		this.micrio.wasm.e._panStart(img.ptr);
		this.micrio.wasm.render();
		this.dispatch('panstart');
	}

	/** Drag move event handler
	 * @internal
	 * @param e The mouse/touch event
	*/
	private dMove(e:PointerEvent) : void {
		const cX = e.clientX, cY = e.clientY;

		// .setPointerCapture disables dblclick event -- only hook if moved >10px
		const moved = pyth(this.vars.drag.start[0]-e.clientX,this.vars.drag.start[1]-e.clientY);
		if(!this.capturedPointerId && moved > 10)
			this.micrio.setPointerCapture(this.capturedPointerId = e.pointerId);

		if(this.vars.drag.prev)
			this.getImage({x:cX, y:cY})?.camera.pan(this.vars.drag.prev[0] - cX, this.vars.drag.prev[1] - cY);

		this.vars.drag.prev = [cX, cY];
	}

	/** Drag end event handler
	 * @internal
	 * @param e The mouse/touch event
	 * @param noKinetic Don't do kinetic after-pan
	*/
	private dStop(e?:PointerEvent, noKinetic:boolean=false) : void {
		if(!this.panning) return;

		this.panning = false;
		this.vars.drag.prev = undefined;

		this.micrio.removeEventListener('pointermove', this.dMove, _eventPassive);
		this.micrio.removeEventListener('pointerup', this.dStop, _eventPassive);
		if(this.capturedPointerId) this.micrio.releasePointerCapture(this.capturedPointerId);
		this.capturedPointerId = undefined;

		this.micrio.removeAttribute('data-panning');

		if(e && noKinetic==false) {
			const img = this.getImage({x:e.clientX, y:e.clientY});
			if(img) {
				this.micrio.wasm.e._panStop(img.ptr);
				this.micrio.wasm.render();
			}
		}

		this.dispatch('panend', !e ? undefined : {
			'duration': performance.now() - this.vars.drag.start[2],
			'movedX': e.clientX - this.vars.drag.start[0],
			'movedY': e.clientY - this.vars.drag.start[1]
		});
	}

	// Pinching

	/** Start touch handling
	 * @internal
	 * @param e The event
	*/
	private pStart(e:TouchEvent|Event) : void {
		if(!Browser.hasTouch || !(e instanceof TouchEvent)) return;

		// Don't cancel any non-two-finger stuff
		if(this.twoFingerPan && e.touches.length < 2)
			return;

		if(this.pinching || e.touches.length != 2) {
			this.pStop(e);
			return;
		}

		e.stopPropagation();
		if(!supportsPassive) e.preventDefault();

		this.dStop();

		const t = e.touches;

		this.pinching = true;

		self.addEventListener('touchmove', this.pMove, _eventPassiveCapture);
		self.addEventListener('touchend', this.pStop, _eventPassiveCapture);

		this.micrio.setAttribute('data-pinching','');
		this.vars.pinch.image = this.getImage({x:t[0].clientX, y:t[0].clientY});
		this.vars.pinch.sDst = pyth(t[0].clientX-t[1].clientX, t[0].clientY-t[1].clientY);
		this.pinchFactor = undefined;
		if(this.vars.pinch.image) this.micrio.wasm.e._pinchStart(this.vars.pinch.image.ptr);
		this.micrio.wasm.render();
	}

	/** Touch move handling
	 * @internal
	 * @param e The event
	*/
	private pMove(e:TouchEvent|Event) : void {
		if(!Browser.hasTouch || !(e instanceof TouchEvent)) return;
		const t = e.touches;
		if(t?.length < 2) return;
		const coo = {x:t[0].clientX, y:t[0].clientY};
		const coo2 = {x:t[1].clientX, y:t[1].clientY};
		const v = this.vars.pinch;
		const i = v.image;
		if(!i) return;
		if(i?.opts.secondaryTo && i.opts.isPassive && i.opts.area) {
			const dX = i.opts.area[0]*this.micrio.offsetWidth;
			const dY = i.opts.area[1]*this.micrio.offsetHeight;
			coo.x-=dX; coo2.x-=dX;
			coo.y-=dY; coo2.y-=dY;
		}
		this.pinchFactor = pyth(t[0].clientX-t[1].clientX, t[0].clientY-t[1].clientY) / v.sDst;
		this.micrio.wasm.e._pinch(i.ptr, coo.x, coo.y, coo2.x, coo2.y);
	}

	/** Touch end handling
	 * @internal
	 * @param e The event
	*/
	private pStop(e:MouseEvent|TouchEvent) : void {
		if(!this.pinching || !this.vars.pinch.image) return;
		this.pinching = false;

		if(!supportsPassive) e.preventDefault();
		e.stopPropagation();

		self.removeEventListener('touchmove', this.pMove, _eventPassiveCapture);
		self.removeEventListener('touchend', this.pStop, _eventPassiveCapture);

		this.micrio.removeAttribute('data-pinching');

		this.micrio.wasm.e._pinchStop(this.vars.pinch.image.ptr, performance.now());
		this.micrio.wasm.render();
		this.vars.pinch.image = undefined;
		this.pinchFactor = undefined;

		this.dispatch('pinchend');
	}

	/** Gesture event handling
	 * @internal
	 * @param e The event
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

	/** Mousewheel handling
	 * @internal
	 * @param e The event
	 * @param force Force event handling
	 * @param offX Optional X-offset in pixels
	*/
	private wheel(e:WheelEvent|Event, force:boolean=false, offX:number=0) : void {
		if(!(e instanceof WheelEvent)) return;

		if(this.controlZoom && !e.ctrlKey) return;
		if(!force && e.target instanceof Element && e.target != this.el && !e.target.classList.contains('marker') && !e.target.hasAttribute('data-scroll-through')) return;

		e.stopPropagation();
		e.preventDefault();
		let delta = e.deltaY;

		if(e.ctrlKey) this.hasUsedCtrl = true;

		const isControlZoomWithMouse = this.controlZoom && (delta*10 % 1 == 0);
		const isTouchPad = this.hasUsedCtrl && !isControlZoomWithMouse;

		// Trackpad pinch zoom amplify
		if((Browser.OSX || isTouchPad) && e.ctrlKey) delta *= 10;

		const isZoom = Browser.firefox || e.ctrlKey || !isTouchPad;

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

		// Set state wheeling
		this.wheeling = true;
		clearTimeout(this.wheelEndTo);
		this.wheelEndTo = <any>setTimeout(this.wheelEnd, 50) as number;
	}

	/** Mousewheel state ending
	 * @internal
	*/
	private wheelEnd() : void {
		this.wheeling = false;
	}

	/** Touch double tap handling
	 * @internal
	 * @param e The event
	*/
	private dbltap(e:TouchEvent|Event) : void {
		if(!Browser.hasTouch || !(e instanceof TouchEvent)) return;
		if(e.touches.length == 1 && Date.now() - this.vars.dbltap.lastTapped < 250) {
			e.stopPropagation();
			e.preventDefault();
			this.dblclick(e);
		}
		this.vars.dbltap.lastTapped = Date.now();
	}

	/** Doubleclick handling
	 * @internal
	 * @param e The event
	*/
	private dblclick(e:MouseEvent|TouchEvent) : void {
		const evt:MouseEvent|Touch = e instanceof MouseEvent ? e : e.touches[0];
		this.getImage({x:evt.clientX, y:evt.clientY})?.camera.zoom(-300, 500, evt.clientX, evt.clientY, 1, !this.micrio.$current?.album).catch(() => {})
	}

	/** Key handling
	 * @internal
	 * @param e The event
	*/
	private keydown(e:KeyboardEvent) : void {
		if(this.panning || this.pinching) return;
		const hWidth = this.micrio.offsetWidth/ 2;
		const hHeight = this.micrio.offsetHeight / 2;
		let dX = 0;
		let dY = 0;
		let doPan = false;
		const cam = this.micrio.$current?.camera;
		if(!cam) return;
		switch(e.keyCode) {
			case 37: dX=-hWidth; doPan = true; break;
			case 39: dX=hWidth; doPan = true; break;
			case 38: dY=-hHeight; doPan = true; break;
			case 40: dY=hHeight; doPan = true; break;
			case 32: cam.zoom(e.shiftKey && 200 || -200, 150); break;
			case 187: case 61: if(e.shiftKey) cam.zoom(-200, 150); break; // +
			case 189: case 173: cam.zoom(200, 150); break; // -
			default: return;
		}
		if(doPan) cam.pan(dX, dY, 150);
	}

	/** Hook update event listener
	 * @internal
	*/
	private hookUpdate() : void {
		UpdateEvents.forEach(e => this.micrio.addEventListener(e, this.updateEvent));
	}

	/** Hook update event listener
	 * @internal
	*/
	private unhookUpdate() : void {
		UpdateEvents.forEach(e => this.micrio.removeEventListener(e, this.updateEvent));
	}

	/** Add an update event to the stack
	 * @internal
	 * @param e The event
	*/
	private updateEvent(e:Event) : void {
		// Don't fire non-user move events
		if(e.type == 'move' && !this.isNavigating) return;

		const s = this.vars.updates.stack;
		if(s[s.length-1] != e.type) s.push(e.type);
		if(this.vars.updates.to < 0) this.vars.updates.to = <any>setTimeout(this.dispatchUpdate) as number;
	}

	/** Periodically fire the update event with the stack
	 * @internal
	*/
	private dispatchUpdate() : void {
		const v = this.vars.updates;
		clearTimeout(v.to);
		v.to = -1;

		if(v.stack.length) {
			this.dispatch('update', v.stack);
			v.stack.length = 0;
			v.to = <any>setTimeout(this.dispatchUpdate, 500) as number;
		}
	}

}
