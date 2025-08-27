<script lang="ts">
	/**
	 * ResizableArea.svelte - A resizable round/elliptical area overlay for Micrio images.
	 * 
	 * This component creates an interactive circular/elliptical area that users can move and resize.
	 * It automatically follows pan and zoom transformations by subscribing to the image's view state.
	 * Supports both 2D and 360-degree images through the existing coordinate transformation system.
	 */

	import type { MicrioImage } from '../../ts/image';
	import { onMount, tick } from 'svelte';

	// --- Props ---
	interface Props {
		/** The MicrioImage instance this area belongs to */
		image: MicrioImage;
		/** Initial center X coordinate (0-1 relative to image) */
		centerX?: number;
		/** Initial center Y coordinate (0-1 relative to image) */
		centerY?: number;
		/** Initial width (0-1 relative to image) */
		width?: number;
		/** Initial height (0-1 relative to image) */
		height?: number;
		/** Minimum size constraint (0-1 relative to image) */
		minSize?: number;
		/** Maximum size constraint (0-1 relative to image) */
		maxSize?: number;
		/** Whether to maintain aspect ratio when resizing */
		lockAspectRatio?: boolean;
		/** Custom CSS class for styling */
		class?: string;
		/** Whether the area is visible */
		visible?: boolean;
		/** Callback fired when area properties change */
		onUpdate?: (area: AreaState) => void;
	}

	let {
		image = $bindable(),
		centerX = 0.5,
		centerY = 0.5,
		width = 0.2,
		height = 0.2,
		minSize = 0.05,
		maxSize = 0.8,
		lockAspectRatio = false,
		class: className = '',
		visible = true,
		onUpdate
	}: Props = $props();

	// --- State Management ---
	interface AreaState {
		centerX: number;
		centerY: number;
		width: number;
		height: number;
	}

	/** Current area state in image coordinates */
	let areaState: AreaState = $state({
		centerX,
		centerY,
		width,
		height
	});

	/** Screen coordinates for positioning */
	let screenPos = $state({
		x: 0,
		y: 0,
		w: 100,
		h: 100,
		scale: 1
	});

	/** CSS style for positioning (2D or 3D matrix) */
	let positionStyle = $state('');

	/** Interaction state */
	let isDragging = $state(false);
	let isResizing = $state(false);
	let dragType: 'move' | 'resize-nw' | 'resize-ne' | 'resize-sw' | 'resize-se' | 'resize-n' | 'resize-s' | 'resize-e' | 'resize-w' | null = $state(null);
	let dragStart = $state({ x: 0, y: 0, areaX: 0, areaY: 0, areaW: 0, areaH: 0 });

	/** Element references */
	let containerEl: HTMLDivElement|undefined = $state();
	let areaEl: HTMLDivElement|undefined = $state();

	// --- Coordinate Transformation ---

	/** Converts image coordinates to screen coordinates */
	function imageToScreen(imgX: number, imgY: number): [number, number] {
		const coords = image.camera.getXY(imgX, imgY);
		return [coords[0], coords[1]];
	}

	/** Converts screen coordinates to image coordinates */
	function screenToImage(screenX: number, screenY: number): [number, number] {
		const coords = image.camera.getCoo(screenX, screenY);
		return [coords[0], coords[1]];
	}

	/** Updates screen position based on current area state */
	function updateScreenPosition() {
		if (!image || !visible) return;

		if (image.is360) {
			// For 360 images, use 3D matrix transformation like Waypoint component
			// Calculate a more aggressive base scale to make areas appear larger
			// The factor 5 makes a 0.2 area appear much more prominent on the sphere
			const baseScale = Math.min(areaState.width, areaState.height) * image.$info!.width / 1024 * 5;
			
			const matrix = image.camera.getMatrix(
				areaState.centerX, 
				areaState.centerY, 
				baseScale, // Use calculated base scale
				1, // radius 
				0, // rotX
				0, // rotY 
				0, // rotZ
				undefined, // transY
				1, // scaleX
				1  // scaleY
			);
			
			// Check if behind camera using the standard coordinate transformation
			const coords = image.camera.getXYDirect(areaState.centerX, areaState.centerY);
			const depth = coords[3]; // w/depth value from coordinate transformation
			if (depth > 0) {
				// Hide the area by setting it off-screen
				screenPos = {
					x: -9999,
					y: -9999,
					w: 0,
					h: 0,
					scale: 0
				};
				positionStyle = 'transform: matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,-9999,-9999,0,1);';
				return;
			}

			// For 360 mode, use larger pixel dimensions to make the area more visible
			// Scale up significantly from the relative size
			const pixelWidth = areaState.width * 2000; // Increased from 1000 to 2000
			const pixelHeight = areaState.height * 2000;

			screenPos = {
				x: 0, // Not used in 360 mode
				y: 0, // Not used in 360 mode  
				w: pixelWidth,
				h: pixelHeight,
				scale: baseScale // Use base scale for interaction calculations
			};

			// Apply the 3D matrix transformation (like Waypoint does)
			positionStyle = `transform: matrix3d(${matrix.join(',')});`;
		} else {
			// For 2D images, use standard screen coordinate transformation
			const coords = image.camera.getXYDirect(areaState.centerX, areaState.centerY);
			const [centerScreenX, centerScreenY] = [coords[0], coords[1]];
			
			// Calculate screen dimensions based on current scale
			const scale = image.camera.getScale();
			const screenWidth = areaState.width * image.$info!.width * scale;
			const screenHeight = areaState.height * image.$info!.height * scale;

			screenPos = {
				x: centerScreenX,
				y: centerScreenY,
				w: screenWidth,
				h: screenHeight,
				scale
			};

			// Use 2D positioning
			positionStyle = `
				left: ${centerScreenX - screenWidth/2}px;
				top: ${centerScreenY - screenHeight/2}px;
				width: ${screenWidth}px;
				height: ${screenHeight}px;
			`;
		}
	}

	// --- Event Handlers ---

	/** Handle mouse/touch start on the area */
	function handlePointerDown(event: PointerEvent, type: typeof dragType) {
		if(!containerEl || !areaEl) return;
		
		// Only respond to left mouse button (button 0) or touch events
		if (event.button !== undefined && event.button !== 0) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();

		dragType = type;
		isDragging = type === 'move';
		isResizing = type !== 'move';

		// Store starting positions
		const rect = containerEl.getBoundingClientRect();
		dragStart = {
			x: event.clientX - rect.left,
			y: event.clientY - rect.top,
			areaX: areaState.centerX,
			areaY: areaState.centerY,
			areaW: areaState.width,
			areaH: areaState.height
		};

		// Capture pointer for consistent tracking
		areaEl.setPointerCapture(event.pointerId);

		// Add global listeners
		document.addEventListener('pointermove', handlePointerMove);
		document.addEventListener('pointerup', handlePointerUp);
	}

	/** Handle pointer movement during drag/resize */
	function handlePointerMove(event: PointerEvent) {
		if (!dragType || !containerEl) return;

		const rect = containerEl.getBoundingClientRect();
		const currentX = event.clientX - rect.left;
		const currentY = event.clientY - rect.top;
		const deltaX = currentX - dragStart.x;
		const deltaY = currentY - dragStart.y;

		if (dragType === 'move') {
			// Convert screen delta to image coordinates
			const [startImgX, startImgY] = screenToImage(dragStart.x, dragStart.y);
			const [currentImgX, currentImgY] = screenToImage(currentX, currentY);
			
			// Calculate new center position without boundary constraints first
			let newCenterX = dragStart.areaX + (currentImgX - startImgX);
			let newCenterY = dragStart.areaY + (currentImgY - startImgY);
			
			// Apply boundary constraints - allow center to reach edges (0,0) to (1,1)
			newCenterX = Math.max(0, Math.min(1, newCenterX));
			newCenterY = Math.max(0, Math.min(1, newCenterY));

			areaState.centerX = newCenterX;
			areaState.centerY = newCenterY;
		} else {
			// Handle resize
			handleResize(deltaX, deltaY);
		}

		updateScreenPosition();
		onUpdate?.(areaState);
	}

	/** Handle resize logic for different handle types */
	function handleResize(deltaX: number, deltaY: number) {
		if (!dragType || dragType === 'move') return;

		// Convert screen deltas to image space
		const scale = image.camera.getScale();
		const imgDeltaX = deltaX / (image.$info!.width * scale);
		const imgDeltaY = deltaY / (image.$info!.height * scale);

		let newWidth = dragStart.areaW;
		let newHeight = dragStart.areaH;
		let newCenterX = dragStart.areaX;
		let newCenterY = dragStart.areaY;

		// Apply resize based on handle type
		switch (dragType) {
			case 'resize-nw':
				newWidth = Math.max(minSize!, dragStart.areaW - imgDeltaX);
				newHeight = Math.max(minSize!, dragStart.areaH - imgDeltaY);
				newCenterX = dragStart.areaX + imgDeltaX / 2;
				newCenterY = dragStart.areaY + imgDeltaY / 2;
				break;
			case 'resize-ne':
				newWidth = Math.max(minSize!, dragStart.areaW + imgDeltaX);
				newHeight = Math.max(minSize!, dragStart.areaH - imgDeltaY);
				newCenterX = dragStart.areaX + imgDeltaX / 2;
				newCenterY = dragStart.areaY + imgDeltaY / 2;
				break;
			case 'resize-sw':
				newWidth = Math.max(minSize!, dragStart.areaW - imgDeltaX);
				newHeight = Math.max(minSize!, dragStart.areaH + imgDeltaY);
				newCenterX = dragStart.areaX + imgDeltaX / 2;
				newCenterY = dragStart.areaY + imgDeltaY / 2;
				break;
			case 'resize-se':
				newWidth = Math.max(minSize!, dragStart.areaW + imgDeltaX);
				newHeight = Math.max(minSize!, dragStart.areaH + imgDeltaY);
				newCenterX = dragStart.areaX + imgDeltaX / 2;
				newCenterY = dragStart.areaY + imgDeltaY / 2;
				break;
			case 'resize-n':
				newHeight = Math.max(minSize!, dragStart.areaH - imgDeltaY);
				newCenterY = dragStart.areaY + imgDeltaY / 2;
				break;
			case 'resize-s':
				newHeight = Math.max(minSize!, dragStart.areaH + imgDeltaY);
				newCenterY = dragStart.areaY + imgDeltaY / 2;
				break;
			case 'resize-e':
				newWidth = Math.max(minSize!, dragStart.areaW + imgDeltaX);
				newCenterX = dragStart.areaX + imgDeltaX / 2;
				break;
			case 'resize-w':
				newWidth = Math.max(minSize!, dragStart.areaW - imgDeltaX);
				newCenterX = dragStart.areaX + imgDeltaX / 2;
				break;
		}

		// Apply aspect ratio lock if enabled
		if (lockAspectRatio) {
			const aspectRatio = dragStart.areaW / dragStart.areaH;
			if (dragType.includes('n') || dragType.includes('s')) {
				newWidth = newHeight * aspectRatio;
			} else {
				newHeight = newWidth / aspectRatio;
			}
		}

		// Apply size constraints
		newWidth = Math.max(minSize!, Math.min(maxSize!, newWidth));
		newHeight = Math.max(minSize!, Math.min(maxSize!, newHeight));

		// Keep center within image bounds [0,1] - allow circle to extend outside if needed
		newCenterX = Math.max(0, Math.min(1, newCenterX));
		newCenterY = Math.max(0, Math.min(1, newCenterY));

		areaState.width = newWidth;
		areaState.height = newHeight;
		areaState.centerX = newCenterX;
		areaState.centerY = newCenterY;
	}

	/** Handle pointer release */
	function handlePointerUp(event: PointerEvent) {
		if(!containerEl || !areaEl) return;
		
		dragType = null;
		isDragging = false;
		isResizing = false;

		// Remove global listeners
		document.removeEventListener('pointermove', handlePointerMove);
		document.removeEventListener('pointerup', handlePointerUp);

		// Release pointer capture
		areaEl.releasePointerCapture(event.pointerId);
	}

	// --- Lifecycle ---

	onMount(() => {
		// Subscribe to view changes for automatic repositioning
		const unsubscribe = image.state.view.subscribe(() => {
			tick().then(updateScreenPosition);
		});

		// Initial position calculation
		updateScreenPosition();

		return unsubscribe;
	});

	// --- Reactive Updates ---

	// Update area state when props change
	$effect(() => {
		areaState.centerX = centerX;
		areaState.centerY = centerY;
		areaState.width = width;
		areaState.height = height;
		updateScreenPosition();
	});
</script>

<!-- Main container -->
{#if visible && image}
	<div 
		bind:this={containerEl}
		class="resizable-area-container {className}"
		style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none;"
	>
		<!-- Area element -->
		<div
			bind:this={areaEl}
			class="resizable-area"
			class:dragging={isDragging}
			class:resizing={isResizing}
			class:behind-camera={screenPos.scale === 0}
			class:is360={image.is360}
			style="
				{image.is360 ? 
					`position: absolute; top: 50%; left: 50%; width: 0; height: 0; ${positionStyle}` :
					`position: absolute; ${positionStyle}`
				}
				pointer-events: {screenPos.scale === 0 ? 'none' : 'all'};
				touch-action: none;
				visibility: {screenPos.scale === 0 ? 'hidden' : 'visible'};
			"
		>
			<!-- Main area - click anywhere on rectangle to move -->
			<div 
				data-scroll-through
				class="area-body"
				role="button"
				tabindex="0"
				onpointerdown={(e) => handlePointerDown(e, 'move')}
				style="{image.is360 ? `width: ${screenPos.w}px; height: ${screenPos.h}px;` : ''}"
			>
				<!-- Resize handles -->
				<div class="resize-handles">
					<!-- Corner handles -->
					<div class="resize-handle nw" onpointerdown={(e) => handlePointerDown(e, 'resize-nw')}></div>
					<div class="resize-handle ne" onpointerdown={(e) => handlePointerDown(e, 'resize-ne')}></div>
					<div class="resize-handle sw" onpointerdown={(e) => handlePointerDown(e, 'resize-sw')}></div>
					<div class="resize-handle se" onpointerdown={(e) => handlePointerDown(e, 'resize-se')}></div>
					
					<!-- Edge handles -->
					<div class="resize-handle n" onpointerdown={(e) => handlePointerDown(e, 'resize-n')}></div>
					<div class="resize-handle s" onpointerdown={(e) => handlePointerDown(e, 'resize-s')}></div>
					<div class="resize-handle e" onpointerdown={(e) => handlePointerDown(e, 'resize-e')}></div>
					<div class="resize-handle w" onpointerdown={(e) => handlePointerDown(e, 'resize-w')}></div>
				</div>
			</div>
		</div>
	</div>
{/if}

<style>
	.resizable-area-container {
		z-index: 100;
		perspective: inherit;
	}

	.resizable-area {
		cursor: move;
		min-width: 20px;
		min-height: 20px;
	}

	.resizable-area.behind-camera {
		display: none;
	}

	/* 360-degree specific styling - match Waypoint approach */
	.resizable-area.is360 {
		/* Enable 3D positioning like Waypoint */
		transform-style: preserve-3d;
		/* Width/height 0 for transform origin positioning like Waypoint */
		width: 0 !important;
		height: 0 !important;
		top: 50% !important;
		left: 50% !important;
	}

	/* In 360 mode, center the content within the transformed container */
	.resizable-area.is360 .area-body {
		/* Center the area relative to the transform origin like Waypoint button */
		transform: translate(-50%, -50%);
		position: relative;
	}

	.area-body {
		width: 100%;
		height: 100%;
		border-radius: 4px; /* Small rounded corners for rectangle */
		position: relative;
		/* Visual styling for the rectangle */
		border: 2px solid rgba(66, 165, 245, 0.8);
		background: rgba(66, 165, 245, 0.1);
		box-sizing: border-box;
		/* Only transition colors, not position/transform properties */
		transition: border-color 0.2s ease, background-color 0.2s ease;
	}

	.area-body:hover {
		border-color: rgba(66, 165, 245, 1);
		background: rgba(66, 165, 245, 0.15);
	}

	.resizable-area.dragging .area-body {
		border-color: rgba(33, 150, 243, 1);
		background: rgba(33, 150, 243, 0.2);
	}

	.resizable-area.resizing .area-body {
		border-color: rgba(33, 150, 243, 1);
	}

	.resize-handles {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
	}

	.resize-handle {
		position: absolute;
		background: rgba(66, 165, 245, 0.9);
		border: 1px solid white;
		border-radius: 50%;
		width: 8px;
		height: 8px;
		pointer-events: all;
		transition: all 0.2s ease;
		transform: translate(-50%, -50%);
	}

	.resize-handle:hover {
		background: rgba(33, 150, 243, 1);
		width: 10px;
		height: 10px;
	}

	/* Corner handles */
	.resize-handle.nw {
		top: 0;
		left: 0;
		cursor: nw-resize;
	}

	.resize-handle.ne {
		top: 0;
		right: 0;
		left: auto;
		transform: translate(50%, -50%);
		cursor: ne-resize;
	}

	.resize-handle.sw {
		bottom: 0;
		left: 0;
		top: auto;
		transform: translate(-50%, 50%);
		cursor: sw-resize;
	}

	.resize-handle.se {
		bottom: 0;
		right: 0;
		top: auto;
		left: auto;
		transform: translate(50%, 50%);
		cursor: se-resize;
	}

	/* Edge handles */
	.resize-handle.n {
		top: 0;
		left: 50%;
		cursor: n-resize;
	}

	.resize-handle.s {
		bottom: 0;
		left: 50%;
		top: auto;
		transform: translate(-50%, 50%);
		cursor: s-resize;
	}

	.resize-handle.e {
		right: 0;
		top: 50%;
		left: auto;
		transform: translate(50%, -50%);
		cursor: e-resize;
	}

	.resize-handle.w {
		left: 0;
		top: 50%;
		cursor: w-resize;
	}

	/* Hide handles on small sizes */
	.resizable-area[style*="width: 20px"], 
	.resizable-area[style*="width: 1"], 
	.resizable-area[style*="width: 2"] {
		.resize-handle {
			display: none;
		}
	}

	/* Accessibility */
	.area-body:focus {
		outline: 2px solid rgba(66, 165, 245, 0.8);
		outline-offset: 2px;
	}

	/* Custom styling support */
	:global(.resizable-area-custom) .resizable-area {
		border-color: var(--area-border-color, rgba(66, 165, 245, 0.8));
		background: var(--area-background, rgba(66, 165, 245, 0.1));
	}

	:global(.resizable-area-custom) .resize-handle {
		background: var(--handle-color, rgba(66, 165, 245, 0.9));
	}
</style>