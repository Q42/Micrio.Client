import type { Models } from '$types/models'
import type { HTMLMicrioElement } from '$core/element'
import { get } from '$core/store'

export type EditorSelectKind = 'marker' | 'embed' | 'waypoint'

/**
 * When `<micr-io>` is in `editMode`, intercepts click/activate interactions and dispatches
 * the corresponding bubbling `editor-*-select` event for the host editor.
 * Returns `true` if `editMode` consumed the interaction.
 */
export function interceptEditorSelect(micrio: HTMLMicrioElement, kind: EditorSelectKind, detail: unknown): boolean {
	if (!get(micrio.editMode)) {
		return false
	}
	micrio.dispatchEvent(new CustomEvent(`editor-${kind}-select`, { detail, bubbles: true }))
	return true
}

/**
 * Attaches the realtime `'change'` CustomEvent bridge to a `<micrio-marker>` element.
 * Mutates live marker placement/audio fields in-place and triggers a synchronous reposition
 * + `'audio-update'` without tearing down DOM or interrupting WebAudio playback.
 */
export function attachMarkerEditorBridge(
	el: HTMLElement,
	marker: Models.ImageData.Marker,
	micrio: HTMLMicrioElement,
	onMoved: () => void,
): () => void {
	const onChange = (e: Event) => {
		if (!(e instanceof CustomEvent)) {
			return
		}
		const raw: unknown = e.detail
		if (typeof raw !== 'object' || raw === null) {
			return
		}
		if ('x' in raw && typeof raw.x === 'number') {
			marker.x = raw.x
		}
		if ('y' in raw && typeof raw.y === 'number') {
			marker.y = raw.y
		}
		if ('radius' in raw && typeof raw.radius === 'number') {
			marker.radius = raw.radius
		}
		if ('rotation' in raw && typeof raw.rotation === 'number') {
			marker.rotation = raw.rotation
		}
		if ('backside' in raw && typeof raw.backside === 'boolean') {
			marker.backside = raw.backside
		}
		if (
			'positionalAudio' in raw &&
			typeof raw.positionalAudio === 'object' &&
			raw.positionalAudio !== null &&
			marker.positionalAudio
		) {
			Object.assign(marker.positionalAudio, raw.positionalAudio)
		}
		if (!marker.noMarker) {
			onMoved()
		}
		if (marker.positionalAudio) {
			micrio.dispatchEvent(new Event('audio-update'))
		}
	}

	el.addEventListener('change', onChange)
	return () => {
		el.removeEventListener('change', onChange)
	}
}

/**
 * Applies a realtime `'change'` CustomEvent payload onto a mounted `<micrio-embed>` element
 * (area, transforms, opacity, and live `<video>` muted/loop state without restarting playback).
 */
export function applyEmbedEditorChange(
	el: HTMLElement,
	embed: Models.ImageData.Embed | undefined,
	container: HTMLElement | undefined,
	e: Event,
): void {
	if (embed === undefined) {
		return
	}
	if (e instanceof CustomEvent && typeof e.detail === 'object' && e.detail !== null) {
		Object.assign(embed, e.detail)
	}
	if (container && embed.opacity !== undefined) {
		container.style.setProperty('--opacity', String(embed.opacity))
	}
	const videoEl = el.querySelector('video')
	if (videoEl && embed.video) {
		if (typeof embed.video.muted === 'boolean') {
			videoEl.muted = embed.video.muted
		}
		if (typeof embed.video.loop === 'boolean') {
			videoEl.loop = embed.video.loop
		}
	}
}

/**
 * Applies a realtime `'change'` CustomEvent patch onto a `<micrio-waypoint>` settings object.
 * Returns `{ settings, needsRender }` so the waypoint knows whether to re-render DOM or only reposition.
 */
export function applyWaypointEditorChange(
	e: Event,
	existing: Models.Spaces.WayPointSettings | undefined,
	iface: Models.Spaces.WaypointInterface | undefined,
): { settings: Models.Spaces.WayPointSettings | undefined; needsRender: boolean } {
	if (!(e instanceof CustomEvent)) {
		return { settings: existing, needsRender: true }
	}
	const raw: unknown = e.detail
	if (typeof raw !== 'object' || raw === null) {
		return { settings: existing, needsRender: true }
	}
	const current: Models.Spaces.WayPointSettings = existing ?? { i18n: {} }
	Object.assign(current, raw)
	if (iface !== undefined) {
		iface.settings = current
		if ('coords' in raw && typeof raw.coords === 'object' && raw.coords !== null && current.coords) {
			iface.coords = current.coords
		}
	}
	const needsRender = 'i18n' in raw || 'customIconIdx' in raw
	return { settings: current, needsRender }
}
