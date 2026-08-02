import { PaperRenderer } from './renderer';
import {
	IIIF_BASE_URL,
	IIIF_DEBOUNCE_BASE_MS,
	IIIF_DEBOUNCE_PER_DISTANCE_MS,
	IIIF_CROSSFADE_DURATION,
	IIIF_PRELOAD_DISTANCE,
	IIIF_GPU_EVICT_DISTANCE,
	DEFAULT_CAMERA_RADIUS,
} from '../core/settings';
import type { Models } from '$types/models';

type DownloadState = 'idle' | 'pending' | 'downloading' | 'fading' | 'done';
type FadeType = 'in' | 'cross';

interface PageSideState {
	_downloadState: DownloadState;
	_currentLevel: number;
	_targetLevel: number;
	_controller: AbortController | null;
	_visibleSince: number;
	_fadeProgress: number;
	_fadeStartTime: number;
	_fadeType: FadeType;
	_activeSlot: 0 | 1;
	_imageId: string;
	_originalWidth: number;
}

export class IIIFTextureManager {
	/** Set by the host so the manager can request a redraw when it has something new to show. */
	_onRequestFrame: (() => void) | null = null;

	#renderer: PaperRenderer;
	#baseUrl: string;
	#states: PageSideState[][] = [];
	#pageCount = 0;
	#pageIdxes: number[][] = [];

	constructor(renderer: PaperRenderer, baseUrl?: string) {
		this.#renderer = renderer;
		this.#baseUrl = baseUrl ?? IIIF_BASE_URL;
	}

	_init(images: Models.ImageInfo.ImageInfo[], pageCount: number, pageIdxes: number[][]): void {
		this.#pageCount = pageCount;
		this.#pageIdxes = pageIdxes;
		for (let p = 0; p < pageCount; p++) {
			const front = images[p * 2];
			const back = images[p * 2 + 1];
			this.#states[p] = [
				this.#newSideState(front?.id ?? '', front?.width ?? 0),
				this.#newSideState(back?.id ?? '', back?.width ?? 0),
			];
		}
	}

	#newSideState(imageId: string, originalWidth: number): PageSideState {
		return {
			_downloadState: 'idle',
			_currentLevel: 0,
			_targetLevel: 0,
			_controller: null,
			_visibleSince: 0,
			_fadeProgress: 0,
			_fadeStartTime: 0,
			_fadeType: 'in',
			_activeSlot: 0,
			_imageId: imageId,
			_originalWidth: originalWidth,
		};
	}

	_onFrame(now: number, spreadCenter: number, cameraRadius: number): boolean {
		this.#updateVisibility(now, spreadCenter);
		this.#upgradeZoomedPages(now, spreadCenter, cameraRadius);
		this.#startDownloads(now, spreadCenter, cameraRadius);
		this.#animateFades(now);
		this.#evictDistant(spreadCenter);
		this.#syncToRenderer();

		// Downloading is network work with nothing new on screen — it must not
		// keep the render loop alive. But an active cross-fade is a visual
		// animation, so request the next frame until it finishes.
		if (this.#hasActiveFades()) {
			this._onRequestFrame?.();
		}

		return this._hasPendingWork();
	}

	#hasActiveFades(): boolean {
		for (let p = 0; p < this.#states.length; p++) {
			if (this.#states[p][0]._downloadState === 'fading' || this.#states[p][1]._downloadState === 'fading') {
				return true;
			}
		}
		return false;
	}

	#pageDistance(p: number, spreadCenter: number): number {
		const images = this.#pageIdxes[spreadCenter];
		if (images) {
			const frontImgIdx = p * 2;
			const backImgIdx = p * 2 + 1;
			if (images.includes(frontImgIdx) || images.includes(backImgIdx)) {
				return 0;
			}
		}
		return Math.abs(p - spreadCenter);
	}

	#isInPreloadRange(p: number, side: 0 | 1, spreadCenter: number): boolean {
		const imgIdx = p * 2 + side;
		for (let offset = -IIIF_PRELOAD_DISTANCE; offset <= IIIF_PRELOAD_DISTANCE; offset++) {
			const cp = spreadCenter + offset;
			if (cp < 0 || cp >= this.#pageCount) continue;
			if (this.#pageIdxes[cp].includes(imgIdx)) return true;
		}
		return false;
	}

	#debounceMs(dist: number): number {
		return IIIF_DEBOUNCE_BASE_MS + dist * IIIF_DEBOUNCE_PER_DISTANCE_MS;
	}

	#chooseWidth(screenPagePx: number, currentLevel: number, originalWidth: number): number {
		let width = 512;
		if (screenPagePx > 768) width = 1024;
		if (screenPagePx > 1536) width = 2048;
		if (width > originalWidth && currentLevel >= originalWidth) return currentLevel;
		return Math.max(width, currentLevel);
	}

	#updateVisibility(now: number, spreadCenter: number): void {
		for (let p = 0; p < this.#pageCount; p++) {
			for (let side = 0; side < 2; side++) {
				const s = this.#states[p][side];
				if (!s._imageId) continue;

				if (this.#isInPreloadRange(p, side as 0 | 1, spreadCenter)) {
					if (s._downloadState === 'idle') {
						s._visibleSince = now;
						s._downloadState = 'pending';
					}
				} else {
					if (s._downloadState === 'downloading' && s._controller) {
						s._controller.abort();
						s._controller = null;
					}
					if (s._downloadState === 'pending' || s._downloadState === 'downloading') {
						s._downloadState = 'idle';
						s._visibleSince = 0;
					}
				}
			}
		}
	}

	#upgradeZoomedPages(now: number, spreadCenter: number, cameraRadius: number): void {
		const canvasWidth = this.#renderer._getCanvas().width;
		const zoomFactor = DEFAULT_CAMERA_RADIUS / Math.max(0.01, cameraRadius);
		const screenPagePx = (canvasWidth / 2) * zoomFactor;

		for (let p = 0; p < this.#pageCount; p++) {
			for (let side = 0; side < 2; side++) {
				const s = this.#states[p][side];
				if (!this.#isInPreloadRange(p, side as 0 | 1, spreadCenter)) continue;
				if (s._downloadState !== 'done') continue;
				if (!s._imageId) continue;

				const desired = this.#chooseWidth(screenPagePx, s._currentLevel, s._originalWidth);
				if (desired > s._currentLevel) {
					s._downloadState = 'pending';
					s._visibleSince = now;
				}
			}
		}
	}

	#startDownloads(now: number, spreadCenter: number, cameraRadius: number): void {
		const canvasWidth = this.#renderer._getCanvas().width;
		const zoomFactor = DEFAULT_CAMERA_RADIUS / Math.max(0.01, cameraRadius);
		const screenPagePx = (canvasWidth / 2) * zoomFactor;

		for (let p = 0; p < this.#pageCount; p++) {
			const dist = this.#pageDistance(p, spreadCenter);

			for (let side = 0; side < 2; side++) {
				const s = this.#states[p][side];
				if (s._downloadState !== 'pending') continue;
				if (!s._imageId) continue;

				if (!this.#isInPreloadRange(p, side as 0 | 1, spreadCenter)) continue;

				const elapsed = now - s._visibleSince;
				if (elapsed < this.#debounceMs(dist)) continue;

				const width = this.#chooseWidth(screenPagePx, s._currentLevel, s._originalWidth);
				if (width <= s._currentLevel) {
					s._downloadState = 'done';
					continue;
				}

				s._targetLevel = width;
				s._downloadState = 'downloading';

				const slot = s._currentLevel === 0 ? s._activeSlot : (1 - s._activeSlot) as 0 | 1;
				this.#fetchTexture(p, side as 0 | 1, slot, s);
			}
		}
	}

	async #fetchTexture(pageIdx: number, side: 0 | 1, slot: 0 | 1, state: PageSideState): Promise<void> {
		const controller = new AbortController();
		state._controller = controller;
		const url = `${this.#baseUrl}/${state._imageId}/full/!${state._targetLevel},/0/default.webp`;

		try {
			const response = await fetch(url, { signal: controller.signal });
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const blob = await response.blob();

			if (controller.signal.aborted || state._downloadState !== 'downloading') return;

			const bitmap = await createImageBitmap(blob);

			if (controller.signal.aborted || state._downloadState !== 'downloading') {
				bitmap.close();
				return;
			}

			this.#renderer._setPageHiResTexture(pageIdx, side, slot, bitmap);
			bitmap.close();

			state._currentLevel = state._targetLevel;
			state._downloadState = 'fading';
			state._fadeStartTime = performance.now();
			state._fadeProgress = 0;
			state._fadeType = state._activeSlot === slot ? 'in' : 'cross';
			state._controller = null;
			this._onRequestFrame?.();
		} catch (err: unknown) {
			if (err instanceof DOMException && err.name === 'AbortError') {
				// Intentionally cancelled — expected
			}
			state._downloadState = 'idle';
			state._visibleSince = 0;
			state._controller = null;
		}
	}

	#animateFades(now: number): void {
		for (let p = 0; p < this.#pageCount; p++) {
			for (let side = 0; side < 2; side++) {
				const s = this.#states[p][side];
				if (s._downloadState !== 'fading') continue;

				const elapsed = now - s._fadeStartTime;
				s._fadeProgress = Math.min(1.0, elapsed / IIIF_CROSSFADE_DURATION);

				if (s._fadeProgress >= 1.0) {
					if (s._fadeType === 'cross') {
						const oldSlot = s._activeSlot;
						s._activeSlot = (1 - s._activeSlot) as 0 | 1;
						this.#renderer._evictPageHiRes(p, side as 0 | 1, oldSlot);
					}
					s._downloadState = 'done';
				}
			}
		}
	}

	#evictDistant(spreadCenter: number): void {
		for (let p = 0; p < this.#pageCount; p++) {
			const dist = this.#pageDistance(p, spreadCenter);
			if (dist <= IIIF_GPU_EVICT_DISTANCE) continue;

			for (let side = 0; side < 2; side++) {
				const s = this.#states[p][side];
				if (s._currentLevel === 0) continue;

				if (s._downloadState === 'downloading' && s._controller) {
					s._controller.abort();
					s._controller = null;
				}

				this.#renderer._evictPageHiRes(p, side as 0 | 1, 0);
				this.#renderer._evictPageHiRes(p, side as 0 | 1, 1);
				s._currentLevel = 0;
				s._targetLevel = 0;
				s._downloadState = 'idle';
				s._visibleSince = 0;
				s._fadeProgress = 0;
				s._fadeType = 'in';
				s._activeSlot = 0;
			}
		}
	}

	#syncToRenderer(): void {
		for (let p = 0; p < this.#pageCount; p++) {
			const fbA = this.#computeSlotBlend(this.#states[p][0], 0);
			const fbB = this.#computeSlotBlend(this.#states[p][0], 1);
			const bbA = this.#computeSlotBlend(this.#states[p][1], 0);
			const bbB = this.#computeSlotBlend(this.#states[p][1], 1);
			this.#renderer._setPageBlend(p, fbA, fbB, bbA, bbB);
		}
	}

	#computeSlotBlend(s: PageSideState, slot: 0 | 1): number {
		if (s._currentLevel === 0) return 0;

		if (s._downloadState === 'fading') {
			const p = s._fadeProgress;
			if (s._fadeType === 'in') {
				return s._activeSlot === slot ? p : 0;
			} else {
				if (s._activeSlot === slot) return 1.0 - p;
				else return p;
			}
		}

		return s._activeSlot === slot ? 1.0 : 0.0;
	}

	_hasPendingWork(): boolean {
		for (let p = 0; p < this.#pageCount; p++) {
			for (let side = 0; side < 2; side++) {
				const s = this.#states[p][side];
				if (s._downloadState === 'pending' || s._downloadState === 'downloading' || s._downloadState === 'fading') {
					return true;
				}
			}
		}
		return false;
	}
}
