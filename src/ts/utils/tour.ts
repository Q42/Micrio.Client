/**
 * Tour loading and processing utilities.
 * @author Marcel Duin <marcel@micr.io>
 */

import type { Models } from '../../types/models';
import type { MicrioImage } from '../image';
import { fetchJson, fetchInfo, isLegacyViews } from './fetch';
import { sanitizeMarker, sanitizeAsset } from './sanitize';

/**
 * Loads and processes data for a serial marker tour.
 * Fetches data for linked images if necessary, calculates step durations,
 * and populates the `tour.stepInfo` array.
 * @internal
 * @param image The parent MicrioImage instance.
 * @param tour The MarkerTour object.
 * @param lang The current language code.
 * @param imgData The parent image's data object.
 */
export async function loadSerialTour(image: MicrioImage, tour: Models.ImageData.MarkerTour, lang: string, imgData: Models.ImageData.ImageData) {
	// Exit if already processed or not a marker tour
	if (!('steps' in tour) || tour.stepInfo) return;

	// Extract unique IDs of linked images from tour steps
	const micIds = [...new Set(
		tour.steps.map(s => s.split(',')[1]).filter((s: string) => !!s && s != image.id)
	)];

	// Helper to get data path for an ID
	const getDataPath = (id: string): string =>
		image.dataPath + (!image.isV5 ? id + '/data.' + lang + '.json' : id + '/data/pub.json');

	// Fetch data for all unique linked images concurrently
	const [micData, micInfo] = await Promise.all([
		Promise.all(micIds.map(id => fetchJson<Models.ImageData.ImageData>(getDataPath(id)))),
		// Fetch all image info.json to find out whether it uses legacyViews
		Promise.all(micIds.map(id => fetchInfo(id)))
	]);

	// Sanitize markers in the fetched data
	micData.forEach((d, i) => {
		const isLegacy = isLegacyViews(micInfo[i]!);
		d?.markers?.forEach(m => sanitizeMarker(m, lang, !image.isV5, isLegacy));
	});
	// Sanitize tour cover image
	sanitizeAsset(tour.image);

	let chapter: number = -1; // Track current chapter index
	const notFound: number[] = []; // Track indices of steps where marker wasn't found
	// Process each step defined in the tour
	tour.stepInfo = tour.steps.map((s, i): Models.ImageData.MarkerTourStepInfo | undefined => {
		const [id, mId] = s.split(','); // Extract marker ID and optional image ID
		// Find marker data (either in current image data or preloaded linked image data)
		const data = micData[micIds.indexOf(mId)] ?? imgData;
		const m = data?.markers?.find(m => m.id == id);

		// Get language-specific content and video tour data
		const content = m?.i18n?.[lang] ?? (<unknown>m as Models.ImageData.MarkerCultureData);
		if (content?.title) chapter = i; // Update chapter index if step has a title
		const vTourData = !m?.videoTour ? undefined : 'timeline' in m.videoTour ? <unknown>m.videoTour as Models.ImageData.VideoTourCultureData
			: m.videoTour.i18n?.[lang] ?? undefined;

		// Sanitize assets within the step's content
		sanitizeAsset(vTourData?.audio);
		sanitizeAsset(vTourData?.subtitle);

		// Handle marker not found
		if (!m) {
			console.warn(`[Micrio] Warning: tour step ${i + 1} with id [${id}] not found! Removing it from the tour`);
			notFound.push(i);
			return undefined; // Skip this step
		}

		sanitizeAsset(content?.audio);
		// @ts-ignore
		if (m.videoTour && content?.audio) m.videoTour['audio'] = content.audio;

		// Create step info object
		return {
			markerId: id,
			marker: m,
			micrioId: mId || image.id, // Target image ID for this step
			// Calculate duration (video tour > audio > 0)
			duration: Number(vTourData?.duration || content?.audio?.duration || 0),
			// Determine starting view (video tour timeline > marker view)
			startView: vTourData?.timeline?.length ? vTourData.timeline[0].rect : m?.view,
			// Check if the target image has other visible markers
			imageHasOtherMarkers: mId ? !!data?.markers?.find(m => m.id != id && !m.noMarker) : false,
			// Check for grid-specific flags
			gridView: !!(m.data?._meta?.gridView || m.data?._meta?.gridAction),
			chapter, // Store chapter index
			hasSubtitle: !!vTourData?.subtitle
		};
	}).filter((si): si is Models.ImageData.MarkerTourStepInfo => si !== undefined);

	// Remove steps where markers were not found
	notFound.reverse().forEach(i => tour.steps.splice(i, 1));

	// Set initial tour state
	tour.initialStep = 0;
	tour.duration = tour.stepInfo.reduce((d, s) => d + (s.duration || 0), 0); // Calculate total duration
}

