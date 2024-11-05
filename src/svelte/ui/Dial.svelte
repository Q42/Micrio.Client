<script lang="ts">
	import type { HTMLMicrioElement } from '../../ts/element';

	import { createEventDispatcher, getContext } from 'svelte';

	export let currentRotation:number;
	export let frames:number;
	export let degrees:boolean|undefined;

	const dispatch = createEventDispatcher();

	const micrio = <HTMLMicrioElement>getContext('micrio');
	const camera = micrio.$current!.camera;

	let _dial:HTMLElement;
	let pointerId:number|undefined;
	let startX:number = 0;
	let startRot:number = 0;

	function dStart(e:PointerEvent) {
		if(e.button != 0) return;
		micrio.addEventListener('pointermove', dMove);
		micrio.addEventListener('pointerup', dStop);
		micrio.setAttribute('data-panning','');
		micrio.setPointerCapture(pointerId=e.pointerId);
		startRot = currentRotation;
		startX = e.clientX;
	}

	function dMove(e:PointerEvent) {
		const scale = Math.max(1, (camera.getXY(1, .5)[0] - camera.getXY(0, .5)[0]) / micrio.offsetWidth);
		dispatch('turn', (startRot / 360 + ((startX - e.clientX) / (_dial.offsetWidth * scale))) * frames)
	}

	function dStop() {
		if(pointerId) micrio.releasePointerCapture(pointerId);
		micrio.removeAttribute('data-panning');
		micrio.removeEventListener('pointermove', dMove);
		micrio.removeEventListener('pointerup', dStop);
	}

	$: offset = -currentRotation / 360 * (_dial?.offsetWidth ?? 0);

</script>

<div bind:this={_dial} on:pointerdown|stopPropagation|preventDefault|capture={dStart} style="--micrio-dial-offset:{offset}px;" data-scroll-through>
	{#if degrees}<span>{Math.round(currentRotation*10)/10}º</span>{/if}
</div>

<style>
	div {
		position: absolute;
		bottom: var(--micrio-border-margin);
		width: 320px;
		max-width: calc(100vw - calc(2 * (var(--micrio-button-size) + 4 * var(--micrio-border-margin))));
		left: 50%;
		transform: translateX(-50%);
		height: calc(var(--micrio-button-size) * 0.6);
		touch-action: none;
		background-color: transparent;
		cursor: w-resize;
	}
	div::before,div::after {
		content: '';
		display: block;
		width: 100%;
		position: absolute;
		background-position: var(--micrio-dial-offset, 0px);
	}
	div::before {
		height: 50%;
		top: 25%;
		background-image: repeating-linear-gradient(to right, #8888 0%, #8888 0.5%, transparent 1%, transparent 2.5%);
	}
	div::after {
		height: 100%;
		background-image: repeating-linear-gradient(to right, #fff8 0%, #fff8 0.5%, transparent 1%, transparent 20%);
	}
	span {
		position: absolute;
		display: block;
		bottom: 0;
		line-height: calc(var(--micrio-button-size) * 0.6);
		left: 50%;
		transform: translateX(calc(-50% + 5px));
		color: var(--micrio-color);
		opacity: .85;
		pointer-events: none;
		text-shadow: 1px 1px 3px #000, -1px -1px 3px #000;
	}
</style>
