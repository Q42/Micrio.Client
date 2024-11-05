<script lang="ts">
	import type { Models } from '../../types/models';

	import { onMount } from 'svelte';

	export let list:Models.Assets.Audio[];
	export let loop:boolean = true;
	export let volume:number = 1;

	const audio = new Audio;
	audio.preload = 'none';
	audio.loop = false;
	audio.onended = next;

	let idx = -1;

	function next(){
		if(!loop && idx+1 == list.length) return;
		const item = list[(++idx)%list.length];
		audio.src = 'fileUrl' in item ? item['fileUrl'] as string : item.src;
		audio.play();
	}

	onMount(() => {
		next();
		return () => audio.pause();
	});

	$: audio.volume = volume;
</script>
