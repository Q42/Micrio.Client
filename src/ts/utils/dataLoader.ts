/**
 * Centralized data loading controller.
 * Uses the new `bundle.json` endpoint (which returns info + data for multiple
 * related images in one request) and falls back to individual `info.json` /
 * `data.json` when the bundle doesn't contain a requested image.
 *
 * This is the single source of truth for image info & data fetches.
 * All other code imports {@link getInfo}, {@link getBundleImage}, etc. directly.
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

/** Images resolved from `bundle.json` responses, keyed by image ID. */
const bundleCache = new Map<string, BundleImage>();

/** Bundle URLs that have been attempted and failed (e.g. 404). */
const fetchedBundles = new Set<string>();

/** Individually-fetched data objects, keyed by image ID (fallback path). */
const dataOnlyCache = new Map<string, Models.ImageData.ImageData>();

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Fetches `bundle.json` for a given ID and caches every image it contains.
 * Subsequent calls for the same URL are no-ops unless `refresh` is true.
 */
async function ensureBundleFetched(id: string, refresh?: boolean): Promise<void> {
	if (!id || id.startsWith('http')) return;

	const url = `${VIEWER_BASE}${id}/bundle.json`;

	if (!refresh) {
		if (fetchedBundles.has(url)) return;
		// Already have this ID cached from a previous bundle fetch
		if (bundleCache.has(id)) return;
	} else {
		fetchedBundles.delete(url);
	}

	try {
		const bundle = await fetchJson<BundleImage[]>(url, refresh);
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

/**
 * Returns the {@link Models.ImageInfo.ImageInfo} for a given image ID.
 *
 * 1. Checks the bundle cache first.
 * 2. Tries `bundle.json` (skipped for IIIF images).
 * 3. Falls back to the individual `info.json` endpoint.
 *
 * @param id    The image ID.
 * @param path  Optional custom base path for the `info.json` fallback
 *              (defaults to {@link VIEWER_BASE}).
 * @param refresh  If true, bypasses all caches for this ID.
 */
export async function getInfo(
	id: string,
	path?: string,
	refresh?: boolean,
): Promise<Models.ImageInfo.ImageInfo | undefined> {
	if (!id) return;

	// 1. Bundle cache hit
	if (!refresh && bundleCache.has(id)) {
		const info = bundleCache.get(id)!.info;
		Sanitizer.imageInfo(info);
		return info;
	}

	// 2. Try bundle.json
	await ensureBundleFetched(id, refresh);

	if (bundleCache.has(id)) {
		const info = bundleCache.get(id)!.info;
		Sanitizer.imageInfo(info);
		return info;
	}

	// 3. Fallback – individual info.json
	const info = await fetchJson<Models.ImageInfo.ImageInfo>(
		`${path ?? VIEWER_BASE}${id}/info.json`,
		refresh,
	);
	if (info) {
		Sanitizer.imageInfo(info);
		return info;
	}
}

/**
 * Returns the {@link Models.ImageData.ImageData} for a given image ID.
 *
 * 1. Checks the bundle cache first.
 * 2. Tries `bundle.json`.
 * 3. Falls back to the individual `data.json` endpoint (always from
 *    {@link VIEWER_BASE}).
 *
 * @param id    The image ID.
 * @param path  Optional custom base path for the `info.json` *fallback* (only
 *              used to check revision availability; `data.json` is always from
 *              `VIEWER_BASE`).
 * @param refresh  If true, bypasses all caches.
 */
export async function getData(
	id: string,
	path?: string,
	refresh?: boolean,
): Promise<Models.ImageData.ImageData | undefined> {
	if (!id) return;

	// 1. Bundle cache hit
	if (!refresh && bundleCache.has(id)) {
		const cached = bundleCache.get(id)!;
		if (cached.data) return cached.data;
	}

	// 2. Individual data cache hit
	if (!refresh && dataOnlyCache.has(id)) {
		return dataOnlyCache.get(id);
	}

	// 3. Try bundle.json
	await ensureBundleFetched(id, refresh);

	if (bundleCache.has(id)) {
		const cached = bundleCache.get(id)!;
		if (cached.data) return cached.data;
	}

	// 4. Need info first to check for published revisions
	const info = await getInfo(id, path, refresh);
	if (!info) return;

	const langs = info.revision ? Object.keys(info.revision) : [];
	if (!langs.length) return;

	// 5. Fallback – individual data.json
	const data = await fetchJson<Models.ImageData.ImageData>(
		`${VIEWER_BASE}${id}/data.json`,
		refresh,
	);
	if (data) {
		dataOnlyCache.set(id, data);
		return data;
	}
}

/**
 * Returns both {@link Models.ImageInfo.ImageInfo info} and
 * {@link Models.ImageData.ImageData data} for a single image ID.
 *
 * @param id    The image ID.
 * @param path  Optional custom base path for the `info.json` fallback.
 * @param refresh  If true, bypasses all caches.
 */
export async function getBundleImage(
	id: string,
	path?: string,
	refresh?: boolean,
): Promise<
	{ data: Models.ImageData.ImageData; info: Models.ImageInfo.ImageInfo } | undefined
> {
	const info = await getInfo(id, path, refresh);
	if (!info) return;

	const data = await getData(id, path, refresh);
	if (!data) return;

	return { data, info };
}

/**
 * Bulk variant of {@link getBundleImage}.
 *
 * Fetches a single bundle for the first non‑IIIF ID and then resolves every
 * requested image from cache or individual fallback.
 *
 * @returns A map keyed by image ID.
 */
export async function getBundleImages(
	ids: string[],
	path?: string,
	refresh?: boolean,
): Promise<
	Map<string, { info: Models.ImageInfo.ImageInfo; data: Models.ImageData.ImageData }>
> {
	const result = new Map<
		string,
		{ info: Models.ImageInfo.ImageInfo; data: Models.ImageData.ImageData }
	>();
	if (!ids.length) return result;

	// Seed the cache by fetching the bundle for the first standard ID
	const primaryId = ids.find((id) => !id?.startsWith('http'));
	if (primaryId) await ensureBundleFetched(primaryId, refresh);

	const entries = await Promise.all(
		ids.map(async (id) => {
			const entry = await getBundleImage(id, path, refresh);
			return { id, entry };
		}),
	);

	for (const { id, entry } of entries) {
		if (entry) result.set(id, entry);
	}

	return result;
}


