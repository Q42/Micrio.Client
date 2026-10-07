import type { Models } from '$types/models'
import type { RevisionType } from '$types/models/common'
import { baseInfo, marker } from './bundles'
import { mountViewer, waitFor, type Viewer } from '../helpers/viewer'
import { get } from '$core/store'

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
	/** Published revisions per language; the language switchers read these keys. */
	revision?: RevisionType
	/** Use these pages instead of `uiMenus`'s; the popover cases need shaped pages. */
	pages?: Models.ImageData.Menu[]
	/** Use these markers instead of the two plain ones; the popover cases need content. */
	markers?: Models.ImageData.Marker[]
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

	const markers = opts.markers ?? [marker('m1'), marker('m2')]
	const pages = opts.pages ?? uiMenus(opts)

	return {
		id,
		pages,
		markerIds: markers.map((m) => m.id),
		bundle: {
			id,
			info: baseInfo(id, { title: 'UI image', ...(opts.revision ? { revision: opts.revision } : {}) }),
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

/** One image asset, as a content page or a marker's gallery holds them. */
export function imageAsset(src: string, opts: { id?: string; micrioId?: string } = {}): Models.Assets.Image {
	return {
		title: src,
		src,
		size: 1,
		uploaded: 0,
		width: 512,
		height: 512,
		...(opts.id ? { id: opts.id } : {}),
		...(opts.micrioId ? { micrioId: opts.micrioId } : {}),
		i18n: { en: { title: src, description: `${src} description` }, nl: { title: src } },
	}
}

export interface UiPageOptions {
	/** Page content HTML. */
	content?: string
	/** An iframe/embed URL. */
	embed?: string
	/** A page image, as an asset or a plain source string. */
	image?: Models.Assets.Image | string
	/** Action buttons, rendered as custom buttons under the content. */
	buttons?: Models.ImageData.MenuPageButton[]
	/** Child pages, which the popover's welcome-screen lookup has to search. */
	children?: Models.ImageData.Menu[]
}

/**
 * A content page the popover renders: title plus whichever of content, embed, image and
 * action buttons the case needs. Localised in both languages so the toolbar and the
 * popover agree on what they show.
 */
export function uiPage(id: string, title: string, opts: UiPageOptions = {}): Models.ImageData.Menu {
	const page: Models.ImageData.Menu = {
		id,
		i18n: {
			en: {
				title,
				...(opts.content !== undefined ? { content: opts.content } : {}),
				...(opts.embed !== undefined ? { embed: opts.embed } : {}),
			},
			nl: {
				title,
				...(opts.content !== undefined ? { content: opts.content } : {}),
				...(opts.embed !== undefined ? { embed: opts.embed } : {}),
			},
		},
	}
	if (opts.image) {
		page.image = typeof opts.image === 'string' ? (opts.image as unknown as Models.Assets.Image) : opts.image
	}
	if (opts.buttons) {
		page.buttons = opts.buttons
	}
	if (opts.children) {
		page.children = opts.children
	}
	return page
}

/** A page action button, labelled in both languages. */
export function pageButton(
	type: Models.ImageData.MenuPageButton['type'],
	action?: string,
	opts: { label?: string; blankTarget?: boolean } = {},
): Models.ImageData.MenuPageButton {
	return {
		type,
		...(action !== undefined ? { action } : {}),
		i18nTitle: { en: opts.label ?? type, nl: opts.label ?? type },
		...(opts.blankTarget ? { blankTarget: true } : {}),
	}
}

/** A marker with popover content: body, an embedded media URL or an image gallery. */
export function uiMarker(
	id: string,
	opts: {
		body?: string
		title?: string
		embedUrl?: string
		embedAutoPlay?: boolean
		images?: Models.Assets.Image[]
		popupType?: Models.ImageData.Marker['popupType']
	} = {},
): Models.ImageData.Marker {
	const m = marker(id, {
		i18n: {
			en: {
				title: opts.title ?? `Marker ${id}`,
				body: opts.body ?? '',
				...(opts.embedUrl ? { embedUrl: opts.embedUrl } : {}),
			},
			nl: {
				title: opts.title ?? `Marker ${id}`,
				body: opts.body ?? '',
				...(opts.embedUrl ? { embedUrl: opts.embedUrl } : {}),
			},
		},
		...(opts.embedAutoPlay !== undefined ? { embedAutoPlay: opts.embedAutoPlay } : {}),
		...(opts.images ? { images: opts.images } : {}),
		...(opts.popupType ? { popupType: opts.popupType } : {}),
	})
	return m
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
	await waitFor(() => !get(viewer.el._loading), 8000, 'the image to load')
	// The toolbar and its menus render from the image data, so wait until it is present
	await waitFor(() => viewer.el.$current?.$data !== undefined, 8000, 'the image data')
	return { viewer, id: bundle.id, pages: bundle.pages, markerIds: bundle.markerIds }
}
