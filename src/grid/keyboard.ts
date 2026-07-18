import { Grid } from './grid';
import type { MicrioImage } from '$core/image';
import { pointInArea } from '$utils/math';

function gridAdjacent(grid: Grid, dir: 'up'|'down'|'left'|'right') : MicrioImage|undefined {
	const cells = grid.current.map((img, i) => ({
		img, i,
		cx: img.opts.area![0] + img.opts.area![2] / 2,
		cy: img.opts.area![1] + img.opts.area![3] / 2,
	}));
	if (!cells.length) return;

	let curIdx = cells.findIndex(c => c.img.id == grid._grid.querySelector(':focus')?.getAttribute('data-id'));
	if (curIdx < 0) curIdx = 0;

	const cur = cells[curIdx];
	const threshold = 0.05;
	let best:{img:MicrioImage; dist:number}|undefined;

	for (const c of cells) {
		if (c.i === curIdx) continue;
		let dx = c.cx - cur.cx, dy = c.cy - cur.cy;
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
		if (!grid.current.length || !grid.clickable) return;

		if (e.key == 'Escape') {
			grid._buttons.forEach(btn => btn.classList.remove('focussed'));
			if (grid.$focussed) { grid.back(); e.preventDefault(); e.stopPropagation(); }
			else if (!grid.image.camera.isZoomedOut()) { grid.reset(); e.preventDefault(); e.stopPropagation(); }
			return;
		}

		if (grid.$focussed) return;
		let img:MicrioImage|undefined;
		switch (e.key) {
			case 'ArrowLeft':  img = gridAdjacent(grid, 'left'); break;
			case 'ArrowRight': img = gridAdjacent(grid, 'right'); break;
			case 'ArrowUp':    img = gridAdjacent(grid, 'up'); break;
			case 'ArrowDown':  img = gridAdjacent(grid, 'down'); break;
			default: return;
		}
		e.preventDefault();
		e.stopPropagation();
		if (!img) return;
		grid._buttons.forEach((btn, id) => {
			if (id === img!.id) btn.focus();
			else btn.blur();
		});

		if (grid.clickable == 'zoom') {
			grid._buttons.forEach((btn, bid) => btn.classList.toggle('focussed', bid == img!.id));
			if (!grid.image.camera.isZoomedOut()) {
				const a = img.opts.area ?? [0,0,1,1];
				grid.image.camera.flyToView(a, {duration: grid.aniDurationIn * 1000, limit: false});
			}
		}
	};
}

const clickStates = new WeakMap<Grid, {x:number;y:number}>();

export function hookGridKeys(grid: Grid) : void {
	Grid.handlingKeys = true;
	document.addEventListener('keydown', createGridKeyHandler(grid));

	if (grid.panZoom == 'grid' && grid.clickable) {
		clickStates.set(grid, {x:0, y:0});
		grid.micrio.addEventListener('pointerdown', (e: PointerEvent) => {
			const s = clickStates.get(grid);
			if (s) { s.x = e.clientX; s.y = e.clientY; }
		});
		grid.micrio.addEventListener('pointerup', (e: PointerEvent) => {
			const cd = clickStates.get(grid);
			if (!cd) return;
			const dist = Math.hypot(e.clientX - cd.x, e.clientY - cd.y);
			clickStates.delete(grid);
			if (dist > 10) return;
			const coo = grid.image.camera.getCoo(e.clientX, e.clientY, true);
			const vx = coo[0], vy = coo[1];
			const img = grid.current.find(i => i.opts.area && pointInArea(vx, vy, i.opts.area as [number, number, number, number]));
			if (!img) return;
			grid.clickCell(img);
		});
	}
}
