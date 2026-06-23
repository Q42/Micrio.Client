/**
 * Centralized data loading controller.
 * Uses the `bundle.json` endpoint which returns info + data for multiple
 * related images in a single request.
 *
 * If the bundle fails the image is simply unavailable — there are no
 * individual `info.json` / `data.json` fallbacks.
 *
 * This is the single source of truth for image info & data fetches.
 *
 * @author Marcel Duin <marcel@micr.io>
 */

import type { Models } from '$types/models';
import { VIEWER_BASE } from '../globals';
import { fetchJson } from './fetch';
import { Sanitizer } from './sanitize';

// ── Internal types ────────────────────────────────────────────────────────────

type BundleImage = Models.ImageBundle.BundleImage;

// ── Global singleton caches (shared across all <micr-io> elements) ────────────

const bundleCache = new Map<string, BundleImage>();
const fetchedBundles = new Set<string>();

// ── Internal helpers ──────────────────────────────────────────────────────────

async function ensureBundleFetched(id: string): Promise<void> {
	if (!id || id.startsWith('http')) return;

	const url = `${VIEWER_BASE}${id}/bundle.json`;

	if (fetchedBundles.has(url)) return;
	if (bundleCache.has(id)) return;

	try {
		const bundle = await fetchJson<BundleImage[]>(url);
		if (bundle && Array.isArray(bundle)) {
			for (const entry of bundle) {
				if (entry?.id) {
					bundleCache.set(entry.id, entry);
				}
			}
		}
	} catch {
		fetchedBundles.add(url);
	}
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Returns the info for an image ID, or undefined if not found in its bundle. */
export async function getInfo(
	id: string,
): Promise<Models.ImageInfo.ImageInfo | undefined> {
	if (!id) return;

	if (bundleCache.has(id)) {
		const info = bundleCache.get(id)!.info;
		Sanitizer.imageInfo(info);
		return info;
	}

	await ensureBundleFetched(id);

	if (bundleCache.has(id)) {
		const info = bundleCache.get(id)!.info;
		Sanitizer.imageInfo(info);
		return info;
	}
}

/** Returns the data for an image ID, or undefined if not found in its bundle. */
export async function getData(
	id: string,
): Promise<Models.ImageData.ImageData | undefined> {
	if (!id) return;

	if (bundleCache.has(id)) {
		return bundleCache.get(id)!.data;
	}

	await ensureBundleFetched(id);

	if (bundleCache.has(id)) {
		return bundleCache.get(id)!.data;
	}
}

/**
 * Returns both info + data for a single image ID, or undefined if the image
 * is not present in its bundle.
 */
export async function getBundleImage(
	id: string,
): Promise<
	{ data: Models.ImageData.ImageData; info: Models.ImageInfo.ImageInfo } | undefined
> {
	const info = await getInfo(id);
	if (!info) return;

	const data = await getData(id);
	if (!data) return;

	return { data, info };
}

/**
 * Bulk variant of {@link getBundleImage}.
 *
 * Fetches the bundle for the first non‑IIIF ID, then resolves every requested
 * image from the cached bundle results.
 */
export async function getBundleImages(
	ids: string[],
): Promise<
	Map<string, { info: Models.ImageInfo.ImageInfo; data: Models.ImageData.ImageData }>
> {
	const result = new Map<
		string,
		{ info: Models.ImageInfo.ImageInfo; data: Models.ImageData.ImageData }
	>();
	if (!ids.length) return result;

	const primaryId = ids.find((id) => !id?.startsWith('http'));
	if (primaryId) await ensureBundleFetched(primaryId);

	const entries = await Promise.all(
		ids.map(async (id) => {
			const entry = await getBundleImage(id);
			return { id, entry };
		}),
	);

	for (const { id, entry } of entries) {
		if (entry) result.set(id, entry);
	}

	return result;
}


