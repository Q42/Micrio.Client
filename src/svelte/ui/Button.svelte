<script lang="ts">
	import type { IconName } from './Icon.svelte';
	import type { Models } from '../../types/models';

	import Icon from './Icon.svelte';

	export let type:IconName|undefined = undefined;
	export let icon:Models.Assets.Image|undefined = undefined;
	export let title:string|null = null;
	export let disabled:boolean = false;
	export let active:boolean = false;
	export let className:string = '';
	export let href:string|undefined = undefined;
	export let blankTarget:boolean = false;
	export let noClick:boolean = false;

</script>

<svelte:element this={href ? 'a' : 'button'} {href} target={blankTarget ? '_blank' : undefined} disabled={disabled ? true : undefined} {title}
	aria-label={title} role={href ? undefined : 'button'} tabindex={href ? undefined : 0}
	class="micrio-button {type??''} {className}" class:active class:no-click={noClick}
	on:click on:focus on:pointerdown>{#if type}<Icon name={type} />{:else if icon}<img src={icon.src} alt="Icon" />{/if}<slot/></svelte:element>

<style>
.micrio-button {
	margin: 0;
	padding: 0 8px;
	cursor: pointer;
	box-sizing: border-box;
	display: inline-block;
	vertical-align: bottom;
	transition: opacity .25s ease;
	font: inherit;
	font-size: 90%;
	position: relative;
	touch-action: none;
	color: var(--micrio-color);
	background: var(--micrio-button-background, var(--micrio-background, none)) var(--background, none) center center no-repeat;
	background-size: 24px;
	min-width: var(--micrio-button-size);
	height: var(--micrio-button-size);
	line-height: var(--micrio-button-size);
	border: none;
	border-radius: var(--micrio-border-radius);
	box-shadow: var(--micrio-button-shadow);
	backdrop-filter: var(--micrio-background-filter);
	text-decoration: none
}
.micrio-button:hover {
	outline: none;
}
.micrio-button.transparent, .micrio-button.transparent:hover {
	background-color: transparent;
	backdrop-filter: none;
}
.micrio-button > :global(*) {
	transition: opacity .25s ease;
}
.micrio-button:disabled {
	pointer-events: none;
}
.micrio-button:disabled > :global(*) {
	opacity: .4;
}
.micrio-button.no-click {
	pointer-events: none;
}
img {
	display: block;
	margin: 0 auto;
	pointer-events: none;
}
.micrio-button > :global(*) {
	height: var(--micrio-icon-size) !important;
	width: var(--micrio-icon-size);
	font-size: var(--micrio-icon-size);
	fill: var(--micrio-color);
	display: block;
	margin: 0 auto;
}
.micrio-button.active {
	color: var(--micrio-color-hover);
}
.micrio-button.active :global(svg) {
	fill: var(--micrio-color-hover);
}

@media (hover: hover) {
	.micrio-button:hover {
		background-color: var(--micrio-button-background-hover, var(--micrio-button-background, var(--micrio-background)));
		color: var(--micrio-color-hover);
	}
	.micrio-button:hover :global(svg) {
		fill: var(--micrio-color-hover);
		stroke: var(--micrio-color-hover);
	}
	.micrio-button:focus {
		outline: 1px solid var(--micrio-color-hover);
	}
}
</style>
