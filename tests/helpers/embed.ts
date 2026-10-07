import { vi } from 'vitest'
import type { MicrioImage } from '$core/image'
import { writable, type Writable } from '$core/store'
import type { Models } from '$types/models'
import { createElement } from '$utils/dom'
import { mountViewer, waitFor, type Viewer } from './viewer'

/**
 * The `<micrio-embed>` harness.
 *
 * ## Two ways to mount an embed
 *
 * 1. **`mockHost()` + `fakeImage()`** — an empty, id-less `<micr-io>` provides the
 *    `micrio` context (`_getMicrio()` walks up to it), and the embed receives a
 *    hand-built mock of the *exact* `MicrioImage` surface `src/embed/embed.ts`
 *    touches. No image is opened, so **no WebGL context is created** (an id-less
 *    `<micr-io>` never calls `#print()`), which is what keeps a 30-test suite off
 *    Chromium's context budget. This is where the decision tables and edge
 *    branches live.
 * 2. **`openViewer()`** — a real `<micr-io>` opened on a real bundle. Used by the
 *    integration cases (real camera, real engine, real layout wiring), where the
 *    point is precisely that the mock is not involved.
 *
 * `fakeImage()` mocks the *contract* between the embed element and its parent
 * image/engine: `camera.getMatrix` / `camera._getXYDirect` (the coordinate
 * seams, also overridable in production book3d), `engine.render`/`_fadeImage`,
 * `addEmbed`, the writable stores, and the media-element registry. It also mirrors
 * the sub-image claim lifecycle the element drives (`_orphanEmbed`/`_adoptEmbed`/
 * `_releaseOrphans`, backed by `engine._removeEmbed`). If the real `MicrioImage`
 * API changes shape, this mock is what has to be updated — the
 * `embed-viewer`/`image-embeds` suites are the guard against that drift.
 *
 * ## Mounting rules
 *
 * `createElement` applies `setProps` *before* appending, so `_onMount` always
 * sees its props. `MicrioEmbed._setProps` only merges — props cannot be
 * replaced after mount. Always `remove()` an embed when a test is done: that is
 * what runs `_onDestroy` and releases its store subscriptions.
 */

/** The embedded Micrio sub-image `image.addEmbed()` hands back. */
export interface FakeGlImage {
	_placed: boolean
	uuid: string
	$info: Partial<Models.ImageInfo.ImageInfo>
	camera: { setArea: ReturnType<typeof vi.fn>; setRotation: ReturnType<typeof vi.fn> }
	/** `GLEmbedVideo` subscribes to the sub-image's own visibility. */
	visible?: Writable<boolean>
	video?: Writable<HTMLVideoElement | undefined>
	opacity?: number
}

/** The `MicrioImage` surface `src/embed/embed.ts` actually reads/calls. */
export interface FakeImage {
	id: string
	uuid: string
	_is360: boolean
	_placed: boolean
	$info: Models.ImageInfo.ImageInfo
	$settings: Models.ImageInfo.Settings
	album?: Models.Album
	data: Writable<Models.ImageData.ImageData | undefined>
	visible: Writable<boolean>
	video: Writable<HTMLVideoElement | undefined>
	_video: HTMLVideoElement | undefined
	_embeds: FakeGlImage[]
	state: {
		view: Writable<Models.Camera.View | undefined>
		/** `#click` writes a marker **id string**, not a marker object (see `State.Image.marker`). */
		marker: Writable<Models.ImageData.Marker | string | undefined>
	}
	_viewport: Writable<Models.Camera.View>
	grid?: {
		_focussed: Writable<MicrioImage | undefined>
		_markersShown: Writable<MicrioImage[]>
	}
	camera: {
		image: FakeImage
		getMatrix: ReturnType<typeof vi.fn>
		_getXYDirect: ReturnType<typeof vi.fn>
		setArea: ReturnType<typeof vi.fn>
		setRotation: ReturnType<typeof vi.fn>
		isZoomedOut: () => boolean
	}
	engine: {
		ready: boolean
		render: ReturnType<typeof vi.fn>
		_fadeImage: ReturnType<typeof vi.fn>
		_setImageVideoPlaying: ReturnType<typeof vi.fn>
		_removeEmbed: ReturnType<typeof vi.fn>
	}
	addEmbed: ReturnType<typeof vi.fn>
	/** The sub-image claim lifecycle the embed element drives (mirrors `MicrioImage`). */
	_orphanEmbed: (img: FakeGlImage) => void
	_adoptEmbed: (img: FakeGlImage) => void
	_releaseOrphans: () => void
	_setEmbedMediaElement: (id: string, el?: HTMLMediaElement) => void
	getEmbedMediaElement: (id: string) => HTMLMediaElement | undefined
}

/**
 * A mock `MicrioImage` for `src/embed` tests.
 *
 * Defaults are the "boring middle": a 512×512 2D image with a ready engine, an
 * area-free view, and an inert (invisible) `visible` store — the latter keeps a
 * `GLEmbedVideo` constructed through the embed element from loading anything
 * until a test asks it to. `overrides` are shallow-merged, so a test replaces a
 * whole nested member (e.g. `engine`) rather than poking inside it.
 */
export function fakeImage(overrides: Partial<FakeImage> = {}): FakeImage {
	const elements = new Map<string, HTMLMediaElement>()
	const embeds: FakeGlImage[] = []
	/** Sub-images whose owning embed is gone, mirroring `MicrioImage.#orphanedEmbeds`. */
	const orphans = new Set<FakeGlImage>()

	const image = {
		id: 'img-id',
		uuid: 'img-uuid',
		_is360: false,
		_placed: true,
		$info: {
			id: 'img-id',
			path: 'https://r2.micr.io/',
			version: '6.1.11',
			width: 512,
			height: 512,
			tileSize: 256,
		} as Models.ImageInfo.ImageInfo,
		$settings: {} as Models.ImageInfo.Settings,
		data: writable<Models.ImageData.ImageData | undefined>(),
		visible: writable(false),
		video: writable<HTMLVideoElement | undefined>(),
		_video: undefined,
		_embeds: embeds,
		state: {
			view: writable<Models.Camera.View | undefined>(),
			marker: writable<Models.ImageData.Marker | string | undefined>(),
		},
		_viewport: writable<Models.Camera.View>([0, 0, 0, 0]),
		camera: {
			image: undefined as unknown as FakeImage,
			// The default transform seams: a plain `[x, y, scale]` mapping and a
			// valid (all-equal) 4x4 matrix. Tests override either with
			// `mockReturnValue`/`mockImplementation` and inspect `mock.calls`.
			_getXYDirect: vi.fn(() => new Float64Array([0, 0, 1, 0])),
			getMatrix: vi.fn(() => new Float32Array(16).fill(1)),
			setArea: vi.fn(),
			setRotation: vi.fn(),
			isZoomedOut: () => true,
		},
		engine: {
			ready: true,
			render: vi.fn(),
			_fadeImage: vi.fn(),
			_setImageVideoPlaying: vi.fn(),
			_removeEmbed: vi.fn(),
		},
		// Emulate `MicrioImage.addEmbed`, which registers the new sub-image on
		// `_embeds` — the element's reuse path reads exactly that.
		addEmbed: vi.fn(
			(
				info: Partial<Models.ImageInfo.ImageInfo>,
				_settings: unknown,
				_area: unknown,
				opts?: Models.Embeds.EmbedOptions,
			) => {
				const gl: FakeGlImage = {
					_placed: false,
					uuid: `gl-${embeds.length}`,
					$info: { ...info },
					camera: { setArea: vi.fn(), setRotation: vi.fn() },
					// Inert by default: `GLEmbedVideo` only loads once the sub-image
					// reports itself visible, and its own suite drives that.
					visible: writable(false),
					video: writable<HTMLVideoElement | undefined>(),
					opacity: opts?.opacity,
				}
				embeds.push(gl)
				return gl
			},
		),
		// Mirrors `MicrioImage._orphanEmbed`/`_adoptEmbed`/`_releaseOrphans`: an orphan is
		// faded out, kept on `_embeds`, and released on the next sweep unless re-adopted.
		_orphanEmbed: (img: FakeGlImage) => {
			if (!embeds.includes(img)) {
				return
			}
			orphans.add(img)
			img.visible?.set(false)
			image.engine._fadeImage(img, 0)
		},
		_adoptEmbed: (img: FakeGlImage) => {
			orphans.delete(img)
		},
		_releaseOrphans: () => {
			if (orphans.size === 0) {
				return
			}
			for (const img of orphans) {
				const i = embeds.indexOf(img)
				if (i >= 0) {
					embeds.splice(i, 1)
				}
				image.engine._removeEmbed(img)
			}
			orphans.clear()
		},
		_setEmbedMediaElement: (id: string, el?: HTMLMediaElement) => {
			if (el) {
				elements.set(id, el)
			} else {
				elements.delete(id)
			}
		},
		getEmbedMediaElement: (id: string) => elements.get(id),
	}

	image.camera.image = image

	return Object.assign(image, overrides) as FakeImage
}

/** Mounts an empty, id-less `<micr-io>` to provide the `micrio` context. */
export function mockHost(attrs: Record<string, string> = {}): Viewer {
	return mountViewer(attrs)
}

/** Points the host at `image` as its current image (what `#isBook3d` reads). */
export function setCurrent(host: Viewer, image: FakeImage | MicrioImage): void {
	host.el.current.set(image as unknown as MicrioImage)
}

/**
 * Mounts a `<micrio-embed>` under `parent` with the given props.
 * `image` accepts a {@link FakeImage} or a real one; the props record is
 * untyped at the `createElement` boundary, so no cast is needed at the call.
 */
export function mountEmbed(
	props: { embed: Models.ImageData.Embed; image: FakeImage | MicrioImage; marker?: Models.ImageData.Marker },
	parent: HTMLElement,
): HTMLElement {
	return createElement('micrio-embed', { setProps: props, parent })
}

/** The `<a>`/`<div>` overlay `#buildDOM` creates, if the embed has an HTML layer. */
export const containerOf = (el: Element): HTMLElement | null =>
	el.querySelector<HTMLElement>(':scope > a, :scope > div')

/** The `<img>`/`<video>`/`<iframe>`/`<button>` inside the overlay. */
export const contentOf = (el: Element): HTMLElement | null => containerOf(el)?.firstElementChild as HTMLElement | null

/** Reads a custom property the element wrote on the overlay. */
export const cssVar = (el: Element, name: string): string => containerOf(el)?.style.getPropertyValue(name) ?? ''

/** Dispatches the editor-driven `change` event `#onChange` listens for. */
export function dispatchChange(el: EventTarget, detail?: object): void {
	el.dispatchEvent(new CustomEvent('change', detail === undefined ? {} : { detail }))
}

/**
 * Opens a real viewer on `bundle` and waits until it has finished loading.
 * Used by integration cases only.
 */
export async function openViewer(
	bundle: Models.ImageBundle.BundleImage,
	attrs: Record<string, string> = {},
): Promise<Viewer> {
	const viewer = mountViewer(attrs)
	await viewer.open(bundle)
	return viewer
}

/** Opens a fresh 2D image bundle, optionally carrying embeds. */
export async function openEmbedImage(
	bundle: Models.ImageBundle.BundleImage,
	attrs: Record<string, string> = {},
): Promise<{ viewer: Viewer; image: MicrioImage; id: string }> {
	const viewer = await openViewer(bundle, attrs)
	await waitFor(() => viewer.el.$current?.id === bundle.id, 4000, `current image ${bundle.id}`)
	const image = viewer.el.$current
	if (!image) {
		throw new Error('the embed image never became current')
	}
	return { viewer, image, id: bundle.id }
}
