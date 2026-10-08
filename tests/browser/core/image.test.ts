import { describe, expect, it, vi } from 'vitest'
import type { MicrioImage } from '$core/image'
import type { Models } from '$types/models'
import { get } from '$core/store'
import { DataLoader } from '$utils/dataLoader'
import { decodeV5Id } from '$utils/id'
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
	return {
		viewer,
		open,
		settle,
		openInfo: (extra = {}, rest = {}) => {
			const i = info(extra)
			return open({ id: i.id, info: i, settings: rest.settings ?? {}, data: rest.data ?? {} })
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
