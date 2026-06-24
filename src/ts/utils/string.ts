/**
 * String formatting and generation utilities.
 * @author Marcel Duin <marcel@micr.io>
 */

/**
 * Converts seconds into a human-readable time string (hh?:mm:ss).
 * @param s Time in seconds. Can be negative for remaining time display.
 * @returns Formatted time string (e.g., "1:23", "1:05:09", "-0:15").
 */
export function parseTime(s: number): string {
	if (isNaN(s)) return '0:00';
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

