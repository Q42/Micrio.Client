/**
 * Data fetching utilities with caching support.
 * @author Marcel Duin <marcel@micr.io>
 */

import type { Models } from '$types/models';
import type { PREDEFINED } from '$types/internal';
import { VIEWER_BASE } from '../globals';
import { Sanitizer } from './sanitize';
import { idIsV5 } from './id';
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
	return ld ? Promise.resolve(ld) : fetchJson(`${path ?? VIEWER_BASE}${id}/info.json`, refresh) // Fetch if not local
		.then(r => {
			Sanitizer.imageInfo(r as Models.ImageInfo.ImageInfo | undefined); // Sanitize URLs etc.
			return r as Models.ImageInfo.ImageInfo | undefined;
		});
};

/**
 * Fetches image data and sanitizes it to V5 format.
 * V5 images load `pub.json`; V4 images load all `data.{lang}.json` files
 * and merge them via {@link Sanitizer.v4DataToV5}.
 * The returned data is fully sanitized (markers, embeds, assets, etc.).
 * @internal
 */
async function fetchData(
	id: string,
	dataPath: string,
	info: Models.ImageInfo.ImageInfo,
	lang: string,
	isLegacyViews: boolean,
	refresh?: boolean,
): Promise<Models.ImageData.ImageData | undefined> {
	let data: Models.ImageData.ImageData | undefined;

	if (idIsV5(id)) {
		data = await fetchJson<Models.ImageData.ImageData>(`${dataPath}${id}/data/pub.json`, refresh);
	} else {
		// V4: fetch per-language data files and merge into V5
		const langs = info.revision ? Object.keys(info.revision) : [];
		if (!langs.length) return undefined;

		const allLangData: Record<string, Record<string, unknown>> = {};
		await Promise.all(langs.map(async lang => {
			const ld = await fetchJson<Record<string, unknown>>(`${dataPath}${id}/data.${lang}.json`).catch(() => undefined);
			if (ld) allLangData[lang] = ld;
		}));
		if (!Object.keys(allLangData).length) return undefined;

		data = Sanitizer.v4DataToV5(allLangData);
	}

	if (data) Sanitizer.imageData(data, lang, isLegacyViews);
	return data;
}

/**
 * Fetches both info and image data, sanitizing data with the correct
 * `isLegacyViews` determined from the info. All-in-one convenience for
 * loading external/linked image data (e.g. serial tours).
 * @internal
 */
export async function fetchImageData(
	id: string,
	dataPath: string,
	lang: string,
	refresh?: boolean,
	infoPath?: string,
): Promise<{ data: Models.ImageData.ImageData; info: Models.ImageInfo.ImageInfo } | undefined> {
	const info = await fetchInfo(id, infoPath);
	if (!info) return undefined;
	const data = await fetchData(id, dataPath, info, lang, Sanitizer.isLegacyViews(info), refresh);
	return data ? { data, info } : undefined;
}

/**
 * Fetches album info JSON (`album/[id].json`) from the Micrio CDN.
 * Uses predefined data if available (`MICRIO_ALBUM`).
 * @internal
 * @param id The album ID.
 * @returns A Promise resolving to the AlbumInfo object or undefined on error.
 */
export const fetchAlbumInfo = (id: string): Promise<Models.AlbumInfo | undefined> =>
	'MICRIO_ALBUM' in self ? Promise.resolve(self['MICRIO_ALBUM'] as Models.AlbumInfo) : fetchJson<Models.AlbumInfo>(`${VIEWER_BASE}album/${id}.json`);



