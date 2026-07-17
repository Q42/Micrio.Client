const pad = (n: number) => n < 10 ? '0' + n : '' + n;

export function parseTime(s: number): string {
	if (isNaN(s)) return '0:00';
	const neg = s < 0;
	if (neg) s = -s;
	const total = Math.ceil(s);
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const secs = total % 60;
	return (neg ? '-' : '') + (hours ? hours + ':' + pad(minutes) : '' + minutes) + ':' + pad(secs);
}

/** Lightweight formatter (no hours). */
export const fmt = (t: number): string => {
	const m = Math.floor(t / 60);
	const s = Math.floor(t % 60);
	return `${m}:${pad(s)}`;
};
