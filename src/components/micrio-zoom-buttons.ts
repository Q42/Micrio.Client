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
	static styles = '';

	#props: ZoomButtonsProps = {};
	#isZoomedIn = false;
	#isZoomedOut = false;
	#isUpscaled = false;
	#loading = false;
	#unsubs: (() => void)[] = [];

	onMount() {
		this.#setup();
	}

	setProps(props: Partial<ZoomButtonsProps>) {
		Object.assign(this.#props, props);
	}

	#setup() {
		const micrio = this.inject<HTMLMicrioElement>('micrio');
		if (!micrio) return;

		const update = () => {
			const img = this.#props.image || micrio.$current;
			this.#isZoomedIn = img?.camera.isZoomedIn() ?? true;
			this.#isZoomedOut = img?.camera.isZoomedOut(true) ?? true;
			const minScale = img?.camera.getMinScale() ?? 0;
			this.#isUpscaled = minScale > 1 && minScale > (img?.$settings.zoomLimit ?? 1);
			this.#render();
		};

		const gestured = () => { micrio.events.clicked = true; };

		const zoomIn = () => {
			gestured();
			this.#props.image?.camera.zoomIn().then(() => micrio.events.clicked = false);
		};

		const zoomOut = () => {
			gestured();
			this.#props.image?.camera.zoomOut().then(() => micrio.events.clicked = false);
		};

		if (this.#props.image) {
			this.#unsubs.push(this.#props.image.state.view.subscribe(update));
		} else {
			this.#unsubs.push(micrio.current.subscribe(c => {
				if (!c) return;
				this.#loading = true;
				this.#unsubs.push(c.state.view.subscribe(update));
				this.#loading = false;
			}));
		}

		(this as any).__zoomIn = zoomIn;
		(this as any).__zoomOut = zoomOut;

		update();
	}

	#render() {
		if (this.#isUpscaled || (!this.#isZoomedIn && !this.#isZoomedOut)) return;

		this.replaceChildren();
		const $i18n = get(i18n);

		const btnIn = document.createElement('micrio-button') as any;
		btnIn.setProps({
			type: 'zoom-in',
			title: $i18n.zoomIn,
			disabled: this.#loading || this.#isZoomedIn,
			onclick: (this as any).__zoomIn
		});
		this.appendChild(btnIn);

		const btnOut = document.createElement('micrio-button') as any;
		btnOut.setProps({
			type: 'zoom-out',
			title: $i18n.zoomOut,
			disabled: this.#loading || this.#isZoomedOut,
			onclick: (this as any).__zoomOut
		});
		this.appendChild(btnOut);
	}

	onDestroy() {
		for (const fn of this.#unsubs) fn();
		this.#unsubs = [];
	}
}

customElements.define(MicrioZoomButtons.tag, MicrioZoomButtons);
