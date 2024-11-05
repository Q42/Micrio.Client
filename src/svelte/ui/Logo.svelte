<script lang="ts">
	import type { HTMLMicrioElement } from '../../ts/element';

	import { getContext, onMount } from 'svelte';
	import { fade } from 'svelte/transition';

	const micrio = <HTMLMicrioElement>getContext('micrio');
	const { tour, marker } = micrio.state;

	const target = !/micr\.io/.test(location.origin) || self.parent != self
		? '_blank'
		: undefined;

	let loading:boolean = false;
	let to:any;

	onMount(() => micrio.loading.subscribe(l => {
		clearTimeout(to);
		if(!l) loading = false;
		else if(!loading) to = setTimeout(() => loading = true, 750);
	}));

	$: hidden = !!$tour || !!$marker;
</script>

{#if !hidden}<a rel="noopener" href="https://micr.io/" transition:fade={{duration: 200}}
	title="Powered by Micrio" aria-label="Micrio homepage"
	class:loading {target}>
</a>{/if}

<style>
	a {
		position: absolute;
		top: calc(var(--micrio-border-margin) * 2);
		left: calc(var(--micrio-border-margin) * 2);
		width: 22px;
		height: 22px;
		transition: transform .25s ease;
		z-index: 2;
		display: block;
	}

	a:hover {
		transform: rotate3d(0,0,1,-90deg);
	}

	a::before,a::after {
		display: block;
		content: '';
		position: absolute;
		transform: rotate3d(0,0,1,45deg);
		will-change: transform;
		box-sizing: unset;
	}

	a::before {
		border: 3px solid #00d4ee;
		width: 16px;
		height: 16px;
	}
	a.loading::before {
		animation: spin 1s infinite ease-out;
	}

	a::after {
		top: 8px;
		left: 8px;
		width: 6px;
		height: 6px;
		background: #c5ff5b;
		outline: 1px solid #c5ff5b;
	}
	a.loading::after {
		animation: spin .5s infinite ease-out;
	}

	@keyframes spin {
		from {
			transform: rotate3d(0,0,1,45deg);
		}
		to {
			transform: rotate3d(0,0,1,135deg);
		}
	}
</style>
