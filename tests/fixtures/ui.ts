import type { Models } from '../../src/types/models'
import { baseInfo, marker } from './bundles'
import { mountViewer, waitFor, type Viewer } from '../helpers/viewer'
import { get } from '../../src/core/store'

/**
 * Fixtures for the UI component suites: the toolbar, its menu tree, and the popover that
 * content pages render into.
 *
 * All the data is localised in every language under test, because the toolbar and the menu
 * both *filter* on the active language: an entry with no culture data for the current
 * language is hidden rather than shown untranslated. A single-language fixture would make
 * language-switch assertions meaningless.
 */
const LANGS = ['en', 'nl'] as const

/** A translated string per language under test. */
interface PerLang {
	en: string
	nl: string
}

/** Builds an `i18n` map from one value per language. */
function i18nFor<T extends object>(make: (value: string) => T, values: PerLang): Record<string, T> {
	return {
		en: make(values.en),
		nl: make(values.nl),
	}
}

let run = 0
/** A unique suffix per fixture, because the client's bundle cache is module-level. */
const suffix = () => `${(++run).toString().padStart(2, '0')}${Math.random().toString(36).slice(2, 5)}`

export interface UiMenuOptions {
	/** Give the top-level "About" entry child entries. */
	withChildren?: boolean
	/** Give the "About" entry content, so it opens a popover page. */
	withContent?: boolean
	/** Point the "About" entry at a marker instead of a page. */
	withMarkerId?: string
	/** Give the "About" entry an external link. */
	withLink?: boolean
	/** Give the "About" page a `close` button, which hides the popover's own aside. */
	withCloseButton?: boolean
	/** Give the "About" page a video tour button. */
	withTourButton?: string
	/** Add a legacy (pre-i18n) entry that carries its culture data at the top level. */
	withLegacyEntry?: boolean
	/** Add an entry whose id starts with `_`, which the toolbar always keeps. */
	withSystemEntry?: boolean
}

/**
 * A menu tree with one top-level "About" entry plus a "Contact" entry.
 *
 * `menu.icon` carries an `Assets.Image`, which the menu renders with `svgIcon`, so a
 * legacy `image` asset is used for the icon slot.
 */
export function uiMenus(opts: UiMenuOptions = {}): Models.ImageData.Menu[] {
	const menus: Models.ImageData.Menu[] = []

	const about: Models.ImageData.Menu = {
		id: 'about',
		i18n: i18nFor<Models.ImageData.MenuCultureData>(
			(value) => ({
				title: value,
				...(opts.withContent ? { content: `<p>About ${value}</p>` } : {}),
			}),
			{ en: 'About', nl: 'Over ons' },
		),
	}
	if (opts.withChildren) {
		about.children = [
			{
				id: 'about-team',
				i18n: i18nFor<Models.ImageData.MenuCultureData>((value) => ({ title: value }), {
					en: 'Team',
					nl: 'Team',
				}),
			},
			{
				id: 'about-jobs',
				i18n: i18nFor<Models.ImageData.MenuCultureData>((value) => ({ title: value }), {
					en: 'Jobs',
					nl: 'Vacatures',
				}),
			},
		]
	}
	if (opts.withMarkerId) {
		about.markerId = opts.withMarkerId
	}
	if (opts.withLink) {
		about.link = 'https://example.test/about'
		about.linkTargetBlank = true
	}
	if (opts.withCloseButton || opts.withTourButton) {
		about.buttons = []
		if (opts.withTourButton) {
			about.buttons.push({
				type: 'vtour',
				action: opts.withTourButton,
				i18nTitle: { en: 'Start tour', nl: 'Start tour' },
			})
		}
		if (opts.withCloseButton) {
			about.buttons.push({
				type: 'close',
				i18nTitle: { en: 'Free exploration', nl: 'Vrij rondkijken' },
			})
		}
	}
	menus.push(about)

	menus.push({
		id: 'contact',
		i18n: i18nFor<Models.ImageData.MenuCultureData>((value) => ({ title: value }), {
			en: 'Contact',
			nl: 'Contact',
		}),
	})

	if (opts.withLegacyEntry) {
		// Pre-i18n data carries `title` at the top level instead of in an `i18n` map
		menus.push({ id: 'legacy', title: 'Legacy entry' } as unknown as Models.ImageData.Menu)
	}

	if (opts.withSystemEntry) {
		menus.push({
			id: '_system',
			i18n: i18nFor<Models.ImageData.MenuCultureData>((value) => ({ title: value }), {
				en: 'System',
				nl: 'Systeem',
			}),
		})
	}

	return menus
}

export interface UiBundleOptions extends UiMenuOptions {
	/** Marker tours to attach. */
	markerTours?: Models.ImageData.MarkerTour[]
	/** Video tours to attach. */
	tours?: Models.ImageData.VideoTour[]
	/** Languages to localise the image title in. */
	langs?: string[]
	/** Extra image settings. */
	settings?: Partial<Models.ImageInfo.Settings>
}

export interface UiBundle {
	bundle: Models.ImageBundle.BundleImage
	id: string
	pages: Models.ImageData.Menu[]
	markerIds: string[]
}

/**
 * A bundle with the menu/popover data the UI components read.
 *
 * Menu entries live on `data.pages`, the tours on `data.markerTours` / `data.tours`, and
 * the markers the menu can open on `data.markers`.
 */
export function uiBundle(opts: UiBundleOptions = {}): UiBundle {
	const id = `ui${suffix()}`
	const langs = opts.langs ?? [...LANGS]
	const i18n: Record<string, { title: string }> = {}
	for (const lang of langs) {
		i18n[lang] = { title: 'UI image' }
	}

	const markers = [marker('m1'), marker('m2')]
	const pages = uiMenus(opts)

	return {
		id,
		pages,
		markerIds: markers.map((m) => m.id),
		bundle: {
			id,
			info: baseInfo(id, { title: 'UI image' }),
			settings: opts.settings ?? {},
			data: {
				i18n,
				markers,
				pages,
				...(opts.markerTours ? { markerTours: opts.markerTours } : {}),
				...(opts.tours ? { tours: opts.tours } : {}),
			},
		},
	}
}

/** A marker tour over the given marker ids, in order. */
export function markerTour(ids: string[], id = 'mt1', title = 'Markers'): Models.ImageData.MarkerTour {
	return {
		id,
		i18n: { en: { title }, nl: { title } },
		steps: ids,
		stepInfo: ids.map((markerId, i) => ({ markerId, micrioId: '', duration: 4, chapter: i + 1 })),
	} as Models.ImageData.MarkerTour
}

/** A minimal video tour, enough for the toolbar to list it. */
export function videoTourFixture(id = 'vt1', title = 'Video tour'): Models.ImageData.VideoTour {
	return {
		id,
		i18n: {
			en: { title, duration: 10, timeline: [], events: [] },
			nl: { title, duration: 10, timeline: [], events: [] },
		},
	} as Models.ImageData.VideoTour
}

/**
 * A mounted viewer on a UI bundle.
 *
 * `viewer` is the mounted `Viewer` (so `openUi(...).viewer.el` works), matching the shape
 * of the space and grid fixtures.
 */
export interface OpenUi {
	viewer: Viewer
	id: string
	pages: Models.ImageData.Menu[]
	markerIds: string[]
}

/**
 * Mounts a viewer on a UI bundle and waits for the image.
 *
 * `lang` is applied through the element's own language attribute, which is how a real page
 * switches language.
 */
export async function openUi(
	bundle: UiBundle,
	opts: { attrs?: Record<string, string>; lang?: string; style?: string } = {},
): Promise<OpenUi> {
	const attrs = { ...opts.attrs }
	if (opts.lang) {
		attrs.lang = opts.lang
	}
	const viewer = mountViewer(attrs, opts.style)
	await viewer.open(bundle.bundle)
	await waitFor(() => get(viewer.el._loading) === false, 8000, 'the image to load')
	// The toolbar and its menus render from the image data, so wait until it is present
	await waitFor(() => viewer.el.$current?.$data !== undefined, 8000, 'the image data')
	return { viewer, id: bundle.id, pages: bundle.pages, markerIds: bundle.markerIds }
}
