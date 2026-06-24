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
const spaceCache = new Map<string, Models.Spaces.Space>();
let orgCache: Models.ImageInfo.Organisation | undefined;

// ── Internal helpers ──────────────────────────────────────────────────────────

async function ensureBundleFetched(id: string): Promise<void> {
	if (!id || id.startsWith('http')) return;
	if (bundleCache.has(id)) return;

	const bundle = await fetchJson<Models.ImageBundle.BundleResponse>(`${VIEWER_BASE}${id}/bundle.json`);
	if (bundle?.images) {
		for (const entry of bundle.images) {
			if (entry?.id) {
				bundleCache.set(entry.id, entry);
			}
		}
	}
	if (bundle?.organisation) {
		orgCache = bundle.organisation;
	}
	if (bundle?.spaces) {
		for (const space of bundle.spaces) {
			if (space?.id && space?.data) {
				spaceCache.set(space.id, space.data);
			}
		}
	}
}

// ── Public API ────────────────────────────────────────────────────────────────

export const DataLoader = {

	/** Returns the info for an image ID, or undefined if not found in its bundle. */
	async getInfo(id: string): Promise<Models.ImageInfo.ImageInfo | undefined> {
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
	},

	/** Returns the data for an image ID, or undefined if not found in its bundle. */
	async getData(id: string): Promise<Models.ImageData.ImageData | undefined> {
		if (!id) return;

		if (bundleCache.has(id)) {
			return bundleCache.get(id)!.data;
		}

		await ensureBundleFetched(id);

		if (bundleCache.has(id)) {
			return bundleCache.get(id)!.data;
		}
	},

	/** Synchronous accessor for already-cached bundle data. */
	getDataSync(id: string): Models.ImageData.ImageData | undefined {
		return bundleCache.get(id)?.data;
	},

	/**
	 * Resolves the marker for a tour step from the already-loaded bundle cache.
	 * This replaces the earlier static `.marker` JSON that was inlined in stepInfo.
	 */
	getStepMarker(step: Models.ImageData.MarkerTourStepInfo): Models.ImageData.Marker | undefined {
		const data = this.getDataSync(step.micrioId);
		return data?.markers?.find(m => m.id === step.markerId);
	},

	/** Returns the space data for a space ID, or undefined if not found in its bundle. */
	getSpaceData(id: string): Models.Spaces.Space | undefined {
		return spaceCache.get(id);
	},

	/** Returns the organisation data from the bundle, or undefined. */
	getOrganisation(): Models.ImageInfo.Organisation | undefined {
		return orgCache;
	},

	/**
	 * Returns both info + data for a single image ID, or undefined if the image
	 * is not present in its bundle.
	 */
	async getBundleImage(
		id: string,
	): Promise<
		{ data: Models.ImageData.ImageData; info: Models.ImageInfo.ImageInfo } | undefined
	> {
		const info = await this.getInfo(id);
		if (!info) return;

		const data = await this.getData(id);
		if (!data) return;

		return { data, info };
	},

	/**
	 * Bulk variant of {@link getBundleImage}.
	 *
	 * Fetches the bundle for the first non‑IIIF ID, then resolves every requested
	 * image from the cached bundle results.
	 */
	async getBundleImages(
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
				const entry = await this.getBundleImage(id);
				return { id, entry };
			}),
		);

		for (const { id, entry } of entries) {
			if (entry) result.set(id, entry);
		}

		return result;
	},
};
