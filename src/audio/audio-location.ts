import type { Models } from '$types/models'
import type { HTMLMicrioElement } from '$core/element'
import { normalize3 } from '$utils/math'
import { mainGain } from './audio-controller'

/** The global scope as a plain object, so runtime-provided globals can be probed with `in`. */
const globals: object = globalThis

/** True when `value` is a decoded-audio cache object. */
function isAudioBufferCache(value: unknown): value is Record<string, AudioBuffer> {
	return typeof value === 'object' && value !== null
}

/** Decoded-audio cache shared across player instances, keyed by source URL. */
function audioBufferCache(): Record<string, AudioBuffer> {
	const existing: unknown = '__micrioAudioBuffers' in globals ? globals.__micrioAudioBuffers : undefined
	if (isAudioBufferCache(existing)) {
		return existing
	}
	const created: Record<string, AudioBuffer> = {}
	Object.assign(globals, { __micrioAudioBuffers: created })
	return created
}

export class MicrioAudioLocation {
	#micrio: HTMLMicrioElement
	#gain!: GainNode
	#panner!: PannerNode
	#source!: AudioBufferSourceNode
	#to: ReturnType<typeof setTimeout> | undefined
	#cleanup: (() => void) | undefined
	/** The `ended` listener of the repeating source, so `#end` can detach it. */
	#onSourceEnded: (() => void) | undefined

	constructor(micrio: HTMLMicrioElement, marker: Models.ImageData.Marker, ctx: AudioContext, is360: boolean) {
		this.#micrio = micrio
		this.#init(marker, ctx, is360)
	}

	#init(marker: Models.ImageData.Marker, ctx: AudioContext, is360: boolean) {
		const image = this.#micrio.$current
		if (!image) {
			return
		}
		const info = image.$info
		const imgWidth = info.width
		const imgHeight = info.height
		const item = marker.positionalAudio
		if (!item) {
			return
		}

		this.#gain = ctx.createGain()
		this.#panner = ctx.createPanner()
		this.#panner.panningModel = 'equalpower'
		this.#panner.rolloffFactor = 1
		this.#panner.coneOuterGain = 0
		const r = 11

		const update = () => {
			this.#gain.gain.value = item.volume ?? 1
			if (is360) {
				this.#panner.refDistance = item.radius * (r / 4)
				this.#panner.maxDistance = item.radius * (r / 3)
				const xR = marker.x * -Math.PI * 2
				const yR = (marker.y - 0.5) * -Math.PI
				const _x = Math.cos(yR) * Math.sin(xR) * r
				const _y = Math.sin(yR) * r
				const _z = Math.cos(yR) * Math.cos(xR) * r
				this.#panner.positionX.value = _x
				this.#panner.positionY.value = _y
				this.#panner.positionZ.value = _z
				const [nx, ny, nz] = normalize3(_x, _y, _z)
				this.#panner.orientationX.value = nx
				this.#panner.orientationY.value = ny
				this.#panner.orientationZ.value = nz
			} else {
				this.#panner.distanceModel = 'linear'
				this.#panner.positionX.value = (marker.x - 0.5) * 2
				this.#panner.positionY.value = (0.5 - marker.y) * 2 * (imgHeight / imgWidth)
				this.#panner.positionZ.value = -0.2
				this.#panner.rolloffFactor = 2
				this.#panner.refDistance = item.radius * item.radius * 10
				this.#panner.maxDistance = item.radius * 5
			}
		}

		const play = () => {
			if (this.#source !== undefined) {
				if (this.#onSourceEnded) {
					this.#source.removeEventListener('ended', this.#onSourceEnded)
					this.#onSourceEnded = undefined
				}
				this.#source.disconnect()
			}
			this.#source = ctx.createBufferSource()
			if (item.loop) {
				if (item.repeatAfter > 0) {
					this.#onSourceEnded = () => {
						this.#to = setTimeout(play, item.repeatAfter * 1000)
					}
					this.#source.addEventListener('ended', this.#onSourceEnded)
				} else {
					this.#source.loop = true
				}
			}
			this.#gain.gain.value = item.volume ?? 1
			this.#source.buffer = audioBufferCache()[item.src] ?? null
			if (this.#source.buffer !== null) {
				this.#source.connect(this.#panner)
				this.#source.start()
			}
		}

		const start = async () => {
			if (!item.src) {
				return
			}
			const buffers = audioBufferCache()
			if (buffers[item.src] === undefined) {
				buffers[item.src] = await fetch(item.src)
					.then((res) => res.arrayBuffer())
					.then((b) => ctx.decodeAudioData(b))
			}
			if (item.alwaysPlay && item.repeatAfter > 0) {
				this.#to = setTimeout(play, item.repeatAfter * 1000)
			} else {
				play()
			}
		}

		update()
		this.#panner.connect(this.#gain)
		this.#gain.connect(mainGain ?? ctx.destination)
		void start()

		this.#micrio.addEventListener('audio-update', update)
		this.#cleanup = () => {
			this.#micrio.removeEventListener('audio-update', update)
		}
	}

	#end() {
		if (this.#source !== undefined) {
			// The repeating source keeps a listener that would reschedule playback
			if (this.#onSourceEnded) {
				this.#source.removeEventListener('ended', this.#onSourceEnded)
				this.#onSourceEnded = undefined
			}
			this.#source.disconnect()
		}
		clearTimeout(this.#to)
		// `#init` bails out before creating these when the marker has no source, or when
		// the element has no current image by then, and `destroy` is still called on it.
		this.#panner?.disconnect()
		this.#gain?.disconnect()
	}

	destroy() {
		this.#cleanup?.()
		this.#end()
	}
}
