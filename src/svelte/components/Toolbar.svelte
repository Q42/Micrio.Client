<script lang="ts">
	import type { Models } from '../../types/models';
	import type { HTMLMicrioElement } from '../../ts/element';
	import type { MicrioImage } from '../../ts/image';
	import type { Unsubscriber } from 'svelte/store';

	import { onMount, getContext, tick } from 'svelte';
	import { fade } from 'svelte/transition';

	import { createGUID, once } from '../../ts/utils';
	import { i18n } from '../../ts/i18n';

	import Menu from './Menu.svelte';
	import Button from '../ui/Button.svelte';

	let data: Models.ImageData.ImageData|undefined;

	const micrio = <HTMLMicrioElement>getContext('micrio');
	const { state, current, _lang, spaceData } = micrio;
	const { tour, marker, popover } = state;

	let shown:boolean=false;
	let indented:boolean=false;
	const originalId = ($current as MicrioImage).id;

	let mainPages:Models.ImageData.Menu[]|undefined;

	let isMobile:boolean;
	const resize = ():boolean => isMobile = window.innerWidth <= 500;
	resize();

	const close = () => { if(isMobile) shown = false };

	$: hidden = !!$tour || !!$marker || !!$popover;
	$: markerTours = (data?.markerTours ?? []).concat(spaceData?.markerTours ?? []);
	$: hasMarkerTours = markerTours?.length;
	$: hasVideoTours = data?.tours?.length;
	$: hasBothTourTypes = hasMarkerTours && hasVideoTours;

	$: empty = !(mainPages?.length || hasMarkerTours || hasVideoTours);

	const unsubs:Unsubscriber[] = [];

	const getTourTitle = (t:Models.ImageData.Tour, lang:string) : string => ('title' in t ? t['title'] as string
		: t.i18n?.[lang]?.title) ?? '(Untitled)';

	onMount(() => {
		const us = micrio.current.subscribe(c => { if(!c) return;
			while(unsubs.length) unsubs.shift()?.();
			once(c.info).then(() => indented = !c.$settings.noLogo);
			unsubs.push(c.data.subscribe(d => {
				data = d;
				// Always keep first image pages in menu
				tick().then(() => {
					if(!d?.pages) return;
					if(!mainPages) mainPages = d.pages?.filter(p => !p.id?.startsWith('_'));
					// Auto generated menus (ie layer switcher for omni)
					const imageSpecific = d.pages?.filter(p => p.id?.startsWith('_'));
					if(imageSpecific.length) mainPages = [
						...mainPages.filter(p => !p.id?.startsWith('_')),
						...imageSpecific
					];
				});

			}));
		});

		window.addEventListener('resize', resize);
		return () => {
			window.removeEventListener('resize', resize);
			while(unsubs.length) unsubs.shift()?.();
			us();
		}
	});
</script>

{#if !empty && !hidden}
	<menu class:shown={!hidden && shown} class:indent={indented} class="micrio-toolbar" transition:fade={{duration: 200}}>
		{#if mainPages}{#each mainPages as menu (menu.id)}<Menu {menu} {originalId} on:close={close} />{/each}{/if}
		{#if hasMarkerTours}<Menu on:close={close} menu={{id: createGUID(), i18n: {[$_lang]: {title:hasBothTourTypes ? 'Marker tours' : 'Tours'}},
			children: markerTours.map((t) => ({
				id: createGUID(),
				i18n: {[$_lang]: {title:getTourTitle(t,$_lang)}},
				action:()=>{
					t.initialStep = 0;
					tour.set(t)
				}
			}))
		}}/>{/if}
		{#if hasVideoTours}<Menu on:close={close} menu={{id: createGUID(), i18n: {[$_lang]: {title: hasBothTourTypes ? 'Video tours' : 'Tours'}},
			children: !data || !data.tours ? [] : data.tours.map((t) => ({
				id: createGUID(),
				i18n: {[$_lang]: {title:getTourTitle(t,$_lang)}},
				action:()=>{
					if($current && $current.id != originalId) micrio.open(originalId);
					tour.set(t)
				}
			}))
		}}/>{/if}
	</menu>
	{#if isMobile}<Button title={$i18n.menuToggle} type={shown ? 'close' : 'ellipsis-vertical'}
		className={'toggle transparent' + (indented ? ' indent' : '')}
		on:click={() => shown=!shown} />{/if}
{/if}

<style>
	menu {
		position: absolute;
		top: calc(var(--micrio-border-margin) - (var(--micrio-button-size) / 2 - 27px));
		left: var(--micrio-border-margin);
		margin: 0;
		padding: 0;
		color: #fff;
		text-shadow: 1px 1px 2px #000;
		transition: transform .25s ease;
		z-index: 1;
	}

	@media (max-width: 500px) {
		:global(.micrio-button.toggle) {
			position: absolute;
			top: var(--micrio-border-margin);
			left: 0;
			height: 34px;
			width: 34px;
			box-shadow: none;
			z-index: 2;
		}
		:global(.micrio-button.toggle.indent) {
			left: 35px;
		}
		menu {
			transform: translate3d(0,0,0);
			width: 100%;
			height: 100%;
			background: rgba(0,0,0,0.75);
			top: 0;
			left: 0;
			padding: 32px 0;
			overflow-y: auto;
			overflow-x: hidden;
			box-sizing: border-box;
			backdrop-filter: var(--micrio-background-filter);
			z-index: 1;
		}
		menu:not(.shown) {
			transform: translate3d(calc(-100% - var(--micrio-border-margin) * 2), 0, 0);
		}
	}

	@media (min-width: 501px) {
		menu {
		}
		menu.indent {
			margin-left: calc(var(--micrio-border-margin) * 2 + 25px);
		}
		menu > :global(.micrio-menu:not(:hover) > button.micrio-menu) {
			margin-bottom: -15px;
		}
	}

</style>
