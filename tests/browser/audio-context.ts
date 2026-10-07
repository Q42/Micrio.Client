/**
 * A hand-written fake Web Audio implementation for the audio suites.
 *
 * `src/audio/**` only touches a small slice of the Web Audio API, and the real
 * `AudioContext` in headless Chromium refuses to start without a user gesture, so a
 * fake keeps the tests deterministic and lets them observe routing decisions (which
 * node connects to which, what the panner was told) instead of guessing at them.
 *
 * Installed from `tests/browser/setup.ts` before `src/main` is imported:
 * `audio-controller` keeps its `AudioContext` in module state and initialises it once
 * (`init()` returns early when a master gain exists), so the fake has to be in place
 * before the first test runs and stays shared for the whole file. That is also why
 * `FakeAudioContext.instances` is a static list — tests assert the "created once"
 * behaviour through it.
 */

/** A Web Audio parameter that records every value it was written. */
export class FakeAudioParam {
	value = 0
	/** Every value written, in order, so monotonic changes can be asserted. */
	readonly history: number[] = []

	setValueAtTime(value: number): void {
		this.value = value
		this.history.push(value)
	}
}

/** Base for everything that can be connected in the graph. */
class FakeAudioNode {
	readonly connections: FakeAudioNode[] = []
	readonly disconnects: number[] = []
	/** Recorded calls, for asserting wiring order. */
	readonly calls: string[] = []

	connect(target: FakeAudioNode): FakeAudioNode {
		this.calls.push('connect')
		this.connections.push(target)
		return target
	}

	disconnect(): void {
		this.calls.push('disconnect')
		this.disconnects.push(this.connections.length)
		this.connections.length = 0
	}
}

/** A gain node, as `createGain()` returns it. */
export class FakeGainNode extends FakeAudioNode {
	readonly gain = new FakeAudioParam()
}

/** A panner node, as `createPanner()` returns it. */
export class FakePannerNode extends FakeAudioNode {
	panningModel: PanningModelType = 'equalpower'
	distanceModel: DistanceModelType = 'inverse'
	rolloffFactor = 1
	coneOuterGain = 0
	refDistance = 1
	maxDistance = 10_000
	positionX = new FakeAudioParam()
	positionY = new FakeAudioParam()
	positionZ = new FakeAudioParam()
	orientationX = new FakeAudioParam()
	orientationY = new FakeAudioParam()
	orientationZ = new FakeAudioParam()
}

/** A buffer source, as `createBufferSource()` returns it. */
export class FakeBufferSource extends FakeAudioNode {
	buffer: AudioBuffer | null = null
	loop = false
	started = 0
	/** Dispatches through the element-style listener API the client uses for `ended`. */
	readonly shortName = 'FakeBufferSource'
	#listeners = new Map<string, (() => void)[]>()

	addEventListener(type: string, listener: () => void): void {
		const list = this.#listeners.get(type) ?? []
		list.push(listener)
		this.#listeners.set(type, list)
	}

	removeEventListener(type: string, listener: () => void): void {
		const list = this.#listeners.get(type)
		if (!list) {
			return
		}
		this.#listeners.set(
			type,
			list.filter((l) => l !== listener),
		)
	}

	/** Plays the source; documented as a no-op in the fake. */
	start(): void {
		this.calls.push('start')
		this.started++
	}

	stop(): void {
		this.calls.push('stop')
	}

	/** Fires the `ended` listeners, as a finished buffer would. */
	emitEnded(): void {
		for (const listener of this.#listeners.get('ended') ?? []) {
			listener()
		}
	}
}

/** An `AudioListener`, exposing both the legacy and the modern parameter shape. */
export class FakeAudioListener {
	readonly positions: [number, number, number][] = []
	readonly orientations: [number, number, number, number, number, number][] = []
	positionX = new FakeAudioParam()
	positionY = new FakeAudioParam()
	positionZ = new FakeAudioParam()
	upX = new FakeAudioParam()
	upY = new FakeAudioParam()
	upZ = new FakeAudioParam()

	setPosition(x: number, y: number, z: number): void {
		this.positions.push([x, y, z])
	}

	setOrientation(x: number, y: number, z: number, upX: number, upY: number, upZ: number): void {
		this.orientations.push([x, y, z, upX, upY, upZ])
	}
}

/** The context itself, sized to what `src/audio/**` uses. */
export class FakeAudioContext {
	static readonly instances: FakeAudioContext[] = []

	readonly destination = new FakeAudioNode()
	readonly listener = new FakeAudioListener()
	/** Starts suspended, like a real context before a user gesture. */
	state: AudioContextState = 'suspended'
	readonly resumeCalls: number[] = []
	readonly gains: FakeGainNode[] = []
	readonly panners: FakePannerNode[] = []
	readonly sources: FakeBufferSource[] = []
	/** Every buffer handed to `decodeAudioData`, keyed by the decoded `duration`. */
	readonly decoded: ArrayBuffer[] = []

	constructor() {
		FakeAudioContext.instances.push(this)
	}

	resume(): Promise<void> {
		this.resumeCalls.push(this.resumeCalls.length + 1)
		this.state = 'running'
		return Promise.resolve()
	}

	createGain(): GainNode {
		const node = new FakeGainNode()
		this.gains.push(node)
		return node as unknown as GainNode
	}

	createPanner(): PannerNode {
		const node = new FakePannerNode()
		this.panners.push(node)
		return node as unknown as PannerNode
	}

	createBufferSource(): AudioBufferSourceNode {
		const node = new FakeBufferSource()
		this.sources.push(node)
		return node as unknown as AudioBufferSourceNode
	}

	decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer> {
		this.decoded.push(data)
		return Promise.resolve({ duration: 1, length: 1, numberOfChannels: 1, sampleRate: 44100 } as AudioBuffer)
	}
}

/** Installs the fake as the global `AudioContext`. */
export function installAudioContext(): void {
	FakeAudioContext.instances.length = 0
	globalThis.AudioContext = FakeAudioContext as unknown as typeof AudioContext
}

/** The fake, exported under the name the audio suites read it by. */
export const MockAudioContext = FakeAudioContext

/** The context most recently created, if any. */
export function latestAudioContext(): FakeAudioContext | undefined {
	return FakeAudioContext.instances.at(-1)
}
