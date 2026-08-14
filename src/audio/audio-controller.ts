import type { Models } from '$types/models';
import type { MicrioImage } from '$core/image';
import type { HTMLMicrioElement } from '$core/element';
import { writable, get } from '$core/store';
import { Browser } from '$utils/browser';
import { normalize3 } from '$utils/math';
import { MicrioAudioLocation } from './audio-location';

// ── Module-level AudioContext state ──

/** @internal */
export let mainGain: GainNode | undefined;
/** @internal */
let _ctx: AudioContext | null = null;
let l: AudioListener | undefined;
const interacted = writable<boolean>(false);

function init(volume: number) {
	if (mainGain) return;
	if (!_ctx) _ctx = 'micrioAudioContext' in window
		? (window as Record<string, any>)['micrioAudioContext'] as AudioContext
		: new AudioContext();
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
		l.positionX.value = x;
		l.positionY.value = y;
		l.positionZ.value = z;
	}
}

function setOrientation(x: number, y: number, z: number) {
	if (!l) return;
	if (l.setOrientation) l.setOrientation(x, y, z, 0, 1, 0);
	else if ('forwardX' in l) {
		l.forwardX.value = x;
		l.forwardY.value = y;
		l.forwardZ.value = z;
	}
}

/** Manages sequential playback of a list of audio tracks, with optional looping. */
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

	/** Stops playback and releases the audio element. */
	destroy() { this.#audio.pause(); }
}

// ── AudioController ──

/** Manages spatial audio, playlist playback, and user interaction for Micrio images. */
export class MicrioAudioController {
	#micrio: HTMLMicrioElement;
	#image: MicrioImage;
	#playlist: AudioPlaylist | undefined;
	#cleanups: (() => void)[] = [];
	#audioLocations: MicrioAudioLocation[] = [];

	constructor(micrio: HTMLMicrioElement, image: MicrioImage) {
		this.#micrio = micrio;
		this.#image = image;
		this.#init();
	}

	#rebuildAudioLocations(img: MicrioImage | undefined): void {
		for (const loc of this.#audioLocations) loc.destroy();
		this.#audioLocations = [];
		if (!_ctx || !img) return;
		const info = img.$info;
		if (!info) return;
		const is360 = !!info.is360;
		const data = img.$data;
		const posMarkers = data?.markers?.filter((m: any) => !!m.positionalAudio);
		if (!posMarkers?.length) return;

		for (const marker of posMarkers) {
			this.#audioLocations.push(
				new MicrioAudioLocation(this.#micrio, marker, _ctx, is360)
			);
		}
	}

	#init() {
		const micrio = this.#micrio;
		const image = this.#image;
		const { events } = micrio;

		const info = image.$info;
		if (!info) return;
		const is360 = !!info.is360;
		const ar = info.height / info.width;

		if (!('AudioContext' in window)) return;

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
				const [nx, ny, nz] = normalize3(_x, _y, _z);
				setOrientation(nx, ny, nz);
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

		this.#cleanups.push(interacted.subscribe(b => {
			if (!b) return;
			const vol = get(micrio._isMuted) ? 0 : 1;
			if (!_ctx) init(typeof vol === 'number' ? vol : 1);
			if (_ctx) {
				const data = image.$data;
				if (data?.markers?.filter((m: any) => !!m.positionalAudio).length) {
					this.#cleanups.push(image.state.view.subscribe(v => {
						if (!v) return;
						const d = Math.max(0, 1.05 - image.camera.getScale());
						moved(v[0] + v[2] / 2, v[1] + v[3] / 2, d * (is360 ? 1 : 1.5));
					}));
				}
				this.#rebuildAudioLocations(micrio.$current);
			}
		}));

		this.#cleanups.push(micrio.current.subscribe(currentImage => {
			if (!currentImage || !_ctx) return;
			this.#rebuildAudioLocations(currentImage);
		}));

		if (!_ctx) {
			audio.play().then(input).catch(() => events._dispatch('autoplay-blocked'));
			addEventListener('pointerup', onUserGesture, { once: true });
		}

		// Render playlist if music data exists
		const data = image.$data;
		if (data?.music?.items.length) {
			const vol = get(micrio._isMuted) ? 0 : 1;
			this.#playlist = new AudioPlaylist(data.music.items, data.music.loop ?? true, (vol as number) * (data.music.volume ?? 1));
		}

		this.#cleanups.push(micrio._isMuted.subscribe(muted => {
			if (mainGain) mainGain.gain.value = muted ? 0 : 1;
		}));

		// Store cleanup for renderless operation
		this.#cleanups.push(() => {
			audio.remove();
			removeEventListener('pointerup', onUserGesture);
		});
	}

	destroy() {
		for (const loc of this.#audioLocations) loc.destroy();
		this.#audioLocations = [];
		for (const fn of this.#cleanups) fn();
		this.#cleanups = [];
		this.#playlist?.destroy();
	}
}
