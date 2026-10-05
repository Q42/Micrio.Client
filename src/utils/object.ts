/**
 * Object manipulation utilities.
 * @author Marcel Duin <marcel@micr.io>
 */

/**
 * Checks whether a value is a non-null object usable as a string-keyed record.
 * @internal
 */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

/**
 * Performs a deep copy from one object to another, merging properties.
 * Only recurses into plain objects (Object.getPrototypeOf === Object.prototype).
 * Arrays, Dates, class instances, and other non-plain objects are copied by reference.
 * Circular plain-object references are mirrored onto the target instead of recursing forever.
 * @internal
 */
export function deepCopy<T>(
	from: T,
	into: T,
	opts: {
		noOverwrite?: boolean
	} = {},
	/** Source → target pairs already merged on this pass, used to mirror cycles. */
	seen: WeakMap<object, object> = new WeakMap<object, object>(),
): T {
	if (!isRecord(from) || !isRecord(into)) {
		return into
	}
	const source: Record<string, unknown> = from
	const target: Record<string, unknown> = into
	seen.set(source, target)
	for (const key of Object.keys(source)) {
		// Reject prototype-pollution keys; never legitimately present in settings data.
		if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
			continue
		}
		const val = source[key]
		if (isRecord(val) && Object.getPrototypeOf(val) === Object.prototype) {
			const assigned = seen.get(val)
			if (assigned) {
				// Already copied on this pass: point at the existing copy (mirrors cycles).
				target[key] = assigned
				continue
			}
			if (!isRecord(target[key])) {
				target[key] = {}
			}
			const next = target[key]
			if (isRecord(next)) {
				deepCopy(val, next, opts, seen)
			}
		} else if (!opts.noOverwrite || !(key in target)) {
			target[key] = val
		}
	}
	return into
}
