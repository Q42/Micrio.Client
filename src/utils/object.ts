/**
 * Object manipulation utilities.
 * @author Marcel Duin <marcel@micr.io>
 */

/**
 * Performs a deep copy from one object to another, merging properties.
 * Only recurses into plain objects (Object.getPrototypeOf === Object.prototype).
 * Arrays, Dates, class instances, and other non-plain objects are copied by reference.
 * @internal
 */
export function deepCopy<T>(from: T, into: T, opts: {
	noOverwrite?: boolean;
} = {}): T {
	if (!from || typeof from !== 'object') return into;
	const target = into as Record<string, unknown>;
	for (const key of Object.keys(from as Record<string, unknown>)) {
		const val = (from as Record<string, unknown>)[key];
		if (val && typeof val === 'object' && Object.getPrototypeOf(val) === Object.prototype) {
			if (!target[key] || typeof target[key] !== 'object') target[key] = {};
			deepCopy(val, target[key] as Record<string, unknown>, opts);
		} else if (!opts.noOverwrite || !(key in target)) {
			target[key] = val;
		}
	}
	return into;
}

