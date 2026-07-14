import { MicrioElement } from '$ts/component';
import type { HTMLMicrioElement } from '$ts/element';
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
	static styles = `micrio-marker-content main{position:relative;padding:var(--micrio-popup-padding);padding-bottom:0;overflow-y:auto;user-select:text;color:var(--micrio-color);background:var(--micrio-background);backdrop-filter:var(--micrio-background-filter);box-shadow:var(--micrio-popup-shadow);border-radius:var(--micrio-border-radius);box-sizing:border-box;text-align:var(--micrio-text-align)}
micrio-marker-content main>*{--micrio-button-background:none;--micrio-background-filter:none;--micrio-button-shadow:none}
micrio-marker-content main .micrio-progress-bar.container{background:transparent;backdrop-filter:none}
micrio-marker-content main h1{font-size:1.5em;font-weight:600;margin:0 0 1.25em 0}
micrio-marker-content main p{white-space:pre-line}
micrio-marker-content main figure.hidden{display:none}
micrio-marker-content main figure>div.micrio-media>*:first-child{width:100%}
micrio-marker-content main figure.micrio-media{margin:calc(-1 * var(--micrio-popup-padding));margin-bottom:0;width:auto;--micrio-background:transparent}
micrio-marker-content main figure.micrio-media:not(.media-video):not(:last-child)>*:last-child:not(figcaption){margin-bottom:var(--micrio-popup-padding);background:var(--micrio-background);padding:0 var(--micrio-popup-padding)}
micrio-marker-content main figure.micrio-media.media-video{margin-bottom:var(--micrio-popup-padding)}
micrio-marker-content main figure.micrio-media>div>aside.micrio-media{--micrio-background:transparent}
micrio-marker-content main article:last-child{margin-bottom:var(--micrio-popup-padding)}
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
	_content: HTMLElement | undefined;
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

		const micrio = this.inject<HTMLMicrioElement>('micrio');
		const markerImages = MicrioElement.markerImages as Map<string, MicrioImage>;
		const image = marker.id ? markerImages.get(marker.id) as MicrioImage : undefined;
		if (!micrio || !image) return;

		const $_lang = get(micrio._lang);
		const key = `${marker.id}::${$_lang}::${noEmbed}::${noImages}::${noGallery}`;
		if (!this.checkRenderKey(key)) return;

		const $tour = get(micrio.state.tour);
		const isSerialTour = $tour && 'steps' in $tour && ($tour as any).isSerialTour;
		const settings = image.$settings._markers ?? {};
		const content = (marker as any).i18n?.[$_lang];
		const singleImage = marker.images?.length == 1;
		const galleryEnabled = !marker.data?.preventImageOpen && !noGallery;
		void onclose; // used by micrio-media (TODO)
		const isDev = image.tileBase?.includes('micrio.dev');

		const imageCaption = singleImage && marker.images?.[0]?.i18n?.[$_lang]?.description;

		const openGallery = (startId: string | undefined) => {
			if (!galleryEnabled) return;
			micrio.state.popover.set({ gallery: marker.images, galleryStart: startId, image } as any);
		};

		const getTitle = (asset: Models.Assets.Image) => (asset as any).i18n?.[$_lang]?.title;

		if (!content) { this.innerHTML = ''; return; }

		this.replaceChildren();

		const main = document.createElement('main');
		main.className = '';
		this._content = main;

		// Title
		if (content.title) {
			const h1 = document.createElement('h1');
			h1.textContent = content.title;
			this._title = h1;
			main.appendChild(h1);
		}

		// Primary Body (first)
		if (content.body && settings.primaryBodyFirst) {
			const article = document.createElement('micrio-article') as any;
			article.setProps({ html: content.body });
			main.appendChild(article);
		}

		// Audio/Video Tour media
		if (!isSerialTour && (((!content || !content.embedUrl) && (marker as any).videoTour) || (content && content.audio))) {
			// TODO: Render <micrio-media> when migrated
			// const media = document.createElement('micrio-media') as any;
			// media.setProps({ src: audioSrc, noPlayOverlay: true, image, uuid: marker.id,
			//   tour: marker.videoTour, autoplay: marker.audioAutoPlay || (!content.audio && !!marker.videoTour),
			//   controls: !marker.videoTour || (!content || !content.embedUrl),
			//   onended: mediaEnded, paused: pausedAudio });
			// main.appendChild(media);
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
			main.appendChild(section);
		}

		// Embed
		if (content.embedUrl && !noEmbed) {
			if (!content.audio && (marker as any).videoTour) {
				// TODO: hidden secondary Media for video tour audio
			}
			// TODO: main embed Media
		}

		// Primary Body (not first)
		if (content.body && !settings.primaryBodyFirst) {
			const article = document.createElement('micrio-article') as any;
			article.setProps({ html: content.body });
			main.appendChild(article);
		}

		// Secondary Body
		if (content.bodySecondary) {
			const article = document.createElement('micrio-article') as any;
			article.setProps({ html: content.bodySecondary });
			(main as any).appendChild(article);
		}

		this.appendChild(main);
	}

	onDestroy() {
		for (const fn of this.#unsubs) fn();
		this.#unsubs = [];
	}
}

customElements.define(MicrioMarkerContent.tag, MicrioMarkerContent);
