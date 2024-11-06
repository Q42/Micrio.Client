<script lang="ts">
	import type { HTMLMicrioElement } from '../../ts/element';
	import type { Models } from '../../types/models';
	import type { MicrioImage } from '../../ts/image';

	import { onMount, getContext, tick, createEventDispatcher } from 'svelte';
	import { get, writable } from 'svelte/store';
	import { captionsEnabled } from '../common/Subtitles.svelte';
	import { i18n } from '../../ts/i18n';

	import Media from '../components/Media.svelte';
	import Button from '../ui/Button.svelte';
	import Fullscreen from '../ui/Fullscreen.svelte';
	import ProgressBar from '../ui/ProgressBar.svelte';

	export let tour:Models.ImageData.MarkerTour;

	const stepInfo = tour.stepInfo as Models.ImageData.MarkerTourStepInfo[];

	const dispatch = createEventDispatcher();

	const micrio = <HTMLMicrioElement>getContext('micrio');
	const lang = micrio._lang;
	const image = micrio.$current as MicrioImage;
	const marker = micrio.state.marker;
	const settings = image.$settings;

	const noTimeScrub = !!settings?.ui?.controls?.serialTourNoTimeScrub;

	const totalDuration:number = stepInfo.reduce((c, s) => c + s.duration, 0) ?? 0;
	const controls = 'controls' in tour ? tour.controls !== false : !tour.noControls;

	let paused:boolean = false;
	let ended:boolean = false;
	let muted:boolean = get(micrio.isMuted);

	let current:Models.ImageData.VideoTour|undefined;
	let currentStepInfo:Models.ImageData.MarkerTourStepInfo|undefined;
	let currentTime:number = 0;

	let currentMediaUUID:string;

	function playPause() {
		const media = micrio.state.mediaState.get(currentMediaUUID);
		if(media) paused = media.paused = !media.paused;
		if(paused) {
			micrio.events.dispatch('serialtour-pause', tour);
			micrio.events.enabled.set(true);
		}
		else {
			micrio.events.dispatch('serialtour-play', tour);
			micrio.events.enabled.set(false);
		}
	}

	// Skip to segment and time
	function goto(i:number, e?:MouseEvent) : void {
		if(!tour.goto) return;
		const sameStep = i == tour.currentStep;
		if(noTimeScrub && sameStep) return;
		if(!sameStep) tour.goto(i);
		const perc = !noTimeScrub && e ? e.offsetX / (e.target as HTMLElement).offsetWidth : 0;
		stepInfo.forEach((s,j) => s.ended = e ? false : j<i);
		reset();
		const step = stepInfo[i];
		step.currentTime = perc * step.duration;
		if(sameStep && current?.instance) current.instance.currentTime = step.currentTime;
		ontimeupdate(i);
	}

	function toggleMute() : void {
		micrio.isMuted.set(muted=!muted);
	}

	function next(){
		const curr = currentStepInfo;
		if(curr) curr.ended = true;
		if(tour.currentStep != undefined && tour.currentStep < tour.steps.length-1 && tour.next) tour.next();
		else {
			paused = ended = true;
			dispatch('ended');
		}
		tick().then(() => {
			reset();
			if(curr) curr.ended = false
		});
	}

	// Reset all individual tour state times on done
	function reset(){
		tour.stepInfo?.forEach(s => s.currentTime = 0);
	}

	const times = writable<number[]>([])
	function ontimeupdate(stepIdx:number = tour.currentStep ?? 0){
		const _times = stepInfo.map((step, i) => (i < stepIdx || step.ended || ended) ? 100
			: i == stepIdx ? Math.round(((step.currentTime || 0) / step.duration) * 10000)/100
			: 0);
		currentTime = _times.reduce((v, s, i) => v+(s/100)*stepInfo[i].duration, 0);
		times.set(_times);
	}

	function onmarkerchange(m?:Models.ImageData.Marker) : void {
		const isTourMarker = m && !!tour.steps.find(s => s.startsWith(m.id));
		current = undefined;
		if(isTourMarker && m.videoTour) setTimeout(() => {
			const step = stepInfo[tour.currentStep ?? 0];
			if(step.markerId != m.id) return;
			step.ended = false;
			currentStepInfo = step;
			current = m.videoTour;
			ontimeupdate();
		},10);
	}

	const getTitle = (m:Models.ImageData.Marker) : string|undefined => m.i18n ? m.i18n[$lang]?.title : (<unknown>m as Models.ImageData.MarkerCultureData).title;

	onMount(() => {
		const tu = () => ontimeupdate();
		micrio.addEventListener('timeupdate', tu);
		const unsub = marker.subscribe(onmarkerchange);

		return () => {
			unsub();
			micrio.removeEventListener('timeupdate', tu);
			reset();
		}
	})

	$: audio = current ? 'audio' in current ? current.audio as Models.Assets.Audio : current.i18n?.[$lang]?.audio : undefined;
	$: audioSrc = audio ? 'fileUrl' in audio ? audio['fileUrl'] as string : audio.src : undefined;
	$: subtitle = current ? 'subtitle' in current ? current.subtitle as Models.Assets.Subtitle : current.i18n?.[$lang]?.subtitle : undefined;
	$: subtitleSrc = subtitle ? 'fileUrl' in subtitle ? subtitle['fileUrl'] as string : subtitle.src : undefined;

</script>

{#if tour.printChapters}<ol>{#each stepInfo as c,i}
	{#if getTitle(c.marker)}<li class:active={currentStepInfo && currentStepInfo.chapter == i} class:enriched={c.imageHasOtherMarkers}>
		<button on:click={() => goto(i)}>{getTitle(c.marker)}</button>
	</li>{/if}
{/each}</ol>{/if}

<aside class="micrio-media-controls">
	{#if current && currentStepInfo}<Media tour={current} src={audioSrc}
		autoplay={!paused} on:id={(e) => currentMediaUUID = e.detail}
		on:ended={next} on:play={() => paused=false} on:blocked={() => paused=true}
		bind:muted bind:currentTime={currentStepInfo.currentTime} />
	{/if}
	{#if controls}
		<Button type={!paused ? 'pause' : 'play'} title={paused ? $i18n.play : $i18n.pause} on:click={playPause} />
		<Button type={muted ? 'volume-off' : 'volume-up'} title={muted ? $i18n.audioUnmute : $i18n.audioMute} on:click={toggleMute} />
		{#if subtitleSrc}<Button
			type={$captionsEnabled ? 'subtitles' : 'subtitles-off'} active={$captionsEnabled} title={$i18n.subtitlesToggle}
			on:click={() => captionsEnabled.set(!$captionsEnabled)} />{/if}
		<Fullscreen el={micrio} />
	{/if}
</aside>

{#if controls}<ProgressBar duration={totalDuration} bind:currentTime bind:ended>
	<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
	{#each stepInfo as step, i}{#if step.duration > 0}<div class="bar"
		title={getTitle(step.marker)} role="progressbar" on:click={(e) => goto(i,e)} class:active={i == tour.currentStep}
		on:keypress={e => { if(e.key === 'Enter') goto(i) }}
		style={`width:${(step.duration/totalDuration)*100}%; --perc: ${$times[i]||0}%`}></div>{/if}{/each}
</ProgressBar>{/if}

<style>
	ol {
		position: absolute;
		left: 0px;
		bottom: 75px;
		color: var(--micrio-color);
		text-shadow: var(--micrio-marker-text-shadow);
		list-style-type: decimal-leading-zero;
		margin: 0;
	}
	ol > li {
		height: 1.5em;
		white-space: pre;
		transition: height .25s ease, opacity .25s .25s ease;
	}
	ol li.active {
		font-weight: bold;
	}
	:global(.minimized) > ol > li:not(.active) {
		height: 0em;
		opacity: 0;
		transition: height .25s .25s ease, opacity .25s ease;
	}
	ol li button {
		font: inherit;
		background: none;
		border: none;
		display: inline;
		color: inherit;
		text-shadow: inherit;
		cursor: pointer;
	}
	ol li button:hover {
		text-decoration: underline;
	}
	aside.micrio-media-controls > :global(figure.micrio-media) {
		display: none;
	}

</style>
