import { Grid } from './grid'
import type { MicrioImage } from '$core/image'
import { pointInArea } from '$utils/math'

const ARROW_DIR = {
	ArrowLeft: 'left',
	ArrowRight: 'right',
	ArrowUp: 'up',
	ArrowDown: 'down',
} as const

/** True when `key` names one of the arrow keys in {@link ARROW_DIR}. */
function isArrowKey(key: string): key is keyof typeof ARROW_DIR {
	return Object.hasOwn(ARROW_DIR, key)
}

function gridAdjacent(grid: Grid, dir: 'up' | 'down' | 'left' | 'right'): MicrioImage | undefined {
	const cells = grid._current.map((img, i) => {
		const area = img.opts.area ?? [0, 0, 1, 1]
		return {
			img,
			i,
			cx: area[0] + area[2] / 2,
			cy: area[1] + area[3] / 2,
		}
	})
	if (cells.length === 0) {
		return undefined
	}

	let curIdx = cells.findIndex((c) => c.img.id === grid.querySelector<HTMLElement>(':focus')?.dataset.id)
	if (curIdx < 0) {
		curIdx = 0
	}

	const cur = cells[curIdx]
	const threshold = 0.05
	let best: { img: MicrioImage; dist: number } | undefined

	for (const c of cells) {
		if (c.i === curIdx) {
			continue
		}
		const dx = c.cx - cur.cx,
			dy = c.cy - cur.cy
		let ok = false
		switch (dir) {
			case 'left': {
				ok = dx < 0 && Math.abs(dy) < threshold
				break
			}
			case 'right': {
				ok = dx > 0 && Math.abs(dy) < threshold
				break
			}
			case 'up': {
				ok = dy < 0 && Math.abs(dx) < threshold
				break
			}
			case 'down': {
				ok = dy > 0 && Math.abs(dx) < threshold
				break
			}
		}
		if (!ok) {
			continue
		}
		const dist = Math.abs(dx) + Math.abs(dy)
		if (!best || dist < best.dist) {
			best = { img: c.img, dist }
		}
	}

	if (best) {
		return best.img
	}

	return cells[dir === 'right' || dir === 'down' ? 0 : cells.length - 1].img
}

function createGridKeyHandler(grid: Grid): (e: KeyboardEvent) => void {
	return (e: KeyboardEvent) => {
		if (grid._current.length === 0 || grid._clickable === false) {
			return
		}

		// The handler is on `document`, so it also sees keys typed on the host page: arrows in
		// a text field are not grid navigation. Only the target is checked here - the grid's own
		// hidden state is deliberately left to the caller, which keeps keyboard navigation
		// working while the tiles are faded out.
		const { target } = e
		if (
			target instanceof HTMLElement &&
			(target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
		) {
			return
		}

		if (e.key === 'Escape') {
			for (const btn of grid._buttons.values()) {
				btn.classList.remove('focussed')
			}
			if (grid.$focussed) {
				// Both return a layout promise that rejects when its animation is aborted
				grid.back().catch(() => {})
				e.preventDefault()
				e.stopPropagation()
			} else if (!grid.image.camera.isZoomedOut()) {
				grid.reset().catch(() => {})
				e.preventDefault()
				e.stopPropagation()
			}
			return
		}

		const dir = isArrowKey(e.key) ? ARROW_DIR[e.key] : undefined
		if (!dir || grid.$focussed) {
			return
		}

		e.preventDefault()
		e.stopPropagation()

		const img = gridAdjacent(grid, dir)
		if (!img) {
			return
		}

		const focusedId = img.id
		for (const [id, btn] of grid._buttons) {
			if (id === focusedId) {
				btn.focus()
				btn.classList.add('focussed')
			} else {
				btn.blur()
				btn.classList.remove('focussed')
			}
		}

		if (grid._clickable === 'zoom' && !grid.image.camera.isZoomedOut()) {
			grid.image.camera
				.flyToView(img.opts.area ?? [0, 0, 1, 1], {
					duration: grid._aniDurationIn * 1000,
					limit: false,
				})
				.catch(() => {})
		}
	}
}

/** Register keyboard navigation (arrow keys and Escape) on the given grid.
 * Returns a cleanup function that removes the listeners and resets the flag. @internal */
export function hookGridKeys(grid: Grid): () => void {
	Grid._handlingKeys = true
	const keyHandler = createGridKeyHandler(grid)
	document.addEventListener('keydown', keyHandler)

	let clickDown: { x: number; y: number } | undefined
	const onPointerDown = (e: PointerEvent) => {
		clickDown = { x: e.clientX, y: e.clientY }
	}
	const onPointerUp = (e: PointerEvent) => {
		if (!clickDown) {
			return
		}
		const dist = Math.hypot(e.clientX - clickDown.x, e.clientY - clickDown.y)
		clickDown = undefined
		if (dist > 10) {
			return
		}
		const [vx, vy] = grid.image.camera.getCoo(e.clientX, e.clientY, true)
		const img = grid._current.find((i) => {
			const { area } = i.opts
			return area ? pointInArea(vx, vy, [area[0], area[1], area[2], area[3]]) : false
		})
		if (!img) {
			return
		}
		grid._clickCell(img)
	}

	if (grid._panZoom === 'grid' && grid._clickable !== false) {
		grid.micrio.addEventListener('pointerdown', onPointerDown)
		grid.micrio.addEventListener('pointerup', onPointerUp)
	}

	return () => {
		Grid._handlingKeys = false
		document.removeEventListener('keydown', keyHandler)
		grid.micrio.removeEventListener('pointerdown', onPointerDown)
		grid.micrio.removeEventListener('pointerup', onPointerUp)
	}
}
