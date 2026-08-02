export function computeWeightFactor(progress: Float32Array, pageCount: number): number {
	let sum = 0;
	for (let i = 0; i < progress.length; i++) sum += progress[i];
	return pageCount > 0 ? sum / pageCount : 0;
}

export function computePageSpineY(
	pageIndex: number,
	progress: number,
	weightFactor: number,
	totalStackHeight: number,
	pageCount: number,
	pageThickness: number,
): number {
	const rightBase = weightFactor * totalStackHeight;
	const leftBase = totalStackHeight - rightBase;
	const rf = (pageCount - 1 - pageIndex) * pageThickness;
	const lf = pageIndex * pageThickness;
	return (1 - progress) * (rf + rightBase) + progress * (lf + leftBase);
}

export function computeAllPageFloors(
	progress: Float32Array,
	weightFactor: number,
	totalStackHeight: number,
	pageCount: number,
	pageThickness: number,
): Float32Array {
	const floors = new Float32Array(pageCount);
	for (let pi = 0; pi < pageCount; pi++) {
		floors[pi] = computePageSpineY(pi, progress[pi], weightFactor, totalStackHeight, pageCount, pageThickness);
	}
	return floors;
}

export function applySpineDelta(positions: Float32Array, delta: number): void {
	if (Math.abs(delta) <= 1e-6) return;
	for (let i = 1; i < positions.length; i += 3) {
		positions[i] += delta;
	}
}
