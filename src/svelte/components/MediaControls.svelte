<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { captionsEnabled } from '../common/Subtitles.svelte';
	import { i18n } from '../../ts/i18n';

	import Button from '../ui/Button.svelte';
	import Fullscreen from '../ui/Fullscreen.svelte';
	import ProgressBar from '../ui/ProgressBar.svelte';

	export let currentTime:number = 0;
	export let duration:number = 0;
	export let seeking:boolean = true;
	export let muted:boolean = false;
	export let minimal:boolean = false;
	export let volume:number;
	export let paused:boolean;
	export let ended:boolean;
	export let fullscreen:HTMLElement|undefined = undefined;
	export let subtitles:boolean = false;

	$: hasAudio = !isNaN(volume);

	const dispatch = createEventDispatcher();

	// Dragging timeline
	let dragging:boolean = false;
	let _bar:HTMLElement;
	function dStart(e:MouseEvent) : void {
		if(e.button != 0) return;
		window.addEventListener('mousemove', dMove);
		window.addEventListener('mouseup', dStop);
		dragging = true;
		dMove(e);
	}

	function dMove(e:MouseEvent) : void {
		const rect = _bar.getClientRects()[0];
		const perc = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
		dispatch('seek', perc * duration);
	}

	function dStop() : void {
		window.removeEventListener('mousemove', dMove);
		window.removeEventListener('mouseup', dStop);
		dragging = false;
	}

</script>

<aside on:click|stopPropagation on:keydown|stopPropagation>
	<Button type={!paused ? 'pause' : 'play'} title={!paused ? $i18n.pause : $i18n.play} on:click={() => dispatch('playpause')}>
		{#if minimal && currentTime > 0}<svg height="42" width="42">
			<circle r="19" cx="21" cy="21" stroke-dashoffset={(1 - (currentTime / duration)) * 119.4} />
		</svg>{/if}
	</Button>
	{#if !minimal}
		{#if hasAudio}<Button disabled={seeking} type={muted?'volume-off':'volume-up'}
			title={muted?$i18n.audioUnmute:$i18n.audioMute}
			on:click={() => dispatch('mute')} />{/if}
		{#if subtitles}<Button type={$captionsEnabled ? 'subtitles' : 'subtitles-off'} active={$captionsEnabled}
			title={$i18n.subtitlesToggle}
			on:click={() => captionsEnabled.set(!$captionsEnabled)} />{/if}
		{#if !!fullscreen}<Fullscreen el={fullscreen} />{/if}
	{/if}
</aside>
{#if !minimal}
	<ProgressBar duration={duration} bind:currentTime bind:ended>
		<div class="bar active" bind:this={_bar} on:mousedown={dStart}
			style={`--perc:${(currentTime/duration)*100}%;`}></div>
	</ProgressBar>
{/if}

<style>
	aside {
		cursor: default;
		position: relative;
		display: flex;
		align-items: center;
		margin: 0;
		background: var(--micrio-background);
	}
	aside > :global(button) {
		border-radius: 0;
		margin: 0;
		border: none;
	}
	aside > :global(button:last-child) {
		margin-right: 16px;
	}
	aside > :global(*) {
		--micrio-button-background: none;
		--micrio-background-filter: none;
		--micrio-button-shadow: none;
	}
	:global(:fullscreen) > aside {
		position: absolute;
		bottom: 5px;
		left: 50%;
		transform: translateX(-50%);
		width: 430px;
		max-width: 90vw;
		max-width: 90cqw;
	}

	svg {
		pointer-events: none;
		position: absolute;
		left: -1px;
		top: -1px;
		width: 42px;
		height: 42px;
		transform: rotateZ(-90deg);
	}

	circle {
		stroke-width: 2;
		stroke: #fff;
		fill: transparent;
		stroke-dasharray: 119.4 119.4;
		transition: stroke-dashoffset .25s linear;
		transform-origin: center center;
	}
</style>
