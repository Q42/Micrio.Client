import { createElement } from '$utils/dom';
import { MicrioElement } from '$core/component';
import type { HTMLMicrioElement } from '$core/element';
import type { Models } from '$types/models';
import { Gallery } from '$gallery/controller';

export interface MicrioGalleryProps {
	gallery: Models.Assets.Image[];
	galleryStart?: string;
	lang: string;
}

class MicrioSwipeGallery extends MicrioElement<MicrioGalleryProps> {
	static tag = 'micrio-swipe-gallery';
	static styles = `micrio-swipe-gallery>figcaption {
	position: absolute;
	top: var(--micrio-border-margin);
	left: var(--micrio-border-margin);
	padding: var(--micrio-popup-padding);
	max-width: 410px;
	box-sizing: border-box;
	color: var(--micrio-color);
	background: var(--micrio-background);
	backdrop-filter: var(--micrio-background-filter);
	box-shadow: var(--micrio-popup-shadow);
	border-radius: var(--micrio-border-radius);
}
@media (max-width: 500px) {
	micrio-swipe-gallery>figcaption {
		max-width: calc(100% - 3*var(--micrio-border-margin) - var(--micrio-button-size));
	}
}
`;

	#props: MicrioGalleryProps = { gallery: null!, lang: '' };

	setProps(props: Partial<MicrioGalleryProps>) {
		if (props.gallery !== undefined) this.#props.gallery = props.gallery;
		if (props.galleryStart !== undefined) this.#props.galleryStart = props.galleryStart;
		if (props.lang !== undefined) this.#props.lang = props.lang;
	}

	onMount() {
		const el = createElement('micr-io', { parent: this }) as HTMLMicrioElement;

		const caption = createElement('figcaption', { parent: this });

		const parent = this.getMicrio();
		const basePath = parent?.$current?.$info?.path;

		requestAnimationFrame(() => {
			const galleryCtrl = Gallery.fromAssets(this.#props.gallery, el.engine, el, {
				startId: this.#props.galleryStart,
				basePath
			});
			galleryCtrl.openOn(el);
		});

		let currentIdx = 0;
		const updateCaption = () => {
			const item = this.#props.gallery[currentIdx];
			const text = item?.i18n?.[this.#props.lang]?.description;
			caption.innerHTML = text ?? '';
			caption.style.display = text ? '' : 'none';
		};

		el.addEventListener('gallery-show', ((e: Event) => {
			currentIdx = (e as CustomEvent).detail as number;
			updateCaption();
		}) as EventListener);

		updateCaption();
	}

	onDestroy() {
		const el = this.querySelector(':scope > micr-io') as HTMLMicrioElement | null;
		el?.destroy();
	}
}

customElements.define(MicrioSwipeGallery.tag, MicrioSwipeGallery);
