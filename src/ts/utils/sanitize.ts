/**
 * Info-level sanitization utilities for normalizing Micrio image info.
 * Data-level sanitization (markers, tours, V4→V5 merging) is now handled
 * server-side by the `viewer.micr.io/{id}/data.json` endpoint.
 * @author Marcel Duin <marcel@micr.io>
 */

import type { Models } from '$types/models';
import { getIdVal, idIsV5 } from './id';

/** @internal */
export class Sanitizer {
	private static readonly _done = {
		info: new WeakMap<Models.ImageInfo.ImageInfo, boolean>(),
	};

	// ─── View conversions ───────────────────────────────────────────────────────

	/** View conversion utilities for transforming between view formats. */
	static View = {
		fromLegacy: (v?: Models.Camera.ViewRect | Models.Camera.View): Models.Camera.View | undefined => {
			if (!v) return undefined;
			return [v[0], v[1], v[2] - v[0], v[3] - v[1]];
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
}
