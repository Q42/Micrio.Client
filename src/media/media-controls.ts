import type { ElementOptions } from '$utils/dom'
import { createElement } from '$utils/dom'
import { MicrioElement } from '$core/component'
import { get } from '$core/store'
import { i18n } from '$core/i18n/strings'
import { captionsEnabled } from '$media/subtitles'
import { fmt } from '$utils/time'
import '$ui/button'
import './fullscreen'

/** True for a registered Micrio custom element; keeps the narrowed type non-generic. */
function isMicrioElement(el: unknown): el is MicrioElement {
	return el instanceof MicrioElement
}

/** Creates a `<micrio-*>` custom element and narrows it to its registered class. */
function createComponent(tag: string, options: ElementOptions): MicrioElement {
	const el = createElement(tag, options)
	if (!isMicrioElement(el)) {
		throw new Error(`<${tag}> is not a registered Micrio element`)
	}
	return el
}

/** Props for the media controls UI component. @internal */
export interface MediaControlsProps {
	currentTime?: number
	duration?: number
	seeking?: boolean
	paused: boolean
	ended: boolean
	fullscreenEl?: HTMLElement | undefined
	subtitles?: boolean
	hasAudio?: boolean
	muted?: boolean
	onplaypause?: () => void
	onmute?: () => void
	onseek?: (n: number) => void
	onclose?: () => void
	getTimeDisplay?: (currentTime: number, duration: number) => string
}
import './media-controls.css'

/** Custom element that renders play/pause, seek bar, mute, subtitles, and fullscreen controls for media playback. */
class MicrioMediaControls extends MicrioElement<MediaControlsProps> {
	/* @internal */
	static tag = 'micrio-media-controls'

	#props: MediaControlsProps = { paused: true, ended: false }
	#wrapperEl!: HTMLElement
	#playBtn!: MicrioElement
	#muteBtnEl!: MicrioElement
	#subBtnEl!: MicrioElement
	#fsBtnEl!: MicrioElement
	#barEl!: HTMLElement
	#timeEl!: HTMLElement
	#closeBtnEl: MicrioElement | undefined
	#built = false
	#prevPaused: boolean | undefined
	#prevSeeking = false
	#prevMuted = false
	#prevProgress = -1
	#prevTime = ''
	#prevLang: string | undefined

	/** @internal */
	_onMount() {
		this.#build()
		this._addCleanup(
			captionsEnabled.subscribe(() => {
				this.#sync()
			}),
		)
		// Button titles are translated, so refresh them on a UI language change
		const micrio = this._getMicrio()
		if (micrio) {
			this._watchLater(micrio._lang, () => {
				this.#sync()
			})
		}
	}

	/** @internal */
	_setProps(props: Partial<MediaControlsProps>) {
		Object.assign(this.#props, props)
		if (this.isConnected) {
			this.#build()
			if (this.#built) {
				this.#sync()
			}
		}
	}

	#build() {
		const p = this.#props
		if (!this.#built) {
			this.#built = true

			this.#wrapperEl = createElement('aside', {
				events: {
					click: (e) => {
						e.stopPropagation()
					},
					keydown: (e) => {
						e.stopPropagation()
					},
				},
				parent: this,
			})

			this.#playBtn = createComponent('micrio-button', {
				parent: this.#wrapperEl,
			})

			if (p.hasAudio) {
				this.#muteBtnEl = createComponent('micrio-button', {
					parent: this.#wrapperEl,
				})
			}

			if (p.subtitles) {
				this.#subBtnEl = createComponent('micrio-button', {
					parent: this.#wrapperEl,
				})
			}

			const container = createElement('div')

			const bars = createElement('div', {
				attrs: { 'data-part': 'bars' },
				children: [(this.#barEl = createElement('div', { attrs: { 'data-part': 'bar' } }))],
			})

			const dStart = (e: MouseEvent) => {
				if (e.button !== 0) {
					return
				}
				globalThis.addEventListener('mousemove', dMove)
				globalThis.addEventListener('mouseup', dStop)
				dMove(e)
			}
			const dMove = (e: MouseEvent) => {
				const rect = bars.getClientRects()[0]
				if (rect === undefined) {
					return
				}
				const perc = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
				this.#props.onseek?.(perc * (this.#props.duration ?? 0))
			}
			const dStop = () => {
				globalThis.removeEventListener('mousemove', dMove)
				globalThis.removeEventListener('mouseup', dStop)
			}
			bars.addEventListener('mousedown', dStart)
			container.append(bars)

			this.#timeEl = createElement('span', {
				parent: container,
			})

			this.#wrapperEl.append(container)

			if (p.fullscreenEl) {
				this.#fsBtnEl = createComponent('micrio-fullscreen', {
					parent: this.#wrapperEl,
				})
			}

			if (p.onclose) {
				this.#closeBtnEl = createComponent('micrio-button', {
					setProps: { type: 'close', title: get(i18n)._close, onclick: p.onclose },
					parent: this.#wrapperEl,
				})
			}
		}

		this.#sync()
	}

	#sync() {
		const p = this.#props
		const $i18n = get(i18n)
		const $captionsEnabled = get(captionsEnabled)
		// The previous state caches would skip the translated titles, so bypass them
		// when the UI language changed
		const micrio = this._getMicrio()
		const $lang = micrio ? get(micrio._lang) : undefined
		const langChanged = $lang !== this.#prevLang
		this.#prevLang = $lang

		if (
			langChanged ||
			p.paused !== this.#prevPaused ||
			p.seeking !== this.#prevSeeking ||
			this.#prevPaused === undefined
		) {
			this.#prevPaused = p.paused
			this.#prevSeeking = Boolean(p.seeking)
			this.#playBtn._setProps({
				type: !p.paused ? 'pause' : 'play',
				title: !p.paused ? $i18n._pause : $i18n._play,
				disabled: Boolean(p.seeking),
				onclick: p.onplaypause,
			})
		}

		if (this.#muteBtnEl !== undefined && (langChanged || p.muted !== this.#prevMuted)) {
			this.#prevMuted = Boolean(p.muted)
			this.#muteBtnEl._setProps({
				type: p.muted ? 'muted' : 'unmuted',
				title: p.muted ? $i18n._audioUnmute : $i18n._audioMute,
				disabled: p.seeking,
				onclick: p.onmute,
			})
		}

		if (this.#subBtnEl !== undefined) {
			this.#subBtnEl._setProps({
				type: $captionsEnabled ? 'subtitles' : 'subtitlesOff',
				active: $captionsEnabled,
				title: $i18n._subtitlesToggle,
				onclick: () => {
					captionsEnabled.set(!get(captionsEnabled))
				},
			})
		}

		if (this.#fsBtnEl !== undefined) {
			this.#fsBtnEl._setProps({ el: p.fullscreenEl })
		}

		if (this.#closeBtnEl && langChanged) {
			this.#closeBtnEl._setProps({ title: $i18n._close })
		}

		// A known duration: draw the progress and the readout. The readout is written even
		// when a custom formatter is supplied and the duration is still 0, so the element is
		// never left empty -- an empty span collapses, and its space is then taken by the bar.
		const duration = p.duration ?? 0
		if (duration > 0 && !Number.isNaN(duration)) {
			const progress = ((p.currentTime ?? 0) / duration) * 100
			if (Math.abs(progress - this.#prevProgress) > 0.5 || progress === 0) {
				this.#prevProgress = progress
				this.#barEl.style.width = `${progress}%`
			}
		} else if (this.#prevProgress !== 0) {
			this.#prevProgress = 0
			this.#barEl.style.width = '0%'
		}
		if (p.getTimeDisplay !== undefined || duration > 0) {
			// The default stays the original countdown formatter, unchanged
			const remaining = duration - (p.currentTime ?? 0)
			const t = p.getTimeDisplay
				? p.getTimeDisplay(p.currentTime ?? 0, duration)
				: (remaining >= 0 ? '' : '-') + fmt(Math.abs(remaining))
			if (t !== this.#prevTime) {
				this.#prevTime = t
				this.#timeEl.textContent = t
			}
		} else if (this.#prevTime !== '0:00') {
			this.#prevTime = '0:00'
			this.#timeEl.textContent = '0:00'
		}
	}
}

customElements.define(MicrioMediaControls.tag, MicrioMediaControls)
