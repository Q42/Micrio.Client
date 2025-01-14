<script lang="ts">
	import { get, type Writable } from 'svelte/store';
	import type { HTMLMicrioElement } from '../../ts/element';
	import type { Models } from '../../types/models';
	import type { MicrioImage } from '../../ts/image';

	import { getContext, onMount, tick } from 'svelte';
	import { ctx } from '../virtual/AudioController.svelte';

	import { after, getSpaceVector } from '../../ts/utils';

	import Icon, { type IconName } from '../ui/Icon.svelte';
	import AudioLocation from '../virtual/AudioLocation.svelte';

	const micrio = <HTMLMicrioElement>getContext('micrio');
	const { current, events, state, _lang, spaceData } = micrio;
	const isMobile = micrio.canvas.isMobile;

	export let marker:Models.ImageData.Marker;
	export let image:MicrioImage = $current as MicrioImage;
	export let forceHidden:boolean = false;
	export let coords:Map<string, [number, number, number?, number?]>|undefined = undefined;
	export let overlapped:boolean = false;

	if(!marker.tags) marker.tags = [];

	// For Omni image side labels
	const hovered = state.markerHoverId;
	const inView = getContext<Writable<[Models.ImageData.Marker,number,number][]>>('inView');

	const markerImages : WeakMap<Models.ImageData.Marker,MicrioImage> = getContext('markerImages');
	const openedBefore = markerImages.has(marker);
	if(!openedBefore&&image) markerImages.set(marker, image);

	const currentPopup = micrio.state.popup;
	const mobileFancyLabels = !!(image.isOmni && image.$settings.omni?.sideLabels && !image.$settings._markers?.noTitles);

	const tour = state.tour;

	const inTour = (t:Models.ImageData.MarkerTour) : boolean => t.steps.findIndex(s => s.startsWith(marker.id)) >= 0;

	const data:Models.ImageData.MarkerData = marker.data ?? {};
	const _meta = data._meta || {};
	const omni = image.$settings.omni;

	// If image previously was layered but layers removed, fix this
	if(marker.imageLayer && marker.imageLayer > (omni?.layers?.length ?? 1) - 1)
		delete marker.imageLayer;

	// If is secondary, and is linked from marker in main image with popup,
	// disable popup
	if(!!$current?.$data?.markers?.find(m =>
		m.data?._micrioSplitLink?.markerId == marker.id && m.popupType != 'none'
	)) {
		marker.popupType = 'none';
		marker.noMarker = true;
	}

	if('embedUrl' in marker && marker.embedUrl && 'embedInPopover' in marker && marker['embedInPopover'])
		marker.popupType = 'popover';

	const markerSettings:Models.ImageInfo.MarkerSettings = image.$settings._markers ?? {};
	const doTourJumps:boolean = !!image.$settings.doTourJumps;

	const classNames:string = marker.tags.join(' ');
	const cluster:boolean = marker.type == 'cluster';

	// Don't print titles at all, otherwise hover will reveal them
	const noTitles:boolean = !!markerSettings.noTitles || !!omni?.sideLabels;
	const showTitle:boolean = !noTitles && !!markerSettings.showTitles;
	const scales:boolean = !!data.scales || !!image.$settings.markersScale;
	const titleNoScales:boolean = scales && !!markerSettings.titlesNoScale;
	const split = data._micrioSplitLink;
	const keepPopup:boolean = !!markerSettings.keepPopupsDuringTourTransitions;
	const noToolTips:boolean = /[?&]micrioNoTooltips/.test(location.search) || !!omni?.sideLabels;

	// Static grid action
	const gridAction:string|undefined = _meta.gridAction;
	const autoStartMyTour:Models.ImageData.MarkerTour|undefined = image.$settings?._markers?.autoStartTour
		? micrio.wasm.images.map(c => 'camera' in c ? c.$data?.markerTours?.find(inTour) : undefined).filter(t => !!t)[0] ?? spaceData?.markerTours?.find(inTour) : undefined;
	const myTourStep:number|undefined = autoStartMyTour?.steps.findIndex(s => s.startsWith(marker.id));
	const startTourAtBeginning:boolean = !!image.$settings?._markers?.autoStartTourAtBeginning;

	let openOnInit:boolean = (!openedBefore && (!!data.alwaysOpen || (state.$marker == marker))
		|| (state.$tour?.id == autoStartMyTour?.id && autoStartMyTour?.currentStep == (myTourStep??0)));

	let opened:boolean = openedBefore && image.state.$marker == marker;
	let flownTo:boolean = opened;
	let behindCam:boolean = false;
	let matrix:string;

	let x:number;
	let y:number;
	let scale:number;
	let w:number;

	let splitImage:MicrioImage|undefined;
	let splitOpened:boolean = false;

	// Clicked the marker itself
	function click() : void {
		blur();
		if(marker.onclick) return marker.onclick(marker);
		if(markerSettings.noMarkerActions) return;
		if(marker.type == 'cluster') {
			if(marker.view && $current?.$info) {
				const scale = $current.camera.getScale();
				const margin = [
					20 / $current.$info.width * scale,
					20 / $current.$info.height * scale
				];
				image.camera.flyToView([
					marker.view[0] - margin[0],
					marker.view[1] - margin[1],
					marker.view[2] + margin[0],
					marker.view[3] + margin[1]
				], {area: image.opts?.area, limitZoom: true});
			}
		}
		// Just open normally
		else image.state.marker.set(marker);
	}

	// When tabbing through markers
	let fto:any;
	function focus() : void {
		if(markerSettings.noMarkerActions) return;

		// This prevents the markers from jumping
		(_container.parentNode as HTMLElement).scrollTo(0,0);
		blur();
		fto = setTimeout(() => {
			const px = image.camera.getXY(marker.x, marker.y);
			if(!opened && (px[0] < 0 || px[0] >= micrio.offsetWidth || px[1] < 0 || px[1] >= micrio.offsetHeight || (image.is360 ? px[3] > 4 : false)))
				image.camera.flyToCoo([marker.x, marker.y], { speed: 2, limit: true}).catch(() => {});
		}, 150);
	}

	function blur() : void {
		clearTimeout(fto);
	}

	const hoverStart = () : void => hovered.set(marker.id);
	const hoverEnd = () : void => hovered.set(undefined);

	// Became the currently opened marker
	async function activated() {
		if(opened) return;
		opened = true;
		blur();

		if(markerSettings.noMarkerActions) return;

		events.dispatch('marker-open', marker);

		// If there is a running tour and it's not the markers', stop it
		if($tour && (!('steps' in $tour) || (!inTour($tour) && !$tour.cannotClose))) {
			tour.set(undefined);
			await tick();
		}

		// Close any open other popup
		const currentMarkerTour = $tour && 'steps' in $tour;
		if(!noPopup && (!currentMarkerTour || !keepPopup)) {
			currentPopup.set(undefined);
			micrio.state.popover.set(undefined);
		}

		hoverEnd();

		// If split image already opened (before), already do the animation
		if(split?.markerId) {
			if(!splitImage) splitImage = micrio.canvases.find(c => c.id == split.micrioId)
			if(splitImage) {
				splitOpened = get(splitImage.visible);
				if(splitOpened && split?.view) splitImage.camera.flyToView(split.view, {isJump:true}).catch(() => {})
			}
		}

		if(marker.imageLayer !== undefined) image.state.layer.set(marker.imageLayer);

		// When auto starting tour from beginning, temporarily remove any grid action until after opened
		const immediatelyStartMyTourAtBeginning = autoStartMyTour && startTourAtBeginning && autoStartMyTour != $tour && (myTourStep != undefined && myTourStep > 0);
		if(immediatelyStartMyTourAtBeginning) delete _meta.gridAction;

		// When there's a marker video tour, disregard the starting viewport, it makes no sense
		if(!immediatelyStartMyTourAtBeginning && marker.view && !data.noAnimate && !marker.videoTour && !_meta.gridView) {
			if(openOnInit) { image.camera.setView(marker.view, {area: image.opts?.area}); open(); }
			else image.camera.flyToView(marker.view, { omniIndex, noTrueNorth: true, area: image.opts?.area, isJump: !!data.doJump || (doTourJumps && !!state.$tour)})
				.then(open).catch(() => { if(!$tour) image.state.marker.set(undefined) })
		}
		else open();
	}

	let _splitOpenTo:any;

	// Really open the marker
	async function open() : Promise<void> {
		if(cluster) return;

		// If current image marker is not this marker, likely opened on init
		// from micrio.state.marker. Set directly on image.
		if(image.state.$marker != marker) return image.state.marker.set(marker);

		if(markerSettings.noMarkerActions) return;

		// If marker is part of a marker tour and .autoStartTour, start the marker tour
		// but only if no current active tour.
		if(autoStartMyTour && autoStartMyTour != $tour) {

			// Set opening step
			autoStartMyTour.initialStep = startTourAtBeginning ? 0 : myTourStep;
			const firstStep = autoStartMyTour.stepInfo?.[0];
			if(startTourAtBeginning && firstStep && firstStep.micrioId != image.id) {
				const grid = micrio.canvases[0]?.grid;
				if(grid?.images.find(i => i.id == firstStep.micrioId)) micrio.current.set(grid.image);
				else micrio.open(firstStep.micrioId);
			}
			tour.set(autoStartMyTour);
			setTimeout(() => _meta.gridAction = gridAction, 100);

			// End here, if I'm not the first tourstep
			if(startTourAtBeginning && (myTourStep != undefined && myTourStep > 0)) {
				image.state.marker.set(undefined);
				close();
				return;
			}

			await tick();
		}

		openOnInit = false;
		flownTo = true;
		events.dispatch('marker-opened', marker);

		// Open the popup

		// No popup if this is a video tour marker that's inside a serial tour
		const isChapteredSerialTour = $tour && 'steps' in $tour && $tour.isSerialTour && $tour.printChapters && $tour.steps.findIndex(s => s.startsWith(marker.id)) >= 0
			&& marker.videoTour;

		if(!isChapteredSerialTour) {
			if(!noPopup) tick().then(() => currentPopup.set(marker));
			else if(marker.popupType == 'popover') {
				await tick();
				micrio.state.popover.set({
					marker, image, markerTour: $tour && 'steps' in $tour ? $tour : undefined
				})
			}
			else if(marker.videoTour && !$tour) {
				tour.set(marker.videoTour);
				after(tour).then(() => image.state.marker.set(undefined));
			}
		}

		// Open a linked image
		const linkId = data.micrioLink?.id;
		if(linkId) tick().then(() => {
			image.camera.stop();
			// Check if this image is in a 360 space, and the linked image is also
			// in the same space
			const vector = getSpaceVector(micrio, linkId);
			if(vector) {
				image.openedView = undefined;
				image.state.marker.set(undefined);
			}
			micrio.open(linkId,{vector: vector?.vector});
		});

		// Open a split screen image
		if(split && !splitOpened && !image.opts.secondaryTo) {
			// Check for grid, if there, await any promise
			const grid = micrio.canvases[0]?.grid;
			if(grid?.lastPromise) await grid.lastPromise;
			_splitOpenTo = setTimeout(() => {
				if(!split) return;
				splitImage = micrio.open(split.micrioId, {
					splitScreen: true,
					splitTo: image,
					isPassive: !!(split.follows && !micrio.state.$tour),
					startView: split.view
				});
				splitOpened = true;
			}, 200);
		}
	}

	// When the marker is not active anymore
	function close(){
		clearTimeout(_splitOpenTo);
		events.dispatch('marker-closed', marker);
		// If there is an animation back to the opening view from a marker-own video tour,
		// wait for the animation to finish before refocussing the marker element.
		if(marker.videoTour && image.openedView)
			setTimeout(() => image.camera.aniDoneAdd.push(() => _button?.focus()), 10);
		// Otherwise immediately focus again
		else _button?.focus();
		micrio.state.popover.set(undefined);
		if(!noPopup) {
			const currentMarkerTour = $tour && 'steps' in $tour;
			if($currentPopup == marker && (!currentMarkerTour || !keepPopup)) currentPopup.set(undefined);
			// Check any popup from other image that was never closed, and show that one again
			const extMarker = micrio.canvases.find(c => c != image && c.state.$marker);
			if(extMarker) tick().then(() => {
				const m = extMarker.state.$marker;
				// If it's still open
				if(m && m.popupType == 'popup') currentPopup.set(m);
			});
		}

		if(split && splitImage) setTimeout(() => {
			const curr = get(micrio.state.marker);
			if(splitImage && split.micrioId != curr?.data?._micrioSplitLink?.micrioId) micrio.close(splitImage);
		},210);
	}

	let isInView:boolean=false;
	let prevLabelWidth:number|undefined;
	let prevLabelHeight:number|undefined;
	function moved(){
		if(image.is360 && scales) {
			matrix = image.camera.getMatrix(marker.x, marker.y, 1, 1,0,0,0).join(',');
		}
		else {
			let pX=x,pY=y;
			[x, y, scale, w] = image.camera.getXYDirect(marker.x, marker.y, {
				radius: marker.radius,
				rotation: marker.rotation,
			});
			if(image.is360) behindCam = w > 0;
			else if(image.isOmni && omni) {
				if(omniArc[0] && omniArc[1] && marker.rotation != undefined) {
					const numFrames = omni.frames / (omni.layers?.length ?? 1);
					let delta = (image.swiper?.currentIndex??0) - (omniIndex??0);
					if(delta > numFrames / 2) delta -= numFrames;
					if(delta < -numFrames / 2) delta += numFrames;
					behindCam = delta <= omniArc[0] || delta >= omniArc[1];
				}
				else if(omni.distance) behindCam = w < 0;
				if(omni.sideLabels && !markerSettings.noTitles && content?.title && inView && (pX!=x||pY!=y)) setInView(x,y);
			}
			if(image.$settings.clusterMarkers && coords) coords.set(marker.id, [
				x,
				y,
				!overlapped ? (prevLabelWidth = _label?.offsetWidth) : prevLabelWidth,
				!overlapped ? (prevLabelHeight = _label?.offsetHeight) : prevLabelHeight
			]);
		}
	}

	// For omni markers and labelling
	function setInView(x:number, y:number) {
		const elW = micrio.canvas.element.offsetWidth, elH = micrio.canvas.element.offsetHeight;
		const shown = !(x < 0 || x > elW || y < 0 || y > elH) && !behindCam;
		if(shown || isInView) inView.update(a => {
			if(!shown) { if(isInView) a.splice(a.findIndex(([m]) => m == marker), 1); }
			else if(isInView) a[a.findIndex(([m]) => m == marker)] = [marker, x/elW, y];
			else a.push([marker,x/elW,y]);
			isInView = shown;
			return a;
		});
	}

	// Spaces editor fires a change event on position dragging
	function changed(e:Event) {
		const m = (e as CustomEvent).detail as typeof marker;
		marker.x = m.x;
		marker.y = m.y;
		moved();
	}

	// HTML Elements
	let _button:HTMLButtonElement;
	let _container:HTMLElement;
	let _label:HTMLElement|undefined;

	// Global paused state
	const tourPaused = getContext<Writable<boolean>>('mediaPaused');

	onMount(() => {
		if(marker.videoTour) {
			const timeline = 'timeline' in marker.videoTour ? marker.videoTour.timeline as Models.ImageData.VideoTourView[]
				: marker.videoTour.i18n?.[$_lang]?.timeline;

			if(timeline?.length) marker.view = timeline[0].rect;
		}
		const us = [image.state.marker.subscribe(m => {
			if(typeof m == 'string' && m == marker.id) image.state.marker.set(marker);
			else if(m == marker) activated();
			else if(!data.alwaysOpen) { if(opened) close(); opened = flownTo = false; }
		})];

		if(!noMarker) {
			us.push(image.camera.image.state.view.subscribe(moved));
			moved();
		}

		// Do this after a tick, otherwise $currentPopup is not up to date
		if(!forceHidden) tick().then(() => {
			// If opened, means it was opened earlier, then close, unless
			// the current popup is this marker's
			if(opened && !marker.noMarker && $currentPopup && $currentPopup != marker && !$tour) {
				image.state.marker.set(undefined);
			}
			// Fresh start
			else if(openOnInit || data.alwaysOpen) open();
		});

		if(marker.htmlElement && _container) _container.appendChild(marker.htmlElement);

		return () => {
			clearTimeout(_splitOpenTo);
			while(us.length) us.shift()?.();
		}
	});

	// Dynamic culture content
	$: content = marker.i18n ? marker.i18n[$_lang] : (<unknown>marker as Models.ImageData.MarkerCultureData);

	// Dynamic culture settings
	$: noPopupContent = !content?.title && !content?.body && !content?.bodySecondary && !content?.embedUrl
		&& !(marker.images && marker.images.length);
	$: noMarker = forceHidden || marker.noMarker;
	$: noPopup = marker.popupType != 'popup' || noPopupContent;

	// Omni vars
	$: omniIndex = image.camera.getOmniFrame((marker.rotation??0) + (marker.backside ? Math.PI : 0));
	$: omniArc = marker.visibleArc ? [
		image.camera.getOmniFrame(marker.visibleArc[0]),
		image.camera.getOmniFrame(marker.visibleArc[1])
	] : [];

	$: hidden = $tour && ((!('steps' in $tour) && !$tour.keepMarkers) || (markerSettings.hideMarkersDuringTour && !$tourPaused)) && !opened;

	$: { if(hidden) inView.update(v => {
		const idx = v.findIndex(iv => iv[0] == marker);
		if(idx >= 0) v.splice(idx, 1);
		return v;
	})}

	$: icon = (marker.type == 'default' ? undefined
		: marker.type == 'link' ? 'link'
		: marker.type == 'media' ? 'play'
		: marker.type == 'cluster' ? undefined
		: marker.type ?? undefined) as (IconName|undefined);

	$: customIcon = (marker.data?.customIconIdx != undefined ? image.$settings._markers?.customIcons?.[marker.data?.customIconIdx] : undefined)
		?? marker.data?.icon ?? markerSettings.markerIcon ?? undefined;

	// N.B. it seems a custom marker icon from V4 is always a string of its src, not an Image!
	$: customIconSrc = typeof customIcon == 'string' ? customIcon : customIcon?.src;

	$: hasIcon = !!icon || !!customIcon;

	// When the 'class' property of a V4 marker is '' that means it's explicitly set to not show the default marker styling.
	$: defaultClass = marker.class !== '' && (!!hasIcon || marker.type == 'default');

	$: showLabel = content && (!noTitles || ($isMobile && mobileFancyLabels)) && (content.label || content.title);

</script>

{#if !noMarker && image && !hidden}
	<div bind:this={_container} id={`m-${marker.id}`} on:change={changed}
		class={classNames} class:overlapped={overlapped && !opened} class:cluster class:behind={behindCam} class:hovered={$hovered == marker.id} class:default={defaultClass} class:mat3d={!!matrix} class:opened={opened}
		class:micrio-link={!!data.micrioLink} class:has-icon={hasIcon} class:has-custom-icon={!!customIcon}
		style={matrix ? `--mat:matrix3d(${matrix})` : x ? `--x:${x}px;--y:${y}px${scales ? `;--scale:${scale}` : ''}` : null}
	>
		{#if !marker.htmlElement}
			<button title={noToolTips || cluster ? null : (content ? content.label || content.title : null)} id={marker.id} bind:this={_button}
				on:click={click} on:focus={focus} on:blur={blur} on:mouseenter={hoverStart} on:mouseleave={hoverEnd} data-scroll-through>
				{#if customIcon}<img src={customIconSrc} alt="" />{:else if icon}<Icon name={icon} />{/if}
				{#if showLabel}<label bind:this={_label} class:static={titleNoScales} for={marker.id} data-scroll-through>{content.label||content.title}</label>{/if}
			</button>
		{/if}
	</div>
{/if}

{#if marker.positionalAudio && $ctx && (!marker.positionalAudio.noMobile || $isMobile) && (marker.positionalAudio.alwaysPlay || opened)}
	<AudioLocation {marker} ctx={$ctx} is360={image.is360} />
{/if}

<style>
	div {
		position: absolute;
		display: block;
		transform: translate3d(calc(var(--x, 0) - 50%), calc(var(--y, 0) - 50%), 0) scale3d(var(--scale, 1), var(--scale, 1), 1);
		top: 0;
		left: 0;
	}
	div:not(.cluster):not(.no-fade) {
		animation: fadeIn .25s;
		animation-fill-mode: forwards;
	}
	div.overlapped {
		display: none;
	}
	@keyframes fadeIn {
		from { opacity: 0; }
		to { opacity: 1; }
	}
	div.behind {
		pointer-events: none;
		visibility: hidden;
	}
	div.mat3d {
		transform: var(--mat);
		top: 50%;
		left: 50%;
		transform-style: preserve-3d;
	}
	div.mat3d > button {
		position: absolute;
		transform: translate3d(-50%,-50%,0);
	}
	button {
		display: block;
		width: var(--micrio-marker-size);
		height: var(--micrio-marker-size);
		color: var(--micrio-marker-text-color);
		position: relative;
		cursor: pointer;
		font: inherit;
		padding: 0;
		margin: 0;
		background: transparent none center center no-repeat;
		background-image: var(--micrio-marker-icon);
		background-size: contain;
		border: none;
	}
	div:not(.cluster) label {
		position: absolute;
		top: 50%;
		left: 100%;
		text-align: var(--micrio-text-align);
		cursor: pointer;
		transform: translate(0, -50%);
		padding-left: 10px;
		max-width: 170px;
		width: max-content;
		white-space: pre-wrap;
		font-size: 90%;
		font-weight: 600;
		line-height: 1em;
		text-shadow: var(--micrio-marker-text-shadow);
		opacity: 0;
		pointer-events: none;
		transition: opacity .1s ease;
	}
	div:hover {
		z-index: 2;
	}
	:global(.show-titles) > div label, div:hover label {
		opacity: 1;
	}
	@media (max-width: 640px) {
		div:not(.cluster) label {
			font-size: 12px;
		}
	}
	:global(.show-titles) > div label {
		pointer-events: all;
	}
	label.static {
		transform: translate(-50%, 4px) scale3d(calc(1 / var(--scale, 1)), calc(1 / var(--scale, 1)), 1);
	}
	div.default button {
		box-sizing: content-box;
		background-clip: content-box;
		border-radius: var(--micrio-marker-border-radius);
		border: var(--micrio-marker-border-size) solid var(--micrio-marker-border-color);
		transition: var(--micrio-marker-transition);
		background-color: var(--micrio-marker-color);
	}
	div.default:hover,
	div.default.hovered,
	div.default.opened {
		z-index: 1;
	}
	div.default:hover button,
	div.default.hovered button,
	div.default.opened button {
		background-color: var(--micrio-marker-highlight);
		border-width: 0;
		width: calc(var(--micrio-marker-size) + var(--micrio-marker-border-size) * 2);
		height: calc(var(--micrio-marker-size) + var(--micrio-marker-border-size) * 2);
	}
	div.has-icon button {
		--micrio-marker-icon: none;
	}
	div.default.has-icon button {
		color: #fff;
		width: calc(var(--micrio-marker-size) + 24px);
		height: calc(var(--micrio-marker-size) + 24px);
		background-color: var(--micrio-marker-border-color);
		border: none;
	}
	div.default.has-icon button > :global(svg) {
		margin: 0 auto;
	}
	div.default.has-icon.opened button > :global(svg),
	div.default.has-icon.hovered button > :global(svg),
	div.default.has-icon:hover button > :global(svg) {
		color: var(--micrio-marker-highlight);
	}
	div.default.has-custom-icon button {
		background-color: var(--micrio-marker-color);
	}
	div.default.has-custom-icon.opened button,
	div.default.has-custom-icon.hovered button,
	div.default.has-custom-icon:hover button {
		background-color: var(--micrio-marker-highlight, var(--micrio-marker-color));
	}

	/** Cluster markers */
	div.cluster button {
		border: 2px solid var(--micrio-marker-color);
		background: var(--micrio-cluster-marker-background, #fff);
		color: var(--micrio-cluster-marker-color, #000);
		width: calc(var(--micrio-marker-size) + 12px);
		height: calc(var(--micrio-marker-size) + 12px);
		border-radius: 100%;
		box-sizing: content-box;
	}
	div.cluster:hover button {
		background: var(--micrio-marker-highlight, #fff);
		border-color: var(--micrio-marker-highlight, #fff);
	}
	div.cluster label {
		pointer-events: none;
	}

	/** Custom icons */
	div img {
		max-width: 100%;
		max-height: 100%;
	}
</style>
