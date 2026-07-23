import { MicrioElement } from '$core/component';
import type { MicrioImage } from '$core/image';
import { get } from '$core/store';
import { createElement } from '$utils/dom';
import { i18n } from '$core/i18n/strings';

export interface ZoomButtonsProps {
	image?: MicrioImage;
}

class MicrioZoomButtons extends MicrioElement<ZoomButtonsProps> {
	static tag = 'micrio-zoom-buttons';

	#props: ZoomButtonsProps = {};
	#target: MicrioImage | undefined;
	#viewUnsub: (() => void) | undefined;
	#albumUnsub: (() => void) | undefined;
	#btnIn: MicrioElement | undefined;
	#btnOut: MicrioElement | undefined;

	onMount() {
		const micrio = this.getMicrio();
		if (!micrio) return;

		const update = () => {
			const img = this.#target;
			const zoomedIn = img?.camera.isZoomedIn() ?? true;
			const zoomedOut = img?.camera.isZoomedOut(true) ?? true;
			const minScale = img?.camera.getMinScale() ?? 0;
			const upscaled = minScale > 1 && minScale > (img?.$settings.zoomLimit ?? 1);

			if (upscaled) {
				this.replaceChildren();
				return;
			}

			const $i18n = get(i18n);

			if (!this.#btnIn) {
				(this.#btnIn = createElement('micrio-button') as MicrioElement).setProps({
					type: 'zoomIn',
					onclick: () => this.#target?.camera.zoomIn()
				});
			}
			if (!this.#btnIn.isConnected) this.append(this.#btnIn);
			this.#btnIn.setProps({ title: $i18n.zoomIn, disabled: zoomedIn });

			if (!this.#btnOut) {
				(this.#btnOut = createElement('micrio-button') as MicrioElement).setProps({
					type: 'zoomOut',
					onclick: () => this.#target?.camera.zoomOut()
				});
			}
			if (!this.#btnOut.isConnected) this.append(this.#btnOut);
			this.#btnOut.setProps({ title: $i18n.zoomOut, disabled: zoomedOut });
		};

		const bindTo = (img: MicrioImage | undefined) => {
			if (this.#viewUnsub) { this.#viewUnsub(); this.#viewUnsub = undefined; }
			this.#target = img;
			if (img) this.#viewUnsub = img.state.view.subscribe(() => update());
			else update();
		};

		if (this.#props.image) {
			bindTo(this.#props.image);
		} else {
			this.addCleanup(micrio.current.subscribe(c => {
				if (!c) return;
				if (this.#albumUnsub) { this.#albumUnsub(); this.#albumUnsub = undefined; }
				if (this.#viewUnsub) { this.#viewUnsub(); this.#viewUnsub = undefined; }
				const subscribeAlbum = () => {
					this.#viewUnsub?.();
					this.#albumUnsub = c.album!.currentImage!.subscribe(bindTo);
					update();
				};
				if (c.album?.currentImage) subscribeAlbum();
				else {
					bindTo(c);
					requestAnimationFrame(() => {
						if (c.album?.currentImage && !this.#albumUnsub) subscribeAlbum();
					});
				}
			}));
		}
	}

	setProps(props: Partial<ZoomButtonsProps>) {
		Object.assign(this.#props, props);
	}

	onDestroy() {
		if (this.#albumUnsub) this.#albumUnsub();
		if (this.#viewUnsub) this.#viewUnsub();
	}
}

customElements.define(MicrioZoomButtons.tag, MicrioZoomButtons);
