<script lang="ts">
	import { fade } from 'svelte/transition';

	export let progress:number;

	const size:number = 100;
	const radius = 40;
	const circ = 2 * Math.PI * radius;

	$: offset = circ * (1-progress);

</script>

<svg in:fade={{delay: 500}} out:fade width="100" height="100" viewBox="0 0 {size} {size}">
	<circle r={radius} cx={size/2} cy={size/2} fill="transparent" stroke="#e0e0e0" stroke-width="8px"></circle>
	<circle r={radius} cx={size/2} cy={size/2} fill="transparent" stroke="#00d4ee" stroke-width="8px" stroke-dasharray="{circ}px" stroke-dashoffset="{offset}px"></circle>
</svg>

<style>
	svg {
		position: absolute;
		top: 50%;
		left: 50%;
		pointer-events: none;
		transform: translate(-50%,-50%) rotateZ(-90deg);
	}
	circle {
		transition: stroke-dashoffset .25s ease;
	}
</style>
