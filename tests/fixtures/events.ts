import type { Models } from '$types/models'

/**
 * The public event contract, as a test-visible catalog.
 *
 * `MicrioEventDetails` is a type-only interface, so it is erased at runtime and nothing can
 * enumerate its keys from a test. That is exactly how a declared-but-never-dispatched event
 * (and, worse, a deleted declaration) slipped through before. This module closes that gap with
 * two independent guards:
 *
 * 1. {@link EVENT_CATALOG} is annotated `{ [K in EventName]: EventSpec<K> }`, so it must have
 *    **exactly** the keys of `MicrioEventDetails`. Deleting a key from the interface leaves the
 *    catalog with an excess property; adding one leaves it incomplete. Either way `tsc` fails.
 * 2. {@link EVENT_NAMES} is the runtime list, and `const _namesMatch` asserts it and the
 *    interface agree in both directions, so the two cannot drift apart silently.
 *
 * A test then walks {@link EVENT_CATALOG} and requires a real trigger for every entry, which is
 * what turns "the event is declared" into "the event actually reaches a host listener".
 */

/** Every event name documented for the client, in `MicrioEventDetails` order. */
export const EVENT_NAMES = [
	// General
	'show',
	'pre-info',
	'pre-data',
	'print',
	'load',
	'lang-switch',
	// Camera
	'zoom',
	'move',
	'draw',
	'resize',
	// User input
	'panstart',
	'panend',
	'pinchstart',
	'pinchend',
	// Markers
	'marker-open',
	'marker-opened',
	'marker-closed',
	// Marker and video tours
	'tour-start',
	'tour-stop',
	'tour-minimize',
	// Marker tours
	'tour-step',
	'serialtour-play',
	'serialtour-pause',
	// Video tours
	'videotour-start',
	'videotour-stop',
	'videotour-play',
	'videotour-pause',
	'tour-ended',
	'tour-event',
	// Main media
	'audio-init',
	'audio-mute',
	'audio-unmute',
	'autoplay-blocked',
	'media-blocked',
	'media-error',
	'media-play',
	'media-pause',
	'media-ended',
	'timeupdate',
	// Custom page popovers
	'page-open',
	'page-closed',
	// Album viewing
	'gallery-show',
	// Grid views
	'grid-init',
	'grid-load',
	'grid-layout-set',
	'grid-focus',
	'grid-blur',
	// Split-screen
	'splitscreen-start',
	'splitscreen-stop',
	// Special cases
	'update',
] as const

/** A declared event name, taken from the public interface rather than the list above. */
export type EventName = keyof Models.MicrioEventDetails

/** The runtime shape an event's `detail` must have, for the matrix's payload assertions. */
export type DetailKind = 'void' | 'array' | 'number' | 'string' | 'object'

/** What the matrix needs to know about one event. */
export interface EventSpec {
	/** The documented grouping, so a failure names the right subsystem. */
	family:
		| 'general'
		| 'camera'
		| 'input'
		| 'markers'
		| 'tours'
		| 'marker-tours'
		| 'video-tours'
		| 'media'
		| 'popover'
		| 'gallery'
		| 'grid'
		| 'splitscreen'
	/** Shape assertion applied to `evt.detail` by the matrix. */
	detail: DetailKind
	/** How the matrix makes it fire, for the failure message. */
	trigger: string
}

/**
 * One entry per declared event.
 *
 * The `{ [K in EventName]: … }` annotation is the compile-time guard: this object cannot be
 * missing a key, and cannot carry one the interface does not declare.
 */
export const EVENT_CATALOG: { [K in EventName]: EventSpec } = {
	show: { family: 'general', detail: 'object', trigger: 'open a bundle and wait for the first show' },
	'pre-info': { family: 'general', detail: 'object', trigger: 'open a bundle' },
	'pre-data': { family: 'general', detail: 'object', trigger: 'open a bundle whose image has data' },
	print: { family: 'general', detail: 'object', trigger: 'open a bundle' },
	load: { family: 'general', detail: 'object', trigger: 'open a bundle' },
	'lang-switch': { family: 'general', detail: 'string', trigger: "set the element's lang after a first image" },

	zoom: { family: 'camera', detail: 'object', trigger: 'drive the camera scale' },
	move: { family: 'camera', detail: 'object', trigger: 'pan the camera' },
	draw: { family: 'camera', detail: 'void', trigger: 'let the engine render a frame' },
	resize: { family: 'camera', detail: 'object', trigger: 'change the element size' },

	panstart: { family: 'input', detail: 'void', trigger: 'start a pointer drag' },
	panend: { family: 'input', detail: 'object', trigger: 'release a pointer drag' },
	pinchstart: { family: 'input', detail: 'void', trigger: 'start a two-finger pinch' },
	pinchend: {
		family: 'input',
		detail: 'void',
		trigger: 'end a two-finger pinch (the declared payload is still not sent)',
	},

	'marker-open': { family: 'markers', detail: 'object', trigger: 'open a marker' },
	'marker-opened': { family: 'markers', detail: 'object', trigger: 'open a marker' },
	'marker-closed': { family: 'markers', detail: 'object', trigger: 'close a marker' },

	'tour-start': { family: 'tours', detail: 'object', trigger: 'set a tour on the state' },
	'tour-stop': { family: 'tours', detail: 'object', trigger: 'clear the tour state' },
	'tour-minimize': {
		family: 'tours',
		detail: 'object',
		trigger: 'minimize a marker popup while a tour is running',
	},

	'tour-step': { family: 'marker-tours', detail: 'object', trigger: 'advance a serial tour step' },
	'serialtour-play': { family: 'marker-tours', detail: 'object', trigger: "play a serial tour step's media" },
	'serialtour-pause': { family: 'marker-tours', detail: 'object', trigger: 'pause a serial tour step' },

	'videotour-start': { family: 'video-tours', detail: 'object', trigger: 'mount a video tour' },
	'videotour-stop': { family: 'video-tours', detail: 'object', trigger: 'destroy a video tour' },
	'videotour-play': { family: 'video-tours', detail: 'void', trigger: 'play a video tour' },
	'videotour-pause': { family: 'video-tours', detail: 'void', trigger: 'pause a video tour' },
	'tour-ended': { family: 'video-tours', detail: 'object', trigger: 'let a serial tour reach its end' },
	'tour-event': { family: 'video-tours', detail: 'object', trigger: 'reach a timeline event in a video tour' },

	'audio-init': { family: 'media', detail: 'void', trigger: 'interact on an image that has audio' },
	'audio-mute': { family: 'media', detail: 'void', trigger: 'set the muted store to true' },
	'audio-unmute': { family: 'media', detail: 'void', trigger: 'set the muted store to false' },
	'autoplay-blocked': { family: 'media', detail: 'void', trigger: 'have the autoplay probe rejected' },
	'media-blocked': { family: 'media', detail: 'void', trigger: 'have a media element report a policy block' },
	'media-error': { family: 'media', detail: 'object', trigger: 'have a media element fail' },
	'media-play': { family: 'media', detail: 'void', trigger: "play a step's media element" },
	'media-pause': { family: 'media', detail: 'void', trigger: "pause a step's media element" },
	'media-ended': { family: 'media', detail: 'void', trigger: "let a step's media end" },
	timeupdate: { family: 'media', detail: 'number', trigger: "let a step's media tick" },

	'page-open': { family: 'popover', detail: 'object', trigger: 'activate a menu page' },
	'page-closed': { family: 'popover', detail: 'object', trigger: 'close a content page popover' },

	'gallery-show': { family: 'gallery', detail: 'array', trigger: 'navigate an open gallery' },

	'grid-init': { family: 'grid', detail: 'object', trigger: 'let a grid finish initializing' },
	'grid-load': { family: 'grid', detail: 'void', trigger: 'let every grid image load' },
	'grid-layout-set': { family: 'grid', detail: 'object', trigger: 'apply a grid layout' },
	'grid-focus': { family: 'grid', detail: 'object', trigger: 'focus a grid image' },
	'grid-blur': { family: 'grid', detail: 'void', trigger: 'blur a focused grid' },

	'splitscreen-start': { family: 'splitscreen', detail: 'object', trigger: 'open a split-screen link' },
	'splitscreen-stop': { family: 'splitscreen', detail: 'object', trigger: 'close a split-screen link' },

	update: { family: 'general', detail: 'array', trigger: 'move the camera and advance the 500 ms coalescer' },
}

/**
 * The runtime list and the interface must describe the same set of events, in both directions.
 *
 * A one-way check would accept a list that is missing names; this makes either drift a type error.
 */
const _namesAreExhaustive: (typeof EVENT_NAMES)[number] extends EventName
	? EventName extends (typeof EVENT_NAMES)[number]
		? true
		: { missingFromList: Exclude<EventName, (typeof EVENT_NAMES)[number]> }
	: { notAnEvent: Exclude<(typeof EVENT_NAMES)[number], EventName> } = true

/** Exported so the exhaustiveness assertion above is not optimized away. @internal */
export const EVENT_NAMES_ARE_EXHAUSTIVE: true = _namesAreExhaustive
