import { MicrioElement } from '$core/component'

/** Properties for the 360-degree rotation dial component. @internal */
export interface DialProps {
	currentRotation: number
	frames: number
	degrees?: boolean
	onturn?: (frame: number) => void
}
import './dial.css'

/** Web component for a 360-degree rotation dial control. */
class MicrioDial extends MicrioElement<DialProps> {
	/** The custom element tag name. @internal */
	static tag = 'micrio-dial'

	#props: DialProps = { currentRotation: 0, frames: 1 }
	/** The degree readout, present only while `degrees` is set. */
	#readout: HTMLElement | undefined

	/** @internal */
	_onMount() {
		const micrio = this._getMicrio()
		if (!micrio) {
			return
		}
		const camera = micrio.$current?.camera
		if (!camera) {
			return
		}

		let pointerId: number | undefined
		let startX = 0
		let startRot = 0

		const dStart = (e: PointerEvent) => {
			e.stopPropagation()
			e.preventDefault()
			if (e.button !== 0) {
				return
			}
			micrio.addEventListener('pointermove', dMove)
			micrio.addEventListener('pointerup', dStop)
			micrio.dataset.panning = ''
			;({ pointerId } = e)
			micrio.setPointerCapture(pointerId)
			startRot = this.#props.currentRotation
			startX = e.clientX
		}

		const dMove = (e: PointerEvent) => {
			// An unstyled or hidden dial measures zero, which would turn the drag into a
			// division by zero and hand the caller a non-finite frame.
			if (this.offsetWidth <= 0 || micrio.offsetWidth <= 0) {
				return
			}
			const scale = Math.max(1, (camera.getXY(1, 0.5)[0] - camera.getXY(0, 0.5)[0]) / micrio.offsetWidth)
			const targetFrame = (startRot / 360 + (startX - e.clientX) / (this.offsetWidth * scale)) * this.#props.frames
			if (!Number.isFinite(targetFrame)) {
				return
			}
			// Keep the readout live under the drag: the parent only re-syncs `currentRotation`
			// when the frame actually changes
			this.#props.currentRotation = ((targetFrame % this.#props.frames) / this.#props.frames) * 360
			this.#printDegrees()
			this.#props.onturn?.(targetFrame)
		}

		const dStop = () => {
			// Only release what `dStart` captured: `releasePointerCapture` throws for an id the
			// element does not hold, and `hasPointerCapture` is not a reliable guard (both can be
			// overridden independently).
			if (pointerId !== undefined) {
				micrio.releasePointerCapture(pointerId)
			}
			pointerId = undefined
			delete micrio.dataset.panning
			micrio.removeEventListener('pointermove', dMove)
			micrio.removeEventListener('pointerup', dStop)
			micrio.removeEventListener('pointercancel', dStop)
		}
		this.addEventListener('pointerdown', dStart)
		// Without `pointercancel` and the teardown below, an interrupted drag left the capture,
		// `data-panning` and both listeners on `<micr-io>`, and the dial kept turning on any later
		// pointer move — even after `omni.ts` had replaced it.
		micrio.addEventListener('pointercancel', dStop)
		this._addCleanup(() => {
			dStop()
			this.removeEventListener('pointerdown', dStart)
			micrio.removeEventListener('pointercancel', dStop)
		})
	}

	/** @internal */
	_setProps(props: Partial<DialProps>) {
		Object.assign(this.#props, props)
		if (!this.isConnected) {
			return
		}
		const offset = (-this.#props.currentRotation / 360) * (this.offsetWidth ?? 0)
		this.style.setProperty('--micrio-dial-offset', `${offset}px`)
		this.#printDegrees()
	}

	/**
	 * Renders the degree readout when `degrees` is set, and drops it again when it is cleared.
	 *
	 * `degrees` comes from the omni's `showDegrees` setting and can be toggled while the dial is
	 * mounted, so the element is created and removed with the flag rather than hidden by CSS.
	 */
	#printDegrees() {
		if (!this.#props.degrees) {
			this.#readout?.remove()
			this.#readout = undefined
			return
		}
		if (!this.#readout) {
			this.#readout = document.createElement('span')
			this.append(this.#readout)
		}
		this.#readout.textContent = `${Math.round(this.#props.currentRotation * 10) / 10}º`
	}
}

customElements.define(MicrioDial.tag, MicrioDial)
