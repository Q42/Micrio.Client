import { MicrioElement } from '$core/component';
import type { Models } from '$types/models';
import { get } from '$core/store';
import { createElement } from '$utils/dom';
import { i18n } from '$core/i18n/strings';

export interface DetailsProps {
	info: Models.ImageInfo.ImageInfo;
	data: Models.ImageData.ImageData;
}
import './details.css';

class MicrioDetails extends MicrioElement<DetailsProps> {
	static tag = 'micrio-details';

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
				children: [createElement('span', { textContent: title })],
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
					type: 'close', title: get(i18n).close,
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
