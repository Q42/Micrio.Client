<script lang="ts">
	import type { HTMLMicrioElement } from '../../ts/element';
	import type { Models } from '../../types/models';

	import { getContext } from 'svelte';

	export let gallery:Models.Assets.Image[];
	export let startId:string|undefined = undefined;

	const micrio = <HTMLMicrioElement>getContext('micrio');
	const { _lang, current } = micrio;

	// For gallery, show titles
	let galleryIdx:number;
	const gallerySwitch = (e:CustomEvent) : void => { galleryIdx = e.detail as number; }

	$: gallCurr = gallery[galleryIdx];
	$: galleryCaption = gallCurr?.i18n?.[$_lang]?.description ?? undefined;

</script>

<figure>
	<micr-io data-gallery={gallery.map(i => `${i.micrioId},${i.width},${i.height},${i.isDeepZoom?'d':''}${i.isWebP?',w':i.isPng||(!$current?.isV5&&i.src?.endsWith('.png'))?',p' : ''}`).join(';')}
		data-start={startId}
		data-path={$current && $current.$info && $current.$info.path}
		data-logo="false"
		on:gallery-show={gallerySwitch}></micr-io>
	{#if galleryCaption}<figcaption>{@html galleryCaption}</figcaption>{/if}
</figure>

<style>
	/** Gallery */
	micr-io {
		background: #1118;
	}
	micr-io :global(ul.micrio-gallery) {
		--micrio-border-margin: 16px;
	}

	@media (min-width: 501px) {
		micr-io:not(:fullscreen) > :global(aside) {
			position: fixed;
		}
	}
</style>
