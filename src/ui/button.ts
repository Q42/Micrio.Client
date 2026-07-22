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

class MicrioButton extends MicrioElement<ButtonProps> {
	static tag = 'micrio-button';
	static styles = `.micrio-button {
	margin: 0;
	padding: 0 8px;
	cursor: pointer;
	box-sizing: border-box;
	display: flex;
	align-items: center;
	justify-content: center;
	transition: opacity .25s ease;
	font: inherit;
	font-size: 90%;
	position: relative;
	touch-action: none;
	color: var(--micrio-color);
	background: var(--micrio-button-background, var(--micrio-background, none)) center center no-repeat;
	background-size: 24px;
	min-width: var(--micrio-button-size);
	height: var(--micrio-button-size);
	border: none;
	border-radius: var(--micrio-border-radius);
	box-shadow: var(--micrio-button-shadow);
	backdrop-filter: var(--micrio-background-filter);
	text-decoration: none;
}
.micrio-button:hover {
	outline: none;
}
.micrio-button.transparent,.micrio-button.transparent:hover {
	background-color: transparent;
	backdrop-filter: none;
}
.micrio-button>* {
	transition: opacity .25s ease;
}
.micrio-button:disabled {
	pointer-events: none;
	cursor: default;
}
.micrio-button:disabled>* {
	opacity: .4;
}
.micrio-button.no-click {
	pointer-events: none;
}
.micrio-button img {
	pointer-events: none;
	max-width: 100%;
	max-height: 100%;
}
.micrio-button>* {
	height: var(--micrio-icon-size)!important;
	width: var(--micrio-icon-size);
	font-size: var(--micrio-icon-size);
	fill: var(--micrio-color);
}
.micrio-button.active {
	color: var(--micrio-color-hover);
}
.micrio-button.active svg {
	fill: var(--micrio-color-hover);
}
@media (hover: hover) {
	.micrio-button:hover,.micrio-button:focus {
		background-color: var(--micrio-button-background-hover, var(--micrio-button-background, var(--micrio-background)));
		color: var(--micrio-color-hover);
		position: relative;
		z-index: 1;
	}
	.micrio-button:hover svg,.micrio-button:focus svg {
		fill: var(--micrio-color-hover);
		stroke: var(--micrio-color-hover);
	}
	.micrio-button:focus {
		outline: 1px solid var(--micrio-color-hover);
	}
}`;

	#rootEl!: HTMLElement;

	protected _render() {
		const p = this._props;
		const isAnchor = !!p.href;
		const tag = isAnchor ? 'a' : 'button';
		const classes = `micrio-button${p.type ? ' ' + p.type : ''}${p.className ? ' ' + p.className : ''}${p.active ? ' active' : ''}${p.noClick ? ' no-click' : ''}`;

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
