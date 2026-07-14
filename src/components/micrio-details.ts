import { MicrioElement } from '$ts/component';
import type { Models } from '$types/models';
import type { HTMLMicrioElement } from '$ts/element';
import { get } from '$ts/store';
import { i18n } from '$ts/i18n/strings';

function getLength(length: number): string {
	let unit = 'cm';
	if (length >= 1e5) { unit = 'km'; length /= 1e5; }
	else if (length >= 100) { unit = 'm'; length /= 100; }
	else if (length < 1 / 1e6) { unit = 'nm'; length *= 1e7; }
	else if (length < 1 / 1e3) { unit = 'µm'; length *= 1e4; }
	else if (length < 1) { unit = 'mm'; length *= 10; }
	return length.toFixed(2) + ' ' + unit;
}

export interface DetailsProps {
	info: Models.ImageInfo.ImageInfo;
	data: Models.ImageData.ImageData;
}

export class MicrioDetails extends MicrioElement<DetailsProps> {
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

	#detailsEl!: HTMLDetailsElement;
	#unsubs: (() => void)[] = [];

	onMount() {
		const micrio = this.inject<HTMLMicrioElement>('micrio');
		if (!micrio) return;

		this.#detailsEl = document.createElement('details');
		this.#detailsEl.ontoggle = () => this.#toggleClose();
		this.appendChild(this.#detailsEl);

		this.#render();
	}

	setProps(props: Partial<DetailsProps>) {
		if (props.info !== undefined) this._props.info = props.info;
		if (props.data !== undefined) this._props.data = props.data;
		if (this.isConnected) this.#render();
	}

	#render() {
		const info = this._props.info;
		const data = this._props.data;
		const micrio = this.inject<HTMLMicrioElement>('micrio');
		const $_lang = micrio ? get(micrio._lang) : undefined;
		const $current = micrio ? get(micrio.current) : undefined;
		if (!info || !$_lang || !$current) return;

		const cData = data?.i18n ? (data.i18n as any)[$_lang] : data as any;
		const title = cData?.title ?? info.title ?? '';
		const description = cData?.description;
		const link = cData?.sourceUrl;
		const copyright = cData?.copyright;
		const cmWidth = $current.$settings?.cmWidth;
		const cmHeight = $current.$settings?.cmHeight;
		const size = cmWidth && cmHeight ? getLength(cmWidth) + ' x ' + getLength(cmHeight) : null;

		if (!title && !description && !link) return;

		this.#detailsEl.replaceChildren();

		if (title || size) {
			const summary = document.createElement('summary');
			if (title) {
				const cite = document.createElement('cite');
				cite.textContent = title;
				summary.appendChild(cite);
			}
			if (size) {
				const small = document.createElement('small');
				small.textContent = size;
				summary.appendChild(small);
			}
			this.#detailsEl.appendChild(summary);
		}

		if (description) {
			const div = document.createElement('div');
			div.innerHTML = description;
			this.#detailsEl.appendChild(div);
		}

		if (link) {
			const p = document.createElement('p');
			const a = document.createElement('a');
			a.href = link;
			a.target = '_blank';
			a.rel = 'noopener noreferrer';
			a.textContent = copyright || link;
			p.appendChild(a);
			this.#detailsEl.appendChild(p);
		}

	}

	#toggleClose() {
		const existing = this.#detailsEl.querySelector(':scope > micrio-button');
		if (this.#detailsEl.open) {
			if (existing) return;
			const closeBtn = document.createElement('micrio-button') as MicrioElement;
			closeBtn.setProps({
				type: 'close', title: get(i18n).close, className: 'close',
				onclick: () => { this.#detailsEl.open = false; }
			});
			this.#detailsEl.appendChild(closeBtn);
		} else {
			existing?.remove();
		}
	}

	onDestroy() {
		for (const fn of this.#unsubs) fn();
		this.#unsubs = [];
	}
}

customElements.define(MicrioDetails.tag, MicrioDetails);
