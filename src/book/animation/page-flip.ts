import { PaperMesh } from '../geometry/paper-mesh';
import { CoverMesh } from '../geometry/cover-mesh';
import { GRID_COLS, GRID_ROWS, ARC_PEAK, BASE_FLIP_DURATION, FLIP_SPEED, GRAB_ROW, GRAB_ROW_MAX_OFFSET } from '../core/settings';
import { Vec3 } from '../core/vec3';
import { computeWeightFactor, computePageSpineY, applySpineDelta } from './spine-sync';

interface AnimSlot {
	_progress: number;
	_direction: number;
	_startProgress: number;
	_elapsed: number;
	_drivenVertex: number;
	_savedInvMass: number;
	_savedInvMasses?: Float32Array;
	_grabRowOffset: number;
	_isDragging: boolean;
}

const IDLE_SLOT: AnimSlot = {
	_progress: 0,
	_direction: 0,
	_startProgress: 0,
	_elapsed: 0,
	_drivenVertex: -1,
	_savedInvMass: 1.0,
	_grabRowOffset: 0,
	_isDragging: false,
};

export class PageFlipAnimator {
	_hardCoverPages: Set<number> = new Set();

	get #flipDuration(): number {
		return BASE_FLIP_DURATION / Math.max(0.1, FLIP_SPEED);
	}

	get _animating(): boolean {
		for (const s of this.#slots) {
			if (s && s._direction !== 0) return true;
		}
		return false;
	}

	_isPageAnimating(pageIndex: number): boolean {
		const slot = this.#slots[pageIndex];
		return slot ? slot._direction !== 0 : false;
	}

	/** -1 = flipping back (left→right), +1 = flipping forward (right→left), 0 = idle/dragging. */
	_getPageDirection(pageIndex: number): number {
		const slot = this.#slots[pageIndex];
		return slot ? slot._direction : 0;
	}

	#slots: AnimSlot[] = [];
	#selectedPage: number = 0;

	_getPageProgress(pageIndex: number): number {
		const slot = this.#slots[pageIndex];
		return slot ? slot._progress : 0;
	}

	_setPageProgress(pageIndex: number, value: number): void {
		const slot = this.#slots[pageIndex];
		if (!slot) return;
		slot._progress = value;
		slot._direction = 0;
		slot._startProgress = value;
		slot._elapsed = 0;
	}

	_instantFlip(mesh: PaperMesh, pageIndex: number): void {
		const slot = this.#slots[pageIndex];
		if (!slot) return;
		slot._progress = 1;
		slot._direction = 0;
		slot._startProgress = 1;
		slot._elapsed = 0;
		this.#releaseDriven(mesh, slot);
		this.#applyRigidRotation(mesh, slot);
		mesh._velocities.fill(0);
	}

	_initSlots(pageCount: number): void {
		this.#slots = [];
		for (let i = 0; i < pageCount; i++) {
			this.#slots.push({ ...IDLE_SLOT });
		}
	}

	_flipLeft(pageIndex?: number, grabRow?: number): void {
		const pi = pageIndex ?? this.#selectedPage;
		const slot = this.#slots[pi];
		if (!slot) return;
		this.#startAnim(slot, +1, grabRow);
	}

	_flipRight(pageIndex?: number, grabRow?: number): void {
		const pi = pageIndex ?? this.#selectedPage;
		const slot = this.#slots[pi];
		if (!slot) return;
		this.#startAnim(slot, -1, grabRow);
	}

	_beginDrag(pageIndex: number, grabRow: number): void {
		const slot = this.#slots[pageIndex];
		if (!slot) return;
		slot._direction = 0;
		slot._elapsed = 0;
		slot._startProgress = slot._progress;
		slot._grabRowOffset = grabRow - GRAB_ROW;
		slot._isDragging = true;
	}

	_setDragProgress(pageIndex: number, progress: number): void {
		const slot = this.#slots[pageIndex];
		if (!slot || !slot._isDragging) return;
		slot._progress = Math.max(0.0, Math.min(1.0, progress));
	}

	_endDrag(pageIndex: number, direction: number): void {
		const slot = this.#slots[pageIndex];
		if (!slot) return;
		slot._isDragging = false;
		slot._direction = direction;
		slot._startProgress = slot._progress;
		slot._elapsed = 0;
	}

	_isPageDragging(pageIndex: number): boolean {
		const slot = this.#slots[pageIndex];
		return slot ? slot._isDragging : false;
	}

	#startAnim(slot: AnimSlot, dir: number, grabRow?: number): void {
		slot._direction = dir;
		slot._startProgress = slot._progress;
		slot._elapsed = 0;
		if (grabRow !== undefined) {
			slot._grabRowOffset = grabRow - GRAB_ROW;
		} else {
			slot._grabRowOffset = (Math.random() * 2 - 1) * GRAB_ROW_MAX_OFFSET;
		}
	}

	_reset(meshes: PaperMesh[]): void {
		this.#releaseAllDriven(meshes);
		for (const slot of this.#slots) {
			slot._progress = 0;
			slot._direction = 0;
			slot._startProgress = 0;
			slot._elapsed = 0;
			slot._drivenVertex = -1;
			slot._savedInvMass = 1.0;
			slot._grabRowOffset = 0;
			slot._isDragging = false;
		}
	}

	#getCornerVertex(grabRowOffset: number): number {
		const row = Math.round(GRID_ROWS - 1 - (GRAB_ROW + grabRowOffset) * (GRID_ROWS - 1));
		return row * GRID_COLS + (GRID_COLS - 1);
	}

	#computeArcPosition(p: number, mesh: PaperMesh, grabRowOffset: number, out: Vec3): void {
		const ci = this.#getCornerVertex(grabRowOffset);
		const rest = mesh._restPositions;
		const i3 = ci * 3;
		const rz = rest[i3 + 2];

		const radius = mesh._paperWidth;

		const theta = p * Math.PI;
		const x = radius * Math.cos(theta);
		const y = Math.sin(theta) * ARC_PEAK;
		out._set(x, y, rz);
	}

	#applyRigidRotation(mesh: PaperMesh, slot: AnimSlot): void {
		const theta = slot._progress * Math.PI;
		const cosA = Math.cos(theta);
		const sinA = Math.sin(theta);

		const pos = mesh._positions;
		const rest = mesh._restPositions;

		let pivotX = 0;
		if (mesh instanceof CoverMesh) {
			pivotX = (mesh._paperWidth / 4) * (1 - mesh._coverScale);
		}

		for (let i = 0; i < pos.length; i += 3) {
			const rx = rest[i];
			const ry = rest[i + 1];
			pos[i] = pivotX + (rx - pivotX) * cosA;
			pos[i + 1] = (rx - pivotX) * sinA + ry;
			pos[i + 2] = rest[i + 2];
		}
	}

	#driveCorner(
		mesh: PaperMesh,
		_pageIndex: number,
		slot: AnimSlot,
		arcPos: Vec3,
	): void {
		if (this._hardCoverPages.has(_pageIndex)) {
			if (!slot._savedInvMasses) {
				slot._savedInvMasses = new Float32Array(mesh._invMasses.length);
				slot._savedInvMasses.set(mesh._invMasses);
				for (let i = 0; i < mesh._invMasses.length; i++) {
					mesh._invMasses[i] = 0.0;
				}
			}
			this.#applyRigidRotation(mesh, slot);
			return;
		}

		const ci = this.#getCornerVertex(slot._grabRowOffset);

		if (slot._drivenVertex !== ci) {
			if (slot._drivenVertex >= 0) {
				mesh._invMasses[slot._drivenVertex] = slot._savedInvMass;
			}
			slot._savedInvMass = mesh._invMasses[ci];
			slot._drivenVertex = ci;
		}
		mesh._invMasses[ci] = 0.0;

		const i3 = ci * 3;
		const spineY = mesh._positions[1];

		mesh._positions[i3] = arcPos._x;
		mesh._positions[i3 + 1] = arcPos._y + spineY;
		mesh._positions[i3 + 2] = arcPos._z;

		mesh._velocities[i3] = 0;
		mesh._velocities[i3 + 1] = 0;
		mesh._velocities[i3 + 2] = 0;
	}

	#releaseDriven(mesh: PaperMesh, slot: AnimSlot): void {
		if (slot._savedInvMasses) {
			for (let i = 0; i < mesh._invMasses.length; i++) {
				mesh._invMasses[i] = slot._savedInvMasses[i];
			}
			slot._savedInvMasses = undefined;
		}
		if (slot._drivenVertex >= 0) {
			mesh._invMasses[slot._drivenVertex] = slot._savedInvMass;
		}
		slot._drivenVertex = -1;
		slot._savedInvMass = 1.0;
	}

	#releaseAllDriven(meshes: PaperMesh[]): void {
		for (let pi = 0; pi < this.#slots.length; pi++) {
			const slot = this.#slots[pi];
			if (!slot) continue;
			if (pi < meshes.length) {
				if (slot._savedInvMasses) {
					for (let i = 0; i < meshes[pi]._invMasses.length; i++) {
						meshes[pi]._invMasses[i] = slot._savedInvMasses[i];
					}
					slot._savedInvMasses = undefined;
				}
				if (slot._drivenVertex >= 0) {
					meshes[pi]._invMasses[slot._drivenVertex] = slot._savedInvMass;
				}
			}
			slot._drivenVertex = -1;
			slot._savedInvMass = 1.0;
		}
	}

	#advanceAnim(
		dt: number,
		slot: AnimSlot,
		mesh: PaperMesh,
		outArcPos: Vec3
	): boolean {
		if (slot._direction === 0) return false;

		slot._elapsed += dt;
		const target = slot._direction > 0 ? 1.0 : 0.0;
		const fraction = Math.min(slot._elapsed / this.#flipDuration, 1.0);
		const eased = fraction * fraction * (3 - 2 * fraction);
		slot._progress = slot._startProgress + (target - slot._startProgress) * eased;

		if (fraction >= 1.0) {
			slot._progress = target;
			slot._direction = 0;
			return true;
		}

		this.#computeArcPosition(slot._progress, mesh, slot._grabRowOffset, outArcPos);
		return false;
	}

	_update(dt: number, meshes: PaperMesh[], selectedPage: number,
				 totalStackHeight: number, pageCount: number, pageThickness: number): void {
		if (selectedPage < 0 || selectedPage >= meshes.length) return;

		this.#selectedPage = selectedPage;

		if (this.#slots.length !== meshes.length) {
			this._initSlots(meshes.length);
		}

		const dtClamped = Math.min(dt, 1.0 / 30.0);

		// Pass 1: advance animations (skip dragged pages — they are manually controlled)
		for (let pi = 0; pi < meshes.length; pi++) {
			const slot = this.#slots[pi];
			if (!slot || slot._direction === 0 || slot._isDragging) continue;

			const mesh = meshes[pi];
			const tempArc = new Vec3();
			const finished = this.#advanceAnim(dtClamped, slot, mesh, tempArc);
			if (finished) {
				this.#releaseDriven(mesh, slot);
			}
		}

		// Compute weightFactor from all slots after advancing
		const weightFactor = computeWeightFactor(
			new Float32Array(this.#slots.map(s => s?._progress ?? 0)),
			pageCount,
		);

		// Pass 2: snap spine Y to correct floor, then drive corners
		for (let pi = 0; pi < meshes.length; pi++) {
			const slot = this.#slots[pi];
			if (!slot || (slot._direction === 0 && !slot._isDragging)) continue;

			const mesh = meshes[pi];

			if (!this._hardCoverPages.has(pi)) {
				const targetY = computePageSpineY(pi, slot._progress, weightFactor, totalStackHeight, pageCount, pageThickness);
				applySpineDelta(mesh._positions, targetY - mesh._positions[1]);
			}

			const tempArc = new Vec3();
			this.#computeArcPosition(slot._progress, mesh, slot._grabRowOffset, tempArc);
			this.#driveCorner(mesh, pi, slot, tempArc);
		}
	}

}
