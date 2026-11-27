import type { Grid } from './grid'
import type { Models } from '$types/models'
import type { MicrioImage } from '$core/image'
import { get } from '$core/store'
import { sleep } from '$utils/dom'
import { switchToGrid } from './action-handlers'

type GridEffect = Models.Grid.GridEffect
type GridEffectStep = Models.Grid.GridEffectStep
type GridEntry = Models.Grid.GridEntry
type GridImage = Models.Grid.GridImage
type RunEffectOptions = Models.Grid.RunEffectOptions

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

/** Type guard for a valid {@link Models.Grid.GridEffect} object. @internal */
export function isGridEffect(value: unknown): value is GridEffect {
	return isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string' && Array.isArray(value.steps)
}

/** Parse a `grid:effect` action payload into either a named effect ID or an inline GridEffect. @internal */
export function parseGridEffectPayload(data: string | undefined): string | GridEffect | undefined {
	const trimmed = data?.trim()
	if (!trimmed) {
		return undefined
	}
	if (trimmed.startsWith('{')) {
		try {
			const parsed: unknown = JSON.parse(trimmed)
			if (isGridEffect(parsed)) {
				return parsed
			}
		} catch {
			return undefined
		}
	}
	return trimmed
}

/** Resolve a dynamic image reference (`'$current'`, `'$first'`, or an explicit image ID). */
function resolveImageRef(
	ref: string | undefined,
	grid: Grid,
	opts: RunEffectOptions,
	firstId?: string,
): string | undefined {
	if (!ref) {
		return undefined
	}
	if (ref === '$current') {
		return opts.sourceImageId ?? grid.$focussed?.id ?? grid._images[0]?.id
	}
	if (ref === '$first') {
		return firstId ?? grid._current[0]?.id ?? grid._images[0]?.id
	}
	return ref
}

/** Resolve a marker's viewport on an image, falling back to a gentle zoomed rect around `[x, y]`. */
function markerToView(m: Models.ImageData.Marker | undefined): Models.Camera.View | undefined {
	if (!m) {
		return undefined
	}
	if (m.view) {
		return m.view
	}
	const w = 0.3
	const h = 0.3
	const x = Math.max(0, Math.min(1 - w, m.x - w / 2))
	const y = Math.max(0, Math.min(1 - h, m.y - h / 2))
	return [x, y, w, h]
}

function resolveMarkerView(img: MicrioImage | undefined, markerId: string | undefined): Models.Camera.View | undefined {
	if (!img || !markerId) {
		return undefined
	}
	const m = img.$data?.markers?.find((n) => n.id === markerId)
	return markerToView(m)
}

function matchesImageTags(img: MicrioImage, tags: string[], match: 'any' | 'all'): boolean {
	if (tags.length === 0) {
		return true
	}
	const markers = img.$data?.markers ?? []
	if (markers.length === 0) {
		return false
	}
	if (match === 'all') {
		const present = new Set<string>()
		for (const m of markers) {
			for (const t of m.tags ?? []) {
				present.add(t)
			}
		}
		return tags.every((t) => present.has(t))
	}
	return markers.some((m) => m.tags?.some((t) => tags.includes(t)))
}

function firstMatchingTagMarker(img: MicrioImage, tags: string[]): Models.ImageData.Marker | undefined {
	const markers = img.$data?.markers ?? []
	return markers.find((m) => m.tags?.some((t) => tags.includes(t)))
}

function normalizeSize(size: [number, number?] | undefined): [number, number?] {
	if (!size) {
		return [1]
	}
	const cols = Number.isInteger(size[0]) && size[0] > 0 ? size[0] : 1
	const rows = size[1] !== undefined && Number.isInteger(size[1]) && size[1] > 0 ? size[1] : undefined
	return rows !== undefined ? [cols, rows] : [cols]
}

/** Build the resolved `GridEntry[]` array for a `layout` step. @internal */
export function resolveLayoutEntries(
	grid: Grid,
	step: Extract<GridEffectStep, { type: 'layout' }>,
	opts: RunEffectOptions,
): GridEntry[] {
	// Mode A: Explicit Visual Mosaic cells (ordered, supports empty spacers)
	if (step.cells && step.cells.length > 0) {
		const firstImageCell = step.cells.find((c) => !c.empty && Boolean(c.id))
		const firstResolvedId = resolveImageRef(firstImageCell?.id, grid, opts)
		const out: GridEntry[] = []
		for (const cell of step.cells) {
			if (cell.empty || !cell.id) {
				out.push({ empty: true, size: normalizeSize(cell.size) })
				continue
			}
			const resolvedId = resolveImageRef(cell.id, grid, opts, firstResolvedId)
			if (!resolvedId) {
				continue
			}
			const img = grid._imageMap.get(resolvedId)
			if (!img) {
				continue
			}
			const entry: GridImage = {
				id: img.id,
				size: normalizeSize(cell.size),
			}
			const fromId = resolveImageRef(cell.from, grid, opts, firstResolvedId)
			if (fromId) {
				entry.from = fromId
			}
			if (typeof cell.z === 'number' && Number.isFinite(cell.z)) {
				entry.z = cell.z
			}
			if (cell.cover !== undefined) {
				entry.cover = cell.cover
			}
			const view = cell.view ?? resolveMarkerView(img, cell.markerId)
			if (view) {
				entry.view = view
			}
			out.push(entry)
		}
		return out
	}

	// Mode B: Dynamic source + combinable rules
	const source = step.source ?? { mode: 'all' }
	let baseEntries: GridEntry[] = []

	switch (source.mode) {
		case 'all': {
			baseEntries = grid._images.map((img): GridImage => ({ id: img.id, size: [1] }))
			break
		}
		case 'current': {
			const cur = grid.getLayout()
			if (cur.length > 0) {
				for (const e of cur) {
					baseEntries.push({ ...e })
				}
			} else {
				for (const img of grid._images) {
					baseEntries.push({ id: img.id, size: [1] })
				}
			}
			break
		}
		case 'select': {
			for (const rawId of source.ids) {
				const resolved = resolveImageRef(rawId, grid, opts)
				if (resolved && grid._imageMap.has(resolved)) {
					baseEntries.push({ id: resolved, size: [1] })
				}
			}
			break
		}
		case 'tags': {
			const cleanTags = source.tags.map((t) => t.trim()).filter(Boolean)
			const match = source.match ?? 'any'
			for (const img of grid._images) {
				if (!matchesImageTags(img, cleanTags, match)) {
					continue
				}
				const entry: GridImage = { id: img.id, size: [1] }
				if (source.zoomToMarker && cleanTags.length > 0) {
					const m = firstMatchingTagMarker(img, cleanTags)
					const v = markerToView(m)
					if (v) {
						entry.view = v
					}
				}
				baseEntries.push(entry)
			}
			break
		}
		case 'tour': {
			const t = get(grid.micrio.state.tour)
			if (t && 'steps' in t && t.stepInfo) {
				const seen = new Set<string>()
				for (const s of t.stepInfo) {
					if (s.micrioId && !seen.has(s.micrioId) && grid._imageMap.has(s.micrioId)) {
						seen.add(s.micrioId)
						baseEntries.push({ id: s.micrioId, size: [1] })
					}
				}
			}
			break
		}
	}

	// Apply combinable per-image rules
	const rules = step.rules ?? []
	if (rules.length === 0) {
		return baseEntries
	}

	const firstMatchedId = baseEntries.find((e): e is GridImage => Boolean(e.id) && !e.empty)?.id
	const result: GridEntry[] = [...baseEntries]

	for (const rule of rules) {
		const targetId = resolveImageRef(rule.target, grid, opts, firstMatchedId)
		if (!targetId) {
			continue
		}

		if (rule.exclude) {
			for (let i = result.length - 1; i >= 0; i--) {
				const e = result[i]
				if (e.id === targetId && !e.empty) {
					result.splice(i, 1)
				}
			}
			continue
		}

		let idx = result.findIndex((e) => e.id === targetId && !e.empty)
		if (idx < 0) {
			if (!rule.include || !grid._imageMap.has(targetId)) {
				continue
			}
			const created: GridImage = { id: targetId, size: [1] }
			if (rule.position === 'prepend') {
				result.unshift(created)
				idx = 0
			} else {
				result.push(created)
				idx = result.length - 1
			}
		} else if (rule.position === 'prepend' && idx > 0) {
			const [moved] = result.splice(idx, 1)
			result.unshift(moved)
			idx = 0
		} else if (rule.position === 'append' && idx < result.length - 1) {
			const [moved] = result.splice(idx, 1)
			result.push(moved)
			idx = result.length - 1
		}

		const targetEntry = result[idx]
		if (!targetEntry.id || targetEntry.empty) {
			continue
		}
		if (rule.size !== undefined) {
			targetEntry.size = normalizeSize(rule.size)
		}
		const fromId = resolveImageRef(rule.from, grid, opts, firstMatchedId)
		if (fromId) {
			targetEntry.from = fromId
		}
		if (typeof rule.z === 'number' && Number.isFinite(rule.z)) {
			targetEntry.z = rule.z
		}
		if (rule.cover !== undefined) {
			targetEntry.cover = rule.cover
		}
		const view = rule.view ?? resolveMarkerView(grid._imageMap.get(targetId), rule.markerId)
		if (view) {
			targetEntry.view = view
		}
	}

	return result
}

/** Execute a {@link GridEffect} step-by-step on a {@link Grid} instance with cancellation support. @internal */
export async function executeGridEffect(
	grid: Grid,
	effect: GridEffect,
	opts: RunEffectOptions,
	isCancelled: () => boolean,
): Promise<void> {
	for (const step of effect.steps) {
		if (isCancelled()) {
			return
		}
		const stepDur = 'duration' in step && step.duration !== undefined ? step.duration : opts.duration

		switch (step.type) {
			case 'layout': {
				const entries = resolveLayoutEntries(grid, step, opts)
				const hasImages = entries.some((e) => Boolean(e.id) && !e.empty)
				if (!hasImages) {
					console.warn(`[Micrio Grid] Effect "${effect.name}" layout step matched 0 images; skipping.`)
					break
				}
				if (step.transition === 'crossfade' && stepDur !== undefined && stepDur > 0) {
					grid._nextCrossFadeDuration = stepDur
				}
				// oxlint-disable-next-line eslint/no-await-in-loop -- effect choreography steps must execute strictly in sequence
				await grid
					.set(entries, {
						duration: stepDur,
						horizontal: step.arrangement === 'row',
						columns: step.arrangement === 'columns' && step.columns && step.columns > 0 ? step.columns : undefined,
						scale: step.scale,
						transition: step.transition,
						view: step.view,
						cover: step.cover ?? grid.image.$settings?.initType === 'cover',
						noHistory: step.noHistory,
					})
					.catch(() => {})
				break
			}

			case 'focus': {
				const targetId = resolveImageRef(step.imageId, grid, opts)
				const img = targetId ? grid._imageMap.get(targetId) : undefined
				if (!img) {
					console.warn(`[Micrio Grid] Effect "${effect.name}" focus target not found: ${step.imageId}`)
					break
				}
				const view = step.view ?? resolveMarkerView(img, step.markerId)
				// oxlint-disable-next-line eslint/no-await-in-loop -- effect choreography steps must execute strictly in sequence
				await grid
					.gridFocus(img, {
						transition: step.transition ?? opts.focusTransition,
						duration: stepDur,
						view,
						blur: step.blur,
						cover: step.cover,
						coverLimit: step.coverLimit,
					})
					.catch(() => {})
				break
			}

			case 'flyTo': {
				const resolvedIds = new Set<string>()
				for (const rawId of step.imageIds ?? []) {
					const r = resolveImageRef(rawId, grid, opts)
					if (r) {
						resolvedIds.add(r)
					}
				}
				const cleanTags = (step.tags ?? []).map((t) => t.trim()).filter(Boolean)
				const match = step.match ?? 'any'
				const images = grid._current.filter((img) => {
					if (resolvedIds.has(img.id)) {
						return true
					}
					if (cleanTags.length > 0 && matchesImageTags(img, cleanTags, match)) {
						return true
					}
					return false
				})
				if (images.length > 0) {
					const xs = images.map((i) => i.opts.area?.[0] ?? 0)
					const ys = images.map((i) => i.opts.area?.[1] ?? 0)
					const right = Math.max(...images.map((i) => (i.opts.area?.[0] ?? 0) + (i.opts.area?.[2] ?? 1)))
					const bottom = Math.max(...images.map((i) => (i.opts.area?.[1] ?? 0) + (i.opts.area?.[3] ?? 1)))
					const minX = Math.min(...xs)
					const minY = Math.min(...ys)
					// oxlint-disable-next-line eslint/no-await-in-loop -- effect choreography steps must execute strictly in sequence
					await grid.image.camera
						.flyToView([minX, minY, right - minX, bottom - minY], {
							duration: stepDur !== undefined ? stepDur * 1000 : undefined,
						})
						.catch(() => {})
				} else {
					console.warn(`[Micrio Grid] Effect "${effect.name}" flyTo matched no visible images.`)
				}
				break
			}

			case 'resize': {
				const targetId = resolveImageRef(step.imageId, grid, opts)
				if (!targetId || !grid._imageMap.has(targetId)) {
					break
				}
				const span = normalizeSize(step.size)
				const cover = grid.image.$settings?.initType === 'cover'
				// If currently focused on a single image, expand into the full album layout with this image resized
				const existingLayout = grid.getLayout()
				const nextEntries: GridEntry[] = []
				let matched = false
				if (grid.$focussed || existingLayout.length === 0) {
					for (const img of grid._images) {
						if (img.id === targetId) {
							matched = true
							nextEntries.push({ id: img.id, size: span })
						} else {
							nextEntries.push({ id: img.id, size: [1] })
						}
					}
				} else {
					for (const e of existingLayout) {
						if (e.id === targetId && !e.empty) {
							matched = true
							nextEntries.push({ ...e, size: span })
						} else {
							nextEntries.push({ ...e })
						}
					}
				}
				if (!matched) {
					nextEntries.unshift({ id: targetId, size: span })
				}
				// oxlint-disable-next-line eslint/no-await-in-loop -- effect choreography steps must execute strictly in sequence
				await grid
					.set(nextEntries, {
						duration: stepDur ?? 0.5,
						cover,
						keepGrid: true,
					})
					.catch(() => {})
				break
			}

			case 'reset': {
				// oxlint-disable-next-line eslint/no-await-in-loop -- effect choreography steps must execute strictly in sequence
				await grid._resetInternal(stepDur).catch(() => {})
				break
			}

			case 'back': {
				// oxlint-disable-next-line eslint/no-await-in-loop -- effect choreography steps must execute strictly in sequence
				await grid._backInternal(stepDur).catch(() => {})
				break
			}

			case 'switchToGrid': {
				switchToGrid(grid)
				break
			}

			case 'delay': {
				if (step.seconds > 0) {
					// oxlint-disable-next-line eslint/no-await-in-loop -- sequential choreography delay
					await sleep(step.seconds * 1000)
				}
				break
			}

			case 'fadeDuration': {
				if (Number.isFinite(step.seconds) && step.seconds >= 0) {
					grid._nextCrossFadeDuration = step.seconds
				}
				break
			}
		}
	}
}
