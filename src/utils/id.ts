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
	return (c -= u ? 65 : 97) - (c > 7 ? 1 : 0) + (u ? 24 : c > 10 ? -1 : 0);
};

/**
 * Checks if an ID likely belongs to the V5 format (6 or 7 characters).
 * @internal
 */
export const idIsV5 = (id: string): boolean => id.length == 6 || id.length == 7;

