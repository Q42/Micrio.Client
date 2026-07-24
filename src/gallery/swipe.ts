import type { HTMLMicrioElement } from '$core/element';
import type { MicrioImage } from '$core/image';
import type { Engine } from '$render/engine';
import { getEasing } from '$render/easing';

export class SwipeGallery {
	#micrio:HTMLMicrioElement;
	#images:MicrioImage[];
	#pageToImages:number[][];
	#imageSlotPos:number[];
	#imageSlotWidth:number[];
	#navigate:(page:number)=>void;
	#getCurrentPage:()=>number;
	#currentImageIdx = -1;

	#stripDragId: number | undefined;
	#stripDragStartX = 0;
	#stripDragLastX = 0;
	#stripDragLastT = 0;
	#stripDragVelocity = 0;
	#stripDragActive = false;
	#stripDragHorizontal = false;
	#stripDragStartY = 0;

	constructor(
		micrio:HTMLMicrioElement,
		images:MicrioImage[],
		pageToImages:number[][],
		imageSlotPos:number[],
		imageSlotWidth:number[],
		navigate:(page:number)=>void,
		getCurrentPage:()=>number,
	) {
		this.#micrio = micrio;
		this.#images = images;
		this.#pageToImages = pageToImages;
		this.#imageSlotPos = imageSlotPos;
		this.#imageSlotWidth = imageSlotWidth;
		this.#navigate = navigate;
		this.#getCurrentPage = getCurrentPage;
	}

	async setup(startImageIdx:number, parent:MicrioImage, engine:Engine):Promise<void> {
		this.#currentImageIdx = startImageIdx;

		engine._gridTransitionTimingFunction = getEasing('ease-out');
		await Promise.allSettled(this.#images.map(d => engine._addChild(d as MicrioImage, parent)));

		const baseSlot = this.#imageSlotPos[startImageIdx] ?? 0;
		for (let i = 0; i < this.#images.length; i++) {
			const child = this.#images[i] as MicrioImage;
			if (!child.camera) continue;
			child.camera.setCoverLimit(false);
			const area = [this.#imageSlotPos[i] - baseSlot, 0, this.#imageSlotWidth[i], 1] as [number, number, number, number];
			child.camera.setArea(area, { direct: true, noDispatch: true });
			child.camera.setView([0, 0, 1, 1]);
		}
		(this.#images[startImageIdx] as MicrioImage)?.visible.set(true);
	}

	#canSwipe():boolean {
		const active = this.#images[this.#currentImageIdx] as MicrioImage | undefined;
		return !!active?.camera?.isZoomedOut();
	}

	animateTo(nextIdx:number, fast:boolean, duration:number, currentImageIdx:number):void {
		this.#currentImageIdx = currentImageIdx;

		const images = this.#images;
		if (!images[nextIdx]) return;
		const snapDur = duration === 0 ? 0 : (fast ? 0.175 : 0.35);
		const leaving = images[currentImageIdx > -1 && currentImageIdx !== nextIdx ? currentImageIdx : -1] as MicrioImage | undefined;
		const needsZoomOut = snapDur > 0 && leaving?.camera && !leaving.camera.isZoomedOut();
		const engine = images[0]?.engine;
		if (!engine) return;
		const baseSlot = this.#imageSlotPos[nextIdx];
		const startSlide = () => {
			engine._gridTransitionDuration = snapDur;
			for (let i = 0; i < images.length; i++) {
				const child = images[i] as MicrioImage | undefined;
				if (!child?.camera) continue;
				const cur = child.opts.area ?? [0, 0, 1, 1];
				const prevSlotLeft = cur[0];
				const prevSlotRight = cur[0] + cur[2];
				const wasNearVisible = prevSlotRight > -1 && prevSlotLeft < 1;
				const targetSlot = this.#imageSlotPos[i] - baseSlot;
				const width = this.#imageSlotWidth[i];
				const willBeVisible = targetSlot + width > -1 && targetSlot < 1;
				const needsMove = Math.abs(cur[0] - targetSlot) > 1e-4 || Math.abs(cur[2] - width) > 1e-4;
				const animate = snapDur > 0 && needsMove && (wasNearVisible || willBeVisible);
				child.camera.setArea([targetSlot, 0, width, 1], { direct: !animate, noDispatch: true });
			}
			images[nextIdx]?.camera?.setView([0, 0, 1, 1]);
			engine.render();
		};
		if (needsZoomOut) leaving!.camera!.flyToCoverView({ duration: snapDur * 1000 * 0.6, speed: 2 })
			.then(startSlide).catch(startSlide);
		else startSlide();
	}

	#resetDrag = ():void => {
		this.#unlisten();
		this.#stripDragId = undefined;
		this.#stripDragActive = false;
		this.#micrio.removeAttribute('data-panning');
		this.#micrio._keepRendering = false;
	};

	handlePointerDown = (e:PointerEvent):void => {
		if (e.button !== 0) return;
		if (this.#stripDragId !== undefined) {
			if (e.pointerId !== this.#stripDragId) {
				if (this.#stripDragActive) this.#navigate(this.#getCurrentPage());
				this.#resetDrag();
			}
			return;
		}
		if (!this.#canSwipe()) return;
		this.#stripDragId = e.pointerId;
		this.#stripDragStartX = this.#stripDragLastX = e.clientX;
		this.#stripDragStartY = e.clientY;
		this.#stripDragLastT = e.timeStamp;
		this.#stripDragVelocity = 0;
		this.#stripDragActive = false;
		this.#stripDragHorizontal = false;
		window.addEventListener('pointermove', this.#stripPointerMove);
		window.addEventListener('pointerup', this.#stripPointerUp);
		window.addEventListener('pointercancel', this.#stripPointerUp);
	};

	#stripPointerMove = (e:PointerEvent):void => {
		if (e.pointerId !== this.#stripDragId) return;
		const dx = e.clientX - this.#stripDragStartX;
		const dy = e.clientY - this.#stripDragStartY;
		if (!this.#stripDragActive) {
			if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
			this.#stripDragHorizontal = Math.abs(dx) > Math.abs(dy);
			if (!this.#stripDragHorizontal) { this.#stripPointerUp(e); return; }
			this.#stripDragActive = true;
			this.#micrio.setAttribute('data-panning', '');
			this.#micrio._keepRendering = true;
			this.#micrio.canvas.element.setPointerCapture(e.pointerId);
		}
		const dt = Math.max(1, e.timeStamp - this.#stripDragLastT);
		this.#stripDragVelocity = (e.clientX - this.#stripDragLastX) / dt;
		this.#stripDragLastX = e.clientX;
		this.#stripDragLastT = e.timeStamp;
		const w = this.#micrio.offsetWidth || 1;
		const progress = dx / w;
		this.#applyDragProgress(progress);
	};

	#stripPointerUp = (e:PointerEvent):void => {
		if (e.pointerId !== this.#stripDragId) return;
		const wasActive = this.#stripDragActive;
		this.#resetDrag();
		if (!wasActive) return;
		try { this.#micrio.canvas.element.releasePointerCapture(e.pointerId); } catch (_) {}
		const w = this.#micrio.offsetWidth || 1;
		const progress = (e.clientX - this.#stripDragStartX) / w;
		let target = this.#getCurrentPage();
		if (progress < -0.3 || this.#stripDragVelocity < -0.5) target = Math.min(this.#pageToImages.length - 1, this.#getCurrentPage() + 1);
		else if (progress > 0.3 || this.#stripDragVelocity > 0.5) target = Math.max(0, this.#getCurrentPage() - 1);
		this.#navigate(target);
	};

	#unlisten = ():void => {
		window.removeEventListener('pointermove', this.#stripPointerMove);
		window.removeEventListener('pointerup', this.#stripPointerUp);
		window.removeEventListener('pointercancel', this.#stripPointerUp);
	}

	#applyDragProgress(progress:number):void {
		const images = this.#images;
		const curr = this.#getCurrentPage();
		const totalPages = this.#pageToImages.length;
		const atLeftEdge = curr === 0 && progress > 0;
		const atRightEdge = curr === totalPages - 1 && progress < 0;
		const eased = (atLeftEdge || atRightEdge) ? Math.sign(progress) * Math.sqrt(Math.abs(progress)) * 0.3 : progress;
		const imgIdx = this.#pageToImages[curr]?.[0] ?? 0;
		const baseSlot = this.#imageSlotPos[imgIdx];
		const engine = images[0]?.engine;
		if (!engine || baseSlot === undefined) return;
		for (let i = 0; i < images.length; i++) {
			const child = images[i] as MicrioImage | undefined;
			if (!child?.camera) continue;
			const slotPos = this.#imageSlotPos[i] - baseSlot + eased;
			const width = this.#imageSlotWidth[i];
			if (slotPos + width <= -1 || slotPos >= 1) continue;
			child.camera.setArea([slotPos, 0, width, 1], { direct: true, noDispatch: true });
		}
		engine.render();
	}

	destroy():void {
		this.#micrio.removeAttribute('data-panning');
		this.#micrio._keepRendering = false;
		this.#unlisten();
	}
}
