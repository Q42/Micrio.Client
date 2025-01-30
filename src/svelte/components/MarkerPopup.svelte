<script lang="ts">
	import type { HTMLMicrioElement } from '../../ts/element';
	import type { Models } from '../../types/models';
	import type { MicrioImage } from '../../ts/image';

	import { getContext, onMount, tick } from 'svelte';
	import { writable } from 'svelte/store';
	import { fly } from 'svelte/transition';
	import { i18n } from '../../ts/i18n';

	import Button from '../ui/Button.svelte';
	import ButtonGroup from '../ui/ButtonGroup.svelte';
	import MarkerContent from '../common/MarkerContent.svelte';

	export let marker:Models.ImageData.Marker;

	const micrio = <HTMLMicrioElement>getContext('micrio');
	const { current } = micrio;
	const tour = micrio.state.tour;

	const markerImages : WeakMap<Models.ImageData.Marker,MicrioImage> = getContext('markerImages');
	const image = markerImages.get(marker) as MicrioImage;
	const settings = image.$settings._markers ?? {};

	const data = marker.data || {};

	const canMinimize = settings.canMinimizePopup;

	let _cont:HTMLElement;

	function close(e?:Event){
		if ($tour && isPartOfTour && 'steps' in $tour) {
			// If tour controls in popup or last step, then close tour
			if(e instanceof Event && closeButtonStopsTour) tour.set(undefined);
			// Otherwise trigger next tour step
			else $tour.next?.();
		}
		else {
			// Navigate back if this was the original image opener
			// This will auto-close a still opened marker
			if($current && !image.opts.secondaryTo && $current.id != image.id && data.micrioLink?.id == $current.id) {
				micrio.open(image.id);
				image.state.marker.set(undefined);
				micrio.state.popup.set(undefined);
			} else image.state.marker.set(undefined);
		}
	}

	// Tour logic and controls
	$: isPartOfTour = $tour && 'steps' in $tour && $tour.steps.findIndex(s => s.startsWith(marker.id)) >= 0;
	$: showTourControls = $tour && 'steps' in $tour && isPartOfTour && !$tour.isSerialTour && settings.tourControlsInPopup;
	$: currentTourStep = ($tour && 'steps' in $tour ? $tour.currentStep : undefined) ?? -1;
	$: closeButtonStopsTour = showTourControls || $tour && 'steps' in $tour && $tour.currentStep == $tour.steps.length-1;

	let clickedPrevNext:boolean = false;

	const prev = () => { if($tour && 'steps' in $tour) { $tour.prev?.(); clickedPrevNext = true; } }
	const next = () => { if($tour && 'steps' in $tour) { $tour.next?.(); clickedPrevNext = true; } }

	let isMinimized:boolean = false;
	let _content:HTMLElement;
	let _title:HTMLElement;
	const originalHeights:WeakMap<HTMLElement, number> = new WeakMap();
	const toggleMinimize = () => {
		isMinimized = !isMinimized;
		for(let i=0;i<_content.children.length;i++) {
			const n = _content.children[i];
			if(n instanceof HTMLElement && n != _title) {
				if(!originalHeights.has(n)) {
					originalHeights.set(n, n.offsetHeight);
					n.style.height = n.offsetHeight+'px';
				}
				setTimeout(() => {
					n.style.height = isMinimized ? '0px' : originalHeights.get(n)+'px';
				},100)
			}
		}
	}


	// Stop any media play on fading out
	const destroying = writable<boolean>(false);

	onMount(() => {
		marker.tags.forEach(c => _cont.classList.add(c));
		setTimeout(() => _cont.querySelector('button')?.focus(), 500);
		const embeds = 'embedImages' in marker ? marker.embedImages as Models.ImageData.Embed[] : undefined;
		if(embeds) micrio.$current?.data.update(d => {
			if(!d) d = {embeds:[]};
			d.embeds = [...(d.embeds??[]), ...embeds];
			return d;
		});
		return () => {
			micrio.state.popup.subscribe(m => destroying.set(m != marker));
			if(embeds) micrio.$current?.data.update(d => {
				if(!d?.embeds) return;
				d.embeds = d.embeds.filter(e => !embeds.find(em => em.id == e.id));
				return d;
			})
		}
	})

</script>

<div transition:fly={settings.popupAnimation} bind:this={_cont} class:destroying={$destroying} class:minimized={isMinimized}>
	<aside>
		{#if !data.alwaysOpen}<Button type={(!isPartOfTour || closeButtonStopsTour) ? 'close' : 'arrow-right'}
			title={(!isPartOfTour || closeButtonStopsTour) ? $i18n.closeMarker : $i18n.tourStepNext}
			disabled={clickedPrevNext} on:click={close} />{/if}
		{#if canMinimize}<Button type="arrow-down" title={$i18n.minimize} on:click={toggleMinimize} />{/if}
		{#if showTourControls && $tour && 'steps' in $tour}
			<progress aria-hidden={true} value={(currentTourStep+1)/$tour.steps.length} class="progress"></progress>
			<ButtonGroup className="micrio-tour-controls">
				<Button type="arrow-left" disabled={clickedPrevNext || currentTourStep==0} title={$i18n.tourStepPrev} on:click={prev} />
				{#if settings.tourControlsInPopup}<button class="micrio-button tour-step" disabled>{currentTourStep+1} / {$tour.steps.length}</button>{/if}
				<Button type="arrow-right" disabled={clickedPrevNext || (currentTourStep+1==$tour.steps.length)} title={$i18n.tourStepNext} on:click={next} />
			</ButtonGroup>
		{/if}
	</aside>
	<MarkerContent {marker} {destroying} bind:_content bind:_title on:close={close} />
</div>

<style>
	div {
		display: block;
		cursor: auto;
		pointer-events: all;
		position: absolute;
		top: var(--micrio-border-margin);
		left: var(--micrio-border-margin);
	}

	div.destroying {
		pointer-events: none;
	}

	div > :global(main) {
		max-height: 80cqh;
	}

	aside {
		padding: var(--micrio-border-margin);
	}

	aside progress {
		display: none;
	}

	@media (min-width: 501px) {
		div {
			width: 440px;
			min-width: 20%;
		}
		aside {
			position: absolute;
			left: 100%;
			top: 0;
			padding-top: 0;
		}
	
		aside > :global(.micrio-button) {
			padding: 0;
			margin: 0 0 8px 0;
			display: block;
		}
	}

	@media (max-width: 500px) {
		aside {
			position: relative;
			padding: 0;
			display: flex;
			flex-direction: row-reverse;
			margin-bottom: var(--micrio-border-margin);
		}
		aside progress {
			display: block;
			flex: 1;
			opacity: 0;
			pointer-events: none;
		}
		aside :global(.micrio-tour-controls) {
			margin-bottom: 0 !important;
			display: flex;
		}
		aside :global(.micrio-button) {
			display: block !important;
			height: var(--micrio-button-size);
			padding: 0 !important;
		}
		div {
			top: var(--micrio-border-margin);
			right: var(--micrio-border-margin);
			left: var(--micrio-border-margin);
		}
		div > :global(main) {
			max-height: calc(100cqh - var(--micrio-button-size) - 3 * var(--micrio-border-margin));
			max-height: calc(100cqh - var(--micrio-button-size) - 3 * var(--micrio-border-margin));
			box-sizing: border-box;
		}
	}

	div > :global(main > *:not(h3)) {
		transition-property: margin-top, margin-bottom, height, opacity;
		transition-duration: .5s;
		transition-timing-function: ease;
		overflow: hidden;
	}

	div.minimized > :global(main > *:not(h3)) {
		margin-top: 0;
		margin-bottom: 0;
		opacity: 0;
	}

	button.tour-step {
		height: auto;
		line-height: normal;
		vertical-align: middle;
	}
</style>
