/**
 * Manages downloading and processing image textures for WebGL using Web Workers.
 * Implements a queue and thread pool to handle concurrent downloads efficiently.
 * Handles browser differences (createImageBitmap vs. Object URLs for older Safari).
 * @internal
 */

/** A type representing an image source acceptable by WebGL `texImage2D`. */
export type TextureBitmap = ImageBitmap|HTMLImageElement|HTMLVideoElement|HTMLCanvasElement;

/** Flag indicating if the browser is an older Safari version lacking `createImageBitmap`. @internal */
const isOldSafari:boolean = !self.createImageBitmap;

/**
 * Creates a Blob URL containing the Web Worker code for downloading and processing images.
 * The worker fetches the image, creates an ImageBitmap (if supported) or an Object URL,
 * and posts the result back to the main thread.
 * @internal
 */
const worker = URL.createObjectURL(new Blob([`let controller = null, prevUri = null;
self.addEventListener('message', e => {
	// Handle abort message
	if(e.data == 'abort') return controller && controller.abort();
	// Create new AbortController for this fetch
	controller = new AbortController();
	// Fetch the image blob
	fetch(e.data.src, { signal: controller.signal })
		.then(r => r.blob())` + (!isOldSafari ? `
		// If createImageBitmap is supported, use it (preferred)
		.then(blob => self.createImageBitmap(blob))
		// Post ImageBitmap back, transferring ownership
		.then(data => self.postMessage({data:data, src:e.data.src}, [data]))` : `
		// Fallback for older Safari: create Object URL
		.then(blob => {
			// Revoke previous Object URL to free memory
			URL.revokeObjectURL(prevUri);
			// Post Object URL back
			self.postMessage({src: (prevUri = URL.createObjectURL(blob, {type: e.data.type}))})
		})`) + `
		// Handle fetch errors (including abort)
		.catch(err => self.postMessage({error: e.data.src+': '+err.message, type: err.name}))
})`], {'type': 'text/javascript'}));


/** Type definition for items in the download queue: [src, resolveFn, rejectFn]. @internal */
type ItemArray = [string, (n: TextureBitmap) => any, (n: string) => any];

/**
 * The number of concurrent download threads (Web Workers) to use.
 * Determined based on available hardware concurrency, clamped between 2 and 6.
 * @internal
 */
export const numThreads:number = Math.max(2, Math.min(6, (navigator.hardwareConcurrency || 2) - 1));

/** Array tracking the indices of currently busy worker threads. @internal */
const running: number[] = [];

/** Map storing the Web Worker instances, keyed by thread index. @internal */
const loaders: Map<number, Worker> = new Map;

/** Map storing reusable HTMLImageElement instances (used as fallback for old Safari). @internal */
const images: Map<number, HTMLImageElement> = new Map;

/** The queue of pending texture download requests. @internal */
const queue: ItemArray[] = [];

/** Map storing the pending Promise details (resolve/reject functions) for each active worker thread. @internal */
const promises: Map<number, ItemArray> = new Map;

// Initialize the worker pool
for(let i=0;i<numThreads;i++) {
	const w = new Worker(worker); // Create worker
	// Set up message handler for this worker
	w.onmessage = e => onmessage(i, e.data['src'], e.data['data'], e.data['error'], e.data['type']);
	loaders.set(i, w); // Store worker instance
	// Create image element fallback if needed (only used by old Safari)
	if (isOldSafari) images.set(i, new Image);
}

/**
 * Loads an image texture asynchronously. Adds the request to the queue
 * and returns a Promise that resolves with the TextureBitmap or rejects on error.
 * @param src The URL of the image to load.
 * @returns A Promise resolving to the loaded TextureBitmap.
 */
export const loadTexture = (src:string) : Promise<TextureBitmap> => new Promise((ok, err) => {
	queue.push([src, ok, err]); // Add request to the queue
	getNext(); // Trigger processing the queue
});

/**
 * Checks the queue and assigns the next download task to an available worker thread.
 * @internal
 */
function getNext(){
	if(!queue.length) return; // Exit if queue is empty

	// Find the index of an available worker thread
	let i=0;
	for(;i<numThreads;i++) if(!running.includes(i)) break;

	// If all threads are busy
	if(i>= numThreads) {
		// This warning might be excessive if the queue mechanism works correctly.
		// console.warn('All download threads taken!')
		return;
	}

	running.push(i); // Mark thread as busy

	const item = queue.shift(); // Get the next item from the queue
	if(!item) { // Should not happen if queue.length > 0, but good practice
		running.splice(running.indexOf(i), 1); // Mark thread as free again
		return;
	}
	promises.set(i, item); // Store promise details for this thread

	const worker = loaders.get(i); // Get the worker instance
	if(!worker) { // Should not happen
		console.error(`[Micrio Texture] Worker ${i} not found!`);
		item[2]("Internal error: Worker not found"); // Reject promise
		running.splice(running.indexOf(i), 1); // Mark thread as free
		return;
	}

	// Send the image source and type to the worker
	worker.postMessage({
		'src': item[0],
		'type': 'image/'+item[0].split('.').pop() // Infer type from extension
	});
}

/**
 * Handles messages received from a Web Worker thread.
 * Resolves or rejects the corresponding Promise based on the worker's result.
 * @internal
 * @param idx The index of the worker thread sending the message.
 * @param src The source URL (either original or Object URL for old Safari).
 * @param buffer The loaded ImageBitmap (if supported).
 * @param error Error message string, if any.
 * @param errorType The type of error (e.g., 'AbortError').
 */
function onmessage(
	idx:number,
	src?:string,
	buffer?:ImageBitmap,
	error?:string,
	errorType?:string) {

	const item = promises.get(idx); // Get the promise details for this thread

	if(item == undefined) {
		console.warn(`[Micrio Texture] Received message from worker ${idx} but no matching promise found.`);
		return; // No matching promise, maybe aborted?
	}

	promises.delete(idx); // Remove promise details

	// Mark thread as free after a short delay to allow potential cleanup/next task assignment
	// TODO: Consider if this delay is necessary or could be removed/reduced.
	setTimeout(() => { running.splice(running.indexOf(idx), 1) }, 50);

	if(error) { // Handle error message from worker
		item[2](error); // Reject the promise
		// Log non-abort errors
		if(errorType != 'AbortError') console.error(`[Micrio Texture] Error loading ${item[0]}: ${errorType} - ${error}`);
	}
	else if(buffer) { // Handle successful ImageBitmap load
		item[1](buffer); // Resolve the promise with the ImageBitmap
	}
	else if(src && isOldSafari) { // Handle successful Object URL load (old Safari fallback)
		const image = images.get(idx); // Get the pre-created image element
		if(!image) { // Should not happen
			item[2]("Internal error: Image element fallback not found");
			return;
		}
		// Set up onload/onerror handlers for the image element
		image.onload = () => { item[1](image); }; // Resolve promise with the HTMLImageElement
		image.onerror = () => { item[2](`Failed to load image from Object URL: ${src}`); };
		image.src = src; // Set the Object URL as the image source
	} else {
		// Should not happen - worker should send either data, src (for old safari), or error
		item[2](`Worker ${idx} sent invalid message.`);
		console.error(`[Micrio Texture] Worker ${idx} sent invalid message for ${item[0]}`);
	}
}

/** Returns the number of currently active download threads. @internal */
export function runningThreads():number{
	return running.length;
}

/**
 * Aborts a specific texture download if it's currently in progress.
 * @internal
 * @param src The source URL of the download to abort.
 */
export function abortDownload(src:string) : void {
	// Find the thread currently processing this src
	const thread = [...promises.entries()].find((e) => e[1][0] == src);
	if(thread == undefined) return; // Not currently being processed

	// Send abort message to the corresponding worker
	const loader = loaders.get(thread[0]);
	if(loader) loader.postMessage('abort');
	// Note: The promise rejection is handled in the onmessage handler when the worker posts back an AbortError.
}
