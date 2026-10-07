import { describe, expect, it } from 'vitest'
import { get, writable } from '$core/store'
import { i18n, langs } from '$core/i18n/strings'

/**
 * The UI translation tables behind every button label.
 *
 * `strings.ts` builds one dictionary per language by transposing a single table of
 * `[en, nl, de]` tuples, so the failure mode it needs guarding against is a tuple that is
 * short, empty or inconsistent — which would either drop a language silently or leave a
 * button with no label.
 */
const LANGUAGES = ['en', 'nl', 'de'] as const

/** Every key the module declares, read off the built dictionary rather than restated. */
const keys = Object.keys(langs.en ?? {})

describe('translation tables', () => {
	it('covers exactly the supported languages', () => {
		expect(Object.keys(langs).sort()).toEqual([...LANGUAGES].sort())
	})

	it('declares a plausible number of keys', () => {
		// Guards the transposition itself: a broken loop would produce very few keys
		expect(keys.length).toBeGreaterThan(20)
		expect(new Set(keys).size).toBe(keys.length)
	})

	it('gives every language the same keys', () => {
		for (const lang of LANGUAGES) {
			expect(Object.keys(langs[lang] ?? {}).sort(), lang).toEqual([...keys].sort())
		}
	})

	it('has a non-empty label for every key in every language', () => {
		for (const lang of LANGUAGES) {
			const dict = langs[lang] ?? {}
			for (const key of keys) {
				const value = dict[key as keyof typeof dict]
				expect(typeof value, `${lang}.${key}`).toBe('string')
				expect(value.trim().length, `${lang}.${key}`).toBeGreaterThan(0)
			}
		}
	})

	it('translates at least one key differently per language', () => {
		// A transposition bug that reused column 0 would make every language English
		for (const key of keys) {
			const en = langs.en?.[key as keyof typeof langs.en]
			const nl = langs.nl?.[key as keyof typeof langs.nl]
			const de = langs.de?.[key as keyof typeof langs.de]
			const allSame = en === nl && nl === de
			expect(allSame, `${key} is identical in every language`).toBe(false)
		}
	})

	it('keeps the three well-known labels correct', () => {
		expect(langs.en?._switchLanguage).toBe('Switch language')
		expect(langs.nl?._switchLanguage).toBe('Kies taal')
		expect(langs.de?._switchLanguage).toBe('Sprache wechseln')
		expect(langs.en?._close).toBe('Close')
		expect(langs.nl?._close).toBe('Sluit')
		expect(langs.de?._close).toBe('Schließen')
	})
})

describe('the active translation store', () => {
	it('starts on English', () => {
		expect(get(i18n)).toBe(langs.en)
	})

	it('swaps the active dictionary', () => {
		const before = get(i18n)
		try {
			i18n.set(langs.nl ?? i18n)
			expect(get(i18n)).toBe(langs.nl)
			expect(get(i18n)._close).toBe('Sluit')
			i18n.set(langs.de ?? i18n)
			expect(get(i18n)._close).toBe('Schließen')
		} finally {
			i18n.set(before)
		}
		expect(get(i18n)).toBe(langs.en)
	})

	it('notifies subscribers of a language change', () => {
		const seen: string[] = []
		const stop = i18n.subscribe((t) => seen.push(t._close))
		try {
			i18n.set(langs.nl ?? i18n)
			expect(seen).toEqual(['Close', 'Sluit'])
		} finally {
			stop()
			i18n.set(langs.en ?? i18n)
		}
	})
})

describe('language state', () => {
	it('is a writable store, so the UI can switch at runtime', () => {
		expect(typeof i18n.subscribe).toBe('function')
		expect(typeof i18n.set).toBe('function')
	})

	it('behaves like the shared writable it is built on', () => {
		const store = writable('en')
		const seen: string[] = []
		const stop = store.subscribe((v) => seen.push(v))
		store.set('nl')
		stop()
		store.set('de')
		// After unsubscribing nothing more arrives
		expect(seen).toEqual(['en', 'nl'])
	})
})
