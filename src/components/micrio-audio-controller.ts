import { MicrioElement } from '$ts/component';
import type { HTMLMicrioElement } from '$ts/element';
import type { Models } from '$types/models';
import { writable, get } from '$ts/store';
import { Browser } from '$ts/utils/browser';

// ── Module-level AudioContext state ──

let mainGain: GainNode | undefined;
let _ctx: AudioContext | null = null;
let l: AudioListener | undefined;
const interacted = writable<boolean>(false);

function init(volume: number) {
	if (mainGain) return;
	if (!_ctx) _ctx = 'micrioAudioContext' in window
		? (window as any)['micrioAudioContext'] as AudioContext
		: 'AudioContext' in window ? new AudioContext()
		: 'webkitAudioContext' in window ? new (window as any)['webkitAudioContext']() as AudioContext
		: null;
	if (!_ctx) return console.warn('[Micrio] Your browser does not support the Web Audio API');
	if (_ctx.state === 'suspended') _ctx.resume().then(() => { }).catch(() => { });
	mainGain = _ctx.createGain();
	mainGain.connect(_ctx.destination);
	mainGain.gain.value = volume;
	l = _ctx.listener;
	if ('upX' in l) { l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0; }
}

function setPosition(x: number, y: number, z: number) {
	if (!l) return;
	if (l.setPosition) l.setPosition(x, y, z);
	else if ('positionX' in l) {
		(l as any).positionX.value = x;
		(l as any).positionY.value = y;
		(l as any).positionZ.value = z;
	}
}

function setOrientation(x: number, y: number, z: number) {
	if (!l) return;
	if (l.setOrientation) l.setOrientation(x, y, z, 0, 1, 0);
	else if ('forwardX' in l) {
		(l as any).forwardX.value = x;
		(l as any).forwardY.value = y;
		(l as any).forwardZ.value = z;
	}
}

class AudioPlaylist {
	#audio = new Audio();
	#list: Models.Assets.Audio[];
	#loop: boolean;
	#idx = -1;

	constructor(list: Models.Assets.Audio[], loop: boolean, volume: number) {
		this.#list = list;
		this.#loop = loop;
		this.#audio.preload = 'none';
		this.#audio.loop = false;
		this.#audio.volume = volume;
		this.#audio.onended = () => this.#next();
		this.#next();
	}

	#next() {
		if (!this.#loop && this.#idx + 1 === this.#list.length) return;
		const item = this.#list[(++this.#idx) % this.#list.length];
		this.#audio.src = item.src ?? '';
		this.#audio.play();
	}

	setVolume(v: number) { this.#audio.volume = v; }

	destroy() { this.#audio.pause(); }
}

// ── AudioController custom element ──

export class MicrioAudioController extends MicrioElement {
	static tag = 'micrio-audio-controller';
	static styles = `micrio-audio-controller{display:contents}`;

	#unsubs: (() => void)[] = [];
	#playlist: AudioPlaylist | undefined;

	onMount() {
		const micrio = this.inject<HTMLMicrioElement>('micrio');
		if (!micrio) return;

		const { events } = micrio;
		const image = micrio.$current;
		if (!image) return;

		const info = image.$info;
		if (!info) return;
		const is360 = !!info.is360;
		const ar = info.height / info.width;

		const supported = 'AudioContext' in window || 'webkitAudioContext' in window;
		if (!supported) return;

		const moved = (x: number, y: number, z: number) => {
			if (is360) {
				x *= -Math.PI * 2;
				y -= 0.5;
				y *= -Math.PI;
				const r = 10 * (1 - z);
				const _x = Math.cos(y) * Math.sin(x) * r;
				const _y = Math.sin(y) * r;
				const _z = Math.cos(y) * Math.cos(x) * r;
				setPosition(_x, _y, _z);
				let len = _x * _x + _y * _y + _z * _z;
				if (len > 0) len = 1.0 / Math.sqrt(len);
				setOrientation(_x * len, _y * len, _z * len);
			} else {
				setPosition((x - 0.5) * 2, (0.5 - y) * 2 * ar, z);
				setOrientation(0, 0, -1);
			}
		};

		const input = () => interacted.set(true);

		const onUserGesture = () => {
			if (_ctx?.state === 'suspended') _ctx.resume().then(() => { }).catch(() => { });
			else if (!_ctx) input();
		};

		const audio = new Audio('data:audio/mpeg;base64,...');
		audio.volume = Browser.iOS ? 0 : 0.0001;
		document.body.appendChild(audio);

		if (supported) {
			this.#unsubs.push(interacted.subscribe(b => {
				if (!b) return;
				const volumeStore = this.inject<any>('volume');
				const vol = volumeStore ? get(volumeStore) : 1;
				if (!_ctx) init(typeof vol === 'number' ? vol : 1);
				if (_ctx) {
					const data = image.$data;
					if (data?.markers?.filter((m: any) => !!m.positionalAudio).length) {
						this.#unsubs.push(image.state.view.subscribe(v => {
							if (!v) return;
							const d = Math.max(0, 1.05 - image.camera.getScale());
							moved(v[0] + v[2] / 2, v[1] + v[3] / 2, d * (is360 ? 1 : 1.5));
						}));
					}
				}
			}));

			if (!_ctx) {
				audio.play().then(input).catch(() => events.dispatch('autoplay-blocked' as any));
				addEventListener('pointerup', onUserGesture, { once: true });
			}

			// Render playlist if music data exists
			const data = image.$data;
			if (data?.music?.items.length) {
				const vol = this.inject<any>('volume');
				const volVal: number = vol ? get(vol) : 1;
				this.#playlist = new AudioPlaylist(data.music.items, data.music.loop ?? true, (volVal as number) * (data.music.volume ?? 1));
			}
		}

		this.#unsubs.push(micrio.isMuted.subscribe(muted => {
			if (mainGain) mainGain.gain.value = muted ? 0 : 1;
		}));

		// Expose for renderless operation
		(this as any).__destroy = () => {
			if (_ctx) {
				audio.remove();
				removeEventListener('pointerup', onUserGesture);
			}
		};
	}

	onDestroy() {
		this.#playlist?.destroy();
		for (const fn of this.#unsubs) fn();
		this.#unsubs = [];
	}
}

customElements.define(MicrioAudioController.tag, MicrioAudioController);
