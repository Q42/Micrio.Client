import { vi } from 'vitest'
import type { HTMLMicrioElement } from '$core/element'
import type { Models } from '$types/models'
import { get } from '$core/store'
import { afterFrame } from '$utils/dom'
import { mountViewer, type Viewer, waitFor } from './viewer'

/** A viewer with a loaded tour-capable image. */
export interface TourSetup extends Viewer {
	/** The tour element the layout created (`<micrio-tour>` or `<micrio-serial-tour>`). */
	tourEl: () => Element | null
}

/** Mounts a viewer, opens the bundle and waits until it has finished loading. */
export async function mountTour(
	bundle: Models.ImageBundle.BundleImage,
	attrs: Record<string, string> | string = {},
): Promise<TourSetup> {
	const viewer = mountViewer(attrs)
	await viewer.open(bundle)
	const { id } = bundle
	await waitFor(() => viewer.el.$current?.id === id, 4000, `current image ${id}`)
	await waitFor(() => !get(viewer.el._loading), 4000, 'loading to finish')
	return {
		...viewer,
		tourEl: () => viewer.el.querySelector('micrio-tour, micrio-serial-tour'),
	}
}

/**
 * Starts a tour the way the toolbar does: set the tour store, then let the layout
 * mount the UI element for it.
 */
export async function startTour(
	viewer: Viewer,
	tour: Models.ImageData.MarkerTour | Models.ImageData.VideoTour,
): Promise<void> {
	viewer.el.state.tour.set(tour)
	await waitFor(() => viewer.el.querySelector('micrio-tour, micrio-serial-tour') !== null, 4000, 'tour element').catch(
		() => {},
	)
	await settle()
}

/** Waits for the next animation frame twice, covering the one-frame deferrals in the tour UI. */
export async function settle(frames = 2): Promise<void> {
	await Promise.all(Array.from({ length: frames }, () => afterFrame()))
}

/**
 * Moves the faked clock forward *without* running pending timers.
 *
 * `VideoTourInstance` derives `currentTime` from `Date.now()`, so pure time
 * arithmetic is only observable if its own scheduled steps stay parked. Requires
 * `vi.useFakeTimers()` to be active.
 */
export function tickClock(ms: number): void {
	vi.setSystemTime(Date.now() + ms)
}

/**
 * Advances the fake clock and its timers together, for tests that exercise the
 * tour's step scheduling itself. Requires `vi.useFakeTimers()` to be active.
 */
export function advance(ms: number): void {
	vi.setSystemTime(Date.now() + ms)
	vi.advanceTimersByTime(ms)
}

/**
 * Collects dispatched custom events on the viewer, with their details.
 *
 * `types` is keyed on the public event map, so a typo'd name is a compile error rather than a
 * silently empty recorder — the failure mode that let a declared-but-unfired event go unnoticed.
 */
export function recordEvents<K extends keyof Models.MicrioEventDetails>(
	el: HTMLMicrioElement,
	types: readonly K[],
): { events: { type: K; detail: unknown }[]; stop: () => void } {
	const events: { type: K; detail: unknown }[] = []
	const handlers = types.map((type) => {
		const fn = (e: Event) => events.push({ type, detail: (e as CustomEvent).detail })
		el.addEventListener(type, fn)
		return [type, fn] as const
	})
	return {
		events,
		stop: () => {
			for (const [type, fn] of handlers) {
				el.removeEventListener(type, fn)
			}
		},
	}
}
