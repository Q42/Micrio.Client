/**
 * ID utility functions for Micrio image identifiers.
 * @author Marcel Duin <marcel@micr.io>
 */

/**
 * Decodes a character from a Micrio ID into its numeric value (used for V4 short IDs).
 * @internal
 */
export const getIdVal = (a: string): number => {
	let c = a.charCodeAt(0), u = c < 91;
	c -= u ? 65 : 97;
	const v = c - (c > 7 ? 1 : 0);
	if (u) {return v + 24;}
	return v + (c > 10 ? -1 : 0);
};

/**
 * Checks if an ID likely belongs to the V5 format (6 or 7 characters).
 * @internal
 */
export const idIsV5 = (id: string): boolean => id.length === 6 || id.length === 7;

/** Generates a random UUID string. @internal */
export const randomUUID = () => Math.random().toString();
