<script lang="ts" context="module">
	export type IconName=(
		'zoom-in'|'zoom-out'|'maximize'|'minimize'|'close'|
		'arrow-right'|'arrow-down'|'arrow-left'|'arrow-up'|
		'play'|'pause'|'subtitles'|'subtitles-off'|'volume-off'|'volume-up'|
		'play-filled'|'a11y'|'menu'|'audio'|'video'|'share'|
		'error'|'chevron-down'|'link'|'link-ext'|'ellipsis-vertical'|'image'
	);
</script>

<script lang="ts">
	import type { HTMLMicrioElement } from '../../ts/element';
	import { faImage, type IconDefinition } from '@fortawesome/free-solid-svg-icons'

	import { getContext } from 'svelte';

	import Fa from 'svelte-fa';
	import {
		faPlayCircle,
		faPause,
		faPlay,
		faGlobe,
		faBars,
		faXmark,
		faPlus,
		faMinus,
		faExpand,
		faCompress,
		faVolumeHigh,
		faVolumeXmark,
		faClosedCaptioning,
		faArrowLeft,
		faArrowUp,
		faArrowRight,
		faArrowDown,
		faVideo,
		faExternalLink,
		faShare,
		faCircleExclamation,
		faChevronDown,
		faLink,
		faEllipsisVertical
	} from '@fortawesome/free-solid-svg-icons';

	export let style:string|null=null;
	export let name:IconName;

	const micrio = <HTMLMicrioElement>getContext('micrio');

	const small = name == 'chevron-down' || name == 'link-ext';

	const i = micrio.defaultSettings?.ui?.icons;
	$: customHTML = i && (
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
		null);

	const lib:Map<IconName, IconDefinition> = new Map([
		['play', faPlay],
		['pause', faPause],
		['close', faXmark],
		['play-filled', faPlayCircle],
		['a11y', faGlobe],
		['menu', faBars],
		['zoom-in', faPlus],
		['zoom-out', faMinus],
		['maximize', faExpand],
		['minimize', faCompress],
		['volume-off', faVolumeXmark],
		['volume-up', faVolumeHigh],
		['subtitles', faClosedCaptioning],
		['subtitles-off', faClosedCaptioning],
		['arrow-left', faArrowLeft],
		['arrow-up', faArrowUp],
		['arrow-right', faArrowRight],
		['arrow-down', faArrowDown],
		['video', faVideo],
		['audio', faVolumeHigh],
		['image', faImage],
		['share', faShare],
		['error', faCircleExclamation],
		['chevron-down', faChevronDown],
		['link', faLink],
		['link-ext', faExternalLink],
		['ellipsis-vertical', faEllipsisVertical]
	]);

</script>

{#if customHTML}{@html customHTML}
{:else if lib.has(name)}<Fa icon={lib.get(name)} size={small ? '14' :'24'} {style} />{/if}
