<script lang="ts">
	import type { HTMLMicrioElement } from '../../ts/element';

	import { getContext, onMount } from 'svelte';
	import { Browser } from '../../ts/utils';
	import { i18n } from '../../ts/i18n';

	import Button from './Button.svelte'

	export let el:HTMLElement;

	const isNative: boolean = 'requestFullscreen' in el;
	const isWebkit:boolean = 'webkitRequestFullscreen' in el;

	const micrio = getContext<HTMLMicrioElement>('micrio');

	const getActiveEl = () : HTMLElement|undefined => isNative ? document.fullscreenElement
		/** @ts-ignore*/
		: document['webkitFullscreenElement'];

	let isActive: boolean = getActiveEl() == el;

	// webkit prefixed (Safari) cannot go 2 levels fullscreen deep
	const available = isNative || (isWebkit && !getActiveEl());

	const to = () : Promise<void> => new Promise(ok => setTimeout(ok, 500));

	let wasActive:HTMLElement|undefined;
	async function enter() {
		if(isNative) {
			// Safari 16.4+ does not allow switching active fs elements
			// So exit the previous one first
			if(Browser.safari && (wasActive = getActiveEl())) await document.exitFullscreen().then(to);
			el.requestFullscreen();
		}
		// Safari <16.4
		else if('webkitRequestFullscreen' in el)
			(<unknown>el['webkitRequestFullscreen'] as Function)();
	}

	async function exit() {
		if(isNative) {
			await document.exitFullscreen().then(to);
			if(wasActive) wasActive.requestFullscreen();
			wasActive = undefined;
		}
		else if('webkitExitFullscreen' in document)
			(<unknown>document['webkitExitFullscreen'] as Function)();
	}

	function toggle() {
		if(isActive) exit();
		else enter();
	}

	const addScrollZoom = el == micrio && !micrio.events.scrollHooked;
	const onchange = () : void => {
		isActive = getActiveEl() == el;
		if(addScrollZoom) {
			if(isActive) micrio.events.hookScroll();
			else micrio.events.unhookScroll();
		}
	};

	if(available) onMount(() => {
		const evt = isNative ? 'fullscreenchange' : 'webkitfullscreenchange';
		document.addEventListener(evt, onchange);
		return () => document.removeEventListener(evt, onchange);
	});
</script>

{#if available}<Button type={isActive ? 'minimize' : 'maximize'}
	title={$i18n.fullscreenToggle}
	on:click={toggle} />{/if}
