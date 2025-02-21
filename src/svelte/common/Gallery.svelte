<script lang="ts">
	import type { HTMLMicrioElement } from '../../ts/element';
	import type { MicrioImage } from '../../ts/image';
	import type { Camera } from '../../ts/camera';
	import type { Models } from '../../types/models';
	
	import { getContext, onMount } from 'svelte';
	import { writable, type Unsubscriber, type Writable } from 'svelte/store';
	import { faLayerGroup } from '@fortawesome/free-solid-svg-icons';
	import { GallerySwiper } from '../../ts/swiper';
	import { i18n } from '../../ts/i18n';

	import Button from '../ui/Button.svelte';
	import Dial from '../ui/Dial.svelte';

	export let images:(MicrioImage|Models.Omni.Frame)[] = [];
	export let omni:Models.ImageInfo.OmniSettings|null = null;

	const micrio = <HTMLMicrioElement>getContext('micrio');
	const { wasm, current, events, _lang } = micrio;

	// UI settings
	const autoHide:boolean = true;

	// All these are defined at this point
	const image = $current as MicrioImage;
	const info = image.$info as Models.ImageInfo.ImageInfo;
	const layer = image.state.layer;
	const settings = image.settings;
	const camera = image.camera as Camera;

	// Omnis have simpler model than galleries
	if(omni) for(let j=0;j<omni.frames;j++) images.push({
		id:info.id+'/'+j,
		image: image,
		visible: writable<boolean>(false),
		frame: j, opts: { area: [0,0,1,1] },
		ptr: -1, baseTileIdx: -1,
		thumbSrc: image.getTileSrc(image.levels, 0, 0, j)
	});

	// Create spreads
	const gallery = $settings.gallery!;

	const isOmni:boolean = gallery.type == 'omni';
	const isFullSwipe:boolean = isOmni || gallery.type == 'swipe-full';
	const isSwitch:boolean = isFullSwipe || gallery.type == 'switch';

	const isContinuous:boolean = isOmni;
	const isSpread:boolean = !!gallery.isSpreads;
	const coverPages:number = gallery.coverPages ?? 0;

	const omniSettings = $settings.omni;
	const isOmniTwoAxes:boolean = isOmni && !!omniSettings?.twoAxes;

	const startId:string|null = gallery.startId || micrio.getAttribute('data-gallery-start-id');
	const archiveId:string|undefined = gallery.archive;
	const coverLimit:boolean = !!$settings.limitToCoverScale;
	const noUI:boolean = !!$settings.noUI;

	const omniFrontIndex:number = omniSettings?.frontIndex ?? 0;
	const omniNumLayers:number = omniSettings?.layers?.length ?? 1;

	const startIdxAttr:number|undefined = micrio.hasAttribute('data-gallery-start') ? Number(micrio.getAttribute('data-gallery-start')) : $settings?.omni?.startIndex;
	let startIdx = startIdxAttr != undefined && !isNaN(startIdxAttr) ? startIdxAttr : startId ? images.findIndex(i => i.id == startId) : 0;
	if(startIdx < 0) startIdx = 0;

	const pages:Models.Camera.View[] = [];
	const pageIdxes:number[][] = [];
	if(images) for(let i=0;i<images.length;i++) {
		let area = images[i].opts?.area;
		if(!area) continue;
		const v = area.slice(0);
		pageIdxes.push([i]);
		if(isSpread && (i-coverPages>=0&&((i-coverPages)%2==0)) && images[i+1]) {
			area = images[++i].opts?.area;
			if(!area) continue;
			pageIdxes[pageIdxes.length-1].push(i);
			v[2] = area[2], v[3] = area[3];
		}
		pages.push(v);
	}

	const pagesPerLayer = pages.length / omniNumLayers;
	const layerNames = omniSettings?.layers?.map(l => ({i18n: Object.fromEntries(Object.entries(l.i18n).map(([l,t],i)=>[l,{title:t??'Layer '+(i+1)}]))})) ?? [];
	Object.keys(info.revision??{[$_lang]:0}).forEach(c => layerNames.forEach((l, i) => {
		if(!l.i18n[c]) l.i18n[c] = {title: 'Layer '+(i+1)};
	}));

	let currentPage:number = -1;

	let zoomedOut:boolean = isSwitch;
	let dragging:boolean = true;
	let panning:boolean = false;
	let loading:boolean = true;
	let inited:boolean = false;
	let currentRotation:number = 0;

	function goto(i:number, fast:boolean=false, duration:number=150, force:boolean=false) : void {
		if(isContinuous) {
			while(i<0)i+=pagesPerLayer;
			i%=pagesPerLayer;
		}
		const page = i = Math.round(Math.max(0, Math.min(pagesPerLayer-1, i)));
		const changed = force || page != currentPage;
		currentPage = page;
		if(changed) frameChanged();

		if(!isSwitch) {
			const cv = camera.getView() as Models.Camera.View, v = pages[i];
			const animate = inited && ((zoomedOut && !panning) || changed || ((cv[0] < v[0]) !== (cv[2] > v[2])));
			panning = false;
			if(animate) camera.flyToView(v, {duration, speed:1, progress:fast ? .5 : 0})
				.then(() => limit(v, true)).catch(() => {});
			else {
				if(v && duration == 0) camera.setView(v);
				limit(v, true);
			}
		}
		else if(changed) {
			wasm.setActiveImage(image.ptr, pageIdxes[currentPage][0], pageIdxes[currentPage].length-1);
			if(isOmni) wasm.render();
			else {
				camera.flyToView(pages[currentPage],{duration, speed: 2})
					.then(() => limit(pages[currentPage], true)).catch(() => {});
				activity();
			}
		}
		image.album!.hooked = inited = true;
	}

	function frameChanged(e?:Event) {
		if(swiper && e) {
			if(swiper.currentIndex == currentPage) return;
			currentPage = swiper.currentIndex;
		}
		preload(currentPage);
		events.dispatch('gallery-show', currentPage);
		if(isOmni) currentRotation = (currentPage - omniFrontIndex) / pagesPerLayer * 360;
	}

	// Angular single button control
	const numPerRow:number = images.length;
	const numRows:number = 1;

	// OFCOURSE Safari doesn't have requestIdleCallback
	/** Preload distance */
	const d = 'requestIdleCallback' in self ? isOmni ? Math.max(36, images.length/4) : 100 : 50;
	const preloading:Map<string,any> = new Map();
	const request = self.requestIdleCallback ?? self.requestAnimationFrame;
	function preload(c:number){
		const imgs:number[] = [];

		// Preload logic for spread pages
		if(isSpread && c >= coverPages) c=c*2-coverPages;

		const row = Math.floor(c / numPerRow);
		for(let x=-d;x<=d;x++) if(x) {
			let rX = c + x;
			if(isOmniTwoAxes) {
				const r = Math.floor(rX / numPerRow);
				if(r < row) rX += numPerRow;
				if(r > row) rX -= numPerRow;
			}
			if(isContinuous) {
				while(rX < 0) rX += images.length;
				while(rX >= images.length) rX -= images.length;
			}
			imgs.push(rX)
		};

		if(isOmniTwoAxes) for(let y=-d;y<=d;y++) if(y) imgs.push(c+y*numPerRow);

		imgs.filter((n:number,i:number) => imgs.indexOf(n) == i)
			.map(i => images[i]).filter(i => !!i && !preloading.has(i.id))
			.forEach(i => preloading.set(i.id, request(() =>
				wasm.getTexture(i.baseTileIdx, i.thumbSrc as string, false, {force: !!archiveId})
			)));
	}

	function limit(a:Models.Camera.View, forceArea:boolean) : void {
		zoomedOut = camera.isZoomedOut();
		camera.setLimit(!forceArea && zoomedOut ? [-1, a[1], 2, a[3]] : a);
	}

	function getX(idx:number) : number {
		const _li = _ul?.childNodes[idx] as HTMLElement;
		return _li ? _li.offsetLeft + _li.offsetWidth/2 : 0;
	}

	let _ul:HTMLElement;
	let _left:number = 0;
	let box:DOMRect;

	$: left = !_ul || dragging ? _left : getX(currentPage);

	let dragIsPointer:boolean=false;
	function scrubStart(e:PointerEvent|TouchEvent) : void {
		if(dragging || (dragIsPointer = 'button' in e) && e.button != 0) return;
		box = _ul.getClientRects()[0];
		micrio.keepRendering = dragging = true;
		window.addEventListener(dragIsPointer ? 'pointermove' : 'touchmove', scrubMove);
		window.addEventListener(dragIsPointer ? 'pointerup' : 'touchend', scrubStop);
		scrubMove(e);
	}

	function scrubMove(e:PointerEvent|TouchEvent) : void {
		const clientX = 'button' in e ? e.clientX : e.touches[0].clientX;
		const perc = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
		_left = perc * (box.width);
		const idx = Math.max(0, Math.min(pagesPerLayer-1, Math.floor(perc * pagesPerLayer)));
		if(idx != currentPage) goto(idx, true);
	}

	function scrubStop() : void {
		window.removeEventListener(dragIsPointer ? 'pointermove' : 'touchmove', scrubMove);
		window.removeEventListener(dragIsPointer ? 'pointerup' : 'touchend', scrubStop);
		dragging = micrio.keepRendering = false;
		goto(currentPage);
	}

	let pStartIdx:number;
	function pStart() : void {
		if(!zoomedOut) return;
		closestIdx = pStartIdx = currentPage;
		panning = zoomedOut;
		limit(pages[currentPage], false);
	}

	function pEnd(e:Event) : void {
		// This triggers when pan is taken over by pinch zoom
		const d = (e as CustomEvent).detail;
		if(e.type == 'panend' && !d) panning = false;
		else goto(closestIdx != currentPage ? closestIdx : currentPage + (pStartIdx != currentPage || !panning || !d ? 0
			: Math.round(Math.min(1, Math.max(-1, -d.movedX / d.duration)))));
	}

	let closestIdx:number;
	function moved(v:Models.Camera.View|undefined) : void {
		if(!v) return;

		const c = v[0] + (v[2]-v[0]) / 2;
		const distances = pages.map((a, i) => {
			const fromCenter = (1 - Math.min(Math.abs(c - a[0]),Math.abs(c - a[2])));
			const inView = Math.max(0, (Math.min(v[2],a[2])-Math.max(v[0],a[0])) / (a[2]-a[0]));
			return fromCenter * inView * (1-Math.abs(currentPage-i)*.1);
		});

		wasm.setFocus(image.ptr, pages[closestIdx = distances.every(n => !n) ? currentPage : distances.indexOf(Math.max(...distances))], panning);
		zoomedOut = camera.isZoomedOut();
	}

	let row:number = 0;
	let started:number[] = [0,0,0,0];

	function rotateStart(e:PointerEvent):void {
		if(e.button != 0) return;
		dragging = true;
		started = [e.clientX, e.clientY, currentPage, row];
		window.addEventListener('pointermove', rotateMove);
		window.addEventListener('pointerup', rotateStop);
	}

	function rotateMove(e:PointerEvent):void {
		row = Math.max(0, Math.min(numRows-1, started[3] + Math.round((started[1] - e.clientY) / 360 * numRows)));
		let newIdx = (started[2] + Math.round((started[0] - e.clientX) / 360 * numPerRow))%numPerRow;
		while(newIdx<0) newIdx+=numPerRow;
		goto(row * numPerRow + newIdx);
	}

	function rotateStop():void {
		removeEventListener('pointermove', rotateMove);
		removeEventListener('pointerup', rotateStop);
		dragging = false;
	}

	function keydown(e:KeyboardEvent) : void {
		if($settings.omni?.noKeys) return;
		switch(e.key) {
			case 'PageUp':  case 'ArrowLeft': goto(currentPage - (isOmni ? -1 : 1), true); break;
			case 'PageDown': case 'ArrowRight': goto(currentPage + (isOmni ? -1 : 1), true); break;
			case 'ArrowUp': if(isOmniTwoAxes) goto(currentPage+numPerRow); break;
			case 'ArrowDown': if(isOmniTwoAxes) goto(currentPage-numPerRow); break;
			case 'Home': goto(0); break;
			case 'End': goto(pagesPerLayer); break;
			default: return;
		}
		activity();
	}

	let menuIdx:number=-1;
	const printLayerMenu = () : void => {
		if(!layerNames.length) return;
		image.data.update(d => { if(!d) d = {};
			if(!d.pages) d.pages = [];
			const menu = {
				id: '_omni-layers',
				i18n: layerNames[$layer].i18n,
				icon: faLayerGroup,
				children: layerNames.map((title,i) => ({
					id: 'omni-layer-'+i,
					i18n: title.i18n,
					action: () => image.state.layer.set(i)
				})).filter(p => p.id != 'omni-layer-'+$layer)
			};
			if(menuIdx >= 0) d.pages.splice(menuIdx, 1, menu);
			else d.pages.push(menu);
			menuIdx = d.pages.length-1;
			return d;
		});
	}

	let hidden:Writable<boolean> = micrio.state.ui.hidden;
	let to:number|undefined;
	function activity(): void {
		hidden.set(false);
		clearTimeout(to);
		to = <any>setTimeout(() => hidden.set(true), 2000) as number;
	}

	image.album = {
		numPages: pages.length,
		get currentIndex() { return currentPage},
		info: image.$settings.album,
		prev: () => goto(currentPage - 1),
		next: () => goto(currentPage + 1),
		goto
	};

	let swiper:GallerySwiper;
	onMount(() => {
		Promise.all(images.map(d => {
			if('state' in d && !('image' in d)) d.camera = image.camera;
			return wasm.addEmbed(d, image, {
				opacity: 0,
				asImage: 'camera' in d
			})
		})).then(() => {
				wasm.setActiveImage(image.ptr, startIdx);
				goto(startIdx, false, 0);
				dragging = false;
			});

		if(isOmni && omniNumLayers > 1) printLayerMenu();

		loading = false;

		/** @ts-ignore */
		micrio['goto'] = goto;

		const unsub:Unsubscriber[] = [];
		const unhook:Function[] = [];

		if(isOmni) image.state.layer.subscribe(printLayerMenu);
		if(isFullSwipe) swiper = image.swiper = new GallerySwiper(micrio, pagesPerLayer, goto, {continuous:isContinuous, coverLimit});

		unhook.push(() => {
			micrio.canvas.element.removeEventListener('pointermove', activity);
			micrio.canvas.element.removeEventListener('pointerdown', activity);
		});
		if(autoHide && !isOmni && !isOmniTwoAxes && !isFullSwipe) {
			micrio.canvas.element.addEventListener('pointermove', activity);
			micrio.canvas.element.addEventListener('pointerdown', activity);
			activity();
		}

		if(isSwitch) unsub.push(image.state.view.subscribe(() => {
			zoomedOut = camera.isZoomedOut();
		}))

		if(!(isSwitch || isFullSwipe || images.length <= 1)) {
			if(!isOmniTwoAxes) _left = getX(startIdx);

			unsub.push(image.state.view.subscribe(moved));
			micrio.addEventListener('panstart', pStart);
			micrio.addEventListener('panend', pEnd);
			micrio.addEventListener('pinchend', pEnd);

			unhook.push(() => {
				micrio.removeEventListener('panstart', pStart);
				micrio.removeEventListener('panend', pEnd);
				micrio.removeEventListener('pinchend', pEnd);
			});
		}
		if(isOmni) micrio.addEventListener('move', frameChanged);

		return () => {
			if(swiper) swiper.destroy();
			while(unsub.length) unsub.shift()?.();
			while(unhook.length) unhook.shift()?.();
			if(isOmni) micrio.removeEventListener('move', frameChanged);
		}
	});
</script>

<svelte:window on:keydown={keydown} />

{#if !noUI}
	{#if isOmniTwoAxes}
		<button class="angular" class:dragging={dragging}
			on:pointerdown|capture|preventDefault|stopPropagation={rotateStart}>&#10021;</button>
	{:else if omniSettings && !omniSettings.noDial && isOmni}
		<Dial {currentRotation} frames={pagesPerLayer} degrees={$settings.omni?.showDegrees} on:turn={e => goto(e.detail)} />
	{:else if !isFullSwipe && images.length > 1 }
		<div class:hidden={loading||($hidden && !dragging && !panning)}>
			<Button type="arrow-left" title={$i18n.galleryPrev} className="gallery-btn" on:pointerdown={() => goto(currentPage - 1)} disabled={currentPage==0}></Button>
			<ul bind:this={_ul}>
				{#each pages as page, i}<li class:active={i==currentPage}><button on:click={() => goto(i, true)} on:keypress={e => { if(e.key === 'Enter') goto(i, true)}} class="bullet">&bull;</button></li>{/each}
				<button style={`left: ${left}px`} class:dragging={dragging}
					on:pointerdown|capture|preventDefault|stopPropagation={scrubStart}
					on:touchstart|capture|preventDefault|stopPropagation={scrubStart}></button>
			</ul>
			<Button type="arrow-right" title={$i18n.galleryNext} className="gallery-btn" on:pointerdown={() => goto(currentPage + 1)} disabled={currentPage==images.length-1}></Button>
		</div>
	{/if}
{/if}

<style>
	ul {
		position: absolute;
		bottom: var(--micrio-border-margin);
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		list-style-type: none;
		background: var(--micrio-background);
		border-radius: var(--micrio-border-radius);
		padding: 0 16px;
		margin: 0;
		color: var(--micrio-color);
		transition: opacity .25s ease;
		max-width: calc(100vw - 50px);
		max-width: calc(100cqw - 50px);
		width: 520px;
		touch-action: none;
	}
	@media (max-width: 500px) {
		ul {
			left: 5px;
			right: 52px;
			width: auto;
			transform: none;
		}
		div.hidden > ul {
			transition-delay: .25s;
		}
	}

	li {
		flex: 1;
		transition: none;
		padding: 0;
		line-height: var(--micrio-button-size);
		font-size: 32px;
		text-align: center;
		width: 0;
		transition: opacity .25s ease;
		opacity: .25;
		display: flex;
		height: 48px;
	}
	li.active {
		transition-duration: 0s;
		opacity: 1;
	}
	li > button {
		border: none;
		color: inherit;
		cursor: pointer;
		flex: 1;
	}

	@media (hover: hover) {
		li:hover {
			transition-duration: 0s;
			opacity: 1;
		}
	}

	button:not(.bullet) {
		position: absolute;
		width: var(--micrio-button-size);
		height: var(--micrio-button-size);
		box-sizing: border-box;
		background: #eee3;
		border: none;
		border-radius: var(--micrio-border-radius);
		touch-action: none;
		transition: left .15s ease, background-color .2s ease;
		transform: translateX(-50%);
	}
	ul > button {
		top: 0;
		left: 0;
		cursor: ew-resize;
	}
	button.angular {
		bottom: 42px;
		left: 50%;
		color: #444;
		font-size: 32px;
		line-height: 42px;
		padding: 0;
		cursor: move;
	}
	button:not(.bullet):hover {
		background: #eee8;
	}
	button:not(.bullet).dragging {
		transition: none;
	}

	div {
		display: contents;
		transition: opacity .5s ease;
	}
	div.hidden:not(:hover) > :global(*),
	div > :global(button.gallery-btn:disabled) {
		opacity: 0;
		pointer-events: none;
	}

	div > :global(button.gallery-btn) {
		position: absolute;
		top: 50%;
		transform: translateY(-50%);
	}
	div > :global(button.gallery-btn.arrow-left) {
		left: var(--micrio-border-margin);
	}
	div > :global(button.gallery-btn.arrow-right) {
		right: var(--micrio-border-margin);
	}
</style>
