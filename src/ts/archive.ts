import type { TextureBitmap } from './textures';
import { idIsV5 } from './utils';

/**
 * Subset of the Posix USTAR header format relevant for MDP files.
 * @internal
 */
type MDPHeader = {
	/** File name (max 20 chars used here, though TAR allows more). */
	name: string;
	/** File size in bytes (octal string in TAR, parsed to number here). */
	size: number;
}

/**
 * Handles loading and parsing of Micrio Data Package (.mdp or .bin) files.
 * These files are TAR-like archives containing image thumbnails and potentially
 * JSON metadata (like album indexes) for optimized loading of galleries, grids,
 * and Omni objects.
 * @internal
 */
class Archive {
	/** Map storing loaded archive data ArrayBuffers, keyed by archive ID (e.g., 'g/folderId.revision' or 'imageId/base'). */
	private data:Map<string, ArrayBuffer> = new Map;
	/** Map storing the index of files within loaded archives. Key: full file path, Value: [archiveId, byteOffset, byteLength]. */
	db:Map<string, [string, number, number]> = new Map;

	/** Pool of reusable HTMLImageElement objects for the old Safari fallback in `getImage`. */
	private images:HTMLImageElement[] = [];

	/**
	 * Loads an archive file (.bin or .mdp) via XMLHttpRequest.
	 * Parses the header information to build the file index (`db`).
	 * @param path The base path for the archive file (e.g., 'https://r2.micr.io/').
	 * @param id The archive identifier (e.g., 'g/folderId.revision' or 'imageId/base').
	 * @param p Optional progress callback function (receives progress 0-1).
	 * @returns Promise that resolves when the archive is loaded and parsed.
	 */
	async load(path:string, id: string, p?:(n:number)=>void) : Promise<void> {
		if(this.data.has(id)) return; // Already loaded

		const baseId = id.replace(/^.*\//,'').split('.')[0]; // Extract base ID (folder or image)
		const isOmni = /\/base$/.test(id); // Is it an Omni base package?
		const isBin = isOmni || idIsV5(baseId); // Determine file extension (.bin for V5/Omni, .mdp for V4)

		const xhr = new XMLHttpRequest();
		const data = await new Promise((ok, err) => {
			let size:number = 0; // Total size for progress calculation
			xhr.responseType = 'arraybuffer'; // Expect binary data
			// Progress handler
			xhr.onprogress = e => {
				if(!size) size = Number(xhr.getResponseHeader('Content-Length')); // Get total size once headers are available
				p?.(Math.min(1, e.loaded / size)); // Report progress (clamped 0-1)
			};
			// Load handler
			xhr.onload = () => {
				if(xhr.readyState === 4 && xhr.status === 200) { p?.(1); ok(xhr.response); } // Success
				else err(); // Error
			};
			xhr.onerror = err; // Network error
			xhr.open('GET', path+id+(isBin ? '.bin' : '.mdp')); // Construct URL
			xhr.send();
		}) as ArrayBuffer|undefined; // TODO: Improve error handling, maybe reject promise?

		if(!data) return; // Exit if load failed

		this.data.set(id, data); // Store loaded ArrayBuffer

		// Determine image path prefix for Omni objects
		const imgPath = isOmni ? id.split('/')[0]+'/' : '';

		const hSize = 32; // Size of the simplified header used here

		let i = 0; // Byte offset
		// Parse the archive data, reading headers and file sizes
		while(i<data.byteLength) {
			// Ensure there's enough data left for a header
			if (i + hSize > data.byteLength) break;
			const h = this.parseHeader(new Uint8Array(data, i, hSize)); // Parse header
			// If header is valid (name and size > 0), add entry to the database
			if(h.name && h.size > 0) {
				this.db.set(path+imgPath+h.name.replace('./',''), [id, i+hSize, h.size]); // Key: full path, Value: [archiveId, offset, size]
			} else if (h.size === 0 && !h.name) {
				// Encountering null blocks likely means end of TAR archive, stop parsing.
				break;
			}
			// Move offset to the next header (skip header + file data)
			// TAR archives pad files to 512-byte blocks, but this implementation assumes tightly packed data.
			i+=hSize + h.size;
		}
	}

	/**
	 * Parses the simplified 32-byte MDP header.
	 * @internal
	 * @param d Uint8Array containing the header data.
	 * @returns Parsed header object {name, size}.
	 */
	private parseHeader(d: Uint8Array) : MDPHeader {
		const s = new TextDecoder().decode(d); // Decode bytes to string
		// Helper to slice and trim null characters
		const g = (l:number) => s.slice(i, i+=l).replace(/\x00/g,'').trim();
		let i = 0;
		return { name: g(20), size: parseInt(g(12), 8) } // Parse name (20 bytes) and size (12 bytes octal)
	}

	/**
	 * Retrieves a file from a loaded archive as a parsed JSON object.
	 * @template T The expected type of the parsed JSON.
	 * @param u The full path/URL of the file within the archive.
	 * @returns A Promise resolving to the parsed JSON object.
	 * @throws If the file or its archive is not found.
	 */
	get = <T>(u: string) : Promise<T> => new Promise((ok, err) => { // Added err callback
		const i = this.db.get(u); // Look up file index [archiveId, offset, size]
		if(!i || !this.data.has(i[0])) return err(new Error('Could not get blob: '+u)); // Throw error if not found
		const fr = new FileReader();
		fr.onload = () => ok(JSON.parse(fr.result as string) as T); // Parse JSON and resolve
		// Create a Blob from the specific byte range in the archive ArrayBuffer
		/** @ts-ignore */
		fr.readAsText(new Blob([new Uint8Array(this.data.get(i[0]), i[1], i[2])])); // Read Blob as text
	})

	/**
	 * Retrieves an image file from a loaded archive as a TextureBitmap (ImageBitmap or HTMLImageElement).
	 * Uses `createImageBitmap` if available, otherwise falls back to creating an Object URL
	 * and loading it into a pooled HTMLImageElement (for older Safari).
	 * @param u The full path/URL of the image file within the archive.
	 * @returns A Promise resolving to the loaded TextureBitmap.
	 * @throws If the file or its archive is not found.
	 */
	getImage = async (u: string) : Promise<TextureBitmap> => new Promise((ok, err) => { // Added err callback
		const i = this.db.get(u); // Look up file index
		if(!i || !this.data.has(i[0])) return err(new Error('Could not get blob: '+u)); // Throw error if not found

		// Create a Blob from the specific byte range
		/** @ts-ignore */
		const blob = new Blob([new Uint8Array(this.data.get(i[0]), i[1], i[2])]);

		// Use createImageBitmap if supported (preferred method)
		if('createImageBitmap' in self) { // Reverted check - logic handled by isOldSafari in textures.ts
			ok(self.createImageBitmap(blob)); // Resolve with ImageBitmap
		}
		// Fallback for older Safari using Object URLs and pooled Image elements
		else {
			let img = this.images.find(i => !i.src); // Find an unused Image element from the pool
			if(!img) this.images.push(img = new Image); // Create a new one if pool is empty
			img.onload = () => { if(!img) return;
				ok(img); // Resolve with the loaded HTMLImageElement
				// Clean up Object URL after a short delay to allow rendering
				requestAnimationFrame(() => {
					if(!img) return;
					URL.revokeObjectURL(img.src);
					/** @ts-ignore */
					img.src = null; // Clear src to mark as available
				});
			}
			img.src = URL.createObjectURL(blob); // Set Object URL as source
		}
	})
}

/**
 * Singleton instance of the Archive controller.
 * @internal
 */
export const archive = new Archive();
