import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IdleState } from '../../src/utils/idle'

let el: HTMLElement

beforeEach(() => {
	vi.useFakeTimers()
	el = document.createElement('div')
	document.body.append(el)
})

afterEach(() => {
	vi.useRealTimers()
	el.remove()
})

const isIdle = () => el.hasAttribute('data-idle')

describe('IdleState', () => {
	it('starts active and goes idle after the delay', () => {
		const onIdle = vi.fn()
		const state = new IdleState(el, { delay: 100, onIdle })
		state.activity()
		expect(isIdle()).toBe(false)
		vi.advanceTimersByTime(99)
		expect(isIdle()).toBe(false)
		vi.advanceTimersByTime(1)
		expect(isIdle()).toBe(true)
		expect(onIdle).toHaveBeenCalledTimes(1)
		state.destroy()
	})

	it('activity() clears idle and re-arms the timer', () => {
		const onActive = vi.fn()
		const state = new IdleState(el, { delay: 100, onActive })
		state.activity()
		vi.advanceTimersByTime(100)
		expect(isIdle()).toBe(true)
		state.activity()
		expect(isIdle()).toBe(false)
		expect(onActive).toHaveBeenCalledTimes(1)
		// Re-armed: one further delay brings it back to idle
		vi.advanceTimersByTime(100)
		expect(isIdle()).toBe(true)
		state.destroy()
	})

	it('does not fire onActive when already active', () => {
		const onActive = vi.fn()
		const state = new IdleState(el, { delay: 100, onActive })
		state.activity()
		state.activity()
		expect(onActive).not.toHaveBeenCalled()
		state.destroy()
	})

	it('postpones idle while shouldIdle() returns false, then idles later', () => {
		let allow = false
		const onIdle = vi.fn()
		const state = new IdleState(el, { delay: 50, onIdle, shouldIdle: () => allow })
		state.activity()
		vi.advanceTimersByTime(50)
		expect(isIdle()).toBe(false)
		vi.advanceTimersByTime(50)
		expect(isIdle()).toBe(false)
		allow = true
		vi.advanceTimersByTime(50)
		expect(isIdle()).toBe(true)
		expect(onIdle).toHaveBeenCalledTimes(1)
		state.destroy()
	})

	it('hide() idles immediately and pauses the timer', () => {
		const onIdle = vi.fn()
		const state = new IdleState(el, { delay: 100, onIdle })
		state.hide()
		expect(isIdle()).toBe(true)
		expect(onIdle).toHaveBeenCalledTimes(1)
		// Paused: advancing time does not fire again
		vi.advanceTimersByTime(500)
		expect(onIdle).toHaveBeenCalledTimes(1)
	})

	it('show() only acts when currently idle', () => {
		const onActive = vi.fn()
		const state = new IdleState(el, { delay: 100, onActive })
		state.show()
		expect(onActive).not.toHaveBeenCalled()
		state.hide()
		state.show()
		expect(isIdle()).toBe(false)
		expect(onActive).toHaveBeenCalledTimes(1)
		state.destroy()
	})

	it('disabling suppresses the timer and re-enabling resumes it', () => {
		const state = new IdleState(el, { delay: 100 })
		state.activity()
		state.enabled = false
		vi.advanceTimersByTime(500)
		expect(isIdle()).toBe(false)
		expect(state.enabled).toBe(false)

		state.enabled = true
		state.resume()
		vi.advanceTimersByTime(100)
		expect(isIdle()).toBe(true)
		state.destroy()
	})

	it('pause() stops the pending timer without changing the state', () => {
		const state = new IdleState(el, { delay: 100 })
		state.activity()
		state.pause()
		vi.advanceTimersByTime(500)
		expect(isIdle()).toBe(false)
		state.destroy()
	})

	it('destroy() leaves no pending timers', () => {
		const onIdle = vi.fn()
		const state = new IdleState(el, { delay: 100, onIdle })
		state.activity()
		state.destroy()
		vi.advanceTimersByTime(1000)
		expect(onIdle).not.toHaveBeenCalled()
		expect(isIdle()).toBe(false)
	})

	it('uses a default delay of 4000ms', () => {
		const state = new IdleState(el)
		state.activity()
		vi.advanceTimersByTime(3999)
		expect(isIdle()).toBe(false)
		vi.advanceTimersByTime(1)
		expect(isIdle()).toBe(true)
		state.destroy()
	})
})
