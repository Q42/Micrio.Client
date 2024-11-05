<script lang="ts">
	import type { HTMLMicrioElement } from '../../ts/element';
	import type { MicrioImage } from '../../ts/image';
	import type { Models } from '../../types/models';
	import type { Unsubscriber } from 'svelte/store';

	import { fade } from 'svelte/transition';
	import { getContext, onMount } from 'svelte';

	import { i18n } from '../../ts/i18n';
	import { once } from '../../ts/utils';
	import { languageNames } from '../../ts/langs';

	import Button from '../ui/Button.svelte';
	import ButtonGroup from '../ui/ButtonGroup.svelte';
	import Fullscreen from '../ui/Fullscreen.svelte';
	import ZoomButtons from '../components/ZoomButtons.svelte';

	export let hasAudio:boolean = false;

	const micrio = <HTMLMicrioElement>getContext('micrio');
	const { current, state, isMuted, _lang } = micrio;

	const tour = state.tour;

	const { controls, zoom, hidden } = micrio.state.ui;

	$: info = $current?.info;
	$: cultures = $info && $current
		? $current.isV5 ? Object.keys($info.revision??{[$_lang]:0})
		: ('cultures' in $info ? $info.cultures as string : '')?.split(',') ?? []
		: [];

	$: isActiveSerialTour = $tour && 'steps' in $tour && $tour.isSerialTour;

	function share(){
		if(navigator.share && $current?.$info) {
			const cData = !$current.$data ? undefined : $current.$data?.i18n ? $current.$data.i18n[$_lang]
				: $current.$data as Models.ImageData.ImageDetailsCultureData;
			navigator.share({
				title: $current.$info?.title,
				text: cData?.description || `${$current.$info.width} x ${$current.$info.height} | Micrio`,
				url: location.href
			});
		}
	}

	let secondaryControls:MicrioImage|null;
	let secondaryPortrait:boolean;
	function splitStart(e:Event) {
		const img = (e as CustomEvent).detail as MicrioImage;
		// Only give separate independent image controls
		secondaryPortrait = micrio.canvas.viewport.portrait;
		if(!img.opts.isPassive) secondaryControls = img;
	}

	function splitStop() {
		secondaryControls = null;
	}

	let showCultures:boolean = false;
	let showSocial:boolean = false;
	let showFullscreen:boolean = false;

	function readInfo(s:Models.ImageInfo.Settings) {
		zoom.set(!s.noZoom);
		controls.set(!s.noControls);
		showCultures = !!s.ui?.controls?.cultureSwitch;
		showSocial = !!s.social;
		showFullscreen = !!s.fullscreen;
	}

	if($current) readInfo($current.$settings);

	onMount(() => {
		micrio.addEventListener('splitscreen-start', splitStart);
		micrio.addEventListener('splitscreen-stop', splitStop);
		let us1:Unsubscriber|undefined;
		const us = micrio.current.subscribe(c => { if(c) {
			once(c.info).then(i => {
				// When touring, do nothing
				if(!(!i || ($tour && 'steps' in $tour))) {
					us1?.();
					us1 = c.settings.subscribe(readInfo);
				}
			});
		}})
		return () => {
			micrio.removeEventListener('splitscreen-start', splitStart);
			micrio.removeEventListener('splitscreen-stop', splitStop);
			us1?.();
			us();
		}
	});

	$: showMute = 'micrioAudioContext' in window || hasAudio;
	$: hasCultures = showCultures && cultures.length > 1;
	$: hasSocial = showSocial && ('share' in navigator);
	$: hasFullscreen = showFullscreen && !isActiveSerialTour;
	$: hasControls = $controls && !$hidden && (showMute || hasCultures || hasSocial || $zoom || hasFullscreen);

</script>

{#if hasControls}<aside>
	{#if showMute}<Button type={$isMuted ? 'volume-off' : 'volume-up'} title={$isMuted ? $i18n.audioUnmute : $i18n.audioMute} on:click={() => isMuted.set(!$isMuted)} />{/if}
	{#if showCultures && cultures.length > 1}
		<menu class="popout">
			<Button title={$i18n.switchLanguage} type="a11y" />{#each cultures as l}
				<Button on:click={() => micrio.lang = l} title={languageNames?.of(l) ?? l} active={l==$_lang}>{l.toUpperCase()}</Button>
			{/each}
		</menu>
	{/if}
	{#if showSocial && ('share' in navigator)}
		<Button type="share" title={$i18n.share} on:click={share} />
	{/if}
	<ButtonGroup>{#if $zoom}
		{#if secondaryControls}<ZoomButtons image={secondaryControls} />{:else}<ZoomButtons />{/if}
	{/if}{#if showFullscreen }
		<Fullscreen el={micrio} />
	{/if}</ButtonGroup>
</aside>{#if $zoom && secondaryControls}<aside class="primary" transition:fade class:portrait={secondaryPortrait}><ButtonGroup><ZoomButtons /></ButtonGroup></aside>{/if}{/if}

<style>
	aside {
		position: absolute;
		right: var(--micrio-border-margin);
		bottom: var(--micrio-border-margin);
		padding: 0;
		margin: 0;
		transition: transform .5s ease, opacity .5s ease;
		direction: rtl;
	}

	aside.primary:not(.portrait) {
		right: calc(50% + var(--micrio-border-margin));
	}
	aside.primary.portrait {
		bottom: calc(50% + var(--micrio-border-margin));
	}

	:global(micr-io[data-switching]) > aside,
	:global(micr-io[data-tour-active]) > aside {
		opacity: 0;
		pointer-events: none;
	}
	aside > :global(menu),
	aside > :global(button) {
		padding: 0;
		margin: 8px 0;
		display: block;
		width: var(--micrio-button-size);
	}
	menu.popout {
		padding: 0;
		width: var(--micrio-button-size);
		height: var(--micrio-button-size);
		white-space: pre;
		direction: rtl;
		pointer-events: none;
		box-shadow: var(--micrio-button-shadow);
		border-radius: var(--micrio-border-radius);
		backdrop-filter: var(--micrio-background-filter);
	}
	menu.popout:focus-within {
		pointer-events: all;
	}

	menu.popout :global(button) {
		pointer-events: all;
		transition: border-radius .2s ease, opacity .2s ease;
		--micrio-button-shadow: none;
		--micrio-background-filter: none;
	}

	menu.popout:hover > :global(button:first-child) {
		border-radius: 0 var(--micrio-border-radius) var(--micrio-border-radius) 0;
	}

	menu.popout > :global(*:not(:nth-child(1))) {
		display: inline-block;
		padding: 0;
		transition: opacity .2s ease;
		border-radius: 0;
	}

	menu.popout > :global(button:last-child) {
		border-radius: var(--micrio-border-radius) 0 0 var(--micrio-border-radius);
	}

	menu.popout:not(:focus-within) > :global(*:not(:nth-child(1))) {
		pointer-events: none;
		opacity: 0;
	}
	menu.popout > :global(*:nth-child(4)) {
		background-size: 24px;
	}

</style>
