import { MicrioElement } from '$core/component';
import type { IconName } from '$types/icon-name';
import type { Models } from '$types/models';
import { createElement } from '$utils/dom';

export interface ButtonProps {
	type?: IconName;
	icon?: Models.Assets.Image;
	title?: string | null;
	disabled?: boolean;
	active?: boolean;
	className?: string;
	href?: string;
	blankTarget?: boolean;
	noClick?: boolean;
	onclick?: (e: Event) => void;
	onfocus?: (e: Event) => void;
	onpointerdown?: (e: PointerEvent) => void;
}
import './button.css';

class MicrioButton extends MicrioElement<ButtonProps> {
	static tag = 'micrio-button';

	#rootEl!: HTMLElement;
	#prevType?: string;

	protected _render() {
		const p = this._props;
		const isAnchor = !!p.href;
		const tag = isAnchor ? 'a' : 'button';
		const classes = `${p.className ? p.className + ' ' : ''}${p.active ? 'active' : ''}${p.noClick ? ' no-click' : ''}`.trim();

		if (this.#prevType) this.classList.remove(this.#prevType);
		if (p.type) this.classList.add(p.type);
		this.#prevType = p.type;

		if (this.#rootEl) this.#rootEl.remove();

		const attrs: Record<string, string | null> = {
			title: p.title ?? '',
			'aria-label': p.title ?? '',
		};
		if (isAnchor) {
			attrs.href = p.href!;
			if (p.blankTarget) attrs.target = '_blank';
		}

		const el = createElement(tag, {
			className: classes,
			attrs,
			props: { disabled: isAnchor ? undefined : !!p.disabled },
			events: {
				...(p.onclick && { click: p.onclick }),
				...(p.onfocus && { focus: p.onfocus }),
				...(p.onpointerdown && { pointerdown: p.onpointerdown as EventListener }),
			},
			parent: this,
		});
		this.#rootEl = el;

		if (p.type)
			createElement('micrio-icon', { attrs: { name: p.type }, parent: el });
		else if (p.icon)
			createElement('img', { props: { src: p.icon.src, alt: 'Icon' }, parent: el });

		const textNodes: string[] = [];
		for (const child of this.childNodes) {
			if (child !== el && (child.nodeType === Node.TEXT_NODE || child.nodeType === Node.ELEMENT_NODE)) {
				textNodes.push(child.textContent ?? '');
				child.remove();
			}
		}
		const text = textNodes.join('').trim();
		if (text)
			createElement('span', { className: 'micrio-button-text', textContent: text, parent: el });
	}
}

customElements.define(MicrioButton.tag, MicrioButton);
