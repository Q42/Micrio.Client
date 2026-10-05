import { eventPassive, eventPassiveCapture, type EventContext } from './shared';

import type { MicrioImage } from '$core/image';
import type { Models } from '$types/models';

/** Document events that mean the native context menu is done (or that the page changed under it). */
const restoreEvents: (keyof DocumentEventMap)[] = ['pointerdown', 'wheel', 'keydown', 'touchstart', 'scroll'];

/**
 * Makes the browser's native context menu "Copy image" action useful for the WebGL canvas.
 *
 * The canvas is always as large as the whole `<micr-io>` element, so an image that does not
 * fill it leaves transparent padding that the browser copies along with the image. There is
 * no browser API to crop what "Copy image" grabs, so instead the canvas element is
 * temporarily resized to the area the image covers - on right mouse down, before the browser
 * builds its context menu, so that the menu (and the copy action it triggers) targets the
 * cropped canvas. The next interaction restores the canvas and its view.
 *
 * Enabled per element with the `data-contextmenu-crop` attribute, and requires
 * `data-preserve-drawing-buffer` (the browser reads the drawing buffer after compositing).
 * @internal
 */
export class ContextMenuCopyHandler {
	#hooked = false;
	#ctx: EventContext;

	/** The image currently being cropped for the context menu. */
	#image?: MicrioImage;
	/** The camera view to restore afterwards. */
	#view?: Models.Camera.View;

	/**
	 * @param ctx The shared event context.
	 */
	constructor(ctx: EventContext) {
		this.#ctx = ctx;
	}

	/** Hooks the context menu crop listeners. */
	hook(): void {
		if (this.#hooked) {return;}
		this.#hooked = true;

		// Runs before the browser builds the native context menu (and before Micrio's handlers)
		this.#ctx._micrio.addEventListener('pointerdown', this.#pointerDown, eventPassive);

		for (const type of restoreEvents) {document.addEventListener(type, this.restore, eventPassiveCapture);}
		self.addEventListener('resize', this.restore, eventPassive);
	}

	/** Unhooks the context menu crop listeners, restoring the canvas if needed. */
	unhook(): void {
		if (!this.#hooked) {return;}
		this.#hooked = false;

		this.restore();

		this.#ctx._micrio.removeEventListener('pointerdown', this.#pointerDown, eventPassive);

		for (const type of restoreEvents) {document.removeEventListener(type, this.restore, eventPassiveCapture);}
		self.removeEventListener('resize', this.restore, eventPassive);
	}

	/** Right-button presses start a possible native "Copy image" action. */
	#pointerDown = (e: PointerEvent): void => {
		if (e.button !== 2) {return;}
		this.#engage();
	}

	/**
	 * Temporarily resizes the canvas to the area the main image covers, so that the
	 * upcoming native context menu copies only the image.
	 */
	#engage(): void {
		const micrio = this.#ctx._micrio;
		if (!micrio.hasAttribute('data-contextmenu-crop')) {return;}
		// The browser reads the drawing buffer after compositing, so it must be preserved
		if (!micrio.hasAttribute('data-preserve-drawing-buffer')) {return;}

		const engine = micrio._engine;
		if (!engine.ready || !micrio._webgl.gl) {return;}

		// The main image of this element. Other entries on the canvas are in-image embeds
		// drawn inside this image's space, and they travel along with it.
		const image = micrio.$current;
		if (!image || image._is360 || image._isOmni || image._noImage) {return;}

		const {canvas} = micrio;
		const crop = canvas._imageCrop(image.camera);
		if (!crop) {return;} // Nothing to crop: the image covers the whole canvas

		this.#image = image;
		this.#view = image.camera.getView();

		// 1. Resize the canvas to the image area (this also draws, synchronously)
		canvas._enterCropMode(crop);
		// 2. Reproduce exactly the region that was on screen
		image.camera.setView(crop.view, { noRender: true });
		// 3. Draw it immediately: the native menu can stall rAF until after the copy
		engine._drawSync();
	}

	/** Restores the canvas size and camera view. Safe to call at any time. */
	restore = (): void => {
		const image = this.#image;
		if (!image) {return;}
		const view = this.#view;
		this.#image = undefined;
		this.#view = undefined;

		const micrio = this.#ctx._micrio;
		micrio.canvas._exitCropMode();
		// The resize above re-applies a view derived from the cropped state, so restore ours after it
		if (view) {image.camera.setView(view, { noRender: true });}
		micrio._engine._drawSync();
	}
}
