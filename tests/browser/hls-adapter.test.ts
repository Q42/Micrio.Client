import { afterEach, describe, expect, it } from 'vitest'
import {
	cloudflareStreamUrl,
	getHlsConstructor,
	HLS_PLAYER_CONFIG,
	HLS_SCRIPT_URL,
	mediaSourceSupported,
} from '../../src/media/hls-adapter'

/**
 * The HLS adapter: the three exported helpers plus the adapter itself.
 *
 * This lives in the browser project rather than with the other pure-logic suites
 * because importing the module reaches `$utils/dom` and from there `src/core/frame.ts`,
 * which reads `window` at module scope. The helpers are still pure; only the import
 * chain needs a DOM.
 */
const globals = globalThis as Record<string, unknown>

/**
 * Stands in for the HLS.js constructor. A named function rather than a class: it is
 * only ever called with `new`, and the linter (rightly) rejects an empty class.
 */
function fakeHls() {}

/**
 * Sets a global for one test and restores the previous value afterwards. Written by
 * hand rather than with `vi.stubGlobal` so the core project needs no test globals.
 */
const originals = new Map<string, { present: boolean; value: unknown }>()

function setGlobal(name: string, value: unknown) {
	if (!originals.has(name)) {
		originals.set(name, { present: name in globals, value: globals[name] })
	}
	globals[name] = value
}

function unsetGlobal(name: string) {
	if (!originals.has(name)) {
		originals.set(name, { present: name in globals, value: globals[name] })
	}
	delete globals[name]
}

afterEach(() => {
	for (const [name, original] of originals) {
		if (original.present) {
			globals[name] = original.value
		} else {
			delete globals[name]
		}
	}
	originals.clear()
})

describe('cloudflareStreamUrl', () => {
	it('builds the manifest url for a stream id', () => {
		expect(cloudflareStreamUrl('abcdef123456')).toBe('https://videodelivery.net/abcdef123456/manifest/video.m3u8')
	})

	it('keeps ids that already look like a path segment', () => {
		expect(cloudflareStreamUrl('a-b_c.d')).toBe('https://videodelivery.net/a-b_c.d/manifest/video.m3u8')
	})

	it('produces a url even for an empty id', () => {
		expect(cloudflareStreamUrl('')).toBe('https://videodelivery.net//manifest/video.m3u8')
	})
})

describe('mediaSourceSupported', () => {
	it('is false without MediaSource support', () => {
		unsetGlobal('MediaSource')
		unsetGlobal('ManagedMediaSource')
		expect(mediaSourceSupported()).toBe(false)
	})

	it('is true with MediaSource', () => {
		setGlobal('MediaSource', {})
		expect(mediaSourceSupported()).toBe(true)
	})

	it('is true with ManagedMediaSource alone', () => {
		unsetGlobal('MediaSource')
		setGlobal('ManagedMediaSource', {})
		expect(mediaSourceSupported()).toBe(true)
	})
})

describe('getHlsConstructor', () => {
	it('throws when the script did not load', () => {
		unsetGlobal('Hls')
		expect(() => getHlsConstructor()).toThrow('HLS.js failed to load')
	})

	it('throws when the global is not a constructor', () => {
		setGlobal('Hls', { not: 'a constructor' })
		expect(() => getHlsConstructor()).toThrow('HLS.js failed to load')
	})

	it('returns the constructor the script exposed', () => {
		setGlobal('Hls', fakeHls)
		expect(getHlsConstructor()).toBe(fakeHls)
	})
})

describe('HLS constants', () => {
	it('pins the script url', () => {
		expect(HLS_SCRIPT_URL).toBe('https://r2.micr.io/hls-1.6.15.min.js')
	})

	it('pins the ABR estimates', () => {
		expect(HLS_PLAYER_CONFIG).toEqual({ abrEwmaDefaultEstimate: 10_000_000, abrEwmaDefaultEstimateMax: 50_000_000 })
	})
})
