import { afterEach, describe, expect, it, vi } from 'vitest'

import { SogRenderer, isSogBundle, isSogHybrid } from '$render/sog'
import type { Models } from '$types/models'
import { pollUntil, sleep } from '../../helpers/async'
import {
	arrayBufferResponse,
	binaryResponse,
	installViewerFactory,
	makeSogScene,
	makeViewer,
	nextFrame,
	paint,
	progressValues,
	sogInfo,
	stubFetch,
	type SogInfo,
	type SogViewer,
} from './sog-harness'

/**
 * `src/render/sog.ts` — the gaussian splat (SOG) renderer.
 *
 * The renderer is deliberately thin: it delegates drawing to the published PlayCanvas
 * bundle and only owns the loading, camera mirroring, and the hybrid overlay's alpha
 * mask. Those are exactly the paths this suite drives, against the fake host in
 * `sog-harness.ts` rather than a viewer: a real one would spend a WebGL context on
 * every case and make the download/settle timing part of the frame loop.
 *
 * What is asserted here is the contract a page depends on — which capture is chosen,
 * what the viewer is handed, how the camera is mirrored, and that teardown releases
 * every listener, subscription and canvas.
 */

const bundleWith = (sog?: SogInfo[]): Models.ImageBundle.BundleImage =>
	({
		id: 'sog-bundle',
		info: {},
		settings: sog === undefined ? {} : { omni: { sog } },
		data: {},
	}) as unknown as Models.ImageBundle.BundleImage

afterEach(() => {
	globalThis.createMicrioSogViewer = undefined
	vi.useRealTimers()
	vi.restoreAllMocks()
})

const makeHybrid = (options: Parameters<typeof makeSogScene>[0] = {}): ReturnType<typeof makeSogScene> =>
	makeSogScene({ attrs: { sog: '' }, hybrid: true, ...options })

/** Sizes the overlay and records whether `navigator.gpu` was hidden during the call. */
function sizedFactory(state: { gpu?: unknown } = {}): ReturnType<typeof installViewerFactory> {
	return installViewerFactory((options) => {
		state.gpu = Object.getOwnPropertyDescriptor(navigator, 'gpu')
		options.canvas.width = 100
		options.canvas.height = 50
		return makeViewer(options.canvas)
	})
}

describe('isSogBundle / isSogHybrid', () => {
	it('needs both a requesting attribute and a capture on the image', () => {
		const scene = makeSogScene()
		const bundle = bundleWith([sogInfo('l')])

		expect(isSogBundle(scene.micrio, bundle)).toBe(false)
		scene.micrio.dataset.preferSog = ''
		expect(isSogBundle(scene.micrio, bundleWith())).toBe(false)
	})

	it('accepts data-prefer-sog and the older data-prefer-splats spelling', () => {
		const bundle = bundleWith([sogInfo('l')])

		const forced = makeSogScene({ attrs: { preferSog: 'l' } })
		expect(isSogBundle(forced.micrio, bundle)).toBe(true)
		expect(isSogHybrid(forced.micrio)).toBe(false)

		const legacy = makeSogScene({ attrs: { preferSplats: 'l' } })
		expect(isSogBundle(legacy.micrio, bundle)).toBe(true)
		expect(isSogHybrid(legacy.micrio)).toBe(false)
	})

	it('treats data-sog as hybrid, unless data-prefer-sog forces the SOG only', () => {
		const bundle = bundleWith([sogInfo('l')])
		const hybrid = makeSogScene({ attrs: { sog: '' } })

		expect(isSogBundle(hybrid.micrio, bundle)).toBe(true)
		expect(isSogHybrid(hybrid.micrio)).toBe(true)

		hybrid.micrio.dataset.preferSog = ''
		expect(isSogHybrid(hybrid.micrio)).toBe(false)
	})
})

describe('SogRenderer — loading', () => {
	it('finishes immediately when the image has no omni settings', async () => {
		const scene = makeSogScene({ attrs: { preferSog: '' }, omni: null })
		const { calls } = installViewerFactory()
		stubFetch(() => binaryResponse())

		await new SogRenderer(scene.micrio).start(scene.image)

		expect(calls).toHaveLength(0)
		expect(progressValues(scene).at(-1)).toBe(1)
	})

	it('finishes immediately when the omni object has no captures', async () => {
		const scene = makeSogScene({ attrs: { preferSog: '' }, omni: { sog: [] } })
		const { calls } = installViewerFactory()
		stubFetch(() => binaryResponse())

		await new SogRenderer(scene.micrio).start(scene.image)

		expect(calls).toHaveLength(0)
		expect(progressValues(scene).at(-1)).toBe(1)
	})

	interface SelectionCase {
		title: string
		attrs: Record<string, string>
		omni?: Partial<Models.ImageInfo.OmniSettings>
		id?: string
		filename: string
		fraction?: number
		url?: RegExp
	}

	const selection: SelectionCase[] = [
		{
			title: 'picks the capture named by data-prefer-sog',
			attrs: { preferSog: 'm' },
			omni: { sog: [sogInfo('l', 1024, 111), sogInfo('m', 2048, 222)] },
			filename: 'abc123/m-222.sog',
			url: /\/abc123\/sog\/m-222\.sog\.bin$/,
		},
		{
			title: 'picks the capture named by the legacy data-prefer-splats',
			attrs: { preferSplats: 'xs' },
			omni: { sog: [sogInfo('l', 1024, 111), sogInfo('xs', 512, 333)] },
			filename: 'abc123/xs-333.sog',
		},
		{
			title: 'picks the capture named by data-sog',
			attrs: { sog: 'm' },
			omni: { sog: [sogInfo('l', 1024, 111), sogInfo('m', 2048, 222)] },
			filename: 'abc123/m-222.sog',
		},
		{
			title: 'falls back to the first capture under the size limit when the name is unknown',
			attrs: { preferSog: 'huge' },
			omni: { sog: [sogInfo('l', 1024, 111), sogInfo('m', 2048, 222)] },
			filename: 'abc123/l-111.sog',
		},
		{
			title: 'ignores a whitespace-only name',
			attrs: { preferSog: '   ' },
			omni: { sog: [sogInfo('l', 1024, 111)] },
			filename: 'abc123/l-111.sog',
		},
		{
			title: 'falls back to the first capture when no name is given',
			attrs: { preferSog: '' },
			omni: { sog: [sogInfo('l', 1024, 111), sogInfo('s', 512, 222)] },
			filename: 'abc123/l-111.sog',
		},
		{
			title: 'takes the largest capture when every one exceeds the fallback limit',
			attrs: { preferSog: '' },
			omni: { sog: [sogInfo('xl', 25 * 1024 * 1024, 111), sogInfo('xxl', 30 * 1024 * 1024, 222)] },
			filename: 'abc123/xxl-222.sog',
		},
		{
			title: 'encodes the image id and capture name in the request',
			attrs: { preferSog: 'm l' },
			id: 'a b',
			omni: { sog: [sogInfo('m l', 1024, 500)] },
			filename: 'a b/m l-500.sog',
			url: /\/a%20b\/sog\/m%20l-500\.sog\.bin$/,
		},
		{
			title: 'wraps a negative start index into the frame strip',
			attrs: { preferSog: '' },
			omni: {
				frames: 36,
				startIndex: -1,
				layers: [{ i18n: { en: 'Layer 1' } }, { i18n: { en: 'Layer 2' } }, { i18n: { en: 'Layer 3' } }],
			},
			filename: 'abc123/l-1000.sog',
			fraction: 11 / 12,
		},
		{
			title: 'wraps an oversized start index into the frame strip',
			attrs: { preferSog: '' },
			omni: {
				frames: 36,
				startIndex: 13,
				layers: [{ i18n: { en: 'Layer 1' } }, { i18n: { en: 'Layer 2' } }, { i18n: { en: 'Layer 3' } }],
			},
			filename: 'abc123/l-1000.sog',
			fraction: 1 / 12,
		},
		{
			title: 'starts at the first frame without layers',
			attrs: { preferSog: '' },
			omni: { frames: 24, startIndex: 0 },
			filename: 'abc123/l-1000.sog',
			fraction: 0,
		},
	]

	it.each(selection)('$title', async (testCase) => {
		const scene = makeSogScene({ attrs: testCase.attrs, omni: testCase.omni, id: testCase.id })
		const fetchMock = stubFetch(() => binaryResponse())
		const { calls } = installViewerFactory()
		const renderer = new SogRenderer(scene.micrio)

		await renderer.start(scene.image)

		expect(calls[0]?.filename).toBe(testCase.filename)
		if (testCase.fraction !== undefined) {
			expect(calls[0]?.startFrameFraction).toBeCloseTo(testCase.fraction, 8)
		}
		if (testCase.url) {
			expect(fetchMock.mock.calls[0]?.[0]).toMatch(testCase.url)
		}
		renderer.dispose()
	})

	it('falls back to the image path when the data path is relative or invalid', async () => {
		const relative = makeSogScene({ attrs: { preferSog: '' }, dataPath: '', infoPath: 'https://tiles.example/base/' })
		const relativeFetch = stubFetch(() => binaryResponse())
		installViewerFactory()
		await new SogRenderer(relative.micrio).start(relative.image)
		expect(relativeFetch.mock.calls[0]?.[0]).toBe('https://tiles.example/abc123/sog/l-1000.sog.bin')

		const invalid = makeSogScene({ attrs: { preferSog: '' }, dataPath: 'http://[' })
		const invalidFetch = stubFetch(() => binaryResponse())
		installViewerFactory()
		await new SogRenderer(invalid.micrio).start(invalid.image)
		expect(invalidFetch.mock.calls[0]?.[0]).toBe('http://[/abc123/sog/l-1000.sog.bin')
	})

	it('shows byte progress and revokes the object URL', async () => {
		const scene = makeSogScene({ attrs: { preferSog: '' } })
		stubFetch(() => binaryResponse([1, 2, 3, 4], 4))
		const createUrl = vi.spyOn(URL, 'createObjectURL')
		const revokeUrl = vi.spyOn(URL, 'revokeObjectURL')
		const { calls } = installViewerFactory()

		await new SogRenderer(scene.micrio).start(scene.image)

		expect(createUrl).toHaveBeenCalledWith(expect.any(Blob))
		expect(revokeUrl).toHaveBeenCalledWith(expect.stringMatching(/^blob:/))
		// 0.05 + (4 / 4) * 0.9 — a direct float comparison is not exact here.
		expect(progressValues(scene).some((value) => Math.abs(value - 0.95) < 1e-9)).toBe(true)
		expect(calls).toHaveLength(1)
	})

	it('downloads through arrayBuffer when the response has no stream', async () => {
		const scene = makeSogScene({ attrs: { preferSog: '' } })
		stubFetch(() => arrayBufferResponse())
		const { calls } = installViewerFactory()

		await new SogRenderer(scene.micrio).start(scene.image)

		expect(calls).toHaveLength(1)
		expect(progressValues(scene).at(-1)).toBe(1)
	})

	it('reports an HTTP failure and leaves no overlay behind', async () => {
		const scene = makeSogScene({ attrs: { sog: '' }, hybrid: true })
		stubFetch(() => new Response('missing', { status: 503 }))
		const error = vi.spyOn(console, 'error').mockImplementation(() => {})
		const { calls } = installViewerFactory()

		await new SogRenderer(scene.micrio).start(scene.image)

		expect(calls).toHaveLength(0)
		expect(error).toHaveBeenCalledWith('[Micrio] Could not load the SOG:', expect.any(Error))
		expect(scene.host.querySelector('canvas.micrio-sog')).toBeNull()
		expect(progressValues(scene).at(-1)).toBe(1)
	})

	it('reports a viewer factory that throws', async () => {
		const scene = makeSogScene({ attrs: { preferSog: '' } })
		stubFetch(() => binaryResponse())
		const error = vi.spyOn(console, 'error').mockImplementation(() => {})
		installViewerFactory(() => {
			throw new Error('viewer exploded')
		})

		await new SogRenderer(scene.micrio).start(scene.image)

		expect(error).toHaveBeenCalledWith('[Micrio] Could not load the SOG:', expect.any(Error))
		expect(progressValues(scene).at(-1)).toBe(1)
	})

	it('abandons a download that finishes after dispose', async () => {
		const scene = makeSogScene({ attrs: { preferSog: '' } })
		let resolveResponse: ((response: Response) => void) | undefined
		stubFetch(
			() =>
				new Promise<Response>((resolve) => {
					resolveResponse = resolve
				}),
		)
		const { calls } = installViewerFactory()
		const renderer = new SogRenderer(scene.micrio)

		const started = renderer.start(scene.image)
		await pollUntil(() => resolveResponse !== undefined, 1000, 'the SOG request')
		renderer.dispose()
		resolveResponse?.(binaryResponse())
		await started

		expect(calls).toHaveLength(0)
	})

	it('disposes a viewer that arrives after the renderer was torn down', async () => {
		const scene = makeSogScene({ attrs: { preferSog: '' } })
		stubFetch(() => binaryResponse())
		let resolveViewer: ((viewer: SogViewer) => void) | undefined
		const { calls } = installViewerFactory(
			() =>
				new Promise<SogViewer>((resolve) => {
					resolveViewer = resolve
				}),
		)
		const renderer = new SogRenderer(scene.micrio)

		const started = renderer.start(scene.image)
		await pollUntil(() => calls.length === 1, 1000, 'the viewer factory')
		const late = makeViewer(scene.photo)
		renderer.dispose()
		resolveViewer?.(late)
		await started

		expect(late.dispose).toHaveBeenCalledTimes(1)
	})
})

describe('SogRenderer — SOG-only lifecycle', () => {
	it('mirrors the view and camera rotation into the viewer', async () => {
		const scene = makeSogScene({ attrs: { preferSog: '' } })
		stubFetch(() => binaryResponse())
		const { calls, viewers } = installViewerFactory()
		const renderer = new SogRenderer(scene.micrio)

		await renderer.start(scene.image)
		const viewer = viewers[0]
		if (!viewer) {
			throw new Error('no viewer')
		}
		expect(calls[0]?.canvas).toBe(scene.photo)
		expect(viewer.resize).toHaveBeenCalledTimes(1)

		scene.view.set([0, 0, 1, 1])
		expect(viewer.setView).toHaveBeenCalledWith({ degrees: 0, view: [0, 0, 1, 1] })

		scene.rotation.set(90)
		expect(viewer.setView).toHaveBeenLastCalledWith({ degrees: 90, view: [0, 0, 1, 1] })

		scene.micrio.dispatchEvent(new Event('resize'))
		expect(viewer.resize).toHaveBeenCalledTimes(2)
		expect(viewer.setView).toHaveBeenLastCalledWith({ degrees: 90, view: [0, 0, 1, 1] })

		renderer.dispose()
		expect(viewer.dispose).toHaveBeenCalledTimes(1)
		expect(progressValues(scene).at(-1)).toBe(1)

		// Nothing is left subscribed or hooked after dispose.
		viewer.setView.mockClear()
		viewer.resize.mockClear()
		scene.view.set([0.5, 0.5, 0.5, 0.5])
		scene.micrio.dispatchEvent(new Event('resize'))
		expect(viewer.setView).not.toHaveBeenCalled()
		expect(viewer.resize).not.toHaveBeenCalled()
	})

	it('does not push the view before the camera has one', async () => {
		const scene = makeSogScene({ attrs: { preferSog: '' } })
		stubFetch(() => binaryResponse())
		const { viewers } = installViewerFactory()

		await new SogRenderer(scene.micrio).start(scene.image)

		expect(viewers[0]?.setView).not.toHaveBeenCalled()
	})

	it.each([true, false])('adopts a replacement viewer canvas (events enabled: %s)', async (enabled) => {
		const scene = makeSogScene({ attrs: { preferSog: '' } })
		scene.events.$enabled = enabled
		stubFetch(() => binaryResponse())
		const replacement = document.createElement('canvas')
		const { viewers } = installViewerFactory(() => makeViewer(replacement))

		await new SogRenderer(scene.micrio).start(scene.image)

		expect(scene.adopt).toHaveBeenCalledWith(replacement)
		expect(scene.events.unhook).toHaveBeenCalledTimes(1)
		expect(scene.events._el).toBe(replacement)
		expect(scene.events.hook).toHaveBeenCalledTimes(enabled ? 1 : 0)
		expect(viewers[0]?.resize).toHaveBeenCalledTimes(1)
	})
})

describe('SogRenderer — hybrid overlay', () => {
	it('creates a transparent overlay above the photograph', async () => {
		const scene = makeHybrid()
		stubFetch(() => binaryResponse())
		const originalGpu = Object.getOwnPropertyDescriptor(navigator, 'gpu')
		const state: { gpu?: unknown } = {}
		const { calls, viewers } = sizedFactory(state)

		await new SogRenderer(scene.micrio).start(scene.image)

		const overlay = calls[0]?.canvas
		if (!overlay) {
			throw new Error('no overlay canvas')
		}
		expect(overlay.classList.contains('micrio-sog')).toBe(true)
		expect(overlay.previousSibling).toBe(scene.photo)
		expect(scene.photo.nextSibling).toBe(overlay)
		// An own descriptor exists for the duration of the call, with no value.
		expect(state.gpu).toMatchObject({ value: undefined })
		expect(Object.getOwnPropertyDescriptor(navigator, 'gpu')).toEqual(originalGpu)
		expect(viewers[0]?.camera?.clearColor).toEqual({ r: 0, g: 0, b: 0, a: 0 })
		expect(viewers[0]?.resize).toHaveBeenCalledTimes(1)
	})

	it('hides and restores an own navigator.gpu descriptor around the call', async () => {
		const scene = makeHybrid()
		stubFetch(() => binaryResponse())
		const sentinel = { fake: true }
		const original = Object.getOwnPropertyDescriptor(navigator, 'gpu')
		Object.defineProperty(navigator, 'gpu', { value: sentinel, configurable: true })
		let seen: unknown = 'not called'
		const { calls } = installViewerFactory((options) => {
			seen = 'gpu' in navigator ? navigator.gpu : undefined
			options.canvas.width = 100
			options.canvas.height = 50
			return makeViewer(options.canvas)
		})

		try {
			await new SogRenderer(scene.micrio).start(scene.image)
			expect(seen).toBeUndefined()
			expect(navigator.gpu).toBe(sentinel)
			expect(calls).toHaveLength(1)
		} finally {
			if (original) {
				Object.defineProperty(navigator, 'gpu', original)
			} else {
				Reflect.deleteProperty(navigator, 'gpu')
			}
		}
	})

	it('appends the overlay to the element when the photo is detached', async () => {
		const scene = makeHybrid({ photoDetached: true })
		stubFetch(() => binaryResponse())
		const { calls } = sizedFactory()

		await new SogRenderer(scene.micrio).start(scene.image)

		expect(calls[0]?.canvas.parentElement).toBe(scene.host)
	})

	it('uses a canvas the viewer replaces instead of the one it was given', async () => {
		const scene = makeHybrid()
		stubFetch(() => binaryResponse())
		const { viewers } = installViewerFactory(() => makeViewer(document.createElement('canvas')))

		await new SogRenderer(scene.micrio).start(scene.image)

		const replacement = viewers[0]?.canvas
		expect(replacement).not.toBe(scene.photo)
		expect(scene.photo.nextSibling).toBe(replacement)
	})

	it.each([{ backend: 'webgpu' }, { hdr: true }])('drops the overlay for a non-alpha backend (%o)', async (flags) => {
		const scene = makeHybrid()
		stubFetch(() => binaryResponse())
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
		const { calls, viewers } = installViewerFactory((options) => makeViewer(options.canvas, flags))

		await new SogRenderer(scene.micrio).start(scene.image)

		expect(viewers[0]?.dispose).toHaveBeenCalledTimes(1)
		expect(calls[0]?.canvas.isConnected).toBe(false)
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('needs the WebGL viewer'))
	})

	it('copies the SOG alpha into the photo mask and releases it on dispose', async () => {
		const scene = makeHybrid()
		stubFetch(() => binaryResponse())
		const { calls, viewers } = sizedFactory()
		const renderer = new SogRenderer(scene.micrio)

		await renderer.start(scene.image)
		const overlay = calls[0]?.canvas
		if (!overlay) {
			throw new Error('no overlay canvas')
		}
		paint(overlay)
		scene.view.set([0, 0, 1, 1])
		await nextFrame()

		const mask = scene.webgl._setMask.mock.calls[0]?.[0] as HTMLCanvasElement | undefined
		expect(mask?.width).toBe(50)
		expect(mask?.height).toBe(25)
		expect(scene.webgl._setMaskEnabled).toHaveBeenCalledWith(true)
		expect(overlay.style.opacity).toBe('1')
		expect(overlay.style.transitionDuration).toBe('0s')
		expect(viewers[0]?.setView).toHaveBeenCalledWith({ degrees: 0, view: [0, 0, 1, 1] })

		renderer.dispose()

		expect(scene.webgl._setMaskEnabled).toHaveBeenCalledWith(false)
		expect(scene.webgl._setMask).toHaveBeenCalledWith()
		expect(scene.engine._sogSettled).toBe(true)
		expect(overlay.isConnected).toBe(false)
	})

	it('keeps polling for a viewer frame until the splat is drawn', async () => {
		const scene = makeHybrid()
		stubFetch(() => binaryResponse())
		const { calls, viewers } = sizedFactory()
		const renderer = new SogRenderer(scene.micrio)

		await renderer.start(scene.image)
		scene.view.set([0, 0, 1, 1])
		await nextFrame()
		expect(scene.webgl._setMask).not.toHaveBeenCalled()

		await sleep(140)
		await nextFrame()
		expect(viewers[0]?.requestRender).toHaveBeenCalled()
		expect(scene.webgl._setMask).not.toHaveBeenCalled()

		const overlay = calls[0]?.canvas
		if (!overlay) {
			throw new Error('no overlay canvas')
		}
		paint(overlay)
		await sleep(140)
		await nextFrame()
		expect(scene.webgl._setMask).toHaveBeenCalledTimes(1)
		renderer.dispose()
	})

	it('skips a capture while the overlay has no size', async () => {
		const scene = makeHybrid()
		stubFetch(() => binaryResponse())
		const { calls } = installViewerFactory((options) => {
			options.canvas.width = 0
			options.canvas.height = 0
			return makeViewer(options.canvas)
		})
		const renderer = new SogRenderer(scene.micrio)

		await renderer.start(scene.image)
		scene.view.set([0, 0, 1, 1])
		await nextFrame()

		expect(calls).toHaveLength(1)
		expect(scene.webgl._setMask).not.toHaveBeenCalled()
		renderer.dispose()
	})

	it('snaps to the nearest frame and crossfades to the photograph when idle', async () => {
		const scene = makeHybrid()
		stubFetch(() => binaryResponse())
		const { calls } = sizedFactory()
		const renderer = new SogRenderer(scene.micrio)

		await renderer.start(scene.image)
		const overlay = calls[0]?.canvas
		if (!overlay) {
			throw new Error('no overlay canvas')
		}
		paint(overlay)
		scene.view.set([0, 0, 1, 1])
		await nextFrame()

		// The first look away clears the stale frame; a second one must not clear twice.
		scene.rotation.set(100)
		scene.rotation.set(355)
		expect(scene.webgl._clear).toHaveBeenCalledTimes(1)

		await sleep(240) // idle -> snap starts
		await sleep(360) // snap -> settle finish
		await nextFrame()
		await nextFrame()

		expect(scene.setRotation.mock.calls.length).toBeGreaterThan(1)
		expect(scene.setRotation.mock.calls.at(-1)?.[0]).toBeCloseTo(0, 6)
		expect(scene.engine._sogSettled).toBe(true)
		expect(scene.engine.render).toHaveBeenCalled()
		expect(overlay.style.opacity).toBe('0')
		expect(overlay.style.transitionDuration).toBe('320ms')
		renderer.dispose()
	})

	it('fades out at once when the rotation already sits on a frame', async () => {
		const scene = makeHybrid()
		stubFetch(() => binaryResponse())
		const { calls } = sizedFactory()
		const renderer = new SogRenderer(scene.micrio)

		await renderer.start(scene.image)
		const overlay = calls[0]?.canvas
		if (!overlay) {
			throw new Error('no overlay canvas')
		}
		paint(overlay)
		scene.view.set([0, 0, 1, 1])
		await nextFrame()

		vi.useFakeTimers({ toFake: ['setTimeout'] })
		scene.rotation.set(10)
		await vi.advanceTimersByTimeAsync(220)
		await nextFrame()
		await nextFrame()

		expect(scene.setRotation).toHaveBeenLastCalledWith(10)
		expect(scene.engine._sogSettled).toBe(true)
		expect(overlay.style.opacity).toBe('0')
		renderer.dispose()
	})

	it('keeps the photograph when the settled view only pans', async () => {
		const scene = makeHybrid()
		stubFetch(() => binaryResponse())
		const { calls } = sizedFactory()
		const renderer = new SogRenderer(scene.micrio)

		await renderer.start(scene.image)
		const overlay = calls[0]?.canvas
		if (!overlay) {
			throw new Error('no overlay canvas')
		}
		paint(overlay)
		scene.view.set([0, 0, 1, 1])
		await nextFrame()
		await sleep(260)
		await nextFrame()
		await nextFrame()
		expect(overlay.style.opacity).toBe('0')

		const cleared = scene.webgl._clear.mock.calls.length
		// The pan exposes tiles that still have to load: the SOG becomes a
		// backdrop behind the photo instead of the photo disappearing.
		scene.engine.render.mockImplementation(() => {
			scene.engine._progress = 0.5
			scene.engine._toDrawTotal = 2
		})
		scene.view.set([0.1, 0.2, 1, 1])
		await nextFrame()
		expect(scene.webgl._clear).toHaveBeenCalledTimes(cleared)
		expect(scene.engine._sogSettled).toBe(true)
		expect(overlay.style.opacity).toBe('1')
		const children = [...scene.host.children]
		expect(children.indexOf(overlay)).toBeLessThan(children.indexOf(scene.photo))

		// Once the target layer is complete, the backdrop fades away.
		scene.engine._progress = 1
		scene.engine._toDrawTotal = 2
		scene.host.dispatchEvent(new Event('draw'))
		expect(overlay.style.opacity).toBe('0')

		// Changing the zoom still hands the view back to the SOG.
		scene.view.set([0.1, 0.1, 0.5, 0.5])
		await nextFrame()
		expect(scene.engine._sogSettled).toBe(false)
		expect(overlay.style.opacity).toBe('1')
		renderer.dispose()
	})

	it('cancels a running snap when the user grabs the SOG again', async () => {
		const scene = makeHybrid()
		stubFetch(() => binaryResponse())
		const { calls } = sizedFactory()
		const renderer = new SogRenderer(scene.micrio)

		await renderer.start(scene.image)
		const overlay = calls[0]?.canvas
		if (!overlay) {
			throw new Error('no overlay canvas')
		}
		paint(overlay)
		scene.view.set([0, 0, 1, 1])
		await nextFrame()

		vi.useFakeTimers({ toFake: ['setTimeout'] })
		scene.rotation.set(101)
		await vi.advanceTimersByTimeAsync(220)
		scene.host.dispatchEvent(new Event('pointerdown'))
		expect(overlay.style.opacity).toBe('1')
		expect(scene.engine._sogSettled).toBe(false)
		await nextFrame()
		await nextFrame()
		expect(overlay.style.opacity).toBe('1')

		scene.rotation.set(102)
		await vi.advanceTimersByTimeAsync(220)
		scene.host.dispatchEvent(new WheelEvent('wheel'))
		expect(overlay.style.opacity).toBe('1')
		expect(scene.engine._sogSettled).toBe(false)
		renderer.dispose()
	})
})
