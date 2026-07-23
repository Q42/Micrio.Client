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
	#btnIn: MicrioElement | undefined;
	#btnOut: MicrioElement | undefined;

	onMount() {
		const micrio = this.getMicrio();
		if (!micrio) return;

		const resolveTarget = () => {
			const imgs = get(micrio.visible).filter(i => i.id);
			return imgs.length === 1 ? imgs[0] : micrio.$current;
		};

		const update = () => {
			this.#target = this.#props.image ?? resolveTarget();

			const img = this.#target;
			const zoomedIn = img?.camera.isZoomedIn() ?? true;
			const zoomedOut = !micrio.hasAttribute('data-zoomed');
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

		this.addCleanup(micrio.current.subscribe(() => update()));
		this.addCleanup(micrio.visible.subscribe(() => update()));

		const onZoom = () => update();
		micrio.addEventListener('zoom', onZoom);
		this.addCleanup(() => micrio.removeEventListener('zoom', onZoom));

		update();
	}

	setProps(props: Partial<ZoomButtonsProps>) {
		Object.assign(this.#props, props);
	}
}

customElements.define(MicrioZoomButtons.tag, MicrioZoomButtons);
