import { MicrioElement } from '$ts/component';
import type { Models } from '$types/models';
import { get } from '$ts/store';
import { i18n } from '$ts/i18n/strings';

export interface DetailsProps {
	info: Models.ImageInfo.ImageInfo;
	data: Models.ImageData.ImageData;
}

export class MicrioDetails extends MicrioElement<DetailsProps> {
	static tag = 'micrio-details';
	static styles = `micrio-details{position:absolute;bottom:calc(var(--micrio-border-margin) + var(--micrio-button-size) + 16px);right:var(--micrio-border-margin);z-index:3;max-width:400px;min-width:200px;background:var(--micrio-background);backdrop-filter:var(--micrio-background-filter);border-radius:var(--micrio-border-radius);padding:12px;box-shadow:var(--micrio-button-shadow);pointer-events:all}
micrio-details[open]{display:block}
micrio-details h1{margin:0 0 8px;font-size:1.1em;line-height:1.3;padding-right:24px}
micrio-details p{margin:0 0 4px;font-size:.8em;opacity:.7;line-height:1.4}
micrio-details .close{position:absolute;top:4px;right:4px}`;

	onMount() {
		this.#render();
	}

	setProps(props: Partial<DetailsProps>) {
		if (props.info !== undefined) this._props.info = props.info as any;
		if (this.isConnected) this.#render();
	}

	#render() {
		const info = (this._props as any).info as Models.ImageInfo.ImageInfo | undefined;
		if (!info) return;
		const $i18n = get(i18n);

		this.replaceChildren();
		const h1 = document.createElement('h1');
		h1.textContent = info.title || '';
		this.appendChild(h1);

		if ((info as any).description) {
			const p = document.createElement('p');
			p.textContent = (info as any).description;
			this.appendChild(p);
		}

		const closeBtn = document.createElement('micrio-button') as any;
		closeBtn.setProps({ type: 'close', title: $i18n.close, className: 'close',
			onclick: () => { (this as unknown as HTMLElement).style.display = 'none'; }
		});
		this.appendChild(closeBtn);
	}
}

customElements.define(MicrioDetails.tag, MicrioDetails);
