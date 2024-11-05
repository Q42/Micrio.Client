<script lang="ts" context="module">
	import type { Writable} from 'svelte/store';

	export let mainGain:GainNode;
	export const buffers:{[key:string]: AudioBuffer} = {};
	export const ctx:Writable<AudioContext|undefined> = writable();

	let _ctx:AudioContext|null;
	let l:AudioListener;

	const interacted = writable<boolean>(false);

	function init(volume:number) : void {
		if(mainGain) return;
		if(!_ctx) _ctx = 'micrioAudioContext' in window ? window['micrioAudioContext'] as AudioContext
			: 'AudioContext' in window ? new window.AudioContext()
			: 'webkitAudioContext' in window ? (new (<any>window['webkitAudioContext'])) as AudioContext
			: null;
		if(!_ctx) return console.warn('[Micrio] Your browser does not support the Web Audio API');
		mainGain = _ctx.createGain();
		mainGain.connect(_ctx.destination);

		mainGain.gain.value = volume;

		ctx.set(_ctx);

		l = _ctx.listener;
		if('upX' in l) {
			l.upX.value = 0;
			l.upY.value = 1;
			l.upZ.value = 0;
		}
	};

	function setPosition(x:number, y:number, z:number) : void {
		if(l.setPosition) l.setPosition(x,y,z);
		else if('positionX' in l) {
			l.positionX.value = x;
			l.positionY.value = y;
			l.positionZ.value = z;
		}
	}

	function setOrientation(x:number, y:number, z:number) {
		if(l.setOrientation) l.setOrientation(x, y, z, 0, 1, 0);
		else if('forwardX' in l) {
			l.forwardX.value = x;
			l.forwardY.value = y;
			l.forwardZ.value = z;
		}
	}
</script>

<script lang="ts">
	import type { HTMLMicrioElement } from '../../ts/element';
	import type { Models } from '../../types/models';
	import type { Unsubscriber } from 'svelte/store';
	import type { MicrioImage } from '../../ts/image';
	
	import { getContext, onMount } from 'svelte';
	import { Browser } from '../../ts/utils';
	import { writable } from 'svelte/store';

	import AudioPlaylist from './AudioPlaylist.svelte';

	export let volume:number = 1;
	export let data:Models.ImageData.ImageData;
	export let is360:boolean;

	const { events, current } = <HTMLMicrioElement>getContext('micrio');

	const image = $current as MicrioImage;
	const info = image.$info as Models.ImageInfo.ImageInfo;
	const ar = info.height / info.width;

	const supported = 'AudioContext' in window || 'webkitAudioContext' in window;

	function moved(x:number, y:number, z:number) : void {
		if(is360) {
			// get virtual microphone pos
			x *= -Math.PI*2;
			y -= .5;
			y *= -Math.PI;

			const r = 10 * (1-z);

			// coordinate in 3d space, untranslated
			const _x = Math.cos(y) * Math.sin(x) * r;
			const _y = Math.sin(y) * r;
			const _z = Math.cos(y) * Math.cos(x) * r;

			setPosition(_x,_y,_z);

			// normalize vector for direction
			let len = _x * _x + _y * _y + _z * _z;
			if(len > 0) len = (1.0 / Math.sqrt(len));
			setOrientation(_x * len, _y * len, _z * len);
		}
		else setPosition((x - .5) * 2, (.5 - y) * 2 * ar, z);
	}

	const input = ():void => interacted.set(true);

	// Audio user interaction before being able to start
	const audio = new Audio('data:audio/mpeg;base64,/+MYxAAAAANIAUAAAASEEB/jwOFM/0MM/90b/+RhST//w4NFwOjf///PZu////9lns5GFDv//l9GlUIEEIAAAgIg8Ir/JGq3/+MYxDsLIj5QMYcoAP0dv9HIjUcH//yYSg+CIbkGP//8w0bLVjUP///3Z0x5QCAv/yLjwtGKTEFNRTMuOTeqqqqqqqqqqqqq/+MYxEkNmdJkUYc4AKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq');
	// Put this to 1 on iOS and audio won't play whatsoever. Don't do this at all, same story
	audio.volume = Browser.iOS ? 0 : 1;

	if(supported) onMount(() => {
		let unsub:Unsubscriber|null;
		unsub = interacted.subscribe(b => {
			if(!b) return;
			if(!_ctx) {
				init(volume);
				events.dispatch('audio-init');
			}
			if(unsub) { unsub(); unsub = null; }
			if(data.markers?.filter(m => !!m.positionalAudio).length) unsub = image.state.view.subscribe(
				v => { if(!v) return;
					const w = v[2]-v[0], h = v[3]-v[1];
					const d = Math.max(0, 1.05 - image.camera.getScale());
					moved(v[0]+w/2, v[1]+h/2, d * (is360 ? 1 : 1.5));
				})
		});
		if(!_ctx) audio.play().then(input).catch(() => {
			events.dispatch('autoplay-blocked')
			addEventListener('pointerup', input, {once: true})
		});
		return () => { if(unsub) unsub(); }
	});

	$: if(mainGain) mainGain.gain.value = volume;

</script>

{#if $interacted && $ctx && data.music?.items.length}
	<AudioPlaylist list={data.music.items} loop={data.music.loop} volume={volume*(data.music.volume ?? 1)} />
{/if}
