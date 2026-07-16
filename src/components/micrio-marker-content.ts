import { MicrioElement } from '$ts/component';
import type { Models } from '$types/models';
import type { MicrioImage } from '$ts/image';
import { get } from '$ts/store';

export interface MarkerContentProps {
	marker: Models.ImageData.Marker;
	noEmbed?: boolean;
	noImages?: boolean;
	noGallery?: boolean;
	onclose?: () => void;
}

export class MicrioMarkerContent extends MicrioElement<MarkerContentProps> {
	static tag = 'micrio-marker-content';
	static styles = `micrio-marker-content{display:block;position:relative;padding:var(--micrio-popup-padding);overflow-y:auto;user-select:text;color:var(--micrio-color);background:var(--micrio-background);backdrop-filter:var(--micrio-background-filter);box-shadow:var(--micrio-popup-shadow);border-radius:var(--micrio-border-radius);box-sizing:border-box;text-align:var(--micrio-text-align)}
micrio-marker-content>*{--micrio-button-background:none;--micrio-background-filter:none;--micrio-button-shadow:none}
micrio-marker-content .micrio-progress-bar.container{background:transparent;backdrop-filter:none}
micrio-marker-content h1{font-size:1.5em;font-weight:600;margin:0 0 1.25em 0}
micrio-marker-content p{white-space:pre-line}
micrio-marker-content figure.hidden{display:none}
micrio-marker-content figure>div.micrio-media>*:first-child{width:100%}
micrio-marker-content micrio-media{margin:calc(-1 * var(--micrio-popup-padding));width:auto;--micrio-background:transparent}
micrio-marker-content micrio-media:not(:only-child):not(:last-child){margin-bottom:0}
micrio-marker-content article:last-child{margin-bottom:var(--micrio-popup-padding)}
micrio-marker-content button{padding:0;margin:0 calc(-1 * var(--micrio-popup-padding)) var(--micrio-popup-padding) calc(-1 * var(--micrio-popup-padding))}
micrio-marker-content button:disabled{cursor:default}
micrio-marker-content figcaption{padding:10px;font-style:italic;font-size:.9em;margin-bottom:var(--micrio-popup-padding);text-align:center}
micrio-marker-content section{display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));column-gap:5px;row-gap:5px;justify-items:center;margin-bottom:var(--micrio-popup-padding)}
micrio-marker-content section button{color:inherit;border:none;display:block;width:100%;cursor:pointer;margin:0}
micrio-marker-content section figure{padding:0;margin:0}
micrio-marker-content section img{width:100%;display:block;object-fit:cover}
@media(max-width:500px){micrio-marker-content section{display:block;float:right;width:100px;margin-left:var(--micrio-border-margin)}
micrio-marker-content section>button:not(:nth-child(1)){display:none}
micrio-marker-content section figcaption{display:none}
}`;

	#props: MarkerContentProps = { marker: null! };
	#unsubs: (() => void)[] = [];
	_title: HTMLElement | undefined;

	onMount() {
		this.#render();
	}

	setProps(props: Partial<MarkerContentProps>) {
		Object.assign(this.#props, props);
		if (this.isConnected) this.#render();
	}

	#render() {
		const { marker, noEmbed = false, noImages = false, noGallery = false, onclose } = this.#props;
		if (!marker) return;

		const micrio = this.getMicrio();
		const markerImages = MicrioElement.markerImages as Map<string, MicrioImage>;
		const image = marker.id ? markerImages.get(marker.id) as MicrioImage : undefined;
		if (!micrio || !image) return;

		const $_lang = get(micrio._lang);
		const key = `${marker.id}::${$_lang}::${noEmbed}::${noImages}::${noGallery}`;
		if (!this.checkRenderKey(key)) return;

		const $tour = get(micrio.state.tour);
		const isSerialTour = $tour && 'steps' in $tour && $tour.isSerialTour;
		const settings = image.$settings._markers ?? {};
		const autoplayMedia = !settings.preventAutoPlay;
		const content = marker.i18n?.[$_lang];
		const singleImage = marker.images?.length == 1;
		const galleryEnabled = !marker.data?.preventImageOpen && !noGallery;
		const isDev = image.tileBase?.includes('micrio.dev');

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

		if (!content) { this.innerHTML = ''; return; }

		this.replaceChildren();

		// Title
		if (content.title) {
			const h1 = document.createElement('h1');
			h1.textContent = content.title;
			this._title = h1;
			this.appendChild(h1);
		}

		// Primary Body (first)
		if (content.body && settings.primaryBodyFirst) {
			const article = document.createElement('micrio-article') as MicrioElement;
			article.setProps({ html: content.body });
			this.appendChild(article);
		}

		// Audio/Video Tour media
		if (!isSerialTour && (((!content.embedUrl) && marker.videoTour) || content.audio)) {
			const audio = marker.videoTour?.i18n?.[$_lang]?.audio ?? content?.audio;
			const audioSrc = audio?.src;
			const pausedAudio = !autoplayMedia || !marker?.audioAutoPlay;
			const media = document.createElement('micrio-media') as MicrioElement;
			media.setProps({
				src: audioSrc, noPlayOverlay: true, image, uuid: marker.id,
				tour: marker.videoTour,
				autoplay: marker.audioAutoPlay || (!content.audio && !!marker.videoTour),
				controls: !marker.videoTour || !content.embedUrl,
				onended: mediaEnded, paused: pausedAudio
			});
			this.appendChild(media);
		}

		// Marker Images
		if (!noImages && !!marker.images?.length) {
			const section = document.createElement('section');
			for (const asset of marker.images) {
				const btn = document.createElement('button');
				btn.title = getTitle(asset) ?? '';
				if (galleryEnabled) btn.addEventListener('click', () => openGallery(asset.micrioId));
				btn.disabled = !galleryEnabled;

				const figure = document.createElement('figure');
				const img = document.createElement('img');
				img.alt = getTitle(asset) ?? '';
				img.src = asset.micrioId
					? `https://iiif.${isDev ? 'micrio.dev' : 'micr.io'}/${asset.micrioId}/full/${singleImage ? '^' + Math.min(asset.width, 640) + ',' : '^,320'}/0/default.webp`
					: asset.src;
				figure.appendChild(img);

				if (imageCaption) {
					const figcap = document.createElement('figcaption');
					figcap.textContent = imageCaption;
					figure.appendChild(figcap);
				}
				btn.appendChild(figure);
				section.appendChild(btn);
			}
			this.appendChild(section);
		}

		// Embed
		if (content.embedUrl && !noEmbed) {
			if (!content.audio && marker.videoTour) {
				const hiddenMedia = document.createElement('micrio-media') as MicrioElement;
				hiddenMedia.setProps({
					image, className: 'hidden', uuid: marker.id,
					tour: marker.videoTour, autoplay: autoplayMedia, secondary: true
				});
				this.appendChild(hiddenMedia);
			}

			const pausedVideo = marker?.embedAutoPlay === false || (!autoplayMedia || !!(content?.audio && marker?.audioAutoPlay));
			const media = document.createElement('micrio-media') as MicrioElement;
			media.setProps({
				image, src: content.embedUrl, uuid: marker.id,
				width: 400, height: 240, controls: true,
				title: content.embedTitle, figcaption: content.embedDescription,
				autoplay: !pausedVideo, onended: mediaEnded, paused: pausedVideo
			});
			this.appendChild(media);
		}

		// Primary Body (not first)
		if (content.body && !settings.primaryBodyFirst) {
			const article = document.createElement('micrio-article') as MicrioElement;
			article.setProps({ html: content.body });
			this.appendChild(article);
		}

		// Secondary Body
		if (content.bodySecondary) {
			const article = document.createElement('micrio-article') as MicrioElement;
			article.setProps({ html: content.bodySecondary });
			this.appendChild(article);
		}
	}

	onDestroy() {
		for (const fn of this.#unsubs) fn();
		this.#unsubs = [];
	}
}

customElements.define(MicrioMarkerContent.tag, MicrioMarkerContent);
