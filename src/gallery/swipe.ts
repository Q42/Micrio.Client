import type { HTMLMicrioElement } from '$core/element'
import type { MicrioImage } from '$core/image'
import type { Models } from '$types/models'
import type { Engine } from '$render/engine'
import { Camera } from '$core/camera'
import { getEasing } from '$render/easing'
import { Frame } from '$core/frame'

/**
 * Manages horizontal strip-swipe navigation between gallery pages on a shared canvas.
 *
 * The strip's unit is a *page*, not an image: a spread page is rendered by one child canvas
 * whose camera it is, so its two halves zoom and pan as a single entity. The page's first
 * image owns that canvas and the rest are embeds of it, placed in the leader's image space.
 * @internal
 */
export class SwipeGallery {
	#micrio: HTMLMicrioElement
	#images: MicrioImage[]
	#pageToImages: number[][]
	/** Rest view of each page, in the page canvas's image space. */
	#pageBoxes: Models.Camera.View[] = []
	#navigate: (page: number) => void
	#getCurrentPage: () => number

	#stripDragId: number | undefined
	#stripDragStartX = 0
	#stripDragLastX = 0
	#stripDragLastT = 0
	#stripDragVelocity = 0
	#stripDragActive = false
	#stripDragHorizontal = false
	#stripDragStartY = 0

	constructor(
		micrio: HTMLMicrioElement,
		images: MicrioImage[],
		pageToImages: number[][],
		navigate: (page: number) => void,
		getCurrentPage: () => number,
	) {
		this.#micrio = micrio
		this.#images = images
		this.#pageToImages = pageToImages
		this.#navigate = navigate
		this.#getCurrentPage = getCurrentPage
	}

	/** The image owning page `page`'s canvas: a spread's left-hand page. */
	#pageLeader(page: number): MicrioImage | undefined {
		return this.#images[this.#pageToImages[page]?.[0] ?? -1]
	}

	/** The camera of page `page`'s canvas. @internal */
	_pageCamera(page: number): Camera | undefined {
		return this.#pageLeader(page)?.camera
	}

	/** The union of a page's images in the page canvas's image space. `[0,0,1,1]` for one image. */
	#pageBox(page: number): Models.Camera.View {
		let x0 = 0
		let y0 = 0
		let x1 = 1
		let y1 = 1
		for (const idx of this.#pageToImages[page]?.slice(1) ?? []) {
			const area = this.#images[idx]?.opts.area
			if (area === undefined) {
				continue
			}
			x0 = Math.min(x0, area[0])
			y0 = Math.min(y0, area[1])
			x1 = Math.max(x1, area[0] + area[2])
			y1 = Math.max(y1, area[1] + area[3])
		}
		return [x0, y0, x1 - x0, y1 - y0]
	}

	/** Applies a page's rest view, pan limit and fit scale. Returns the page box. */
	#applyPageBox(page: number): Models.Camera.View {
		const leader = this.#pageLeader(page)
		const box = this.#pageBox(page)
		if (leader === undefined) {
			return box
		}
		const { camera } = leader
		if (box[0] !== 0 || box[1] !== 0 || box[2] !== 1 || box[3] !== 1) {
			// A spread page rests at the contain-fit of BOTH halves, and pans across both: the
			// focus view is what `_correctMinMax` derives that fit (and `isZoomedOut`) from.
			leader.canvas?.focus.set(box[0] + box[2] / 2, box[1] + box[3] / 2, box[2], box[3])
			camera.setLimit(box)
		}
		camera.setCoverLimit(false)
		camera.setView(box)
		return box
	}

	/** Initialize the page canvases, their hosted page images and the strip layout. */
	setup(startPage: number, parent: MicrioImage, engine: Engine): void {
		engine._itemTransitionTimingFunction = getEasing('ease-out')

		for (const [page, indexes] of this.#pageToImages.entries()) {
			const leader = this.#images[indexes[0]]
			if (leader === undefined) {
				continue
			}
			engine._addChild(leader, parent)

			for (const idx of indexes.slice(1)) {
				const follower = this.#images[idx]
				if (follower === undefined) {
					continue
				}
				// Its own camera, bound to the page canvas: zoom and pan land on the page, while
				// the follower's own coordinates can still be mapped through its sub-rectangle.
				follower.camera ??= new Camera(follower)
				if (leader.canvas !== undefined) {
					follower.camera._bindEngineCanvas(leader.canvas)
				}
				// Input on a spread's right half belongs to the page canvas, never to this image.
				follower._isPassiveSecondary = true
				void engine._addEmbed(follower, leader, { asImage: true, opacity: 1 })
			}

			leader.camera.setArea([page - startPage, 0, 1, 1], { direct: true, noDispatch: true })
			this.#pageBoxes[page] = this.#applyPageBox(page)
		}

		for (const idx of this.#pageToImages[startPage] ?? []) {
			this.#images[idx]?.visible.set(true)
		}
	}

	/** Whether the strip may take the gesture: the current page camera is at its fit view. */
	#canSwipe(): boolean {
		const camera = this.#pageLeader(this.#getCurrentPage())?.camera
		return camera !== undefined && camera.isZoomedOut()
	}

	/** Animate the strip to the given page. Resolves once the slide (and any zoom-out flight) has completed. */
	animateTo(nextPage: number, fast: boolean, duration: number, currentPage: number): Promise<void> {
		return new Promise<void>((resolve) => {
			const leader = this.#pageLeader(nextPage)
			const engine = this.#images[0]?.engine
			if (leader === undefined || engine === undefined) {
				resolve()
				return
			}
			let snapDur = 0
			if (duration !== 0) {
				snapDur = fast ? 0.125 : 0.2
			}
			// A page rests at its fit view, so a zoomed page is flown back before the strip
			// slides; the page being arrived at starts at its own box.
			const leaving = currentPage > -1 && currentPage !== nextPage ? this.#pageLeader(currentPage) : undefined
			const needsZoomOut = snapDur > 0 && leaving !== undefined && !leaving.camera.isZoomedOut()
			const startSlide = () => {
				engine._itemTransitionDuration = snapDur
				engine._crossfadeDuration = 0
				for (let page = 0; page < this.#pageToImages.length; page++) {
					const child = this.#pageLeader(page)
					if (child === undefined) {
						continue
					}
					const cur = child.opts.area ?? [0, 0, 1, 1]
					const wasNearVisible = cur[0] + cur[2] > -1 && cur[0] < 2
					const targetSlot = page - nextPage
					const willBeVisible = targetSlot + 1 > -1 && targetSlot < 1
					const needsMove = Math.abs(cur[0] - targetSlot) > 1e-4 || Math.abs(cur[2] - 1) > 1e-4
					const animate = snapDur > 0 && needsMove && (wasNearVisible || willBeVisible)
					child.camera.setArea([targetSlot, 0, 1, 1], { direct: !animate, noDispatch: true })
				}
				leader.camera.setView(this.#pageBoxes[nextPage] ?? [0, 0, 1, 1])
				engine.render()
				this.#awaitSlide(resolve)
			}
			if (needsZoomOut) {
				leaving.camera
					.flyToFullView({ duration: snapDur * 1000 * 0.6, speed: 2 })
					.then(startSlide)
					.catch(startSlide)
			} else {
				startSlide()
			}
		})
	}

	/** Resolves once none of the page canvases are mid area-transition (the strip slide finished). @internal */
	#awaitSlide = (resolve: () => void): void => {
		// A superseded slide can leave an area animation that never settles; without a ceiling
		// this waiter would keep a frame callback queued (and `_keepRendering` on) forever.
		const deadLine = performance.now() + 5000
		const tick = (): void => {
			for (let page = 0; page < this.#pageToImages.length; page++) {
				const canvas = this.#pageLeader(page)?.canvas
				if (canvas?._areaAnimating() && performance.now() < deadLine) {
					Frame.request(tick)
					return
				}
			}
			resolve()
		}
		Frame.request(tick)
	}

	#resetDrag = (): void => {
		this.#unlisten()
		this.#stripDragId = undefined
		this.#stripDragActive = false
		delete this.#micrio.dataset.panning
		this.#micrio._keepRendering = false
	}

	/** Start handling a pointer drag for strip-swipe navigation. */
	handlePointerDown = (e: PointerEvent): void => {
		if (e.button !== 0) {
			return
		}
		if (this.#stripDragId !== undefined) {
			if (e.pointerId !== this.#stripDragId) {
				if (this.#stripDragActive) {
					this.#navigate(this.#getCurrentPage())
				}
				this.#resetDrag()
			}
			return
		}
		if (!this.#canSwipe()) {
			return
		}
		this.#stripDragId = e.pointerId
		this.#stripDragStartX = this.#stripDragLastX = e.clientX
		this.#stripDragStartY = e.clientY
		this.#stripDragLastT = e.timeStamp
		this.#stripDragVelocity = 0
		this.#stripDragActive = false
		this.#stripDragHorizontal = false
		globalThis.addEventListener('pointermove', this.#stripPointerMove)
		globalThis.addEventListener('pointerup', this.#stripPointerUp)
		globalThis.addEventListener('pointercancel', this.#stripPointerUp)
	}

	#stripPointerMove = (e: PointerEvent): void => {
		if (e.pointerId !== this.#stripDragId) {
			return
		}
		const dx = e.clientX - this.#stripDragStartX
		const dy = e.clientY - this.#stripDragStartY
		if (!this.#stripDragActive) {
			if (Math.abs(dx) < 6 && Math.abs(dy) < 6) {
				return
			}
			this.#stripDragHorizontal = Math.abs(dx) > Math.abs(dy)
		}
		// The page can be zoomed while the pointer is down (a wheel tick), which hands the
		// gesture to the pan. Ask again at the direction decision and on every later move, and
		// put the strip back instead of turning the release into a page change.
		if (!this.#stripDragHorizontal || !this.#canSwipe()) {
			this.#stripPointerUp(e)
			return
		}
		if (!this.#stripDragActive) {
			this.#stripDragActive = true
			this.#micrio.dataset.panning = ''
			this.#micrio._keepRendering = true
			this.#micrio.canvas.element.setPointerCapture(e.pointerId)
		}
		const dt = Math.max(1, e.timeStamp - this.#stripDragLastT)
		this.#stripDragVelocity = (e.clientX - this.#stripDragLastX) / dt
		this.#stripDragLastX = e.clientX
		this.#stripDragLastT = e.timeStamp
		const w = this.#micrio.offsetWidth || 1
		const progress = dx / w
		this.#applyDragProgress(progress)
	}

	#stripPointerUp = (e: PointerEvent): void => {
		if (e.pointerId !== this.#stripDragId) {
			return
		}
		const wasActive = this.#stripDragActive
		this.#resetDrag()
		if (!wasActive) {
			return
		}
		try {
			this.#micrio.canvas.element.releasePointerCapture(e.pointerId)
		} catch {}
		// The page may have been zoomed between the last move and the release, which makes this
		// a pan: keep the page as it is and put the strip back where it belongs.
		if (!this.#canSwipe()) {
			this.#restorePages()
			return
		}
		const w = this.#micrio.offsetWidth || 1
		const progress = (e.clientX - this.#stripDragStartX) / w
		let target = this.#getCurrentPage()
		if (progress < -0.3 || this.#stripDragVelocity < -0.5) {
			target = Math.min(this.#pageToImages.length - 1, this.#getCurrentPage() + 1)
		} else if (progress > 0.3 || this.#stripDragVelocity > 0.5) {
			target = Math.max(0, this.#getCurrentPage() - 1)
		}
		this.#navigate(target)
	}

	#unlisten = (): void => {
		globalThis.removeEventListener('pointermove', this.#stripPointerMove)
		globalThis.removeEventListener('pointerup', this.#stripPointerUp)
		globalThis.removeEventListener('pointercancel', this.#stripPointerUp)
	}

	/** Puts every page back at its at-rest slot (used when a gesture is abandoned). */
	#restorePages(): void {
		const curr = this.#getCurrentPage()
		const engine = this.#images[0]?.engine
		if (engine === undefined) {
			return
		}
		for (let page = 0; page < this.#pageToImages.length; page++) {
			this.#pageLeader(page)?.camera.setArea([page - curr, 0, 1, 1], { direct: true, noDispatch: true })
		}
		engine.render()
	}

	#applyDragProgress(progress: number): void {
		const curr = this.#getCurrentPage()
		const totalPages = this.#pageToImages.length
		const atLeftEdge = curr === 0 && progress > 0
		const atRightEdge = curr === totalPages - 1 && progress < 0
		const eased = atLeftEdge || atRightEdge ? Math.sign(progress) * Math.sqrt(Math.abs(progress)) * 0.3 : progress
		const engine = this.#images[0]?.engine
		if (engine === undefined) {
			return
		}
		for (let page = 0; page < totalPages; page++) {
			const leader = this.#pageLeader(page)
			if (leader === undefined) {
				continue
			}
			const slotPos = page - curr + eased
			if (slotPos + 1 <= -1 || slotPos >= 1) {
				continue
			}
			leader.camera.setArea([slotPos, 0, 1, 1], { direct: true, noDispatch: true })
		}
		engine.render()
	}

	/** Clean up swipe state, remove listeners, and reset the micrio element. */
	destroy(): void {
		delete this.#micrio.dataset.panning
		this.#micrio._keepRendering = false
		this.#unlisten()
	}
}
