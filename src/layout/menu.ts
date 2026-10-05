import { MicrioElement } from '$core/component'
import type { Models } from '$types/models'
import { createElement } from '$utils/dom'
import { svgIcon } from '$ui/icons'
import { writable, get, lazy } from '$core/store'
import '$ui/icon'

/** Currently opened menu sub-tree */
const opened = writable<Models.ImageData.Menu | undefined>()
let hooked = false
opened.subscribe((c) => {
	if (c) {
		if (!hooked) {
			globalThis.addEventListener('click', close)
		}
	} else if (hooked) {
		globalThis.removeEventListener('click', close)
	}
	hooked = Boolean(c)
})
/** Close the currently opened menu */
function close() {
	opened.set(undefined)
}

/** Shape of legacy (pre-i18n) menu data, which carried its culture data at the top level. */
interface LegacyMenuData {
	i18n?: unknown
	title?: unknown
	embed?: unknown
	content?: unknown
}

/** Reads a legacy culture string field (typed `unknown` because it is not part of the current model). */
function legacyString(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined
}

/** Legacy (pre-i18n) menu data, carrying its culture data at the top level. */
function legacyCultureData(m: Models.ImageData.Menu): Models.ImageData.MenuCultureData {
	const legacy: LegacyMenuData = m
	return { title: legacyString(legacy.title), embed: legacyString(legacy.embed), content: legacyString(legacy.content) }
}

/** Props for a menu item element @internal */
export interface MenuProps {
	menu: Models.ImageData.Menu
	/** Original image ID to switch back to if the menu navigates to a different image */
	originalId?: string | null
	/** Callback invoked when this menu or a child triggers a close action */
	onclose?: () => void
}
import './menu.css'

/** Custom element rendering a hierarchical menu tree */
class MicrioMenu extends MicrioElement<MenuProps> {
	/** The custom element tag name @internal */
	static tag = 'micrio-menu'

	#props: Partial<MenuProps> = { originalId: null }
	#action: (() => void) | undefined

	/** @internal */
	_onMount() {
		const { menu } = this.#props
		const micrio = this._getMicrio()
		if (!micrio || !menu) {
			return
		}
		const { _lang } = micrio

		if (menu.children?.length === 1 && !this.#getCData(menu, get(_lang))?.title) {
			this.#props.menu = menu.children[0]
		}

		this.#evalAction()
		this.#render()

		this._watch(opened, () => this.classList.toggle('opened', this.#isOpen(this.#props.menu)))
		this._watchWith<string>(
			_lang,
			lazy<string>(() => {
				this.#evalAction()
				this.#render()
			}),
		)
	}

	#evalAction() {
		const { menu, originalId } = this.#props
		const micrio = this._getMicrio()
		if (!micrio || !menu) {
			return
		}
		const { events, state: micrioState, _lang } = micrio
		const cultureData = this.#getCData(menu, get(_lang))
		const menuWithExtras = menu as Models.ImageData.Menu & { content?: string; embedUrl?: string }

		this.#action = undefined

		if (menu.action) {
			const { action } = menu
			this.#action = () => {
				action()
			}
		} else if (menu.markerId) {
			this.#action = () => {
				if (originalId && micrio.$current?.id !== originalId) {
					void micrio.open(originalId)
				}
				micrio.$current?.state.marker.set(menu.markerId)
			}
		} else if (
			cultureData?.content ||
			cultureData?.embed ||
			menu.image ||
			menuWithExtras.content ||
			menuWithExtras.embedUrl ||
			(cultureData?.title && !menu.children?.length && !menu.link && !menu.markerId)
		) {
			this.#action = () => {
				events._dispatch('page-open', menu)
				micrioState.popover.set({ contentPage: menu })
			}
		}
	}

	/** @internal */
	_setProps(props: Partial<MenuProps>) {
		Object.assign(this.#props, props)
	}

	#getCData(m: Models.ImageData.Menu, lang: string): Models.ImageData.MenuCultureData | undefined {
		return m.i18n?.[lang] ?? legacyCultureData(m)
	}

	#isOpen(menu: Models.ImageData.Menu | undefined): boolean {
		const $opened = get(opened)
		if (!$opened || !menu) {
			return false
		}
		const check = (m: Models.ImageData.Menu): boolean => m === $opened || Boolean(m.children?.some(check))
		return check(menu)
	}

	#render() {
		const { menu, originalId, onclose } = this.#props
		const micrio = this._getMicrio()
		if (!micrio || !menu) {
			return
		}
		const $_lang = get(micrio._lang)
		const cultureData = this.#getCData(menu, $_lang)

		this.replaceChildren()
		this.classList.toggle('opened', this.#isOpen(menu))
		this.dataset.title = cultureData?.title?.toLowerCase() ?? ''

		const click = (e: Event) => {
			if (!menu.link) {
				e.preventDefault()
			}
			if (menu.children?.length) {
				e.stopPropagation()
			}
			this.#action?.()
			const doClose = Boolean(this.#isOpen(menu) || this.#action || menu.link)
			opened.set(doClose ? undefined : menu)
			if (this.#action || menu.link) {
				onclose?.()
			}
		}

		if (menu.link) {
			const a = createElement('a', {
				props: { href: menu.link },
				events: { click },
				children: [
					createElement('strong', {
						textContent: cultureData?.title ?? '(Unknown)',
						children: [
							createElement('micrio-icon', {
								setProps: { name: menu.linkTargetBlank ? 'linkExt' : 'link' },
								style: { opacity: '.75' },
							}),
						],
					}),
				],
				parent: this,
			})
			if (menu.linkTargetBlank) {
				a.target = '_blank'
			}
		} else {
			const strongChildren: (Node | string | number | false | null | undefined)[] = [cultureData?.title ?? '(Unknown)']
			if (menu.children?.length) {
				strongChildren.push(createElement('micrio-icon', { setProps: { name: 'chevronDown' } }))
			}

			const btnChildren: (Node | string | number | false | null | undefined)[] = [
				createElement('strong', { children: strongChildren }),
			]

			if (menu.icon) {
				btnChildren.unshift(svgIcon(menu.icon, { style: 'height:1em;vertical-align:-.125em;margin-right:10px' }))
			}

			createElement('button', {
				props: { type: 'button' },
				events: { click },
				children: btnChildren,
				parent: this,
			})
		}

		if (menu.children?.length) {
			createElement('div', {
				parent: this,
				children: menu.children.map((child) =>
					createElement('micrio-menu', {
						setProps: { menu: child, originalId, onclose: close },
					}),
				),
			})
		}
	}
}

customElements.define(MicrioMenu.tag, MicrioMenu)
