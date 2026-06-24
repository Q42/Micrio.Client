/**
 * Utility functions for normalizing Micrio image info.
 * Info-level normalization (V1 format, V4 cultures, etc.) is handled
 * server-side by the viewer API. Only ID-level transforms remain client-side.
 * @author Marcel Duin <marcel@micr.io>
 */

import type { Models } from '$types/models';
import { getIdVal, idIsV5 } from './id';

/** @internal */
export class Sanitizer {
	// ─── View conversions ───────────────────────────────────────────────────────

	/** View conversion utilities for transforming between view formats. */
	static View = {
		toCenterJSON: (v: Models.Camera.View): { centerX: number; centerY: number; width: number; height: number } => ({
			centerX: v[0] + v[2] / 2,
			centerY: v[1] + v[3] / 2,
			width: v[2],
			height: v[3]
		}),
	};

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
