import type { HTMLMicrioElement } from '$core/element'
import type { Unsubscriber } from '$core/store'
import { MicrioImage } from '$core/image'
import { DataLoader } from '$utils/dataLoader'
import { deepCopy } from '$utils/object'

export interface MicrioSplitLink {
	micrioId: string
	markerId?: string
	follows?: boolean
}

export function parseSplitLink(raw?: string): MicrioSplitLink | undefined {
	if (!raw) {
		return undefined
	}
	const parts = raw.split(',').map((s) => s.trim())
	if (!parts[0]) {
		return undefined
	}
	return {
		micrioId: parts[0],
		markerId: parts[1] || undefined,
		follows: Boolean(parts[2]) && parts[2] !== 'false',
	}
}

interface SplitState {
	secondary: MicrioImage
	unsub: Unsubscriber | null
	unsubData: Unsubscriber | null
}

const splits = new Map<MicrioImage, SplitState>()

/** Deferred canvas releases, kept so a teardown can cancel one that has not run yet. @internal */
const pendingReleases = new Set<ReturnType<typeof globalThis.setTimeout>>()

export function hasSplit(primary: MicrioImage): boolean {
	return splits.has(primary)
}

export function getSplitSecondary(primary: MicrioImage): MicrioImage | undefined {
	return splits.get(primary)?.secondary
}

export function isSplitSecondary(image: MicrioImage): boolean {
	for (const s of splits.values()) {
		if (s.secondary === image) {
			return true
		}
	}
	return false
}

export async function openSplit(
	micrio: HTMLMicrioElement,
	primary: MicrioImage,
	link: MicrioSplitLink,
	opts?: { isPassive?: boolean },
): Promise<void> {
	if (splits.has(primary)) {
		return
	}
	if (primary._noImage || primary.grid || isSplitSecondary(primary)) {
		return
	}

	const bundle = await DataLoader._getBundleImage(link.micrioId)
	if (!bundle) {
		return
	}

	// The element's own default settings apply to the split image too, as they do to the
	// image the element opened itself.
	const settings = { ...bundle.settings }
	if (micrio.defaultSettings) {
		deepCopy(micrio.defaultSettings, settings)
	}

	// A passive split mirrors the primary camera and has no viewport of its own to seed.
	const isPassive = opts?.isPassive !== false
	// The marker data rides along in the bundle, so the viewport this split would fly to is
	// known before the canvas exists: seeding it opens the split there directly, instead of
	// on the full image and then jumping to the marker.
	const linked = !isPassive && link.markerId ? bundle.data?.markers?.find((m) => m.id === link.markerId) : undefined
	if (linked?.view) {
		settings.view = linked.view
	}
	const secondary = new MicrioImage(micrio._engine, { ...bundle, settings })
	micrio._canvases.push(secondary)
	micrio._engine._addCanvasDirect(secondary)

	secondary._opacity = 0

	if (isPassive) {
		secondary._isPassiveSecondary = true
	}

	const { portrait } = micrio.canvas.viewport
	primary.camera.setArea(portrait ? [0, 0, 1, 0.5] : [0, 0, 0.5, 1])
	secondary.camera.setArea(portrait ? [0, 1, 1, 0] : [1, 0, 0, 1], { direct: true })
	secondary.camera.setArea(portrait ? [0, 0.5, 1, 0.5] : [0.5, 0, 0.5, 1])

	let unsub: Unsubscriber | null = null
	if (isPassive) {
		unsub = primary.state.view.subscribe((v) => {
			if (v && !secondary.camera._aniDone) {
				secondary.camera.setView(v, { noLimit: true })
			}
		})
	}

	let unsubData: Unsubscriber | null = null
	if (link.markerId && !linked?.view) {
		unsubData = secondary.data.subscribe((d) => {
			if (!d) {
				return
			}
			const m = d.markers?.find((mk) => mk.id === link.markerId)
			if (m?.view) {
				secondary.camera.flyToView(m.view, { isJump: true }).catch(() => {})
			}
			unsubData?.()
		})
	}

	splits.set(primary, { secondary, unsub, unsubData })
	micrio.events._dispatch('splitscreen-start', secondary)
}

export function closeSplit(
	micrio: HTMLMicrioElement,
	primary: MicrioImage,
	opts?: { keepSecondaryCanvas?: boolean; immediate?: boolean },
): void {
	const state = splits.get(primary)
	if (!state) {
		return
	}
	splits.delete(primary)

	state.unsub?.()
	state.unsubData?.()

	const { portrait } = micrio.canvas.viewport
	state.secondary.camera.setArea(portrait ? [0, 1, 1, 0] : [1, 0, 0, 1], { direct: true })
	primary.camera.setArea([0, 0, 1, 1])

	if (!opts?.keepSecondaryCanvas) {
		// The delay lets the area animation run out before the canvas is released. A teardown
		// cannot wait for it, and the split is already out of `splits` by then, so the timer is
		// tracked in `pendingReleases` and cancelled by `closeAllSplits(..., true)`: otherwise it
		// would outlive the viewer and release a canvas of an engine that has already been unbound.
		if (opts?.immediate) {
			micrio._engine._removeCanvas(state.secondary)
		} else {
			const timer = globalThis.setTimeout(() => {
				pendingReleases.delete(timer)
				micrio._engine._removeCanvas(state.secondary)
			}, 400)
			pendingReleases.add(timer)
		}
	}
	micrio.events._dispatch('splitscreen-stop', state.secondary)
}

export function closeAllSplits(micrio: HTMLMicrioElement, immediate = false): void {
	for (const p of splits.keys()) {
		closeSplit(micrio, p, { immediate })
	}
	if (immediate) {
		for (const timer of pendingReleases) {
			globalThis.clearTimeout(timer)
		}
		pendingReleases.clear()
	}
}
