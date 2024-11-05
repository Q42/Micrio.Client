<script lang="ts">
	import type { Readable, Writable } from 'svelte/store';
	import type { Models } from '../../types/models';
	import type { HTMLMicrioElement } from '../../ts/element';

	import { getContext, onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import { i18n } from '../../ts/i18n';

	import Button from '../ui/Button.svelte';

	export let info:Readable<Models.ImageInfo.ImageInfo|undefined>;
	export let data:Writable<Models.ImageData.ImageData|undefined>;

	const { _lang, current } = <HTMLMicrioElement>getContext('micrio');

	function getLength(length:number) : string {
		let unit = 'cm';

		if (length >= 1e5) unit = 'km', length /= 1e5; else
		if (length >= 100) unit = 'm', length /= 100; else
		if (length < 1/1e6) unit = 'nm', length *= 1e7; else
		if (length < 1/1e3) unit = 'µm', length *= 1e4; else
		if (length < 1) unit = 'mm', length *= 10;
		return length.toFixed(2) + ' ' + unit;
	}

	let opened = false;

	$: cmWidth = $current?.$settings.cmWidth;
	$: cmHeight = $current?.$settings.cmHeight;

	$: cData = !$data ? undefined : $data?.i18n ? $data.i18n[$_lang] : $data as Models.ImageData.ImageDetailsCultureData;

	$: title = cData?.title ?? $info?.title ?? '';
	$: description = cData?.description;
	$: link = cData?.sourceUrl;
	$: copyright = cData?.copyright;

	$: size = cmWidth && cmHeight ? getLength(cmWidth) + ' x ' + getLength(cmHeight) : null;

	let _element:HTMLDetailsElement;
	onMount(() => { _element.ontoggle = () => { opened = _element.open; } });
</script>

{#if title || description || link}
	<details class:opened transition:fade={{duration: 200}} bind:this={_element}>
		{#if title || size}<summary>{#if title}<cite>{title}</cite>{/if}{#if size}<small>{size}</small>{/if}</summary>{/if}
		{#if description}{@html description}{/if}
		{#if link}<p><a rel="noopener noreferrer" href={link} target="_blank">{copyright || link}</a></p>{/if}
		{#if opened}<Button type="close" title={$i18n.close} on:click={() => _element.open = false} />{/if}
	</details>
{/if}

<style>
	details {
		position: absolute;
		bottom: var(--micrio-border-margin);
		left: var(--micrio-border-margin);
		padding: var(--micrio-popup-padding);
		font-size: .9em;
		max-width: 410px;
		user-select: text;
		white-space: normal;
		transition: all .5s ease;
		box-sizing: border-box;
		transition: transform .5s ease;
		color: var(--micrio-color);
		background: var(--micrio-background);
		backdrop-filter: var(--micrio-background-filter);
		box-shadow: var(--micrio-popup-shadow);
		border-radius: var(--micrio-border-radius);
	}

	details summary {
		cursor: pointer;
	}

	details small {
		display: block;
		font-style: italic;
		font-weight: normal;
	}

	details > * {
		margin: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	details :global(a) {
		color: #23b9f5;
	}

	details :global(button) {
		position: absolute;
		top: 0;
		left: calc(100% + 8px);
	}

	@media (max-width: 600px) {
		details {
			max-width: calc(100% - 10px);
		}
		details:not([open]) cite {
			display: none;
		}
		details:not([open]) summary::marker {
			content: '?';
			font-size: 20px;
			font-weight: bold;
			line-height: 20px;
		}
		details :global(button) {
			position: absolute;
			top: auto;
			left: auto;
			right: 0;
			bottom: calc(100% + 8px);
		}
	}

</style>
