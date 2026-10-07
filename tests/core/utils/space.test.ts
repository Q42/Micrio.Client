import { describe, expect, it } from 'vitest'
import { getSpaceVector } from '$utils/space'

/** Builds the minimal `micrio` surface `getSpaceVector` reads. */
function stubMicrio(
	currentId: string | undefined,
	images: { id: string; x?: number; y?: number; z?: number }[] | undefined,
) {
	return {
		$current: currentId === undefined ? undefined : { id: currentId },
		spaceData: images === undefined ? undefined : { images },
	} as unknown as Parameters<typeof getSpaceVector>[0]
}

describe('getSpaceVector', () => {
	it('returns undefined when there is no current image or no space data', () => {
		expect(getSpaceVector(stubMicrio(undefined, [{ id: 'a' }]), 'b')).toBeUndefined()
		// No `spaceData` at all: the target cannot be found either
		expect(getSpaceVector(stubMicrio('a', []), 'b')).toBeUndefined()
	})

	it('returns undefined when either endpoint is not in the space', () => {
		expect(getSpaceVector(stubMicrio('a', [{ id: 'a' }, { id: 'c' }]), 'b')).toBeUndefined()
		expect(getSpaceVector(stubMicrio('c', [{ id: 'a' }, { id: 'b' }]), 'b')).toBeUndefined()
	})

	it('computes the difference vector with an inverted Y axis', () => {
		const micrio = stubMicrio('a', [
			{ id: 'a', x: 0.25, y: 0.75, z: 0.5 },
			{ id: 'b', x: 0.75, y: 0.25, z: 0.5 },
		])
		const { v, vN } = getSpaceVector(micrio, 'b') ?? {}
		expect(v).not.toBeUndefined()
		expect(v?.[0]).toBeCloseTo(0.5, 12)
		expect(v?.[1]).toBeCloseTo(0.5, 12) // source.y - target.y, not target - source
		expect(v?.[2]).toBeCloseTo(0, 12)

		const len = Math.hypot(vN?.[0] ?? 0, vN?.[1] ?? 0, vN?.[2] ?? 0)
		expect(len).toBeCloseTo(1, 12)
	})

	it('defaults missing coordinates to the center 0.5', () => {
		const micrio = stubMicrio('a', [{ id: 'a' }, { id: 'b' }])
		const { v } = getSpaceVector(micrio, 'b') ?? {}
		expect(v).toEqual([0, 0, 0])
	})

	it('clamps the horizontal distance factor to 0.4', () => {
		const far = stubMicrio('a', [
			{ id: 'a', x: 0, y: 0.5, z: 0 },
			{ id: 'b', x: 1, y: 0.5, z: 1 },
		])
		const result = getSpaceVector(far, 'b')
		expect(result?.vector.distanceX).toBeCloseTo(0.4, 12)
		expect(result?.vector.distanceX).toBeLessThanOrEqual(0.4)
	})

	it('reports the vertical distance inverted and the yaw in [0,1)', () => {
		const micrio = stubMicrio('a', [
			{ id: 'a', x: 0.5, y: 0.9, z: 0.5 },
			{ id: 'b', x: 0.5, y: 0.1, z: 0.5 },
		])
		const result = getSpaceVector(micrio, 'b')
		expect(result).not.toBeUndefined()
		// Moving towards a lower y in the space is an upwards camera move: distanceY
		// is the inverted raw delta, so it is negative here.
		expect(result?.v[1]).toBeCloseTo(0.8, 12)
		expect(result?.vector.distanceY).toBeCloseTo(-0.8, 12)
		expect(result?.vector.distanceY).toBeLessThan(0)
		// Pure vertical move: no horizontal component, so the yaw stays 0
		expect(result?.vector.distanceX).toBe(0)
		expect(result?.vector.direction).toBe(0)
		expect(result?.directionX).toBe(0)
		expect(result?.vector.direction).toBeGreaterThanOrEqual(0)
		expect(result?.vector.direction).toBeLessThan(1)
	})

	it('detects a pure vertical move as zero horizontal distance', () => {
		const micrio = stubMicrio('a', [
			{ id: 'a', x: 0.5, y: 0.2, z: 0.5 },
			{ id: 'b', x: 0.5, y: 0.8, z: 0.5 },
		])
		const result = getSpaceVector(micrio, 'b')
		expect(result?.vector.distanceX).toBe(0)
	})
})
