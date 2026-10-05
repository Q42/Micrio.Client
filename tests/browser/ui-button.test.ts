import { describe, expect, it, vi } from 'vitest'
import { createElement } from '../../src/utils/dom'
import type { MicrioElement } from '../../src/core/component'

/**
 * `micrio-button` is the most reused component in the client — every toolbar entry, media
 * control, popover action and marker button is one — so its contract is asserted directly
 * rather than only through whichever feature happens to use it.
 *
 * It renders a `<button>` (or an `<a>` when given `href`) inside itself and re-renders on
 * a change key, so the assertions are on that inner element plus the host's own classes.
 */

/** Mounts a button with the given props and returns the host plus its inner element. */
function makeButton(props: Record<string, unknown> = {}) {
	const el = createElement('micrio-button') as MicrioElement
	document.body.append(el)
	el._setProps(props)
	const inner = el.querySelector<HTMLElement>('button, a')
	if (!inner) {
		throw new Error('button did not render an inner element')
	}
	return { el, inner }
}

/** The icon element inside a rendered button. */
const icon = (el: Element) => el.querySelector('micrio-icon')

describe('micrio-button rendering', () => {
	it('renders a real button with the title as both title and label', () => {
		const { el, inner } = makeButton({ type: 'close', title: 'Close it' })
		expect(inner.tagName).toBe('BUTTON')
		expect(inner.getAttribute('title')).toBe('Close it')
		// The accessible name has to match the tooltip, not just exist
		expect(inner.getAttribute('aria-label')).toBe('Close it')
		el.remove()
	})

	it('renders an anchor when given an href', () => {
		const { el, inner } = makeButton({ href: 'https://example.test/x', title: 'Go' })
		expect(inner.tagName).toBe('A')
		expect(inner.getAttribute('href')).toBe('https://example.test/x')
		// Without blankTarget it must not open a new window
		expect(inner.getAttribute('target')).toBeNull()
		el.remove()
	})

	it('opens a new tab only when asked', () => {
		const { el, inner } = makeButton({ href: 'https://example.test/x', blankTarget: true })
		expect(inner.getAttribute('target')).toBe('_blank')
		el.remove()
	})

	it('uses the type as a class on the host and renders its icon', () => {
		const { el, inner } = makeButton({ type: 'play' })
		expect(el.classList.contains('play')).toBe(true)
		// The icon resolves its name to an inline SVG; there is no name attribute
		expect(icon(inner)?.querySelector('svg')).not.toBeNull()
		el.remove()
	})

	it('swaps the type class when the type changes', () => {
		const { el } = makeButton({ type: 'play' })
		el._setProps({ type: 'pause' })
		expect(el.classList.contains('pause')).toBe(true)
		expect(el.classList.contains('play')).toBe(false)
		el.remove()
	})

	it('renders a custom asset as an image', () => {
		const { el, inner } = makeButton({
			icon: { src: 'https://example.test/icon.png', title: 'i' } as never,
		})
		const img = inner.querySelector('img')
		expect(img?.getAttribute('src')).toBe('https://example.test/icon.png')
		expect(img?.getAttribute('alt')).toBe('Icon')
		expect(icon(inner)).toBeNull()
		el.remove()
	})

	it('keeps a text child as a span', () => {
		// This is how callers pass a label: a text child on the host, alongside the props
		const el = createElement('micrio-button', {
			children: ['Free exploration'],
			setProps: { type: 'close' },
			parent: document.body,
		}) as MicrioElement
		expect(el.querySelector('button > span')?.textContent).toBe('Free exploration')
		el.remove()
	})

	it('drops whitespace-only text', () => {
		const el = createElement('micrio-button', {
			children: ['   \n  '],
			setProps: { type: 'close' },
			parent: document.body,
		}) as MicrioElement
		expect(el.querySelector('button > span')).toBeNull()
		el.remove()
	})

	it('adds the active and no-click classes', () => {
		const { el } = makeButton({ type: 'play', active: true, noClick: true })
		const inner = el.querySelector('button')
		expect(inner?.classList.contains('active')).toBe(true)
		expect(inner?.classList.contains('no-click')).toBe(true)
		el.remove()
	})

	it('applies an extra class name alongside the state classes', () => {
		const { el } = makeButton({ type: 'play', active: true, className: 'custom' })
		const inner = el.querySelector('button')
		expect(inner?.classList.contains('custom')).toBe(true)
		expect(inner?.classList.contains('active')).toBe(true)
		el.remove()
	})
})

describe('micrio-button state', () => {
	it('disables a button but never an anchor', () => {
		const button = makeButton({ type: 'play', disabled: true })
		expect(button.inner.hasAttribute('disabled')).toBe(true)
		button.el.remove()

		const link = makeButton({ href: 'https://example.test/x', disabled: true })
		expect(link.inner.hasAttribute('disabled')).toBe(false)
		link.el.remove()
	})

	it('leaves a button enabled by default', () => {
		const { el, inner } = makeButton({ type: 'play' })
		expect(inner.hasAttribute('disabled')).toBe(false)
		el.remove()
	})
})

describe('micrio-button events', () => {
	it('forwards click, focus and pointerdown', () => {
		const onclick = vi.fn()
		const onfocus = vi.fn()
		const onpointerdown = vi.fn()
		const { el, inner } = makeButton({ type: 'play', onclick, onfocus, onpointerdown })

		inner.dispatchEvent(new MouseEvent('click'))
		inner.dispatchEvent(new FocusEvent('focus'))
		inner.dispatchEvent(new PointerEvent('pointerdown'))

		expect(onclick).toHaveBeenCalledTimes(1)
		expect(onfocus).toHaveBeenCalledTimes(1)
		expect(onpointerdown).toHaveBeenCalledTimes(1)
		// The pointer handler is narrowed to a real PointerEvent
		expect(onpointerdown.mock.calls[0]?.[0]).toBeInstanceOf(PointerEvent)
		el.remove()
	})

	it('attaches only the handlers it was given', () => {
		const { el, inner } = makeButton({ type: 'play' })
		// Nothing to assert but that dispatching is harmless
		expect(() => {
			inner.dispatchEvent(new MouseEvent('click'))
			inner.dispatchEvent(new PointerEvent('pointerdown'))
		}).not.toThrow()
		el.remove()
	})
})

describe('micrio-button re-render guard', () => {
	it('reuses the inner element when nothing meaningful changed', () => {
		const { el, inner } = makeButton({ type: 'play', title: 'Play' })
		el._setProps({ title: 'Play' })
		// The change key is unchanged, so the same node stays in place
		expect(el.querySelector('button')).toBe(inner)
		el.remove()
	})

	it('rebuilds when the title changes', () => {
		const { el, inner } = makeButton({ type: 'play', title: 'Play' })
		el._setProps({ title: 'Pause' })
		const rebuilt = el.querySelector('button')
		expect(rebuilt).not.toBe(inner)
		expect(rebuilt?.getAttribute('title')).toBe('Pause')
		// The old node is detached rather than left behind
		expect(el.querySelectorAll('button')).toHaveLength(1)
		el.remove()
	})
})

describe('micrio-button teardown', () => {
	it('survives removal from the document', () => {
		const { el } = makeButton({ type: 'play' })
		expect(() => {
			el.remove()
		}).not.toThrow()
		expect(el.isConnected).toBe(false)
	})
})
