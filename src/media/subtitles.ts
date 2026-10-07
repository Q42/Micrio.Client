import { MicrioElement } from '$core/component'
import { get, writable } from '$core/store'
import type { Models } from '$types/models'

const CAPTIONS_KEY = 'micrio-captions-disable'

/** Writable store indicating whether captions/subtitles are enabled. Persisted to localStorage. @internal */
export const captionsEnabled = writable<boolean>(localStorage.getItem(CAPTIONS_KEY) !== '1')

captionsEnabled.subscribe((b) => {
	if (b) {
		localStorage.removeItem(CAPTIONS_KEY)
	} else {
		localStorage.setItem(CAPTIONS_KEY, '1')
	}
})

/** Props for the subtitles overlay component. @internal */
export interface SubtitlesProps {
	src?: string
	mediaEl?: HTMLElement
	/**
	 * The playback clock in seconds, pushed by the host. A camera-only video tour has no
	 * media element to listen to, so without this the overlay would stay on t=0.
	 */
	time?: number
}
import './subtitles.css'

/** Custom element that fetches and renders VTT subtitles synchronized with media playback. */
class MicrioSubtitles extends MicrioElement<SubtitlesProps> {
	/* @internal */
	static tag = 'micrio-subtitles'

	#props: SubtitlesProps = {}
	#pushedTime: number | undefined
	#cues: Models.ImageData.Event[] = []
	#currentTime = 0
	#currentCue: Models.ImageData.Event | undefined
	#cleanup: (() => void) | undefined
	/** Increments per fetch, so a slower earlier response cannot overwrite a newer one. */
	#requestId = 0

	/** @internal */
	_onMount() {
		this.#cleanup = captionsEnabled.subscribe(() => {
			this.#renderCue()
		})

		const found = this.#props.mediaEl?.querySelector('video,audio')
		let el: HTMLMediaElement | undefined
		if (found instanceof HTMLMediaElement) {
			el = found
		} else if (this.#props.mediaEl instanceof HTMLMediaElement) {
			el = this.#props.mediaEl
		}
		if (el) {
			const onTime = () => {
				this.#currentTime = el.currentTime
				this.#renderCue()
			}
			el.addEventListener('timeupdate', onTime)
			const prev = this.#cleanup
			this.#cleanup = () => {
				prev?.()
				el.removeEventListener('timeupdate', onTime)
			}
		}

		if (this.#props.src) {
			this.#update()
		}
	}

	/** @internal */
	_setProps(props: Partial<SubtitlesProps>) {
		const srcChanged = props.src !== undefined && props.src !== this.#props.src
		Object.assign(this.#props, props)
		if (srcChanged && this.isConnected) {
			this.#update()
			return
		}
		// The host pushes its own playback clock when there is no media element to observe
		// (a camera-only video tour), which would otherwise leave the overlay on t=0.
		if (props.time !== undefined && props.time !== this.#pushedTime) {
			this.#pushedTime = props.time
			this.#currentTime = props.time
			if (this.isConnected) {
				this.#renderCue()
			}
		}
	}

	#update() {
		if (!this.#props.src) {
			this.replaceChildren()
			return
		}

		this.#cues = []
		const requestId = ++this.#requestId
		const { src } = this.#props
		fetch(src)
			.then((r) => r.text())
			.then((txt) => {
				// A newer `src` (or a destroyed element) makes this response stale.
				if (requestId !== this.#requestId || !this.isConnected) {
					return
				}
				const s = txt.split('\n')
				const cues: Models.ImageData.Event[] = []
				for (let l = 0; l < s.length; l++) {
					if (/-->/.test(s[l])) {
						let idx = l + 1
						const lines: string[] = []
						while (!s[idx] && idx < s.length) {
							idx++
						}
						while (s[idx] && s[idx].trim()) {
							lines.push(s[idx++])
						}
						const [start, end] = s[l]
							.split(' --> ')
							.map((t) => t.trim().replace(',', '.').split(':').map(Number))
							.map((v) => {
								if (v.length === 3) {
									return v[0] * 3600 + v[1] * 60 + v[2]
								} else if (v.length === 2) {
									return v[0] * 60 + v[1]
								}
								return 0
							})
						cues.push({ start, end, data: lines.join('\n') })
						l += lines.length + 1
					}
				}
				this.#cues = cues
				this.#renderCue()
			})
			.catch((err) => {
				console.error('micrio-subtitles: fetch error:', err)
			})
	}

	#renderCue() {
		if (!get(captionsEnabled) || this.#cues.length === 0) {
			this.replaceChildren()
			this.#currentCue = undefined
			return
		}
		const cue = this.#cues.find((e) => e.start <= this.#currentTime && e.end >= this.#currentTime)
		if (cue === this.#currentCue) {
			return
		}
		this.#currentCue = cue
		// `cue.data` is raw text from a remote `.vtt`, which may contain markup: assign it as a
		// text node rather than through `innerHTML`.
		if (!cue) {
			this.replaceChildren()
			return
		}
		const p = document.createElement('p')
		p.textContent = cue.data ?? ''
		this.replaceChildren(p)
	}

	/** @internal */
	_onDestroy() {
		this.#cleanup?.()
	}
}

customElements.define(MicrioSubtitles.tag, MicrioSubtitles)
