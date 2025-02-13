/**
 * Global util functions
 * @author Marcel Duin <marcel@micr.io>
*/

import type { Readable, Unsubscriber } from 'svelte/store';
import type { Models } from '../types/models';
import type { MicrioImage } from './image';
import type { PREDEFINED } from '../types/internal';
import type { HTMLMicrioElement } from './element';

import { tick } from 'svelte';

/** Pythagorean function
 * @internal
 * @returns The pyth result
*/
export const pyth = (
	/** The first number */
	a:number,
	/** The second number */
	b:number
) : number => Math.sqrt(a*a+b*b);

/** @internal */
export const mod = (n:number,m:number=1) : number => (n%m+m)%m;

/** @internal */
export const clone = <T>(o:T) : T => JSON.parse(JSON.stringify(o)) as T;

/** GUID generator
 * @internal
 * @link http://stackoverflow.com/questions/105034/how-to-create-a-guid-uuid-in-javascript
 * @returns Fully valid GUID
*/
export const createGUID = () : string => s4()+s4()+'-'+s4()+'-'+s4()+'-'+s4()+'-'+s4()+s4()+s4();

/** Internal random string generator for GUID */
const s4 = ():string => Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);

/** @internal */
export const sleep = (ms:number) => new Promise<void>(ok => ms ? setTimeout(ok, ms) : ok());

// Browser stuff
type Browser = {
	iOS: boolean;
	firefox: boolean;
	OSX: boolean;
	hasTouch: boolean;
	safari: boolean;
}

const ua = navigator.userAgent;

/** Browser detection object
 * @internal
*/
export const Browser:Browser = {
	iOS: /ipad|iphone|ipod/i.test(ua),
	firefox: /firefox/i.test(ua),
	OSX: /macintosh/i.test(ua) && /os\ x/i.test(ua),
	hasTouch: 'TouchEvent' in self,
	safari: false
};

Browser.safari = (Browser.OSX || Browser.iOS) && (/safari/i.test(ua) || /instagram/i.test(ua)) && !/chrome/i.test(ua);

// iPad (8+ gen / pro) identify as OSX
// But real OSX doesn't have TouchEvents...
if(Browser.OSX && (Browser.safari && 'TouchEvent' in self)) {
	Browser.iOS = true;
	Browser.OSX = false;
}

/** Deep clone an object
 * @internal
*/
export function deepCopy(from:any, into:any, opts:{
	mergeArrays?:boolean;
	noOverwrite?:boolean;
}={}) : any {
	for(let x in from) {
		if(!!from[x] && from[x]['constructor'] != undefined && from[x]['constructor']['name'] == 'Object') {
			if(!into[x] || typeof into[x] != 'object') into[x] = {};
			deepCopy(from[x], into[x],opts);
		}
		else {
			if(opts.mergeArrays && into[x] instanceof Array && from[x] instanceof Array) into[x].push(...from[x]);
			else if(!opts.noOverwrite || !(x in into)) into[x] = from[x];
		}
	}
	return into;
}

/** Very simple slug function
 * https://gist.github.com/codeguy/6684588
 * @internal
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

/** Svelte hack to disable attribute warnings
 * https://github.com/sveltejs/language-tools/issues/1026#issuecomment-1002839154
 * @internal
 */
export const notypecheck = (x:any)=>x;

const loaded: string[] = [];

/** @internal */
export const loadScript = (src:string, cbFunc?:string, targetObj?:any) => new Promise((ok:Function, err:Function) => {
	if(targetObj || loaded.indexOf(src) >= 0) return ok();
	const script = document.createElement('script');
	const onload = () => { loaded.push(src); ok(); }
	/** @ts-ignore */
	if(cbFunc) self[cbFunc] = onload;
	else script.onload = onload;
	script.onerror = () => err && err();
	script.async = true;
	script.defer = true;
	if(self.crossOriginIsolated) script.crossOrigin = 'anonymous';
	script.src = src;
	document.head.appendChild(script);
});

/**
 * Seconds to readable time hh?:ii:ss
 * @param s Time in seconds
 * @internal
 */
export function parseTime(s:number):string {
	const neg = s < 0;
	if(neg) s *= -1;
	let r = [0,0,Math.ceil(s)];
	for(let n of [0,1]) while(r[2-n]>=60 && (r[2-n]-=60, ++r[1-n])) {};
	return (neg?'-':'')+r.filter((n,i) => i>0||n).map((n,i) => (n<10&&i?'0':'')+n).join(':');
}

/** Resolve promise only once, after value has been set
 * @internal
*/
export const once = <T = any>(s:Readable<T>, opts:{
	targetValue?:any;
	allowUndefined?:boolean
} = {}) : Promise<T> => new Promise(ok => {
	let initial:boolean = true;
	let unsub:Unsubscriber; unsub = s.subscribe(v => {
		// When value is undefined, only trigger when the current value isn't undefined
		if(initial && opts.allowUndefined && v === undefined) return;
		initial = false;
		if(opts.targetValue !== undefined ? v === opts.targetValue : (opts.allowUndefined || (v !== undefined)))
			if(unsub) unsub(); else tick().then(() => unsub()); ok(v);
	})
});

/** Resolve promise only once, after value has been set to undefined
 * @internal
*/
export const after = <T = any>(s:Readable<T>) : Promise<T> => new Promise(ok => {
	let unsub:Unsubscriber; unsub = s.subscribe(v => { if(v == undefined) {
		if(unsub) unsub(); else tick().then(() => unsub()); ok(v);
	}})
});

/** @internal */
export const jsonCache:Map<string, Object> = new Map();

/** @internal */
const jsonPromises:Map<string, Promise<Object>> = new Map();

/** Fetch cached JSON from uris
 * @internal
*/
export const fetchJson = async <T=Object>(uri:string, noCache?:Boolean) : Promise<T|undefined> => {
	if(jsonCache.has(uri)) return jsonCache.get(uri) as T;
	if(jsonPromises.has(uri)) return jsonPromises.get(uri) as T;
	const promise = fetch(uri+(noCache ? '?'+Math.random():'')).then(async r => {
		if(r.status == 200) return r.json()
		else throw await r.text();
	}).then(j => {
		jsonCache.set(uri, j);
		jsonPromises.delete(uri);
		return j;
	});
	jsonPromises.set(uri, promise);
	return promise;
};

export const isFetching = (uri:string) : boolean => jsonCache.has(uri);

// window.MICRIO_DATA from serverside rendering
export const getLocalData = (id:string) : PREDEFINED|undefined =>
	'MICRIO_DATA' in self ? (<unknown>self?.['MICRIO_DATA'] as PREDEFINED[]).find((p:PREDEFINED) => p[0] == id) : undefined;

/** Fetch info.json from i.micr.io (or other forced path)
 * @internal
*/
export const fetchInfo = (id:string, path?:string, refresh?:boolean) : Promise<Models.ImageInfo.ImageInfo|undefined> => {
	const ld = getLocalData(id)?.[1];
	return ld ? Promise.resolve(ld) : fetchJson(`${path??'https://i.micr.io/'}${id}/info.json`, refresh)
		.then(r => {
			// Ancient Micrio support -- this is only the case for ancient static info.json files
			/** @ts-ignore */
			if(r) { if('Height' in r) { r.height = r['Height']; r.version = 1.0; r.tileSize = 512; } if('Width' in r) r.width = r['Width'] }
			sanitizeImageInfo(r as Models.ImageInfo.ImageInfo|undefined);
			return r as Models.ImageInfo.ImageInfo|undefined;
		});
}

/** @internal */
const ASSET_SRC_REPLACE: Record<string, string> = {
	'micrio-cdn.azureedge.net': 'micrio.vangoghmuseum.nl/micrio',
	'micrio-cdn.vangoghmuseum.nl': 'micrio.vangoghmuseum.nl/micrio',
	'rijks-micrio.azureedge.net': 'micrio.rijksmuseum.nl'
}

/** @internal */
export const sanitizeAsset = (a?:Models.Assets.BaseAsset|Models.ImageData.Embed) : void => {
	if(a instanceof Object && 'fileUrl' in a && !a.src) a.src = a.fileUrl as string;
	if(a?.src) for(let r in ASSET_SRC_REPLACE)
		if(a.src.includes(r)) a.src = a.src.replace(r, ASSET_SRC_REPLACE[r]);
}

/** @internal */
const sanitizeImageInfo = (i:Models.ImageInfo.ImageInfo|undefined) => {
	if(!i) return;
	sanitizeAsset(i.organisation?.logo);
	sanitizeAsset(i.settings?._markers?.markerIcon);
	i.settings?._markers?.customIcons?.forEach(sanitizeAsset);
	sanitizeAsset(i.settings?._360?.video);
}

/** @internal */
export const sanitizeImageData = (d:Models.ImageData.ImageData|undefined, is360:boolean, isV5:boolean) => {
	if (!d) return;
	if(d.revision) d.revision = Object.fromEntries(Object.entries((d.revision??{})).filter(r => Number(r[1]) > 0));
	d.embeds?.forEach(e => {
		if(!e.uuid) e.uuid = (e.id ?? e.micrioId)+'-'+Math.random();
		sanitizeAsset(e.video);
		sanitizeAsset(e);
	});
	d.markers?.forEach(m => sanitizeMarker(m, is360, !isV5));
	d.music?.items?.forEach(sanitizeAsset);
	d.pages?.forEach(sanitizeMenuPage);
}

/** @internal */
export const sanitizeSpaceData = (s:Models.Spaces.Space|undefined) => {
	s?.icons?.forEach(sanitizeAsset);
}

/** @internal */
const sanitizeMenuPage = (m:Models.ImageData.Menu) => {
	sanitizeAsset(m.image);
	m.children?.forEach(sanitizeMenuPage);
}

/** Fetch album/info.json from i.micr.io
 * @internal
*/
export const fetchAlbumInfo = (id:string) : Promise<Models.AlbumInfo|undefined> =>
	'MICRIO_ALBUM' in self ? Promise.resolve(self['MICRIO_ALBUM'] as Models.AlbumInfo) : fetchJson<Models.AlbumInfo>(`https://i.micr.io/album/${id}.json`);

/** Sanitize markers
 * @internal
*/
export const sanitizeMarker = (m:Models.ImageData.Marker, is360:boolean, isOld:boolean) : void => {
	// Basic model requirements
	if(!m.data) m.data = {};
	if(!m.id) m.id = createGUID();
	if(!m.tags) m.tags = [];
	if(!('type' in m)) m.type = 'default';
	if(!m.popupType) m.popupType = 'popup';

	// String-based marker icons
	if(typeof m.data.icon == 'string') m.data.icon = {
		title: '',
		size: 0,
		uploaded: 0,
		width: -1,
		height: -1,
		src: m.data.icon as string
	}

	m.images?.forEach(sanitizeAsset);
	sanitizeAsset(m.positionalAudio);
	sanitizeAsset(m.data?.icon);
	Object.values(m.i18n ?? {}).forEach(d => sanitizeAsset(d.audio))
	const embeds = 'embedImages' in m ? m.embedImages as Models.ImageData.Embed[] : undefined;
	if(embeds) embeds.forEach(e => sanitizeAsset(e));

	// Old data model for split screen
	const oldSplitLink = m.data?._meta?.secondary;
	if(oldSplitLink) m.data.micrioSplitLink = oldSplitLink;

	if(isOld && 'class' in m) m.tags.push(...(m.class as string).split(' ').map(t => t.trim()).filter(t => !!t && !m.tags.includes(t)))
	if(m.tags.includes('default')) m.type = 'default';

	// Correct 360 marker view on the X-edge
	if(is360 && m.view && m.view[2] < m.view[0]) m.view[2]++;
}

/** Load external data for serial tour
 * @internal
*/
export async function loadSerialTour(image:MicrioImage, tour:Models.ImageData.MarkerTour, lang:string, imgData:Models.ImageData.ImageData) {
	if(!('steps' in tour) || tour.stepInfo) return;

	let micIds:string[] = tour.steps.map(s => s.split(',')[1]).filter((s:string) => !!s && s != image.id);
	micIds = micIds.filter((id,i) => micIds.indexOf(id)==i);

	const micData = await Promise.all(micIds.map(
		id => fetchJson<Models.ImageData.ImageData>(
			image.dataPath+(!image.isV5 ? id+'/data.'+lang+'.json' : id+'/data/pub.json')
		)));

	micData.forEach(d => d?.markers?.forEach(m => sanitizeMarker(m, image.is360, !image.isV5)));
	sanitizeAsset(tour.image);

	let chapter:number = -1;
	const notFound:number[] = [];
	tour.stepInfo = tour.steps.map((s,i) : Models.ImageData.MarkerTourStepInfo|undefined => {
		const [id, mId] = s.split(','),
			data = micData[micIds.indexOf(mId)] ?? imgData,
			m = data?.markers?.find(m => m.id == id);
		const content = m?.i18n?.[lang] ?? (<unknown>m as Models.ImageData.MarkerCultureData);
		if(content?.title) chapter = i;
		const vTourData = !m?.videoTour ? undefined : 'timeline' in m.videoTour ? <unknown>m as Models.ImageData.VideoTourCultureData
			: m.videoTour.i18n?.[lang] ?? undefined;
		sanitizeAsset(vTourData?.audio);
		sanitizeAsset(vTourData?.subtitle);
		if(!m) {
			console.warn(`[Micrio] Warning: tour step ${i+1} with id [${id}] not found! Removing it from the tour`);
			notFound.push(i);
		}

		sanitizeAsset(content?.audio);

		return !m ? undefined : {
			markerId: id,
			marker: m,
			micrioId: mId||image.id,
			duration: Number(vTourData?.duration || content?.audio?.duration || 0),
			startView: vTourData?.timeline?.length ? vTourData.timeline[0].rect : m?.view,
			imageHasOtherMarkers: mId ? !!data?.markers?.find(m => m.id != id && !m.noMarker) : false,
			gridView: !!(m.data?._meta?.gridView || m.data?._meta?.gridAction),
			chapter
		}
		/** @ts-ignore */
	}).filter<Models.ImageData.MarkerTourStepInfo>(si => typeof si === 'object');

	notFound.reverse().forEach(i => tour.steps.splice(i, 1));

	tour.initialStep = 0;
	tour.duration = tour.stepInfo.reduce((d,s) => d+(s.duration||0), 0);
}

/** Get a character numeric value from a Micrio ID
 * @private
*/
export const getIdVal=(a:string):number=>{let c=a.charCodeAt(0),u=c<91;return (c-=u?65:97)-(c>7?1:0)+(u?24:c>10?-1:0)}

export const idIsV5 = (id:string):boolean => id.length == 6 || id.length == 7;

/** Hard-limit a view to full image bounds */
export const limitView = (v: Models.Camera.View) : Models.Camera.View => [
	Math.max(0, v[0]),
	Math.max(0, v[1]),
	Math.min(1, v[2]),
	Math.min(1, v[3])
];

/** Calculating the movement vector between two 360 images
 * @private
*/
export function getSpaceVector(micrio:HTMLMicrioElement, targetId: string) : {
	vector: Models.Camera.Vector;
	directionX: number;
	v: Models.Spaces.DirectionVector;
	vN: Models.Spaces.DirectionVector;
}|undefined {
	const image = micrio.$current;
	if(!image) return;
	const source = micrio.spaceData?.images.find(i => i.id == image.id);
	const target = micrio.spaceData?.images.find(i => i.id == targetId);
	if(!source||!target) return;

	// Get diff vector
	const v:Models.Spaces.DirectionVector = [
		(target.x ?? .5) - (source.x ?? .5),
		(source.y ?? .5) - (target.y ?? .5),
		(target.z ?? .5) - (source.z ?? .5)
	];

	// Normalize
	let len = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
	if (len > 0) len = 1 / Math.sqrt(len);
	const vN:Models.Spaces.DirectionVector = [v[0]*len, v[1]*len, v[2]*len];

	const tNDiff = .5 - (image.$settings?._360?.trueNorth??.5);
	const directionX = mod((Math.atan2(-vN[0], vN[2])) / Math.PI/2);
	const distanceX = Math.max(0, Math.min(.4, Math.sqrt(vN[0]*vN[0] + vN[2]*vN[2])));
	return {
		v, vN,
		directionX,
		vector: {
			direction: directionX%1-tNDiff,
			distanceX,
			distanceY: -v[1]
		}
	}
}

/** Feature detection for native HLS video support
 * @private
 */
export const hasNativeHLS = (video?:HTMLMediaElement) => !!(video?.canPlayType('application/vnd.apple.mpegurl') || video?.canPlayType('application/x-mpegURL'));
