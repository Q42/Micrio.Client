import { describe, expect, it } from 'vitest'
import { audioInitial, reduceAudio } from '$audio/audio-state'

describe('reduceAudio', () => {
	it('unlocks after a successful probe', () => {
		const probing = reduceAudio(audioInitial, { type: 'probe' })
		expect(probing?.phase).toBe('probing')
		expect(reduceAudio({ phase: 'probing' }, { type: 'probe-ok' })?.phase).toBe('unlocked')
	})

	it('blocks a refused probe and recovers on a gesture', () => {
		expect(reduceAudio({ phase: 'probing' }, { type: 'probe-blocked' })?.phase).toBe('blocked')
		expect(reduceAudio({ phase: 'blocked' }, { type: 'gesture' })?.phase).toBe('unlocked')
	})
})
