import type { HTMLMicrioElement } from './element';
import type { MicrioImage } from './image';

/**
 * Handles swipe gestures for navigating image sequences, particularly for
 * swipe galleries and Omni object rotation.
 * @author Marcel Duin <marcel@micr.io>
 */
export class GallerySwiper {
	/** Index of the image/frame when the drag started. @internal */
	private startIndex:number|undefined;
	/** ClientX coordinate when the drag started. @internal */
	private startX:number|undefined;
	/** Flag indicating if the drag distance threshold has been met to initiate swipe. @internal */
	private hitTresh:boolean = false;
	/** Array of indices to snap to after swipe ends (if configured). @internal */
	private snapTo:number[] = [];
	/** requestAnimationFrame ID for snapping animation. @internal */
	private raf:number|undefined;
	/** Map tracking active pointer IDs during interaction. @internal */
	private pointers:Map<number, boolean> = new Map();
	/** Flag indicating if the image currently fills the full width (relevant for enabling swipe). @internal */
	private isFullWidth:boolean = false;
	/** Flag indicating if the drag started with the Shift key pressed. @internal */
	private startedWithShift:boolean = false;
	/** ID of the first pointer that initiated the drag. @internal */
	private firstTouchId:number|undefined;
	/** The MicrioImage instance this swiper is attached to. @internal */
	private image:MicrioImage;

	/** Getter for the current active image/frame index from the Wasm module. */
	public get currentIndex():number {return this.micrio.wasm.e._getActiveImageIdx(this.image.ptr)}

	/**
	 * Creates a GallerySwiper instance.
	 * @param micrio The main HTMLMicrioElement instance.
	 * @param length The total number of images/frames in the sequence.
	 * @param goto Callback function to navigate to a specific index.
	 * @param opts Swiper options: sensitivity, continuous looping, coverLimit.
	 */
	constructor(
		private micrio:HTMLMicrioElement,
		private length:number,
		public goto:(i:number) => void, // Callback to change the active index
		private opts:{
			sensitivity?:number, // Multiplier for swipe distance calculation
			continuous?:boolean, // Enable continuous looping?
			coverLimit?:boolean // Only allow swiping when zoomed out fully?
		}={}
	) {
		// Read options from attributes or use defaults
		if(!opts.sensitivity) opts.sensitivity = Number(micrio.getAttribute('data-swipe-sensitivity') ?? 1);

		// Parse snap points attribute
		const snap = micrio.getAttribute('data-swipe-snap');
		if(snap) this.snapTo = snap.split(',').map(Number);

		this.micrio.setAttribute('data-hooked',''); // Indicate swiper is active

		// Bind event handlers
		this.dStart = this.dStart.bind(this);
		this.dMove = this.dMove.bind(this);
		this.dStop = this.dStop.bind(this);
		this.mouseleave = this.mouseleave.bind(this);

		// Get current image and subscribe to view changes to update isFullWidth
		this.image = micrio.$current as MicrioImage;
		this.image.state.view.subscribe(v =>
			// Determine if swiping should be enabled based on zoom level and coverLimit option
			this.isFullWidth = opts.coverLimit ? this.image.camera.isZoomedOut()
				: v ? Math.round((v[2]-v[0])*1000)/1000 >= 1 : true // Check if view width is >= 1
		);

		// Configure Wasm module for swipe interaction
		const ptr = micrio.wasm.getPtr();
		micrio.wasm.e.setNoPinchPan(ptr, true); // Disable panning during pinch on this image
		micrio.wasm.e.setIsSwipe(ptr, true); // Indicate this image uses swipe logic

		// Attach pointerdown listener to start drag
		this.micrio.canvas.element.addEventListener('pointerdown', this.dStart);
	}

	/** Cleans up event listeners when the swiper is destroyed. */
	destroy() {
		this.micrio.canvas.element.removeEventListener('pointerdown', this.dStart);
		this.mouseleave(); // Ensure any active drag listeners are removed
	}

	/** Checks if a swipe/drag interaction should be active based on pointer count and state. @internal */
	private isDragging = () : boolean => this.pointers.size == 2 || (this.isFullWidth || this.startedWithShift) && this.pointers.size == 1;

	/** Handles pointerdown event to initiate swipe. @internal */
	private dStart(e:PointerEvent):void {
		this.startedWithShift = e.shiftKey; // Check if shift key was pressed
		const newDrag = !this.isDragging(); // Is this the start of a new drag?
		this.pointers.set(e.pointerId, true); // Track active pointer
		if(this.pointers.size > 2) this.mouseleave(); // Abort if more than 2 pointers

		// If starting a new drag and conditions are met
		if(newDrag) {
			this.hitTresh = false; // Reset threshold flag
			this.micrio.setAttribute('data-panning',''); // Indicate panning state
			this.startIndex = this.currentIndex; // Store starting index
			this.startX = e.clientX; // Store starting X coordinate
			this.firstTouchId = e.pointerId; // Track the initiating pointer
			// Add move/up listeners to the main element
			this.micrio.addEventListener('pointermove', this.dMove);
			this.micrio.addEventListener('pointerup', this.dStop);
			this.micrio.setPointerCapture(e.pointerId); // Capture pointer events
		}
	}

	/** Handles pointermove event during swipe. @internal */
	private dMove(e:PointerEvent):void {
		// Exit if not dragging, not the initiating pointer, or start values are missing
		if(!this.isDragging() || e.pointerId != this.firstTouchId
			|| this.startX === undefined || this.startIndex === undefined) return;

		// Check if drag distance threshold is met before calculating index change
		if(!this.hitTresh && this.startX !== undefined && (
			// Threshold met if 2 pointers OR distance > threshold (adjusted by pinch factor)
			this.hitTresh = this.pointers.size != 2 ? true
				: Math.abs(e.clientX - this.startX) > ((this.micrio.events.pinchFactor && this.micrio.events.pinchFactor > 1.25 ? 0.3 : 0.15) * this.micrio.offsetWidth)
		)) this.startX = e.clientX; // Reset startX after hitting threshold to avoid jump
		if(!this.hitTresh) return; // Exit if threshold not met

		// Calculate effective scale based on camera zoom (for continuous mode)
		const camera = this.micrio.$current!.camera;
		const scale = !this.opts.continuous ? 1 : Math.max(0.1, (camera.getXY(1, .5)[0] - camera.getXY(0, .5)[0]) / this.micrio.offsetWidth);
		// Calculate target index based on drag delta, scale, and sensitivity
		const delta = Math.round((e.clientX - this.startX) / (this.micrio.offsetWidth * scale) * this.length * (this.opts.sensitivity ?? 1)); // Apply sensitivity
		let idx = this.startIndex - delta;

		// Handle continuous looping
		if(this.opts.continuous) {
			while(idx < 0) idx += this.length;
			while(idx > this.length-1) idx -= this.length;
		}

		// Clamp index to bounds if not continuous
		idx = Math.max(0, Math.min(this.length-1, idx));

		// Call goto callback only if index actually changed
		if(idx != this.currentIndex) this.goto(idx);
	}

	/** Handles pointerup event to end swipe. @internal */
	private dStop(e:PointerEvent):void {
		this.pointers.delete(e.pointerId); // Remove pointer from tracking map
		if(e.pointerId == this.firstTouchId) { // If the initiating pointer was released
			this.micrio.releasePointerCapture(this.firstTouchId); // Release capture
			this.firstTouchId = undefined;
		}
		// If no pointers remain, finalize the swipe
		if(!this.pointers.size) this.swipeEnd();
	}

	/** Handles mouseleave event to cancel swipe. @internal */
	private mouseleave():void {
		this.pointers.clear(); // Clear all pointers
		this.swipeEnd(); // Finalize swipe
	}

	/** Finalizes the swipe interaction, removes listeners, and handles snapping. @internal */
	private swipeEnd():void {
		this.micrio.removeAttribute('data-panning'); // Remove panning attribute
		// Remove move/up listeners
		this.micrio.removeEventListener('pointermove', this.dMove);
		this.micrio.removeEventListener('pointerup', this.dStop);
		this.hitTresh = false; // Reset threshold flag

		// Handle snapping if configured
		if(this.snapTo.length) {
			// Find the closest snap point to the current index
			const snapToIndex = this.snapTo[this.snapTo.map((i,idx) => [idx, Math.abs(i-this.currentIndex)])
				.sort((a,b) => a[1] > b[1] ? 1 : a[1] < b[1] ? -1 : 0)[0][0]];
			// Animate to the snap point if it's different from current index
			if(snapToIndex != this.currentIndex) this.animateTo(snapToIndex);
		}
	}

	/**
	 * Animates smoothly to a target index using requestAnimationFrame.
	 * @param idx The target index.
	 */
	public animateTo(idx: number) : void {
		if(this.raf) cancelAnimationFrame(this.raf); // Cancel existing animation frame
		const duration = 250, // Animation duration
			started = performance.now(), // Start time
			startIdx = this.currentIndex, // Starting index
			delta = startIdx - idx; // Total change in index

		// Animation frame function
		const frame = (time:number) => {
			const p = Math.min(1, (time - started) / duration); // Calculate progress (0-1)
			if(p < 1) this.raf = requestAnimationFrame(frame); // Request next frame if not done
			// Calculate intermediate index using easing function from Wasm
			const d = startIdx - Math.round(this.micrio.wasm.e.ease(p) * delta);
			// Call goto only if index changed
			if(d != this.currentIndex) this.goto(d);
		}

		// Start the animation loop
		this.raf = requestAnimationFrame(frame);
	}

}
