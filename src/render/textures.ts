/**
 * Manages downloading and processing image textures for WebGL using Web Workers.
 * @internal
 */

/** A type representing an image source acceptable by WebGL `texImage2D`. */
export type TextureBitmap = ImageBitmap|HTMLVideoElement|HTMLCanvasElement;

const workerBlob = URL.createObjectURL(new Blob([`let controller = null;
self.addEventListener('message', e => {
	if(e.data == 'abort') return controller && controller.abort();
	controller = new AbortController();
	fetch(e.data.src, { signal: controller.signal })
		.then(r => r.blob())
		.then(blob => self.createImageBitmap(blob))
		.then(data => self.postMessage({ data, src: e.data.src }, [data]))
		.catch(err => self.postMessage({ error: e.data.src + ': ' + err.message, type: err.name }))
})`], { type: 'text/javascript' }));

type ItemArray = [string, (n: TextureBitmap) => void, (n: string) => void];

/** Maximum number of concurrent texture loading threads. @internal */
export const numThreads: number = Math.max(2, Math.min(6, (navigator.hardwareConcurrency || 2) - 1));

const running: boolean[] = Array(numThreads).fill(false);
let busyCount = 0;
const loaders: Worker[] = [];
const queue: ItemArray[] = [];
const promises: Map<number, ItemArray> = new Map;

for (let i = 0; i < numThreads; i++) {
	const w = new Worker(workerBlob);
	w.onmessage = e => onmessage(i, e.data.data, e.data.error, e.data.type);
	loaders.push(w);
}

/** @internal */
export const loadTexture = (src: string): Promise<TextureBitmap> => new Promise((ok, err) => {
	queue.push([src, ok, err]);
	getNext();
});

function getNext() {
	if (!queue.length) return;
	const i = running.indexOf(false);
	if (i < 0) return;

	running[i] = true;
	busyCount++;
	const item = queue.shift()!;
	promises.set(i, item);
	loaders[i].postMessage({ src: item[0], type: 'image/' + item[0].split('.').pop() });
}

function onmessage(idx: number, buffer?: ImageBitmap, error?: string, errorType?: string) {
	const item = promises.get(idx);
	if (!item) return;
	promises.delete(idx);

	if (error) {
		item[2](error);
		if (errorType !== 'AbortError') console.error(`[Micrio Texture] Error loading ${item[0]}: ${errorType} - ${error}`);
	} else if (buffer) {
		item[1](buffer);
	} else {
		item[2](`Worker ${idx} sent invalid message.`);
		console.error(`[Micrio Texture] Worker ${idx} sent invalid message for ${item[0]}`);
	}

	setTimeout(() => {
		running[idx] = false;
		busyCount--;
		getNext();
	}, 50);
}

/** @internal */
export function runningThreads(): number {
	return busyCount;
}

/** @internal */
export function abortDownload(src: string): void {
	let threadIdx = -1;
	for (const [k, v] of promises.entries()) {
		if (v[0] === src) { threadIdx = k; break; }
	}
	if (threadIdx < 0) return;
	loaders[threadIdx]?.postMessage('abort');
}
