import { MicrioElement } from '$core/component';
import type { Models } from '$types/models';
import { get } from '$core/store';
import { i18n } from '$core/i18n/strings';
import '$ui/button';
import './article';
import '$media/media';
import '$markers/marker-content';
import '$gallery/swipe-gallery';

export interface PopoverProps {
	popover: Models.State.PopoverType;
}

export class MicrioPopover extends MicrioElement<PopoverProps> {
	static tag = 'micrio-popover';
	static styles = `micrio-popover{display:contents}
dialog::backdrop{color:#fff;animation:micrio-popover-bg .2s forwards;backdrop-filter:blur(8px)}
@keyframes micrio-popover-bg{from{background:#0000}to{background:var(--micrio-popover-background)}}
dialog{position:relative;animation:micrio-popover-fade .5s forwards;background:transparent;border:none;overflow:visible;padding:0;pointer-events:all;max-width:90vw;max-height:90vh}
@keyframes micrio-popover-fade{from{opacity:0}to{opacity:1}}
dialog>aside{--micrio-background-filter:none;position:absolute;z-index:1}
dialog:not(.article){display:flex}
@media(min-width:640px){
dialog:not(.article){width:calc(85vw - 56px);height:calc(9/16*85vw);width:calc(85cqw - 56px);height:calc(9/16*85cqw)}
dialog>aside{display:block;left:100%;margin-left:var(--micrio-border-margin);top:0}
}
@media(max-width:639px){
dialog:not(.article){width:100%;height:100%;flex-direction:column}
dialog>aside{position:fixed;top:var(--micrio-border-margin);right:var(--micrio-border-margin)}
dialog :global(div.micrio-media>*:first-child){border-radius:0}
}
@media(min-aspect-ratio:16/9){dialog:not(.article){height:75vh;width:calc(16/9*75vh);height:75cqh;width:calc(16/9*75cqh)}}
dialog:not(.article)>micrio-media{flex:1}
dialog:not(.article)>micrio-media>figure{height:100%}
dialog:not(.article)>micrio-media>figure iframe,
dialog:not(.article)>micrio-media>figure video{height:calc(100% - var(--micrio-button-size))}
dialog>micrio-marker-content{width:25vw;width:25cqw;min-width:unset;max-width:320px}
dialog.article{width:540px}
dialog.article article{text-shadow:none;color:var(--micrio-color);background:var(--micrio-background);padding:20px;box-sizing:border-box;max-height:calc(90cqh - 48px);max-height:calc(90vh - 48px);overflow-x:hidden;overflow-y:auto;border-radius:var(--micrio-border-radius)}
dialog.article h2{text-align:center}
dialog.gallery>aside{left:auto;right:var(--micrio-border-margin);top:var(--micrio-border-margin);margin-left:0}
dialog.gallery{width:100%;height:100%;max-width:unset;max-height:unset}`;

	#props: PopoverProps = { popover: null! };
	#unsubs: (() => void)[] = [];
	#dialog!: HTMLDialogElement;

	onMount() {
		const micrio = this.getMicrio();
		if (!micrio) return;

		this.#dialog = document.createElement('dialog');
		this.#dialog.addEventListener('close', () => {
			const p = this.#props.popover;
			if (p && 'marker' in p && p.marker && p.image?.state?.marker) {
				p.image.state.marker.set(undefined);
			}
			micrio.state.popover.set(undefined);
		});
		this.#dialog.addEventListener('click', (e) => {
			if (e.target === this.#dialog) micrio.state.popover.set(undefined);
		});
		this.appendChild(this.#dialog);

		this.#render();
	}

	setProps(props: Partial<PopoverProps>) {
		if (props.popover !== undefined) this.#props.popover = props.popover;
		if (this.isConnected) this.#render();
	}

	#render() {
		const p = this.#props.popover;
		const micrio = this.getMicrio();
		if (!micrio || !p) return;

		const $_lang = get(micrio._lang);
		const $i18n = get(i18n);

		const pageId = 'contentPage' in p ? p.contentPage?.id : '';
		const markerId = 'marker' in p ? p.marker?.id : '';
		const key = `${p?.constructor?.name ?? typeof p}::${pageId}::${markerId}::${$_lang}`;
		if (!this.checkRenderKey(key)) return;

		this.#dialog.replaceChildren();
		this.#dialog.classList.remove('article', 'page', 'has-media', 'gallery');

		const marker = 'marker' in p ? p.marker : undefined;
		const markerTour = 'markerTour' in p ? p.markerTour : undefined;
		const isPartOfTour = !!(marker && markerTour && 'steps' in markerTour &&
			(markerTour as Models.ImageData.MarkerTour).steps?.findIndex((s: string) => s.startsWith(marker.id)) >= 0);
		const isLastStep = isPartOfTour ? (markerTour as Models.ImageData.MarkerTour).currentStep == (markerTour as Models.ImageData.MarkerTour).steps.length - 1 : true;

		const advanceOrClose = (e?: Event) => {
			if (isPartOfTour && markerTour && 'steps' in markerTour) {
				const mt = markerTour as Models.ImageData.MarkerTour & { next?(): void };
				if (e instanceof Event && isLastStep) {
					micrio.state.tour.set(undefined);
				} else {
					mt.next?.();
				}
			}
			if (this.#dialog?.open) this.#dialog.close();
		};

		const aside = document.createElement('aside');
		const closeBtn = document.createElement('micrio-button') as MicrioElement;
		closeBtn.setProps({
			type: (!isPartOfTour || isLastStep) ? 'close' : 'arrow-right',
			title: (!isPartOfTour || isLastStep) ? $i18n.closeMarker : $i18n.tourStepNext,
			className: 'close-popover',
			onclick: advanceOrClose
		});
		aside.appendChild(closeBtn);
		this.#dialog.appendChild(aside);

		if ('contentPage' in p && p.contentPage) {
			const page = p.contentPage;
			const cd = page.i18n?.[$_lang];
			this.#dialog.classList.add('page');

			const isVideoPage = cd?.embed && (!cd.content || cd.content.length < 250) && !page.image && !page.buttons?.length;
			const hasMedia = !!cd?.embed || !!page.image;

			if (hasMedia) this.#dialog.classList.add('has-media');

			if (isVideoPage) {
				if (cd.embed) {
					const media = document.createElement('micrio-media') as MicrioElement;
					media.setProps({ src: cd.embed, figcaption: cd.content, controls: true, autoplay: true });
					this.#dialog.appendChild(media);
				}
			} else {
				this.#dialog.classList.add('article');
				const article = document.createElement('article');
				if (cd?.title) {
					const h2 = document.createElement('h2');
					h2.textContent = cd.title;
					article.appendChild(h2);
				}
				if (cd?.embed) {
					const media = document.createElement('micrio-media') as MicrioElement;
					media.setProps({ src: cd.embed, controls: true });
					article.appendChild(media);
				}
				if (cd?.content) {
					const div = document.createElement('div');
					div.innerHTML = cd.content;
					article.appendChild(div);
				}
				this.#dialog.appendChild(article);
			}
		}

		if ('gallery' in p && p.gallery?.length) {
			this.#dialog.classList.add('gallery');
			const el = document.createElement('micrio-swipe-gallery') as MicrioElement;
			el.setProps({ gallery: p.gallery, galleryStart: p.galleryStart, lang: $_lang });
			this.#dialog.appendChild(el);
		}

		if ('marker' in p && p.marker) {
			const marker = p.marker;
			const content = marker.i18n?.[$_lang];
			const hasImages = !!marker.images?.length;
			const hasPopoverContent = !!(content && content.body) || (hasImages && !!(p.contentPage?.i18n?.[$_lang]?.embed));

			if (content?.embedUrl) {
				const media = document.createElement('micrio-media') as MicrioElement;
				media.setProps({
					src: content.embedUrl, uuid: marker.id,
					figcaption: content.embedDescription,
					controls: true, autoplay: marker.embedAutoPlay
				});
				this.#dialog.appendChild(media);
			} else if (hasImages) {
				const el = document.createElement('micrio-swipe-gallery') as MicrioElement;
				el.setProps({ gallery: marker.images, lang: $_lang });
				this.#dialog.appendChild(el);
			}

			if (hasPopoverContent) {
				const mc = document.createElement('micrio-marker-content') as MicrioElement;
				mc.setProps({
					marker,
					noEmbed: true,
					noGallery: true,
					noImages: !content || !content.embedUrl,
					onclose: advanceOrClose
				});
				this.#dialog.appendChild(mc);
			}
		}

		if (!this.#dialog.open) this.#dialog.showModal();
	}

	onDestroy() {
		if (this.#dialog?.open) this.#dialog.close();
		for (const fn of this.#unsubs) fn();
		this.#unsubs = [];
	}
}

customElements.define(MicrioPopover.tag, MicrioPopover);
