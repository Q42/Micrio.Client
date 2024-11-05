<script lang="ts">
	import type { HTMLMicrioElement } from '../../ts/element';
	import type { Models } from '../../types/models';

	import { getContext } from 'svelte';
	import { fade } from 'svelte/transition';

	export let organisation:Models.ImageInfo.Organisation;

	const micrio = <HTMLMicrioElement>getContext('micrio');
	const { tour, marker, popover } = micrio.state;

	function getLogoSrc(img:Models.Assets.Image|string) : string {
		if(typeof img == 'string') return img;
		let l:number=0; let m = Math.max(img.width,img.height); while(m>1024) {l++;m/=2;}
		return (img.micrioId && img.width > 1024 ? 'https://r2.micr.io/' + img.micrioId + '/'+l+'/0-0.' + (img.isPng?'png':img.isWebP?'webp':'jpg') : img.src);
	}

	$: hidden = !!$tour || !!$marker || !!$popover;
</script>

{#if !hidden && organisation.logo}<a rel="noopener" href={organisation.href ?? '#'} transition:fade={{duration: 200}}
	title={organisation.name} aria-label="{organisation.name} homepage" target="_blank">
	<img src={getLogoSrc(organisation.logo)} alt="Logo" />
</a>{/if}

<style>
	a {
		position: absolute;
		top: calc(var(--micrio-border-margin) * 2);
		right: calc(var(--micrio-border-margin) * 2);
		z-index: 1;
	}
	img {
		max-height: 64px;
	}
</style>
