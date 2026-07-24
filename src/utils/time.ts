/** Formats a duration in seconds to a human-readable string (e.g. "1:23:45" or "3:45"). @internal */
export function parseTime(s: number): string {
	if (isNaN(s)) return '0:00';
	const d = new Date(Math.abs(s) * 1000);
	const iso = d.toISOString().slice(11, 19);
	return (s < 0 ? '-' : '') + (iso.startsWith('00:') ? iso.slice(3) : iso);
}

/** Lightweight formatter (no hours). @internal */
export const fmt = (t: number): string =>
	new Date(Math.abs(t) * 1000).toISOString().slice(14, 19);
