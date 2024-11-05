<script lang="ts">
	import type { Models } from '../../types/models';
	import type { HTMLMicrioElement } from '../../ts/element';
	import type { MicrioImage } from '../../ts/image';
	import { writable, type Unsubscriber } from 'svelte/store';

	import { getContext, onMount, tick, createEventDispatcher } from 'svelte';
	import { fade } from 'svelte/transition';
	import { i18n } from '../../ts/i18n';
	import { loadSerialTour } from '../../ts/utils';

	import Media from '../components/Media.svelte';
	import Button from '../ui/Button.svelte';
	import MarkerPopup from '../components/MarkerPopup.svelte';
	import SerialTour from './SerialTour.svelte';

	export let tour:Models.ImageData.MarkerTour|Models.ImageData.VideoTour;
	export let noHTML:boolean = false;

	const dispatch = createEventDispatcher();

	const micrio:HTMLMicrioElement = <HTMLMicrioElement>getContext('micrio');
	const { events, state, _lang } = micrio;

	const image = micrio.$current as MicrioImage;
	const data = image.$data as Models.ImageData.ImageData;
	const settings = image.$settings;
	const grid = micrio.canvases[0].grid;

	// EDGE CASE. If a marker inside a marker tour has a link to another image,
	// it will not be micrio.state.marker when opened.
	const markerCurrentImage = image.state.marker;

	const isSerialTour = 'steps' in tour && tour.isSerialTour;
	const isVideoTour = !('steps' in tour);
	const isScrollTour = 'scrollable' in tour && tour.scrollable;
	const noControls = 'steps' in tour ? 'controls' in tour ? tour.controls !== false : !tour.noControls : false;

	// If marker tour controls are not in marker popup
	const isIndependent = !(!isSerialTour && 'steps' in tour && settings._markers?.tourControlsInPopup);
	const hideMainControls = isIndependent && (isVideoTour || isSerialTour);

	// Don't close the marker popup when switching
	const keepPopup = !!settings._markers?.keepPopupsDuringTourTransitions;

	const prev = () => goto(currentTourStep - 1);
	const next = () => goto(currentTourStep + 1);
	const hookCam = () => events.enabled.set(true);

	let _deferTo:any;

	function goto(idx:number) {
		if(!('steps' in tour) || !tour.stepInfo) return;
		const step = tour.stepInfo[idx];

		// If target marker is already opened (marker could have started this tour itself),
		// only open the target image, further do nothing
		if(step && step.markerId == micrio.state.$marker?.id)
			return openStepImage(step);

		// Close current marker
		const currStepImage = tour.stepInfo[currentTourStep]?.micrioImage?.state;
		if(currStepImage) currStepImage.marker.set(undefined);
		micrio.$current?.state.marker.set(undefined);
		if(!keepPopup) micrio.state.popup.set(undefined);
		micrio.removeEventListener('marker-opened', hookCam);
		markerCurrentImage.set(undefined);
		if(step) _deferTo = setTimeout(openStep, 200, step);
	}

	async function openStepImage(step:Models.ImageData.MarkerTourStepInfo) : Promise<[MicrioImage, boolean]> {
		let img:MicrioImage = image;
		let isAborted:boolean = false;
		if(grid && !step.gridView && grid.images.find(i => i.id == step.micrioId)) {
			const isPrevStep = 'steps' in tour && tour.stepInfo && step ? tour.stepInfo?.indexOf(step) < currentTourStep : false;
			const trans:Models.Grid.MarkerFocusTransition = step.marker.data?.gridTourTransition ?? step.marker.data?._meta?.gridTourTransition;
			const slswipe = trans?.startsWith('slide') ? 'slide' : 'swipe';
			await tick().then(() => {
				const promise = grid.focus(img = grid.images.find(i => i.id == step.micrioId) as MicrioImage, {
					view: step.startView,
					transition: trans == slswipe || trans == `${slswipe}-horiz` ? isPrevStep ? `${slswipe}-left` : `${slswipe}-right`
						: trans == `${slswipe}-vert` ? isPrevStep ? `${slswipe}-up` : `${slswipe}-down`
						: trans == 'behind' ? isPrevStep ? 'behind-left' : 'behind-right'
						: trans
				}).catch(() => isAborted = true);
				micrio.events.enabled.set(false);
				return promise;
			});
		}
		else if(micrio.$current?.id != step.micrioId) {
			// If stays in grid, and has custom action, immediately execute
			if(step.gridView && step.marker.data?._meta?.gridAction && grid) {
				if(!step.micrioImage) step.micrioImage = grid.images.find(i => i.id == step.micrioId);
				img = step.micrioImage as MicrioImage;
				const a = step.marker.data._meta.gridAction.split('|');
				grid.action(a.shift() as string,a.join('|'));
			}
			else {
				// Already set currentTourStep to new value so the next marker in the new image will pick this up
				if('steps' in tour && tour.stepInfo) currentTourStep = tour.stepInfo.indexOf(step);
				img = micrio.open(step.micrioId, { gridView: step.gridView, startView: step.startView });
			}
			await tick();
		}
		else img = micrio.$current;

		return [img, isAborted];
	}

	async function openStep(step:Models.ImageData.MarkerTourStepInfo) : Promise<void> {
		let img:MicrioImage = image;
		let isAborted:boolean = false;
		if(step.micrioId) [img, isAborted] = await openStepImage(step);
		if(isAborted) return;
		if(!step.micrioImage) step.micrioImage = img;
		events.enabled.set(false);
		img.state.marker.set(step.markerId);
		micrio.addEventListener('marker-opened', hookCam, { once: true });
		await tick();
		events.dispatch('tour-step', tour);
	}

	function exit(){
		state.tour.set(undefined);
	}

	// Video tour ended
	function ended(){
		events.dispatch('tour-ended', tour);
		if(tour.closeOnFinish) exit();
	}

	// Currentstep getter/setter
	if('steps' in tour) {
		tour.prev = prev;
		tour.next = next;
		tour.goto = goto;
		Object.defineProperty(tour, 'currentStep', {
			configurable: true,
			get(){return currentTourStep}
		});
	}

	// For auto-minimized interface
	const minimized = writable<boolean>(false);
	let _mTo:number;

	minimized.subscribe(m => events.dispatch('tour-minimize', m));

	// Triggers on pointermove
	function pointermove(){
		minimized.set(false);
		clearTimeout(_mTo);
		_mTo = <any>setTimeout(() => minimized.set(true), 5000) as number;
	}

	// Scroll tour
	let _scroller:HTMLElement;
	let observer:IntersectionObserver;

	function onintersect(e:IntersectionObserverEntry[]){
		if(!('steps' in tour)) return;
		const steps = tour.steps, el = e.filter(e => e.isIntersecting).map(e => e.target)[0];
		if(el) for(let i=0;i<_scroller.children.length;i++) if(_scroller.children[i] == el) {
			const m = data.markers?.find(m => m.id == steps[i].split(',')[0]);
			if(m) micrio.$current?.camera.flyToView(m.view as Models.Camera.View).catch(() => {});
			return;
		}
	}

	let currentTourStep:number = -1;
	let isOtherMarkerOpened:boolean = false;

	const startView = image.camera.getView();
	const markerSettings = settings._markers;

	function startMarkerTour(tour:Models.ImageData.MarkerTour) {
		if(!isScrollTour && !micrio.$current?.state.$marker) {
			// If started only by setting state.tour, not by opening marker,
			// open the first step from here
			if(tour.initialStep !== undefined) goto(tour.initialStep);
		}
		if(isScrollTour && _scroller) {
			observer = new IntersectionObserver(onintersect, { root: _scroller, threshold: 1 });
			for(let i=0;i<_scroller.children.length;i++) observer.observe(_scroller.children[i]);
		}

		unsub.push(micrio.state.marker.subscribe(m => {
			if(!m) { isOtherMarkerOpened = false; return; }
			const id = typeof m == 'string' ? m : m.id;
			const idx = tour.steps.findIndex(s => s.startsWith(id));
			if(idx >= 0 && tour.stepInfo) {
				const step = tour.stepInfo[currentTourStep = idx];
				if(step && !step.micrioImage) step.micrioImage = micrio.canvases.find(i => i.id == step.micrioId)
					?? grid?.images.find(i => i.id == step.micrioId) ?? micrio.$current;
			}
			isOtherMarkerOpened = idx < 0;
		}));
	}

	let unsub:Unsubscriber[] = [];
	onMount(() => {
		if('steps' in tour) loadSerialTour(image, tour, $_lang, image.$data!).then(() => startMarkerTour(tour));

		if(!noControls) unsub.push(minimized.subscribe(m => dispatch('minimize', m)));

		// Video tour or serial tour auto-hide
		if(!noHTML && (!('steps' in tour) || isSerialTour) && tour.minimize !== false) {
			micrio.addEventListener('pointermove', pointermove);
			micrio.addEventListener('touchstart', pointermove);
			pointermove();
		}

		// Don't show regular controls when paused if independent tour
		if(hideMainControls) micrio.setAttribute('data-tour-active','');

		return () => {
			clearTimeout(_mTo);
			clearTimeout(_deferTo);
			while(unsub.length) unsub.shift()?.();
			micrio.removeEventListener('pointermove', pointermove);
			micrio.removeEventListener('touchstart', pointermove);
			micrio.removeEventListener('marker-opened', hookCam);
			if(hideMainControls) micrio.removeAttribute('data-tour-active');
			hookCam();
			if(observer) observer.disconnect();
			const currentMarker = micrio.state.$marker;
			if('steps' in tour && tour.stepInfo && tour.currentStep != undefined) {
				const step = tour.stepInfo[tour.currentStep];
				delete tour.goto;
				delete tour.next;
				delete tour.prev;
				// Only close current marker if it's the current tour step
				if(currentMarker && step?.markerId == currentMarker.id) {
					step.micrioImage?.state.marker.set(undefined);
					micrio.state.marker.set(undefined);
				}
			}
			// This aborts any running tour animation and cam will fly back to starting view
			image.camera.aniDone = undefined;
			if(!grid && !('steps' in tour && tour.keepLastStep) && micrio.$current != image)
				micrio.open(image.id);
			tick().then(() => {
				events.dispatch('tour-stop', tour);
				if('steps' in tour) delete tour.currentStep;
				// Independent video tour: zoom out
				if(!('steps' in tour) && markerSettings?.zoomOutAfterClose && !currentMarker && startView)
					image.camera.flyToView(startView, {speed:markerSettings?.zoomOutAfterCloseSpeed, noTrueNorth: true});
			});
		}
	});

	events.dispatch('tour-start', tour);

	let currentTime:number=0;
	let paused:boolean=false;

	$: videoTour = !('steps' in tour) ? tour as Models.ImageData.VideoTour : undefined;
	$: audio = videoTour ? ('audio' in tour ? tour.audio as Models.Assets.Audio : videoTour.i18n?.[$_lang]?.audio) : undefined;
	$: audioSrc = audio ? 'fileUrl' in audio ? audio['fileUrl'] as string : audio.src : undefined;

</script>

{#if !noHTML}

	<!-- Scroll tour -->
	{#if isScrollTour && 'steps' in tour}
		<article class="scroll-tour" bind:this={_scroller}>{#each tour.steps.map(step => data.markers && data.markers.find(m => m.id==step.split(',')[0])) as marker}{#if marker}
			<MarkerPopup {marker} />
		{/if}{/each}</article>
		{#if !tour.cannotClose}<Button type="close" title={$i18n.tourStop} className="scroll-tour-end" on:click={exit} />{/if}

	<!-- Independent tour controls under <micr-io> -->
	{:else if isIndependent}
		<div class:left={isSerialTour} class:serial-tour={isSerialTour} class:video-tour={isVideoTour}
			class:no-controls={noControls} class:minimized={!paused&&($minimized||isOtherMarkerOpened)} in:fade={{duration: 200}}>
			{#if 'steps' in tour}
				{#if isSerialTour}<SerialTour {tour} on:ended={ended} />{:else}
				<Button type="arrow-left" title={$i18n.tourStepPrev} disabled={currentTourStep==0} on:click={prev} />
				<Button noClick>{currentTourStep+1} / {tour.steps.length}</Button>
				<Button type="arrow-right" title={$i18n.tourStepNext} disabled={currentTourStep==tour.steps.length-1} on:click={next} />{/if}
			{:else}
				<Media {tour} src={audioSrc}
					fullscreen={micrio} controls autoplay bind:paused
					bind:currentTime on:ended={ended} />
			{/if}
			{#if !tour.cannotClose}<Button type="close" title={$i18n.close} on:click={exit} />{/if}
		</div>

	<!-- If a video tour <Tour> is used in marker popup -->
	{:else if videoTour}
		<Media tour={videoTour} src={audioSrc} bind:currentTime autoplay on:ended={ended} />
	{/if}
{:else if videoTour}
	<Media tour={videoTour} src={audioSrc} autoplay bind:currentTime on:ended={ended} />
{/if}

<style>
	div {
		position: absolute;
		bottom: var(--micrio-border-margin);
		left: 50%;
		max-width: calc(100% - var(--micrio-border-margin) * 2);
		transform: translateX(-50%);
		box-sizing: border-box;
		display: flex;
		border-radius: var(--micrio-border-radius);
		box-shadow: var(--micrio-button-shadow);
		backdrop-filter: var(--micrio-background-filter);
		background-color: var(--micrio-button-background, var(--micrio-background, none));
		padding: 0;
		transition: transform .2s ease;
	}
	div:not(:hover).minimized {
		transform: translate3d(-50%, calc(100% + var(--micrio-border-margin)), 0);
		pointer-events: none;
	}
	.serial-tour > :global(*) {
		--micrio-background: none;
	}
	.serial-tour.minimized {
		transform: translate3d(0, calc(100% + var(--micrio-border-margin)), 0);
	}
	.serial-tour, .video-tour {
		width: 500px;
	}
	div > :global(*) {
		--micrio-button-background: none;
	}
	div :global(button) {
		margin: 0;
		border: none;
		border-radius: 0;
		white-space: pre;
		--micrio-background-filter: none;
		--micrio-button-shadow: none;
	}
	article.scroll-tour {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		overflow-x: hidden;
		overflow-y: scroll;
	}
	:global(button.micrio-button.scroll-tour-end) {
		position: absolute;
		top: 5px;
		right: 5px;
	}
	article > :global(div.micrio-marker-popup) {
		margin: 20vh 50px 50vh;
		margin: 20cqh 50px 50cqh;
		display: flex;
	}
	article > :global(div.micrio-marker-popup:nth-child(2n+1)) {
		justify-content: right;
	}
</style>
