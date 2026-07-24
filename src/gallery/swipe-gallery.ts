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
import './swipe-gallery.css';

class MicrioSwipeGallery extends MicrioElement<MicrioGalleryProps> {
	static tag = 'micrio-swipe-gallery';

	#props: MicrioGalleryProps = { gallery: null!, lang: '' };

	_setProps(props: Partial<MicrioGalleryProps>) {
		if (props.gallery !== undefined) this.#props.gallery = props.gallery;
		if (props.galleryStart !== undefined) this.#props.galleryStart = props.galleryStart;
		if (props.lang !== undefined) this.#props.lang = props.lang;
	}

	_onMount() {
		const el = createElement('micr-io', { parent: this }) as HTMLMicrioElement;

		const caption = createElement('figcaption', { parent: this });

		const parent = this._getMicrio();
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

	_onDestroy() {
		const el = this.querySelector(':scope > micr-io') as HTMLMicrioElement | null;
		el?.destroy();
	}
}

customElements.define(MicrioSwipeGallery.tag, MicrioSwipeGallery);
