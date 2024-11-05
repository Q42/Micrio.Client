<script lang="ts">
	import type { Models } from "../../types/models";
	import type { HTMLMicrioElement } from "../../ts/element";

	import { getContext, onDestroy } from 'svelte';

	export let events:Models.ImageData.Event[];
	export let currentTime:number = 0;
	export let duration:number;

	const micrio = <HTMLMicrioElement>getContext('micrio');

	events.forEach(e=>{e.start=Number(e.start||0);e.end=Math.min(Number(e.end||0),duration)});

	const update = (time:number):void => events.forEach(e => {
		const active = e.start <= time && e.end >= time;
		if(active != !!e.active) { e.active = active;
			micrio.events.dispatch('tour-event', {...e});
		}
	});

	$: update(currentTime);

	// End all current events
	onDestroy(() => update(Infinity));

</script>
