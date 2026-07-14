import { MicrioElement } from '$ts/component';
import type { Models } from '$types/models';
import type { HTMLMicrioElement } from '$ts/element';
import { get } from '$ts/store';
import { i18n } from '$ts/i18n/strings';
import './micrio-button';
import './micrio-article';
import './micrio-marker-content';

export interface PopoverProps {
	popover: Models.State.PopoverType;
}

export class MicrioPopover extends MicrioElement<PopoverProps> {
	static tag = 'micrio-popover';
	static styles = `micrio-popover{display:contents}
dialog::backdrop{color:#fff;animation:micrio-popover-bg .2s forwards;backdrop-filter:blur(8px)}
@keyframes micrio-popover-bg{from{background:#0000}to{background:var(--micrio-popover-background)}}
dialog{animation:micrio-popover-fade .5s forwards;background:transparent;border:none;overflow:visible;padding:0;pointer-events:all;max-width:90vw;max-height:90vh}
@keyframes micrio-popover-fade{from{opacity:0}to{opacity:1}}
.close{position:absolute;top:8px;right:8px;z-index:1}
dialog.article{width:540px}
dialog.article article{text-shadow:none;color:var(--micrio-color);background:var(--micrio-background);padding:20px;box-sizing:border-box;max-height:calc(90cqh - 48px);max-height:calc(90vh - 48px);overflow-x:hidden;overflow-y:auto;border-radius:var(--micrio-border-radius)}
dialog.article h2{text-align:center}`;

	#props: PopoverProps = { popover: null! };
	#unsubs: (() => void)[] = [];
	#dialog!: HTMLDialogElement;

	onMount() {
		const micrio = this.inject<HTMLMicrioElement>('micrio');
		if (!micrio) return;

		this.#dialog = document.createElement('dialog');
		this.#dialog.addEventListener('close', () => micrio.state.popover.set(undefined));
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
		const micrio = this.inject<HTMLMicrioElement>('micrio');
		if (!micrio || !p) return;

		const $_lang = get(micrio._lang);
		const $i18n = get(i18n);

		const pageId = 'contentPage' in p ? p.contentPage?.id : '';
		const markerId = 'marker' in p ? p.marker?.id : '';
		const key = `${p?.constructor?.name ?? typeof p}::${pageId}::${markerId}::${$_lang}`;
		if (!this.checkRenderKey(key)) return;

		this.#dialog.replaceChildren();
		this.#dialog.classList.remove('article');

		const closeBtn = document.createElement('micrio-button') as MicrioElement;
		closeBtn.setProps({
			type: 'close', title: $i18n.close, className: 'close',
			onclick: () => {
				if (this.#dialog?.open) this.#dialog.close();
			}
		});
		this.#dialog.appendChild(closeBtn);

		if ('contentPage' in p && p.contentPage) {
			const page = p.contentPage;
			const cd = page.i18n?.[$_lang];
			this.#dialog.classList.add('article');

			const article = document.createElement('article');
			if (cd?.title) {
				const h2 = document.createElement('h2');
				h2.textContent = cd.title;
				article.appendChild(h2);
			}
			if (cd?.content) {
				const div = document.createElement('div');
				div.innerHTML = cd.content;
				article.appendChild(div);
			}
			this.#dialog.appendChild(article);
		}

		if ('marker' in p && p.marker) {
			const mc = document.createElement('micrio-marker-content') as MicrioElement;
			mc.setProps({ marker: p.marker });
			this.#dialog.appendChild(mc);
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
