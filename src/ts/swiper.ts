import type { HTMLMicrioElement } from './element';
import type { MicrioImage } from './image';

/**
 * Swipeable switching image sequence
 * @author Marcel Duin <marcel@micr.io>
 * @copyright Q42 Internet BV, Micrio, 2015 - 2024
 * @link https://micr.io/ , https://q42.nl/en/
 * 
*/
export class GallerySwiper {
	private startIndex:number|undefined;
	private startX:number|undefined;
	private hitTresh:boolean = false;
	private snapTo:number[] = [];
	private raf:number|undefined;
	private pointers:Map<number, boolean> = new Map();
	private isFullWidth:boolean = false;
	private startedWithShift:boolean = false;
	private firstTouchId:number|undefined;
	private image:MicrioImage;

	public get currentIndex():number {return this.micrio.wasm.e._getActiveImageIdx(this.image.ptr)}

	constructor(
		private micrio:HTMLMicrioElement,
		private length:number,
		public goto:(i:number) => void,
		private opts:{
			sensitivity?:number,
			continuous?:boolean,
			coverLimit?:boolean
		}={}
	) {
		if(!opts.sensitivity) opts.sensitivity = Number(micrio.getAttribute('data-swipe-sensitivity') ?? 1);

		const snap = micrio.getAttribute('data-swipe-snap');
		if(snap) this.snapTo = snap.split(',').map(Number);

		this.micrio.setAttribute('data-hooked','');

		this.dStart = this.dStart.bind(this);
		this.dMove = this.dMove.bind(this);
		this.dStop = this.dStop.bind(this);
		this.mouseleave = this.mouseleave.bind(this);

		this.image = micrio.$current as MicrioImage;
		this.image.state.view.subscribe(v =>
			this.isFullWidth = opts.coverLimit ? this.image.camera.isZoomedOut()
				: v ? Math.round((v[2]-v[0])*1000)/1000 >= 1 : true
		);

		// Set wasm to no panning when two-finger pinch
		const ptr = micrio.wasm.getPtr();
		micrio.wasm.e.setNoPinchPan(ptr, true);
		micrio.wasm.e.setIsSwipe(ptr, true);

		this.micrio.canvas.element.addEventListener('pointerdown', this.dStart);
	}

	destroy() {
		this.micrio.canvas.element.removeEventListener('pointerdown', this.dStart);
		this.mouseleave();
	}

	private isDragging = () : boolean => this.pointers.size == 2 || (this.isFullWidth || this.startedWithShift) && this.pointers.size == 1;

	/** Drag start */
	private dStart(e:PointerEvent):void {
		this.startedWithShift = e.shiftKey;
		const newDrag = !this.isDragging();
		this.pointers.set(e.pointerId, true);
		if(this.pointers.size > 2) this.mouseleave();

		if(newDrag) {
			this.hitTresh = false;
			this.micrio.setAttribute('data-panning','');
			this.startIndex = this.currentIndex;
			this.startX = e.clientX;
			this.firstTouchId = e.pointerId;
			this.micrio.addEventListener('pointermove', this.dMove);
			this.micrio.addEventListener('pointerup', this.dStop);
			this.micrio.setPointerCapture(e.pointerId);
		}
	}

	/** Drag move */
	private dMove(e:PointerEvent):void {
		if(!this.isDragging() || e.pointerId != this.firstTouchId
			|| this.startX === undefined || this.startIndex === undefined) return;

		if(!this.hitTresh && this.startX !== undefined && (
			this.hitTresh = this.pointers.size != 2 ? true
				: Math.abs(e.clientX - this.startX) > ((this.micrio.events.pinchFactor && this.micrio.events.pinchFactor > 1.25 ? 0.3 : 0.15) * this.micrio.offsetWidth)
		)) this.startX = e.clientX; if(!this.hitTresh) return;

		const camera = this.micrio.$current!.camera;
		const scale = !this.opts.continuous ? 1 : Math.max(0.1, (camera.getXY(1, .5)[0] - camera.getXY(0, .5)[0]) / this.micrio.offsetWidth);
		const delta = Math.round((e.clientX - this.startX) / (this.micrio.offsetWidth * scale) * this.length);// * (this.opts.sensitivity ?? 1);
		let idx = this.startIndex - delta;
		if(this.opts.continuous) {
			while(idx < 0) idx += this.length;
			while(idx > this.length-1) idx -= this.length;
		}
		idx = Math.max(0, Math.min(this.length-1, idx));
		if(idx != this.currentIndex) this.goto(idx);
	}

	/** Drag stop */
	private dStop(e:PointerEvent):void {
		this.pointers.delete(e.pointerId);
		if(e.pointerId == this.firstTouchId) {
			this.micrio.releasePointerCapture(this.firstTouchId);
			this.firstTouchId = undefined;
		}
		if(!this.pointers.size) this.swipeEnd();
	}

	private mouseleave():void {
		this.pointers.clear();
		this.swipeEnd();
	}

	private swipeEnd():void {
		this.micrio.removeAttribute('data-panning');
		this.micrio.removeEventListener('pointermove', this.dMove);
		this.micrio.removeEventListener('pointerup', this.dStop);
		this.hitTresh = false;

		if(this.snapTo.length) {
			const snapToIndex = this.snapTo[this.snapTo.map((i,idx) => [idx, Math.abs(i-this.currentIndex)])
				.sort((a,b) => a[1] > b[1] ? 1 : a[1] < b[1] ? -1 : 0)[0][0]];
			if(snapToIndex != this.currentIndex) this.animateTo(snapToIndex);
		}
	}

	/** Same as .goto(), but animate the rotation */
	public animateTo(idx: number) : void {
		if(this.raf) cancelAnimationFrame(this.raf);
		const duration = 250,
			started = performance.now(),
			startIdx = this.currentIndex,
			delta = startIdx - idx;

		const frame = (time:number) => {
			const p = Math.min(1, (time - started) / duration);
			if(p < 1) this.raf = requestAnimationFrame(frame);
			const d = startIdx - Math.round(this.micrio.wasm.e.ease(p) * delta);
			if(d != this.currentIndex) this.goto(d);
		}

		frame(started);
	}

}
