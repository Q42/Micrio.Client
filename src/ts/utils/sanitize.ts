/**
 * Data sanitization utilities for normalizing Micrio data structures.
 * @author Marcel Duin <marcel@micr.io>
 */

import type { Models } from '$types/models';
import { createGUID } from './string';
import { getIdVal, idIsV5 } from './id';
import { DEMO_IDS } from '../globals';

/** Mappings for replacing old CDN hostnames with current ones in asset URLs.
 * @internal
 */
const ASSET_SRC_REPLACE: Record<string, string> = {
	'micrio-cdn.azureedge.net': 'micrio.vangoghmuseum.nl/micrio',
	'micrio-cdn.vangoghmuseum.nl': 'micrio.vangoghmuseum.nl/micrio',
	'rijks-micrio.azureedge.net': 'micrio.rijksmuseum.nl'
};

/**
 * Sanitizes asset URLs within various data structures (ImageInfo, ImageData, Embeds, Markers).
 * Replaces legacy hostnames and handles potential `fileUrl` properties.
 * @internal
 * @param a The asset object or embed object to sanitize.
 */
export const sanitizeAsset = (a?: Models.Assets.BaseAsset | Models.ImageData.Embed): void => {
	// Handle legacy fileUrl property
	if (a instanceof Object && 'fileUrl' in a && !a.src) a.src = a.fileUrl as string;
	// Replace legacy hostnames
	if (a?.src) for (let r in ASSET_SRC_REPLACE)
		if (a.src.includes(r)) a.src = a.src.replace(r, ASSET_SRC_REPLACE[r]);
};

/**
 * Checks if an ImageInfo uses legacy view format.
 * @internal
 */
export const isLegacyViews = (i: Models.ImageInfo.ImageInfo): boolean => !i.viewsWH;

const sanitized = {
	info: new WeakMap<Models.ImageInfo.ImageInfo, boolean>(),
	embeds: new WeakSet<Models.ImageData.Embed>(),
	markers: new WeakSet<Models.ImageData.Marker>(),
	videoTours: new WeakSet<object>(),
};

const fromLegacyDone = new WeakSet<object>();

/**
 * View conversion utilities for transforming between view formats.
 * @internal
 */
export const View = {
	fromLegacy: (v?: Models.Camera.ViewRect | Models.Camera.View): Models.Camera.View | undefined => {
		if (!v) return undefined;
		if (fromLegacyDone.has(v)) return v;
		const result: Models.Camera.View = [
			v[0],
			v[1],
			v[2] - v[0],
			v[3] - v[1]
		];
		fromLegacyDone.add(v);
		return result;
	},
	toCenterJSON: (v: Models.Camera.View): { centerX: number; centerY: number; width: number; height: number } => ({
		centerX: v[0] + v[2] / 2,
		centerY: v[1] + v[3] / 2,
		width: v[2],
		height: v[3]
	}),
	rectToCenterJSON: (v: Models.Camera.View) =>
		View.toCenterJSON([v[0], v[1], v[2] - v[0], v[3] - v[1]]),
};

/**
 * Sanitizes URLs within an ImageInfo object.
 * @internal
 */
export const sanitizeImageInfo = (i: Models.ImageInfo.ImageInfo | undefined) => {
	if (!i) return;
	if (sanitized.info.has(i)) return;
	// Handle ancient Micrio V1 static info.json format
	if ('Height' in i) { i.height = (i as unknown as Record<string, unknown>)['Height'] as number; i.version = '1.0'; i.tileSize = 512; }
	if ('Width' in i) i.width = (i as unknown as Record<string, unknown>)['Width'] as number;
	sanitizeAsset(i.organisation?.logo);
	sanitizeAsset(i.settings?._markers?.markerIcon);
	i.settings?._markers?.customIcons?.forEach(sanitizeAsset);
	sanitizeAsset(i.settings?._360?.video);
	// Sanitize views for legacy rects
	if (i?.settings && isLegacyViews(i)) {
		i.settings.view = View.fromLegacy(i.settings.view)!;
		i.settings.restrict = View.fromLegacy(i.settings.restrict)!;
	}
	sanitized.info.set(i, true);
};

/**
 * Applies ID-level info transforms: IIIF prefix stripping, V4 short-ID metadata decode,
 * V5 imported `i` prefix, and `_meta` settings migration.
 * Modifies `i` in place and returns derived flags.
 * @internal
 */
export function sanitizeImageId(i: Models.ImageInfo.ImageInfo, id: string, isV5: boolean): { isV5Imported: boolean; isDemo: boolean } {
	// Apply meta settings
	if (i.settings?._meta?.noLogo) i.settings.noLogo = true;
	if (i.settings?._meta?.noSmoothing) i.settings.noSmoothing = true;

	// Sanitize IIIF ID prefix
	const iiifIdBase = 'https://iiif.micr.io/';
	if (i.id.startsWith(iiifIdBase)) i.id = i.id.slice(iiifIdBase.length);

	// Decode metadata from short V4 IDs (length 7)
	if (id.length == 7) {
		const b = getIdVal(id[1 + (getIdVal(id) % 6)]);
		i.is360 = !!((b >> 4) & 1) || !!i.is360;
		i.isWebP = !(b & 3);
		i.isPng = (b & 3) == 2;
		if ((b >> 3) & 1 && idIsV5(i.tilesId ?? id)) i.format = 'dz';
		if (!i.path) i.path = `https://${!((b >> 2) & 1) ? 'r2' : 'eu'}.micr.io/`;
	}

	// Handle V5 imported images (ID starts with 'i', length 6)
	const isV5Imported = isV5 && id.startsWith('i') && !id.includes('/');
	if (isV5Imported && !i.tilesId) i.tilesId = id.slice(1);
	const isDemo = DEMO_IDS.includes(i.id) || (!!i.tilesId && DEMO_IDS.includes(i.tilesId));

	return { isV5Imported, isDemo };
}

/**
 * Sanitizes URLs and marker data within an ImageData object to the latest data formats.
 * @internal
 */
export const sanitizeImageData = (d: Models.ImageData.ImageData | undefined, lang: string, isV5: boolean, isLegacyViews: boolean) => {
	if (!d) return;
	// Filter out unpublished revisions (value <= 0)
	if (d.revision) d.revision = Object.fromEntries(Object.entries((d.revision ?? {})).filter(r => Number(r[1]) > 0));
	// Sanitize embeds
	d.embeds?.forEach(e => {
		if (sanitized.embeds.has(e)) return;
		if (!e.uuid) e.uuid = (e.id ?? e.micrioId);
		sanitizeAsset(e.video);
		sanitizeAsset(e);
		if (isLegacyViews) e.area = View.fromLegacy(e.area)!;
		sanitized.embeds.add(e);
	});
	// Sanitize markers
	d.markers?.forEach(m => {
		sanitizeMarker(m, lang, isV5, isLegacyViews);
		// Merge legacy embedImages from markers into top-level embeds
		const markerEmbeds = 'embedImages' in m ? (m as unknown as Record<string, unknown>).embedImages as Models.ImageData.Embed[] : undefined;
		if(markerEmbeds?.length) {
			d.embeds = [...(d.embeds ?? []), ...markerEmbeds];
			delete (m as unknown as Record<string, unknown>).embedImages;
		}
	});
	// Sanitize tours that use legacy viewports
	if (isLegacyViews) d.tours?.forEach(sanitizeVideoTour);
	// Sanitize music playlist items
	d.music?.items?.forEach(sanitizeAsset);
	// Sanitize menu pages recursively
	d.pages?.forEach(sanitizeMenuPage);
};

/**
 * Detects a legacy V4 autostart tour in image data and returns the start config.
 * @internal
 */
export function getAutostartTour(d: Models.ImageData.ImageData): NonNullable<Models.ImageInfo.Settings['start']> | undefined {
	const tour = d.markerTours?.find(t => 'autostart' in t && (t as any).autostart)
		|| d.tours?.find(t => 'autostart' in t && (t as any).autostart);
	if (!tour) return;
	return {
		type: 'steps' in tour ? 'markerTour' : 'tour',
		id: tour.id!
	};
}

/**
 * Sanitizes and normalizes a media source URL.
 * Extracts src from iframe tags and converts legacy video:// protocol.
 * @internal
 */
export function sanitizeSource(src: string | undefined): string | undefined {
	if (!src) return undefined;
	if (/<iframe /.test(src)) {
		src = src.replace(/^.* src="([^"]+)".*$/, '$1');
	}
	if (src.startsWith('video://')) {
		src = src.replace('video:', 'https:');
	}
	return src;
}

/**
 * Resolves the source URL from an audio asset, handling legacy `fileUrl` property.
 * @internal
 */
export function getAudioSrc(audio: Models.Assets.BaseAsset | undefined): string | undefined {
	if (!audio) return;
	return 'fileUrl' in audio ? (audio as unknown as Record<string, unknown>)['fileUrl'] as string : audio.src;
}

/**
 * Sanitizes URLs within SpaceData (icons).
 * @internal
 */
export const sanitizeSpaceData = (s: Models.Spaces.Space | undefined) => {
	s?.icons?.forEach(sanitizeAsset);
};

/**
 * Recursively sanitizes URLs within Menu page data.
 * @internal
 */
const sanitizeMenuPage = (m: Models.ImageData.Menu) => {
	sanitizeAsset(m.image);
	m.children?.forEach(sanitizeMenuPage);
};



/**
 * Sanitizes marker data, ensuring required properties exist, handling legacy formats,
 * and sanitizing asset URLs. Modifies the marker object in place.
 * @internal
 * @param m The marker data object.
 * @param lang The current language code.
 * @param isOld Is the data from a pre-V5 image?
 * @param legacyViews It uses the old [x0,y0,x1,y1] viewports
 */
export const sanitizeMarker = (m: Models.ImageData.Marker, _lang: string, isOld: boolean, legacyViews?: boolean): void => {
	if (sanitized.markers.has(m)) return;
	sanitized.markers.add(m);
	// Ensure basic properties exist
	if (!m.data) m.data = {};
	if (!m.id) m.id = createGUID();
	if (!m.tags) m.tags = [];
	if (!('type' in m)) m.type = 'default'; // Default marker type
	if (!m.popupType) m.popupType = 'popup'; // Default popup type

	// Convert legacy string icon to object format
	if (typeof m.data.icon == 'string') m.data.icon = {
		title: '', size: 0, uploaded: 0, width: -1, height: -1, src: m.data.icon as string
	};

	// Sanitize assets within the marker
	m.images?.forEach(sanitizeAsset);
	sanitizeAsset(m.positionalAudio);
	sanitizeAsset(m.data?.icon);
	Object.values(m.i18n ?? {}).forEach(d => sanitizeAsset(d.audio)); // Sanitize audio in i18n
	const embeds = 'embedImages' in m ? m.embedImages as Models.ImageData.Embed[] : undefined;
	if (embeds) embeds.forEach(e => sanitizeAsset(e)); // Sanitize legacy embedImages

	// Handle legacy split screen link format
	const oldSplitLink = m.data?._meta?.secondary;
	if (oldSplitLink) m.data.micrioSplitLink = oldSplitLink;

	// Convert legacy 'class' string to tags array
	if (isOld && 'class' in m) (m.tags ??= []).push(...(m.class as string).split(' ').map(t => t.trim()).filter(t => !!t && !m.tags!.includes(t)));
	if (m.tags?.includes('default')) m.type = 'default';
	// Sanitize view
	if (legacyViews) {
		m.view = View.fromLegacy(m.view)!;
		// Sanitize videoTour timelines
		sanitizeVideoTour(m.videoTour);
	}
};



/**
 * Sanitizes video tour data, converting legacy view formats.
 * @internal
 */
export function sanitizeVideoTour(tour?: Models.ImageData.VideoTour | Models.ImageData.VideoTourCultureData): void {
	if (!tour || (!('i18n' in tour) && !('timeline' in tour))) return;
	if (sanitized.videoTours.has(tour)) return;
	const i18n = 'i18n' in tour ? tour.i18n : { 'en': (<unknown>tour as Models.ImageData.VideoTourCultureData) };
	for (const lang in i18n) i18n[lang]?.timeline.forEach(s => s.rect = View.fromLegacy(s.rect)!);
	sanitized.videoTours.add(tour);
}

