<script context="module" lang="ts">
	import { writable } from 'svelte/store';

	// Single current opened menu item
	const opened = writable<Models.ImageData.Menu|undefined>(undefined);
	const close = () : void => opened.set(undefined);
	let hooked:boolean = false;

	// When an item is opened, watch window for click event
	opened.subscribe(c => {
		if(c) !hooked && window.addEventListener('click', close);
		else hooked && window.removeEventListener('click', close);
		hooked = !!c;
	})
</script>

<script lang="ts">
	import type { Models } from '../../types/models';
	import type { HTMLMicrioElement } from '../../ts/element';

	import { createEventDispatcher, getContext, onMount } from 'svelte';

	import Icon from '../ui/Icon.svelte';
	import Fa from 'svelte-fa';

	export let menu: Models.ImageData.Menu;
	export let originalId:string|null = null;

	const dispatch = createEventDispatcher();

	const micrio = <HTMLMicrioElement>getContext('micrio');
	const { events, state, _lang } = micrio;

	let _button:HTMLButtonElement;

	const getCData = (m:Models.ImageData.Menu, lang:string) : Models.ImageData.MenuCultureData|undefined =>
		m.i18n?.[lang] ?? (<unknown>m as Models.ImageData.MenuCultureData);

	$: cultureData = getCData(menu, $_lang);

	function click(e:MouseEvent){
		if(!menu.link) e.preventDefault();
		if(menu.action) menu.action();
		const doClose = !!(isOpen || menu.action || menu.link);
		opened.set(doClose ? undefined : menu);
		if(doClose) dispatch('close');
	}

	onMount(() => {
		// In case no title and only 1 child, directly print this child
		if(!cultureData?.title && menu.children?.length == 1) menu = menu.children[0];

		// If no hard action function
		if(!menu.action) {
			if(menu.markerId) menu.action = () => {
				if(originalId && micrio.$current?.id != originalId)
					micrio.open(originalId);
				micrio.$current?.state.marker.set(menu.markerId);
			}
			else if(cultureData?.content || cultureData?.embed || menu.image) menu.action = () => {
				events.dispatch('page-open', menu);
				state.popover.set({contentPage:menu});
			}
		}

		menu._button = _button;
	});

	const o=(m:Models.ImageData.Menu):boolean=>m==$opened||!!m.children?.some(o);
	$: isOpen = $opened && o(menu);
</script>

<menu class:opened={isOpen} data-title={cultureData?.title?.toLowerCase()}>
	{#if menu.link}
		<a class="micrio-menu-action" on:click={click} href={menu.link} target={menu.linkTargetBlank ? '_blank' : undefined}><strong>{cultureData?.title ?? '(Unknown)'}<Icon style="opacity:.75" name="link-ext" /></strong></a>
	{:else}
		<button class="micrio-menu-action" type="button" on:click={click} bind:this={_button}>
			{#if menu.icon}<Fa icon={menu.icon} style="margin-right:10px;" />{/if}
			<strong>{cultureData?.title ?? '(Unknown)'}{#if menu.children && menu.children.length}<Icon name="chevron-down" />{/if}</strong>
		</button>
	{/if}
	{#if menu.children && menu.children.length }
		<div class="items">{#each menu.children as child,i (i+child.id)}
			<svelte:self menu={child} {originalId} on:close />
		{/each}</div>
	{/if}
</menu>

<style>
	menu {
		padding: 0;
		margin: 0;
		transition: background .2s ease, box-shadow .2s ease;
	}
	.micrio-menu-action {
		font-family: inherit;
		background: transparent;
		display: block;
		border: none;
		padding: 0 24px;
		font-size: .9em;
		cursor: pointer;
		text-decoration: none;
		border-radius: 0;
		color: inherit;
		text-shadow: inherit;
		box-sizing: border-box;
		text-align: center;
	}

	@media (max-width: 500px) {
		menu {
			font-size: 1em;
		}
		.micrio-menu-action {
			width: 100%;
			margin-bottom: 10px;
			padding: 6px 0;
		}

		strong > :global(svg) {
			display: none;
		}

		:global(.items) > menu > .micrio-menu-action {
			font-size: 1em;
		}
		:global(menu.micrio-toolbar) > menu > .micrio-menu-action {
			font-size: 1.5em;
			border-bottom: 1px solid rgba(255,255,255,.5);
			margin-top: 24px;
		}
	}

	@media (min-width: 501px) {
		div.items {
			max-height: calc(100vh - 160px);
			overflow-y: auto;
			overflow-x: hidden;
		}
		:global(menu.micrio-toolbar) > menu {
			color: #fff;
			margin-right: var(--micrio-border-margin);
			border-radius: var(--micrio-border-radius);
			overflow: hidden;
		}
		:global(menu.micrio-toolbar) > menu:hover,
		:global(menu.micrio-toolbar) > menu:focus-within {
			backdrop-filter: var(--micrio-background-filter);
			background: var(--micrio-background);
			box-shadow: var(--micrio-button-shadow);
		}
		:global(menu.micrio-toolbar) > menu > .micrio-menu-action {
			position: relative;
		}
		:global(menu.micrio-toolbar) > menu > .micrio-menu-action > strong {
			padding: 5px;
			margin: 0 -5px;
		}
		:global(menu.micrio-toolbar) > menu:hover .micrio-menu-action,
		:global(menu.micrio-toolbar) > menu:focus-within .micrio-menu-action {
			text-shadow: none;
			color: var(--micrio-color);
		}
		strong > :global(svg) {
			margin-left: 10px;
			line-height: 2px;
		}
		menu {
			float: left;
		}
		menu:not(:focus-within):not(:hover) .items {
			display: none;
		}
		.micrio-menu-action {
			height: var(--micrio-button-size);
			line-height: var(--micrio-button-size);
			width: 100%;
			text-align: var(--micrio-text-align);
			white-space: pre;
			font-weight: 600;
		}
		:global(.items) menu {
			float: none;
		}
		:global(.items) .micrio-menu-action {
			width: 100%;
		}
		.micrio-menu-action:hover {
			text-shadow: none !important;
		}
		.micrio-menu-action:hover {
			color: var(--micrio-color-hover) !important;
		}
	}
</style>
