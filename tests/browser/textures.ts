/**
 * A deterministic stand-in for the texture decoding worker.
 *
 * `src/render/textures.ts` bootstraps its worker at module load and resolves every
 * tile by fetching it inside that worker, where `tests/helpers/network.ts` cannot
 * intercept it. Offline, each tile therefore came back as a JSON 404 body,
 * `createImageBitmap` refused to decode it and the page logged
 * `[Micrio Texture] Error loading …` for every tile of every test.
 *
 * This module replaces that worker with one that resolves each requested URL to a
 * tiny real image, so tiles load instantly, every frame has actual texture data,
 * and the console stays clean. It is installed before `src/main` is imported (see
 * `installTextureWorker`) because the worker URL is created at module load.
 *
 * To assert on *requested* tile URLs, keep using `requested` from
 * `helpers/network.ts` — the fake worker answers the URLs the engine asks for.
 */

/** A 4x4 opaque red square, encoded once as a real WebP image. */
let textureBlobPromise: Promise<Blob> | undefined

async function textureBlob(): Promise<Blob> {
	textureBlobPromise ??= (async () => {
		const canvas = new OffscreenCanvas(4, 4)
		const ctx = canvas.getContext('2d')
		if (ctx) {
			ctx.fillStyle = '#e8452c'
			ctx.fillRect(0, 0, 4, 4)
		}
		return await canvas.convertToBlob({ type: 'image/webp' })
	})()
	return await textureBlobPromise
}

/** The `blob:` URL the fake worker "downloads" from; the only URL it recognises. */
const TEXTURE_URL = 'blob:micrio-test-texture'

/** Messages the engine sends to / receives from a texture worker. */
interface TextureRequest {
	src?: string
	type?: string
}

/** The fake worker: answers every tile request with the same decoded bitmap. */
class FakeTextureWorker extends EventTarget {
	static readonly instances: FakeTextureWorker[] = []

	#listeners: ((event: MessageEvent) => void)[] = []

	constructor() {
		super()
		FakeTextureWorker.instances.push(this)
	}

	addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
		if (type === 'message' && typeof listener === 'function') {
			this.#listeners.push(listener as (event: MessageEvent) => void)
		}
		super.addEventListener(type, listener)
	}

	postMessage(message: unknown): void {
		// `'abort'` cancels an in-flight tile; there is nothing to cancel here.
		if (typeof message === 'string') {
			return
		}
		const request = message as TextureRequest
		void textureBlob().then(async (blob) => {
			const bitmap = await createImageBitmap(blob)
			for (const listener of this.#listeners) {
				listener({ data: { data: bitmap, src: request.src } } as MessageEvent)
			}
		})
	}

	terminate(): void {
		this.#listeners.length = 0
	}
}

/** Serves the synthetic texture to anything that fetches the fake worker's URL. */
function patchFetch(): void {
	const original = globalThis.fetch.bind(globalThis)
	globalThis.fetch = async (input) => {
		const url = input instanceof Request ? input.url : String(input)
		if (url === TEXTURE_URL) {
			return new Response(await textureBlob())
		}
		return await original(input as RequestInfo)
	}
}

/** Installs the fake worker and its texture URL. Must run before the client loads. */
export function installTextureWorker(): void {
	const originalCreateObjectURL = URL.createObjectURL.bind(URL)
	URL.createObjectURL = (obj: Blob | MediaSource): string =>
		// The client creates exactly one object URL: the worker bootstrap script.
		TEXTURE_URL.startsWith('blob:') && obj instanceof Blob && obj.type === 'text/javascript'
			? TEXTURE_URL
			: originalCreateObjectURL(obj)

	globalThis.Worker = FakeTextureWorker as unknown as typeof Worker
	patchFetch()
}

export { FakeTextureWorker, TEXTURE_URL }
