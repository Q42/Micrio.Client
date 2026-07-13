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
	static styles = `micrio-popover{position:fixed;top:0;left:0;width:100%;height:100%;z-index:100;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.5)}
micrio-popover>div{background:var(--micrio-background);color:var(--micrio-color);border-radius:var(--micrio-border-radius);padding:24px;max-width:600px;width:90%;max-height:80vh;overflow-y:auto;position:relative}
micrio-popover .close{position:absolute;top:8px;right:8px}`;

	#props: PopoverProps = { popover: null! };
	#unsubs: (() => void)[] = [];

	onMount() {
		const micrio = this.inject<HTMLMicrioElement>('micrio');
		if (!micrio) return;
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

		this.replaceChildren();

		const bg = document.createElement('div');
		bg.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:-1';
		this.appendChild(bg);

		const container = document.createElement('div');

		const closeBtn = document.createElement('micrio-button') as any;
		closeBtn.setProps({
			type: 'close', title: $i18n.close, className: 'close',
			onclick: () => micrio.state.popover.set(undefined)
		});
		container.appendChild(closeBtn);

		bg.addEventListener('click', () => micrio.state.popover.set(undefined));

		if ('contentPage' in p && p.contentPage) {
			const page = p.contentPage;
			const cd = (page as any).i18n?.[$_lang];
			if (cd?.title) {
				const h1 = document.createElement('h1');
				h1.textContent = cd.title;
				h1.style.cssText = 'margin:0 0 16px;font-size:1.5em';
				container.appendChild(h1);
			}
			if (cd?.content) {
				const article = document.createElement('micrio-article') as any;
				article.setProps({ html: cd.content });
				container.appendChild(article);
			}
		}

		if ('marker' in p && p.marker) {
			const mc = document.createElement('micrio-marker-content') as any;
			mc.setProps({ marker: p.marker });
			container.appendChild(mc);
		}

		this.appendChild(container);
	}

	onDestroy() {
		for (const fn of this.#unsubs) fn();
		this.#unsubs = [];
	}
}

customElements.define(MicrioPopover.tag, MicrioPopover);
