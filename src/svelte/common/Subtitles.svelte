<script lang="ts" context="module">
	import { writable } from 'svelte/store';

	const k = 'micrio-captions-disable';
	export const captionsEnabled = writable<boolean>(localStorage.getItem(k)!='1');
	captionsEnabled.subscribe(b => {
		if(b) localStorage.removeItem(k);
		else localStorage.setItem(k, '1');
	});
</script>

<script lang="ts">
	import type { HTMLMicrioElement } from '../../ts/element';
	import type { Models } from '../../types/models';

	import { fade } from 'svelte/transition';
	import { getContext, onMount } from 'svelte';

	export let src:string;
	export let raised:boolean = false;

	const events:Models.ImageData.Event[] = [];

	fetch(src).then(r => r.text()).then(txt => {
		const s = txt.split('\n');
		for(let l=0;l<s.length;l++) if(/-->/.test(s[l])) {
			let idx = l+1;
			const lines = [];

			// In case the first lines below timestamp are whitespace
			while(!s[idx] && idx < s.length) idx++;

			while(s[idx] && s[idx].trim()) lines.push(s[idx++]);

			const [start,end] = s[l].split(' --> ')
				.map(t => t.trim().replace(',','.').split(':').map(Number))
				.map(v => v[0]*3600+v[1]*60+v[2]);
	
			events.push({start, end, data: lines.join('\n')});

			l+=lines.length+1;
		}
	});

	const micrio = getContext<HTMLMicrioElement>('micrio');

	let currentTime:number = 0;
	const setTime = (e:Event) => currentTime = (e as CustomEvent).detail;

	onMount(() => {
		micrio.addEventListener('timeupdate', setTime);
		return () => micrio.removeEventListener('timeupdate', setTime);
	})

	$: current = events.filter(e => e.start <= currentTime && e.end >= currentTime);

</script>

{#if $captionsEnabled}{#each current as sub (sub)}<div transition:fade class:raised><p>{sub.data}</p></div>{/each}{/if}

<style>
	div {
		position: absolute;
		bottom: 50px;
		left: 50vw;
		left: 50cqw;
		transform: translate3d(-50%, 0, 0);
		text-align: center;
		color: #fff;
		width: 100vw;
		width: 100cqw;
		pointer-events: none;
		transition: transform .2s ease;
	}
	div.raised {
		transform: translate3d(-50%, calc(-1 * var(--micrio-button-size)), 0);
	}
	div p {
		margin: .5em 0;
		background-color: rgba(0, 0, 0, 0.6);
		padding: 0 14px;
		-webkit-box-decoration-break: clone;
		box-decoration-break: clone;
		white-space: pre-wrap;
		display: inline;
		text-shadow: 2px 2px 1px #0005;
		font-size: 2.5em;
		line-height: inherit;
	}
	@media (max-width: 640px) {
		div {
			width: 95vw;
			width: 95cqw;
			font-size: 0.7em;
		}
	}
</style>
