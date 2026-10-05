/**
 * Offline network interception for the browser suite.
 *
 * Only `fetch` is patched. Everything Micrio fetches on the main thread
 * (`bundle.json`, IIIF manifests, styles, scripts) flows through `fetchJson`,
 * so fixtures can be served without touching the real viewer API.
 *
 * Texture tiles are decoded inside a dedicated Web Worker
 * (`src/render/textures.ts`), where this patch does not apply — the default
 * suite therefore asserts nothing about pixels, only about data and DOM. The
 * `live/` suite is the place where real tiles are loaded.
 */

type Responder = (url: string) => Response | undefined

interface Route {
	test: RegExp
	respond: Responder
}

let restore: (() => void) | undefined

/** Every URL the patched `fetch` has been asked for since the last `mockFetch`. */
export const requested: string[] = []

/** The original `fetch`, captured lazily so a test may patch before any call. */
let original: typeof fetch | undefined

function originalFetch(): typeof fetch {
	original ??= globalThis.fetch.bind(globalThis)
	return original
}

/** Installs a `fetch` that only answers the given routes; everything else is a 404. */
export function mockFetch(routes: { match: RegExp; json?: unknown; status?: number }[]): void {
	const mapped: Route[] = routes.map((r) => ({
		test: r.match,
		respond: () => {
			const status = r.status ?? 200
			const body = JSON.stringify(r.json ?? {})
			return new Response(status === 200 ? body : JSON.stringify({ error: 'not found' }), {
				status,
				headers: { 'content-type': 'application/json' },
			})
		},
	}))
	install(mapped)
}

/** Installs a `fetch` that answers with a fixed JSON body for any URL matching `match`. */
export function mockJson(match: RegExp, json: unknown, status = 200): void {
	mockFetch([{ match, json, status }])
}

function install(routes: Route[]): void {
	const base = originalFetch()
	restore?.()
	requested.length = 0
	const patched: typeof fetch = (input) => {
		let url: string
		if (typeof input === 'string') {
			url = input
		} else if (input instanceof URL) {
			url = input.href
		} else {
			const { url: requestUrl } = input
			url = requestUrl
		}
		requested.push(url)
		for (const route of routes) {
			if (route.test.test(url)) {
				const response = route.respond(url)
				if (response) {
					return Promise.resolve(response)
				}
			}
		}
		return Promise.resolve(
			new Response(JSON.stringify({ error: `unmocked: ${url}` }), {
				status: 404,
				headers: { 'content-type': 'application/json' },
			}),
		)
	}
	globalThis.fetch = patched
	restore = () => {
		globalThis.fetch = base
		restore = undefined
	}
}

/** Restores the original `fetch`. Safe to call when nothing is patched. */
export function restoreNetwork(): void {
	restore?.()
}

/** Convenience matcher for a `bundle.json` request for one image id. */
export const bundleUrl = (id: string) => new RegExp(`/bundle\\.json\\?v=[^&]*$|/${id}/bundle\\.json`)
