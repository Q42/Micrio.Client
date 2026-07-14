import { MicrioElement } from '$ts/component';
import type { HTMLMicrioElement } from '$ts/element';
import type { Models } from '$types/models';
import type { MicrioImage } from '$ts/image';

export interface AudioLocationProps {
	marker: Models.ImageData.Marker;
	ctx: AudioContext;
	is360: boolean;
}

export class MicrioAudioLocation extends MicrioElement<AudioLocationProps> {
	static tag = 'micrio-audio-location';
	static styles = '';

	#props: AudioLocationProps = { marker: null!, ctx: null!, is360: false };
	#unsubs: (() => void)[] = [];
	#gain!: GainNode;
	#panner!: PannerNode;
	#source!: AudioBufferSourceNode;
	#to: any;

	#end() {
		if (this.#source) this.#source.disconnect();
		clearTimeout(this.#to);
		this.#panner.disconnect();
		this.#gain.disconnect();
	}

	onMount() {
		const { marker, ctx, is360 } = this.#props;
		const micrio = this.inject<HTMLMicrioElement>('micrio');
		if (!micrio || !marker || !ctx) return;

		const image = micrio.$current as MicrioImage;
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
				let len = _x * _x + _y * _y + _z * _z;
				if (len > 0) len = 1.0 / Math.sqrt(len);
				this.#panner.orientationX.value = _x * len;
				this.#panner.orientationY.value = _y * len;
				this.#panner.orientationZ.value = _z * len;
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
			// buffers come from AudioController module
			this.#source.buffer = (window as any)['__micrioAudioBuffers']?.[item.src];
			if (this.#source.buffer) {
				this.#source.connect(this.#panner);
				this.#source.start();
			}
		};

		const start = async () => {
			if (!item.src) return;
			const buffers = (window as any)['__micrioAudioBuffers'] || {};
			if (!buffers[item.src]) {
				buffers[item.src] = await fetch(item.src)
					.then(r => r.arrayBuffer())
					.then(b => ctx.decodeAudioData(b));
				(window as any)['__micrioAudioBuffers'] = buffers;
			}
			if (item.alwaysPlay && item.repeatAfter > 0) this.#to = setTimeout(play, item.repeatAfter * 1000);
			else play();
		};

		update();
		this.#panner.connect(this.#gain);
		start();

		micrio.addEventListener('audio-update', update as any);
		this.#unsubs.push(() => micrio.removeEventListener('audio-update', update as any));
	}

	setProps(props: Partial<AudioLocationProps>) {
		Object.assign(this.#props, props);
	}

	onDestroy() {
		this.#end();
		for (const fn of this.#unsubs) fn();
		this.#unsubs = [];
	}
}

customElements.define(MicrioAudioLocation.tag, MicrioAudioLocation);
