<script lang="ts">
	import type { Models } from '../../types/models';
	import type { HTMLMicrioElement } from '../../ts/element';
	import { writable, type Unsubscriber } from 'svelte/store';

	import { onMount, getContext } from 'svelte';
	import { MicrioImage } from '../../ts/image';
	import { once, createGUID, Browser } from '../../ts/utils';
	import { GLEmbedVideo } from '../../ts/embedvideo';

	import Media from '../components/Media.svelte';

	const micrio = <HTMLMicrioElement>getContext('micrio');
	const { current, wasm, canvas } = micrio;

	export let embed:Models.ImageData.Embed;

	const mainImage = $current as MicrioImage;
	const info = mainImage.$info as Models.ImageInfo.ImageInfo;

	if(!embed.uuid) embed.uuid = createGUID();
	const uuid = embed.uuid;

	const is360 = mainImage.is360;
	const autoplay = embed.video?.autoplay ?? true;

	let image:MicrioImage = mainImage.embeds.find(i => i.uuid == uuid || i.$info?.title == uuid) as MicrioImage;

	// MacOS/iOS with HDR screens auto-"optimize" non-HDR vids which messes up the colors
	// Always force inside-GL rendering for HDR screens
	// Mac M2 with HDR screens don't support the CSS query -_- so just enable WebGL rendering for all MacOS
	const screenIsHDR = window.matchMedia('(dynamic-range: high)').matches || Browser.OSX;

	const a = embed.area;
	const isSVG = embed.src?.toLowerCase().endsWith('.svg');
	const isSmall = embed.width && embed.height ? embed.width * embed.height < Math.pow(1024,2) : false;

	// iOS14 HLS videos won't work within GL rendering
	const isIOS14 = /iPhone OS 14_/i.test(navigator.userAgent);

	// Use this option to embed video inside WebGL
	const glAttr = 'data-embeds-inside-gl';
	const glAttrValue = micrio.getAttribute(glAttr);
	const embedImageAsHtml = isSVG || isIOS14 || (!screenIsHDR && !micrio.hasAttribute(glAttr)) || glAttrValue == 'false';

	// Print the image / video inside Micrio's WebGL context
	const printGL = !embedImageAsHtml && !!(
		// It has a MicrioId and is big, or doesn't have an original image SRC
		(embed.micrioId && (!isSmall || !embed.src))
		// It's a non-transparent video that has controls turned off
		|| (embed.video && !embed.video.controls && !embed.video.transparent)
	);

	const noEvents = !embed.clickAction && !embed.frameSrc;
	const href = embed.clickAction == 'href' ? embed.clickTarget : undefined;
	const hrefBlankTarget = href && embed.clickTargetBlank;

	// Can be updated from Spaces studio
	let w:number = a[2]-a[0];
	let h:number = a[3]-a[1];
	let cX:number = a[0] + w / 2;
	let cY:number = a[1] + h / 2;
	let s:number = embed.scale || 1;
	let rotX:number = embed.rotX??0;
	let rotY:number = embed.rotY??0;
	let rotZ:number = embed.rotZ??0;
	let scaleX:number = embed.scaleX??1;
	let scaleY:number = embed.scaleY??1;

	let buttonStyle:string;

	function readPlacement() : void {
		const a = embed.area;
		if(is360 && a[0] > a[2]) a[0]--;
		w = a[2]-a[0];
		h = a[3]-a[1];
		cX = a[0] + w / 2;
		cY = a[1] + h / 2;

		s = embed.scale || 1;

		rotX = embed.rotX??0;
		rotY = embed.rotY??0;
		rotZ = embed.rotZ??0;
		scaleX = embed.scaleX??1;
		scaleY = embed.scaleY??1;

		buttonStyle = `--ratio:${w/h * info.width/info.height};--scale:${w * info.width / (embed.width ?? 100) / (!printGL ? s : 1) * (is360 ? Math.PI/2 : 1)};`;
		if(isSVG) buttonStyle+=`height:${embed.height}px`;
		if(printGL && embed.micrioId && embed.width) buttonStyle+=`width:${embed.width}px`;
	}

	readPlacement();

	// Size for video/frame HTML embeds
	$: width = Math.round(w * info.width);
	$: height = Math.round(h * info.height);

	let paused:boolean = false;

	let x:number = 0;
	let y:number = 0;
	let scale:number;
	let matrix:string;

	let style = '';

	function shouldPause() : boolean {
		if((!embed.video?.pauseWhenSmallerThan && !embed.video?.pauseWhenLargerThan)) return !autoplay;
		const screenSize:number = scale ? Math.max(width * scale / canvas.viewport.width, height * scale / canvas.viewport.height) : 0;
		return !!((embed.video.pauseWhenSmallerThan && (screenSize < embed.video.pauseWhenSmallerThan))
			|| (embed.video.pauseWhenLargerThan && (screenSize > embed.video.pauseWhenLargerThan)));
	}

	function moved() : void {
		// Not yet loaded
		if(!mainImage.camera.e) return;
		[x, y, scale] = mainImage.camera.getXYDirect(cX, cY);
		if(is360) matrix = mainImage.camera.getMatrix(cX, cY, s, 1, rotX, rotY, rotZ, undefined, scaleX, scaleY).join(',');
		style = (is360 ? `transform:matrix3d(${matrix});` : `--x:${x}px;--y:${y}px;--s:${scale};`)
			+ (embed.opacity !== undefined && embed.opacity !== 1 ? `--opacity:${embed.opacity};` : '');
		if((embed.video?.pauseWhenSmallerThan || embed.video?.pauseWhenLargerThan) && width) {
			const wasPaused:boolean = paused;
			paused = shouldPause();
			if(glVideo?._vid && (paused != wasPaused)) {
				if(paused) glVideo._vid.pause();
				else {
					if(mainImage?.$settings?.embedRestartWhenShown) glVideo._vid.currentTime = 0;
					glVideo._vid.play();
				}
			}
		}
	}

	function click() : void {
		if($current && embed.clickAction == 'markerId' && embed.clickTarget)
			$current.state.marker.set(embed.clickTarget);
	}

	/* For use in dash editor */
	function change(e:Event) : void {
		if(e && 'detail' in e) {
			const emb = e.detail as Models.ImageData.Embed;
			/** @ts-ignore */
			for(const x in emb) embed[x] = emb[x];
		}
		readPlacement();
		moved();
	}

	// If embed has ID of marker, watch if marker is closed to do media pre-destroy
	const destroying = writable<boolean>(false);

	if(embed.video) {
		if(!embed.video.controls) embed.video.muted = true;
	}

	const isRawVideo = printGL && !!embed.video;
	let glVideo:GLEmbedVideo|undefined = undefined;
	function printInsideGL() : void {
		const opacity = embed.hideWhenPaused ? 0.01 : embed.opacity || 1;
		if(image && image.ptr >= 0) {
			// Update placement
			image.camera.setArea(embed.area);
			image.camera.setRotation(embed.rotX, embed.rotY, embed.rotZ);
			wasm.fadeImage(image.ptr, opacity);
		}
		else {
			image = mainImage.addEmbed({
				id: embed.video ? embed.id : embed.micrioId,
				title: uuid,
				width: embed.width,
				height: embed.height,
				isPng: embed.isPng,
				isWebP: embed.isWebP,
				isDeepZoom: embed.isDeepZoom,
				path: info.tileBasePath ?? info.path,
				isSingle: !!embed.video,
				isVideo: !!embed.video,
				settings: {
					_360: { rotX, rotY, rotZ }
				},
			}, embed.area, { opacity, asImage: false });
		}

		if(isRawVideo) once(image.visible, {targetValue: true}).then(() => {
			// This takes care of loading and playing
			glVideo = new GLEmbedVideo(wasm, image, embed, paused, moved)
		});

		wasm.render();
	}

	const hasHtml = !printGL || !!embed.clickAction;
	let _mediaElement:HTMLMediaElement|undefined;

	// For <Media /> video embeds, set the embed.video.element on availability
	$: {
		if(embed.video && embed.id && $current) $current.setEmbedMediaElement(embed.id, _mediaElement??glVideo?._vid);
	}

	// Cap the max <video> element width/height to original video resolution
	$: widthCapped = embed.video ? Math.min(embed.video.width, width) : width;
	$: heightCapped = embed.video ? Math.min(embed.video.height, height) : height;
	$: relScale = width / widthCapped;

	let isMounted:boolean = false;
	onMount(() => {
		isMounted = true;
		const us:Unsubscriber[] = [];
		if(printGL) printInsideGL();
		if(hasHtml || (embed.video?.pauseWhenSmallerThan || embed.video?.pauseWhenLargerThan))
			us.push(mainImage.state.view.subscribe(moved));

		return () => {
			isMounted = false;
			glVideo?.unmount();
			if(image) {
				wasm.fadeImage(image.ptr, 0);
				wasm.render();
			}
			if(embed.video && embed.id && $current) $current.setEmbedMediaElement(embed.id);
			while(us.length) us.shift()?.();
		}
	})
</script>

{#if hasHtml && (matrix || x || y)}
<svelte:element this={href ? 'a':'div'} id={embed.id ? 'e-'+embed.id : undefined} {style}
	role={href ? undefined : 'figure'}
	class:embed-container={!0} class:embed3d={is360} class:no-events={noEvents}
	on:click={click} on:keypress={click} on:change={change} {href} target={href && hrefBlankTarget?'_blank':null}>
	{#if embed.video && !printGL}<Media forcePause={paused} src={embed.video.streamId && !embed.video.transparent ? 'cfvid://'+embed.video.streamId : embed.video.src}
		width={widthCapped} height={heightCapped} frameScale={relScale}
		controls={embed.video.controls} {destroying} loop={embed.video.loop} loopDelay={embed.video.loopAfter} muted={embed.video.muted} autoplay={!paused && embed.video.autoplay} hasTransparentH265={embed.video.transparent && embed.video.hasH265}
		bind:_media={_mediaElement} />
	{:else if embed.frameSrc}<Media src={embed.frameSrc} {width} {height} frameScale={embed.scale} autoplay={embed.autoplayFrame} {destroying} />
	{:else if !printGL && embed.src}<img src={embed.src} style={buttonStyle}
		width={isSVG ? embed.width : undefined} height={isSVG ? embed.height : undefined}
		alt="Embed" data-scroll-through />
	{:else}<button style={buttonStyle} title={embed.title} data-scroll-through></button>{/if}
</svelte:element>
{/if}

<style>
	.embed-container {
		position: absolute;
		display: block;
		top: 0;
		left: 0;
		transform: translate3d(calc(var(--x, 0) - 50%), calc(var(--y, 0) - 50%), 0) scale3d(var(--s),var(--s),1);
		opacity: var(--opacity, 1);
		direction: ltr;
	}
	.embed3d {
		top: 50%;
		left: 50%;
	}
	.embed-container.no-events {
		pointer-events: none;
	}
	.embed-container > * {
		cursor: pointer;
	}
	.embed-container > :global(*) {
		position: absolute;
		transform: translate3d(-50%,-50%,0) scale3d(var(--scale, 1), var(--scale, 1), 1);
	}
	.embed-container > :global(*:not(button)) {
		width: auto !important;
	}
	.embed-container:not(.no-events) > :global(*) {
		pointer-events: all;
	}
	.embed-container > img {
		max-width: none;
	}
	.embed-container > :global(button) {
		--scale: 1;
		--ratio: 1;
		padding: 0;
		margin: 0;
		background: transparent;
		border: none;
		width: 100px;
		aspect-ratio: var(--ratio);
	}
</style>
