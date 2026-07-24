import { MicrioElement } from '$core/component';
import type { Models } from '$types/models';
import type { MicrioImage } from '$core/image';
import { normalize3 } from '$utils/math';

/** Properties for configuring a positional audio element associated with a marker. */
export interface AudioLocationProps {
	/** The marker this audio location is attached to. */
	marker: Models.ImageData.Marker;
	/** The shared Web Audio API context. */
	ctx: AudioContext;
	/** Whether the parent image is a 360° panorama. */
	is360: boolean;
}

/** Custom element that renders a spatial audio source positioned at a marker location in the image. */
class MicrioAudioLocation extends MicrioElement<AudioLocationProps> {
	/** HTML tag name for this custom element. */
	static tag = 'micrio-audio-location';

	#props: AudioLocationProps = { marker: null!, ctx: null!, is360: false };
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

	_onMount() {
		const { marker, ctx, is360 } = this.#props;
		const micrio = this._getMicrio();
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
			// buffers come from AudioController module
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
		start();

		micrio.addEventListener('audio-update', update);
		this._addCleanup(() => micrio.removeEventListener('audio-update', update));
	}

	_setProps(props: Partial<AudioLocationProps>) {
		Object.assign(this.#props, props);
	}

	_onDestroy() {
		this.#end();
	}
}

customElements.define(MicrioAudioLocation.tag, MicrioAudioLocation);
