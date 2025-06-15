<script lang="ts" module>
	/**
	 * Module script for Icon.svelte
	 *
	 * Defines the `IconName` type, which lists all valid standard icon names
	 * that can be used with the Icon component.
	 */

	/** Union type defining the valid names for standard icons. */
	export type IconName=(
		'zoom-in'|'zoom-out'|'maximize'|'minimize'|'close'|
		'arrow-right'|'arrow-down'|'arrow-left'|'arrow-up'|
		'play'|'pause'|'subtitles'|'subtitles-off'|'volume-off'|'volume-up'|
		'play-filled'|'a11y'|'menu'|'audio'|'video'|'share'|
		'error'|'chevron-down'|'link'|'link-ext'|'ellipsis-vertical'|'image'
	);
</script>

<script lang="ts">
	/**
	 * Icon.svelte - Renders an icon, either standard Font Awesome or custom HTML.
	 *
	 * This component displays an icon based on the provided `name` prop.
	 * It first checks if custom HTML is defined for that icon name in the
	 * Micrio settings (`micrio.defaultSettings.ui.icons`). If so, it renders
	 * the custom HTML. Otherwise, it looks up the corresponding Font Awesome
	 * icon definition and renders it using the `svelte-fa` component.
	 */

	import type { HTMLMicrioElement } from '../../ts/element';
	import { faImage, type IconDefinition } from '@fortawesome/free-solid-svg-icons'; // Import default image icon

	import { getContext } from 'svelte';

	import Fa from 'svelte-fa'; // Font Awesome Svelte component
	// Import specific Font Awesome icons used
	import {
		faPlayCircle, faPause, faPlay, faGlobe, faBars, faXmark, faPlus, faMinus,
		faExpand, faCompress, faVolumeHigh, faVolumeXmark, faClosedCaptioning,
		faArrowLeft, faArrowUp, faArrowRight, faArrowDown, faVideo, faExternalLink,
		faShare, faCircleExclamation, faChevronDown, faLink, faEllipsisVertical
	} from '@fortawesome/free-solid-svg-icons';

	// --- Props ---
	interface Props {
		/** Optional inline style string for the icon element. */
		style?: string|undefined; // Changed from string|null
		/** The name of the standard icon to display, or used as a key for custom HTML. */
		name: IconName;
	}

	let { style = undefined, name }: Props = $props();

	// --- Context & Setup ---

	/** Get the main Micrio element instance from context. */
	const micrio = <HTMLMicrioElement>getContext('micrio');

	/** Flag for icons that should be rendered smaller. */
	const small = name == 'chevron-down' || name == 'link-ext';

	// --- Custom HTML Logic ---

	/** Get custom icon settings from Micrio default settings. */
	const i = micrio.defaultSettings?.ui?.icons;
	/** Reactive variable holding the custom HTML string for the current icon name, if defined. */
	const customHTML = $derived(i && (
		name == 'zoom-in' ? i.zoomIn :
		name == 'zoom-out' ? i.zoomOut :
		name == 'maximize' ? i.fullscreenEnter :
		name == 'minimize' ? i.fullscreenLeave :
		name == 'close' ? i.close :
		name == 'arrow-right' ? i.next :
		name == 'arrow-left' ? i.prev :
		name == 'arrow-up' ? i.up :
		name == 'arrow-down' ? i.down :
		name == 'play' ? i.play :
		name == 'pause' ? i.pause :
		name == 'subtitles' ? i.subtitles :
		name == 'subtitles-off' ? i.subtitlesOff :
		name == 'volume-off' ? i.muted :
		name == 'volume-up' ? i.unmuted :
		null)); // Return null if no custom HTML is defined for this name

	// --- Font Awesome Icon Mapping ---

	/** Map associating standard icon names with their Font Awesome icon definitions. */
	const lib:Map<IconName, IconDefinition> = new Map([
		['play', faPlay],
		['pause', faPause],
		['close', faXmark],
		['play-filled', faPlayCircle],
		['a11y', faGlobe], // Accessibility/Language icon
		['menu', faBars],
		['zoom-in', faPlus],
		['zoom-out', faMinus],
		['maximize', faExpand],
		['minimize', faCompress],
		['volume-off', faVolumeXmark],
		['volume-up', faVolumeHigh],
		['subtitles', faClosedCaptioning],
		['subtitles-off', faClosedCaptioning], // Use same icon for off state?
		['arrow-left', faArrowLeft],
		['arrow-up', faArrowUp],
		['arrow-right', faArrowRight],
		['arrow-down', faArrowDown],
		['video', faVideo],
		['audio', faVolumeHigh], // Use volume icon for generic audio
		['image', faImage],
		['share', faShare],
		['error', faCircleExclamation],
		['chevron-down', faChevronDown],
		['link', faLink],
		['link-ext', faExternalLink],
		['ellipsis-vertical', faEllipsisVertical]
	]);

	const icon = $derived(lib.get(name));

</script>

{#if customHTML}
	<!-- Render custom HTML if defined -->
	{@html customHTML}
{:else if icon}
	<!-- Otherwise, render Font Awesome icon using svelte-fa -->
	<!-- Ensure lib.get(name) is not undefined before passing to Fa using ! -->
	<Fa {icon} size={small ? 'xs' :'sm'} {style} />
{/if}

<!-- No specific styles needed, styling is applied by parent components or globally -->
