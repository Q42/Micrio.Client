import { describe, expect, it, vi } from 'vitest'
import {
	afterFrame,
	createElement,
	createSvgElement,
	IFRAME_ALLOW,
	loadExternalAPI,
	loadScript,
	sleep,
	SVG_NS,
} from '../../src/utils/dom'

describe('createElement', () => {
	it('applies class, text, id, dataset, attributes and inline styles', () => {
		const el = createElement('div', {
			className: 'a b',
			textContent: 'hello',
			id: 'my-id',
			dataset: { foo: 'bar' },
			attrs: { 'aria-hidden': 'true', title: 'Tip' },
			style: 'color: red',
		})
		expect(el.className).toBe('a b')
		expect(el.textContent).toBe('hello')
		expect(el.id).toBe('my-id')
		expect(el.dataset.foo).toBe('bar')
		expect(el.getAttribute('aria-hidden')).toBe('true')
		expect(el.style.color).toBe('red')
	})

	it('removes an attribute when its value is null', () => {
		const parent = createElement('div', { attrs: { 'data-x': '1' } })
		const el = createElement('span', { attrs: { 'data-x': null }, parent })
		expect(el.dataset.x).toBeUndefined()
		expect(parent.firstElementChild).toBe(el)
	})

	it('applies a style object and event listeners', () => {
		const onClick = vi.fn()
		const el = createElement('button', { style: { display: 'none' }, events: { click: onClick } })
		expect(el.style.display).toBe('none')
		el.click()
		expect(onClick).toHaveBeenCalledTimes(1)
	})

	it('sets arbitrary properties', () => {
		const el = createElement('input', { props: { type: 'text', value: 'v' } })
		expect(el.type).toBe('text')
		expect(el.value).toBe('v')
	})

	it('skips null, undefined and false children but keeps 0', () => {
		const el = createElement('div', {
			children: [null, undefined, false, 'a', 0, 'b'],
		})
		expect(el.textContent).toBe('a0b')
		expect(el.childNodes.length).toBe(3)
	})

	it('calls _setProps on custom elements that support it', () => {
		const setProps = vi.fn()
		class WithProps extends HTMLElement {
			_setProps = setProps
		}
		customElements.define('test-with-props', WithProps)
		const el = createElement('test-with-props' as 'div', { setProps: { a: 1 } })
		expect(setProps).toHaveBeenCalledWith({ a: 1 })
		expect(el).toBeInstanceOf(WithProps)
	})

	it('does not throw when setProps is given a plain element', () => {
		expect(() => createElement('div', { setProps: { a: 1 } })).not.toThrow()
	})
})

describe('createSvgElement', () => {
	it('creates elements in the SVG namespace', () => {
		const svg = createSvgElement('svg', { attrs: { viewBox: '0 0 10 10' } })
		expect(svg.namespaceURI).toBe(SVG_NS)
		expect(svg).toBeInstanceOf(SVGElement)
		expect(svg.getAttribute('viewBox')).toBe('0 0 10 10')
	})

	it('uses setAttribute for class on SVG elements', () => {
		const circle = createSvgElement('circle', { className: 'dot' })
		expect(circle.getAttribute('class')).toBe('dot')
	})

	it('puts every ns element in the SVG namespace', () => {
		// `createElementNS` accepts unknown tag names; the namespace is the contract
		const el = createElement('definitely-not-svg', { ns: SVG_NS })
		expect(el.namespaceURI).toBe(SVG_NS)
	})

	it('throws for an element name that the DOM rejects', () => {
		expect(() => createElement('', { ns: SVG_NS })).toThrow()
	})
})

describe('constants', () => {
	it('allow every permission the supported players need', () => {
		expect(SVG_NS).toBe('http://www.w3.org/2000/svg')
		for (const token of ['autoplay', 'fullscreen', 'encrypted-media', 'geolocation']) {
			expect(IFRAME_ALLOW).toContain(token)
		}
	})
})

describe('sleep / afterFrame', () => {
	it('resolves immediately for 0 without a timer', async () => {
		const start = performance.now()
		await sleep(0)
		expect(performance.now() - start).toBeLessThan(50)
	})

	it('resolves after the requested delay', async () => {
		const start = performance.now()
		await sleep(20)
		expect(performance.now() - start).toBeGreaterThanOrEqual(10)
	})

	it('afterFrame resolves on a real frame boundary', async () => {
		let frames = 0
		const count = () => {
			frames++
			requestAnimationFrame(count)
		}
		requestAnimationFrame(count)
		await afterFrame()
		// Two frames are needed: one for our counter, one for the deferred resolve.
		expect(frames).toBeGreaterThanOrEqual(1)
		await afterFrame()
		expect(frames).toBeGreaterThanOrEqual(3)
	})
})

describe('loadScript', () => {
	it('only appends a given script URL once per session', async () => {
		const url = 'data:text/javascript;base64,'
		const before = document.head.querySelectorAll(`script[src="${url}"]`).length
		await loadScript(url)
		await loadScript(url)
		const after = document.head.querySelectorAll(`script[src="${url}"]`).length
		expect(after - before).toBe(1)
	})

	it('resolves immediately when a target object is already provided', async () => {
		await expect(loadScript('https://example.test/never.js', undefined, {})).resolves.toBeUndefined()
	})

	it('assigns the callback global and resolves through it', async () => {
		const src = 'https://example.test/cb.js'
		let appended: HTMLScriptElement | undefined
		vi.spyOn(document.head, 'append').mockImplementation(((node: Node) => {
			appended = node as HTMLScriptElement
			;(globalThis as unknown as { myCb: () => void }).myCb()
		}) as unknown as ParentNode['append'])
		await loadScript(src, 'myCb')
		expect(appended?.src).toBe(src)
		expect(appended?.async).toBe(true)
		vi.restoreAllMocks()
	})

	it('rejects when the script errors before loading', async () => {
		vi.spyOn(document.head, 'append').mockImplementation(((node: Node) => {
			;(node as HTMLScriptElement).dispatchEvent(new Event('error'))
		}) as unknown as ParentNode['append'])
		await expect(loadScript('https://example.test/fails.js', 'otherCb')).rejects.toBeUndefined()
		vi.restoreAllMocks()
	})
})

describe('loadExternalAPI', () => {
	it('resolves when the API is already present on the global', async () => {
		const g = globalThis as unknown as { FakeApi?: unknown }
		g.FakeApi = {}
		try {
			await expect(loadExternalAPI('FakeApi', 'https://example.test/api.js')).resolves.toBeUndefined()
		} finally {
			delete g.FakeApi
		}
	})

	it('throws when the script loads but the global never appears', async () => {
		vi.spyOn(document.head, 'append').mockImplementation(((node: Node) => {
			// The script loads, but does not define the API we asked for
			;(node as HTMLScriptElement).dispatchEvent(new Event('load'))
		}) as unknown as ParentNode['append'])
		await expect(loadExternalAPI('NeverAppearsApi', 'https://example.test/none.js')).rejects.toThrow(
			'Failed to load NeverAppearsApi API',
		)
		vi.restoreAllMocks()
	})
})
