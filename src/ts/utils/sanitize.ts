/**
 * Data sanitization utilities for normalizing Micrio data structures.
 * All backwards-compatibility and data transformation logic lives here.
 * @author Marcel Duin <marcel@micr.io>
 */

import type { Models } from '$types/models';
import { createGUID } from './string';
import { getIdVal, idIsV5 } from './id';

/** @internal */
export class Sanitizer {
	// ─── Private state ──────────────────────────────────────────────────────────

	private static readonly _assetReplace: Record<string, string> = {
		'micrio-cdn.azureedge.net': 'micrio.vangoghmuseum.nl/micrio',
		'micrio-cdn.vangoghmuseum.nl': 'micrio.vangoghmuseum.nl/micrio',
		'rijks-micrio.azureedge.net': 'micrio.rijksmuseum.nl'
	};

	private static readonly _done = {
		info: new WeakMap<Models.ImageInfo.ImageInfo, boolean>(),
		embeds: new WeakSet<Models.ImageData.Embed>(),
		markers: new WeakSet<Models.ImageData.Marker>(),
		videoTours: new WeakSet<object>(),
		fromLegacy: new WeakSet<object>(),
	};

	private static readonly _cultureKeys = Object.freeze({
		data: new Set(['title', 'description', 'copyright', 'sourceUrl']),
		marker: new Set(['title', 'slug', 'label', 'body', 'bodySecondary', 'audio', 'embedUrl', 'embedTitle', 'embedDescription']),
		tour: new Set(['title', 'slug', 'description']),
		videoTour: new Set(['duration', 'audio', 'subtitle', 'timeline', 'events', 'title', 'slug', 'description']),
		page: new Set(['title', 'embed', 'content']),
	});

	// ─── View conversions ───────────────────────────────────────────────────────

	/** View conversion utilities for transforming between view formats. */
	static View = {
		fromLegacy: (v?: Models.Camera.ViewRect | Models.Camera.View): Models.Camera.View | undefined => {
			if (!v) return undefined;
			if (Sanitizer._done.fromLegacy.has(v)) return v;
			const result: Models.Camera.View = [v[0], v[1], v[2] - v[0], v[3] - v[1]];
			Sanitizer._done.fromLegacy.add(v);
			return result;
		},
		toCenterJSON: (v: Models.Camera.View): { centerX: number; centerY: number; width: number; height: number } => ({
			centerX: v[0] + v[2] / 2,
			centerY: v[1] + v[3] / 2,
			width: v[2],
			height: v[3]
		}),
		rectToCenterJSON: (v: Models.Camera.View) =>
			Sanitizer.View.toCenterJSON([v[0], v[1], v[2] - v[0], v[3] - v[1]]),
	};

	// ─── Checks ─────────────────────────────────────────────────────────────────

	/** Checks if an ImageInfo uses legacy view format. */
	static isLegacyViews(i: Models.ImageInfo.ImageInfo): boolean {
		return !i.viewsWH;
	}

	// ─── Asset sanitization ─────────────────────────────────────────────────────

	/** Sanitizes asset URLs, replacing legacy hostnames and handling fileUrl. */
	static asset(a?: Models.Assets.BaseAsset | Models.ImageData.Embed): void {
		if (a instanceof Object && 'fileUrl' in a && !a.src) a.src = a.fileUrl as string;
		if (a?.src) for (const r in Sanitizer._assetReplace)
			if (a.src.includes(r)) a.src = a.src.replace(r, Sanitizer._assetReplace[r]);
	}

	/** Sanitizes and normalizes a media source URL. */
	static source(src: string | undefined): string | undefined {
		if (!src) return undefined;
		if (/<iframe /.test(src)) src = src.replace(/^.* src="([^"]+)".*$/, '$1');
		if (src.startsWith('video://')) src = src.replace('video:', 'https:');
		return src;
	}

	/** Resolves the source URL from an asset, handling legacy fileUrl. */
	static audioSrc(audio: Models.Assets.BaseAsset | undefined): string | undefined {
		if (!audio) return;
		return 'fileUrl' in audio ? (audio as unknown as Record<string, unknown>)['fileUrl'] as string : audio.src;
	}

	// ─── Info-level sanitization ────────────────────────────────────────────────

	/** Sanitizes URLs within an ImageInfo object. */
	static imageInfo(i: Models.ImageInfo.ImageInfo | undefined): void {
		if (!i) return;
		if (Sanitizer._done.info.has(i)) return;
		// Handle ancient Micrio V1 static info.json format
		if ('Height' in i) { i.height = (i as unknown as Record<string, unknown>)['Height'] as number; i.version = '1.0'; i.tileSize = 512; }
		if ('Width' in i) i.width = (i as unknown as Record<string, unknown>)['Width'] as number;
		// Normalize V4 cultures string to V5 revision object
		if ('cultures' in i && !i.revision) {
			const c = (i as unknown as Record<string, unknown>).cultures as string || '';
			i.revision = Object.fromEntries(c.split(',').filter(Boolean).map(lang => [lang, 0]));
		}
		Sanitizer.asset(i.organisation?.logo);
		Sanitizer.asset(i.settings?._markers?.markerIcon);
		i.settings?._markers?.customIcons?.forEach(Sanitizer.asset);
		Sanitizer.asset(i.settings?._360?.video);
		if (i?.settings && Sanitizer.isLegacyViews(i)) {
			i.settings.view = Sanitizer.View.fromLegacy(i.settings.view)!;
			i.settings.restrict = Sanitizer.View.fromLegacy(i.settings.restrict)!;
		}
		Sanitizer._done.info.set(i, true);
	}

	/** Applies ID-level info transforms. Returns derived flags. */
	static imageId(i: Models.ImageInfo.ImageInfo, id: string): { isV5Imported: boolean } {
		if (i.settings?._meta?.noLogo) i.settings.noLogo = true;
		if (i.settings?._meta?.noSmoothing) i.settings.noSmoothing = true;

		const iiifIdBase = 'https://iiif.micr.io/';
		if (i.id.startsWith(iiifIdBase)) i.id = i.id.slice(iiifIdBase.length);

		if (id.length == 7) {
			const b = getIdVal(id[1 + (getIdVal(id) % 6)]);
			i.is360 = !!((b >> 4) & 1) || !!i.is360;
			i.isWebP = !(b & 3);
			i.isPng = (b & 3) == 2;
			if ((b >> 3) & 1 && idIsV5(i.tilesId ?? id)) i.format = 'dz';
			if (!i.path) i.path = `https://${!((b >> 2) & 1) ? 'r2' : 'eu'}.micr.io/`;
		}

		const isV5Imported = id.startsWith('i') && !id.includes('/');
		if (isV5Imported && !i.tilesId) i.tilesId = id.slice(1);
		return { isV5Imported };
	}

	// ─── Data-level sanitization ────────────────────────────────────────────────

	/** Sanitizes URLs and marker data within an ImageData object. */
	static imageData(d: Models.ImageData.ImageData | undefined, isLegacyViews: boolean): void {
		if (!d) return;
		if (d.revision) d.revision = Object.fromEntries(Object.entries((d.revision ?? {})).filter(r => Number(r[1]) > 0));
		d.embeds?.forEach(e => {
			if (Sanitizer._done.embeds.has(e)) return;
			if (!e.uuid) e.uuid = (e.id ?? e.micrioId);
			Sanitizer.asset(e.video);
			Sanitizer.asset(e);
			if (isLegacyViews) e.area = Sanitizer.View.fromLegacy(e.area)!;
			Sanitizer._done.embeds.add(e);
		});
		d.markers?.forEach(m => {
			Sanitizer.marker(m, isLegacyViews);
			const markerEmbeds = 'embedImages' in m ? (m as unknown as Record<string, unknown>).embedImages as Models.ImageData.Embed[] : undefined;
			if (markerEmbeds?.length) {
				d.embeds = [...(d.embeds ?? []), ...markerEmbeds];
				delete (m as unknown as Record<string, unknown>).embedImages;
			}
		});
		if (isLegacyViews) d.tours?.forEach(Sanitizer.videoTour);
		d.music?.items?.forEach(Sanitizer.asset);
		d.pages?.forEach(Sanitizer._menuPage);
	}

	/** Detects a legacy V4 autostart tour. */
	static autostartTour(d: Models.ImageData.ImageData): NonNullable<Models.ImageInfo.Settings['start']> | undefined {
		const tour = d.markerTours?.find(t => 'autostart' in t && (t as any).autostart)
			|| d.tours?.find(t => 'autostart' in t && (t as any).autostart);
		if (!tour) return;
		return { type: 'steps' in tour ? 'markerTour' : 'tour', id: tour.id! };
	}

	// ─── Marker sanitization ────────────────────────────────────────────────────

	/** Sanitizes marker data, ensuring required properties exist and handling legacy formats. */
	static marker(m: Models.ImageData.Marker, legacyViews?: boolean): void {
		if (Sanitizer._done.markers.has(m)) return;
		Sanitizer._done.markers.add(m);
		if (!m.data) m.data = {};
		if (!m.id) m.id = createGUID();
		if (!m.tags) m.tags = [];
		if (!('type' in m)) m.type = 'default';
		if (!m.popupType) m.popupType = 'popup';

		if (typeof m.data.icon == 'string') m.data.icon = {
			title: '', size: 0, uploaded: 0, width: -1, height: -1, src: m.data.icon as string
		};

		m.images?.forEach(Sanitizer.asset);
		Sanitizer.asset(m.positionalAudio);
		Sanitizer.asset(m.data?.icon);
		Object.values(m.i18n ?? {}).forEach(d => Sanitizer.asset(d.audio));

		const embeds = 'embedImages' in m ? m.embedImages as Models.ImageData.Embed[] : undefined;
		if (embeds) embeds.forEach(e => Sanitizer.asset(e));

		const oldSplitLink = m.data?._meta?.secondary;
		if (oldSplitLink) m.data.micrioSplitLink = oldSplitLink;

		if ('class' in m) (m.tags ??= []).push(...(m.class as string).split(' ').map(t => t.trim()).filter(t => !!t && !m.tags!.includes(t)));
		if (m.tags?.includes('default')) m.type = 'default';
		if (legacyViews) {
			m.view = Sanitizer.View.fromLegacy(m.view)!;
			Sanitizer.videoTour(m.videoTour);
		}
	}

	// ─── Video tour sanitization ────────────────────────────────────────────────

	/** Sanitizes video tour data, converting legacy view formats. */
	static videoTour(tour?: Models.ImageData.VideoTour | Models.ImageData.VideoTourCultureData): void {
		if (!tour || (!('i18n' in tour) && !('timeline' in tour))) return;
		if (Sanitizer._done.videoTours.has(tour)) return;
		const i18n = 'i18n' in tour ? tour.i18n : { 'en': (<unknown>tour as Models.ImageData.VideoTourCultureData) };
		for (const lang in i18n) i18n[lang]?.timeline.forEach(s => s.rect = Sanitizer.View.fromLegacy(s.rect)!);
		Sanitizer._done.videoTours.add(tour);
	}

	// ─── Space data ─────────────────────────────────────────────────────────────

	/** Sanitizes URLs within SpaceData (icons). */
	static spaceData(s: Models.Spaces.Space | undefined): void {
		s?.icons?.forEach(Sanitizer.asset);
	}

	// ─── V4→V5 normalization ───────────────────────────────────────────────────

	/** Merges V4 per-language data objects into a single V5-compatible ImageData object. */
	static v4DataToV5(langData: Record<string, Record<string, unknown>>): Models.ImageData.ImageData {
		const langs = Object.keys(langData);
		if (!langs.length) return {} as Models.ImageData.ImageData;

		const base = langData[langs[0]];
		const result: Record<string, unknown> = {};

		for (const key of Object.keys(base)) {
			if (!Sanitizer._cultureKeys.data.has(key) && key !== 'i18n') result[key] = base[key];
		}

		const dataI18n: Record<string, Record<string, unknown>> = {};
		for (const lang of langs) {
			const culture = Sanitizer._extractCulture(langData[lang], Sanitizer._cultureKeys.data);
			if (Object.keys(culture).length) dataI18n[lang] = culture;
		}
		if (Object.keys(dataI18n).length) result.i18n = dataI18n;

		result.markers = Sanitizer._buildMerged<Models.ImageData.Marker>(
			langs, langData, 'markers', Sanitizer._cultureKeys.marker, 'id',
			(raw, lang) => {
				const vt = raw.videoTour as Record<string, unknown> | undefined;
				if (vt && !('i18n' in vt) && typeof vt.duration === 'number') {
					vt.i18n ??= {};
					(vt.i18n as Record<string, unknown>)[lang] = Sanitizer._extractCulture(vt, Sanitizer._cultureKeys.videoTour);
					const tl = vt.timeline;
					if (Array.isArray(tl)) Sanitizer._normalizeTimeline(tl, vt.duration as number);
					for (const k of Sanitizer._cultureKeys.videoTour) delete vt[k];
				}
			},
		);

		result.tours = Sanitizer._buildMerged<Models.ImageData.VideoTour>(
			langs, langData, 'tours', Sanitizer._cultureKeys.tour, 'id',
			(raw, lang) => {
				const hasTimeline = Array.isArray(raw.timeline);
				if (hasTimeline && !('i18n' in raw)) {
					raw.i18n ??= {};
					(raw.i18n as Record<string, unknown>)[lang] = Sanitizer._extractCulture(raw, Sanitizer._cultureKeys.videoTour);
					const tl = raw.timeline;
					if (Array.isArray(tl)) Sanitizer._normalizeTimeline(tl, raw.duration as number);
					for (const k of Sanitizer._cultureKeys.videoTour) delete raw[k];
				}
			},
		);

		result.markerTours = Sanitizer._buildMerged<Models.ImageData.MarkerTour>(
			langs, langData, 'markerTours', Sanitizer._cultureKeys.tour, 'id',
		);

		result.pages = Sanitizer._buildMerged<Models.ImageData.Menu>(
			langs, langData, 'pages', Sanitizer._cultureKeys.page, 'id',
		);

		return result as Models.ImageData.ImageData;
	}

	/** Parses a legacy V4 gallery string into structured image entries. */
	static galleryString(str: string): { id: string; width: number; height: number; isDeepZoom?: boolean; isWebP?: boolean; isPng?: boolean; tileSize?: number }[] {
		return str.split(';').map(entry => {
			const parts = entry.split(',');
			const flags = parts[3] || '';
			return {
				id: parts[0],
				width: Number(parts[1]) || 0,
				height: Number(parts[2]) || 0,
				isDeepZoom: flags.includes('d'),
				isWebP: flags.includes('w'),
				isPng: flags.includes('p'),
				tileSize: parts[4] ? Number(parts[4]) : undefined,
			};
		});
	}

	// ─── Private helpers ────────────────────────────────────────────────────────

	private static _menuPage(m: Models.ImageData.Menu): void {
		Sanitizer.asset(m.image);
		m.children?.forEach(Sanitizer._menuPage);
	}

	private static _extractCulture(src: Record<string, unknown>, keys: ReadonlySet<string>): Record<string, unknown> {
		const out: Record<string, unknown> = {};
		for (const key of keys) if (key in src) out[key] = src[key];
		return out;
	}

	private static _normalizeTimeline(timeline: unknown[], duration: number): void {
		for (const seg of timeline) {
			if (seg && typeof seg === 'object') {
				const s = seg as Record<string, unknown>;
				if (typeof s.start === 'number') s.start = s.start * duration;
				if (typeof s.end === 'number') s.end = s.end * duration;
			}
		}
	}

	private static _buildMerged<T>(
		langs: string[],
		langData: Record<string, Record<string, unknown>>,
		arrayKey: string,
		cultureKeys: ReadonlySet<string>,
		idKey: string,
		transform?: (entity: Record<string, unknown>, lang: string) => void,
	): T[] {
		const byId = new Map<string, { shared: Record<string, unknown>; culture: Record<string, Record<string, unknown>> }>();

		for (const lang of langs) {
			const arr = langData[lang]?.[arrayKey];
			if (!Array.isArray(arr)) continue;
			for (const item of arr) {
				if (!item || typeof item !== 'object') continue;
				const raw = item as Record<string, unknown>;
				const id = raw[idKey] as string | undefined;
				if (!id) continue;

				let entry = byId.get(id);
				if (!entry) {
					entry = { shared: {}, culture: {} };
					byId.set(id, entry);
				}

				if (lang === langs[0]) {
					for (const key of Object.keys(raw)) {
						if (!cultureKeys.has(key) && key !== 'i18n') {
							entry.shared[key] = raw[key];
						}
					}
				}

				const culture = Sanitizer._extractCulture(raw, cultureKeys);
				if (Object.keys(culture).length) entry.culture[lang] = culture;
				transform?.(raw, lang);
			}
		}

		const result: T[] = [];
		for (const [, entry] of byId) {
			const entity = { ...entry.shared } as Record<string, unknown>;
			if (Object.keys(entry.culture).length) entity.i18n = entry.culture;
			result.push(entity as T);
		}
		return result;
	}
}
