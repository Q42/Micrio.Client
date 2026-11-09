import { describe, expect, it } from 'vitest'
import { mediaInitial, reduceMedia, type MediaState } from '$media/media-state'

const initial = (): MediaState => mediaInitial('element', false)

describe('reduceMedia', () => {
	it('turns a paused element into ready without claiming playback', () => {
		const next = reduceMedia(initial(), {
			type: 'sync',
			currentTime: 0,
			duration: 12,
			paused: true,
			seeking: false,
			ended: false,
			muted: false,
		})
		expect(next?.phase).toBe('ready')
		expect(next?.duration).toBe(12)
	})

	it('follows play, pause and seek transitions', () => {
		let state = reduceMedia(initial(), { type: 'play' })
		expect(state?.phase).toBe('playing')
		state = reduceMedia(state as MediaState, { type: 'seeking' })
		expect(state?.phase).toBe('seeking')
		state = reduceMedia(state as MediaState, { type: 'seeked' })
		expect(state?.phase).toBe('playing')
		state = reduceMedia(state as MediaState, { type: 'pause' })
		expect(state?.phase).toBe('paused')
	})

	it('does not leave a paused seek in seeking', () => {
		const paused = reduceMedia(initial(), { type: 'pause' })
		expect(paused).toBeNull()
		expect(reduceMedia(initial(), { type: 'seeking' })).toBeNull()
	})

	it('treats a replay from ended as playing again', () => {
		const ended = reduceMedia(initial(), { type: 'ended' })
		expect(ended?.phase).toBe('ended')
		const replayed = reduceMedia(ended as MediaState, { type: 'play' })
		expect(replayed?.phase).toBe('playing')
	})

	it('keeps a blocked element blocked while it reports paused', () => {
		const blocked = reduceMedia(initial(), { type: 'blocked' })
		const synced = reduceMedia(blocked as MediaState, {
			type: 'sync',
			currentTime: 0,
			duration: 0,
			paused: true,
			seeking: false,
			ended: false,
			muted: false,
		})
		expect(synced?.phase).toBe('blocked')
	})

	it('updates the clock without changing the phase on a time event', () => {
		const playing = reduceMedia(initial(), { type: 'play' }) as MediaState
		const next = reduceMedia(playing, { type: 'time', currentTime: 4.5, duration: 20 })
		expect(next?.phase).toBe('playing')
		expect(next?.currentTime).toBe(4.5)
		expect(next?.duration).toBe(20)
	})

	it('ignores repeated ended and blocked events', () => {
		const ended = reduceMedia(initial(), { type: 'ended' }) as MediaState
		expect(reduceMedia(ended, { type: 'ended' })).toBeNull()
		const blocked = reduceMedia(initial(), { type: 'blocked' }) as MediaState
		expect(reduceMedia(blocked, { type: 'blocked' })).toBeNull()
	})
})
