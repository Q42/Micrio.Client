/**
 * Global utility functions used throughout the Micrio application.
 * Includes math helpers, browser detection, data fetching, object manipulation,
 * string formatting, Svelte store helpers, and data sanitization logic.
 * @author Marcel Duin <marcel@micr.io>
 */

import type { Readable, Unsubscriber } from 'svelte/store';
import type { Models } from '../types/models';
import type { MicrioImage } from './image';
import type { PREDEFINED } from '../types/internal';
import type { HTMLMicrioElement } from './element';

import { tick } from 'svelte';

/**
 * Calculates the hypotenuse of a right triangle given the lengths of the other two sides.
 * @internal
 * @param a Length of side a.
 * @param b Length of side b.
 * @returns The length of the hypotenuse.
 */
export const pyth = (a:number, b:number) : number => Math.sqrt(a*a+b*b);

/**
 * Calculates the modulo of n divided by m, ensuring a positive result.
 * @internal
 * @param n The dividend.
 * @param m The divisor (defaults to 1).
 * @returns The positive modulo result.
 */
export const mod = (n:number,m:number=1) : number => (n%m+m)%m;

/**
 * Creates a deep clone of an object using JSON stringify/parse.
 * Note: This will lose functions, Date objects, undefined values, etc.
 * @internal
 * @template T The type of the object being cloned.
 * @param o The object to clone.
 * @returns A deep clone of the object.
 */
export const clone = <T>(o:T) : T => JSON.parse(JSON.stringify(o)) as T;

/**
 * Generates a pseudo-random GUID (Globally Unique Identifier).
 * @internal
 * @link http://stackoverflow.com/questions/105034/how-to-create-a-guid-uuid-in-javascript
 * @returns A string representing a GUID (e.g., "1a2b3c4d-5e6f-7g8h-9i0j-1k2l3m4n5o6p").
 */
export const createGUID = () : string => s4()+s4()+'-'+s4()+'-'+s4()+'-'+s4()+'-'+s4()+s4()+s4();

/** Internal helper for GUID generation. Generates a 4-character hex string. */
const s4 = ():string => Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);

/**
 * Returns a Promise that resolves after a specified number of milliseconds.
 * @internal
 * @param ms The number of milliseconds to wait. If 0, resolves immediately.
 */
export const sleep = (ms:number) => new Promise<void>(ok => ms ? setTimeout(ok, ms) : ok());

// --- Browser Detection ---
/** Type definition for the Browser detection object. */
type Browser = {
	iOS: boolean; // Is it an iOS device (iPhone, iPad, iPod)?
	firefox: boolean; // Is the browser Firefox?
	OSX: boolean; // Is the operating system macOS?
	hasTouch: boolean; // Does the browser support touch events?
	safari: boolean; // Is the browser Safari (including iOS Safari)?
}

/** User agent string for browser detection. */
const ua = navigator.userAgent;

/**
 * Object containing boolean flags for detected browser/OS features.
 * @internal
 */
export const Browser:Browser = {
	iOS: /ipad|iphone|ipod/i.test(ua),
	firefox: /firefox/i.test(ua),
	OSX: /macintosh/i.test(ua) && /os\ x/i.test(ua),
	hasTouch: 'TouchEvent' in self, // Check for TouchEvent support
	safari: false // Initialized later
};

// Refine Safari detection (must be OSX/iOS, contain 'safari' or 'instagram', but not 'chrome')
Browser.safari = (Browser.OSX || Browser.iOS) && (/safari/i.test(ua) || /instagram/i.test(ua)) && !/chrome/i.test(ua);

// Correct detection for iPads identifying as macOS but supporting touch events
if(Browser.OSX && (Browser.safari && 'TouchEvent' in self)) {
	Browser.iOS = true;
	Browser.OSX = false;
}

/**
 * Performs a deep copy from one object to another, merging properties.
 * @internal
 * @param from The source object.
 * @param into The target object (will be modified).
 * @param opts Options for copying:
 *   - `mergeArrays`: If true, arrays in `from` are concatenated onto arrays in `into`.
 *   - `noOverwrite`: If true, existing properties in `into` will not be overwritten.
 * @returns The modified `into` object.
 */
export function deepCopy(from:any, into:any, opts:{
	mergeArrays?:boolean;
	noOverwrite?:boolean;
}={}) : any {
	for(let x in from) {
		// Recursively copy nested objects
		if(!!from[x] && from[x]['constructor'] != undefined && from[x]['constructor']['name'] == 'Object') {
			if(!into[x] || typeof into[x] != 'object') into[x] = {}; // Initialize target if needed
			deepCopy(from[x], into[x],opts);
		}
		// Handle other types (primitives, arrays)
		else {
			if(opts.mergeArrays && into[x] instanceof Array && from[x] instanceof Array) into[x].push(...from[x]); // Merge arrays
			else if(!opts.noOverwrite || !(x in into)) into[x] = from[x]; // Copy value if not overwriting or target doesn't exist
		}
	}
	return into;
}

/**
 * Converts a string into a URL-friendly slug.
 * Removes accents, converts to lowercase, replaces spaces with hyphens, and removes invalid characters.
 * @internal
 * @param str The input string.
 * @returns The slugified string, or undefined if the input was undefined.
 */
export const slugify = (str:string|undefined) : string|undefined => {
	if(str === undefined) return str;
	str = str.replace(/^\s+|\s+$/g, ''); // trim
	str = str.toLowerCase();

	// remove accents, swap ñ for n, etc
	const from = "àáäâèéëêìíïîòóöôùúüûñç·/_,:;";
	const to   = "aaaaeeeeiiiioooouuuunc------";
	for (var i=0, l=from.length ; i<l ; i++) {
		str = str.replace(new RegExp(from.charAt(i), 'g'), to.charAt(i));
	}

	str = str.replace(/[^a-z0-9 -]/g, '') // remove invalid chars
		.replace(/\s+/g, '-') // collapse whitespace and replace by -
		.replace(/-+/g, '-'); // collapse dashes

	return str;
}

/**
 * Svelte hack to disable attribute type checking warnings in the editor/language server.
 * @internal
 * @param x Any value.
 * @returns The same value, but typed as `any`.
 */
export const notypecheck = (x:any)=>x;

/** List of script URLs already loaded or currently loading. @private */
const loaded: string[] = [];

/**
 * Loads an external JavaScript file dynamically. Ensures scripts are loaded only once per session.
 * @internal
 * @param src The URL of the script to load.
 * @param cbFunc Optional global callback function name to be called upon script load.
 * @param targetObj Optional target object (if provided, assumes script is already loaded).
 * @returns A Promise that resolves when the script is loaded, or rejects on error.
 */
export const loadScript = (src:string, cbFunc?:string, targetObj?:any) => new Promise((ok:Function, err:Function) => {
	if(targetObj || loaded.indexOf(src) >= 0) return ok(); // Already loaded or target exists
	const script = document.createElement('script');
	const onload = () => { loaded.push(src); ok(); } // Mark as loaded and resolve promise
	/** @ts-ignore Assign global callback if provided */
	if(cbFunc) self[cbFunc] = onload;
	else script.onload = onload; // Use standard onload otherwise
	script.onerror = () => err && err(); // Reject on error
	script.async = true;
	script.defer = true;
	if(self.crossOriginIsolated) script.crossOrigin = 'anonymous'; // Set crossOrigin for isolated environments
	script.src = src;
	document.head.appendChild(script);
});

/**
 * Converts seconds into a human-readable time string (hh?:mm:ss).
 * @param s Time in seconds. Can be negative for remaining time display.
 * @returns Formatted time string (e.g., "1:23", "1:05:09", "-0:15").
 */
export function parseTime(s:number):string {
	const neg = s < 0; // Check if negative
	if(neg) s *= -1; // Work with positive value
	let r = [0,0,Math.ceil(s)]; // [hours, minutes, seconds] - ceil seconds
	// Calculate minutes and hours
	for(let n of [0,1]) while(r[2-n]>=60 && (r[2-n]-=60, ++r[1-n])) {};
	// Format parts, add leading zeros for minutes/seconds, join with colons
	return (neg?'-':'')+r.filter((n,i) => i>0||n) // Filter out leading zero hours if 0
		.map((n,i) => (n<10&&i?'0':'')+n).join(':');
}

/**
 * Returns a Promise that resolves once a Svelte store's value meets certain criteria.
 * Useful for waiting until a store is initialized or reaches a specific state.
 * @internal
 * @template T The type of the store value.
 * @param s The readable Svelte store to subscribe to.
 * @param opts Options:
 *   - `targetValue`: Resolve only when the store value strictly equals this value.
 *   - `allowUndefined`: If true, resolves even if the initial value is undefined (useful for stores starting as undefined).
 * @returns A Promise that resolves with the store's value when the condition is met.
 */
export const once = <T = any>(s:Readable<T>, opts:{
	targetValue?:any;
	allowUndefined?:boolean
} = {}) : Promise<T> => new Promise(ok => {
	let initial:boolean = true; // Flag to handle initial subscription value
	let unsub:Unsubscriber; unsub = s.subscribe(v => {
		// Special handling for stores starting as undefined when allowUndefined is true
		if(initial && opts.allowUndefined && v === undefined) return;
		initial = false;
		// Check if value matches target or is simply defined (based on options)
		if(opts.targetValue !== undefined ? v === opts.targetValue : (opts.allowUndefined || (v !== undefined))) {
			// Unsubscribe and resolve
			if(unsub) unsub(); else tick().then(() => unsub()); ok(v);
		}
	})
});

/**
 * Returns a Promise that resolves once a Svelte store's value becomes undefined.
 * Useful for waiting until a state is cleared.
 * @internal
 * @template T The type of the store value.
 * @param s The readable Svelte store to subscribe to.
 * @returns A Promise that resolves with the store's value (undefined) when it becomes undefined.
 */
export const after = <T = any>(s:Readable<T>) : Promise<T> => new Promise(ok => {
	let unsub:Unsubscriber; unsub = s.subscribe(v => { if(v == undefined) { // Check for undefined
		// Unsubscribe and resolve
		if(unsub) unsub(); else tick().then(() => unsub()); ok(v);
	}})
});

/** Global cache for fetched JSON data, keyed by URI.
 * @internal
 */
export const jsonCache:Map<string, Object> = new Map();

/** Map to track ongoing JSON fetch Promises, preventing duplicate requests.
 * @internal
 */
const jsonPromises:Map<string, Promise<Object>> = new Map();

/**
 * Fetches JSON data from a URI, utilizing a cache to avoid redundant requests.
 * Handles ongoing requests to prevent fetching the same URI multiple times concurrently.
 * @internal
 * @template T The expected type of the JSON data.
 * @param uri The URI to fetch JSON from.
 * @param noCache If true, appends a random query parameter to bypass browser cache.
 * @returns A Promise resolving to the fetched JSON data (type T) or undefined on error.
 */
export const fetchJson = async <T=Object>(uri:string, noCache?:boolean) : Promise<T|undefined> => {
	if(!noCache && jsonCache.has(uri)) return jsonCache.get(uri) as T; // Return cached data if available
	if(jsonPromises.has(uri)) return jsonPromises.get(uri) as Promise<T>; // Return existing promise if fetch is in progress

	// Create and store the fetch promise
	const promise = fetch(uri+(noCache ? '?'+Math.random():'')).then(async r => {
		if(r.status == 200) return r.json() // Parse JSON on success
		else throw await r.text(); // Throw error text on failure
	}).then(j => {
		if(!noCache) jsonCache.set(uri, j); // Store result in cache
		jsonPromises.delete(uri); // Remove promise from tracking map
		return j;
	}).catch(e => { // Handle fetch errors
		jsonPromises.delete(uri); // Remove promise from tracking map on error
		return undefined; // Return undefined on error
	});
	jsonPromises.set(uri, promise); // Track the ongoing promise
	return promise as Promise<T>;
};

/**
 * Checks if a JSON resource is currently being fetched (promise exists).
 * @internal
 * @param uri The URI to check.
 * @returns True if the resource is currently being fetched.
 */
export const isFetching = (uri:string) : boolean => jsonCache.has(uri);

/**
 * Retrieves predefined data (info, data) for a given ID from the global `MICRIO_DATA` variable,
 * which might be populated by server-side rendering or embedding scripts.
 * @internal
 * @param id The Micrio image ID.
 * @returns The predefined data array `[id, info, data]` or undefined if not found.
 */
export const getLocalData = (id:string) : PREDEFINED|undefined =>
	'MICRIO_DATA' in self ? (<unknown>self?.['MICRIO_DATA'] as PREDEFINED[]).find((p:PREDEFINED) => p[0] == id) : undefined;

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
export const fetchInfo = (id:string, path?:string, refresh?:boolean) : Promise<Models.ImageInfo.ImageInfo|undefined> => {
	const ld = getLocalData(id)?.[1]; // Check local predefined data first
	return ld ? Promise.resolve(ld) : fetchJson(`${path??'https://i.micr.io/'}${id}/info.json`, refresh) // Fetch if not local
		.then(r => {
			// Handle ancient Micrio V1 static info.json format
			/** @ts-ignore */
			if(r) { if('Height' in r) { r.height = r['Height']; r.version = 1.0; r.tileSize = 512; } if('Width' in r) r.width = r['Width'] }
			sanitizeImageInfo(r as Models.ImageInfo.ImageInfo|undefined); // Sanitize URLs etc.
			return r as Models.ImageInfo.ImageInfo|undefined;
		});
}

/** Mappings for replacing old CDN hostnames with current ones in asset URLs.
 * @internal
 */
const ASSET_SRC_REPLACE: Record<string, string> = {
	'micrio-cdn.azureedge.net': 'micrio.vangoghmuseum.nl/micrio',
	'micrio-cdn.vangoghmuseum.nl': 'micrio.vangoghmuseum.nl/micrio',
	'rijks-micrio.azureedge.net': 'micrio.rijksmuseum.nl'
}

/**
 * Sanitizes asset URLs within various data structures (ImageInfo, ImageData, Embeds, Markers).
 * Replaces legacy hostnames and handles potential `fileUrl` properties.
 * @internal
 * @param a The asset object or embed object to sanitize.
 */
export const sanitizeAsset = (a?:Models.Assets.BaseAsset|Models.ImageData.Embed) : void => {
	// Handle legacy fileUrl property
	if(a instanceof Object && 'fileUrl' in a && !a.src) a.src = a.fileUrl as string;
	// Replace legacy hostnames
	if(a?.src) for(let r in ASSET_SRC_REPLACE)
		if(a.src.includes(r)) a.src = a.src.replace(r, ASSET_SRC_REPLACE[r]);
}

/**
 * Sanitizes URLs within an ImageInfo object.
 * @internal
 */
const sanitizeImageInfo = (i:Models.ImageInfo.ImageInfo|undefined) => {
	if(!i) return;
	sanitizeAsset(i.organisation?.logo);
	sanitizeAsset(i.settings?._markers?.markerIcon);
	i.settings?._markers?.customIcons?.forEach(sanitizeAsset);
	sanitizeAsset(i.settings?._360?.video);
	// Sanitize views
	if (i?.settings) {
		i.settings.view = sanitizeView(i.settings.view)!;
		i.settings.restrict = sanitizeView(i.settings.restrict)!;
	}
}

/**
 * Sanitizes URLs and marker data within an ImageData object.
 * @internal
 */
export const sanitizeImageData = (d:Models.ImageData.ImageData|undefined, is360:boolean, isV5:boolean) => {
	if (!d) return;
	// Filter out unpublished revisions (value <= 0)
	if(d.revision) d.revision = Object.fromEntries(Object.entries((d.revision??{})).filter(r => Number(r[1]) > 0));
	// Sanitize embeds
	d.embeds?.forEach(e => {
		if(!e.uuid) e.uuid = (e.id ?? e.micrioId)+'-'+Math.random(); // Ensure UUID
		sanitizeAsset(e.video);
		sanitizeAsset(e);
	});
	// Sanitize markers
	d.markers?.forEach(m => sanitizeMarker(m, is360, isV5));
	// Sanitize tours
	d.tours?.forEach(tour => {
		Object.values(tour.i18n ?? {}).forEach(c => {
			c.timeline?.forEach(t => { t.rect = sanitizeView(t.rect)!; });
		});
	});
	// Sanitize music playlist items
	d.music?.items?.forEach(sanitizeAsset);
	// Sanitize menu pages recursively
	d.pages?.forEach(sanitizeMenuPage);
}

/**
 * Sanitizes URLs within SpaceData (icons).
 * @internal
 */
export const sanitizeSpaceData = (s:Models.Spaces.Space|undefined) => {
	s?.icons?.forEach(sanitizeAsset);
}

/**
 * Recursively sanitizes URLs within Menu page data.
 * @internal
 */
const sanitizeMenuPage = (m:Models.ImageData.Menu) => {
	sanitizeAsset(m.image);
	m.children?.forEach(sanitizeMenuPage);
}

/**
 * Fetches album info JSON (`album/[id].json`) from the Micrio CDN.
 * Uses predefined data if available (`MICRIO_ALBUM`).
 * @internal
 * @param id The album ID.
 * @returns A Promise resolving to the AlbumInfo object or undefined on error.
 */
export const fetchAlbumInfo = (id:string) : Promise<Models.AlbumInfo|undefined> =>
	'MICRIO_ALBUM' in self ? Promise.resolve(self['MICRIO_ALBUM'] as Models.AlbumInfo) : fetchJson<Models.AlbumInfo>(`https://i.micr.io/album/${id}.json`);

/**
 * Sanitizes marker data, ensuring required properties exist, handling legacy formats,
 * and sanitizing asset URLs. Modifies the marker object in place.
 * @internal
 * @param m The marker data object.
 * @param is360 Is the parent image 360?
 * @param isOld Is the data from a pre-V5 image?
 */
export const sanitizeMarker = (m:Models.ImageData.Marker, is360:boolean, isOld:boolean) : void => {
	// Ensure basic properties exist
	if(!m.data) m.data = {};
	if(!m.id) m.id = createGUID();
	if(!m.tags) m.tags = [];
	if(!('type' in m)) m.type = 'default'; // Default marker type
	if(!m.popupType) m.popupType = 'popup'; // Default popup type

	// Convert legacy string icon to object format
	if(typeof m.data.icon == 'string') m.data.icon = {
		title: '', size: 0, uploaded: 0, width: -1, height: -1, src: m.data.icon as string
	}

	// Sanitize assets within the marker
	m.images?.forEach(sanitizeAsset);
	sanitizeAsset(m.positionalAudio);
	sanitizeAsset(m.data?.icon);
	Object.values(m.i18n ?? {}).forEach(d => sanitizeAsset(d.audio)) // Sanitize audio in i18n
	const embeds = 'embedImages' in m ? m.embedImages as Models.ImageData.Embed[] : undefined;
	if(embeds) embeds.forEach(e => sanitizeAsset(e)); // Sanitize legacy embedImages

	// Handle legacy split screen link format
	const oldSplitLink = m.data?._meta?.secondary;
	if(oldSplitLink) m.data.micrioSplitLink = oldSplitLink;

	// Convert legacy 'class' string to tags array
	if(isOld && 'class' in m) m.tags.push(...(m.class as string).split(' ').map(t => t.trim()).filter(t => !!t && !m.tags.includes(t)))
	// Ensure 'default' tag sets type correctly
	if(m.tags.includes('default')) m.type = 'default';
	// Sanitize view
	m.view = sanitizeView(m.view)!;
	// Sanitize videoTour timelines
	if (m.videoTour) {
		const sanitizeTimeline = (timeline?: Models.ImageData.VideoTourView[]) => {
			timeline?.forEach(t => { t.rect = sanitizeView(t.rect)!; });
		};
		if ('timeline' in m.videoTour) {
			sanitizeTimeline((m.videoTour as unknown as Models.ImageData.VideoTourCultureData).timeline);
		} else if ('i18n' in m.videoTour) {
			Object.values((m.videoTour as unknown as Models.ImageData.VideoTour).i18n ?? {}).forEach(c => sanitizeTimeline(c.timeline));
		}
	}
}

/**
 * Loads and processes data for a serial marker tour.
 * Fetches data for linked images if necessary, calculates step durations,
 * and populates the `tour.stepInfo` array.
 * @internal
 * @param image The parent MicrioImage instance.
 * @param tour The MarkerTour object.
 * @param lang The current language code.
 * @param imgData The parent image's data object.
 */
export async function loadSerialTour(image:MicrioImage, tour:Models.ImageData.MarkerTour, lang:string, imgData:Models.ImageData.ImageData) {
	// Exit if already processed or not a marker tour
	if(!('steps' in tour) || tour.stepInfo) return;

	// Extract unique IDs of linked images from tour steps
	let micIds:string[] = tour.steps.map(s => s.split(',')[1]).filter((s:string) => !!s && s != image.id);
	micIds = micIds.filter((id,i) => micIds.indexOf(id)==i);

	// Helper to get data path for an ID
	const getDataPath = (id:string) : string =>
		image.dataPath+(!image.isV5 ? id+'/data.'+lang+'.json' : id+'/data/pub.json');

	// Fetch data for all unique linked images concurrently
	const micData = await Promise.all(micIds.map(
		id => fetchJson<Models.ImageData.ImageData>(getDataPath(id))));

	// Sanitize markers in the fetched data
	micData.forEach(d => d?.markers?.forEach(m => sanitizeMarker(m, image.is360, !image.isV5)));
	// Sanitize tour cover image
	sanitizeAsset(tour.image);

	let chapter:number = -1; // Track current chapter index
	const notFound:number[] = []; // Track indices of steps where marker wasn't found
	// Process each step defined in the tour
	tour.stepInfo = tour.steps.map((s,i) : Models.ImageData.MarkerTourStepInfo|undefined => {
		const [id, mId] = s.split(','); // Extract marker ID and optional image ID
		// Find marker data (either in current image data or preloaded linked image data)
		const data = micData[micIds.indexOf(mId)] ?? imgData;
		const m = data?.markers?.find(m => m.id == id);

		// Get language-specific content and video tour data
		const content = m?.i18n?.[lang] ?? (<unknown>m as Models.ImageData.MarkerCultureData);
		if(content?.title) chapter = i; // Update chapter index if step has a title
		const vTourData = !m?.videoTour ? undefined : 'timeline' in m.videoTour ? <unknown>m as Models.ImageData.VideoTourCultureData
			: m.videoTour.i18n?.[lang] ?? undefined;

		// Sanitize assets within the step's content
		sanitizeAsset(vTourData?.audio);
		sanitizeAsset(vTourData?.subtitle);

		// Handle marker not found
		if(!m) {
			console.warn(`[Micrio] Warning: tour step ${i+1} with id [${id}] not found! Removing it from the tour`);
			notFound.push(i);
			return undefined; // Skip this step
		}

		
		sanitizeAsset(content?.audio);

		// Create step info object
		return {
			markerId: id,
			marker: m,
			micrioId: mId||image.id, // Target image ID for this step
			// Calculate duration (video tour > audio > 0)
			duration: Number(vTourData?.duration || content?.audio?.duration || 0),
			// Determine starting view (video tour timeline > marker view)
			startView: vTourData?.timeline?.length ? vTourData.timeline[0].rect : m?.view,
			// Check if the target image has other visible markers
			imageHasOtherMarkers: mId ? !!data?.markers?.find(m => m.id != id && !m.noMarker) : false,
			// Check for grid-specific flags
			gridView: !!(m.data?._meta?.gridView || m.data?._meta?.gridAction),
			chapter, // Store chapter index
			hasSubtitle: !!vTourData?.subtitle
		}
		/** @ts-ignore Filter out undefined steps later */
	}).filter<Models.ImageData.MarkerTourStepInfo>(si => typeof si === 'object');

	// Remove steps where markers were not found
	notFound.reverse().forEach(i => tour.steps.splice(i, 1));

	// Set initial tour state
	tour.initialStep = 0;
	tour.duration = tour.stepInfo.reduce((d,s) => d+(s.duration||0), 0); // Calculate total duration
}

/**
 * Decodes a character from a Micrio ID into its numeric value (used for V4 short IDs).
 * @private
 */
export const getIdVal=(a:string):number=>{let c=a.charCodeAt(0),u=c<91;return (c-=u?65:97)-(c>7?1:0)+(u?24:c>10?-1:0)}

/** Checks if an ID likely belongs to the V5 format (6 or 7 characters). */
export const idIsV5 = (id:string):boolean => id.length == 6 || id.length == 7;

/** Clamps a view rectangle the image bounds [0, 0, 1, 1]. */
export const limitView = (v: Models.Camera.View360) : Models.Camera.View360 => ({
	centerX: Math.max(0, v.centerX),
	centerY: Math.max(0, v.centerY),
	width: Math.min(1, v.centerX + v.width/2),
	height: Math.min(1, v.centerY + v.height/2)
});

/**
 * Calculates the 3D vector and navigation parameters between two images in a 360 space.
 * Used for smooth transitions between waypoints.
 * @private
 * @param micrio The main HTMLMicrioElement instance.
 * @param targetId The ID of the target image.
 * @returns An object containing the vector, normalized vector, direction, and transition parameters, or undefined if calculation fails.
 */
export function getSpaceVector(micrio:HTMLMicrioElement, targetId: string) : {
	vector: Models.Camera.Vector; // Vector used for `micrio.open` transition
	directionX: number; // Target direction X (0-1) relative to source image
	v: Models.Spaces.DirectionVector; // Raw difference vector [dx, dy, dz]
	vN: Models.Spaces.DirectionVector; // Normalized difference vector
}|undefined {
	const image = micrio.$current;
	if(!image) return; // Exit if no current image
	// Find source and target image data in spaceData
	const source = micrio.spaceData?.images.find(i => i.id == image.id);
	const target = micrio.spaceData?.images.find(i => i.id == targetId);
	if(!source||!target) return; // Exit if source or target not found

	// Calculate difference vector [dx, dy, dz]
	const v:Models.Spaces.DirectionVector = [
		(target.x ?? .5) - (source.x ?? .5),
		(source.y ?? .5) - (target.y ?? .5), // Y is inverted?
		(target.z ?? .5) - (source.z ?? .5)
	];

	// Normalize the vector
	let len = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
	if (len > 0) len = 1 / Math.sqrt(len);
	const vN:Models.Spaces.DirectionVector = [v[0]*len, v[1]*len, v[2]*len];

	// Calculate direction angle (yaw) and horizontal distance factor
	const tNDiff = .5 - (image.$settings?._360?.trueNorth??.5); // True north offset
	const directionX = mod((Math.atan2(-vN[0], vN[2])) / Math.PI/2); // Calculate yaw (0-1)
	const distanceX = Math.max(0, Math.min(.4, Math.sqrt(vN[0]*vN[0] + vN[2]*vN[2]))); // Horizontal distance factor (clamped)

	return {
		v, vN, directionX,
		vector: { // Vector object for micrio.open
			direction: directionX%1-tNDiff, // Apply true north correction
			distanceX,
			distanceY: -v[1] // Vertical distance (inverted?)
		}
	}
}

/**
 * Checks if the browser natively supports HLS video playback via the `<video>` element.
 * @private
 * @param video Optional HTMLVideoElement to check (defaults to creating a temporary one).
 * @returns True if native HLS support is detected.
 */
export const hasNativeHLS = (video?:HTMLMediaElement) : boolean => {
	const vid = video ?? document.createElement('video');
	return !!(vid.canPlayType('application/vnd.apple.mpegurl') || vid.canPlayType('application/x-mpegURL'));
}

/** Casts a raw view array ([centerX, centerY, width, height]) to a 360 view object. */
export const viewRawToView360 = (v?:Models.Camera.ViewRect) : Models.Camera.View360|undefined => v ? ({
	centerX: v[0],
	centerY: v[1],
	width: v[2],
	height: v[3]
}) : undefined;

/** Casts a 360 view object to a raw view array ([centerX, centerY, width, height]). */
export const view360ToViewRaw = (v?:Models.Camera.View360) : Models.Camera.ViewRect|undefined => v ? [
	v.centerX,
	v.centerY,
	v.width,
	v.height
] : undefined;

/** Casts a legacy view array ([x0, y0, x1, y1]) to a 360 view object. */
export const legacyViewToView360 = (v?:Models.Camera.ViewRect) : Models.Camera.View360|undefined => v ? ({
	centerX: (v[0] + v[2]) / 2,
	centerY: (v[1] + v[3]) / 2,
	width: v[2] - v[0],
	height: v[3] - v[1]
}) : undefined;

/** Sanitizes a viewport, converting from legacy array [x0,y0,x1,y1] to View360 if necessary. */
const sanitizeView = (v?: any) : Models.Camera.View360|undefined => Array.isArray(v) ? legacyViewToView360(v) : v;
