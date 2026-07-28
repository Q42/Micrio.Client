import type { Models } from '$types/models';
import type { HTMLMicrioElement } from '$core/element';
import type { MicrioImage } from '$core/image';
import { normalize3 } from '$utils/math';
import { mainGain } from './audio-controller';

export class MicrioAudioLocation {
	#micrio: HTMLMicrioElement;
	#gain!: GainNode;
	#panner!: PannerNode;
	#source!: AudioBufferSourceNode;
	#to: any;
	#cleanup: (() => void) | undefined;

	constructor(micrio: HTMLMicrioElement, marker: Models.ImageData.Marker, ctx: AudioContext, is360: boolean) {
		this.#micrio = micrio;
		this.#init(marker, ctx, is360);
	}

	#init(marker: Models.ImageData.Marker, ctx: AudioContext, is360: boolean) {
		const image = this.#micrio.$current as MicrioImage;
		const info = image.$info;
		if (!info) return;
		const imgWidth = info.width;
		const imgHeight = info.height;
		const item = marker.positionalAudio as Models.Assets.AudioLocation;
		if (!item) return;

		this.#gain = ctx.createGain();
		this.#panner = ctx.createPanner();
		this.#panner.panningModel = 'equalpower';
		this.#panner.rolloffFactor = 1;
		this.#panner.coneOuterGain = 0;
		const r = 11;

		const update = () => {
			this.#gain.gain.value = item.volume ?? 1;
			if (is360) {
				this.#panner.refDistance = item.radius * (r / 4);
				this.#panner.maxDistance = item.radius * (r / 3);
				const xR = marker.x * -Math.PI * 2;
				const yR = (marker.y - 0.5) * -Math.PI;
				const _x = Math.cos(yR) * Math.sin(xR) * r;
				const _y = Math.sin(yR) * r;
				const _z = Math.cos(yR) * Math.cos(xR) * r;
				this.#panner.positionX.value = _x;
				this.#panner.positionY.value = _y;
				this.#panner.positionZ.value = _z;
				const [nx, ny, nz] = normalize3(_x, _y, _z);
				this.#panner.orientationX.value = nx;
				this.#panner.orientationY.value = ny;
				this.#panner.orientationZ.value = nz;
			} else {
				this.#panner.distanceModel = 'linear';
				this.#panner.positionX.value = (marker.x - 0.5) * 2;
				this.#panner.positionY.value = (0.5 - marker.y) * 2 * (imgHeight / imgWidth);
				this.#panner.positionZ.value = -0.2;
				this.#panner.rolloffFactor = 2;
				this.#panner.refDistance = item.radius * item.radius * 10;
				this.#panner.maxDistance = item.radius * 5;
			}
		};

		const play = () => {
			if (this.#source) this.#source.disconnect();
			this.#source = ctx.createBufferSource();
			if (item.loop) {
				if (item.repeatAfter > 0) this.#source.onended = () => {
					this.#to = setTimeout(play, item.repeatAfter * 1000);
				}; else this.#source.loop = true;
			}
			this.#gain.gain.value = item.volume ?? 1;
			this.#source.buffer = (window as Record<string, any>).__micrioAudioBuffers?.[item.src] ?? null;
			if (this.#source.buffer) {
				this.#source.connect(this.#panner);
				this.#source.start();
			}
		};

		const start = async () => {
			if (!item.src) return;
			const buffers = (window as Record<string, any>).__micrioAudioBuffers || {};
			if (!buffers[item.src]) {
				buffers[item.src] = await fetch(item.src)
					.then(r => r.arrayBuffer())
					.then(b => ctx.decodeAudioData(b));
				(window as Record<string, any>).__micrioAudioBuffers = buffers;
			}
			if (item.alwaysPlay && item.repeatAfter > 0) this.#to = setTimeout(play, item.repeatAfter * 1000);
			else play();
		};

		update();
		this.#panner.connect(this.#gain);
		this.#gain.connect(mainGain ?? ctx.destination);
		start();

		this.#micrio.addEventListener('audio-update', update);
		this.#cleanup = () => this.#micrio.removeEventListener('audio-update', update);
	}

	#end() {
		if (this.#source) this.#source.disconnect();
		clearTimeout(this.#to);
		this.#panner.disconnect();
		this.#gain.disconnect();
	}

	destroy() {
		this.#cleanup?.();
		this.#end();
	}
}
