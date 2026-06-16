/**
 * Tour loading and processing utilities.
 * @author Marcel Duin <marcel@micr.io>
 */

import type { Models } from '$types/models';
import type { MicrioImage } from '$ts/image';
import { fetchImageData } from './fetch';


/**
 * Loads and processes data for a serial marker tour.
 * Fetches data for linked images if necessary, calculates step durations,
 * and populates the `tour.stepInfo` array.
 * The output is language-agnostic — components read `marker.i18n[$lang]` reactively.
 * @internal
 */
export async function loadSerialTour(image: MicrioImage, tour: Models.ImageData.MarkerTour, imgData: Models.ImageData.ImageData) {
	if (!('steps' in tour) || tour.stepInfo) return;

	const micIds = [...new Set(
		tour.steps.map(s => s.split(',')[1]).filter((s: string) => !!s && s != image.id)
	)];

	const loaded = await Promise.all(micIds.map(id => fetchImageData(id, image.dataPath)));
	const micData = loaded.map(r => r?.data);

	let chapter: number = -1;
	const notFound: number[] = [];
	tour.stepInfo = tour.steps.map((s, i): Models.ImageData.MarkerTourStepInfo | undefined => {
		const [id, mId] = s.split(',');
		const data = micData[micIds.indexOf(mId)] ?? imgData;
		const m = data?.markers?.find(m => m.id == id);

		// Chapter detection: any language with a title makes this a chapter break
		const anyLang = m?.i18n ? Object.values(m.i18n)[0] : undefined;
		if (anyLang?.title) chapter = i;

		if (!m) {
			console.warn(`[Micrio] Warning: tour step ${i + 1} with id [${id}] not found! Removing it from the tour`);
			notFound.push(i);
			return undefined;
		}

		// Duration from the first available language's video tour or marker audio (same across languages)
		const vtLang = m.videoTour?.i18n ? Object.values(m.videoTour.i18n)[0] : undefined;
		const duration = Number(vtLang?.duration || anyLang?.audio?.duration || 0);

		return {
			markerId: id,
			marker: m,
			micrioId: mId || image.id,
			duration,
			startView: m?.view,
			imageHasOtherMarkers: mId ? !!data?.markers?.find(m => m.id != id && !m.noMarker) : false,
			gridView: !!(m.data?._meta?.gridView || m.data?._meta?.gridAction),
			chapter,
		};
	}).filter((si): si is Models.ImageData.MarkerTourStepInfo => si !== undefined);

	notFound.reverse().forEach(i => tour.steps.splice(i, 1));
	tour.initialStep = 0;
	tour.duration = tour.stepInfo.reduce((d, s) => d + (s.duration || 0), 0);
}

