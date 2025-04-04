<script lang="ts">
	/**
	 * AudioPlaylist.svelte - Plays a list of audio files sequentially.
	 *
	 * This component takes an array of audio assets and plays them one after another.
	 * It uses a single HTMLAudioElement to play the files.
	 */

	import type { Models } from '../../types/models';

	import { onMount } from 'svelte';

	// --- Props ---
	interface Props {
		/** Array of audio assets to play. */
		list: Models.Assets.Audio[];
		/** If true, loop the playlist when it reaches the end. */
		loop?: boolean;
		/** Volume level (0-1). */
		volume?: number;
	}

	let { list, loop = true, volume = 1 }: Props = $props();

	// --- Audio Playback ---

	/** Single HTMLAudioElement used for playback. */
	const audio = $state(new Audio);
	audio.preload = 'none'; // Don't preload audio files initially
	audio.loop = false; // Looping is handled manually by the component
	/** Event listener for when an audio file ends, triggers playing the next one. */
	audio.onended = next;

	/** Current index in the playlist array. */
	let idx = -1;

	/** Plays the next audio file in the list. */
	function next(){
		// Stop if not looping and at the end of the list
		if(!loop && idx+1 == list.length) return;
		// Increment index and wrap around if needed
		const item = list[(++idx)%list.length];
		// Set the audio source (handle legacy `fileUrl`)
		audio.src = 'fileUrl' in item ? item['fileUrl'] as string : item.src;
		// Start playback
		audio.play();
	}

	// --- Lifecycle (onMount) ---

	onMount(() => {
		next(); // Start playing the first track on mount
		// Cleanup function: pause audio when the component is destroyed
		return () => audio.pause();
	});

	// --- Reactive Effects ---

	/** Update the audio element's volume when the `volume` prop changes. */
	$effect(() => {
		audio.volume = volume;
	});

</script>

<!-- This component does not render any visible elements -->
