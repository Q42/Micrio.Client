<script lang="ts">
	import type { MicrioImage } from '$ts/image';
	import Embed from './Embed.svelte';

	interface Props {
		/** The MicrioImage whose embeds should be rendered. */
		image: MicrioImage;
	}

	let { image }: Props = $props();

	const { data } = image;
</script>

{#if $data?.embeds}
	{#each $data.embeds as embed (embed.uuid)}
		<Embed {embed} {image} />
	{/each}
{/if}
