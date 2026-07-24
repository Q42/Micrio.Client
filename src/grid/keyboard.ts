import { Grid } from './grid';
import type { MicrioImage } from '$core/image';
import { pointInArea } from '$utils/math';

const ARROW_DIR = {
	ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
} as const;

function gridAdjacent(grid: Grid, dir: 'up'|'down'|'left'|'right') : MicrioImage|undefined {
	const cells = grid._current.map((img, i) => ({
		img, i,
		cx: img.opts.area![0] + img.opts.area![2] / 2,
		cy: img.opts.area![1] + img.opts.area![3] / 2,
	}));
	if (!cells.length) return;

	let curIdx = cells.findIndex(c => c.img.id == grid.querySelector(':focus')?.getAttribute('data-id'));
	if (curIdx < 0) curIdx = 0;

	const cur = cells[curIdx];
	const threshold = 0.05;
	let best:{img:MicrioImage; dist:number}|undefined;

	for (const c of cells) {
		if (c.i === curIdx) continue;
		const dx = c.cx - cur.cx, dy = c.cy - cur.cy;
		let ok = false;
		switch (dir) {
			case 'left':  ok = dx < 0 && Math.abs(dy) < threshold; break;
			case 'right': ok = dx > 0 && Math.abs(dy) < threshold; break;
			case 'up':    ok = dy < 0 && Math.abs(dx) < threshold; break;
			case 'down':  ok = dy > 0 && Math.abs(dx) < threshold; break;
		}
		if (!ok) continue;
		const dist = Math.abs(dx) + Math.abs(dy);
		if (!best || dist < best.dist) best = { img: c.img, dist };
	}

	if (best) return best.img;

	return cells[dir == 'right' || dir == 'down' ? 0 : cells.length - 1].img;
}

function createGridKeyHandler(grid: Grid) : (e: KeyboardEvent) => void {
	return (e: KeyboardEvent) => {
		if (!grid._current.length || !grid._clickable) return;

		if (e.key == 'Escape') {
			grid._buttons.forEach(btn => btn.classList.remove('focussed'));
			if (grid.$focussed) { grid.back(); e.preventDefault(); e.stopPropagation(); }
			else if (!grid.image.camera.isZoomedOut()) { grid.reset(); e.preventDefault(); e.stopPropagation(); }
			return;
		}

		const dir = ARROW_DIR[e.key as keyof typeof ARROW_DIR];
		if (!dir || grid.$focussed) return;

		e.preventDefault();
		e.stopPropagation();

		const img = gridAdjacent(grid, dir);
		if (!img) return;

		const focusedId = img.id;
		grid._buttons.forEach((btn, id) => {
			if (id === focusedId) { btn.focus(); btn.classList.add('focussed'); }
			else { btn.blur(); btn.classList.remove('focussed'); }
		});

		if (grid._clickable == 'zoom' && !grid.image.camera.isZoomedOut()) {
			grid.image.camera.flyToView(img.opts.area ?? [0,0,1,1], {duration: grid._aniDurationIn * 1000, limit: false});
		}
	};
}

/** Register keyboard navigation (arrow keys and Escape) on the given grid. @internal */
export function hookGridKeys(grid: Grid) : void {
	Grid._handlingKeys = true;
	document.addEventListener('keydown', createGridKeyHandler(grid));

	if (grid._panZoom == 'grid' && grid._clickable) {
		let clickDown:{x:number;y:number}|undefined = {x:0, y:0};
		grid.micrio.addEventListener('pointerdown', (e: PointerEvent) => {
			clickDown = {x: e.clientX, y: e.clientY};
		});
		grid.micrio.addEventListener('pointerup', (e: PointerEvent) => {
			if (!clickDown) return;
			const dist = Math.hypot(e.clientX - clickDown.x, e.clientY - clickDown.y);
			clickDown = undefined;
			if (dist > 10) return;
			const [vx, vy] = grid.image.camera.getCoo(e.clientX, e.clientY, true);
			const img = grid._current.find(i => i.opts.area && pointInArea(vx, vy, i.opts.area as [number, number, number, number]));
			if (!img) return;
			grid._clickCell(img);
		});
	}
}
