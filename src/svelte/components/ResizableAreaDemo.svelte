<script lang="ts">
	/**
	 * ResizableAreaDemo.svelte - Demo component showing how to use ResizableArea
	 * 
	 * This demonstrates integration with the Micrio image system and provides
	 * a simple interface for testing the resizable area functionality.
	 */

	import type { MicrioImage } from '../../ts/image';
	import ResizableArea from './ResizableArea.svelte';
	import { onMount } from 'svelte';

	// --- Props ---
	interface Props {
		/** The MicrioImage instance */
		image: MicrioImage;
		/** Whether to show the demo controls */
		showControls?: boolean;
	}

	let {
		image = $bindable(),
		showControls = true
	}: Props = $props();

	// --- State ---
	let areaVisible = $state(true);
	let lockAspectRatio = $state(false);
	let areaState = $state({
		centerX: 0.5,
		centerY: 0.5,
		width: 0.2,
		height: 0.2
	});

	// --- Event Handlers ---
	function handleAreaUpdate(newState: typeof areaState) {
		areaState = { ...newState };
		//console.log('Area updated:', areaState);
	}

	function resetArea() {
		areaState = {
			centerX: 0.5,
			centerY: 0.5,
			width: 0.2,
			height: 0.2
		};
	}

	function randomizeArea() {
		const minSize = 0.1;
		const maxSize = 0.4;
		const w = minSize + Math.random() * (maxSize - minSize);
		const h = minSize + Math.random() * (maxSize - minSize);
		
		areaState = {
			centerX: w/2 + Math.random() * (1 - w),
			centerY: h/2 + Math.random() * (1 - h),
			width: w,
			height: h
		};
	}

	// --- Reactive Values ---
	const areaInfo = $derived({
		area: (areaState.width * areaState.height * 100).toFixed(1),
		aspectRatio: (areaState.width / areaState.height).toFixed(2)
	});

</script>

<!-- Resizable Area Component -->
{#if image}
	<ResizableArea
		{image}
		centerX={areaState.centerX}
		centerY={areaState.centerY}
		width={areaState.width}
		height={areaState.height}
		{lockAspectRatio}
		visible={areaVisible}
		minSize={0.05}
		maxSize={0.8}
		class="demo-area"
		onUpdate={handleAreaUpdate}
	/>
{/if}

<!-- Demo Controls -->
{#if showControls}
	<div class="demo-controls">
		<h3>Resizable Area Demo</h3>
		
		<div class="control-group">
			<label>
				<input type="checkbox" bind:checked={areaVisible} />
				Show Area
			</label>
			
			<label>
				<input type="checkbox" bind:checked={lockAspectRatio} />
				Lock Aspect Ratio
			</label>
		</div>

		<div class="control-group">
			<h4>Position & Size</h4>
			<div class="input-row">
				<label>
					Center X:
					<input 
						type="range" 
						min="0" 
						max="1" 
						step="0.01"
						bind:value={areaState.centerX}
					/>
					<span>{areaState.centerX.toFixed(2)}</span>
				</label>
			</div>
			
			<div class="input-row">
				<label>
					Center Y:
					<input 
						type="range" 
						min="0" 
						max="1" 
						step="0.01"
						bind:value={areaState.centerY}
					/>
					<span>{areaState.centerY.toFixed(2)}</span>
				</label>
			</div>
			
			<div class="input-row">
				<label>
					Width:
					<input 
						type="range" 
						min="0.05" 
						max="0.8" 
						step="0.01"
						bind:value={areaState.width}
					/>
					<span>{areaState.width.toFixed(2)}</span>
				</label>
			</div>
			
			<div class="input-row">
				<label>
					Height:
					<input 
						type="range" 
						min="0.05" 
						max="0.8" 
						step="0.01"
						bind:value={areaState.height}
					/>
					<span>{areaState.height.toFixed(2)}</span>
				</label>
			</div>
		</div>

		<div class="control-group">
			<h4>Info</h4>
			<div class="info-item">
				<strong>Area:</strong> {areaInfo.area}% of image
			</div>
			<div class="info-item">
				<strong>Aspect Ratio:</strong> {areaInfo.aspectRatio}
			</div>
		</div>

		<div class="control-group">
			<button onclick={resetArea}>Reset</button>
			<button onclick={randomizeArea}>Randomize</button>
		</div>
	</div>
{/if}

<style>
	.demo-controls {
		position: fixed;
		top: 20px;
		right: 20px;
		background: rgba(0, 0, 0, 0.8);
		color: white;
		padding: 20px;
		border-radius: 8px;
		min-width: 280px;
		max-width: 320px;
		font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
		font-size: 14px;
		z-index: 1000;
		backdrop-filter: blur(8px);
		border: 1px solid rgba(255, 255, 255, 0.2);
	}

	.demo-controls h3 {
		margin: 0 0 15px 0;
		font-size: 16px;
		font-weight: 600;
	}

	.demo-controls h4 {
		margin: 15px 0 10px 0;
		font-size: 14px;
		font-weight: 500;
		color: rgba(255, 255, 255, 0.9);
	}

	.control-group {
		margin-bottom: 15px;
	}

	.control-group:last-child {
		margin-bottom: 0;
	}

	.control-group label {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 8px;
		cursor: pointer;
	}

	.input-row {
		margin-bottom: 10px;
	}

	.input-row label {
		display: grid;
		grid-template-columns: 60px 1fr 40px;
		gap: 8px;
		align-items: center;
		font-size: 12px;
	}

	input[type="checkbox"] {
		width: 16px;
		height: 16px;
	}

	input[type="range"] {
		flex: 1;
		min-width: 0;
	}

	.input-row span {
		font-family: monospace;
		font-size: 11px;
		color: rgba(255, 255, 255, 0.8);
	}

	.info-item {
		font-size: 12px;
		margin-bottom: 5px;
		color: rgba(255, 255, 255, 0.9);
	}

	button {
		background: rgba(66, 165, 245, 0.8);
		color: white;
		border: none;
		padding: 8px 16px;
		border-radius: 4px;
		cursor: pointer;
		font-size: 12px;
		margin-right: 8px;
		transition: background-color 0.2s ease;
	}

	button:hover {
		background: rgba(66, 165, 245, 1);
	}

	button:active {
		background: rgba(33, 150, 243, 1);
	}

</style>