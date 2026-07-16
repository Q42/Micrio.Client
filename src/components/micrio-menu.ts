import { MicrioElement } from '$core/component';
import type { Models } from '$types/models';
import { writable, get, lazy } from '$core/store';
import './micrio-icon';

const opened = writable<Models.ImageData.Menu | undefined>(undefined);
let hooked = false;
opened.subscribe(c => {
	if (c) { if (!hooked) window.addEventListener('click', close); }
	else { if (hooked) window.removeEventListener('click', close); }
	hooked = !!c;
});
function close() { opened.set(undefined); }

export interface MenuProps {
	menu: Models.ImageData.Menu;
	originalId?: string | null;
	onclose?: () => void;
}

export class MicrioMenu extends MicrioElement<MenuProps> {
	static tag = 'micrio-menu';
	static styles = `micrio-menu{padding:0;margin:0;transition:background .2s ease,box-shadow .2s ease}
.micrio-menu-action{font-family:inherit;background:transparent;display:block;border:none;padding:0 24px;font-size:.9em;cursor:pointer;text-decoration:none;border-radius:0;color:inherit;text-shadow:inherit;box-sizing:border-box;text-align:center}
@media(max-width:500px){micrio-menu{font-size:1em}.micrio-menu-action{width:100%;margin-bottom:10px;padding:6px 0}}
@media(min-width:501px){micrio-menu{float:left;position:relative}micrio-menu:not(:focus-within):not(:hover) .items{display:none}.micrio-menu-action{height:var(--micrio-button-size);line-height:var(--micrio-button-size);width:100%;text-align:var(--micrio-text-align);white-space:pre;font-weight:600}.items micrio-menu{float:none}.items .micrio-menu-action{width:100%}.micrio-menu-action:hover,.micrio-menu-action:focus{text-shadow:none!important;color:var(--micrio-color-hover)!important}.items{max-height:calc(100vh - 160px);overflow-y:auto;overflow-x:hidden}micrio-menu strong micrio-icon{margin-left:10px;line-height:0;vertical-align:1px}}`;

	#props: MenuProps = { menu: null!, originalId: null };
	#action: (() => void) | undefined;

	onMount() {
		const { menu } = this.#props;
		const micrio = this.getMicrio();
		if (!micrio) return;
		const { _lang } = micrio;

		if (menu.children?.length === 1 && !this.#getCData(menu, get(_lang))?.title) {
			this.#props.menu = menu.children[0];
		}

		this.#evalAction();
		this.#render();

		this.watch(opened, () => this.classList.toggle('opened', this.#isOpen(this.#props.menu)));
		this.watchWith<string>(_lang, lazy<string>(() => { this.#evalAction(); this.#render(); }));
	}

	#evalAction() {
		const { menu, originalId } = this.#props;
		const micrio = this.getMicrio();
		if (!micrio) return;
		const { events, state: micrioState, _lang } = micrio;
		const cultureData = this.#getCData(menu, get(_lang));
		const menuWithExtras = menu as Models.ImageData.Menu & { content?: string; embedUrl?: string };

		this.#action = undefined;

		if (menu.action) {
			this.#action = menu.action as () => void;
		} else if (menu.markerId) {
			this.#action = () => {
				if (originalId && micrio.$current?.id != originalId) micrio.open(originalId);
				micrio.$current?.state.marker.set(menu.markerId);
			};
		} else if ((cultureData?.content || cultureData?.embed || menu.image || menuWithExtras.content || menuWithExtras.embedUrl) ||
			(cultureData?.title && !menu.children?.length && !menu.link && !menu.markerId)) {
			this.#action = () => {
				events.dispatch('page-open', menu);
				micrioState.popover.set({ contentPage: menu });
			};
		}
	}

	setProps(props: Partial<MenuProps>) {
		Object.assign(this.#props, props);
	}

	#getCData(m: Models.ImageData.Menu, lang: string): Models.ImageData.MenuCultureData | undefined {
		return m.i18n?.[lang] ?? (m as unknown as Models.ImageData.MenuCultureData);
	}

	#isOpen(menu: Models.ImageData.Menu): boolean {
		const $opened = get(opened);
		if (!$opened) return false;
		const check = (m: Models.ImageData.Menu): boolean => m === $opened || !!m.children?.some(check);
		return check(menu);
	}

	#render() {
		const { menu, originalId, onclose } = this.#props;
		const micrio = this.getMicrio();
		if (!micrio) return;
		const $_lang = get(micrio._lang);
		const cultureData = this.#getCData(menu, $_lang);

		this.replaceChildren();
		this.classList.toggle('opened', this.#isOpen(menu));
		this.setAttribute('data-title', cultureData?.title?.toLowerCase() ?? '');

		const click = (e: MouseEvent) => {
			if (!menu.link) e.preventDefault();
			this.#action?.();
			const doClose = !!(this.#isOpen(menu) || this.#action || menu.link);
			opened.set(doClose ? undefined : menu);
			if (doClose) onclose?.();
		};

		if (menu.link) {
			const a = document.createElement('a');
			a.className = 'micrio-menu-action';
			a.href = menu.link;
			if (menu.linkTargetBlank) a.target = '_blank';
			a.addEventListener('click', click);
			const strong = document.createElement('strong');
			strong.textContent = cultureData?.title ?? '(Unknown)';
			const icon = document.createElement('micrio-icon');
			icon.setAttribute('name', menu.linkTargetBlank ? 'link-ext' : 'link');
			icon.style.opacity = '.75';
			strong.appendChild(icon);
			a.appendChild(strong);
			this.appendChild(a);
		} else {
			const btn = document.createElement('button');
			btn.className = 'micrio-menu-action';
			btn.type = 'button';
			btn.addEventListener('click', click);
			const strong = document.createElement('strong');
			// Render menu icon if provided (tuple [width, height, svgPath])
			if (menu.icon) {
				const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
				svg.setAttribute('viewBox', `0 0 ${menu.icon[0]} ${menu.icon[1]}`);
				svg.setAttribute('fill', 'currentColor');
				svg.style.cssText = 'height:1em;vertical-align:-.125em;margin-right:10px';
				const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
				path.setAttribute('d', menu.icon[2]);
				svg.appendChild(path);
				btn.appendChild(svg);
			}
			strong.textContent = cultureData?.title ?? '(Unknown)';
			if (menu.children?.length) {
				const icon = document.createElement('micrio-icon');
				icon.setAttribute('name', 'chevron-down');
				strong.appendChild(icon);
			}
			btn.appendChild(strong);
			this.appendChild(btn);
		}

		if (menu.children?.length) {
			const div = document.createElement('div');
			div.className = 'items';
			for (const child of menu.children) {
				const childEl = document.createElement('micrio-menu') as MicrioMenu;
				childEl.setProps({ menu: child, originalId, onclose: close });
				div.appendChild(childEl);
			}
			this.appendChild(div);
		}
	}
}

customElements.define(MicrioMenu.tag, MicrioMenu);
