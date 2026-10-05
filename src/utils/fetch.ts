/**
 * Data fetching utilities with caching support.
 * @author Marcel Duin <marcel@micr.io>
 */

import { MicrioError } from '$core/error';

/**
 * A parsed JSON payload, as returned by `JSON.parse`. JSON is untyped until a caller of
 * {@link fetchJson} declares the shape it expects, so the caches below hold it as such.
 * @internal
 */
type ParsedJson = ReturnType<typeof JSON.parse>;

/** Global cache for fetched JSON data, keyed by URI.
 * @internal
 */
export const jsonCache = new Map<string, ParsedJson>();

/** Map to track ongoing JSON fetch Promises, preventing duplicate requests.
 * @internal
 */
const jsonPromises = new Map<string, Promise<ParsedJson>>();

/**
 * Fetches JSON data from a URI, utilizing a cache to avoid redundant requests.
 * Handles ongoing requests to prevent fetching the same URI multiple times concurrently.
 * @internal
 * @template T The expected type of the JSON data.
 * @param uri The URI to fetch JSON from.
 * @param noCache If true, appends a random query parameter to bypass browser cache.
 * @returns A Promise resolving to the fetched JSON data (type T) or undefined on error.
 */
export const fetchJson = async <T = object>(uri: string, noCache?: boolean): Promise<T | undefined> => {
	if (!noCache && jsonCache.has(uri)) {return structuredClone(jsonCache.get(uri));}
	if (jsonPromises.has(uri)) {return jsonPromises.get(uri);} // Return existing promise if fetch is in progress

	// Create and store the fetch promise
	const promise = fetch(uri + (noCache ? (uri.includes('?') ? '&' : '?') + Math.random() : '')).then(r => {
		if (r.status === 200) {return r.json();}
			throw MicrioError.fromResponse(r, `fetchJson(${uri})`);
		
	}).then(j => {
		if (!noCache) {jsonCache.set(uri, j);} // Store result in cache
		jsonPromises.delete(uri); // Remove promise from tracking map
		return structuredClone(j);
	}).catch(e => { // Handle fetch errors
		jsonPromises.delete(uri);
		throw e;
	});
	jsonPromises.set(uri, promise); // Track the ongoing promise
	return await promise;
};


