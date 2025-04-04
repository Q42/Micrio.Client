<script lang="ts">
	import type { Models } from '../../types/models';
	import type { HTMLMicrioElement } from '../../ts/element';
	import type { MicrioImage } from '../../ts/image';

	import { getContext, onMount } from 'svelte';

	import { mainGain, buffers } from './AudioController.svelte';

	interface Props {
		marker: Models.ImageData.Marker;
		ctx: AudioContext;
		is360: boolean;
	}

	let { marker, ctx, is360 }: Props = $props();

	let item = $derived(marker.positionalAudio as Models.Assets.AudioLocation);

	const gain = ctx.createGain();
	gain.connect(mainGain);

	const micrio = getContext<HTMLMicrioElement>('micrio');
	const image = micrio.$current as MicrioImage;
	const info = image.$info as Models.ImageInfo.ImageInfo;
	const imgWidth = info.width;
	const imgHeight = info.height;

	const panner = ctx.createPanner();
	panner.panningModel = 'equalpower';
	panner.rolloffFactor = 1;
	panner.coneOuterGain = 0;

	const r = 11;

	function update(){
		gain.gain.value = item.volume ?? 1;

		if(is360) {
			panner.refDistance = item.radius * (r/4);
			panner.maxDistance = item.radius * (r/3);

			const xR = marker.x * -Math.PI*2;
			const yR = (marker.y-.5) * -Math.PI;

			const _x = panner.positionX.value = Math.cos(yR) * Math.sin(xR) * r;
			const _y = panner.positionY.value = Math.sin(yR) * r;
			const _z = panner.positionZ.value = Math.cos(yR) * Math.cos(xR) * r;

			// normalize vector for direction
			let len = _x * _x + _y * _y + _z * _z;
			if(len > 0) len = (1.0 / Math.sqrt(len));
			panner.orientationX.value = _x * len;
			panner.orientationY.value = _y * len;
			panner.orientationZ.value = _z * len;
		}
		else {
			panner.distanceModel = 'linear';
			panner.positionX.value = (marker.x - .5) * 2;
			panner.positionY.value = (.5 - marker.y) * 2 * (imgHeight / imgWidth);
			panner.positionZ.value = -.2;
			panner.rolloffFactor = 2;
			panner.refDistance = item.radius * item.radius * 10;
			panner.maxDistance = item.radius * 5;
		}
	}

	let source:AudioBufferSourceNode;
	let _to:number;

	function play() : void {
		if(source) source.disconnect();
		source = ctx.createBufferSource();
		if(item.loop) {
			if(item.repeatAfter > 0) source.onended = () => {
				_to = <any>setTimeout(play, item.repeatAfter * 1000) as number;
			}; else source.loop = true;
		}
		gain.gain.value = item.volume ?? 1;
		source.buffer = buffers[item.src];
		source.connect(panner);
		source.start();
	}

	async function start() : Promise<void> {
		// Positional audio without source uri
		if(!item.src) return;
		if(!buffers[item.src]) buffers[item.src] = await fetch(item.src)
			.then(r => r.arrayBuffer())
			.then(b => ctx.decodeAudioData(b));
		if(item.alwaysPlay && item.repeatAfter > 0) _to = <any>setTimeout(play, item.repeatAfter * 1000) as number;
		else play();
	}

	function end() : void {
		if(source) source.disconnect();
		clearTimeout(_to);
		panner.disconnect();
		gain.disconnect();
	}

	// Also listen to changes in raw json
	let prev:string = $state(JSON.stringify(item));
	$effect(() => {
		const newItem = JSON.stringify(item);
		if(prev != newItem && (prev = newItem)) update();
	});

	onMount(() => {
		update();
		panner.connect(gain);
		start();

		// Force location update from (Spaces) editor
		micrio.addEventListener('audio-update', update);

		return () => {
			micrio.removeEventListener('audio-update', update);
			end();
		}
	});
</script>
