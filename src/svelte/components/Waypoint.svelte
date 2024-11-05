<script lang="ts">
	import type { HTMLMicrioElement } from '../../ts/element';
	import type { Models } from '../../types/models';
	import type { MicrioImage } from '../../ts/image';

	import { fade } from 'svelte/transition';
	import { getContext, onMount } from 'svelte';

	import { clone, getLocalData, getSpaceVector } from '../../ts/utils';
	import { i18n } from '../../ts/i18n';

	import Button from '../ui/Button.svelte';

	export let targetId:string;
	export let settings:Models.Spaces.WayPointSettings = {
		i18n: {}
	};
	export let image:MicrioImage;

	const micrio = <HTMLMicrioElement>getContext('micrio');
	const lang = micrio._lang;

	const info = image.$info as Models.ImageInfo.ImageInfo;
	const spaceData = micrio.spaceData as Models.Spaces.Space;
	const imgSettings = image.$settings;
	const targetImage:Models.ImageData.ImageData|undefined = getLocalData(targetId)?.[2];

	const { directionX, v, vN, vector } = getSpaceVector(micrio, targetId)!;

	// The HTML container
	let _element:HTMLElement;

	const isOnGround = Math.abs(vN[1]) < .3;
	const defaultY = isOnGround ? .65 : .5 + vN[1]/10;

	const autoCoords:Models.Spaces.WaypointCoords = {
		x: directionX,
		y: defaultY,

		baseScale: info.width / 1024,
		scale: 1,

		rotX: (1+(isOnGround ? -(1-defaultY) : vN[1])) * Math.PI/2,
		rotY: 0,
		rotZ: 0
	};

	const customCoords = settings?.coords ?? clone<typeof autoCoords>(autoCoords);

	let isCustom = customCoords.custom;
	let coords = isCustom ? customCoords : autoCoords;

	// When tabbing through waypoints
	let fto:any;
	function focus() : void {
		if(imgSettings._markers?.noMarkerActions) return;

		// This prevents the markers from jumping
		(_element.parentNode as HTMLElement).scrollTo(0,0);
		clearTimeout(fto);
		fto = setTimeout(() => {
			const px = image.camera.getXY(coords.x, coords.y);
			if(!clicked && (px[0] < 0 || px[0] >= micrio.offsetWidth || px[1] < 0 || px[1] >= micrio.offsetHeight || (image.is360 ? px[3] > 4 : false)))
				image.camera.flyToCoo([coords.x, coords.y], {speed: 2, limit: true}).catch(() => {});
		}, 150);
	}

	let matrix:string;
	let pIconIdx:number|undefined = settings.customIconIdx;
	const onmove = () : void => {
		if(iface.deleted) {
			hidden = true;
			return;
		}
		if(pIconIdx != iface.settings.customIconIdx) {
			settings.customIconIdx = iface.settings.customIconIdx;
			pIconIdx = settings.customIconIdx;
		}
		if(customCoords.custom != isCustom) {
			isCustom = customCoords.custom;
			coords = isCustom ? customCoords : autoCoords;
		}
		matrix = image.camera.getMatrix(
			coords.x,
			coords.y,
			coords.baseScale * coords.scale,
			1,
			coords.rotX,
			coords.rotY,
			coords.rotZ
		).join(',')
	}

	let clicked = false;
	function click() : void {
		if(imgSettings._markers?.noMarkerActions) return;

		clicked = true;

		// Close any open markers
		image.openedView = undefined;
		image.state.marker.set(undefined);

		// Go in the direction of the waypoint, not relative image location
		micrio.open(targetId, { vector });
	}

	// Check if any markers replace this waypoint
	let hidden:boolean=false;

	const iface:Models.Spaces.WaypointInterface = {
		coords: customCoords,
		settings
	};

	onmove();

	onMount(() => {
		iface.el = _element;

		/** @ts-ignore */
		_element['_iface'] = iface;

		micrio.dispatchEvent(new CustomEvent<Models.Spaces.WaypointInterface>('wp-print', {detail: iface}));
		return image.state.view.subscribe(onmove);
	});

	$: title = settings.i18n?.[$lang]?.title || targetImage?.i18n?.[$lang]?.title;
	$: icon = spaceData.icons?.[settings.customIconIdx ?? -1];

</script>

{#if !hidden}<div transition:fade style="--matrix: matrix3d({matrix})" id={`w-${targetId}`} class:clicked class:active={clicked}
	class:direction-up={v[1]<0} class:direction-down={v[1]>0} bind:this={_element}>
	<Button type={icon ? undefined : 'arrow-up'} {icon} on:click={click} on:focus={focus} title={title ?? $i18n.waypointFollow} />
</div>{/if}

<style>
	div {
		display: block;
		position: absolute;
		transform-style: preserve-3d;
		transform: var(--matrix);
		width: 0;
		height: 0;
		top: 50%;
		left: 50%;
		/** temp vars */
		--micrio-bb: var(--micrio-button-background);
		--micrio-bbh: var(--micrio-button-background-hover);
	}

	div > :global(button) {
		--micrio-button-background: var(--micrio-waypoint-background, var(--micrio-bb));
		--micrio-button-background-hover: var(--micrio-waypoint-background-hover, var(--micrio-bbh));
		--micrio-button-size: var(--micrio-waypoint-size);
		--micrio-border-radius: var(--micrio-waypoint-border-radius, 100%);
		--micrio-icon-size: var(--micrio-waypoint-icon-size, calc(var(--micrio-button-size) - 50px));
		transform: translate3d(-50%,-50%, 0) scale3d(.5,.5,1);
		pointer-events: all;
		transition: background-color .25s ease, opacity .25s ease, border-color .25s ease;
		border: var(--micrio-waypoint-border-size, var(--micrio-marker-border-size)) solid var(--micrio-waypoint-border-color, var(--micrio-marker-border-color));
		margin: 0;
	}

	div > :global(button>svg) {
		pointer-events: none;
		margin: 0 auto;
	}

	div:hover > :global(button),
	div.active > :global(button) {
		transition: background-color .25s ease, opacity .25s ease;
	}

	div.clicked > :global(button) {
		animation: pulse .75s ease infinite alternate;
	}

	@keyframes pulse {
		from {
			transform: translate3d(-50%,-50%, 0) scale3d(.5,.5,1);
		}
		to {
			transform: translate3d(-50%,-50%, 0) scale3d(.75,.75,1);
		}
	}
</style>
