<script lang="ts">
	/**
	 * Minimap.svelte - Displays a small overview map of the image.
	 *
	 * Shows a thumbnail of the image and draws the current viewport rectangle
	 * or polygon (for 360) on top. Allows clicking/dragging to navigate.
	 * Automatically hides when fully zoomed out (if configured).
	 */

	import type { HTMLMicrioElement } from '../../ts/element';
	import type { MicrioImage } from '../../ts/image';
	import type { Models } from '../../types/models';

	import { onMount, getContext, } from 'svelte';

	// --- Props ---
	interface Props {
		/** The MicrioImage instance this minimap represents. */
		image: MicrioImage;
	}

	let { image }: Props = $props();

	// --- Context & State ---

	/** Get the main Micrio element instance from context. */
	const micrio = <HTMLMicrioElement>getContext('micrio');
	/** Destructure needed stores and properties. */
	const { current } = micrio;
	/** Reference to the main canvas viewport state. */
	const viewport = micrio.canvas.viewport;

	/** Get the ImageInfo object (assumed to be loaded). */
	const info = image.$info as Models.ImageInfo.ImageInfo;
	/** Reference to the image's camera controller. */
	const camera = image.camera;
	/** Reference to the image's settings store value. */
	const settings = image.$settings;

	// --- Configuration ---

	/** Maximum width of the minimap in pixels. */
	const maxWidth:number = settings.minimapWidth ?? 200;
	/** Maximum height of the minimap in pixels. */
	const maxHeight:number = settings.minimapHeight ?? 160;
	/** Should the minimap hide automatically when fully zoomed out? */
	const autoHide:boolean = !settings.alwaysShowMinimap;
	/** Are the main UI controls hidden? (Used for positioning). */
	const noControls:boolean = !!settings.noControls;

	// --- Dimensions ---

	/** Aspect ratio of the main image. */
	const aspect = info.width / info.height;
	/** Calculated width of the minimap canvas based on constraints. */
	const width = maxWidth / aspect > maxHeight ? Math.round(maxHeight * aspect) : maxWidth;
	/** Calculated height of the minimap canvas. */
	const height = maxWidth / aspect <= maxHeight ? Math.round(maxWidth / aspect) : maxHeight;

	// --- Canvas & Drawing ---

	/** Reference to the minimap's <canvas> element. */
	let _canvas:HTMLCanvasElement|undefined = $state();
	/** 2D rendering context for the minimap canvas. */
	let _ctx:CanvasRenderingContext2D|null;

	// --- State ---

	/** Local state tracking if the minimap should be hidden (due to autoHide). */
	let hidden:boolean = $state(false);
	/** Local state tracking if the main image is fully zoomed out. */
	let zoomedOut:boolean = $state(!info.is360 && camera.isZoomedOut());

	// --- 360 Viewport Rectangle Calculation ---

	/** Interface for 360 view rectangles that can span boundaries. */
	interface ViewRect {
		x: number;
		y: number;
		width: number;
		height: number;
	}

	/** 
	 * Calculates rectangles representing the current 360 viewport for minimap display.
	 * 
	 * This replaces the previous getPoly() approach that sampled screen edges and tried to handle
	 * wrapping manually. The new approach directly converts the Models.Camera.View360 to proper
	 * 2D rectangles, correctly handling:
	 * 
	 * - Longitude wrapping (views crossing 180°/-180° boundary)
	 * - Polar region clamping (preventing coordinates outside 0-1 range)
	 * - Wide field-of-view scenarios
	 * 
	 * @param area The current camera view in the new {centerX, centerY, width, height} format
	 * @returns Array of rectangles to draw (1 for normal views, 2 for wrapped views)
	 */
	function get360ViewRects(area: Models.Camera.View360): ViewRect[] {
		const rects: ViewRect[] = [];
		
		// Get the basic rectangle from the camera view
		let { centerX, centerY, width, height } = area;
		
		// Normalize longitude center to [0, 1] range (handles negative values or values > 1)
		centerX = ((centerX % 1) + 1) % 1;
		
		// Calculate rectangle bounds
		let x0 = centerX - width / 2;
		let x1 = centerX + width / 2;
		
		// Clamp latitude bounds to valid range [0, 1] (handles polar regions)
		const y0 = Math.max(0, centerY - height / 2);
		const y1 = Math.min(1, centerY + height / 2);
		
		// Handle longitude wrapping (crossing 0/1 boundary)
		if (x0 < 0) {
			// View extends past 0° longitude - split into two rectangles
			// Left rectangle: wrapped portion (from x0+1 to 1.0)
			rects.push({
				x: x0 + 1,
				y: y0,
				width: 1 - (x0 + 1),
				height: y1 - y0
			});
			// Right rectangle: main portion (from 0.0 to x1)
			rects.push({
				x: 0,
				y: y0,
				width: x1,
				height: y1 - y0
			});
		} else if (x1 > 1) {
			// View extends past 360° longitude - split into two rectangles
			// Left rectangle: main portion (from x0 to 1.0)
			rects.push({
				x: x0,
				y: y0,
				width: 1 - x0,
				height: y1 - y0
			});
			// Right rectangle: wrapped portion (from 0.0 to x1-1)
			rects.push({
				x: 0,
				y: y0,
				width: x1 - 1,
				height: y1 - y0
			});
		} else {
			// No wrapping needed - single rectangle
			rects.push({
				x: x0,
				y: y0,
				width: x1 - x0,
				height: y1 - y0
			});
		}
		
		return rects;
	}

	// --- Drawing Function ---

	/** Draws the minimap content (thumbnail and viewport indicator). */
	function draw(area:Models.Camera.View360|undefined): void{ // `area` is the current view from the image state store
		if(!area||!_ctx) return; // Exit if no view or context
		moved(); // Update hidden state based on activity

		_ctx.clearRect(0,0, width, height); // Clear the canvas

		if(image.thumbSrc) { // If thumbnail exists
			// Draw semi-transparent background overlay
			_ctx.globalCompositeOperation = 'source-over';
			_ctx.fillStyle = 'rgba(0,0,0,.5)';
			_ctx.fillRect(0, 0, width, height);

			// Prepare to "cut out" the viewport area
			_ctx.globalAlpha = 1;
			_ctx.globalCompositeOperation = 'destination-out'; // Pixels drawn will become transparent
		} else { // If no thumbnail, just draw the viewport rectangle
			_ctx.fillStyle = 'rgba(0,0,0,.5)'; // Use background color for the whole minimap
			_ctx.fillRect(0, 0, width, height);
		}

		_ctx.beginPath();
		_ctx.fillStyle = 'white'; // Use white for the viewport indicator fill

		if(info.is360) { // Draw rectangles for 360 view
			const rects = get360ViewRects(area); // Get viewport rectangles
			for(const rect of rects) {
				_ctx.rect(
					Math.floor(rect.x * width), // x
					Math.floor(rect.y * height), // y
					Math.ceil(rect.width * width), // width
					Math.ceil(rect.height * height) // height
				);
			}
		}
		else { // Draw rectangle for 2D view
			zoomedOut = camera.isZoomedOut(); // Update zoomedOut state
			_ctx.rect(
				Math.floor((area.centerX-area.width/2)*width), // x
				Math.floor((area.centerY-area.height/2)*height), // y
				Math.ceil(area.width*width), // width
				Math.ceil(area.height*height) // height
			);
		}

		if(image.thumbSrc) { // If thumbnail exists
			_ctx.fill(); // Fill the path (cuts out the viewport area)
			_ctx.globalCompositeOperation = 'source-over'; // Reset composite operation
		}

		// Draw the border around the viewport indicator
		_ctx.stroke();
	}

	// --- Event Handlers ---

	/** Check for Firefox for wheel delta scaling. */
	const isFirefox:boolean = navigator.userAgent.indexOf('Firefox') != -1;
	/** Handles mouse wheel events on the minimap for zooming. */
	function wheel(e:WheelEvent):void {
		camera.zoom(e.deltaY * (isFirefox ? 50 : 1)); // Apply zoom, scaling delta for Firefox
	}

	/** Flag indicating if the user is dragging on the minimap. */
	let dragging:boolean = $state(false);
	/** Cached bounding rect of the minimap canvas. */
	let mapRect:DOMRect|undefined;

	/** Starts the drag navigation on the minimap. */
	function dStart(e:MouseEvent): void {
		if(e.button != 0) return; // Ignore non-primary clicks
		// Add listeners to window for dragging outside the element
		window.addEventListener('mousemove', dDraw);
		window.addEventListener('mouseup', dStop);
		mapRect = _canvas!.getClientRects()[0]; // Cache minimap bounds
		
		// Cache current viewport dimensions to preserve them during drag
		const currentView = camera.getView();
		if (currentView) {
			dragViewDimensions = {
				width: currentView.width,
				height: currentView.height
			};
		}
		
		dDraw(e); // Process initial click position
		dragging = true;
	}

	/** Current viewport dimensions cached during drag start to preserve them. */
	let dragViewDimensions: { width: number; height: number } | undefined = $state();

	/** Handles mouse movement during minimap drag navigation. */
	function dDraw(e:MouseEvent): void {
		if(mapRect) {
			// Calculate relative coordinates within the minimap, clamped between 0 and 1
			const x = Math.max(0, Math.min(1, (e.clientX - mapRect.left) / mapRect.width));
			const y = Math.max(0, Math.min(1, (e.clientY - mapRect.top) / mapRect.height));
			
			if (dragViewDimensions) {
				// Create new view with updated center but preserved dimensions from drag start
				const newView: Models.Camera.View360 = {
					centerX: x,
					centerY: y,
					width: dragViewDimensions.width,
					height: dragViewDimensions.height
				};
				// Set the complete view to preserve viewport dimensions
				camera.setView(newView);
			} else {
				// Fallback to setCoo if dragViewDimensions wasn't captured (shouldn't happen)
				camera.setCoo(x, y);
			}
		}
	}

	/** Stops the drag navigation on the minimap. */
	function dStop(): void {
		// Remove window listeners
		window.removeEventListener('mousemove', dDraw);
		window.removeEventListener('mouseup', dStop);
		dragging = false;
		// Clear cached dimensions
		dragViewDimensions = undefined;
	}

	/** Timeout ID for auto-hiding. */
	let to:number|undefined;
	/** Resets the auto-hide timer when there's mouse activity over the main canvas. */
	function moved(): void {
		hidden = false; // Show minimap
		clearTimeout(to); // Clear existing timeout
		// Set new timeout to hide after delay
		to = <any>setTimeout(() => hidden = true, 2500) as number;
	}

	// --- Lifecycle (onMount) ---

	/** Calculate true north offset for background positioning. */
	const offset = .5 - image.camera.trueNorth;

	/** Check if cross-origin isolation is enabled (affects loading thumbnail). */
	const isolated = self.crossOriginIsolated;
	/** Store thumbnail source URL. May be updated later if loaded via fetch/blob. */
	let thumbSrc:string|undefined = $state(isolated ? undefined : image.thumbSrc);

	/** Passive event listener options. */
	const passive:AddEventListenerOptions = {passive: true};
	/** Flag indicating if the component has mounted. */
	let mounted = $state(false);

	onMount(() => {
		// Get 2D context
		_ctx = _canvas!.getContext('2d');
		if(_ctx) {
			_ctx.lineWidth = 1;
			_ctx.strokeStyle = 'white';
		}

		// Load thumbnail via fetch/blob if cross-origin isolated
		let dataUri:string|undefined;
		if(isolated && image.thumbSrc) {
			fetch(image.thumbSrc).then(r => r.blob())
				.then(b => thumbSrc = dataUri = URL.createObjectURL(b)); // Create blob URL
		}

		// Add listener for mouse movement over main canvas to reset auto-hide timer
		micrio.canvas.element.addEventListener('mousemove', moved, passive);
		// Subscribe to view changes to redraw the minimap
		const unsub = image.state.view.subscribe(draw);

		// Mark as mounted after a short delay (allows initial rendering)
		setTimeout(() => mounted = true, 10);

		// Cleanup function
		return () => {
			if(dataUri) URL.revokeObjectURL(dataUri); // Revoke blob URL if created
			micrio.canvas.element.removeEventListener('mousemove', moved, passive); // Remove listener
			dStop(); // Ensure drag listeners are removed
			unsub(); // Unsubscribe from view store
		}
	});

	// --- Reactive Styles ---

	/** Reactive style string for setting the background image and position. */
	const style = $derived(!thumbSrc ? null
		: `background-image: url('${thumbSrc}')`+(offset != 0 ? `;background-position-x:${width*offset}px` : '' )); // Apply true north offset to background

</script>

<!-- Minimap canvas element -->
<!-- Add class if controls are shown (for positioning) -->
<!-- Handle zoom -->
<!-- Handle drag navigation -->
<canvas
	bind:this={_canvas}
	{width} {height} {style}
	class:hidden={!mounted || $current != image || (autoHide && (zoomedOut||hidden))}
	class:dragging={dragging}
	class:controls={!noControls}
	onwheel={wheel}
	onmousedown={dStart}
></canvas>

<style>
	canvas {
		position: absolute;
		bottom: var(--micrio-border-margin);
		right: 5px; /* Default position */
		transform-origin: right bottom; /* Scale from bottom-right */
		display: block;
		background-size: 100%; /* Scale background image */
		transition: opacity .2s ease;
		cursor: move; /* Indicate draggable */
		cursor: -webkit-grab;
		cursor: -moz-grab;
		cursor: -ms-grab;
		cursor: grab;
		-ms-content-zooming: none; /* Disable IE touch zooming */
		-ms-touch-action: none; /* Disable IE touch actions */
		touch-action: none; /* Disable browser default touch actions */
		border-radius: var(--micrio-border-radius);
	}
	/* Hide minimap when hidden state is true and not hovered */
	canvas:not(:hover).hidden {
		opacity: 0;
		pointer-events: none;
	}
	/* Change cursor while dragging */
	canvas.dragging {
		cursor: -webkit-grabbing;
		cursor: -moz-grabbing;
		cursor: -ms-grabbing;
		cursor: grabbing;
	}
	/* Adjust position if main controls are visible */
	canvas.controls {
		right: calc(var(--micrio-border-margin) + var(--micrio-button-size) + 8px);
	}

	/* Scale down and disable interaction on smaller screens */
	@media (max-width: 800px) {
		canvas {
			transform: scale3d(.5,.5,1);
			pointer-events: none; /* Disable interaction */
			right: 65px; /* Adjust position */
		}
	}
</style>
