/**
 * ID utility functions for Micrio image identifiers.
 * @author Marcel Duin <marcel@micr.io>
 */

/**
 * Decodes a character from a Micrio ID into its numeric value (used for V4 short IDs).
 * @internal
 */
export const getIdVal = (a: string): number => {
	let c = a.charCodeAt(0),
		u = c < 91
	c -= u ? 65 : 97
	const v = c - (c > 7 ? 1 : 0)
	if (u) {
		return v + 24
	}
	return v + (c > 10 ? -1 : 0)
}

/**
 * Checks if an ID likely belongs to the V5 format (6 or 7 characters).
 * @internal
 */
export const idIsV5 = (id: string): boolean => id.length === 6 || id.length === 7

/**
 * Applies the flags encoded in a 7-character V5 image ID onto an image info object.
 *
 * The character at `1 + (getIdVal(id[0]) % 6)` packs, per bit:
 * `>>4`: 360 image, `>>3`: DeepZoom format, `>>2`: EU storage (else R2),
 * `&3`: `0` = WebP, `2` = PNG.
 *
 * Only called for non-IIIF 7-character IDs, exactly as the constructor did inline
 * before; the mutation of `info` is intentional (the bundle object is per-image).
 * @internal
 */
export const decodeV5Id = (
	id: string,
	info: {
		is360?: boolean
		isWebP?: boolean
		isPng?: boolean
		format?: string
		path?: string
		tilesId?: string
	},
): void => {
	const b = getIdVal(id[1 + (getIdVal(id) % 6)])
	info.is360 = Boolean((b >> 4) & 1) || Boolean(info.is360)
	info.isWebP = !(b & 3)
	info.isPng = (b & 3) === 2
	if ((b >> 3) & 1 && idIsV5(info.tilesId ?? id)) {
		info.format = 'dz'
	}
	if (!info.path) {
		info.path = `https://${!((b >> 2) & 1) ? 'r2' : 'eu'}.micr.io/`
	}
}

/** Generates a random UUID string. @internal */
export const randomUUID = () => Math.random().toString()
