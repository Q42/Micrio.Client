<script lang="ts">
	/**
	 * Controls.svelte - Renders the main UI control buttons.
	 *
	 * This component displays buttons for common actions like zoom, fullscreen,
	 * mute, language switching, and sharing, typically positioned in the bottom-right corner.
	 * Its visibility and the specific buttons shown are determined by the
	 * current image settings and application state.
	 */

	import type { HTMLMicrioElement } from '../../ts/element';
	import type { MicrioImage } from '../../ts/image';
	import type { Models } from '../../types/models';
	import type { Unsubscriber } from 'svelte/store';

	import { fade } from 'svelte/transition';
	import { getContext, onMount } from 'svelte';

	// Micrio TS imports
	import { i18n } from '../../ts/i18n';
	import { once } from '../../ts/utils';
	import { languageNames } from '../../ts/langs';

	// UI sub-component imports
	import Button from '../ui/Button.svelte';
	import ButtonGroup from '../ui/ButtonGroup.svelte';
	import Fullscreen from '../ui/Fullscreen.svelte';
	import ZoomButtons from '../ui/ZoomButtons.svelte';

	// --- Props ---

	interface Props {
		/** Indicates if any audio (music, positional, video) is potentially active. */
		hasAudio?: boolean;
	}

	let { hasAudio = false }: Props = $props();

	// --- Context & State ---

	/** Get the main Micrio element instance from context. */
	const micrio = $state(<HTMLMicrioElement>getContext('micrio'));
	/** Destructure needed stores and properties from the micrio instance. */
	const { current, state: micrioState, isMuted, _lang } = micrio;
	/** Reference to the active tour and popup store. */
	const { tour, popup } = micrioState;
	/** Destructure UI state stores. */
	const { controls, zoom, hidden } = micrio.state.ui;

	// --- Reactive Declarations (`$:`) ---

	/** Reactive reference to the current image's info store value. */
	const info = $derived($current?.info);
	/** Reactive array of available language codes for the current image. */
	const cultures = $derived($info && $current
		? $current.isV5 ? Object.keys($info.revision??{[$_lang]:0}) // V5: Get keys from revision object
		: ('cultures' in $info ? $info.cultures as string : '')?.split(',') ?? [] // V4: Split 'cultures' string
		: []);
	/** Reactive flag indicating if the active tour is a serial tour. */
	const isActiveSerialTour = $derived($tour && 'steps' in $tour && $tour.isSerialTour);

	// --- Event Handlers & Functions ---

	/** Handles the click event for the share button. Uses the Web Share API if available. */
	function share(){
		if(navigator.share && $current?.$info) {
			// Get language-specific data if available
			const cData = !$current.$data ? undefined : $current.$data?.i18n ? $current.$data.i18n[$_lang]
				: $current.$data as Models.ImageData.ImageDetailsCultureData;
			// Prepare share data
			navigator.share({
				title: $current.$info?.title,
				text: cData?.description || `${$current.$info.width} x ${$current.$info.height} | Micrio`, // Fallback text
				url: location.href // Share current URL
			});
		}
	}

	/** Stores the MicrioImage instance for secondary controls in split-screen mode. */
	let secondaryControls:MicrioImage|null = $state(null);
	/** Stores the orientation of the secondary controls container. */
	let secondaryPortrait:boolean = $state(false);

	/** Event handler for 'splitscreen-start'. Sets up secondary controls if needed. */
	function splitStart(e:Models.MicrioEventMap['splitscreen-start']) {
		const img = e.detail;
		// Only show separate controls for the secondary image if it's interactive (not passive)
		secondaryPortrait = micrio.canvas.viewport.portrait; // Store orientation for styling
		if(!img.opts.isPassive) secondaryControls = img;
	}

	/** Event handler for 'splitscreen-stop'. Clears secondary controls. */
	function splitStop() {
		secondaryControls = null;
	}

	// --- Local State for Control Visibility ---

	/** Controls whether the language switch button/menu is shown. */
	let showCultures:boolean = $state(false);
	/** Controls whether the share button is shown. */
	let showSocial:boolean = $state(false);
	/** Controls whether the fullscreen button is shown. */
	let showFullscreen:boolean = $state(false);

	/** Reads relevant settings from the image info and updates local state and UI stores. */
	function readInfo(s:Models.ImageInfo.Settings) {
		zoom.set(!s.noZoom); // Update zoom UI store based on setting
		controls.set(!s.noControls); // Update controls UI store
		showCultures = !!s.ui?.controls?.cultureSwitch; // Check specific UI setting for culture switch
		showSocial = !!s.social; // Check social setting
		showFullscreen = !!s.fullscreen; // Check fullscreen setting
	}

	// Read initial settings if a current image exists
	if($current) readInfo($current.$settings);

	// --- Lifecycle ---

	onMount(() => {
		// Add event listeners for split screen events
		micrio.addEventListener('splitscreen-start', splitStart);
		micrio.addEventListener('splitscreen-stop', splitStop);

		let settingsUnsub:Unsubscriber|undefined; // To store the settings subscription

		// Subscribe to the current image store
		const currentUnsub = micrio.current.subscribe(c => {
			if(c) {
				// Once the image info is loaded for the new current image
				once(c.info).then(i => {
					// Don't update settings if info failed or if a marker tour is active
					// (Tour controls might override standard controls visibility)
					if(!i || ($tour && 'steps' in $tour)) return;

					// Unsubscribe from previous settings store if necessary
					settingsUnsub?.();
					// Subscribe to the new image's settings store and update local state
					settingsUnsub = c.settings.subscribe(readInfo);
				});
			}
		});

		// Cleanup function: remove listeners and unsubscribe on component destroy
		return () => {
			micrio.removeEventListener('splitscreen-start', splitStart);
			micrio.removeEventListener('splitscreen-stop', splitStop);
			settingsUnsub?.(); // Unsubscribe from settings
			currentUnsub(); // Unsubscribe from current image
		}
	});

	// --- Reactive Visibility Calculations ---

	/** Determine if the mute button should be shown (Web Audio available or explicit audio prop). */
	const showMute = $derived('micrioAudioContext' in window || hasAudio);
	/** Determine if the language switch should be shown (setting enabled and multiple languages exist). */
	const hasCultures = $derived(showCultures && cultures.length > 1);
	/** Determine if the share button should be shown (setting enabled and Web Share API available). */
	const hasSocial = $derived(showSocial && ('share' in navigator));
	/** Determine if the fullscreen button should be shown (setting enabled and not in a serial tour). */
	const hasFullscreen = $derived(showFullscreen && !isActiveSerialTour);
	/** Determine if the entire controls container should be shown. */
	const hasControls = $derived($controls && !$hidden && (showMute || hasCultures || hasSocial || $zoom || hasFullscreen));
	/** Show only fullscreen button when having popup on mobile screen */
	const onlyFullscreen = $derived($popup && micrio.canvas.$isMobile);

</script>

<!-- Render the controls container only if `hasControls` is true -->
{#if hasControls}
	<aside>
		{#if !onlyFullscreen}
			<!-- Mute Button -->
			{#if showMute}
				<Button
					type={$isMuted ? 'volume-off' : 'volume-up'}
					title={$isMuted ? $i18n.audioUnmute : $i18n.audioMute}
					onclick={() => isMuted.set(!$isMuted)}
				/>
			{/if}

			<!-- Language Switch Menu -->
			{#if hasCultures}
				<menu class="popout">
					<Button title={$i18n.switchLanguage} type="a11y" /><!-- Accessibility icon -->
					{#each cultures as l}
						<Button
							onclick={() => micrio.lang = l}
							title={languageNames?.of(l) ?? l}
							active={l==$_lang}
						>
							{l.toUpperCase()}
						</Button>
					{/each}
				</menu>
			{/if}

			<!-- Share Button -->
			{#if hasSocial}
				<Button type="share" title={$i18n.share} onclick={share} />
			{/if}
		{/if}

		<!-- Zoom and Fullscreen Buttons -->
		<ButtonGroup>
			{#if $zoom && !onlyFullscreen}
				<!-- Render secondary zoom controls if active, otherwise primary -->
				{#if secondaryControls}
					<ZoomButtons image={secondaryControls} />
				{:else}
					<ZoomButtons />
				{/if}
			{/if}
			{#if hasFullscreen}
				<Fullscreen el={micrio} />
			{/if}
		</ButtonGroup>
	</aside>

	<!-- Render primary zoom controls separately if secondary controls are shown (for split screen) -->
	{#if $zoom && secondaryControls}
		<aside class="primary" transition:fade class:portrait={secondaryPortrait}>
			<ButtonGroup>
				<ZoomButtons />
			</ButtonGroup>
		</aside>
	{/if}
{/if}

<style>
	/* Main container styling */
	aside {
		position: absolute;
		right: var(--micrio-border-margin);
		bottom: var(--micrio-border-margin);
		padding: 0;
		margin: 0;
		transition: transform .5s ease, opacity .5s ease;
		direction: rtl; /* Right-to-left for button order */
	}

	/* Styling for primary controls in split-screen (non-portrait) */
	aside.primary:not(.portrait) {
		right: calc(50% + var(--micrio-border-margin)); /* Position left of center */
	}
	/* Styling for primary controls in split-screen (portrait) */
	aside.primary.portrait {
		bottom: calc(50% + var(--micrio-border-margin)); /* Position above center */
	}

	/* Hide controls during image switching or when a tour is active */
	:global(micr-io[data-switching]) > aside,
	:global(micr-io[data-tour-active]) > aside {
		opacity: 0;
		pointer-events: none;
	}

	/* Styling for individual buttons and menus within the container */
	aside > :global(menu),
	aside > :global(button) {
		padding: 0;
		margin: 8px 0; /* Vertical spacing */
		display: block;
		width: var(--micrio-button-size);
	}

	/* Styling for the language popout menu */
	menu.popout {
		padding: 0;
		width: var(--micrio-button-size);
		height: var(--micrio-button-size);
		white-space: pre; /* Prevent wrapping */
		direction: rtl;
		pointer-events: none; /* Only allow interaction when focused/hovered */
		box-shadow: var(--micrio-button-shadow);
		border-radius: var(--micrio-border-radius);
		backdrop-filter: var(--micrio-background-filter);
	}
	/* Enable interaction when focused */
	menu.popout:focus-within {
		pointer-events: all;
	}

	/* Styling for buttons inside the popout menu */
	menu.popout :global(button) {
		pointer-events: all;
		transition: border-radius .2s ease, opacity .2s ease;
		--micrio-button-shadow: none; /* Remove individual shadow */
		--micrio-background-filter: none; /* Remove individual filter */
	}

	/* Adjust first button's border-radius on hover/focus */
	menu.popout:hover > :global(button:first-child) {
		border-radius: 0 var(--micrio-border-radius) var(--micrio-border-radius) 0;
	}

	/* Hide non-first buttons initially */
	menu.popout > :global(*:not(:nth-child(1))) {
		display: inline-block;
		padding: 0;
		transition: opacity .2s ease;
		border-radius: 0;
	}

	/* Adjust last button's border-radius */
	menu.popout > :global(button:last-child) {
		border-radius: var(--micrio-border-radius) 0 0 var(--micrio-border-radius);
	}

	/* Disable pointer events on hidden buttons */
	menu.popout:not(:focus-within) > :global(*:not(:nth-child(1))) {
		pointer-events: none;
		opacity: 0;
	}
</style>
