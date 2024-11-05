<script lang="ts">
	import type { MicrioImage } from '../../ts/image';
	import type { Unsubscriber } from 'svelte/store';
	import type { HTMLMicrioElement } from '../../ts/element';

	import { getContext, onMount } from 'svelte';

	import { once } from '../../ts/utils';
	import { i18n } from '../../ts/i18n';

	import Button from '../ui/Button.svelte';

	export let image:MicrioImage|undefined=undefined;

	const micrio = <HTMLMicrioElement>getContext('micrio');

	let isZoomedIn: boolean = false;
	let isZoomedOut: boolean = false;

	const gestured = () => {
		micrio.events.clicked = true;
	}
	const zoomIn = () => {
		gestured();
		image?.camera.zoomIn().then(() => micrio.events.clicked = false);
	}
	const zoomOut = () => {
		gestured();
		image?.camera.zoomOut().then(() => micrio.events.clicked = false);
	}

	function update() {
		isZoomedIn = image?.camera.isZoomedIn() ?? true;
		isZoomedOut = image?.camera.isZoomedOut(true) ?? true;
	}

	let loading = false;

	let unsub:Unsubscriber|undefined;
	let un:Unsubscriber|undefined;
	onMount(() => {
		if(image) image.state.view.subscribe(update);
		else un = micrio.current.subscribe(c => {
			if(unsub) { unsub(); unsub = undefined; }
			loading = true;
			if(image = c) once(c.info).then(() => {
				if(image) unsub = image.state.view.subscribe(update);
				loading = false;
			})
		})

		return () => {
			if(un) un();
			if(unsub) unsub();
		}
	});
</script>

{#if !isZoomedIn || !isZoomedOut}
	<Button type="zoom-in" title={$i18n.zoomIn} disabled={loading||isZoomedIn} on:click={zoomIn} />
	<Button type="zoom-out" title={$i18n.zoomOut} disabled={loading||isZoomedOut} on:click={zoomOut} />
{/if}
