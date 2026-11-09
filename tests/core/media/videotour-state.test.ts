import { describe, expect, it } from 'vitest'
import { reduceVideoTour, videoTourInitial, type VideoTourContext, type VideoTourState } from '$media/videotour-state'

const context: VideoTourContext = { duration: 10 }
const send = (state: VideoTourState, event: Parameters<typeof reduceVideoTour>[1]): VideoTourState =>
	reduceVideoTour(state, event, context) as VideoTourState

describe('reduceVideoTour', () => {
	it('starts, pauses and resumes one clock', () => {
		const playing = send(videoTourInitial, { type: 'play', now: 1000 })
		expect(playing.phase).toBe('playing')
		expect(playing.startedAt).toBe(1000)
		const paused = send(playing, { type: 'pause', now: 3000 })
		expect(paused.phase).toBe('paused')
		expect(paused.pausedAt).toBe(2000)
		const resumed = send(paused, { type: 'play', now: 5000 })
		expect(resumed.phase).toBe('playing')
		expect(resumed.startedAt).toBe(3000)
		expect(resumed.pausedAt).toBe(0)
	})

	it('seeks while paused and while playing without two clocks', () => {
		const pausedSeek = send(videoTourInitial, { type: 'seek', ms: 4000, now: 1000, resume: false })
		expect(pausedSeek.phase).toBe('paused')
		expect(pausedSeek.pausedAt).toBe(4000)
		expect(pausedSeek.startedAt).toBe(0)
		const playingSeek = send(videoTourInitial, { type: 'seek', ms: 4000, now: 1000, resume: true })
		expect(playingSeek.phase).toBe('playing')
		expect(playingSeek.startedAt).toBe(-3000)
		expect(playingSeek.pausedAt).toBe(0)
	})

	it('ends at the duration and rewinds for a replay', () => {
		const ended = send(videoTourInitial, { type: 'seek', ms: 10_000, now: 1, resume: true })
		expect(ended.phase).toBe('ended')
		const replayed = send(ended, { type: 'play', now: 2000 })
		expect(replayed.phase).toBe('playing')
		expect(replayed.segment).toBe(-1)
		expect(replayed.pausedAt).toBe(0)
	})

	it('ignores a repeated play and records the segment', () => {
		const playing = send(videoTourInitial, { type: 'play', now: 1 })
		expect(reduceVideoTour(playing, { type: 'play', now: 2 }, context)).toBeNull()
		expect(send(playing, { type: 'segment', index: 2 }).segment).toBe(2)
	})
})
