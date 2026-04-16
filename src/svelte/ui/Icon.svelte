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
	 * Icon.svelte - Renders an icon, either custom HTML or inline SVG.
	 *
	 * This component displays an icon based on the provided `name` prop.
	 * It first checks if custom HTML is defined for that icon name in the
	 * Micrio settings (`micrio.defaultSettings.ui.icons`). If so, it renders
	 * the custom HTML. Otherwise, it looks up the corresponding icon definition
	 * and renders it as an inline SVG.
	 */

	import type { HTMLMicrioElement } from '../../ts/element';
	import type { MicrioIcon } from '../../ts/icons';

	import { getContext } from 'svelte';
	import { icons } from '../../ts/icons';

	interface Props {
		style?: string|undefined;
		name: IconName;
	}

	let { style = undefined, name }: Props = $props();

	const micrio = <HTMLMicrioElement>getContext('micrio');

	const small = name == 'chevron-down' || name == 'link-ext';

	const i = micrio.defaultSettings?.ui?.icons;
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
		null));

	const lib: Record<IconName, MicrioIcon> = {
		'play': icons.play,
		'pause': icons.pause,
		'close': icons.xmark,
		'play-filled': icons.playCircle,
		'a11y': icons.globe,
		'menu': icons.bars,
		'zoom-in': icons.plus,
		'zoom-out': icons.minus,
		'maximize': icons.expand,
		'minimize': icons.compress,
		'volume-off': icons.volumeXmark,
		'volume-up': icons.volumeHigh,
		'subtitles': icons.closedCaptioning,
		'subtitles-off': icons.closedCaptioning,
		'arrow-left': icons.arrowLeft,
		'arrow-up': icons.arrowUp,
		'arrow-right': icons.arrowRight,
		'arrow-down': icons.arrowDown,
		'video': icons.video,
		'audio': icons.volumeHigh,
		'image': icons.image,
		'share': icons.share,
		'error': icons.circleExclamation,
		'chevron-down': icons.chevronDown,
		'link': icons.link,
		'link-ext': icons.externalLink,
		'ellipsis-vertical': icons.ellipsisVertical,
	};

	const icon = $derived(lib[name]);

</script>

{#if customHTML}
	{@html customHTML}
{:else if icon}
	<svg
		xmlns="http://www.w3.org/2000/svg"
		viewBox="0 0 {icon[0]} {icon[1]}"
		fill="currentColor"
		class="svelte-fa"
		class:small
		{style}
	><path d={icon[2]}/></svg>
{/if}

<style>
	svg {
		display: inline-block;
		height: 1em;
		overflow: visible;
		vertical-align: -.125em;
	}
	svg.small {
		height: .75em;
	}
</style>
