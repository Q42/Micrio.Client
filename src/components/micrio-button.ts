import { MicrioElement } from '$ts/component';
import type { IconName } from './micrio-icon';
import type { Models } from '$types/models';

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

export class MicrioButton extends MicrioElement<ButtonProps> {
	static tag = 'micrio-button';
	static styles = `micrio-button{display:contents}
.micrio-button{margin:0;padding:0 8px;cursor:pointer;box-sizing:border-box;display:flex;align-items:center;justify-content:center;transition:opacity .25s ease;font:inherit;font-size:90%;position:relative;touch-action:none;color:var(--micrio-color);background:var(--micrio-button-background,var(--micrio-background,none)) center center no-repeat;background-size:24px;min-width:var(--micrio-button-size);height:var(--micrio-button-size);border:none;border-radius:var(--micrio-border-radius);box-shadow:var(--micrio-button-shadow);backdrop-filter:var(--micrio-background-filter);text-decoration:none}
.micrio-button:hover{outline:none}
.micrio-button.transparent,.micrio-button.transparent:hover{background-color:transparent;backdrop-filter:none}
.micrio-button>*{transition:opacity .25s ease}
.micrio-button:disabled{pointer-events:none;cursor:default}
.micrio-button:disabled>*{opacity:.4}
.micrio-button.no-click{pointer-events:none}
.micrio-button img{pointer-events:none;max-width:100%;max-height:100%}
.micrio-button>*{height:var(--micrio-icon-size)!important;width:var(--micrio-icon-size);font-size:var(--micrio-icon-size);fill:var(--micrio-color)}
.micrio-button.active{color:var(--micrio-color-hover)}
.micrio-button.active svg{fill:var(--micrio-color-hover)}
@media(hover:hover){.micrio-button:hover,.micrio-button:focus{background-color:var(--micrio-button-background-hover,var(--micrio-button-background,var(--micrio-background)));color:var(--micrio-color-hover);position:relative;z-index:1}
.micrio-button:hover svg,.micrio-button:focus svg{fill:var(--micrio-color-hover);stroke:var(--micrio-color-hover)}
.micrio-button:focus{outline:1px solid var(--micrio-color-hover)}
}`;

	#props: ButtonProps = {};
	#rootEl!: HTMLElement;
	#listeners: (() => void)[] = [];
	#clickHandler: ((e: Event) => void) | null = null;

	onMount() {
		this.#render();
	}

	setProps(props: Partial<ButtonProps>) {
		Object.assign(this.#props, props);
		if (this.isConnected) this.#render();
	}

	onDestroy() {
		for (const unsub of this.#listeners) unsub();
		this.#listeners = [];
	}

	#render() {
		const p = this.#props;
		const isAnchor = !!p.href;

		let el = this.#rootEl;
		const tag = isAnchor ? 'a' : 'button';
		if (!el || el.tagName.toLowerCase() !== tag) {
			if (el) el.remove();
			el = document.createElement(tag) as HTMLElement;
			el.className = 'micrio-button';
			this.appendChild(el);
			this.#rootEl = el;
		}

		el.className = `micrio-button ${p.type ?? ''} ${p.className ?? ''}`;
		el.classList.toggle('active', !!p.active);
		el.classList.toggle('no-click', !!p.noClick);

		if (isAnchor) {
			(el as HTMLAnchorElement).href = p.href!;
			(el as HTMLAnchorElement).target = p.blankTarget ? '_blank' : '';
		} else {
			(el as HTMLButtonElement).disabled = !!p.disabled;
		}

		el.setAttribute('title', p.title ?? '');
		el.setAttribute('aria-label', p.title ?? '');

		if (!isAnchor) {
			el.setAttribute('role', 'button');
			el.setAttribute('tabindex', '0');
		} else {
			el.removeAttribute('role');
			el.removeAttribute('tabindex');
		}

		// Re-bind events
		for (const unsub of this.#listeners) unsub();
		this.#listeners = [];

		if (!this.#clickHandler) {
			this.#clickHandler = (e: Event) => {
				const fn = this.#props.onclick;
				if (fn) fn(e);
			};
			el.addEventListener('click', this.#clickHandler);
		}
		if (p.onfocus) {
			el.addEventListener('focus', p.onfocus);
			this.#listeners.push(() => el!.removeEventListener('focus', p.onfocus!));
		}
		if (p.onpointerdown) {
			el.addEventListener('pointerdown', p.onpointerdown as EventListener);
			this.#listeners.push(() => el!.removeEventListener('pointerdown', p.onpointerdown! as EventListener));
		}

		// Render icon
		const existingIcon = el.querySelector(':scope > micrio-icon, :scope > img');
		if (existingIcon) existingIcon.remove();

		if (p.type) {
			const icon = document.createElement('micrio-icon');
			icon.setAttribute('name', p.type);
			el.appendChild(icon);
		} else if (p.icon) {
			const img = document.createElement('img');
			img.src = p.icon.src;
			img.alt = 'Icon';
			el.appendChild(img);
		}

		// Move light-DOM children into the button as text
		const textNodes: string[] = [];
		for (const child of this.childNodes) {
			if (child !== el && (child.nodeType === Node.TEXT_NODE || child.nodeType === Node.ELEMENT_NODE)) {
				textNodes.push(child.textContent ?? '');
				child.remove();
			}
		}
		const text = textNodes.join('').trim();
		const existingText = el.querySelector(':scope > .micrio-button-text');
		if (text) {
			if (!existingText) {
				const span = document.createElement('span');
				span.className = 'micrio-button-text';
				span.textContent = text;
				el.appendChild(span);
			} else {
				existingText.textContent = text;
			}
		} else if (existingText) {
			existingText.remove();
		}
	}
}

customElements.define(MicrioButton.tag, MicrioButton);
