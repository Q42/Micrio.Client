import { createElement } from '$utils/dom'
import { MicrioElement } from '$core/component'
import { get } from '$core/store'
import { i18n } from '$core/i18n/strings'

/** Props for the fullscreen toggle component. @internal */
export interface FullscreenProps {
	el: HTMLElement
}

/** Custom element that renders a fullscreen toggle button for a given element. */
class MicrioFullscreen extends MicrioElement<FullscreenProps> {
	/* @internal */
	static tag = 'micrio-fullscreen'

	#props: Partial<FullscreenProps> = {}
	#isActive = false
	#inited = false
	#toggle = () => {
		const { el } = this.#props
		if (!el) {
			return
		}
		if (this.#isActive) {
			void document.exitFullscreen()
		} else {
			void el.requestFullscreen()
		}
	}

	/** @internal */
	_onMount() {
		if (!this.#props?.el) {
			return
		}
		this.#init()
	}

	/** @internal */
	_setProps(props: Partial<FullscreenProps>) {
		if (props.el !== undefined) {
			this.#props.el = props.el
			if (this.isConnected && !this.#inited) {
				this.#init()
			}
		}
	}

	#init() {
		if (this.#inited) {
			return
		}
		const { el } = this.#props
		if (!el) {
			return
		}
		this.#inited = true
		if (!('requestFullscreen' in el)) {
			return
		}

		this.#isActive = document.fullscreenElement === el

		const micrio = this._getMicrio()
		const addScrollZoom = micrio && el === micrio && !micrio.events.scrollHooked

		const onchange = () => {
			this.#isActive = document.fullscreenElement === el
			if (addScrollZoom) {
				if (this.#isActive) {
					micrio.events.hookScroll()
				} else {
					micrio.events.unhookScroll()
				}
			}
			this.#renderButton()
		}

		document.addEventListener('fullscreenchange', onchange)
		this._addCleanup(() => {
			document.removeEventListener('fullscreenchange', onchange)
		})

		// The button title is translated, so refresh it on a UI language change
		if (micrio) {
			this._watchLater(micrio._lang, () => {
				this.#renderButton()
			})
		}

		this.#renderButton()
	}

	#renderButton() {
		this.replaceChildren()
		const $i18n = get(i18n)
		createElement('micrio-button', {
			setProps: {
				type: this.#isActive ? 'fullscreenLeave' : 'fullscreenEnter',
				title: $i18n._fullscreenToggle,
				onclick: this.#toggle,
			},
			parent: this,
		})
	}
}

customElements.define(MicrioFullscreen.tag, MicrioFullscreen)
