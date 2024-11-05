/** A WebGL acceptable image texture
 * @internal
 */
 export type TextureBitmap = ImageBitmap|HTMLImageElement|HTMLVideoElement;

 const isOldSafari:boolean = !self.createImageBitmap;

// Download images on separate threads
const worker = URL.createObjectURL(new Blob([`let controller = null, prevUri = null;
self.addEventListener('message', e => {
	if(e.data == 'abort') return controller && controller.abort();
	controller = new AbortController();
	fetch(e.data.src, { signal: controller.signal })
		.then(r => r.blob())` + (!isOldSafari ? `
		.then(blob => self.createImageBitmap(blob))
		.then(data => self.postMessage({data:data, src:e.data.src}, [data]))` : `
		.then(blob => {
			URL.revokeObjectURL(prevUri);
			self.postMessage({src: (prevUri = URL.createObjectURL(blob, {type: e.data.type}))})
		})`) + `
		.catch(err => self.postMessage({error: e.data.src+': '+err.message, type: err.name}))
})`], {'type': 'text/javascript'}));


/** Src, okFunc, errFunc */
type ItemArray = [string, (n: TextureBitmap) => any, (n: string) => any];

/** The number of download threads
 * @internal
*/
export const numThreads:number = Math.max(2, Math.min(6, (navigator.hardwareConcurrency || 2) - 1));

/** Running thread indexes */
const running: number[] = [];

/** Image elements per thread */
const loaders: Map<number, Worker> = new Map;

/** Image elements per thread */
const images: Map<number, HTMLImageElement> = new Map;

/** Current waiting queue */
const queue: ItemArray[] = [];

/** Running promises */
const promises: Map<number, ItemArray> = new Map;

// Initialize the bunch
for(let i=0;i<numThreads;i++) {
	const w = new Worker(worker);
	w.onmessage = e => onmessage(i, e.data['src'], e.data['data'], e.data['error'], e.data['type']);
	loaders.set(i, w);
	images.set(i, new Image);
}

/** Get an image by adding it to the download queue
 * @internal
*/
export const loadTexture = (
	/** The image src */
	src:string,
) : Promise<TextureBitmap> => new Promise((ok, err) => {
	queue.push([src, ok, err]);
	getNext();
});

/** Start downloading the next image */
function getNext(){
	if(!queue.length) return;

	let i=0;
	for(;i<numThreads;i++) if(running.indexOf(i) < 0) break;

	// All download threads taken
	if(i>= numThreads && !isOldSafari) {
		console.warn('All download threads taken!')
		return;
	}

	running.push(i);

	const item = queue.shift();
	if(!item) return;
	promises.set(i, item);

	const worker = loaders.get(i);
	if(!worker) return;

	worker.postMessage({
		'src': item[0],
		'type': 'image/'+item[0].split('.').reverse()[0]
	});
}

/** Got a message from a WebWorker */
function onmessage(
	/** The worker thread index */
	idx:number,
	src?:string,
	buffer?:ImageBitmap,
	error?:string,
	errorType?:string) {
	const item = promises.get(idx);

	if(item == undefined) return;

	promises.delete(idx);

	setTimeout(() => { running.splice(running.indexOf(idx), 1) }, 50);

	if(error) {
		item[2](error);
		if(errorType != 'AbortError') console.error(errorType, error);
	}
	else if(buffer) item[1](buffer);
	else if(src) {
		const image = images.get(idx);
		if(!image) return;
		image.onload = () => { item[1](image); };
		image.src = src;
	}
}

/** @internal */
export function runningThreads():number{
	return running.length;
}

/** Abort a running texture download
 * @internal
*/
export function abortDownload(src:string) : void {
	const thread = [...promises.entries()].find((e) => e[1][0] == src);
	if(thread == undefined) return;
	const loader = loaders.get(thread[0]);
	if(loader) loader.postMessage('abort');
}
