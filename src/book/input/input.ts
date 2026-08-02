import { OrbitCamera } from '../core/orbit-camera';
import { Vec3 } from '../core/vec3';

interface PointerState {
	_clientX: number;
	_clientY: number;
}

export class InputHandler {
	#canvas: HTMLCanvasElement;
	#camera: OrbitCamera;
	#onActivity: () => void;

	public _onPrevPage: (() => void) | null = null;
	public _onNextPage: (() => void) | null = null;

	public _onPageClick: ((x: number, y: number) => { direction: 'prev' | 'next'; grabRow: number } | null) | null = null;
	public _lastClickGrabRow: number | null = null;

	public _onWheelZoom: ((screenX: number, screenY: number) => Vec3 | null) | null = null;

	/** Override for the zoomed-in check, e.g. wired to the viewer's own viewport-fit logic. */
	public _isZoomedInFn: (() => boolean) | null = null;

	public _onPageDragStart: ((startX: number, startY: number) => void) | null = null;
	public _onPageDragMove: ((currentX: number, currentY: number) => void) | null = null;
	public _onPageDragEnd: (() => void) | null = null;

	#pointers = new Map<number, PointerState>();
	_operation: 'none' | 'orbit' | 'pan' = 'none';

	#pinchMidX = 0;
	#pinchMidY = 0;
	#pinchDist = 0;

	#panStartX = 0;
	#panStartY = 0;
	#panMoved = 0;
	#orbitMoved = 0;
	#isDragging = false;
	#dragStartFired = false;

	constructor(
		canvas: HTMLCanvasElement,
		camera: OrbitCamera,
		onActivity: () => void,
	) {
		this.#canvas = canvas;
		this.#camera = camera;
		this.#onActivity = onActivity;

		this.#setupListeners();
	}

	#setupListeners(): void {
		const c = this.#canvas;
		c.addEventListener('pointerdown', (e) => this.#onPointerDown(e));
		window.addEventListener('pointermove', (e) => this.#onPointerMove(e));
		window.addEventListener('pointerup', (e) => this.#onPointerUp(e));
		window.addEventListener('pointercancel', (e) => this.#onPointerCancel(e));

		c.addEventListener('wheel', (e) => this.#onWheel(e), { passive: false });
		c.addEventListener('contextmenu', (e) => e.preventDefault());
	}

	// ═══ Pointer events ═══════════════════════════════════════════

	#onPointerDown(e: PointerEvent): void {
		this.#blurActiveElement();

		if (e.pointerType === 'mouse' && e.button > 2) return;

		e.preventDefault();

		this.#pointers.set(e.pointerId, { _clientX: e.clientX, _clientY: e.clientY });

		if (this.#pointers.size === 1) {
			this.#startGesture(e);
		} else if (this.#pointers.size === 2) {
			this.#switchToTwoPointer();
		}

		this.#onActivity();
	}

	#onPointerMove(e: PointerEvent): void {
		const prev = this.#pointers.get(e.pointerId);
		if (!prev) return;
		e.preventDefault();

		this.#pointers.set(e.pointerId, { _clientX: e.clientX, _clientY: e.clientY });

		if (this.#pointers.size === 1) {
			this.#handleSinglePointer(e.clientX, e.clientY, prev._clientX, prev._clientY);
		} else if (this.#pointers.size >= 2) {
			this.#handleMultiPointer();
		}
	}

	#onPointerUp(e: PointerEvent): void {
		e.preventDefault();
		this.#pointers.delete(e.pointerId);

		if (this.#pointers.size === 0) {
			this.#finishGesture();
		} else if (this.#pointers.size === 1) {
			this.#resetGesture();
		}
	}

	#onPointerCancel(e: PointerEvent): void {
		this.#pointers.delete(e.pointerId);
		if (this.#pointers.size === 0) {
			this.#finishGesture();
		} else if (this.#pointers.size === 1) {
			this.#resetGesture();
		}
	}

	// ═══ Wheel (zoom) ════════════════════════════════════════════

	#onWheel(e: WheelEvent): void {
		e.preventDefault();
		const rect = this.#canvas.getBoundingClientRect();
		const sx = e.clientX - rect.left;
		const sy = e.clientY - rect.top;
		const hitPoint = this._onWheelZoom?.(sx, sy) ?? undefined;
		this.#camera._zoom(e.deltaY, hitPoint);
		this.#onActivity();
	}

	// ═══ Helpers ══════════════════════════════════════════════════

	#blurActiveElement(): void {
		const ae = document.activeElement as HTMLElement | null;
		if (ae && ae !== this.#canvas && (ae.tagName === 'INPUT' || ae.tagName === 'SELECT' || ae.tagName === 'TEXTAREA')) {
			ae.blur();
		}
	}

	#isOrbitPointer(e: PointerEvent): boolean {
		if (e.pointerType === 'touch' || e.pointerType === 'pen') {
			return false;
		}
		return e.button === 2 || e.button === 1 || (e.button === 0 && (e.ctrlKey || e.metaKey));
	}

	#startGesture(e: PointerEvent): void {
		this._operation = this.#isOrbitPointer(e) ? 'orbit' : 'pan';
		this.#panStartX = e.clientX;
		this.#panStartY = e.clientY;
		this.#panMoved = 0;
		this.#orbitMoved = 0;
		this.#isDragging = false;
		this.#dragStartFired = false;
	}

	#switchToTwoPointer(): void {
		this._operation = this.#isZoomedIn() ? 'orbit' : 'pan';
		const [p0, p1] = firstTwo(this.#pointers);
		this.#pinchMidX = (p0._clientX + p1._clientX) / 2;
		this.#pinchMidY = (p0._clientY + p1._clientY) / 2;
		this.#pinchDist = dist(p0, p1);
	}

	#handleSinglePointer(curX: number, curY: number, prevX: number, prevY: number): void {
		const dx = curX - prevX;
		const dy = curY - prevY;

		if (this._operation === 'orbit') {
			this.#applyOrbit(dx, dy);
		} else if (this._operation === 'pan') {
			this.#applyPan(dx, dy, curX, curY);
		}
	}

	#handleMultiPointer(): void {
		const [p0, p1] = firstTwo(this.#pointers);
		const midX = (p0._clientX + p1._clientX) / 2;
		const midY = (p0._clientY + p1._clientY) / 2;

		const dx = (midX - this.#pinchMidX) * 2;
		const dy = (midY - this.#pinchMidY) * 2;

		if (this._operation === 'orbit') {
			this.#camera._rotate(
				this.#camera._freeCamMode ? dx : 0,
				dy,
				!this.#camera._freeCamMode,
			);
		} else {
			this.#camera._pan(dx, dy);
		}

		const curDist = dist(p0, p1);
		if (this.#pinchDist > 0 && curDist > 0) {
			this.#camera._zoom((this.#pinchDist - curDist) * 4);
		}

		this.#pinchMidX = midX;
		this.#pinchMidY = midY;
		this.#pinchDist = curDist;
	}

	#applyOrbit(dx: number, dy: number): void {
		this.#orbitMoved += Math.abs(dx) + Math.abs(dy);
		this.#camera._rotate(
			this.#camera._freeCamMode ? dx : 0,
			dy,
			!this.#camera._freeCamMode,
		);
	}

	#applyPan(dx: number, dy: number, curX: number, curY: number): void {
		this.#panMoved += Math.abs(dx) + Math.abs(dy);

		if (this.#isZoomedIn()) {
			this.#camera._pan(dx, dy);
		} else if (this.#panMoved >= 5 && this._onPageDragMove) {
			if (!this.#dragStartFired && this._onPageDragStart) {
				this._onPageDragStart(this.#panStartX, this.#panStartY);
				this.#dragStartFired = true;
			}
			this.#isDragging = true;
			this._onPageDragMove(curX, curY);
		}
	}

	#finishGesture(): void {
		this._lastClickGrabRow = null;

		if (this._operation === 'pan') {
			if (this.#isDragging && this._onPageDragEnd) {
				this._onPageDragEnd();
			} else if (this.#panMoved < 5 && this._onPageClick) {
				const result = this._onPageClick(this.#panStartX, this.#panStartY);
				if (result) {
					this._lastClickGrabRow = result.grabRow;
					if (result.direction === 'prev') this._onPrevPage?.();
					else if (result.direction === 'next') this._onNextPage?.();
				}
			}
		}

		this.#resetGesture();
	}

	#resetGesture(): void {
		this._operation = 'none';
		this.#isDragging = false;
		this.#dragStartFired = false;
		this.#panMoved = 0;
		this.#orbitMoved = 0;
	}

	#isZoomedIn(): boolean {
		return this._isZoomedInFn ? this._isZoomedInFn() : this.#camera._isZoomedIn();
	}
}

// ── tiny pure helpers ──

function firstTwo<K, V>(m: Map<K, V>): [V, V] {
	const it = m.values();
	return [it.next().value!, it.next().value!];
}

function dist(a: PointerState, b: PointerState): number {
	const dx = b._clientX - a._clientX;
	const dy = b._clientY - a._clientY;
	return Math.sqrt(dx * dx + dy * dy);
}
