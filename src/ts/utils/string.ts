/**
 * String formatting and generation utilities.
 * @author Marcel Duin <marcel@micr.io>
 */

/** Internal helper for GUID generation. Generates a 4-character hex string. */
const s4 = (): string => Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);

/**
 * Generates a pseudo-random GUID (Globally Unique Identifier).
 * @internal
 * @link http://stackoverflow.com/questions/105034/how-to-create-a-guid-uuid-in-javascript
 * @returns A string representing a GUID (e.g., "1a2b3c4d-5e6f-7g8h-9i0j-1k2l3m4n5o6p").
 */
export const createGUID = (): string => s4() + s4() + '-' + s4() + '-' + s4() + '-' + s4() + '-' + s4() + s4() + s4();

/**
 * Converts a string into a URL-friendly slug.
 * Removes accents, converts to lowercase, replaces spaces with hyphens, and removes invalid characters.
 * @internal
 * @param str The input string.
 * @returns The slugified string, or undefined if the input was undefined.
 */
export const slugify = (str: string | undefined): string | undefined => {
	if (str === undefined) return str;
	str = str.replace(/^\s+|\s+$/g, ''); // trim
	str = str.toLowerCase();

	// remove accents, swap ñ for n, etc
	const from = "àáäâèéëêìíïîòóöôùúüûñç·/_,:;";
	const to = "aaaaeeeeiiiioooouuuunc------";
	for (let i = 0, l = from.length; i < l; i++) {
		str = str.replace(new RegExp(from.charAt(i), 'g'), to.charAt(i));
	}

	str = str.replace(/[^a-z0-9 -]/g, '') // remove invalid chars
		.replace(/\s+/g, '-') // collapse whitespace and replace by -
		.replace(/-+/g, '-'); // collapse dashes

	return str;
};

/**
 * Converts seconds into a human-readable time string (hh?:mm:ss).
 * @param s Time in seconds. Can be negative for remaining time display.
 * @returns Formatted time string (e.g., "1:23", "1:05:09", "-0:15").
 */
export function parseTime(s: number): string {
	const neg = s < 0;
	if (neg) s = -s;
	const total = Math.ceil(s);
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const seconds = total % 60;
	const pad = (n: number) => n < 10 ? '0' + n : '' + n;
	return (neg ? '-' : '')
		+ (hours ? hours + ':' + pad(minutes) : '' + minutes)
		+ ':' + pad(seconds);
}

