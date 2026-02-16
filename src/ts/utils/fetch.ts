/**
 * Data fetching utilities with caching support.
 * @author Marcel Duin <marcel@micr.io>
 */

import type { Models } from '../../types/models';
import type { PREDEFINED } from '../../types/internal';
import { sanitizeImageInfo, isLegacyViews } from './sanitize';
import { View } from './view';
import { withRetry, MicrioError, ErrorCodes } from './index';

/** Global cache for fetched JSON data, keyed by URI.
 * @internal
 */
export const jsonCache: Map<string, Object> = new Map();

/** Map to track ongoing JSON fetch Promises, preventing duplicate requests.
 * @internal
 */
const jsonPromises: Map<string, Promise<Object>> = new Map();
const jsonErrors: Map<string, [number, string]> = new Map();

/**
 * Fetches JSON data from a URI, utilizing a cache to avoid redundant requests.
 * Handles ongoing requests to prevent fetching the same URI multiple times concurrently.
 * Includes automatic retry with exponential backoff for transient failures.
 * 
 * @internal
 * @template T The expected type of the JSON data.
 * @param uri The URI to fetch JSON from.
 * @param noCache If true, appends a random query parameter to bypass browser cache.
 * @returns A Promise resolving to the fetched JSON data (type T) or undefined on error.
 */
export const fetchJson = async <T = Object>(uri: string, noCache?: boolean): Promise<T | undefined> => {
	if (!noCache && jsonCache.has(uri)) return jsonCache.get(uri) as T; // Return cached data if available
	if (jsonPromises.has(uri)) return jsonPromises.get(uri) as Promise<T>; // Return existing promise if fetch is in progress
	if (jsonErrors.has(uri)) {
		const [status, error] = jsonErrors.get(uri)!;
		throw new MicrioError(error, { code: status >= 500 ? ErrorCodes.NETWORK_SERVER_ERROR : ErrorCodes.DATA_NOT_FOUND, statusCode: status });
	}

	// Create and store the fetch promise with retry logic
	const promise = withRetry(
		async () => {
			const response = await fetch(uri + (noCache ? '?' + Math.random() : ''));
			
			if (response.status === 200) {
				return response.json();
			} else {
				const errorText = await response.text();
				jsonErrors.set(uri, [response.status, errorText]);
				throw MicrioError.fromResponse(response, `Failed to fetch ${uri}`);
			}
		},
		{
			maxAttempts: 3,
			onRetry: (attempt, error, delay) => {
				console.warn(`[Micrio] Fetch retry ${attempt}/3 for ${uri}: ${error.message} (retrying in ${Math.round(delay)}ms)`);
			}
		}
	).then(j => {
		if (!noCache) jsonCache.set(uri, j); // Store result in cache
		jsonPromises.delete(uri); // Remove promise from tracking map
		jsonErrors.delete(uri); // Clear any previous error
		return j;
	}).catch(e => { // Handle fetch errors
		jsonPromises.delete(uri);
		throw e;
	});
	
	jsonPromises.set(uri, promise); // Track the ongoing promise
	return promise as Promise<T>;
};

/**
 * Checks if a JSON resource is cached or currently being fetched.
 * @internal
 * @param uri The URI to check.
 * @returns True if the resource is cached or being fetched.
 */
export const isFetching = (uri: string): boolean => jsonCache.has(uri) || jsonPromises.has(uri);

/**
 * Retrieves predefined data (info, data) for a given ID from the global `MICRIO_DATA` variable,
 * which might be populated by server-side rendering or embedding scripts.
 * @internal
 * @param id The Micrio image ID.
 * @returns The predefined data array `[id, info, data]` or undefined if not found.
 */
export const getLocalData = (id: string): PREDEFINED | undefined =>
	'MICRIO_DATA' in self ? (<unknown>self?.['MICRIO_DATA'] as PREDEFINED[]).find((p: PREDEFINED) => p[0] == id) : undefined;

/**
 * Fetches the `info.json` file for a given Micrio ID.
 * Uses `getLocalData` first, then falls back to `fetchJson`.
 * Handles legacy V1 info format and sanitizes the result.
 * @internal
 * @param id The Micrio image ID.
 * @param path Optional base path override.
 * @param refresh If true, forces a cache bypass for the fetch.
 * @returns A Promise resolving to the sanitized ImageInfo object or undefined on error.
 */
export const fetchInfo = (id: string, path?: string, refresh?: boolean): Promise<Models.ImageInfo.ImageInfo | undefined> => {
	const ld = getLocalData(id)?.[1]; // Check local predefined data first
	return ld ? Promise.resolve(ld) : fetchJson(`${path ?? 'https://i.micr.io/'}${id}/info.json`, refresh) // Fetch if not local
		.then(r => {
			// Handle ancient Micrio V1 static info.json format
			/** @ts-ignore */
			if (r) { if ('Height' in r) { r.height = r['Height']; r.version = 1.0; r.tileSize = 512; } if ('Width' in r) r.width = r['Width']; }
			sanitizeImageInfo(r as Models.ImageInfo.ImageInfo | undefined); // Sanitize URLs etc.
			return r as Models.ImageInfo.ImageInfo | undefined;
		});
};

/**
 * Fetches album info JSON (`album/[id].json`) from the Micrio CDN.
 * Uses predefined data if available (`MICRIO_ALBUM`).
 * @internal
 * @param id The album ID.
 * @returns A Promise resolving to the AlbumInfo object or undefined on error.
 */
export const fetchAlbumInfo = (id: string): Promise<Models.AlbumInfo | undefined> =>
	'MICRIO_ALBUM' in self ? Promise.resolve(self['MICRIO_ALBUM'] as Models.AlbumInfo) : fetchJson<Models.AlbumInfo>(`https://i.micr.io/album/${id}.json`);

// Re-export isLegacyViews for convenience
export { isLegacyViews };

