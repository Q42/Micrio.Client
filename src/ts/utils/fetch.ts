/**
 * Data fetching utilities with caching support.
 * @author Marcel Duin <marcel@micr.io>
 */

import type { Models } from '$types/models';
import { VIEWER_BASE } from '../globals';
import { clone } from './object';
import { MicrioError } from './error';

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
 * @internal
 * @template T The expected type of the JSON data.
 * @param uri The URI to fetch JSON from.
 * @param noCache If true, appends a random query parameter to bypass browser cache.
 * @returns A Promise resolving to the fetched JSON data (type T) or undefined on error.
 */
export const fetchJson = async <T = Object>(uri: string, noCache?: boolean): Promise<T | undefined> => {
	if (!noCache && jsonCache.has(uri)) return clone<T>(jsonCache.get(uri) as T); // Return cached data if available
	if (jsonPromises.has(uri)) return jsonPromises.get(uri) as Promise<T>; // Return existing promise if fetch is in progress
	if (jsonErrors.has(uri)) throw jsonErrors.get(uri)![1];

	// Create and store the fetch promise
	const promise = fetch(uri + (noCache ? (uri.includes('?') ? '&' : '?') + Math.random() : '')).then(async r => {
		if (r.status == 200) return r.json();
		else {
			const err = MicrioError.fromResponse(r, `fetchJson(${uri})`);
			jsonErrors.set(uri, [r.status, err.message]);
			throw err;
		}
	}).then(j => {
		if (!noCache) jsonCache.set(uri, j); // Store result in cache
		jsonPromises.delete(uri); // Remove promise from tracking map
		return clone(j);
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
 * Fetches album info JSON (`album/[id].json`) from the Micrio CDN.
 * Uses predefined data if available (`MICRIO_ALBUM`).
 * @internal
 * @param id The album ID.
 * @returns A Promise resolving to the AlbumInfo object or undefined on error.
 */
export const fetchAlbumInfo = (id: string): Promise<Models.AlbumInfo | undefined> =>
	'MICRIO_ALBUM' in self ? Promise.resolve(self['MICRIO_ALBUM'] as Models.AlbumInfo) : fetchJson<Models.AlbumInfo>(`${VIEWER_BASE}album/${id}.json`);
