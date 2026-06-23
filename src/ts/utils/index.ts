/**
 * Global utility functions used throughout the Micrio application.
 * Re-exports all utility modules for convenient importing.
 * @author Marcel Duin <marcel@micr.io>
 */

// Error handling
export { MicrioError, ErrorCodes, UserErrorMessages } from './error';
export type { ErrorCode } from './error';

// Mathematical utilities
export { pyth, mod, limitView } from './math';

// Object manipulation
export { clone, deepCopy } from './object';

// String utilities
export { createGUID, slugify, parseTime } from './string';

// Browser detection
export { Browser } from './browser';

// DOM utilities
export { sleep, loadScript } from './dom';

// Svelte store helpers
export { once, after } from './store';

// Data sanitization & view conversion
export { Sanitizer } from './sanitize';

// Data fetching
export {
	jsonCache,
	fetchJson,
	isFetching,
	fetchAlbumInfo
} from './fetch';

// DataLoader (bundle.json) — single source for image info + data
export { getInfo, getData, getBundleImage, getBundleImages } from './dataLoader';

// ID utilities
export { getIdVal, idIsV5 } from './id';

// 360° space utilities
export { getSpaceVector } from './space';

// Marker clustering
export { calcClusters } from './clustering';
export type { MarkerCoords, ClusterResult } from './clustering';

// Media utilities
export { hasNativeHLS, parseMediaSource, getIOSAudioElement, YOUTUBE_HOST } from './media';
export type { ParsedMediaSource } from './media';

