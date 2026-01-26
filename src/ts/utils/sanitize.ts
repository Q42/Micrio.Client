/**
 * Data sanitization utilities for normalizing Micrio data structures.
 * @author Marcel Duin <marcel@micr.io>
 */

import type { Models } from '../../types/models';
import { createGUID } from './string';
import { View } from './view';

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

// Keep track of already sanitized image info objects
const sanitizedInfo: WeakMap<Models.ImageInfo.ImageInfo, boolean> = new WeakMap();

/**
 * Sanitizes URLs within an ImageInfo object.
 * @internal
 */
export const sanitizeImageInfo = (i: Models.ImageInfo.ImageInfo | undefined) => {
	if (!i) return;
	if (sanitizedInfo.has(i)) return;
	sanitizeAsset(i.organisation?.logo);
	sanitizeAsset(i.settings?._markers?.markerIcon);
	i.settings?._markers?.customIcons?.forEach(sanitizeAsset);
	sanitizeAsset(i.settings?._360?.video);
	// Sanitize views for legacy rects
	if (i?.settings && isLegacyViews(i)) {
		i.settings.view = View.fromLegacy(i.settings.view)!;
		i.settings.restrict = View.fromLegacy(i.settings.restrict)!;
	}
	sanitizedInfo.set(i, true);
};

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
		if (!e.uuid) e.uuid = (e.id ?? e.micrioId);
		sanitizeAsset(e.video);
		sanitizeAsset(e);
		if (isLegacyViews) e.area = View.fromLegacy(e.area)!;
	});
	// Sanitize markers
	d.markers?.forEach(m => sanitizeMarker(m, lang, isV5, isLegacyViews));
	// Sanitize tours that use legacy viewports
	if (isLegacyViews) d.tours?.forEach(sanitizeVideoTour);
	// Sanitize music playlist items
	d.music?.items?.forEach(sanitizeAsset);
	// Sanitize menu pages recursively
	d.pages?.forEach(sanitizeMenuPage);
};

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

// Keep track of IDs already sanitized
const sanitizedIds: string[] = [];

/**
 * Sanitizes marker data, ensuring required properties exist, handling legacy formats,
 * and sanitizing asset URLs. Modifies the marker object in place.
 * @internal
 * @param m The marker data object.
 * @param lang The current language code.
 * @param isOld Is the data from a pre-V5 image?
 * @param legacyViews It uses the old [x0,y0,x1,y1] viewports
 */
export const sanitizeMarker = (m: Models.ImageData.Marker, lang: string, isOld: boolean, legacyViews?: boolean): void => {
	const key = lang + '-' + m.id;
	if (sanitizedIds.includes(key)) return;
	sanitizedIds.push(key);
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
	if (isOld && 'class' in m) m.tags.push(...(m.class as string).split(' ').map(t => t.trim()).filter(t => !!t && !m.tags.includes(t)));
	// Ensure 'default' tag sets type correctly
	if (m.tags.includes('default')) m.type = 'default';
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
	const i18n = 'i18n' in tour ? tour.i18n : { 'en': (<unknown>tour as Models.ImageData.VideoTourCultureData) };
	for (const lang in i18n) i18n[lang]?.timeline.forEach(s => s.rect = View.fromLegacy(s.rect)!);
}

