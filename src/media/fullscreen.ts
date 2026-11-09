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
	/** The element the listener was installed for, so a replaced target can re-init. */
	#boundEl: HTMLElement | undefined
	/** Whether this instance installed the shared scroll hook (and must remove it). */
	#ownsScroll = false
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
			// A replaced target keeps every closure below pointing at the old element; reset
			// the one-shot init so the new element gets its own active state and listener.
			if (this.#inited && props.el !== this.#boundEl) {
				document.removeEventListener('fullscreenchange', this.#onFullscreenChange)
				if (this.#ownsScroll) {
					this._getMicrio()?.events.unhookScroll()
					this.#ownsScroll = false
				}
				this.#inited = false
				this.#isActive = false
				this.#boundEl = undefined
				this.replaceChildren()
			}
			this.#props.el = props.el
			if (this.isConnected && !this.#inited) {
				this.#init()
			}
		}
	}

	#onFullscreenChange = (): void => {
		// Read the current target, not a captured one: `_setProps` can replace it.
		const { el } = this.#props
		const micrio = this._getMicrio()
		this.#isActive = el !== undefined && document.fullscreenElement === el
		if (this.#isActive) {
			if (micrio && el === micrio && !micrio.events.scrollHooked) {
				micrio.events.hookScroll()
				this.#ownsScroll = true
			}
		} else if (this.#ownsScroll) {
			micrio?.events.unhookScroll()
			this.#ownsScroll = false
		}
		this.#renderButton()
	}

	#init() {
		if (this.#inited) {
			return
		}
		const { el } = this.#props
		if (!el) {
			return
		}
		// Capability is checked before the latch: an unsupported target must not look
		// "initialized" forever if a later render passes a usable one.
		if (!('requestFullscreen' in el)) {
			return
		}
		this.#inited = true
		this.#boundEl = el
		this.#isActive = document.fullscreenElement === el

		document.addEventListener('fullscreenchange', this.#onFullscreenChange)
		this._addCleanup(() => {
			document.removeEventListener('fullscreenchange', this.#onFullscreenChange)
			if (this.#ownsScroll) {
				this._getMicrio()?.events.unhookScroll()
				this.#ownsScroll = false
			}
		})

		// The button title is translated, so refresh it on a UI language change
		const micrio = this._getMicrio()
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
