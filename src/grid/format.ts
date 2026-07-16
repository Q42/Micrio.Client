import type { Models } from '$types/models';

const round = (n:number) => Math.round(n*100000)/100000;

export function gridString(i: Models.ImageInfo.ImageInfo, opts?: {
	view?: Models.Camera.View;
	area?: Models.Camera.View;
	size?: number[];
	cultures?: string;
}): string {
	return [
		i.id, i.width, i.height,
		i.isDeepZoom ? 'd' : '',
		i.isPng ? 'p' : i.isWebP ? 'w' : '',
		opts?.view?.map(round).join('/'),
		opts?.area?.map(round).join('/'),
		i.settings?.focus?.map(round).join('-'),
		opts?.cultures
	].join(',').replace(/,+$/, '') + (opts?.size ? `|${opts.size.join(',')}` : '');
}

export function parseGridString(s: string): { parts: string[]; size?: [number, number?] } {
	const g = s.split('|');
	return {
		parts: g[0].split(','),
		size: g[1] ? g[1].split(',').map(Number) as [number, number?] : undefined
	};
}

export function getCols(images: number, numTiles: number): number {
	let num = Math.ceil(numTiles / Math.ceil(Math.sqrt(numTiles)));
	if (images == numTiles) {
		const margin = Math.floor(Math.sqrt(images));
		const cols: number[] = [];
		for (let n = margin; n < num + margin; n++) if (!(images % n)) cols.push(n);
		if (cols.length) num = cols[Math.floor(cols.length / 2)];
	}
	return num;
}

export const slideAreas: Record<number, Models.Camera.View> = {
	0:   [0, -.5, 1, .5],
	90:  [1, 0, .5, 1],
	180: [0, 1, 1, .5],
	270: [-.5, 0, .5, 1],
};

export const swipeAreas: Record<number, Models.Camera.View> = {
	0:   [0, -1, 1, 1],
	90:  [1, 0, 1, 1],
	180: [0, 1, 1, 1],
	270: [-1, 0, 1, 1],
};

export const swipeExitAreas: Record<number, Models.Camera.View> = {
	0:   [0, 1, 1, 1],
	90:  [-1, 0, 1, 1],
	180: [0, -1, 1, 1],
	270: [1, 0, 1, 1],
};
