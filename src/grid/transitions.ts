import type { Grid } from './grid'
import type { Models } from '$types/models'
import type { MicrioImage } from '$core/image'
import type { Engine } from '$render/engine'
import { Frame } from '$core/frame'
import { slideAreas, swipeAreas, swipeExitAreas } from './format'
import { sleep } from '$utils/dom'

/** Opacity that keeps an image fully visible without starting a fade. */
export const OPACITY_VISIBLE = 0.9999
/** Transition-only stacking tiers for `in-from-id`: sources over incoming over the rest. */
const Z_TIER_SOURCE = 3000
const Z_TIER_INCOMING = 2000
const Z_TIER_REST = 1000

/**
 * Resolves once every given image has drawn its base tile after this call, or
 * after `timeout` ms. Used to hold an `in-from-id` transition until its
 * newcomers have pixels, so they do not pop in mid-animation. `isCancelled`
 * stops the polling (and the rendering it forces) when the transition that
 * requested it was superseded or the grid was destroyed. @internal
 */
export function whenImagesReady(
	engine: Engine,
	images: MicrioImage[],
	timeout: number,
	isCancelled: () => boolean,
): Promise<void> {
	return new Promise<void>((resolve) => {
		const start = performance.now()
		// `_gotBase` is the timestamp of the last frame the base tile was
		// actually drawn. A stale value from an earlier appearance doesn't
		// guarantee the texture still exists (tiles of removed images get
		// cleaned up), so require a draw after this check started.
		const isReady = (img: MicrioImage): boolean => {
			const c = img.canvas
			if (!c) {
				return false
			}
			if (c.images.length === 0) {
				return true
			}
			return c.images[0]._gotBase >= start
		}
		const check = (): void => {
			if (isCancelled() || images.every(isReady) || performance.now() - start > timeout) {
				resolve()
			} else {
				engine.render()
				Frame.request(check)
			}
		}
		check()
	})
}

/** Configure the grid images for a "behind" or "behind-delayed" transition layout. @internal */
export function setupBehindTransition(
	grid: Grid,
	images: Models.Grid.GridImage[],
	opts: {
		coverLimit?: boolean
		forceAni?: boolean
		forceAreaAni?: boolean
		transition?: Models.Grid.GridSetTransition
	},
	focussed: MicrioImage | undefined,
): void {
	const isDelayed = opts.transition === 'behind-delayed'
	const isLim = opts.coverLimit === true
	opts.forceAni = true
	opts.coverLimit = isLim
	opts.forceAreaAni = true
	const vW = isDelayed ? 1 / images.length : 1
	let c = 0
	for (const i of grid._images) {
		i.camera.setCoverLimit(isLim)
		if (images.find((e) => e.id === i.id)) {
			i.camera.setArea([0, 0, focussed?.id === i.id ? 1 : vW, 1], { noDispatch: true, direct: true })
			if (i !== focussed) {
				i.camera.setView([0, 0, 1, 1])
			}
			if (isDelayed && i.canvas) {
				i.canvas.zIndex = images.length - c++
			}
		}
	}
	for (const e of images) {
		e.view = [0, 0, 1, 1]
	}
}

/** The source data an `in-from-id` set needs before it places its entries. @internal */
export interface InFromIdSources {
	/** The previous area of the source image for each new `from` entry. */
	fromAreas: Map<string, Models.Camera.View>
	/** New entries that have no valid source and fade in at their own area. */
	fadeInPlaceIds: Set<string>
}

/** Resolve every newly added `from` entry to its source image's previous area. @internal */
export function getInFromIdSources(
	imageEntries: Models.Grid.GridImage[],
	prevById: Map<string, MicrioImage>,
): InFromIdSources {
	const fromAreas = new Map<string, Models.Camera.View>()
	for (const entry of imageEntries) {
		const sourceId = entry.from
		if (!sourceId || prevById.has(entry.id)) {
			continue
		}
		const sourceArea = prevById.get(sourceId)?.opts.area
		if (sourceArea) {
			fromAreas.set(entry.id, sourceArea)
		}
	}
	return {
		fromAreas,
		// Newly added entries without a (valid) `from` source have nothing to
		// animate in from, so they simply fade in at their target area.
		fadeInPlaceIds: new Set(imageEntries.filter((e) => !prevById.has(e.id) && !fromAreas.has(e.id)).map((e) => e.id)),
	}
}

/** Milliseconds an `in-from-id` readiness gate may wait. @internal */
export function inFromIdTimeout(duration: number, crossfadeDuration: number): number {
	return (Math.max(duration, crossfadeDuration) || 1) * 1000 + 3000
}

/**
 * Stack and reveal the entries of an `in-from-id` set, and hold the transition
 * until the images that animate in from a source have drawn their base tile.
 * @internal
 */
export function setupInFromIdTransition(
	grid: Grid,
	imageEntries: Models.Grid.GridImage[],
	current: MicrioImage[],
	prevById: Map<string, MicrioImage>,
	{ fromAreas, fadeInPlaceIds }: InFromIdSources,
	opts: {
		/** Millisecond cap for the readiness gate. */
		timeout: number
		/** Whether this set is still the grid's current one. */
		canOpen: () => boolean
		/** Resolves the set's readiness gate. */
		open: () => void
	},
): void {
	const { _engine: engine } = grid.micrio
	const sourceIds = new Set(imageEntries.map((e) => e.from).filter((v): v is string => Boolean(v)))
	const incomingIds = new Set(imageEntries.filter((e) => !prevById.has(e.id) && fromAreas.has(e.id)).map((e) => e.id))

	for (const [i, entry] of imageEntries.entries()) {
		const c = grid.getImage(entry.id)?.canvas
		if (!c) {
			continue
		}
		// Keep animated (source/incoming) items fully visible so they don't fade
		// during their area animation. Fade-in-place items keep their default 0
		// opacity so they fade in at their target position.
		if (!fadeInPlaceIds.has(entry.id)) {
			c._setOpacityDirect(OPACITY_VISIBLE)
		}
		let { z } = entry
		if (z === undefined) {
			if (sourceIds.has(entry.id)) {
				z = Z_TIER_SOURCE + i
			} else if (incomingIds.has(entry.id)) {
				z = Z_TIER_INCOMING + i
			} else {
				z = Z_TIER_REST + i
			}
		}
		c.zIndex = z
	}

	// Wait until the images that animate in from a source have rendered their
	// base tiles before opening the gate that starts the transition, so they
	// don't pop in mid-animation. Fade-in-place items are excluded: they are
	// placed at their (often off-screen) end position and only become visible
	// once the camera zooms out after the gate opens, so waiting for them would
	// needlessly stall the whole transition until the timeout.
	const incoming = current.filter((img) => !prevById.has(img.id) && fromAreas.has(img.id))
	void whenImagesReady(engine, incoming, opts.timeout, () => !opts.canOpen()).then(() => {
		if (opts.canOpen()) {
			opts.open()
		}
	})
}

/** Perform a transition animation (crossfade, slide, swipe, or behind) between two images. @internal */
export async function transition(
	grid: Grid,
	target: MicrioImage,
	current: MicrioImage | undefined,
	{ duration, view, transition: trans, noViewAni, exitView, blur, cover }: Models.Grid.FocusOptions,
): Promise<Models.Grid.GridImage[]> {
	if (!trans) {
		return [{ id: target.id, size: [1], view }]
	}

	if (trans === 'crossfade') {
		target.camera.setArea([0, 0, 1, 1])
		noViewAni = true
	}

	if (view && noViewAni) {
		target.camera.setView(view, { noRender: true, noLimit: true })
	}

	if (!current || trans === 'crossfade') {
		return [{ id: target.id, size: [1], view }]
	}

	const isSlwipe = trans.startsWith('slide') || trans.startsWith('swipe')
	const isBehind = trans.startsWith('behind')
	let transDir = 90
	if (isSlwipe) {
		if (trans.endsWith('-up')) {
			transDir = 0
		} else if (trans.endsWith('-down')) {
			transDir = 180
		} else if (trans.endsWith('-left')) {
			transDir = 270
		}
	}

	if (isSlwipe || isBehind) {
		target.canvas?._setOpacityDirect(OPACITY_VISIBLE)
	}

	if (trans.startsWith('slide')) {
		target.camera.setArea(slideAreas[transDir], { noDispatch: true, direct: true })
	} else if (trans.startsWith('swipe')) {
		target.camera.setArea(swipeAreas[transDir], { noDispatch: true, direct: true })
	} else if (isBehind) {
		target.camera.setArea([0, 0, 1, 1])
		target.camera.setView([0, 0, 1, 1])
		const between: Models.Grid.GridImage[] = [
			{ id: current.id, size: [1], view: [0, 0, 1, 1] },
			{ id: target.id, size: [1], view: [0, 0, 1, 1] },
		]
		if (trans === 'behind-left') {
			between.reverse()
		}
		await grid
			.set(between, {
				noBlur: true,
				horizontal: true,
				coverLimit: cover,
			})
			.then(() => sleep(200))
	}

	if (blur && !Number.isNaN(blur) && blur > 0) {
		duration = duration ?? grid._nextCrossFadeDuration ?? grid._aniDurationIn
		const blurSpeed = duration / 2
		const { style } = grid.micrio.canvas.element
		style.transition = `filter ${blurSpeed}s ease`
		style.filter = `blur(${blur}px)`
		setTimeout(() => {
			style.filter = ''
			setTimeout(() => {
				style.transform = ''
				style.transition = ''
			}, blurSpeed * 1000)
		}, blurSpeed * 1000)
	}

	if (trans.startsWith('swipe')) {
		return [
			{ id: current.id, size: [1], view: exitView ?? current.camera.getView(), area: swipeExitAreas[transDir] },
			{ id: target.id, size: [1], view, area: [0, 0, 1, 1] },
		]
	}

	return [{ id: target.id, size: [1], view }]
}
