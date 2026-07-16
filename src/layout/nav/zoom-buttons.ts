import { MicrioElement } from '$core/component';
import type { MicrioImage } from '$core/image';
import { get, tick } from '$core/store';
import { once } from '$utils/store';
import { createElement } from '$utils/dom';
import { i18n } from '$core/i18n/strings';

export interface ZoomButtonsProps {
	image?: MicrioImage;
}

export class MicrioZoomButtons extends MicrioElement<ZoomButtonsProps> {
	static tag = 'micrio-zoom-buttons';
	static styles = `micrio-zoom-buttons{display:contents}`;

	#props: ZoomButtonsProps = {};
	#unsubs: (() => void)[] = [];
	#target: MicrioImage | undefined;
	#viewUnsub: (() => void) | undefined;
	#albumUnsub: (() => void) | undefined;

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
				this.innerHTML = '';
				return;
			}

			const $i18n = get(i18n);

			let btnIn = this.querySelector(':scope > .zb-zoom-in') as MicrioElement;
			if (!btnIn) {
				btnIn = createElement('micrio-button', { className: 'zb-zoom-in', parent: this }) as MicrioElement;
			}
			btnIn.setProps({
				type: 'zoom-in',
				title: $i18n.zoomIn,
				disabled: zoomedIn,
				onclick: () => {
					micrio.events.clicked = true;
					img?.camera.zoomIn().then(() => micrio.events.clicked = false);
				}
			});

			let btnOut = this.querySelector(':scope > .zb-zoom-out') as MicrioElement;
			if (!btnOut) {
				btnOut = createElement('micrio-button', { className: 'zb-zoom-out', parent: this }) as MicrioElement;
			}
			btnOut.setProps({
				type: 'zoom-out',
				title: $i18n.zoomOut,
				disabled: zoomedOut,
				onclick: () => {
					micrio.events.clicked = true;
					img?.camera.zoomOut().then(() => micrio.events.clicked = false);
				}
			});
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
			this.#unsubs.push(micrio.current.subscribe(c => {
				if (!c) return;
				if (this.#albumUnsub) { this.#albumUnsub(); this.#albumUnsub = undefined; }
				if (this.#viewUnsub) { this.#viewUnsub(); this.#viewUnsub = undefined; }
				once(c.info).then(() => tick()).then(() => {
					if (c.album?.currentImage) {
						this.#albumUnsub = c.album.currentImage.subscribe(bindTo);
					} else {
						bindTo(c);
					}
					update();
				});
			}));
		}
	}

	setProps(props: Partial<ZoomButtonsProps>) {
		Object.assign(this.#props, props);
	}

	onDestroy() {
		if (this.#albumUnsub) this.#albumUnsub();
		if (this.#viewUnsub) this.#viewUnsub();
		for (const fn of this.#unsubs) fn();
		this.#unsubs = [];
	}
}

customElements.define(MicrioZoomButtons.tag, MicrioZoomButtons);
