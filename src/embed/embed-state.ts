import type { Models } from '$types/models';
import type { MicrioImage } from '$core/image';

import { GLEmbedVideo } from '$media/embedvideo';

/**
 * Cycles a GL embed created via `image.addEmbed(..., { states })` through its configured
 * alternate image/video states in place, reusing the embed's existing single base texture
 * rather than creating/destroying the embed itself.
 * @internal
 */
export class EmbedStateController {
	readonly #image: MicrioImage;
	readonly #states: Models.Embeds.EmbedState[];
	#index: number = -1;
	#video?: GLEmbedVideo;

	constructor(image: MicrioImage, states: Models.Embeds.EmbedState[]) {
		this.#image = image;
		this.#states = states;
	}

	/** The currently active state index, or -1 if no state has been set yet. @internal */
	get index(): number { return this.#index; }

	/** Jumps to the given state index (wraps via modulo). @internal */
	set(index: number): void {
		const n = this.#states.length;
		if (!n) return;
		const i = ((index % n) + n) % n;
		if (i === this.#index) return;
		this.#index = i;
		const state = this.#states[i];

		if (this.#video) {
			// Leaving a video state: stop it and clear the shared video handle so the
			// tile draw doesn't keep sampling the outgoing <video> element's last frame.
			this.#video._unmount();
			this.#video = undefined;
			this.#image.video.set(undefined);
		}

		if ('src' in state) {
			this.#image._isVideo = false;
			this.#image.engine._reloadEmbedTexture(this.#image, state.src, { noSmoothing: state.noSmoothing });
		} else {
			this.#image._isVideo = true;
			this.#video = new GLEmbedVideo(this.#image.engine, this.#image, state, false, () => this.#image.engine.render());
		}
	}

	/** Advances to the next state (wraps to the first after the last). @internal */
	next(): void { this.set(this.#index + 1); }
}
