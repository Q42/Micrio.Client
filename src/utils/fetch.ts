/**
 * Data fetching utilities with caching support.
 * @author Marcel Duin <marcel@micr.io>
 */

import { MicrioError } from '$core/error';

/** Global cache for fetched JSON data, keyed by URI. Values are untyped JSON.
 * @internal
 */
export const jsonCache = new Map<string, unknown>();

/** Map to track ongoing JSON fetch Promises, preventing duplicate requests.
 * @internal
 */
const jsonPromises = new Map<string, Promise<unknown>>();

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
	// JSON has no runtime schema: the shape is declared by the caller through `T`.
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- unverifiable cached JSON; the contract is `T`
	if (!noCache && jsonCache.has(uri)) {return structuredClone(jsonCache.get(uri)) as T;}
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the in-flight promise resolves the same untyped JSON
	if (jsonPromises.has(uri)) {return jsonPromises.get(uri) as Promise<T>;} // Return existing promise if fetch is in progress

	// Create and store the fetch promise
	const promise = fetch(uri + (noCache ? (uri.includes('?') ? '&' : '?') + Math.random() : '')).then(r => {
		if (r.status === 200) {return r.json();}
			throw MicrioError.fromResponse(r, `fetchJson(${uri})`);
		
	}).then((j: unknown) => {
		if (!noCache) {jsonCache.set(uri, j);} // Store result in cache
		jsonPromises.delete(uri); // Remove promise from tracking map
		return structuredClone(j);
	}).catch(e => { // Handle fetch errors
		jsonPromises.delete(uri);
		throw e;
	});
	jsonPromises.set(uri, promise); // Track the ongoing promise
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the caller declares the shape via `T`
	return await promise as T;
};


