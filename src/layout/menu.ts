import { MicrioElement } from '$core/component';
import type { Models } from '$types/models';
import { createElement } from '$utils/dom';
import { svgIcon } from '$ui/icons';
import { writable, get, lazy } from '$core/store';
import '$ui/icon';

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
import './menu.css';

class MicrioMenu extends MicrioElement<MenuProps> {
	static tag = 'micrio-menu';

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

		const click = (e: Event) => {
			if (!menu.link) e.preventDefault();
			this.#action?.();
			const doClose = !!(this.#isOpen(menu) || this.#action || menu.link);
			opened.set(doClose ? undefined : menu);
			if (doClose) onclose?.();
		};

		if (menu.link) {
			const a = createElement('a', {
				className: 'micrio-menu-action',
				props: { href: menu.link },
				events: { click },
				children: [
					createElement('strong', {
						textContent: cultureData?.title ?? '(Unknown)',
						children: [
							createElement('micrio-icon', {
								setProps: { name: menu.linkTargetBlank ? 'linkExt' : 'link' },
								style: { opacity: '.75' }
							})
						]
					})
				],
				parent: this
			});
			if (menu.linkTargetBlank) a.target = '_blank';
		} else {
			const strongChildren: (Node | string | number | false | null | undefined)[] = [
				cultureData?.title ?? '(Unknown)'
			];
			if (menu.children?.length) {
				strongChildren.push(
					createElement('micrio-icon', { setProps: { name: 'chevronDown' } })
				);
			}

			const btnChildren: (Node | string | number | false | null | undefined)[] = [
				createElement('strong', { children: strongChildren })
			];

			if (menu.icon) {
				btnChildren.unshift(
					svgIcon(menu.icon, { style: 'height:1em;vertical-align:-.125em;margin-right:10px' })
				);
			}

			createElement('button', {
				className: 'micrio-menu-action',
				props: { type: 'button' },
				events: { click },
				children: btnChildren,
				parent: this
			});
		}

		if (menu.children?.length) {
			createElement('div', {
				className: 'items',
				parent: this,
				children: menu.children.map(child =>
					createElement('micrio-menu', {
						setProps: { menu: child, originalId, onclose: close }
					})
				)
			});
		}
	}
}

customElements.define(MicrioMenu.tag, MicrioMenu);
