<script lang="ts">
	import type { HTMLMicrioElement } from '../ts/element';
	import type { Models } from '../types/models';
	import type { Readable, Writable } from 'svelte/store';
	import type { MicrioImage } from '../ts/image';

	import '../css/micrio.base.css';

	import { setContext, tick } from 'svelte';
	import { get, writable } from 'svelte/store';
	import { once } from '../ts/utils';

	import Logo from './ui/Logo.svelte';
	import LogoOrg from './ui/LogoOrg.svelte';
	import Toolbar from './components/Toolbar.svelte';
	import Minimap from './components/Minimap.svelte';
	import Controls from './common/Controls.svelte';
	import MarkerPopup from './components/MarkerPopup.svelte';
	import Tour from './virtual/Tour.svelte';
	import Gallery from './common/Gallery.svelte';
	import AudioController from './virtual/AudioController.svelte';
	import Details from './common/Details.svelte';
	import Media from './components/Media.svelte';
	import Error from './common/Error.svelte';
	import Popover from './components/Popover.svelte';
	import MicrioMarkers from './virtual/Markers.svelte';
	import Subtitles from './common/Subtitles.svelte';
	import Embed from './virtual/Embed.svelte';
	import ProgressCircle from './ui/ProgressCircle.svelte';

	export let micrio:HTMLMicrioElement;
	setContext('micrio', micrio);

	// WeakMap for marker linking images
	const markerImages : WeakMap<Models.ImageData.Marker,MicrioImage> = new WeakMap();
	setContext('markerImages', markerImages);

	// Don't render HTML elements (is the data-ui="false" attribute)
	export let noHTML:boolean;
	const onlyMarkers = micrio.getAttribute('data-ui') == 'markers';
	if(onlyMarkers) noHTML = true;

	export let noLogo:boolean = noHTML;
	export let loadingProgress:number = 1;
	export let error:string|undefined = undefined;

	const showEmbeds = micrio.getAttribute('data-embeds') != 'false';

	// Currently visible images
	const visible = micrio.visible;

	// Single HTML popup throughout entire <micr-io> app
	const markerPopup = micrio.state.popup;

	// Main popover
	const popover = micrio.state.popover;

	// Defer the placement of popups so previous ones can fade out
	let markerPopups:Models.ImageData.Marker[] = [];
	markerPopup.subscribe(p => setTimeout(() => markerPopups = p ? [p] : [], 20));

	let info:Readable<Models.ImageInfo.ImageInfo|undefined>;
	let data:Writable<Models.ImageData.ImageData|undefined>;
	let settings:Writable<Models.ImageInfo.Settings>|undefined;

	const { tour, marker } = micrio.state;

	function findPage(id:string, p:Models.ImageData.Menu[]|undefined) : Models.ImageData.Menu|undefined {
		if(p)for(let i=0,t;i<p.length;i++)if(p[i].id==id||(t=findPage(id, p[i].children)))return t??p[i] }

	let firstInited:boolean = false;
	let logoOrg:Models.ImageInfo.Organisation|undefined;
	const didStart:string[] = [];
	const hadTours:string[] = [];
	micrio.current.subscribe(c => { if(!c) return;
		info = c.info;
		settings = undefined;

		if(info) once(info).then((i) => { if(i) {
			firstInited = true;
			settings = c.settings;
			if(!logoOrg && i.organisation?.logo) logoOrg = i.organisation;
		}});

		if((data = c.data) && didStart.indexOf(c.id) < 0) once(data).then(async d => { if(!d) return;
			didStart.push(c.id);
			// Wait for the router to be inited
			await tick().then(tick);
			if(get(micrio.state.popover) || get(micrio.state.marker) || get(micrio.state.tour)) return;
			const autoStart = c.$settings.start;
			if(autoStart) switch(autoStart.type) {
				case 'marker':
					c.state.marker.set(autoStart.id);
				break;
				case 'markerTour':
					const markerTour = d.markerTours?.find(t => t.id == autoStart.id);
					if(markerTour) micrio.state.tour.set(markerTour);
				break;
				case 'tour':
					const tour = d.tours?.find(t => t.id == autoStart.id);
					if(tour) micrio.state.tour.set(tour);
				break;
				case 'page':
					const page = findPage(autoStart.id, d.pages);
					if(page) micrio.state.popover.set({contentPage: page, showLangSelect: true});
				break;
			}
		})
	});

	// Main volume
	const muted = micrio.isMuted;
	const volume = writable<number>($muted ? 0 : 1);
	setContext('volume', volume);
	micrio.isMuted.subscribe(b => volume.set(b ? 0 : 1));

	// Global paused state
	setContext<Writable<boolean>>('mediaPaused', writable<boolean>(false));

	// Subtitles
	let subsRaised:boolean = false;
	let srts:string[] = [];
	const srt = setContext<Writable<string|undefined>>('srt', writable<string>());
	srt.subscribe(s => setTimeout(() => { srts = s ? [s] : [] }, 20));

	// 360 video
	$: video = $settings?._360?.video;
	$: videoSrc = video?.src;

	$: omni = $settings?.omni;
	$: gallery = $info?.gallery;

	$: positionalAudio = $data?.markers?.filter(m => !!m.positionalAudio);
	$: hasAudio = !!$data?.music?.items.length || !!positionalAudio?.length;
	$: hasTourOrMarker = $tour || $marker;

	$: showMarkers = !noHTML || onlyMarkers;
	$: showLogo = !noLogo && (!$info || !noHTML) && !$settings?.noLogo;
	$: showOrgLogo = !noHTML && showLogo && !$settings?.noOrgLogo ? logoOrg : undefined;
	$: showMinimap = !noHTML && !omni && !micrio.spaceData && !$tour && !$info?.gallery;
	$: showGallery = !!gallery || !!omni;
	$: showControls = !noHTML && !!$info;
	$: showDetails = !noHTML && !hasTourOrMarker && $settings?.showInfo;
	$: showToolbar = !noHTML && firstInited && !$settings?.noToolbar;

</script>

<!-- This is only used for positional audio and audio playlists -->
{#if hasAudio && $data && $info}<AudioController volume={$volume} data={$data} is360={!!$info.is360} />{/if}

<!-- This is legacy V4 and older for full-image 360 video -->
{#if videoSrc && $info}<Media src={videoSrc} volume={$volume} is360
	width={$info.width} height={$info.height} {...video} />{/if}

{#if showEmbeds && $data && $data.embeds}{#each $data.embeds as embed (embed.uuid)}<Embed {embed} />{/each}{/if}
{#if showLogo}<Logo />{/if}
{#if showToolbar}<Toolbar />{/if}
{#if showMarkers}{#each $visible as image (image.uuid)}<MicrioMarkers {image} />{/each}{/if}
{#if showMinimap}{#each $visible.filter(i => i.$settings.minimap) as image (image.uuid)}<Minimap {image} />{/each}{/if}
{#if showControls}<Controls hasAudio={hasAudio||!!(videoSrc && video && !video.muted)} />{/if}
{#if showGallery}<Gallery images={gallery} {omni} />{/if}
{#if showOrgLogo}<LogoOrg organisation={showOrgLogo} />{/if}
{#if showDetails}<Details {info} {data} />{/if}
{#each markerPopups as marker (marker.id)}<MarkerPopup {marker} />{/each}
{#if $tour}<Tour tour={$tour} {noHTML} on:minimize={e => subsRaised=!e.detail} />{/if}
{#if $popover}<Popover popover={$popover} />{/if}
{#each srts as src (src)}<Subtitles {src} raised={subsRaised} />{/each}
{#if error}<Error message={error} />{/if}
{#if loadingProgress < 1}<ProgressCircle progress={loadingProgress} />{/if}
