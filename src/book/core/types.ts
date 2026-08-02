export interface PageClickResult {
	direction: 'prev' | 'next';
	grabRow: number;
}

export interface PageDragResult {
	pageIndex: number;
	grabRow: number;
	worldX: number;
}
