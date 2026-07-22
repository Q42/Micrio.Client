import { MicrioElement } from '$core/component';
import type { Models } from '$types/models';
import { get } from '$core/store';
import { createElement } from '$utils/dom';
import { i18n } from '$core/i18n/strings';

export interface DetailsProps {
	info: Models.ImageInfo.ImageInfo;
	data: Models.ImageData.ImageData;
}

class MicrioDetails extends MicrioElement<DetailsProps> {
	static tag = 'micrio-details';
	static styles = `micrio-details{position:absolute;bottom:var(--micrio-border-margin);left:var(--micrio-border-margin);padding:var(--micrio-popup-padding);font-size:.9em;max-width:410px;user-select:text;white-space:normal;box-sizing:border-box;color:var(--micrio-color);background:var(--micrio-background);backdrop-filter:var(--micrio-background-filter);box-shadow:var(--micrio-popup-shadow);border-radius:var(--micrio-border-radius);transition:all .5s ease}
micrio-details details{display:block}
micrio-details summary{cursor:pointer;list-style:none}
micrio-details summary::-webkit-details-marker{display:none}
micrio-details small{display:block;font-style:italic;font-weight:400}
micrio-details>*{margin:0;overflow:hidden;text-overflow:ellipsis}
micrio-details a{color:var(--micrio-color-hover,inherit)}
micrio-details .close{position:absolute;top:0;left:calc(100% + 8px)}
@media(max-width:600px){micrio-details{max-width:calc(100% - 10px)}
micrio-details details:not([open]) cite{display:none}
micrio-details details:not([open]) summary::marker,micrio-details details:not([open]) summary::-webkit-details-marker{display:inline-block;content:'?';font-size:20px;font-weight:700;line-height:20px;margin-right:5px}
micrio-details .close{position:absolute;top:auto;left:auto;right:0;bottom:calc(100% + 8px)}
}`;

	#props: Partial<DetailsProps> = {};
	#detailsEl!: HTMLDetailsElement;

	onMount() {
		const micrio = this.getMicrio();
		if (!micrio) return;

		this.#detailsEl = createElement('details', {
			events: { toggle: () => this.#toggleClose() },
			parent: this
		});

		this.#render();
	}

	setProps(props: Partial<DetailsProps>) {
		if (props.info !== undefined) this.#props.info = props.info;
		if (props.data !== undefined) this.#props.data = props.data;
		if (this.isConnected) this.#render();
	}

	#render() {
		const info = this.#props.info;
		const data = this.#props.data;
		const micrio = this.getMicrio();
		const $_lang = micrio ? get(micrio._lang) : undefined;
		const $current = micrio ? get(micrio.current) : undefined;
		if (!info || !$_lang || !$current) return;

		const cData = data?.i18n ? data.i18n[$_lang] : data as unknown as Models.ImageData.ImageDetailsCultureData;
		const title = cData?.title ?? info.title ?? '';
		const description = cData?.description;
		const link = cData?.sourceUrl;
		const copyright = cData?.copyright;
		if (!title && !description && !link) return;

		this.#detailsEl.replaceChildren();

		if (title) {
			createElement('summary', {
				children: [createElement('cite', { textContent: title })],
				parent: this.#detailsEl,
			});
		}

		if (description) {
			createElement('div', { innerHTML: description, parent: this.#detailsEl });
		}

		if (link) {
			createElement('p', {
				parent: this.#detailsEl,
				children: [
					createElement('a', {
						props: { href: link, target: '_blank', rel: 'noopener noreferrer' },
						textContent: copyright || link
					})
				]
			});
		}

	}

	#toggleClose() {
		const existing = this.#detailsEl.querySelector(':scope > micrio-button');
		if (this.#detailsEl.open) {
			if (existing) return;
			createElement('micrio-button', {
				setProps: {
					type: 'close', title: get(i18n).close, className: 'close',
					onclick: () => { this.#detailsEl.open = false; }
				},
				parent: this.#detailsEl
			});
		} else {
			existing?.remove();
		}
	}

}

customElements.define(MicrioDetails.tag, MicrioDetails);
