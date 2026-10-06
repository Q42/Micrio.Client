import { describe, expect, it } from 'vitest'
import { computeLighting, getPreset, getPresets, type LightingState } from '$book/rendering/lighting'

const length = (v: [number, number, number]): number => Math.hypot(v[0], v[1], v[2])
const sum = (c: [number, number, number]): number => c[0] + c[1] + c[2]

/** Builds the parameter object a preset is normally called with, from its defaults. */
function defaults(name: string): Record<string, number> {
	const preset = getPreset(name)
	const params: Record<string, number> = {}
	for (const param of preset?.params ?? []) {
		params[param.key] = param.default
	}
	return params
}

/** Every preset name, with its shipped defaults. */
const NAMES = getPresets().map((p) => p.name)

describe('lighting presets', () => {
	it('ships the documented preset list, each with valid defaults', () => {
		expect(NAMES).toEqual(['daylight', 'incandescent', 'candlelight', 'rainy day', 'moonlight', 'fireplace', 'haunted'])
		for (const preset of getPresets()) {
			expect(preset.params.length).toBeGreaterThan(0)
			for (const param of preset.params) {
				expect(Number.isFinite(param.default)).toBe(true)
			}
		}
	})

	it('only flags the ambient presets as animated', () => {
		expect(getPreset('daylight')?.isAnimated).toBe(false)
		expect(getPreset('incandescent')?.isAnimated).toBe(false)
		for (const name of ['candlelight', 'rainy day', 'moonlight', 'fireplace', 'haunted']) {
			expect(getPreset(name)?.isAnimated).toBe(true)
		}
	})

	it('returns undefined for an unknown preset name', () => {
		expect(getPreset('nope')).toBeUndefined()
	})
})

describe('computeLighting — every preset', () => {
	it('returns finite, non-negative values with correctly sized point-light arrays', () => {
		for (const name of NAMES) {
			const state = computeLighting(name, defaults(name), 1.5)
			expect(state._numPointLights).toBeGreaterThanOrEqual(0)
			expect(state._numPointLights).toBeLessThanOrEqual(8)
			expect(state._pointLightPos).toHaveLength(24)
			expect(state._pointLightColor).toHaveLength(24)
			expect(state._pointLightIntensity).toHaveLength(8)
			for (const c of [...state._lightColor, ...state._ambientColor, ...state._pointLightColor]) {
				expect(Number.isFinite(c)).toBe(true)
			}
			for (const n of state._pointLightIntensity) {
				expect(Number.isFinite(n)).toBe(true)
				expect(n).toBeGreaterThanOrEqual(0)
			}
			for (const v of state._lightDir) {
				expect(Number.isFinite(v)).toBe(true)
			}
			expect(state._bumpStrength).toBeGreaterThan(0)
		}
	})

	it('keeps daylight precisely inside the animatable time window', () => {
		// Midday: the sun sits high and the light is bright
		const noon = computeLighting('daylight', { timeOfDay: 12 }, 0)
		expect(noon._numPointLights).toBe(0)
		// The sun sits high but is pulled toward the fixed -0.35 z component
		expect(noon._lightDir[1]).toBeGreaterThan(0.9)
		expect(length(noon._lightDir)).toBeCloseTo(1, 6)
		expect(noon._lightColor[0]).toBeGreaterThan(0.8)

		// Night: the light dims toward the horizon, and the ambient with it
		const night = computeLighting('daylight', { timeOfDay: 2 }, 0)
		expect(night._lightColor[2]).toBeLessThan(noon._lightColor[2] + 1)
		expect(night._ambientColor[0]).toBeLessThan(noon._ambientColor[0])
	})

	it('does not depend on time for the two static presets', () => {
		const a = computeLighting('daylight', { timeOfDay: 6.5 }, 0)
		const b = computeLighting('daylight', { timeOfDay: 6.5 }, 1000)
		expect(a._lightDir).toEqual(b._lightDir)
		expect(a._lightColor).toEqual(b._lightColor)
	})

	it('flickers the animated presets without ever going negative', () => {
		for (const name of ['candlelight', 'fireplace']) {
			const params = defaults(name)
			const samples = Array.from({ length: 40 }, (_, i) => computeLighting(name, params, i * 0.37))
			const ints = samples.flatMap((s) => Array.from(s._pointLightIntensity)).filter((n) => n > 0)
			expect(ints.length).toBeGreaterThan(0)
			expect(Math.min(...ints)).toBeGreaterThan(0)
			// Two different times give two different intensities
			expect(samples[0]._pointLightIntensity[0]).not.toBe(samples[20]._pointLightIntensity[0])
		}

		// The presets whose *light colour* pulses rather than their point lights
		for (const name of ['haunted', 'rainy day', 'moonlight']) {
			const params = defaults(name)
			const samples = Array.from({ length: 40 }, (_, i) => computeLighting(name, params, i * 0.37))
			expect(samples[0]._lightColor).not.toEqual(samples[samples.length - 1]._lightColor)
		}
	})
})

describe('computeLighting — per-preset behaviour', () => {
	it('daylight rotates the sun with the time of day', () => {
		const morning = computeLighting('daylight', { timeOfDay: 6 }, 0)
		const evening = computeLighting('daylight', { timeOfDay: 18 }, 0)
		// At 6h and 18h the sun is at the horizon: the +0.05 y floor is all that
		// keeps the direction off the ground plane, and x is ±(the warm-side x)
		expect(morning._lightDir[1]).toBeCloseTo(0.0472, 3)
		expect(Math.sign(evening._lightDir[0])).toBe(-1)
		// It is on the +x side in the morning and the -x side in the afternoon
		expect(Math.sign(computeLighting('daylight', { timeOfDay: 8 }, 0)._lightDir[0])).toBe(1)
		expect(Math.sign(computeLighting('daylight', { timeOfDay: 15 }, 0)._lightDir[0])).toBe(-1)
		// At exactly noon it is straight overhead in x
		expect(computeLighting('daylight', { timeOfDay: 12 }, 0)._lightDir[0]).toBeCloseTo(0, 6)
		// The direction is normalized and never points straight down
		expect(morning._lightDir[1]).toBeGreaterThan(0)
	})

	it('daylight clamps out-of-range times instead of producing NaN', () => {
		for (const timeOfDay of [-100, 0, 24, 100]) {
			const state = computeLighting('daylight', { timeOfDay }, 0)
			expect(state._lightColor.every(Number.isFinite)).toBe(true)
			expect(state._ambientColor.every(Number.isFinite)).toBe(true)
			expect(length(state._lightDir)).toBeCloseTo(1, 6)
		}
	})

	it('falls back to midday for a missing time of day', () => {
		expect(computeLighting('daylight', {}, 0)._lightDir).toEqual(
			computeLighting('daylight', { timeOfDay: 12 }, 0)._lightDir,
		)
	})

	it('incandescent brightens and cools with wattage, never dividing by a zero vector', () => {
		const dim = computeLighting('incandescent', { wattage: 0 }, 0)
		const bright = computeLighting('incandescent', { wattage: 2 }, 0)
		// A brighter bulb means a brighter key light, but the ambient *loses* its
		// blue with wattage (it is the warmth term, not an intensity)
		expect(bright._lightColor[0]).toBeGreaterThan(dim._lightColor[0])
		expect(sum(bright._lightColor)).toBeGreaterThan(sum(dim._lightColor))
		// Its blue channel loses out as the bulb warms
		expect(bright._ambientColor[2]).toBeLessThan(dim._ambientColor[2])
		// The ambient stays warm at every setting: red above blue
		expect(dim._ambientColor[0]).toBeGreaterThan(dim._ambientColor[2])
		expect(bright._ambientColor[0]).toBeGreaterThan(bright._ambientColor[2])
		expect(length(dim._lightDir)).toBeCloseTo(1, 6)
	})

	it('incandescent falls back to the middle setting for a missing wattage', () => {
		expect(computeLighting('incandescent', {}, 0)._lightColor).toEqual(
			computeLighting('incandescent', { wattage: 1 }, 0)._lightColor,
		)
	})

	it('candlelight creates one point light per candle', () => {
		const two = computeLighting('candlelight', { candleCount: 2 }, 0)
		expect(two._numPointLights).toBe(2)
		expect(two._pointLightIntensity[2]).toBe(0)
		// A candle-only preset has no key light of its own
		expect(two._lightColor).toEqual([0, 0, 0])
		expect(length(two._lightDir)).toBeCloseTo(1, 6)
	})

	it('candlelight counts more candles than the shader has slots for', () => {
		// Only the first eight slots are ever written, but `_numPointLights` is the
		// raw candle count: the shader then reads past its declared MAX_POINT_LIGHTS
		// of 8. The renderer uploads the full 24-float buffers, so nothing throws —
		// the extra lights are silently wrong. Pinned as the current behaviour of a bug.
		const many = computeLighting('candlelight', { candleCount: 50 }, 0)
		expect(many._numPointLights).toBe(50)
		expect(Array.from(many._pointLightIntensity).filter((n) => n > 0)).toHaveLength(8)
	})

	it('candlelight defaults to its shipped parameters', () => {
		const fallback = computeLighting('candlelight', {}, 0.5)
		expect(fallback._numPointLights).toBe(4)
		expect(fallback._pointLightIntensity[3]).toBeGreaterThan(0)
		expect(fallback._pointLightIntensity[4]).toBe(0)
	})

	it('rainy day dims according to the storm level', () => {
		const drizzle = computeLighting('rainy day', { stormLevel: 0 }, 0)
		const downpour = computeLighting('rainy day', { stormLevel: 2 }, 0)
		expect(downpour._ambientColor[0]).toBeLessThan(drizzle._ambientColor[0])
		expect(length(drizzle._lightDir)).toBeCloseTo(1, 6)
	})

	it('moonlight dims according to the moon phase', () => {
		const full = computeLighting('moonlight', { moonPhase: 0 }, 0)
		const crescent = computeLighting('moonlight', { moonPhase: 2 }, 0)
		expect(full._lightColor[2]).toBeGreaterThan(crescent._lightColor[2])
		expect(crescent._lightColor[2]).toBeGreaterThan(0)
	})

	it('fireplace places exactly two flickering fires', () => {
		const fire = computeLighting('fireplace', {}, 0)
		expect(fire._numPointLights).toBe(2)
		// The two fires sit on opposite sides, warm red
		expect(fire._pointLightPos[0]).toBeLessThan(0)
		expect(fire._pointLightPos[3]).toBeGreaterThan(0)
		expect(fire._pointLightColor[0]).toBe(1)
		expect(fire._pointLightIntensity[0]).toBeGreaterThan(0)
		expect(fire._pointLightIntensity[1]).toBeGreaterThan(0)
		// A smaller intensity parameter dims both
		const low = computeLighting('fireplace', { fireIntensity: 0.1 }, 0)
		expect(low._pointLightIntensity[0]).toBeLessThan(fire._pointLightIntensity[0])
	})

	it('haunted keeps a green-cast light whose colour pulses', () => {
		const a = computeLighting('haunted', { spookiness: 1 }, 0)
		const b = computeLighting('haunted', { spookiness: 1 }, 5)
		expect(a._lightColor[1]).toBeGreaterThan(a._lightColor[0])
		expect(a._lightColor).not.toEqual(b._lightColor)
		expect(length(a._lightDir)).toBeCloseTo(1, 6)
	})

	it('returns the neutral fallback for an unknown preset', () => {
		const state = computeLighting('does-not-exist', {}, 0)
		expect(state._numPointLights).toBe(0)
		expect(state._lightDir).toEqual([0, 1, 0])
		expect(state._lightColor).toEqual([1, 1, 1])
		expect(state._bumpStrength).toBeCloseTo(0.4, 6)
	})
})

describe('computeLighting — output shape', () => {
	it('gives every call its own buffers, so a later preset cannot write into an earlier state', () => {
		const first: LightingState = computeLighting('candlelight', { candleCount: 3 }, 0)
		const before = Array.from(first._pointLightIntensity)
		computeLighting('fireplace', {}, 0)
		expect(Array.from(first._pointLightIntensity)).toEqual(before)
		expect(first._pointLightPos).not.toBe(computeLighting('candlelight', { candleCount: 3 }, 0)._pointLightPos)
	})

	it('never writes a point light beyond the eight slots the shader declares', () => {
		const state = computeLighting('candlelight', { candleCount: 8 }, 0)
		expect(state._pointLightPos.slice(24)).toHaveLength(0)
		expect(state._pointLightIntensity).toHaveLength(8)
	})
})
