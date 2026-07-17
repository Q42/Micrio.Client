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
	for (const x in from) {
		const val = (from as Record<string, unknown>)[x];
		if (val && typeof val === 'object' && Object.getPrototypeOf(val) === Object.prototype) {
			const intoObj = into as Record<string, unknown>;
			if (!intoObj[x] || typeof intoObj[x] != 'object') intoObj[x] = {};
			deepCopy(val as Record<string, unknown>, intoObj[x] as Record<string, unknown>, opts);
		}
		else {
			const intoObj = into as Record<string, unknown>;
			if (!opts.noOverwrite || !(x in (into as object))) intoObj[x] = val;
		}
	}
	return into;
}

