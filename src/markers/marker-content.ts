import { MicrioElement } from '$core/component';
import type { Models } from '$types/models';
import { get } from '$core/store';
import { createElement } from '$utils/dom';

export interface MarkerContentProps {
	marker: Models.ImageData.Marker;
	noEmbed?: boolean;
	noImages?: boolean;
	noGallery?: boolean;
	onclose?: () => void;
}
import './marker-content.css';

class MicrioMarkerContent extends MicrioElement<MarkerContentProps> {
	static tag = 'micrio-marker-content';

	_title: HTMLElement | undefined;

	protected _render() {
		const { marker, noEmbed = false, noImages = false, noGallery = false, onclose } = this._props;
		if (!marker) return;

		const micrio = this._getMicrio();
		const markerImages = MicrioElement._markerImages;
		const image = marker.id ? markerImages.get(marker.id) : undefined;
		if (!micrio || !image) return;

		const $_lang = get(micrio._lang);
		const key = `${marker.id}::${$_lang}::${noEmbed}::${noImages}::${noGallery}`;
		if (!this._checkRenderKey(key)) return;

		const $tour = get(micrio.state.tour);
		const isSerialTour = $tour && 'steps' in $tour && $tour.isSerialTour;
		const settings = image.$settings._markers ?? {};
		const autoplayMedia = !settings.preventAutoPlay;
		const content = marker.i18n?.[$_lang];
		const singleImage = marker.images?.length == 1;
		const galleryEnabled = !marker.data?.preventImageOpen && !noGallery;
		const isDev = image._tileBase?.includes('micrio.dev');

		const imageCaption = singleImage && marker.images?.[0]?.i18n?.[$_lang]?.description;

		const openGallery = (startId: string | undefined) => {
			if (!galleryEnabled) return;
			micrio.state.popover.set({ gallery: marker.images, galleryStart: startId, image });
		};

		const getTitle = (asset: Models.Assets.Image) => asset.i18n?.[$_lang]?.title;

		const mediaEnded = () => {
			if ($tour && 'steps' in $tour && ($tour.isSerialTour || settings.tourAutoProgress)) {
				onclose?.();
			}
		};

		if (!content) { this.replaceChildren(); return; }

		this.replaceChildren();

		// Title
		if (content.title) {
			const h1 = createElement('h1', {
				textContent: content.title,
				parent: this
			});
			this._title = h1;
		}

		// Primary Body (first)
		if (content.body && settings.primaryBodyFirst) {
			createElement('micrio-article', {
				setProps: { html: content.body },
				parent: this
			});
		}

		// Audio/Video Tour media
		if (!isSerialTour && (((!content.embedUrl) && marker.videoTour) || content.audio)) {
			const audio = marker.videoTour?.i18n?.[$_lang]?.audio ?? content?.audio;
			const audioSrc = audio?.src;
			const pausedAudio = !autoplayMedia || !marker?.audioAutoPlay;
			createElement('micrio-media', {
				setProps: {
					src: audioSrc, noPlayOverlay: true, image, uuid: marker.id,
					tour: marker.videoTour,
					autoplay: marker.audioAutoPlay || (!content.audio && !!marker.videoTour),
					controls: !marker.videoTour || !content.embedUrl,
					onended: mediaEnded, paused: pausedAudio
				},
				parent: this
			});
		}

		// Marker Images
		if (!noImages && !!marker.images?.length) {
			const section = createElement('section');
			for (const asset of marker.images) {
				const btn = createElement('button', {
					props: {
						title: getTitle(asset) ?? '',
						disabled: !galleryEnabled
					},
					events: galleryEnabled ? { click: () => openGallery(asset.micrioId) } : undefined
				});

				const figure = createElement('figure');
				createElement('img', {
					props: {
						alt: getTitle(asset) ?? '',
						src: asset.micrioId
							? `https://iiif.${isDev ? 'micrio.dev' : 'micr.io'}/${asset.micrioId}/full/${singleImage ? '^' + Math.min(asset.width, 640) + ',' : '^,320'}/0/default.webp`
							: asset.src
					},
					parent: figure
				});

				if (imageCaption) {
					createElement('figcaption', {
						textContent: imageCaption,
						parent: figure
					});
				}
				btn.appendChild(figure);
				section.appendChild(btn);
			}
			this.appendChild(section);
		}

		// Embed
		if (content.embedUrl && !noEmbed) {
			if (!content.audio && marker.videoTour) {
				createElement('micrio-media', {
					setProps: {
						image, className: 'hidden', uuid: marker.id,
						tour: marker.videoTour, autoplay: autoplayMedia, secondary: true
					},
					parent: this
				});
			}

			const pausedVideo = marker?.embedAutoPlay === false || (!autoplayMedia || !!(content?.audio && marker?.audioAutoPlay));
			createElement('micrio-media', {
				setProps: {
					image, src: content.embedUrl, uuid: marker.id,
					width: 400, height: 240, controls: true,
					title: content.embedTitle, figcaption: content.embedDescription,
					autoplay: !pausedVideo, onended: mediaEnded, paused: pausedVideo
				},
				parent: this
			});
		}

		// Primary Body (not first)
		if (content.body && !settings.primaryBodyFirst) {
			createElement('micrio-article', {
				setProps: { html: content.body },
				parent: this
			});
		}

		// Secondary Body
		if (content.bodySecondary) {
			createElement('micrio-article', {
				setProps: { html: content.bodySecondary },
				parent: this
			});
		}
	}

}

customElements.define(MicrioMarkerContent.tag, MicrioMarkerContent);
