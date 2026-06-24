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

// ── Internal types ────────────────────────────────────────────────────────────

type BundleImage = Models.ImageBundle.BundleImage;

// ── Global singleton caches (shared across all <micr-io> elements) ────────────

const bundleCache = new Map<string, BundleImage>();
const spaceCache = new Map<string, Models.Spaces.Space>();
const inflightFetches = new Map<string, Promise<void>>();
let orgCache: Models.ImageInfo.Organisation | undefined;

// ── Internal helpers ──────────────────────────────────────────────────────────

async function fetchBundleOnce(id: string): Promise<void> {
	if (!id || id.startsWith('http') || bundleCache.has(id)) return;
	if (inflightFetches.has(id)) return inflightFetches.get(id)!;

	const promise = doFetchBundle(id);
	inflightFetches.set(id, promise);
	try {
		await promise;
	} finally {
		inflightFetches.delete(id);
	}
}

async function doFetchBundle(id: string): Promise<void> {
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
		return (await this.getBundleImage(id))?.info;
	},

	/** Returns the data for an image ID, or undefined if not found in its bundle. */
	async getData(id: string): Promise<Models.ImageData.ImageData | undefined> {
		return (await this.getBundleImage(id))?.data;
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
	 * Returns the full bundle entry (info + data) for a single image ID,
	 * fetching the bundle once if not cached.
	 */
	async getBundleImage(id: string): Promise<BundleImage | undefined> {
		if (!id) return;
		await fetchBundleOnce(id);
		return bundleCache.get(id);
	},
};
