import type { Models } from '$types/models';

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
