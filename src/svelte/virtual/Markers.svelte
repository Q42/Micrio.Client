<script lang="ts">
	import { get, writable, type Unsubscriber } from 'svelte/store';
	import type { MicrioImage } from '../../ts/image';
	import type { Models } from '../../types/models';

	import { onMount, setContext, tick } from 'svelte';
	import { limitView, once } from '../../ts/utils';

	import Marker from '../components/Marker.svelte';
	import Waypoint from '../components/Waypoint.svelte';

	export let image:MicrioImage;

	type Marker = Models.ImageData.Marker;

	const {data, info, settings} = image;
	const currentMarker = image.state.marker;
	const micrio = image.wasm.micrio;
	const { switching, _lang, state } = micrio;
	const isMobile = micrio.canvas.isMobile;
	const grid = micrio.canvases[0]?.grid;
	const focussed = grid?.focussed;
	const gridMarkersShown = grid?.markersShown;
	const cR = $settings.clusterMarkerRadius ?? 16;

	// For fancy titles on side of screen
	const hoveredId = state.markerHoverId;
	const inView = writable<[Marker, number, number][]>([]);
	setContext('inView', inView);

	let mounted:boolean = false;
	//let wasMounted:boolean = false;

	const markerSettings:Models.ImageInfo.MarkerSettings = $settings._markers ?? {};
	const omni = $settings.omni;
	const noTitles:boolean = !!markerSettings.noTitles || !!omni?.sideLabels;
	const showTitles:boolean = !noTitles && !!markerSettings.showTitles;

	// Save opened view when opening a
	function setOpenedView(marker:Marker|string|undefined) {
		if(marker) { if(typeof marker != 'string' && !image.openedView && !marker.noMarker && marker.view) {
			image.openedView = micrio.state.$tour ? undefined : image.state.$view?.slice(0);
			//wasMounted = mounted;
		}} else if(image.openedView && !micrio.state.$tour) tick().then(() => {
			if(!inactive && !image.camera.aniDone && image.openedView)
				image.camera.flyToView(limitView(image.openedView), {
					speed:$settings._markers?.zoomOutAfterCloseSpeed,
					noTrueNorth: true
				}).catch(() => {});
			image.openedView = undefined;
		});
	}

	// When a tour started that keeps last step, unset any openedView
	state.tour.subscribe(t => {
		if(t && 'steps' in t && t.keepLastStep) image.openedView = undefined;
	});

	const cssVars:string[] = [];
	let markerStyle:string = '';
	let is360:boolean = false;
	let fancyLabels:boolean = false;

	const resize = (v:Models.Camera.View) => (v=v?.map(f => Math.round(f*100)/100)) && (markerStyle = [...cssVars,
		v[0] ? `left: ${v[0]}px` : null,
		v[1] ? `top: ${v[1]}px` : null,
		`width: ${v[2]}px`,
		`height: ${v[3]}px`
	].filter(v => !!v).join(';')+';');

	// Clustering
	let overlapped:number[]=[]
	let r=cR;
	let clusterMarkers:Marker[] = [];

	// Marker ID -> x,y mapping
	type MarkerCoords = [number, number, number?, number?];
	const coords = new Map<string,MarkerCoords>();

	const overlaps = ([x0,y0,w0=0,h0=0]:MarkerCoords,[x1,y1,w1=0,h1=0]:MarkerCoords) => {
		const rY0 = Math.max(h0/2, r), rY1 = Math.max(h1/2, r);
		return !(x0+w0+r<x1-r||x0-r>x1+w1+r||y0+rY0<y1-rY1||y0-rY0>y1+rY1);
	}

	const calcOverlapped = () : void => {
		if(!visibleMarkers) { overlapped = clusterMarkers = []; return; }
		const q=visibleMarkers, S:number[][]=[], l=q.length;
		let i=0,j=0;
		for(overlapped=[];i<l;i++) for(j=i+1;j<l;j++) {
			if(q[j].tags?.includes('no-cluster')) continue;
			const c1 = coords.get(q[i].id), c2 = coords.get(q[j].id);
			if(!c1 || !c2 || !overlaps(c1, c2)) continue;
			overlapped.push(i,j);
			S.find(c=>c.findIndex(n=>n==i||n==j)>-1)?.push(i,j)??S.push([i,j]);
		}
		clusterMarkers=S.map(c=>c.filter((n,i)=>c.indexOf(n)==i)).map((c,v:any)=>({
			title:c.length+'',
			type:'cluster',
			view:v=[0,1,2,3].map(i=>(i<2?Math.min:Math.max)(
				...c.map(j => q[j].view?.[i] ?? (i%2==0?q[j].x:q[j].y))
			)),
			x:v[0]+(v[2]-v[0])/2,
			y:v[1]+(v[3]-v[1])/2,
			id:''+c,
			data:{},
			popupType:'none',
			tags:[]
		}));
	};

	const flSubs:Unsubscriber[] = [];
	function subscribeFancyLabels() {
		flSubs.push(image.state.view.subscribe(drawLines));
		flSubs.push(hoveredId.subscribe(drawLines));
		flSubs.push(currentMarker.subscribe(drawLines));
	}
	function unsubscribeFancyLabels() {
		while(flSubs.length) flSubs.shift()?.();
	}

	onMount(() => {
		const unsub:Unsubscriber[] = [];

		once(info).then(i => { if(!i) return;
			is360 = !!i.is360;

			const ms = $settings._markers;
			if(!ms) return;
			const isV4 = Number(i.version) >= 4.2;
			if(ms.markerIcon) cssVars.push(`--micrio-marker-icon: url("${ms.markerIcon}")`);
			if(ms.markerColor && ms.markerColor != (isV4 ? '#ffffff' : '#ffbb00')) cssVars.push('--micrio-marker-color: '+ms.markerColor);
			if(ms.markerSize && ms.markerSize != (isV4 ? '16' : '25')) cssVars.push('--micrio-marker-size: '+(r=Number(ms.markerSize))+'px');

			unsub.push(image.viewport.subscribe(resize));

			if($settings.clusterMarkers) {
				unsub.push(image.state.view.subscribe(calcOverlapped));
				unsub.push(image.data.subscribe(() => tick().then(calcOverlapped)));
			}

			if(!image.grid && $settings._markers?.zoomOutAfterClose)
				unsub.push(image.state.marker.subscribe(setOpenedView));

			const tryFancyLabels = !!(image.isOmni && $settings.omni?.sideLabels && !$settings._markers?.noTitles);
			if(tryFancyLabels) unsub.push(isMobile.subscribe(b => {
				if(b && fancyLabels) unsubscribeFancyLabels();
				else if(!b && !fancyLabels) subscribeFancyLabels();
				fancyLabels = !b;
			}));

			mounted = true;
		});

		return () => {
			while(unsub.length) unsub.shift()?.();
		}
	});

	const isVisible = (m:Models.ImageData.Marker) => !m.noMarker;

	// Fancy labels with lines to markers
	let _labels:HTMLElement;
	let lines:[number,number,number,number,boolean][] = [];
	function drawLines(){tick().then(() => { if(!_labels) return;
		const c = micrio.canvas;
		const w = c.element.offsetWidth;
		const nl:[number,number,number,number,boolean][] = [];
		$inView.forEach(([m,x,y]) => {
			const box = _labels.querySelector('label[for="'+m.id+'"]')?.getBoundingClientRect();
			if(box?.width && box.width > 0) nl.push([x*w, y, (x >= .5 ? box.left : box.right) - c.viewport.left, box.top + box.height/2 - c.viewport.top,$hoveredId==m.id]);
		})
		lines = nl;
	})}

	const getTitle = (m:Models.ImageData.Marker, lang:string) : string|undefined => m.i18n ? m.i18n[lang]?.title : (<unknown>m as Models.ImageData.MarkerCultureData).title;

	$: inactive = grid && ($focussed != image && (gridMarkersShown && get(gridMarkersShown).indexOf(image) < 0));
	$: waypoints = !$switching && micrio.spaceData ? micrio.spaceData.links.filter(l => l[0] == image.id || l[1] == image.id).map(l => ({targetId: l[0] == image.id ? l[1] : l[0], settings: l[2]?.[image.id]})) : undefined;
	$: visibleMarkers = inactive ? [] : $data?.markers?.filter(isVisible);
	$: invisibleMarkers = inactive ? $data?.markers : $data?.markers?.filter(m => !isVisible(m));
	$: hasMarkersOrWaypoints = !!(visibleMarkers?.length || waypoints?.length);
	$: inViewSorted = $inView.sort(([,,y1],[,,y2]) => y1 > y2 ? 1 : y1 < y2 ? -1 : 0);

</script>

{#if fancyLabels && inViewSorted.length && !$currentMarker}<svg>{#each lines as l}<line x1={l[0]} y1={l[1]} x2={l[2]} y2={l[3]} class:hovered={l[4]} />{/each}</svg>
<aside bind:this={_labels}><section>{#each inViewSorted.filter(([,x,]) => x < .5) as me (me[0].id)}
	<article><label for={me[0].id} class:hover={$hoveredId==me[0].id}
		on:mouseenter={() => hoveredId.set(me[0].id)} on:mouseleave={() => hoveredId.set(undefined)}>{getTitle(me[0],$_lang)}</label></article>
{/each}</section><section>{#each inViewSorted.filter(([,x,]) => x >= .5) as me (me[0].id)}
	<article><label for={me[0].id} class:hover={$hoveredId==me[0].id}
		on:mouseenter={() => hoveredId.set(me[0].id)} on:mouseleave={() => hoveredId.set(undefined)}>{getTitle(me[0],$_lang)}</label></article>
{/each}</section></aside>{/if}

{#if hasMarkersOrWaypoints}<div style={hasMarkersOrWaypoints ? markerStyle : null} class:show-titles={showTitles} class:is360 class:inactive={inactive||(is360 && $switching)}>{
	#if waypoints && waypoints.length}{#each waypoints as waypoint (waypoint)}<Waypoint {image} {...waypoint} />{/each}{/if
	}{#if visibleMarkers}{#each visibleMarkers as marker,i (marker.id)}<Marker {marker} {image} {coords} overlapped={overlapped.includes(i)} />{/each
	}{#each clusterMarkers as marker (marker.id)}<Marker {marker} {image} />{/each}{/if
}</div>{/if}

{#if invisibleMarkers}{#each invisibleMarkers as marker (marker.id)}<Marker {marker} {image} forceHidden />{/each}{/if}

<style>
	div {
		pointer-events: none;
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		overflow: hidden;
		will-change: width, height, top, left, opacity;
		perspective: inherit;
	}
	div:empty {
		display: none;
	}
	div > :global(*) {
		pointer-events: all;
	}
	div.inactive > :global(*) {
		pointer-events: none;
	}
	div.is360 {
		transition: opacity .25s;
	}
	div.is360.inactive {
		opacity: 0;
	}

	aside {
		pointer-events: none;
	}

	aside section {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 10vw;
		width: 10cqw;
		min-width: 200px;
		font-size: 1em;
		font-weight: 500;
		line-height: 1em;
		color: var(--micrio-marker-color);
		display: flex;
		flex-direction: column;
	}
	aside section:nth-child(1) {
		left: 10px;
	}
	aside section:nth-child(2) {
		right: 10px;
	}

	aside section article {
		flex: 1;
		padding: 10px;
		max-height: 30vh;
		max-height: 30cqh;
		display: flex;
		align-items: center;
	}

	aside section label {
		pointer-events: all;
		cursor: pointer;
		padding: 10px;
		max-width: 160px;
		opacity: .75;
		transition: opacity .25s ease, color .25s ease;
	}
	label.hover {
		color: var(--micrio-marker-highlight);
		opacity: 1;
	}
	aside section:nth-child(1) article {
		justify-content: right;
	}
	aside section:nth-child(1) label {
		text-align: right;
	}
	svg {
		width: 100%;
		height: 100%;
		pointer-events: none;
		position: absolute;
	}
	svg line {
		stroke: var(--micrio-marker-highlight);
		stroke-width: 2;
	}

	svg line:not(.hovered) {
		stroke: var(--micrio-marker-color);
		stroke-dasharray: 10px;
		stroke-width: 1;
		opacity: .75;
	}

</style>
