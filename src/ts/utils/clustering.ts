/**
 * Marker clustering algorithm for calculating overlapping markers
 * and generating cluster marker objects.
 * @author Marcel Duin <marcel@micr.io>
 */

import type { Models } from '../../types/models';

type MarkerData = Models.ImageData.Marker;
export type MarkerCoords = [x: number, y: number, w?: number, h?: number];

function overlaps([x0,y0,w0=0,h0=0]: MarkerCoords, [x1,y1,w1=0,h1=0]: MarkerCoords, r: number): boolean {
	const rY0 = Math.max(h0/2, r);
	const rY1 = Math.max(h1/2, r);
	return !(x0+w0+r<x1-r || x0-r>x1+w1+r || y0+rY0<y1-rY1 || y0-rY0>y1+rY1);
}

export interface ClusterResult {
	overlapped: number[];
	clusterMarkers: MarkerData[];
}

/**
 * Calculates which markers overlap and generates synthetic cluster markers.
 */
export function calcClusters(
	visibleMarkers: MarkerData[] | undefined,
	coords: Map<string, MarkerCoords>,
	r: number,
	isOmni: boolean
): ClusterResult {
	if (!visibleMarkers) return { overlapped: [], clusterMarkers: [] };

	const q = visibleMarkers;
	const S: number[][] = [];
	const l = q.length;
	const overlappedIndices: number[] = [];

	for (let i = 0; i < l; i++) for (let j = i + 1; j < l; j++) {
		if (q[j].tags?.includes('no-cluster')) continue;
		const c1 = coords.get(q[i].id), c2 = coords.get(q[j].id);
		if (c1 && c2 && overlaps(c1, c2, r)) {
			overlappedIndices.push(i, j);
			const existingCluster = S.find(c => c.findIndex(n => n == i || n == j) > -1);
			if (existingCluster) {
				existingCluster.push(i, j);
			} else {
				S.push([i, j]);
			}
		}
	}

	const clusterMarkers = S
		.map(c => c.filter((n, i) => c.indexOf(n) === i))
		.map(c => {
			let minX: number, maxX: number, minY: number, maxY: number, centerX: number, centerY: number;

			if (isOmni) {
				centerX = c.reduce((sum, j) => sum + q[j].x, 0) / c.length;
				centerY = c.reduce((sum, j) => sum + q[j].y, 0) / c.length;
				const viewSize = 0.3;
				minX = Math.max(0, centerX - viewSize / 2);
				minY = Math.max(0, centerY - viewSize / 2);
				maxX = Math.min(1, centerX + viewSize / 2);
				maxY = Math.min(1, centerY + viewSize / 2);
			} else {
				minX = Math.min(...c.map(j => q[j].view ? q[j].view[0] : q[j].x));
				maxX = Math.max(...c.map(j => q[j].view ? q[j].view[0] + q[j].view[2] : q[j].x));
				minY = Math.min(...c.map(j => q[j].view ? q[j].view[1] : q[j].y));
				maxY = Math.max(...c.map(j => q[j].view ? q[j].view[1] + q[j].view[3] : q[j].y));
				centerX = (minX + maxX) / 2;
				centerY = (minY + maxY) / 2;
			}

			const avgRotation = isOmni ? c.reduce((sum, j) => sum + (q[j].rotation ?? 0), 0) / c.length : undefined;
			const avgRadius = isOmni ? c.reduce((sum, j) => sum + (q[j].radius ?? 1), 0) / c.length : undefined;

			return {
				title: c.length + '',
				type: 'cluster',
				view: [minX, minY, Math.max(0.1, maxX - minX), Math.max(0.1, maxY - minY)],
				x: centerX,
				y: centerY,
				rotation: avgRotation,
				radius: avgRadius,
				id: c.sort((a, b) => a - b).join(','),
				data: {},
				popupType: 'none',
				tags: []
			} as MarkerData;
		});

	return { overlapped: overlappedIndices, clusterMarkers };
}
