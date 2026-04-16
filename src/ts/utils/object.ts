/**
 * Object manipulation utilities.
 * @author Marcel Duin <marcel@micr.io>
 */

/**
 * Creates a deep clone of an object using JSON stringify/parse.
 * Note: This will lose functions, Date objects, undefined values, etc.
 * @internal
 * @template T The type of the object being cloned.
 * @param o The object to clone.
 * @returns A deep clone of the object.
 */
export const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o)) as T;

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
/**
 * Performs a deep copy from one object to another, merging properties.
 * Only recurses into plain objects (Object.getPrototypeOf === Object.prototype).
 * Arrays, Dates, class instances, and other non-plain objects are copied by reference.
 * @internal
 */
export function deepCopy<T>(from: T, into: T, opts: {
	mergeArrays?: boolean;
	noOverwrite?: boolean;
} = {}): T {
	if (!from || typeof from !== 'object') return into;
	for (const x in from) {
		const val = (from as Record<string, unknown>)[x];
		if (val && typeof val === 'object' && Object.getPrototypeOf(val) === Object.prototype) {
			const intoObj = into as Record<string, unknown>;
			if (!intoObj[x] || typeof intoObj[x] != 'object') intoObj[x] = {};
			deepCopy(val as Record<string, unknown>, intoObj[x] as Record<string, unknown>, opts);
		}
		else {
			const intoObj = into as Record<string, unknown>;
			if (opts.mergeArrays && intoObj[x] instanceof Array && val instanceof Array) (intoObj[x] as unknown[]).push(...val);
			else if (!opts.noOverwrite || !(x in (into as object))) intoObj[x] = val;
		}
	}
	return into;
}

