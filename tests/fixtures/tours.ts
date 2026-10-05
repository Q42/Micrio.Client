import type { Models } from '../../src/types/models'
import type { I18n } from '../../src/types/models/common'
import { baseInfo, marker } from './bundles'

/** A camera viewport in tour space. */
const view = (x: number, y: number, w = 0.5, h = 0.5): Models.Camera.View => [x, y, w, h]

/** A language-agnostic timeline entry. */
export interface TimelineEntry {
	start: number
	end: number
	rect: Models.Camera.View
}

/**
 * Builds a video tour. `timeline` entries are the raw editor values; note that
 * `VideoTourInstance.read()` derives each segment's start from the *previous*
 * entry's `end`, which is why the non-contiguous case matters.
 */
export const videoTour = (
	opts: {
		id?: string
		langs?: string[]
		duration?: number
		timeline?: TimelineEntry[]
		events?: Models.ImageData.Event[]
		audio?: boolean
		subtitle?: string
		title?: string
		keepInteraction?: boolean
		/** Add an `nl` language entry whose timeline differs, for language-switch tests. */
		extraLangWithTimeline?: boolean
	} = {},
): Models.ImageData.VideoTour => {
	const {
		id = 'vt1',
		langs = ['en'],
		duration = 10,
		timeline = [
			{ start: 0, end: 4, rect: view(0, 0) },
			{ start: 4, end: 10, rect: view(0.5, 0.5) },
		],
		events = [],
		audio = false,
		subtitle,
		title = 'Video tour',
		keepInteraction,
		extraLangWithTimeline = false,
	} = opts

	const asset = {
		title: 'tour audio',
		src: 'https://r2.micr.io/audio/tour.mp3',
		size: 1,
		uploaded: 0,
		duration,
		volume: 1,
	}

	const i18n: I18n<Models.ImageData.VideoTourCultureData> = {}
	for (const lang of langs) {
		i18n[lang] = {
			title,
			duration,
			timeline: timeline.map((t) => ({ start: t.start, end: t.end, rect: [...t.rect] })),
			events: events.map((e) => ({ start: e.start, end: e.end, action: e.action, data: e.data })),
			...(audio ? { audio: { ...asset } } : {}),
			...(subtitle !== undefined ? { subtitle: { ...asset, src: subtitle } } : {}),
		}
	}
	if (extraLangWithTimeline) {
		i18n.nl = {
			title: 'Videotour',
			duration: 4,
			timeline: [{ start: 0, end: 4, rect: view(0.25, 0.25) }],
			events: [],
		}
	}

	return { id, i18n, ...(keepInteraction !== undefined ? { keepInteraction } : {}) }
}

/** Builds a marker tour. Steps reference marker ids that must exist in the bundle. */
export const markerTour = (
	opts: {
		id?: string
		steps?: string[]
		stepInfo?: Models.ImageData.MarkerTourStepInfo[]
		duration?: number
		initialStep?: number
		isSerialTour?: boolean
		printChapters?: boolean
		cannotClose?: boolean
		noControls?: boolean
		title?: string
	} = {},
): Models.ImageData.MarkerTour => {
	const {
		id = 'mt1',
		steps = ['m1', 'm2'],
		duration = 8,
		initialStep,
		isSerialTour,
		printChapters,
		cannotClose,
		noControls,
		title = 'Marker tour',
	} = opts
	const stepInfo =
		opts.stepInfo ??
		steps.map((markerId, index) => ({
			markerId,
			micrioId: 'rqFkjZz',
			duration: duration / steps.length,
			...(index === 0 ? {} : {}),
		}))
	return {
		id,
		steps,
		stepInfo,
		duration,
		i18n: { en: { title, description: `${title} description` } },
		...(initialStep !== undefined ? { initialStep } : {}),
		...(isSerialTour !== undefined ? { isSerialTour } : {}),
		...(printChapters !== undefined ? { printChapters } : {}),
		...(cannotClose !== undefined ? { cannotClose } : {}),
		...(noControls !== undefined ? { noControls } : {}),
	}
}

/** A marker carrying its source image id in `_meta`, used by the serial-tour fixtures. */
const seriesMarker = (imageId: string, markerId: string) =>
	marker(markerId, {
		i18n: { en: { title: `Marker ${markerId}`, body: `<p>${markerId}</p>` } },
		data: { _meta: { imageId } },
	})

/** A marker that carries its own video tour, as the editor produces for in-marker videos. */
export const tourMarker = (
	id: string,
	tour: Models.ImageData.VideoTour,
	extra: Partial<Models.ImageData.Marker> = {},
) => marker(id, { videoTour: tour, popupType: 'none', ...extra })

/**
 * An image whose data carries the given tours, with tour-related settings.
 *
 * `markersWithVideo` builds the marker set every serial tour needs: a serial tour
 * only renders progress bars and chapters for steps whose marker carries a video
 * tour (that media element is what the bars are injected into).
 */
export const tourBundle = (
	opts: {
		id?: string
		markers?: Models.ImageData.Marker[]
		markerTours?: Models.ImageData.MarkerTour[]
		tours?: Models.ImageData.VideoTour[]
		settings?: Partial<Models.ImageInfo.Settings>
		langs?: string[]
		/** Add a video tour to each step marker, as a published serial tour has. */
		markersWithVideo?: string[]
	} = {},
): Models.ImageBundle.BundleImage => {
	const { id = 'rqFkjZz', markerTours, tours, settings = {}, langs = ['en'], markersWithVideo } = opts
	const i18n: Record<string, { title: string }> = {}
	for (const lang of langs) {
		i18n[lang] = { title: 'Tour image' }
	}
	const markers =
		opts.markers ??
		(markersWithVideo
			? markersWithVideo.map((markerId) => tourMarker(markerId, videoTour({ id: `vt-${markerId}` })))
			: [marker('m1'), marker('m2'), marker('m3')])
	return {
		id,
		info: baseInfo(id, { title: 'Tour image', revision: { en: 1 } }),
		settings,
		data: {
			i18n,
			markers,
			...(markerTours !== undefined ? { markerTours } : {}),
			...(tours !== undefined ? { tours } : {}),
		},
	}
}

/**
 * Two images in one bundle, for serial tours whose steps live on different images.
 * Ids are unique per call because the client's bundle cache is module-level.
 */
export const tourSeriesBundle = (
	suffix: string,
	opts: {
		markerTours?: (firstId: string, secondId: string) => Models.ImageData.MarkerTour[]
	} = {},
): { images: Models.ImageBundle.BundleImage[]; ids: [string, string] } => {
	const first = `${suffix}aaa`
	const second = `${suffix}bbb`
	const images: Models.ImageBundle.BundleImage[] = [
		{
			id: first,
			info: baseInfo(first, { title: 'First' }),
			settings: {},
			data: { i18n: { en: { title: 'First' } }, markers: [seriesMarker(first, 'step1')] },
		},
		{
			id: second,
			info: baseInfo(second, { title: 'Second' }),
			settings: {},
			data: { i18n: { en: { title: 'Second' } }, markers: [seriesMarker(second, 'step2')] },
		},
	]
	if (opts.markerTours) {
		const tours = opts.markerTours(first, second)
		for (const image of images) {
			image.data = { ...image.data, markerTours: tours }
		}
	}
	return { images, ids: [first, second] }
}

/** A two-step marker tour whose steps live on two different images. */
export const crossImageMarkerTour = (firstId: string, secondId: string): Models.ImageData.MarkerTour => ({
	id: 'mt-cross',
	steps: ['step1', 'step2'],
	duration: 6,
	i18n: { en: { title: 'Cross-image tour' } },
	stepInfo: [
		{ markerId: 'step1', micrioId: firstId, duration: 3 },
		{ markerId: 'step2', micrioId: secondId, duration: 3 },
	],
})

/** A small WebVTT document covering the time formats the parser must handle. */
export const vtt = (opts: { malformed?: boolean } = {}): string => {
	const head = 'WEBVTT\n\n'
	const cues = [
		'00:00:01.000 --> 00:00:03.000\nFirst cue',
		'00:00:03,500 --> 00:00:05.000\nSecond cue\nwith two lines',
		'00:06.000 --> 00:08.000\nMinute-only cue',
	]
	if (opts.malformed) {
		return `${head}not a cue at all\n\n${cues[0]}\n\ntrailing block without timing\n`
	}
	return `${head}${cues.join('\n\n')}\n`
}
