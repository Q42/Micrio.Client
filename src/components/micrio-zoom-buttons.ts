import { MicrioElement } from '$ts/component';
import type { MicrioImage } from '$ts/image';
import type { HTMLMicrioElement } from '$ts/element';
import { get } from '$ts/store';
import { i18n } from '$ts/i18n/strings';

export interface ZoomButtonsProps {
	image?: MicrioImage;
}

export class MicrioZoomButtons extends MicrioElement<ZoomButtonsProps> {
	static tag = 'micrio-zoom-buttons';
	static styles = `micrio-zoom-buttons{display:contents}`;

	#props: ZoomButtonsProps = {};
	#unsubs: (() => void)[] = [];

	onMount() {
		const micrio = this.inject<HTMLMicrioElement>('micrio');
		if (!micrio) return;

		const update = () => {
			const img = this.#props.image || micrio.$current;
			const zoomedIn = img?.camera.isZoomedIn() ?? true;
			const zoomedOut = img?.camera.isZoomedOut(true) ?? true;
			const minScale = img?.camera.getMinScale() ?? 0;
			const upscaled = minScale > 1 && minScale > (img?.$settings.zoomLimit ?? 1);

			if (upscaled) {
				this.innerHTML = '';
				return;
			}

			const $i18n = get(i18n);

			// Update or create zoom-in button
			let btnIn = this.querySelector(':scope > .zb-zoom-in') as MicrioElement;
			if (!btnIn) {
				btnIn = document.createElement('micrio-button') as MicrioElement;
				btnIn.className = 'zb-zoom-in';
				this.appendChild(btnIn);
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

			// Update or create zoom-out button
			let btnOut = this.querySelector(':scope > .zb-zoom-out') as MicrioElement;
			if (!btnOut) {
				btnOut = document.createElement('micrio-button') as MicrioElement;
				btnOut.className = 'zb-zoom-out';
				this.appendChild(btnOut);
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

		if (this.#props.image) {
			this.watchLater(this.#props.image.state.view, () => update());
		} else {
			let viewUnsub: (() => void) | undefined;
			this.#unsubs.push(micrio.current.subscribe(c => {
				if (!c) return;
				viewUnsub?.();
				let first = true;
				viewUnsub = c.state.view.subscribe(() => {
					if (first) { first = false; return; }
					update();
				});
			}));
		}

		update();
	}

	setProps(props: Partial<ZoomButtonsProps>) {
		Object.assign(this.#props, props);
	}

	onDestroy() {
		for (const fn of this.#unsubs) fn();
		this.#unsubs = [];
	}
}

customElements.define(MicrioZoomButtons.tag, MicrioZoomButtons);
