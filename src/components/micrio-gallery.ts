import { MicrioElement } from '$ts/component';
import type { HTMLMicrioElement } from '$ts/element';
import type { Gallery as GalleryController } from '$ts/gallery';
import './micrio-button';
import './micrio-button-group';
import './micrio-dial';

export interface GalleryProps {
	controller?: GalleryController;
}

export class MicrioGallery extends MicrioElement<GalleryProps> {
	static tag = 'micrio-gallery';
	static styles = `micrio-gallery{position:absolute;bottom:0;left:0;width:100%;z-index:2;pointer-events:none}
micrio-gallery>*{pointer-events:all}`;

	#props: GalleryProps = {};
	#unsubs: (() => void)[] = [];

	onMount() {
		const micrio = this.inject<HTMLMicrioElement>('micrio');
		if (!micrio) return;

		const controller = this.#props.controller;
		if (!controller) return;

		if (micrio.$current?.$settings?.omni) {
			this.#renderOmni(micrio);
		}
	}

	setProps(props: Partial<GalleryProps>) {
		if (props.controller !== undefined) this.#props.controller = props.controller;
	}

	#renderOmni(micrio: HTMLMicrioElement) {
		const image = micrio.$current;
		if (!image) return;

		const settings = image.$settings;
		const omni = settings.omni;
		if (!omni) return;

		const frames = omni.frames;

		// Dial for rotation
		const dial = document.createElement('micrio-dial') as MicrioElement;
		const onturn = (frame: number) => {
			const idx = Math.round(frame) % frames;
			if (image.swiper) image.swiper.goto(idx);
		};
		dial.setProps({
			currentRotation: 0,
			frames,
			degrees: true,
			onturn
		});
		this.appendChild(dial);

		// Subscribe to image layer changes to update dial
		this.#unsubs.push(image.state.layer.subscribe((idx: number) => {
			dial.setProps({ currentRotation: (idx / frames) * 360 });
		}));
	}

	onDestroy() {
		for (const fn of this.#unsubs) fn();
		this.#unsubs = [];
	}
}

customElements.define(MicrioGallery.tag, MicrioGallery);
