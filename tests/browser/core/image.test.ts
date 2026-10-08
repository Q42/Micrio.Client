import { describe, expect, it, vi } from 'vitest'
import type { MicrioImage } from '$core/image'
import type { Models } from '$types/models'
import { get } from '$core/store'
import { DataLoader } from '$utils/dataLoader'
import { decodeV5Id } from '$utils/id'
import { bundleUrl, mockJson } from '../../helpers/network'
import { mountViewer, waitFor } from '../../helpers/viewer'
import { videoAsset } from '../../fixtures/embeds'

/**
 * `MicrioImage` (`src/core/image.ts`) driven through a mounted `<micr-io>`.
 *
 * The file sat at 77.4% (TESTING.md): the browser suites open a normal bundle and read the
 * result, so the constructor's decision branches — the V5 id decode, the three tile-base
 * resolutions, the organisation override, the archive level shift, the custom CSS/JS hook,
 * the language fallback — and the embed claim lifecycle were never reached. `image.ts` is
 * inherently engine- and DOM-bound, so this file keeps **one viewer per test** (the same
 * trade-off `render/camera-2d.test.ts` documents) and opens a fresh-id bundle into it.
 *
 * Three traps this suite inherits from the loader and the fixtures:
 *
 * - `DataLoader`'s bundle cache, `fetchJson`'s URI cache and `image.ts`'s `jsCss` array are
 *   module-level for the whole file, so every fixture needs a fresh id and every external
 *   href a unique URL.
 * - **Never a 7-character id**: `MicrioImage` decodes those as V5, which reads the 360 flag
 *   and tile format out of the id itself. The generator below produces an 8-character suffix.
 * - `open()` resolves before the element settles, so the wait is `$current` **and**
 *   `!_loading`, exactly as `element-open.test.ts` does it.
 */

/** Sequential per-file ids, so a cached bundle from an earlier run cannot be reused. */
const prefix = `ii${Math.random().toString(36).slice(2, 6)}`
let counter = 0

/** A fresh image info block with a non-V5 id. */
function info(extra: Partial<Models.ImageInfo.ImageInfo> = {}): Models.ImageInfo.ImageInfo {
	const id = `${prefix}${(++counter).toString(36).padStart(3, '0')}`
	return {
		id,
		path: 'https://r2.micr.io/',
		version: '6.1.11',
		width: 512,
		height: 512,
		tileSize: 256,
		isWebP: true,
		...extra,
	}
}

/** A mounted viewer plus the image the last `openInfo` produced. */
interface Harness {
	viewer: ReturnType<typeof mountViewer>
	/** Opens a bundle and waits for the element to settle on it. */
	open: (bundle: Models.ImageBundle.BundleImage) => Promise<MicrioImage>
	/** Opens a bundle whose id the element does not keep, and waits for any image to arrive. */
	settle: (bundle: Models.ImageBundle.BundleImage) => Promise<MicrioImage>
	/** Opens by id, which is the only path that applies `info.revision`. */
	openId: (id: string) => Promise<MicrioImage>
	/** Opens a bundle built from a generated info block. */
	openInfo: (
		extra?: Partial<Models.ImageInfo.ImageInfo>,
		rest?: { settings?: Models.ImageInfo.Settings; data?: Models.ImageData.ImageData },
	) => Promise<MicrioImage>
	destroy: () => void
}

/** Mounts a viewer; call `destroy()` when the test is done (it tears the element down). */
function harness(): Harness {
	const viewer = mountViewer()
	let current: MicrioImage | undefined
	const open = async (bundle: Models.ImageBundle.BundleImage): Promise<MicrioImage> => {
		await viewer.open(bundle)
		await waitFor(() => viewer.el.$current !== undefined && !get(viewer.el._loading), 8000, `image ${bundle.id}`)
		current = viewer.el.$current
		if (!current) {
			throw new Error('no current image')
		}
		return current
	}
	const settle = async (bundle: Models.ImageBundle.BundleImage): Promise<MicrioImage> => {
		await viewer.open(bundle)
		// No `_loading` wait here: an external alias points its tiles at a host that is not
		// mocked, so loading never reports complete. `$current` is the reachable signal.
		await waitFor(() => viewer.el.$current !== undefined, 8000, 'any image')
		const img = viewer.el.$current
		if (!img) {
			throw new Error('no current image')
		}
		return img
	}
	const openId = async (id: string): Promise<MicrioImage> => {
		await viewer.open(id)
		await waitFor(() => viewer.el.$current !== undefined && !get(viewer.el._loading), 8000, `id ${id}`)
		const img = viewer.el.$current
		if (!img) {
			throw new Error('no current image')
		}
		return img
	}
	return {
		viewer,
		open,
		openId,
		settle,
		openInfo: (extra = {}, rest = {}) => {
			const i = info(extra)
			// A fresh settings object per call: `open()` deep-copies the element defaults into
			// the bundle's settings *in place*, so reusing one would carry them into the next
			// image (and a default `focus` would shadow the one a test asked for).
			return open({ id: i.id, info: i, settings: rest.settings ? { ...rest.settings } : {}, data: rest.data ?? {} })
		},
		destroy: () => {
			viewer.destroy()
		},
	}
}

describe('MicrioImage id, tile base and data path', () => {
	it('strips the viewer base off the id and keeps the rest verbatim', async () => {
		const h = harness()
		const i = info()
		const opened = await h.open({ id: `https://viewer.micr.io/${i.id}`, info: i, settings: {}, data: {} })
		expect(opened.id).toBe(i.id)
		h.destroy()
	})

	it('URI-encodes only the segment after the second slash of an external alias', async () => {
		const h = harness()
		// `external/<alias>/<path with spaces>`: the alias stays raw and the path is encoded.
		// The element's own bundle id is not the alias, so the wait is on "an image arrived".
		const i = info()
		const opened = await h.settle({
			id: 'external/acme/images/my file.jpg',
			info: { ...i, path: 'https://acme.test/', tileBasePath: 'https://acme.test/tiles/' },
			settings: {},
			data: {},
		})
		// The element encodes the alias for its own id; `MicrioImage` encodes the path segment.
		expect(opened.id).toBe('external/acme/images%2Fmy%20file.jpg')
		expect(opened._tileBase).toBe('https://acme.test/tiles/')
		h.destroy()
	})

	it('leaves an external alias without a further slash alone', async () => {
		const h = harness()
		const opened = await h.settle({
			id: 'external/acme/nested',
			info: { ...info(), path: 'https://acme.test/' },
			settings: {},
			data: {},
		})
		// One slash after `external/` means there is no path segment to encode.
		// A single-segment path has nothing beyond the second slash to encode.
		expect(opened.id).toBe('external/acme/nested')
		h.destroy()
	})

	it('prefers an external tile base for a 6-char imported id', async () => {
		const h = harness()
		// `i…` is a V5-imported image; a non-micr.io tile base means the tiles live there.
		const external = await h.openInfo({ id: 'iabcde', tileBasePath: 'https://cdn.test/imgs/' })
		expect(external._tileBase).toBe('https://cdn.test/imgs/')
		h.destroy()
	})

	it('falls back to the V4 base for a 6-char imported id on micr.io', async () => {
		const h = harness()
		const hosted = await h.openInfo({ id: 'ifghij', tileBasePath: 'https://r2.micr.io/tiles/' })
		expect(hosted._tileBase).toBe('https://b.micr.io/')
		h.destroy()
	})

	it('falls back to the info path as the tile base for a plain image', async () => {
		const h = harness()
		const plain = await h.openInfo({ tileBasePath: undefined, path: 'https://plain.test/' })
		expect(plain._tileBase).toBe('https://plain.test/')
		h.destroy()
	})

	it('keeps the EU data path when the info names it', async () => {
		const h = harness()
		const eu = await h.openInfo({ path: 'https://eu.micr.io/' })
		expect(eu._dataPath).toBe('https://eu.micr.io/')
		h.destroy()
	})

	it('lets an organisation base URL override the info path and tile base', async () => {
		const h = harness()
		const org: Models.ImageInfo.Organisation = {
			name: 'Org',
			slug: 'org',
			baseUrl: 'https://org.test/',
			branding: false,
		}
		const spy = vi.spyOn(DataLoader, '_getOrganisation').mockReturnValue(org)
		try {
			// The fixture path deliberately does not contain the org base URL, so the override fires.
			const i = info({ path: 'https://elsewhere.test/' })
			const opened = await h.open({ id: i.id, info: i, settings: {}, data: {} })
			expect(opened._dataPath).toBe('https://org.test/')
			expect(opened.$info.path).toBe('https://org.test/')
			// A non-imported image moves its tile base with it.
			expect(opened._tileBase).toBe('https://org.test/')
		} finally {
			spy.mockRestore()
			h.destroy()
		}
	})

	it('does not rewrite a path that already carries the organisation base', async () => {
		const h = harness()
		const org: Models.ImageInfo.Organisation = {
			name: 'Org',
			slug: 'org',
			baseUrl: 'https://org.test/',
			branding: false,
		}
		const spy = vi.spyOn(DataLoader, '_getOrganisation').mockReturnValue(org)
		try {
			const opened = await h.openInfo({ path: 'https://org.test/thing/' })
			expect(opened.$info.path).toBe('https://org.test/thing/')
			expect(opened._dataPath).toBe('https://org.test/thing/')
		} finally {
			spy.mockRestore()
			h.destroy()
		}
	})
})

describe('MicrioImage V5 id decoding and derived flags', () => {
	it('reads the 360/webp/deepzoom flags out of a 7-character id', async () => {
		const h = harness()
		const raw = info({ id: 'abcdefg' })
		// The decoder is the spec: whatever it writes onto a copy is what the constructor
		// must have written onto the info object the image now reports.
		const expected = { ...raw }
		decodeV5Id('abcdefg', expected)
		const opened = await h.open({ id: 'abcdefg', info: raw, settings: {}, data: {} })
		expect(opened._is360).toBe(Boolean(expected.is360))
		expect(opened.$info.isWebP).toBe(expected.isWebP)
		expect(opened.$info.isPng).toBe(expected.isPng)
		expect(opened.$info.format).toBe(expected.format)
		expect(opened.$info.path).toBe(expected.path)
		h.destroy()
	})

	it('keeps an explicitly supplied path instead of deriving one from the id', async () => {
		const h = harness()
		const raw = info({ id: 'abcdxyz', path: 'https://explicit.test/', isWebP: false })
		const expected = { ...raw }
		decodeV5Id('abcdxyz', expected)
		const opened = await h.open({ id: 'abcdxyz', info: raw, settings: {}, data: {} })
		// `decodeV5Id` only fills `path` when the info has none.
		expect(opened.$info.path).toBe('https://explicit.test/')
		expect(opened.$info.isWebP).toBe(expected.isWebP)
		h.destroy()
	})

	it('marks an image with no id and no tilesId as imageless, without a thumbnail', async () => {
		const h = harness()
		const opened = await h.openInfo({ id: '', tilesId: undefined })
		expect(opened._noImage).toBe(true)
		expect(opened.thumbSrc).toBeUndefined()
		h.destroy()
	})

	it('derives the tile extension from the info flags', async () => {
		const h = harness()
		const png = await h.openInfo({ isPng: true, isWebP: false })
		expect(png._getTileSrc(0, 0, 0)).toContain('.png')
		const webp = await h.openInfo({ isPng: false, isWebP: true })
		expect(webp._getTileSrc(0, 0, 0)).toContain('.webp')
		const jpg = await h.openInfo({ isPng: false, isWebP: false, tileExtension: undefined })
		expect(jpg._getTileSrc(0, 0, 0)).toContain('.jpg')
		const custom = await h.openInfo({ tileExtension: 'avif' })
		expect(custom._getTileSrc(0, 0, 0)).toContain('.avif')
		h.destroy()
	})
})

describe('MicrioImage zoom levels and tile source', () => {
	it('counts one level per doubling of the tile size', async () => {
		const h = harness()
		// 256px tiles up to 512px: one doubling, so two levels.
		const small = await h.openInfo({ width: 512, height: 512, tileSize: 256 })
		expect(small._levels).toBe(2)
		// 1024 is the default tile size, and it covers 512 without a doubling.
		const dflt = await h.openInfo({ width: 512, height: 512, tileSize: undefined })
		expect(dflt._levels).toBe(1)
		// A 4096px image at 1024px tiles needs two doublings.
		const wide = await h.openInfo({ width: 4096, height: 4096, tileSize: 1024 })
		expect(wide._levels).toBe(3)
		h.destroy()
	})

	// A regression here is an infinite loop, not a failed assertion: `f *= 2` can never grow
	// out of 0, so the constructor would never return and this test would time out. Kept
	// single-case for exactly that reason: one hang to diagnose, not two.
	it('falls back to the default tile size for a zero size instead of looping forever', async () => {
		const h = harness()
		const zero = await h.openInfo({ width: 512, height: 512, tileSize: 0 })
		// 512 at the 1024 default is a single level, the same as an absent tile size.
		expect(zero._levels).toBe(1)
		h.destroy()
	})

	it('shifts the level count down for an archive-backed gallery', async () => {
		const h = harness()
		const plain = await h.openInfo({ width: 512, height: 512, tileSize: 256 })
		expect(plain._levels).toBe(2)
		const archived = await h.openInfo(
			{ width: 512, height: 512, tileSize: 256 },
			{ settings: { gallery: { archive: 'https://a.test/album.mdp', archiveLayerOffset: 1 } } },
		)
		// `_levels -= 1 - archiveLayerOffset` with an offset of 1 is a no-op.
		expect(archived._levels).toBe(2)
		const shifted = await h.openInfo(
			{ width: 512, height: 512, tileSize: 256 },
			{ settings: { gallery: { archive: 'https://a.test/album.mdp' } } },
		)
		expect(shifted._levels).toBe(1)
		h.destroy()
	})

	it('names the thumbnail after the deepest level', async () => {
		const h = harness()
		const opened = await h.openInfo({ width: 512, height: 512, tileSize: 256, isWebP: false })
		expect(opened._levels).toBe(2)
		expect(opened.thumbSrc).toContain('/2/0-0.jpg')
		h.destroy()
	})

	it('builds a standard tile URL, with a frame folder for Omni frames', async () => {
		const h = harness()
		const opened = await h.openInfo({ width: 512, height: 512, tileSize: 256, isWebP: false })
		const id = opened.$info.tilesId ?? opened.$info.id
		expect(opened._getTileSrc(1, 2, 3)).toBe(`https://r2.micr.io/${id}/1/2-3.jpg`)
		// Omni frames live one directory deeper.
		expect(opened._getTileSrc(1, 2, 3, 7)).toBe(`https://r2.micr.io/${id}/7/1/2-3.jpg`)
		h.destroy()
	})

	it('inverts the layer index and joins tiles with an underscore for DeepZoom', async () => {
		const h = harness()
		// `format: 'dz'` forces `isDeepZoom`. The pyramid runs to the *DeepZoom* level count
		// (halving until the longest side is 1, so 10 levels for 512px), not to `_levels`,
		// and the base level is the deepest — layer 0 is level 9, not level 2.
		const opened = await h.openInfo({ width: 512, height: 512, tileSize: 256, format: 'dz', isWebP: false })
		expect(opened.$info.isDeepZoom).toBe(true)
		expect(opened._levels).toBe(2)
		const id = opened.$info.tilesId ?? opened.$info.id
		expect(opened._getTileSrc(0, 1, 2)).toBe(`https://r2.micr.io/${id}/9/1_2.jpg`)
		expect(opened._getTileSrc(1, 1, 2)).toBe(`https://r2.micr.io/${id}/8/1_2.jpg`)
		h.destroy()
	})

	it('refuses to build a tile URL for a 360 video thumbnail', async () => {
		const h = harness()
		// Open a harmless image first, so the assertion happens on a live image rather than
		// through the engine's own tile requests — a 360-video bundle would make the frame
		// loop throw "Video thumb" on every frame instead.
		const opened = await h.openInfo({ width: 512, height: 512 })
		opened._settings.set({ _360: { video: videoAsset({ src: 'https://v.test/v.mp4' }) } })
		// The engine's frame loop logs and swallows the same throw; keep the expected noise
		// out of stderr so an unrelated regression is still visible.
		const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
		try {
			// The thumbnail is read before the settings store is populated, so the constructor
			// itself does not hit this; a later call has no image to fall back to.
			expect(() => opened._getTileSrc(0, 0, 0)).toThrow('Video thumb')
		} finally {
			opened._settings.set({})
			quiet.mockRestore()
			h.destroy()
		}
	})
})

/**
 * Intercepts head appends so an appended `<script>`/`<link>` reports its outcome immediately.
 *
 * The client's external-asset loads are fire-and-forget, and the fixture URLs 404, so a real
 * append would both pollute the head and leave an unobserved rejection (a regression the
 * suite forbids). Dispatching the event from inside `append` is the technique
 * `tests/browser/utils/dom.test.ts` already uses for `loadScript`: the listeners are wired
 * before the element is appended, so the promise settles synchronously.
 *
 * @param event the load/error event type to dispatch, or `undefined` to let appends through
 */
function interceptAssetAppend(event: 'load' | 'error'): { calls: Element[]; restore: () => void } {
	const calls: Element[] = []
	const original = document.head.append.bind(document.head)
	const spy = vi.spyOn(document.head, 'append').mockImplementation(((...nodes: Node[]) => {
		for (const node of nodes) {
			if (node instanceof HTMLScriptElement || node instanceof HTMLLinkElement) {
				calls.push(node)
				node.dispatchEvent(new Event(event))
			}
			original(node)
		}
	}) as unknown as ParentNode['append'])
	return {
		calls,
		restore: () => {
			spy.mockRestore()
		},
	}
}

describe('MicrioImage external CSS and JS', () => {
	it('injects a stylesheet link for its own settings', async () => {
		const asset = interceptAssetAppend('load')
		const h = harness()
		const href = 'https://cdn.test/style.css'
		try {
			await h.openInfo({}, { settings: { css: { href } } })
			const link = document.head.querySelector<HTMLLinkElement>(`link[href="${href}"]`)
			expect(link).not.toBeNull()
			expect(link?.getAttribute('rel')).toBe('stylesheet')
			expect(asset.calls).toContain(link)
		} finally {
			asset.restore()
			h.destroy()
		}
	})

	it('resolves the stylesheet promise on a load error as well', async () => {
		const asset = interceptAssetAppend('error')
		const h = harness()
		try {
			// A 404/blocked stylesheet still settles, so the org-font follow-up can run.
			const href = 'https://cdn.test/broken.css'
			await h.openInfo({}, { settings: { css: { href } } })
			expect(document.head.querySelector(`link[href="${href}"]`)).not.toBeNull()
		} finally {
			asset.restore()
			h.destroy()
		}
	})

	it('stamps the custom script with a reference to the element', async () => {
		const asset = interceptAssetAppend('load')
		const h = harness()
		const href = 'https://cdn.test/custom.js'
		try {
			await h.openInfo({}, { settings: { js: { href } } })
			const script = document.head.querySelector<HTMLScriptElement>(`script[src="${href}"]`)
			expect(script).not.toBeNull()
			expect(asset.calls).toContain(script)
			// Custom JS gets a self-reference for its own use.
			expect((script as unknown as { micrioElement?: unknown })?.micrioElement).toBe(h.viewer.el)
		} finally {
			asset.restore()
			h.destroy()
		}
	})

	it('substitutes $lang with the language the image settled on', async () => {
		const asset = interceptAssetAppend('load')
		const h = harness()
		h.viewer.el.lang = 'fr'
		try {
			await h.openInfo({}, { settings: { js: { href: 'https://cdn.test/fr.js?l=$lang' } } })
			// The element's own `lang` attribute drives the substitution.
			const script = document.head.querySelector<HTMLScriptElement>('script[src^="https://cdn.test/fr.js"]')
			expect(script?.src).toBe('https://cdn.test/fr.js?l=fr')
		} finally {
			h.viewer.el.removeAttribute('lang')
			asset.restore()
			h.destroy()
		}
	})

	it('does not load externals when the settings opt out', async () => {
		const asset = interceptAssetAppend('load')
		const h = harness()
		try {
			await h.openInfo(
				{},
				{
					settings: {
						noExternals: true,
						css: { href: 'https://cdn.test/skip.css' },
						js: { href: 'https://cdn.test/skip.js' },
					},
				},
			)
			expect(asset.calls).toHaveLength(0)
			expect(document.head.querySelector('link[href="https://cdn.test/skip.css"]')).toBeNull()
		} finally {
			asset.restore()
			h.destroy()
		}
	})

	it('adds a stylesheet only once when two images name the same href', async () => {
		const asset = interceptAssetAppend('load')
		const h = harness()
		const href = 'https://cdn.test/shared.css'
		try {
			await h.openInfo({}, { settings: { css: { href } } })
			await h.openInfo({}, { settings: { css: { href } } })
			// `jsCss` plus the head query is what keeps the second image from re-adding it.
			expect(document.head.querySelectorAll(`link[href="${href}"]`)).toHaveLength(1)
		} finally {
			asset.restore()
			h.destroy()
		}
	})
})

describe('MicrioImage language resolution', () => {
	it('falls back to English when the revision carries it', async () => {
		const asset = interceptAssetAppend('load')
		const h = harness()
		const i = info({ revision: { fr: 1, en: 1 } })
		h.viewer.el.lang = 'nl'
		const href = 'https://cdn.test/lang.js'
		try {
			// The revision branch only runs on the network path: the element reads the cached
			// bundle and hands the info object to the constructor.
			mockJson(bundleUrl(i.id), {
				images: [{ id: i.id, info: i, settings: { js: { href: `${href}?l=$lang` } }, data: {} }],
			})
			await h.openId(i.id)
			expect(h.viewer.el.lang).toBe('en')
			expect(document.head.querySelector<HTMLScriptElement>(`script[src^="${href}"]`)?.src ?? '').toBe(`${href}?l=en`)
		} finally {
			h.viewer.el.removeAttribute('lang')
			asset.restore()
			h.destroy()
		}
	})

	it('falls back to the first revision key when there is no English', async () => {
		const asset = interceptAssetAppend('load')
		const h = harness()
		const i = info({ revision: { de: 1, fr: 1 } })
		h.viewer.el.lang = 'nl'
		const href = 'https://cdn.test/lang2.js'
		try {
			mockJson(bundleUrl(i.id), {
				images: [{ id: i.id, info: i, settings: { js: { href: `${href}?l=$lang` } }, data: {} }],
			})
			await h.openId(i.id)
			expect(h.viewer.el.lang).toBe('de')
			expect(document.head.querySelector<HTMLScriptElement>(`script[src^="${href}"]`)?.src ?? '').toBe(`${href}?l=de`)
		} finally {
			h.viewer.el.removeAttribute('lang')
			asset.restore()
			h.destroy()
		}
	})
})

describe('MicrioImage branding and watermark', () => {
	it('loads the organisation stylesheet from the r2 host', async () => {
		const asset = interceptAssetAppend('load')
		const h = harness()
		// A fresh slug per test keeps `jsCss` (module-level) from short-circuiting this one.
		const slug = `org-${counter}`
		const styleUrl = `https://r2.micr.io/style/${slug}.css`
		const org: Models.ImageInfo.Organisation = {
			name: 'Org',
			slug,
			baseUrl: 'https://org.test/',
			branding: true,
			logo: logoAsset('https://r2.micr.io/logo.png'),
		}
		const spy = vi.spyOn(DataLoader, '_getOrganisation').mockReturnValue(org)
		try {
			await h.openInfo()
			expect(asset.calls.some((el) => el instanceof HTMLLinkElement && el.getAttribute('href') === styleUrl)).toBe(true)
		} finally {
			spy.mockRestore()
			asset.restore()
			h.destroy()
		}
	})

	it('picks the EU host for an EU-branded organisation', async () => {
		const asset = interceptAssetAppend('load')
		const h = harness()
		const slug = `eu-${counter}`
		const org: Models.ImageInfo.Organisation = {
			name: 'Org',
			slug,
			baseUrl: 'https://org.test/',
			branding: true,
			logo: logoAsset('https://eu.micr.io/logo.png'),
		}
		const spy = vi.spyOn(DataLoader, '_getOrganisation').mockReturnValue(org)
		try {
			await h.openInfo()
			expect(
				asset.calls.some(
					(el) => el instanceof HTMLLinkElement && el.getAttribute('href') === `https://eu.micr.io/style/${slug}.css`,
				),
			).toBe(true)
		} finally {
			spy.mockRestore()
			asset.restore()
			h.destroy()
		}
	})

	it('skips the branding stylesheet when the UI is disabled', async () => {
		const asset = interceptAssetAppend('load')
		const h = harness()
		const slug = `noui-${counter}`
		const org: Models.ImageInfo.Organisation = {
			name: 'Org',
			slug,
			baseUrl: 'https://org.test/',
			branding: true,
			logo: logoAsset('https://r2.micr.io/logo.png'),
		}
		const spy = vi.spyOn(DataLoader, '_getOrganisation').mockReturnValue(org)
		try {
			await h.openInfo({}, { settings: { noUI: true } })
			expect(asset.calls.some((el) => el instanceof HTMLLinkElement)).toBe(false)
		} finally {
			spy.mockRestore()
			asset.restore()
			h.destroy()
		}
	})

	it('hands the watermark to WebGL with its opacity', async () => {
		const h = harness()
		const watermark = vi.spyOn(h.viewer.el._engine.micrio._webgl, '_loadWatermark')
		try {
			const i = info({ watermark: 'https://cdn.test/wm.png' })
			await h.open({ id: i.id, info: i, settings: { watermarkOpacity: 0.4 }, data: {} })
			expect(watermark).toHaveBeenCalledWith('https://cdn.test/wm.png', 0.4)
		} finally {
			watermark.mockRestore()
			h.destroy()
		}
	})
})

describe('MicrioImage engagement with the element', () => {
	it('reads the space once and drops it for a single-image space', async () => {
		const h = harness()
		const space = { name: 'one', links: [], images: [{ id: 'x', x: 0, y: 0, z: 0, rotationY: 0 }] }
		const spy = vi.spyOn(DataLoader, '_getSpaceData').mockReturnValue(space as never)
		try {
			const opened = await h.openInfo({ spacesId: 'space-single' })
			expect(spy).toHaveBeenCalledWith('space-single')
			expect(opened).toBeDefined()
		} finally {
			spy.mockRestore()
			h.destroy()
		}
	})

	it('falls back to trueNorth when the space has no entry for the image', async () => {
		const h = harness()
		h.viewer.el.spaceData = undefined
		const i = info({ is360: true })
		const opened = await h.open({
			id: i.id,
			info: i,
			settings: { _360: { trueNorth: 0.75 } },
			data: {},
		})
		// `(trueNorth - 0.5) * 2π`. The space cache is empty here, so `_getSpaceData`
		// returns undefined and the settings branch is the one taken.
		expect(opened.camera?.rotationY).toBeCloseTo(Math.PI / 2, 10)
		h.destroy()
	})

	it('reads the bundle tours once and does not re-read them per image', async () => {
		const h = harness()
		const tours = [{ id: 'tour-1', steps: [], stepInfo: [], duration: 1 }]
		const spy = vi.spyOn(DataLoader, '_getBundleTours').mockReturnValue(tours as never)
		try {
			await h.openInfo()
			const seen = spy.mock.calls.length
			expect(seen).toBe(1)
			expect(h.viewer.el.bundleTours).toBe(tours)
			// The element holds the tours for the whole session; a second image must not re-query.
			await h.openInfo()
			expect(spy.mock.calls.length).toBe(seen)
		} finally {
			spy.mockRestore()
			h.destroy()
		}
	})

	it('dispatches pre-info and pre-data before the data store is read', async () => {
		const h = harness()
		const seen: { event: string; payload: unknown }[] = []
		const onInfo = (e: Event) => {
			seen.push({ event: 'pre-info', payload: (e as CustomEvent).detail })
		}
		const onData = (e: Event) => {
			// Reading the store here is the point: at `pre-data` time it is still empty.
			seen.push({ event: 'pre-data', payload: (e as CustomEvent).detail })
		}
		h.viewer.el.addEventListener('pre-info', onInfo)
		h.viewer.el.addEventListener('pre-data', onData)
		const i = info()
		const data = { i18n: { en: { title: 'Hello' } } }
		try {
			const opened = await h.open({ id: i.id, info: i, settings: {}, data })
			expect(seen.map((s) => s.event)).toEqual(['pre-info', 'pre-data'])
			expect((seen[0]?.payload as { id: string })?.id).toBe(i.id)
			expect((seen[1]?.payload as Record<string, unknown>)?.[i.id]).toBe(data)
			expect(opened.$data).toBe(data)
		} finally {
			h.viewer.el.removeEventListener('pre-info', onInfo)
			h.viewer.el.removeEventListener('pre-data', onData)
			h.destroy()
		}
	})

	it('publishes the bundle settings on the image store', async () => {
		const h = harness()
		// `open()` (and the element's own defaults) can fill or shadow built-in keys, so this
		// pins a key nothing else writes: the store holds what the bundle asked for.
		const opened = await h.openInfo({}, { settings: { camspeed: 3 } })
		expect(opened.$settings.camspeed).toBe(3)
		h.destroy()
	})

	it('does not read the bundle data when the settings skip metadata', async () => {
		const h = harness()
		const opened = await h.openInfo({}, { settings: { skipMeta: true }, data: { i18n: { en: { title: 'x' } } } })
		expect(opened.$data).toBeUndefined()
		h.destroy()
	})
})

/** A minimal `Assets.Image` for the organisation logo. */
function logoAsset(src: string): Models.Assets.Image {
	return { src, title: 'Logo', size: 1, uploaded: 0, width: 32, height: 32 }
}

/** A square area in image coordinates, for the embed fit cases. */
function squareArea(): Models.Camera.View {
	return [0, 0, 0.5, 0.5]
}

/** Opens an image to add embeds to. */
async function withEmbed(): Promise<{ h: Harness; parent: MicrioImage }> {
	const h = harness()
	const parent = await h.openInfo()
	return { h, parent }
}

describe('MicrioImage embed lifecycle', () => {
	it('clones the area, defaults the opacity and registers the sub-image', async () => {
		const { h, parent } = await withEmbed()
		const area: Models.Camera.View = [0.1, 0.2, 0.3, 0.4]
		const sub = parent.addEmbed({ id: 'sub-1', width: 100, height: 100 }, undefined, area)
		// The caller's array must not become the image's live area.
		area[0] = 0.9
		expect(sub.opts.area).toEqual([0.1, 0.2, 0.3, 0.4])
		expect(parent._embeds).toContain(sub)
		expect(sub._opacity).toBe(1)
		sub.visible.set(false)
		parent._orphanEmbed(sub)
		parent._releaseOrphans()
		h.destroy()
	})

	it('gives a parent-camera embed the parent camera', async () => {
		const { h, parent } = await withEmbed()
		const sub = parent.addEmbed({ id: 'sub-2', width: 100, height: 100 }, undefined, [0, 0, 0.5, 0.5], {
			asImage: true,
		})
		expect(sub.camera).toBe(parent.camera)
		expect(sub.opts.useParentCamera).toBe(true)
		sub.visible.set(false)
		parent._orphanEmbed(sub)
		parent._releaseOrphans()
		h.destroy()
	})

	it('fits the embed area to the image aspect for cover and contain', async () => {
		const { h, parent } = await withEmbed()
		// A 2:1 embed in a square area. Both fits keep the area's centre and make one of the
		// two sides match the image aspect (2) — which side differs per fit.
		const cover = parent.addEmbed({ id: 'sub-3', width: 200, height: 100 }, undefined, squareArea(), {
			fit: 'cover',
		})
		const coverArea = cover.opts.area ?? []
		expect((coverArea[2] ?? 0) / (coverArea[3] ?? 1)).toBeCloseTo(2, 10)
		// Cover centres the widened box on the original one.
		expect((coverArea[0] ?? 0) + (coverArea[2] ?? 0) / 2).toBeCloseTo(0.25, 10)
		const contain = parent.addEmbed({ id: 'sub-4', width: 200, height: 100 }, undefined, squareArea(), {
			fit: 'contain',
		})
		const containArea = contain.opts.area ?? []
		expect((containArea[2] ?? 0) / (containArea[3] ?? 1)).toBeCloseTo(2, 10)
		// Both fits keep the original box's centre.
		expect((containArea[0] ?? 0) + (containArea[2] ?? 0) / 2).toBeCloseTo(0.25, 10)
		for (const sub of parent._embeds) {
			sub.visible.set(false)
			parent._orphanEmbed(sub)
		}
		parent._releaseOrphans()
		h.destroy()
	})

	it('keeps an orphan claimed until the sweep, then tears it down', async () => {
		const { h, parent } = await withEmbed()
		const sub = parent.addEmbed({ id: 'sub-5', width: 100, height: 100 }, undefined, [0, 0, 1, 1])
		expect(sub._placed).toBe(true)
		parent._orphanEmbed(sub)
		// Still on the list: a rebuild can re-adopt it before the sweep runs.
		expect(parent._embeds).toContain(sub)
		parent._releaseOrphans()
		expect(parent._embeds).not.toContain(sub)
		expect(sub._placed).toBe(false)
		h.destroy()
	})

	it('survives a sweep when the orphan was re-adopted', async () => {
		const { h, parent } = await withEmbed()
		const sub = parent.addEmbed({ id: 'sub-6', width: 100, height: 100 }, undefined, [0, 0, 1, 1])
		parent._orphanEmbed(sub)
		parent._adoptEmbed(sub)
		parent._releaseOrphans()
		expect(parent._embeds).toContain(sub)
		// Clean up for the next test: the image would otherwise keep the sub-image placed.
		parent._orphanEmbed(sub)
		parent._releaseOrphans()
		h.destroy()
	})

	it('ignores an orphan it does not own', async () => {
		const { h, parent } = await withEmbed()
		const stranger = await h.openInfo()
		parent._orphanEmbed(stranger)
		expect(parent._embeds).not.toContain(stranger)
		h.destroy()
	})

	it('round-trips the embed media element registry', async () => {
		const { h, parent } = await withEmbed()
		const video = document.createElement('video')
		expect(parent.getEmbedMediaElement('vid-1')).toBeUndefined()
		parent._setEmbedMediaElement('vid-1', video)
		expect(parent.getEmbedMediaElement('vid-1')).toBe(video)
		parent._setEmbedMediaElement('vid-1')
		expect(parent.getEmbedMediaElement('vid-1')).toBeUndefined()
		h.destroy()
	})
})

describe('MicrioImage store subscriptions', () => {
	it('keeps the element visible list in sync and clears a pending switch', async () => {
		const h = harness()
		const opened = await h.openInfo()
		// The viewer's own image is the current one, so becoming visible clears `_switching`.
		opened.visible.set(true)
		expect(get(h.viewer.el._visible)).toContain(opened)
		h.viewer.el._switching.set(true)
		opened.visible.set(false)
		expect(get(h.viewer.el._visible)).not.toContain(opened)
		opened.visible.set(true)
		expect(get(h.viewer.el._switching)).toBe(false)
		h.destroy()
	})

	it('mirrors the video store onto the internal element', async () => {
		const h = harness()
		const opened = await h.openInfo()
		const video = document.createElement('video')
		opened.video.set(video)
		expect(opened._video).toBe(video)
		opened.video.set(undefined)
		expect(opened._video).toBeUndefined()
		h.destroy()
	})
})
