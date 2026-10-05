import type { Models } from '../../src/types/models'

/** A tiny valid image info block: 512x512 @ 256px tiles => 2 zoom levels. */
const baseInfo = (id: string, extra: Partial<Models.ImageInfo.ImageInfo> = {}): Models.ImageInfo.ImageInfo => ({
	id,
	path: 'https://r2.micr.io/',
	version: '6.1.11',
	width: 512,
	height: 512,
	tileSize: 256,
	isWebP: true,
	isDeepZoom: true,
	...extra,
})

const marker = (id: string, extra: Partial<Models.ImageData.Marker> = {}): Models.ImageData.Marker => ({
	id,
	x: 0.5,
	y: 0.5,
	type: 'default',
	popupType: 'popup',
	i18n: { en: { title: `Marker ${id}`, body: `<p>Body of ${id}</p>` } },
	...extra,
})

/** One modern (v5+) image with markers, a marker tour and a video tour. */
export const modernBundle = (): Models.ImageBundle.BundleImage => ({
	id: 'rqFkjZz',
	info: baseInfo('rqFkjZz', { title: 'Modern image' }),
	settings: {},
	data: {
		i18n: { en: { title: 'Modern title', description: 'Modern description' } },
		markers: [
			marker('m1', {
				// Marker with its own audio asset, used by the media suite
				i18n: {
					en: {
						title: 'Marker m1',
						body: '<p>Body of m1</p>',
						audio: {
							title: 'm1',
							src: 'https://r2.micr.io/audio/m1.mp3',
							size: 1,
							uploaded: 0,
							duration: 12,
							volume: 1,
						},
					},
				},
			}),
			marker('m2', { x: 0.25, y: 0.75, tags: ['focus'] }),
		],
		markerTours: [
			{
				id: 'mt1',
				steps: ['m1', 'm2'],
				stepInfo: [
					{ markerId: 'm1', micrioId: 'rqFkjZz', duration: 3 },
					{ markerId: 'm2', micrioId: 'rqFkjZz', duration: 5 },
				],
				duration: 8,
			},
		],
		tours: [
			{
				id: 'vt1',
				i18n: {
					en: {
						duration: 10,
						timeline: [
							{ start: 0, end: 4, rect: [0, 0, 0.5, 0.5] },
							{ start: 4, end: 10, rect: [0.5, 0.5, 0.5, 0.5] },
						],
						events: [],
					},
				},
			},
		],
	},
})

/**
 * A legacy (pre-v5) image: v3.2 style info plus culture data at the *top level*
 * of the data object instead of the modern `i18n` map.
 */
export const legacyBundle = (): Models.ImageBundle.BundleImage => ({
	id: 'dzzLm',
	info: {
		id: 'dzzLm',
		path: 'https://b.micr.io/',
		version: '3.2',
		width: 512,
		height: 512,
		tileSize: 256,
		title: 'The Fight Between Carnival and Lent',
	},
	settings: {},
	data: {
		// Legacy top-level culture fields (the modern model only knows `i18n`)
		...({
			title: 'Legacy title',
			description: 'Legacy description',
			copyright: 'Legacy copyright',
			sourceUrl: 'https://example.test/source',
		} as object),
		markers: [marker('legacy-1')],
	} as Models.ImageData.ImageData,
})

/** Two images inside a 360 space with a link between them. */
export const spaceBundle = (): {
	images: Models.ImageBundle.BundleImage[]
	spaces: { id: string; data: Models.Spaces.Space }[]
} => ({
	images: [
		{
			id: 'aaa1111',
			info: baseInfo('aaa1111', { is360: true, isWebP: false, spacesId: 'space-1' }),
			settings: {},
			data: {},
		},
		{
			id: 'bbb2222',
			info: baseInfo('bbb2222', { is360: true, isWebP: false, spacesId: 'space-1' }),
			settings: {},
			data: {},
		},
	],
	spaces: [
		{
			id: 'space-1',
			data: {
				name: 'Zone',
				links: [],
				images: [
					{ id: 'aaa1111', x: 0, y: 0, z: 0, rotationY: 0 },
					{ id: 'bbb2222', x: 1, y: 0, z: 0, rotationY: Math.PI / 2 },
				],
			},
		},
	],
})

/** A two-image swipe gallery. */
export const albumBundle = (): Models.ImageBundle.BundleResponse =>
	({
		images: [
			{ id: 'aaa1111', info: baseInfo('aaa1111'), settings: {}, data: {} },
			{ id: 'bbb2222', info: baseInfo('bbb2222'), settings: {}, data: {} },
		],
		album: {
			id: 'album-1',
			type: 'swipe',
			settings: {},
		},
	}) as unknown as Models.ImageBundle.BundleResponse
