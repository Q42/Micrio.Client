declare module '@micrio/client' {
	import type { Readable, Writable } from 'svelte/store';
	/**
	 * Defines the current version of the Micrio library.
	 * This constant is used internally and exposed statically via `HTMLMicrioElement.VERSION`.
	 */
	export const VERSION: string;
	/**
	 * Loads an image texture asynchronously. Adds the request to the queue
	 * and returns a Promise that resolves with the TextureBitmap or rejects on error.
	 * @param src The URL of the image to load.
	 * @returns A Promise resolving to the loaded TextureBitmap.
	 */
	export const loadTexture: (src: string) => Promise<TextureBitmap>;
	/** Type for error codes */
	export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];
	/**
	 * Converts seconds into a human-readable time string (hh?:mm:ss).
	 * @param s Time in seconds. Can be negative for remaining time display.
	 * @returns Formatted time string (e.g., "1:23", "1:05:09", "-0:15").
	 */
	export function parseTime(s: number): string;
	export type PREDEFINED = [string, Models.ImageInfo.ImageInfo, Models.ImageData.ImageData | undefined];
	/** Enum for identifying media type. */
	export enum MediaType {
		None = 0,
		IFrame = 1,
		Video = 2,
		Audio = 3,
		VideoTour = 4,
		Micrio = 5
	}
	/** Enum for identifying iframe player type. */
	export enum FrameType {
		YouTube = 1,
		Vimeo = 2
	}
	export { isLegacyViews };
	/**
	 * Marker clustering algorithm for calculating overlapping markers
	 * and generating cluster marker objects.
	 * @author Marcel Duin <marcel@micr.io>
	 */
	type MarkerData = Models.ImageData.Marker;
	export type MarkerCoords = [x: number, y: number, w?: number, h?: number];
	export interface ClusterResult {
		overlapped: number[];
		clusterMarkers: MarkerData[];
	}
	/**
	 * Calculates which markers overlap and generates synthetic cluster markers.
	 */
	export function calcClusters(visibleMarkers: MarkerData[] | undefined, coords: Map<string, MarkerCoords>, r: number, isOmni: boolean): ClusterResult;
	/**
	 * Media utilities for source parsing, type detection, and player management.
	 * @author Marcel Duin <marcel@micr.io>
	 */
	/** YouTube no-cookies host */
	export const YOUTUBE_HOST = "https://www.youtube-nocookie.com";
	/**
	 * Parsed media source information.
	 */
	export interface ParsedMediaSource {
		/** The detected media type */
		type: MediaType;
		/** The frame type for iframe embeds (YouTube/Vimeo) */
		frameType?: FrameType;
		/** The normalized/processed source URL */
		src?: string;
		/** Original source URL */
		originalSrc?: string;
		/** YouTube video ID (if applicable) */
		youtubeId?: string;
		/** Vimeo video ID (if applicable) */
		vimeoId?: string;
		/** Vimeo hash token (if applicable) */
		vimeoToken?: string;
		/** Cloudflare video ID (if applicable) */
		cloudflareId?: string;
		/** Micrio embed data [id, width?, height?, lang?] */
		micrioEmbed?: string[];
		/** Start time extracted from URL (seconds) */
		startTime?: number;
		/** Whether the source is a Cloudflare stream */
		isCloudflare: boolean;
		/** M3U8 URL for HLS streams */
		hlsSrc?: string;
	}
	/**
	 * Parses a media source URL and determines its type and configuration.
	 */
	export function parseMediaSource(src: string | undefined, tour: Models.ImageData.VideoTour | null, useNativeFrames?: boolean, currentTime?: number): ParsedMediaSource;
	/**
	 * Checks if the browser natively supports HLS playback.
	 */
	export function hasNativeHLS(el?: HTMLMediaElement): boolean;
	/**
	 * Returns a shared Audio element instance for iOS.
	 * This is a workaround for iOS audio playback restrictions where user
	 * interaction is required per audio element.
	 */
	export function getIOSAudioElement(): HTMLAudioElement;
	/**
	 * Global utility functions used throughout the Micrio application.
	 * Re-exports all utility modules for convenient importing.
	 * @author Marcel Duin <marcel@micr.io>
	 */
	export { MicrioError, ErrorCodes, UserErrorMessages } from "ts/utils/error";
	export type { ErrorCode } from "ts/utils/error";
	export { pyth, mod, limitView } from "ts/utils/math";
	export { clone, deepCopy } from "ts/utils/object";
	export { createGUID, slugify, parseTime } from "ts/utils/string";
	export { Browser } from "ts/utils/browser";
	export { sleep, notypecheck, loadScript } from "ts/utils/dom";
	export { once, after } from "ts/utils/store";
	export { View } from "ts/utils/view";
	export { sanitizeAsset, isLegacyViews, sanitizeImageInfo, sanitizeImageData, sanitizeSpaceData, sanitizeMarker, sanitizeVideoTour } from "ts/utils/sanitize";
	export { jsonCache, fetchJson, isFetching, getLocalData, fetchInfo, fetchAlbumInfo } from "ts/utils/fetch";
	export { loadSerialTour } from "ts/utils/tour";
	export { getIdVal, idIsV5 } from "ts/utils/id";
	export { getSpaceVector } from "ts/utils/space";
	export { calcClusters } from "ts/utils/clustering";
	export type { MarkerCoords, ClusterResult } from "ts/utils/clustering";
	export { hasNativeHLS, parseMediaSource, getIOSAudioElement, getAudioSrc, getMarkerCulture, getMenuCulture, YOUTUBE_HOST } from "ts/utils/media";
	export type { ParsedMediaSource } from "ts/utils/media";
	/**
	 * Defines various enums used throughout the Micrio application,
	 * primarily for standardizing action types and option values.
	 */
	export namespace Enums {
		/** Enums related to the Grid functionality. */
		namespace Grid {
			/**
			 * Defines the types of actions that can be performed on a Grid instance,
			 * often triggered by marker data (`gridAction`) or tour events.
			 */
			enum GridActionType {
				/** Focus on specific images within the grid, hiding others. Data: comma-separated image IDs. */
				focus = 0,
				/** Animate the main grid view to fit the bounding box of specified images. Data: comma-separated image IDs. */
				flyTo = 1,
				/** Focus on images containing markers with a specific tag. Data: tag name. */
				focusWithTagged = 2,
				/** Focus on images containing markers with a specific tag and fly to the marker views. Data: tag name. */
				focusTagged = 3,
				/** Reset the grid to its initial layout and view. */
				reset = 4,
				/** Navigate back one step in the grid layout history. */
				back = 5,
				/** Instantly switch a focused image back to its position within the grid layout (used internally?). */
				switchToGrid = 6,
				/** Filter the grid to show only images that are part of the currently active marker tour. */
				filterTourImages = 7,
				/** Set a one-time crossfade duration for the *next* grid transition. Data: duration in seconds. */
				nextFadeDuration = 8
			}
		}
		/** Enums related to the Camera functionality. */
		namespace Camera {
			/**
			 * Defines the available timing functions for camera animations (flyToView, flyToCoo).
			 * These correspond to standard CSS easing functions.
			 */
			enum TimingFunction {
				'ease' = 0,// Default ease-in-out
				'ease-in' = 1,
				'ease-out' = 2,
				'linear' = 3
			}
		}
	}
	/**
	 * Represents the virtual camera used to view a {@link MicrioImage}.
	 * Provides methods for controlling the viewport (position, zoom, rotation),
	 * converting between screen and image coordinates, and managing animations.
	 *
	 * Instances are typically accessed via `micrioImage.camera`.
	 * @author Marcel Duin <marcel@micr.io>
	*/
	export class Camera {
		/** Current center screen coordinates [x, y] and scale [z]. For 360, also includes [yaw, pitch]. For Omni, also includes [frameIndex]. */
		readonly center: Models.Camera.Coords;
		/** CORRECT view: [x0, y0, width, height] */
		private readonly view;
		/**
		 * Gets the current image view rectangle.
		 * @returns A copy of the current screen viewport array, or undefined if not initialized.
		 */
		getView: () => Models.Camera.View;
		/**
		 * Gets the current image view rectangle [centerX, centerY, width, height] relative to the image (0-1).
		 * @returns A copy of the current screen viewport array, or undefined if not initialized.
		 */
		getViewRaw: () => Float64Array;
		/**
		 * Gets the current image view rectangle [x0, y0, x1, y1] relative to the image (0-1).
		 * @returns A copy of the current screen viewport array, or undefined if not initialized.
		 */
		getViewLegacy: () => Models.Camera.ViewRect | undefined;
		/**
		 * Sets the camera view instantly to the specified viewport.
		 * @param view The target viewport as either a View [x0, y0, x1, y1] or View {centerX, centerY, width, height}.
		 * @param opts Options for setting the view.
		 */
		setView(view: Models.Camera.View, opts?: {
			/** If true, allows setting a view outside the normal image boundaries. */
			noLimit?: boolean;
			/** If true (for 360), corrects the view based on the `trueNorth` setting. */
			correctNorth?: boolean;
			/** If true, prevents triggering a Wasm render after setting the view. */
			noRender?: boolean;
			/** If provided, interprets `view` relative to this sub-area instead of the full image. */
			area?: Models.Camera.ViewRect;
		}): void;
		/**
		 * Gets the relative image coordinates [x, y, scale, depth, yaw?, pitch?] corresponding to a screen coordinate.
		 * Rounds the result for cleaner output.
		 * @param x The screen X coordinate in pixels.
		 * @param y The screen Y coordinate in pixels.
		 * @param absolute If true, treats x/y as absolute browser window coordinates.
		 * @param noLimit If true, allows returning coordinates outside the image bounds (0-1).
		 * @returns A Float64Array containing the relative image coordinates [x, y, scale, depth, yaw?, pitch?].
		 */
		getCoo: (x: number, y: number, absolute?: boolean, noLimit?: boolean) => Float64Array;
		/**
		 * Sets the center of the screen to the specified image coordinates and scale instantly.
		 * @param x The target image X coordinate (0-1).
		 * @param y The target image Y coordinate (0-1).
		 * @param scale The target scale (optional, defaults to current scale).
		 */
		setCoo(x: number, y: number, scale?: number): void;
		/**
		 * Gets the screen coordinates [x, y, scale, depth] corresponding to relative image coordinates.
		 * @param x The image X coordinate (0-1).
		 * @param y The image Y coordinate (0-1).
		 * @param abs If true, returns absolute browser window coordinates instead of element-relative.
		 * @param radius Optional offset radius for 360 calculations.
		 * @param rotation Optional offset rotation (radians) for 360 calculations.
		 * @param noTrueNorth If true (for 360), ignores the `trueNorth` correction.
		 * @returns A Float64Array containing the screen coordinates [x, y, scale, depth].
		 */
		getXY: (x: number, y: number, abs?: boolean, radius?: number, rotation?: number, noTrueNorth?: boolean) => Float64Array;
		/** Gets the current camera zoom scale. */
		getScale: () => number;
		/**
		 * Calculates a 4x4 transformation matrix for placing an object at specific coordinates
		 * with scale and rotation in 360 space. Used for CSS `matrix3d`.
		 * @param x The image X coordinate (0-1).
		 * @param y The image Y coordinate (0-1).
		 * @param scale The object scale multiplier.
		 * @param radius The object radius (distance from center, default 10).
		 * @param rotX The object X rotation in radians.
		 * @param rotY The object Y rotation in radians.
		 * @param rotZ The object Z rotation in radians.
		 * @param transY Optional Y translation in 3D space.
		 * @param scaleX Optional non-uniform X scaling.
		 * @param scaleY Optional non-uniform Y scaling.
		 * @returns The resulting 4x4 matrix as a Float32Array.
		 */
		getMatrix(x: number, y: number, scale?: number, radius?: number, rotX?: number, rotY?: number, rotZ?: number, transY?: number, scaleX?: number, scaleY?: number, noCorrectNorth?: boolean): Float32Array;
		/**
		 * Sets the camera zoom scale instantly.
		 * @param s The target scale.
		*/
		setScale: (s: number) => void;
		/** Gets the scale at which the image fully covers the viewport. */
		getCoverScale: () => number;
		/**
		 * Gets the minimum allowed zoom scale for the image.
		 * @returns The minimum scale.
		*/
		getMinScale: () => number;
		/**
		 * Sets the minimum allowed zoom scale.
		 * @param s The minimum scale to set.
		*/
		setMinScale(s: number): void;
		/**
		 * Sets the minimum screen size the image should occupy when zooming out (0-1).
		 * Allows zooming out further than the image boundaries, creating margins.
		 * Note: Does not work with albums.
		 * @param s The minimum screen size fraction (0-1).
		*/
		setMinScreenSize(s: number): void;
		/** Returns true if the camera is currently zoomed in to its maximum limit. */
		isZoomedIn: () => boolean;
		/**
		 * Returns true if the camera is currently zoomed out to its minimum limit.
		 * @param full If true, checks against the absolute minimum scale (ignoring `setMinScreenSize`).
		*/
		isZoomedOut: (full?: boolean) => boolean;
		/**
		 * Sets a rectangular limit for camera navigation within the image.
		 * @param l The viewport limit rectangle [x0, y0, x1, y1].
		*/
		setLimit(v: Models.Camera.ViewRect): void;
		/**
		 * Sets whether the camera view should be limited to always cover the viewport.
		 * @param b If true, limits the view to cover the screen.
		*/
		setCoverLimit(b: boolean): void;
		/** Gets whether the cover limit is currently enabled. */
		getCoverLimit: () => boolean;
		/**
		 * Limits the horizontal and vertical viewing range for 360 images.
		 * @param xPerc The horizontal arc limit as a percentage (0-1, where 1 = 360°). 0 disables horizontal limit.
		 * @param yPerc The vertical arc limit as a percentage (0-1, where 1 = 180°). 0 disables vertical limit.
		*/
		set360RangeLimit(xPerc?: number, yPerc?: number): void;
		/**
		 * Animates the camera smoothly to a target viewport.
		 * @param view The target viewport as either a View [x0, y0, x1, y1] or View {centerX, centerY, width, height}.
		 * @param opts Optional animation settings.
		 * @returns A Promise that resolves when the animation completes, or rejects if aborted.
		 */
		flyToView: (view: Models.Camera.ViewRect | Models.Camera.View, opts?: Models.Camera.AnimationOptions & {
			/** Set the starting animation progress percentage (0-1). */
			progress?: number;
			/** Base the progress override on this starting view. */
			prevView?: Models.Camera.View;
			/** If true, performs a "jump" animation (zooms out then in). */
			isJump?: boolean;
			/** For Omni objects: the target image frame index to animate to. */
			omniIndex?: number;
			/** If provided, interprets `view` relative to this sub-area. */
			area?: Models.Camera.ViewRect;
			/** If true, respects the image's maximum zoom limit during animation. */
			limitZoom?: boolean;
			/** If provided, adds a margin to the view. */
			margin?: [number, number];
		}) => Promise<void>;
		/**
		 * Animates the camera to a view showing the entire image (minimum zoom).
		 * @param opts Optional animation settings.
		 * @returns A Promise that resolves when the animation completes.
		 */
		flyToFullView: (opts?: Models.Camera.AnimationOptions) => Promise<void>;
		/**
		 * Animates the camera to a view where the image covers the viewport.
		 * @param opts Optional animation settings.
		 * @returns A Promise that resolves when the animation completes.
		 */
		flyToCoverView: (opts?: Models.Camera.AnimationOptions) => Promise<void>;
		/**
		 * Animates the camera to center on specific image coordinates and scale.
		 * @param coords The target coordinates [x, y, scale]. Scale is optional.
		 * @param opts Optional animation settings.
		 * @returns A Promise that resolves when the animation completes.
		 */
		flyToCoo: (coords: Models.Camera.Coords, opts?: Models.Camera.AnimationOptions) => Promise<void>;
		/**
		 * Performs an animated zoom centered on a specific screen point (or the current center).
		 * @param delta The amount to zoom (positive zooms out, negative zooms in).
		 * @param duration Forced duration in ms (0 for instant).
		 * @param x Screen pixel X-coordinate for zoom focus (optional, defaults to center).
		 * @param y Screen pixel Y-coordinate for zoom focus (optional, defaults to center).
		 * @param speed Animation speed multiplier (optional).
		 * @param noLimit If true, allows zooming beyond image boundaries.
		 * @returns A Promise that resolves when the zoom animation completes.
		 */
		zoom: (delta: number, duration?: number, x?: number | undefined, y?: number | undefined, speed?: number, noLimit?: boolean) => Promise<void>;
		/**
		 * Zooms in by a specified factor.
		 * @param factor Zoom factor (e.g., 1 = standard zoom step).
		 * @param duration Animation duration in ms.
		 * @param speed Animation speed multiplier.
		 * @returns A Promise that resolves when the animation completes.
		 */
		zoomIn: (factor?: number, duration?: number, speed?: number) => Promise<void>;
		/**
		 * Zooms out by a specified factor.
		 * @param factor Zoom factor (e.g., 1 = standard zoom step).
		 * @param duration Animation duration in ms.
		 * @param speed Animation speed multiplier.
		 * @returns A Promise that resolves when the animation completes.
		 */
		zoomOut: (factor?: number, duration?: number, speed?: number) => Promise<void>;
		/**
		 * Pans the camera view by a relative pixel amount.
		 * @param x The horizontal pixel distance to pan.
		 * @param y The vertical pixel distance to pan.
		 * @param duration Animation duration in ms (0 for instant).
		 * @param opts Options: render (force render), noLimit (allow panning outside bounds).
		*/
		pan(x: number, y: number, duration?: number, opts?: {
			render?: boolean;
			noLimit?: boolean;
		}): void;
		/** Stops any currently running camera animation immediately. */
		stop(): void;
		/** Pauses the current camera animation. */
		pause(): void;
		/** Resumes a paused camera animation. */
		resume(): void;
		/** Returns true if the camera is currently performing a kinetic pan/zoom (coasting). */
		aniIsKinetic(): boolean;
		/** Gets the current viewing direction (yaw) in 360 mode.
		 * @returns The current yaw in radians.
		 */
		getDirection: () => number;
		/**
		 * Sets the viewing direction (yaw and optionally pitch) instantly in 360 mode.
		 * @param yaw The target yaw in radians.
		 * @param pitch Optional target pitch in radians.
		*/
		setDirection(yaw: number, pitch?: number): void;
		/**
		 * Gets the current viewing pitch in 360 mode.
		 * @returns The current pitch in radians.
		*/
		getPitch: () => number;
		/**
		 * Sets the rendering area for this image within the main canvas.
		 * Used for split-screen and potentially other layout effects. Animates by default.
		 * @param v The target area rectangle [x0, y0, x1, y1] relative to the main canvas (0-1).
		 * @param opts Options for setting the area.
		 */
		setArea(v: Models.Camera.ViewRect, opts?: {
			/** If true, sets the area instantly without animation. */
			direct?: boolean;
			/** If true, prevents dispatching view updates during the animation. */
			noDispatch?: boolean;
			/** If true, prevents triggering a Wasm render after setting the area. */
			noRender?: boolean;
		}): void;
		/** Sets the 3D rotation for an embedded image (used for placing embeds in 360 space). */
		setRotation(rotX?: number, rotY?: number, rotZ?: number): void;
		/** [Omni] Gets the current rotation angle in degrees based on the active frame index. */
		getOmniRotation(): number;
		/** [Omni] Gets the frame index corresponding to a given rotation angle (radians). */
		getOmniFrame(rot?: number): number | undefined;
		/** [Omni] Gets the screen coordinates [x, y, scale, depth] for given 3D object coordinates. */
		getOmniXY(x: number, y: number, z: number): Float64Array;
		/** [Omni] Applies Omni-specific camera settings (distance, FoV, angle) to Wasm. */
		setOmniSettings(): void;
	}
	/**
	 * Engine-wide constants and math values.
	 * @author Marcel Duin <marcel@micr.io>
	 */
	export const PI: number;
	export const PIh: number;
	export const PI2: number;
	/** Number of horizontal segments for 360 sphere geometry. */
	export const segsX = 16;
	/** Number of vertical segments for 360 sphere geometry. */
	export const segsY = 16;
	/** Base distance for 360 space transitions. */
	export const base360Distance = 8;
	/** Calculates 2 to the power of num (2^num). */
	export function twoNth(num: number): number;
	/** Calculates the modulo 1 of a number (keeps the fractional part, positive). */
	export function mod1(n: number): number;
	/** Calculates the modulo 2*PI of a number (wraps angles to the range [0, 2*PI)). */
	export function modPI(n: number): number;
	/**
	 * Calculates the shortest angular distance between two longitude coordinates.
	 * Handles wrapping around the 360-degree sphere.
	 * @param from Starting longitude coordinate (0-1).
	 * @param to Target longitude coordinate (0-1).
	 * @returns The shortest signed distance (-0.5 to 0.5).
	 */
	export function longitudeDistance(from: number, to: number): number;
	/**
	 * Implements a cubic bezier curve calculation.
	 * Used for animation easing functions.
	 */
	export class Bicubic {
		private readonly Cx;
		private readonly Bx;
		private readonly Ax;
		private readonly Cy;
		private readonly By;
		private readonly Ay;
		private readonly isLinear;
		constructor(p1: number, p2: number, p3: number, p4: number);
		/** Calculates the X coordinate on the bezier curve for a given parameter t. */
		private bezier_x;
		/** Calculates the Y coordinate on the bezier curve for a given parameter t. */
		private bezier_y;
		/** Calculates the derivative of the bezier curve's X component with respect to t. */
		private bezier_x_der;
		/**
		 * Approximates the parameter t that corresponds to a given X coordinate on the curve,
		 * using Newton's method.
		 * @param x The target X coordinate.
		 * @returns The approximated parameter t for the given x.
		 */
		private find_x_for;
		/**
		 * Gets the eased Y value for a given progress value t (0-1).
		 * @param t The progress value (time).
		 * @returns The eased Y value.
		 */
		get(t: number): number;
	}
	/** Predefined cubic bezier easing: ease-in-out (standard). */
	export const easeInOut: Bicubic;
	/** Predefined cubic bezier easing: ease-in. */
	export const easeIn: Bicubic;
	/** Predefined cubic bezier easing: ease-out. */
	export const easeOut: Bicubic;
	/** Predefined cubic bezier easing: linear. */
	export const linear: Bicubic;
	/**
	 * Handles kinetic scrolling/dragging behavior after user interaction stops.
	 * @author Marcel Duin <marcel@micr.io>
	 */
	/** Handles kinetic scrolling/dragging behavior after user interaction stops. */
	export default class Kinetic {
		private canvas;
		/** Accumulated horizontal delta during drag. */
		private dX;
		/** Accumulated vertical delta during drag. */
		private dY;
		/** Timestamp when the drag interaction started. */
		private startTime;
		/** Timestamp of the previous step added. */
		private prevTime;
		/** Timestamp when the drag interaction ended (kinetic phase started). */
		private endTime;
		/** Timestamp of the last significant interaction step. */
		private lastInteraction;
		/** Current horizontal velocity for kinetic movement. */
		private velocityX;
		/** Current vertical velocity for kinetic movement. */
		private velocityY;
		/** Flag indicating if kinetic movement is currently active. */
		started: boolean;
		constructor(canvas: Canvas);
		/**
		 * Adds a step (delta) from the user's drag interaction.
		 * @param pX Horizontal pixel delta since last step.
		 * @param pY Vertical pixel delta since last step.
		 * @param time Current timestamp (performance.now()).
		 */
		addStep(pX: number, pY: number, time: number): void;
		/** Starts the kinetic movement phase (called when user stops dragging). */
		start(): void;
		/** Stops the kinetic movement and resets state. */
		stop(): void;
		/**
		 * Calculates and applies the kinetic movement step for the current frame.
		 * @returns Progress towards stopping (0 = max velocity, 1 = stopped).
		 */
		step(time: number): number;
	}
	/** Manages camera and view animations (fly-to, zoom). */
	export default class Ani {
		private canvas;
		/** Flag indicating if a view animation (fly-to) is active. */
		private isView;
		/** Starting view state for the animation. */
		private readonly vFrom;
		/** Target view state for the animation. */
		private readonly vTo;
		/** Stores the final target view requested (might differ from vTo during corrections). */
		readonly lastView: View;
		/** Flag indicating if a zoom animation (perspective change in 360) is active. */
		private isZoom;
		/** Flag indicating if the animation is a "jump" (zooms out then in). */
		private isJump;
		/** Starting perspective value for zoom animation. */
		private zFrom;
		/** Target perspective value for zoom animation. */
		private zTo;
		/** Flag to disable perspective limits during zoom animation. */
		private zNoLimit;
		/** Easing function used for the current animation. */
		private fn;
		/** Timestamp when the animation started. */
		private started;
		/** Total duration of the animation in milliseconds. */
		private duration;
		/** Flag indicating if the animation is currently running (not paused). */
		private isRunning;
		/** Flag indicating if the view should be limited during animation (usually false during animation). */
		limit: boolean;
		/** Flag indicating if the current animation step resulted in zooming out. */
		zoomingOut: boolean;
		/** Flag indicating if the animation is a fly-to type. */
		flying: boolean;
		/** Flag indicating if the animation is correcting the view to stay within limits. */
		correcting: boolean;
		/** Timestamp when the animation was paused. 0 if not paused. */
		private pausedAt;
		private fL;
		private fT;
		private fR;
		private fB;
		/** Start point for the ease-in part of the jump animation curve. */
		private mI;
		/** Start point for the ease-out part of the jump animation curve. */
		private mO;
		/** Starting frame index for omni object rotation animation. */
		private omniStartIdx;
		/** Delta (number of frames) to rotate during omni animation. */
		private omniDelta;
		constructor(canvas: Canvas);
		/** Pauses the current animation. */
		pause(time: number): void;
		/** Resumes a paused animation. */
		resume(time: number): void;
		/** Stops the current animation completely and resets state. */
		stop(): void;
		/** Checks if a view animation is currently running. */
		isStarted(): boolean;
		/**
		 * Starts or updates a "fly-to" animation to a target view rectangle.
		 * @returns Calculated or provided animation duration in ms.
		 */
		toView(toCenterX: number, toCenterY: number, toWidth: number, toHeight: number, dur: number, speed: number, perc: number, isJump: boolean, limitViewport: boolean, omniIdx: number, fn: number, time: number, correct?: boolean): number;
		/** Updates the target view of a running animation. Used for corrections. */
		updateTarget(toCenterX: number, toCenterY: number, toWidth: number, toHeight: number, limiting?: boolean): void;
		/**
		 * Starts a zoom animation (perspective change for 360).
		 * @returns Calculated or provided animation duration in ms.
		 */
		zoom(to: number, dur: number, speed: number, noLimit: boolean, time: number): number;
		/** Sets the starting view for progress calculation in flyTo animations. */
		setStartView(centerX: number, centerY: number, width: number, height: number, correctRatio: boolean): void;
		/**
		 * Calculates and applies the animation step for the current frame.
		 * @returns Current animation progress (0-1).
		 */
		step(time: number): number;
	}
	/**
	 * Handles 2D camera logic, view calculations, and user interactions like pan, zoom, pinch.
	 * @author Marcel Duin <marcel@micr.io>
	 */
	/** Handles 2D camera logic, view calculations, and user interactions like pan, zoom, pinch. */
	export default class Camera {
		private canvas;
		scale: number;
		minScale: number;
		minSize: number;
		maxScale: number;
		fullScale: number;
		coverScale: number;
		readonly xy: Coordinates;
		readonly coo: Coordinates;
		private readonly startCoo;
		private pinching;
		private inited;
		private hasStartCoo;
		cpw: number;
		cph: number;
		private wasCoverLimit;
		constructor(canvas: Canvas);
		/**
		 * Converts screen pixel coordinates to relative image coordinates [0-1].
		 */
		getCoo(x: number, y: number, abs: boolean, noLimit: boolean): Coordinates;
		/**
		 * Converts relative image coordinates [0-1] to screen pixel coordinates.
		 */
		getXY(x: number, y: number, abs: boolean): Coordinates;
		getXYOmni(x: number, y: number, radius: number, rotation: number, abs: boolean): Coordinates;
		/**
		 * Converts 3D coordinates relative to an omni object's center to screen pixel coordinates.
		 */
		getXYOmniCoo(x: number, y: number, z: number, rotation: number, abs: boolean): Coordinates;
		/** Recalculates scale limits (minScale, maxScale, coverScale, fullScale) based on current canvas and image dimensions. */
		setCanvas(): void;
		/** Corrects minScale and maxScale based on coverLimit and focus area. */
		correctMinMax(noLimit?: boolean): void;
		/** Checks if the current scale is below the minimum allowed scale (considering minSize margin). */
		isUnderZoom(): boolean;
		/** Checks if the camera is fully zoomed out (at or below minScale, considering minSize margin). */
		isZoomedOut(b?: boolean): boolean;
		/** Checks if the camera is fully zoomed in (at or above maxScale). */
		isZoomedIn(): boolean;
		/**
		 * Calculates and sets the current camera scale and view offsets based on the logical view rectangle.
		 * @returns True if the view was successfully set, false if initialization is pending.
		 */
		setView(): boolean;
		/** Checks if the current view extends beyond the defined limits or max scale. */
		isOutsideLimit(): boolean;
		/**
		 * Pans the view by a given pixel delta.
		 */
		pan(xPx: number, yPx: number, duration: number, noLimit: boolean, time: number, force?: boolean, isKinetic?: boolean): void;
		/**
		 * Zooms the view by a given delta, centered on screen coordinates.
		 * @returns The calculated animation duration.
		 */
		zoom(delta: number, xPx: number, yPx: number, duration: number, noLimit: boolean, time: number): number;
		prevSize: number;
		prevCenterX: number;
		prevCenterY: number;
		/** Handles pinch gesture updates. */
		pinch(xPx1: number, yPx1: number, xPx2: number, yPx2: number): void;
		/** Signals the start of a pinch gesture. */
		pinchStart(): void;
		/** Signals the end of a pinch gesture. */
		pinchStop(time: number): void;
		private snapToBounds;
		/**
		 * Initiates a fly-to animation to a target view rectangle.
		 * @returns The calculated animation duration.
		 */
		flyTo(centerX: number, centerY: number, width: number, height: number, dur: number, speed: number, perc: number, isJump: boolean, limit: boolean, limitZoom: boolean, toOmniIdx: number, fn: number, time: number): number;
		/**
		 * Sets the view center and scale, optionally animating.
		 * @returns The calculated animation duration.
		 */
		setCoo(x: number, y: number, scale: number, dur: number, speed: number, limit: boolean, fn: number, time: number): number;
	}
	/**
	 * High-performance matrix and vector operations for WebGL.
	 * Ported from gl-matrix 3.2.1 (Copyright (c) 2015-2020, Brandon Jones, Colin MacKenzie IV).
	 * Originally ported to AssemblyScript/WASM by marcel@micr.io, 2020.
	 * Re-ported to TypeScript for the Micrio engine.
	 *
	 * @license MIT
	 */
	/** Represents a 4x4 matrix, tailored for WebGL operations. */
	export class Mat4 {
		a0: number;
		a1: number;
		a2: number;
		a3: number;
		a4: number;
		a5: number;
		a6: number;
		a7: number;
		a8: number;
		a9: number;
		a10: number;
		a11: number;
		a12: number;
		a13: number;
		a14: number;
		a15: number;
		/** Float32Array view for direct use with WebGL uniformMatrix4fv. */
		readonly arr: Float32Array;
		/**
		 * Creates a new identity Mat4.
		 * Matrix layout (column-major):
		 * a0 a4 a8 a12
		 * a1 a5 a9 a13
		 * a2 a6 a10 a14
		 * a3 a7 a11 a15
		 */
		constructor(a0?: number, a1?: number, a2?: number, a3?: number, a4?: number, a5?: number, a6?: number, a7?: number, a8?: number, a9?: number, a10?: number, a11?: number, a12?: number, a13?: number, a14?: number, a15?: number);
		/** Updates the internal Float32Array with the current matrix values. */
		toArray(): Float32Array;
		/** Resets the matrix to the identity matrix. */
		identity(): void;
		/** Copies the values from another Mat4 into this one. */
		copy(s: Mat4): void;
		/** Multiplies this matrix by a rotation matrix created from the given angle around the X axis. */
		rotateX(rad: number): void;
		/** Multiplies this matrix by a rotation matrix created from the given angle around the Y axis. */
		rotateY(rad: number): void;
		/** Multiplies this matrix by a rotation matrix created from the given angle around the Z axis. */
		rotateZ(rad: number): void;
		/** Uniform scale applied only to X and Y columns (Z unchanged). */
		scaleFlat(scale: number): void;
		/** Translates the matrix by the given vector [x, y, z]. */
		translate(x: number, y: number, z: number): void;
		/** Generates a perspective projection matrix with the given bounds. */
		perspective(fovy: number, aspect: number, near: number, far: number): void;
		/** Generates a simplified perspective matrix suitable for CSS 3D transforms (no near/far clipping). */
		perspectiveCss(fovy: number): void;
		/** Inverts the matrix. */
		invert(): void;
		/** Multiplies this matrix by another matrix `a` (this = this * a). */
		multiply(a: Mat4): void;
		/** Scales the matrix by the given vector [x, y, z]. */
		scaleXY(x: number, y: number, z?: number): void;
	}
	/** Represents a 4D vector (x, y, z, w). */
	export class Vec4 {
		x: number;
		y: number;
		z: number;
		w: number;
		constructor(x?: number, y?: number, z?: number, w?: number);
		/** Copies the values from another Vec4 into this one. */
		copy(v: Vec4): void;
		/** Transforms the vector by the given Mat4. */
		transformMat4(m: Mat4): void;
		/** Normalizes the vector (scales it to have a length of 1). */
		normalize(): void;
	}
	/**
	 * Represents a single image source (tiled or single) within a Canvas.
	 * Handles tile pyramid, layer management, and tile culling.
	 * @author Marcel Duin <marcel@micr.io>
	 */
	/** Represents a single resolution layer within an Image. */
	class Layer {
		readonly image: Image;
		readonly index: number;
		readonly start: number;
		readonly end: number;
		readonly tileSize: number;
		readonly cols: number;
		readonly rows: number;
		readonly tileWidth: number;
		readonly tileHeight: number;
		constructor(image: Image, index: number, start: number, end: number, tileSize: number, cols: number, rows: number);
		getTileRect(idx: number, r: DrawRect): DrawRect;
	}
	/** Represents a single image source (tiled or single) within a Canvas. */
	export default class Image {
		private readonly canvas;
		readonly index: number;
		readonly localIdx: number;
		readonly width: number;
		readonly height: number;
		readonly tileSize: number;
		readonly isSingle: boolean;
		readonly isVideo: boolean;
		readonly startOffset: number;
		opacity: number;
		tOpacity: number;
		rotX: number;
		rotY: number;
		rotZ: number;
		readonly scale: number;
		readonly fromScale: number;
		private static readonly toDraw;
		private static toDrawSeen;
		private static toDrawSeenBase;
		readonly vec: Vec4;
		readonly mat: Mat4;
		rScale: number;
		readonly layers: Layer[];
		numLayers: number;
		targetLayer: number;
		x0: number;
		y0: number;
		x1: number;
		y1: number;
		rWidth: number;
		rHeight: number;
		areaCenterX: number;
		areaCenterY: number;
		areaWidth: number;
		areaHeight: number;
		sphere3DX: number;
		sphere3DY: number;
		sphere3DZ: number;
		angularWidth: number;
		angularHeight: number;
		gotBase: number;
		readonly endOffset: number;
		aspect: number;
		doneTotal: number;
		doRender: boolean;
		private is360Embed;
		isVideoPlaying: boolean;
		private static sampledXs;
		private static sampledYs;
		private static uniqueXs;
		private static sampledLength;
		private static uniqueLength;
		constructor(canvas: Canvas, index: number, localIdx: number, width: number, height: number, tileSize: number, isSingle: boolean, isVideo: boolean, startOffset: number, opacity: number, tOpacity: number, rotX: number, rotY: number, rotZ: number, scale: number, fromScale: number);
		/** Sets the relative area this image occupies within its parent canvas. */
		setArea(x0: number, y0: number, x1: number, y1: number): void;
		/** Converts 2D sphere coordinates to 3D unit sphere position */
		private calculate3DSpherePosition;
		/**
		 * Checks if embed's 3D sphere position is within camera's viewing frustum
		 */
		private sphere3DOverlap;
		/** Checks if the image's bounding box is completely outside the current view. */
		private outsideView;
		/** Determines if this image should be rendered in the current frame. */
		shouldRender(): boolean;
		/**
		 * Steps the opacity animation for this image.
		 * @returns True if the opacity changed (animation is active or snapped).
		 */
		opacityTick(direct: boolean): boolean;
		/**
		 * Calculates the set of tiles needed to render the current view for this image.
		 * @returns The number of tiles from this image that are already loaded/drawn.
		 */
		getTiles(scale: number): number;
		/** Calculates the target layer index based on the current scale. */
		private getTargetLayer;
		/** Calculates and adds tiles within a given rectangular area for a specific layer. */
		private getTilesRect;
		/**
		 * Calculates tiles for 360 embeds using viewport-based coordinates.
		 */
		private getTilesViewport;
		private setToDraw;
		/** Calculates the vertex positions for an embedded image within a 360 canvas. */
		setDrawRect(r: DrawRect): void;
		/** Calculates the effective scale of an embedded image based on its projection. */
		private getEmbeddedScale;
		private get360Tiles;
	}
	/** Handles 360 camera logic, perspective, and related WebGL calculations. */
	export default class WebGL {
		private canvas;
		readonly pMatrix: Mat4;
		readonly iMatrix: Mat4;
		private readonly cachedInverse;
		private inverseDirty;
		private readonly rMatrix;
		readonly position: Vec4;
		radius: number;
		scale: number;
		scaleY: number;
		offY: number;
		dofY: number;
		limitX: number;
		limitY: number;
		baseYaw: number;
		yaw: number;
		pitch: number;
		defaultPerspective: number;
		perspective: number;
		maxPerspective: number;
		minPerspective: number;
		cameraForwardX: number;
		cameraForwardY: number;
		cameraForwardZ: number;
		cameraUpX: number;
		cameraUpY: number;
		cameraUpZ: number;
		cameraRightX: number;
		cameraRightY: number;
		cameraRightZ: number;
		fieldOfView: number;
		aspectRatio: number;
		readonly vec4: Vec4;
		readonly coo: Coordinates;
		offX: number;
		constructor(canvas: Canvas);
		/** Sets the horizontal and vertical movement limits. */
		setLimits(x: number, y: number): void;
		/** Updates the projection and rotation matrices based on current state. */
		update(noPersp?: boolean): void;
		/**
		 * Applies rotation based on pixel delta from mouse/touch drag.
		 */
		rotate(xPx: number, yPx: number, duration: number, time: number): void;
		/** Clamps the pitch value based on perspective and vertical limits. */
		private limitPitch;
		/** Clamps the yaw value based on horizontal limits. */
		private limitYaw;
		/**
		 * Applies zoom by adjusting the perspective.
		 */
		zoom(factor: number, dur: number, speed: number, noLimit: boolean, t: number, pxX?: number, pxY?: number): number;
		/** Sets the perspective (FoV) and updates related state. */
		setPerspective(perspective: number, noLimit: boolean): void;
		/** Recalculates the effective scale based on coordinate conversion. */
		readScale(): void;
		/** Sets the camera orientation directly. */
		setDirection(yaw: number, pitch: number, persp: number): void;
		/** Sets the camera orientation using viewport format (center + dimensions). */
		setView(centerX: number, centerY: number, _width: number, height: number, noLimit?: boolean, correctNorth?: boolean): void;
		/** Synchronizes the logical view with the current camera state for 360 images. */
		private syncLogicalView;
		/** Calculates 3D camera frustum for accurate 360 embed visibility detection */
		calculate3DFrustum(): void;
		/** Applies translation offset for 360 space transitions. */
		moveTo(distance: number, distanceY: number, direction: number, addYaw: number): void;
		/** Handles canvas resize events for 360 mode. */
		resize(): void;
		/** Ensures the cached inverse projection matrix is up to date. */
		private ensureInverse;
		/** Converts screen pixel coordinates to 360 image coordinates [0-1]. */
		getCoo(pxX: number, pxY: number): Coordinates;
		/** Converts 360 image coordinates [0-1] to screen pixel coordinates. */
		getXYZ(x: number, y: number): Coordinates;
		/**
		 * Calculates the 3D vector corresponding to a point on the 360 sphere.
		 */
		getVec3(x: number, y: number, abs?: boolean, rad?: number): Vec4;
		/**
		 * Calculates the combined transformation matrix for placing an element
		 * at a specific point on the 360 sphere.
		 */
		getMatrix(x: number, y: number, scale: number, radius: number, rX: number, rY: number, rZ: number, transY: number, sX?: number, sY?: number, _noCorrectNorth?: boolean): Mat4;
		/** Generates vertex data for a segment of the 360 sphere geometry. */
		setTile360(x: number, y: number, w: number, h: number): void;
	}
	/**
	 * Represents a single rendering canvas within the Micrio engine.
	 * Orchestrates image loading, tile calculation, camera control, and drawing.
	 * @author Marcel Duin <marcel@micr.io>
	 */
	export default class Canvas {
		readonly main: Main;
		width: number;
		height: number;
		readonly tileSize: number;
		readonly is360: boolean;
		readonly noImage: boolean;
		readonly isSingle: boolean;
		targetOpacity: number;
		readonly freeMove: boolean;
		coverLimit: boolean;
		readonly coverStart: boolean;
		readonly maxScale: number;
		readonly scaleMultiplier: number;
		readonly camSpeed: number;
		readonly rotationY: number;
		readonly isGallerySwitch: boolean;
		readonly pagesHaveBackground: boolean;
		readonly isOmni: boolean;
		readonly pinchZoomOutLimit: boolean;
		readonly omniNumLayers: number;
		readonly omniStartLayer: number;
		readonly hasParent: boolean;
		readonly view: View;
		readonly focus: View;
		readonly ani: Ani;
		readonly kinetic: Kinetic;
		readonly camera: Camera;
		readonly webgl: WebGL;
		readonly rect: DrawRect;
		readonly el: Viewport;
		readonly images: Image[];
		private readonly children;
		readonly area: View;
		readonly currentArea: View;
		readonly targetArea: View;
		readonly visible: View;
		readonly full: View;
		private areaAniPerc;
		private areaAniPaused;
		private _zIndex;
		private childrenDirty;
		get zIndex(): number;
		set zIndex(v: number);
		readonly toDraw: number[];
		readonly aspect: number;
		private index;
		private isVisible;
		opacity: number;
		bOpacity: number;
		isReady: boolean;
		activeImageIdx: number;
		omniFieldOfView: number;
		omniVerticalAngle: number;
		omniDistance: number;
		omniOffsetX: number;
		limited: boolean;
		layer: number;
		constructor(main: Main, width: number, height: number, tileSize: number, is360: boolean, noImage: boolean, isSingle: boolean, targetOpacity: number, freeMove: boolean, coverLimit: boolean, coverStart: boolean, maxScale: number, scaleMultiplier: number, camSpeed: number, rotationY: number, isGallerySwitch: boolean, pagesHaveBackground: boolean, isOmni: boolean, pinchZoomOutLimit: boolean, omniNumLayers: number, omniStartLayer: number, hasParent: boolean);
		/** Reference to the parent canvas (if this is a child/grid item). */
		parent: Canvas;
		/** Sets the parent canvas for a child canvas. */
		setParent(parent: Canvas): void;
		/**
		 * Adds an image source (usually tiled) to this canvas.
		 */
		addImage(x0: number, y0: number, x1: number, y1: number, w: number, h: number, tileSize: number, isSingle: boolean, isVideo: boolean, opa: number, rotX: number, rotY: number, rotZ: number, scale: number, fromScale: number): Image;
		addChild(x0: number, y0: number, x1: number, y1: number, width: number, height: number): Canvas;
		/** Steps the opacity fade animation and applies 360 transition movement. */
		private stepOpacity;
		/** Notifies the JS host about visibility changes. */
		setVisible(b: boolean): void;
		/** Initiates a fade-out animation. */
		fadeOut(): void;
		/** Initiates a fade-in animation. */
		fadeIn(): void;
		/** Checks if the canvas area is currently animating. */
		areaAnimating(): boolean;
		/** Checks if the canvas is effectively hidden. */
		isHidden(): boolean;
		/** Determines if the canvas needs to be drawn in the next frame and calculates tiles needed. */
		shouldDraw(): void;
		/** Executes the drawing commands for the current frame for this canvas. */
		draw(): void;
		private partialView;
		/** Sets the target area for this canvas within its parent, optionally animating. */
		setArea(x0: number, y0: number, x1: number, y1: number, direct: boolean, noDispatch: boolean): void;
		/** Calculates the vertex positions for a given tile index and updates the vertex buffer. */
		private setTile;
		/** Notifies JS host about the current screen viewport details. */
		sendViewport(): void;
		/** Finds the Image, Layer, and calculates the DrawRect for a given global tile index. */
		private findTileRect;
		/** Handles resizing of the canvas element. */
		resize(): void;
		/** Resets the canvas state. */
		reset(): void;
		/** Removes this canvas instance from the main controller. */
		remove(): void;
		/** Re-adds this canvas instance to the main controller. */
		replace(): void;
		/** Sets the active layer for multi-layer omni objects. */
		setActiveLayer(idx: number): void;
		/** Sets the active image(s) for gallery/omni canvases. */
		setActiveImage(idx: number, num: number): void;
		/** Sets the focus area for gallery/grid canvases. */
		setFocus(x0: number, y0: number, x1: number, y1: number, noLimit: boolean): void;
		/** Gets image coordinates from screen coordinates. */
		getCoo(x: number, y: number, abs: boolean, noLimit: boolean): Float64Array;
		/** Gets screen coordinates from image coordinates. */
		getXY(x: number, y: number, abs: boolean, radius: number, rotation: number): Float64Array;
		/** Gets the current logical view array. */
		getView(): Float64Array;
		/** Sets the logical view directly. */
		setView(centerX: number, centerY: number, width: number, height: number, noLimit: boolean, noLastView: boolean, correctNorth?: boolean, forceLimit?: boolean): void;
		getScale(): number;
		isZoomedIn(): boolean;
		isZoomedOut(b?: boolean): boolean;
		setDirection(yaw: number, pitch: number, resetPersp: boolean): void;
		getMatrix(x: number, y: number, s: number, r: number, rX: number, rY: number, rZ: number, t: number, sX?: number, sY?: number, noCorrectNorth?: boolean): Float32Array;
		aniPause(time: number): void;
		aniResume(time: number): void;
		aniStop(): void;
		aniDone(): void;
		aniAbort(): void;
	}
	/**
	 * Shared data structures for the Micrio engine: View, Coordinates, Viewport, DrawRect.
	 * @author Marcel Duin <marcel@micr.io>
	 */
	/** Structure to hold information about a specific tile to be drawn. */
	export class DrawRect {
		/** Left edge of the tile in relative image coordinates (0-1). */
		x0: number;
		/** Top edge of the tile in relative image coordinates (0-1). */
		y0: number;
		/** Right edge of the tile in relative image coordinates (0-1). */
		x1: number;
		/** Bottom edge of the tile in relative image coordinates (0-1). */
		y1: number;
		/** Index of the resolution layer this tile belongs to. */
		layer: number;
		/** Column index of the tile within its layer. */
		x: number;
		/** Row index of the tile within its layer. */
		y: number;
		/** Reference to the Image instance this tile belongs to. */
		image: Image;
		constructor(
		/** Left edge of the tile in relative image coordinates (0-1). */
		x0?: number, 
		/** Top edge of the tile in relative image coordinates (0-1). */
		y0?: number, 
		/** Right edge of the tile in relative image coordinates (0-1). */
		x1?: number, 
		/** Bottom edge of the tile in relative image coordinates (0-1). */
		y1?: number, 
		/** Index of the resolution layer this tile belongs to. */
		layer?: number, 
		/** Column index of the tile within its layer. */
		x?: number, 
		/** Row index of the tile within its layer. */
		y?: number);
	}
	/** Represents the logical view rectangle within an image. */
	export class View {
		private readonly canvas;
		centerX: number;
		centerY: number;
		width: number;
		height: number;
		lCenterX: number;
		lCenterY: number;
		lWidth: number;
		lHeight: number;
		/** Float64Array view of [centerX, centerY, width, height] — for efficient JS access. */
		readonly arr: Float64Array;
		/** Flag indicating if the view coordinates have changed since the last frame. */
		changed: boolean;
		/** Flag indicating if the view limits have changed. */
		limitChanged: boolean;
		constructor(canvas: Canvas, centerX?: number, centerY?: number, width?: number, height?: number, lCenterX?: number, lCenterY?: number, lWidth?: number, lHeight?: number);
		get x0(): number;
		get y0(): number;
		get x1(): number;
		get y1(): number;
		get lX0(): number;
		get lY0(): number;
		get lX1(): number;
		get lY1(): number;
		get yaw(): number;
		get pitch(): number;
		get aspect(): number;
		get size(): number;
		set(centerX: number, centerY: number, width: number, height: number, preserveAspect?: boolean): void;
		/** Sets the relative View area of a MicrioImage to render to, animates by default. Used in grids. */
		setArea(x0: number, y0: number, x1: number, y1: number): void;
		setLimit(lCenterX: number, lCenterY: number, lWidth: number, lHeight: number): void;
		copy(v: View, excludeLimit?: boolean): void;
		/** Calculates the perspective value needed to achieve this view height in 360 mode. */
		getPerspective(): number;
		/** Calculates the effective scale factor represented by this view. */
		getScale(): number;
		/** Calculates a distance metric between this view and another view, used for animation duration. */
		getDistance(v: View, correctAspect: boolean): number;
		limit(correctZoom: boolean, noLimit?: boolean, freeMove?: boolean): void;
		correctAspectRatio(): void;
		/** Updates the shared Float64Array with the current view coordinates. */
		toArray(): Float64Array;
		/** Checks if this view is equal to another view. */
		equals(centerX: number, centerY: number, width: number, height: number): boolean;
		/** Checks if this view represents the full image [0,0,1,1]. */
		isFull(): boolean;
	}
	/** Represents coordinates: relative image coordinates or screen pixel coordinates. */
	export class Coordinates {
		x: number;
		y: number;
		scale: number;
		w: number;
		direction: number;
		/** Float64Array view for efficient JS access [x, y, scale, w/depth, direction]. */
		readonly arr: Float64Array;
		constructor(x?: number, y?: number, scale?: number, w?: number, direction?: number);
		/** Checks if the screen coordinate is potentially within the viewport bounds. */
		inView(v: Viewport): boolean;
		/** Updates the shared Float64Array with the current coordinate values. */
		toArray(): Float64Array;
	}
	/** Represents the screen viewport of a Canvas element. */
	export class Viewport {
		width: number;
		height: number;
		left: number;
		top: number;
		areaWidth: number;
		areaHeight: number;
		ratio: number;
		scale: number;
		isPortrait: boolean;
		/** Int32Array view for efficient JS access [width, height, left, top]. */
		readonly arr: Int32Array;
		constructor(width?: number, height?: number, left?: number, top?: number, areaWidth?: number, areaHeight?: number, ratio?: number, scale?: number, isPortrait?: boolean);
		get centerX(): number;
		get centerY(): number;
		get aspect(): number;
		/** Updates the shared Int32Array with the current viewport dimensions (integer pixels). */
		toArray(): Int32Array;
		/**
		 * Sets the viewport properties, scaling by device pixel ratio.
		 * @returns True if any property changed, false otherwise.
		 */
		set(w: number, h: number, l: number, t: number, r: number, s: number, p: boolean): boolean;
		/** Copies properties from another Viewport object. */
		copy(v: Viewport): void;
	}
	/**
	 * Main controller class for the Micrio engine.
	 * Manages all canvases, global settings, and host callbacks.
	 * @author Marcel Duin <marcel@micr.io>
	 */
	/**
	 * Main controller class for the Micrio engine.
	 * Manages all canvases, global settings, and the render loop.
	 * Host callbacks are set as assignable properties by the JS host.
	 */
	export class Main {
		/** Viewport representing the main HTML element (<micr-io>). */
		readonly el: Viewport;
		/** Vertex buffer for rendering 2D image tiles (quads). */
		readonly vertexBuffer: Float32Array;
		/** Vertex buffer for rendering 360 sphere geometry. */
		readonly vertexBuffer360: Float32Array;
		/** Array holding all active Canvas instances managed by this engine. */
		readonly canvases: Canvas[];
		/** Total number of tiles across all images in all canvases. */
		numTiles: number;
		/** Total number of Image instances across all canvases. */
		numImages: number;
		/** Timestamp of the current frame (performance.now()). */
		now: number;
		/** Flag indicating if any animation is active in any canvas this frame. */
		animating: boolean;
		/** Overall loading progress (0-1) based on tiles drawn vs tiles needed. */
		progress: number;
		/** Total number of tiles needed across all canvases this frame. */
		toDrawTotal: number;
		/** Total number of tiles successfully drawn (or already loaded) across all canvases this frame. */
		doneTotal: number;
		/** Default duration (seconds) for crossfade between canvases. */
		crossfadeDuration: number;
		/** Default duration (seconds) for grid item transitions. */
		gridTransitionDuration: number;
		/** Default easing function for grid transitions. */
		gridTransitionTimingFunction: Bicubic;
		/** Default duration (seconds) for transitions between 360 spaces. */
		spacesTransitionDuration: number;
		/** Default duration (seconds) for fading embedded images/videos. */
		embedFadeDuration: number;
		/** Elasticity factor for kinetic dragging (higher = more movement). */
		dragElasticity: number;
		/** Flag indicating if a binary archive is being used. */
		hasArchive: boolean;
		/** Layer offset when using an archive. */
		archiveLayerOffset: number;
		/** Number of "underzoom" levels. */
		underzoomLevels: number;
		/** Number of lowest resolution layers to skip loading initially. */
		skipBaseLevels: number;
		/** Flag for barebone mode (minimal texture loading). */
		bareBone: boolean;
		/** Flag indicating if the current context is a swipe gallery. */
		isSwipe: boolean;
		/** Flag to disable panning during pinch gestures. */
		noPinchPan: boolean;
		/** Target direction for 360 transition. */
		direction: number;
		/** Horizontal distance for 360 transition. */
		distanceX: number;
		/** Vertical distance for 360 transition. */
		distanceY: number;
		/** Estimated time per frame in seconds (used for animation speed normalization). */
		frameTime: number;
		drawTile: (imgIdx: number, idx: number, layer: number, x: number, y: number, opacity: number, animating: boolean, isTargetLayer: boolean) => boolean;
		drawQuad: (opacity: number) => void;
		getTileOpacity: (idx: number) => number;
		setTileOpacity: (idx: number, direct: boolean, imageOpacity: number) => number;
		setMatrix: (arr: Float32Array) => void;
		setViewport: (x: number, y: number, width: number, height: number) => void;
		aniDone: (c: Canvas) => void;
		aniAbort: (c: Canvas) => void;
		viewSet: (c: Canvas) => void;
		viewportSet: (c: Canvas, x: number, y: number, w: number, h: number) => void;
		setVisible: (c: Canvas, visible: boolean) => void;
		setVisible2: (c: Image, visible: boolean) => void;
		shouldDraw(now: number): boolean;
		draw(): void;
		reset(): void;
		aniStop(): void;
		/**
		 * Updates the main element's viewport dimensions and triggers resize on all canvases.
		 */
		resize(w: number, h: number, l: number, t: number, r: number, s: number, p: boolean): void;
		/** Removes a specific Canvas instance from the managed list. */
		remove(c: Canvas): void;
	}
	/**
	 * The main Micrio compute controller class. Handles the engine lifecycle,
	 * render loop, tile management, and WebGL integration.
	 * Accessed via `micrio.wasm`.
	 */
	export class Wasm {
		micrio: HTMLMicrioElement;
		ready: boolean;
		/** Forget in-memory tiles after X seconds not drawn */
		private deleteAfterSeconds;
		preventDirectionSet: boolean;
		/** Shared Float32Array for standard tile vertex data. */
		_vertexBuffer: Float32Array;
		/** Static Float32Array holding texture coordinates for a standard quad. */
		static readonly _textureBuffer: Float32Array;
		/** Number of horizontal segments used for 360 sphere geometry. */
		static segsX: number;
		/** Number of vertical segments used for 360 sphere geometry. */
		static segsY: number;
		/** Shared Float32Array for 360 tile vertex data. */
		_vertexBuffer360: Float32Array;
		/** Static Float32Array holding texture coordinates for the 360 sphere. */
		static _textureBuffer360: Float32Array;
		/** Flag indicating if the current context is a gallery. */
		private isGallery;
		private now;
		private raf;
		private drawing;
		constructor(micrio: HTMLMicrioElement);
		/**
		 * Initializes the engine (replaces WebAssembly loading).
		 * @throws Error if engine initialization fails
		 */
		load(): Promise<void>;
		/** Unbinds event listeners, stops rendering, and cleans up resources. */
		unbind(): void;
		/**
		 * Sets the currently active canvas/image instance in the engine.
		 */
		setCanvas(canvas?: MicrioImage): void;
		/** Removes a canvas instance from the engine. */
		removeCanvas(c: MicrioImage): void;
		/** Requests the next animation frame. */
		render(): void;
		/**
		 * Callback for the engine to request drawing a tile.
		 * @returns True if the tile texture is ready and drawn, false otherwise.
		 */
		private drawTile;
		/** Add a child image to the current canvas, either embed or independent canvas */
		private addImage;
		/** Add a child independent canvas to the current canvas */
		addChild: (image: MicrioImage, parent: MicrioImage) => Promise<void>;
		setZIndex(ptr: number, z: number): void;
		setGridTransitionDuration(dur: number): void;
		setGridTransitionTimingFunction(fn: number): void;
		setCrossfadeDuration(dur: number): void;
		fadeTo(ptr: number, opacity: number, direct: boolean): void;
		fadeIn(ptr: number): void;
		fadeOut(ptr: number): void;
		areaAnimating(ptr: number): boolean;
		getActiveImageIdx(ptr: number): number;
		setNoPinchPan(v: boolean): void;
		setIsSwipe(v: boolean): void;
		ease(p: number): number;
		panStart(_ptr: number): void;
		panStop(_ptr: number): void;
		pinchStart(ptr: number): void;
		pinch(ptr: number, x0: number, y0: number, x1: number, y1: number): void;
		pinchStop(ptr: number, t: number): void;
		setLimited(ptr: number, v: boolean): void;
		set360Orientation(d: number, dX: number, dY: number): void;
		setCanvasArea(w: number, h: number): void;
		setImageVideoPlaying(ptr: number, playing: boolean): void;
		setImageRotation(ptr: number, rotX: number, rotY: number, rotZ: number): void;
		setOmniSettings(ptr: number, d: number, fov: number, vA: number, oX: number): void;
	}
	/**
	 * Handles swipe gestures for navigating image sequences, particularly for
	 * swipe galleries and Omni object rotation.
	 * @author Marcel Duin <marcel@micr.io>
	 */
	export class GallerySwiper {
		private micrio;
		private length;
		goto: (i: number) => void;
		private opts;
		/** Getter for the current active image/frame index from the Wasm module. */
		get currentIndex(): number;
		/**
		 * Creates a GallerySwiper instance.
		 * @param micrio The main HTMLMicrioElement instance.
		 * @param length The total number of images/frames in the sequence.
		 * @param goto Callback function to navigate to a specific index.
		 * @param opts Swiper options: sensitivity, continuous looping, coverLimit.
		 */
		constructor(micrio: HTMLMicrioElement, length: number, goto: (i: number) => void, // Callback to change the active index
		opts?: {
			sensitivity?: number;
			continuous?: boolean;
			coverLimit?: boolean;
		});
		/** Cleans up event listeners when the swiper is destroyed. */
		destroy(): void;
		/**
		 * Animates smoothly to a target index using requestAnimationFrame.
		 * @param idx The target index.
		 */
		animateTo(idx: number): void;
	}
	/**
	 * # Micrio State management
	 *
	 * Manages the application state using Svelte stores, allowing reactive updates
	 * throughout the UI and providing methods to get/set the overall state.
	 * Replaces the imperative API of Micrio 3.x.
	 *
	 * Consists of two main state controllers:
	 * 1. {@link State.Main}: Global state for the `<micr-io>` element (active tour, marker, UI state).
	 * 2. {@link State.Image}: State specific to individual {@link MicrioImage} instances (view, active marker within that image).
	 *
	 * @see {@link https://doc.micr.io/client/v4/migrating.html | Migrating from Micrio 3.x}
	 * @author Marcel Duin <marcel@micr.io>
	 */
	export namespace State {
		/** Represents the entire serializable state of a Micrio instance. */
		type MicrioStateJSON = {
			/** The ID of the currently active main image. */
			id: string;
			/** Array containing the state of each individual image canvas. */
			c: ImageState[];
			/** Optional information about the currently active tour [tourId, currentTime?, pausedState?]. */
			t?: [string, number?, string?];
			/** Reference to the currently active HTMLMediaElement (unused?). */
			m?: HTMLMediaElement;
		};
		/** Represents the serializable state of a single MicrioImage instance. */
		type ImageState = [
			/** The image ID. */
			string,
			/** The current viewport x0. */
			number,
			/** The current viewport y0. */
			number,
			/** The current viewport x1. */
			number,
			/** The current viewport y1. */
			number,
			/** The ID of the currently opened marker within this image (optional). */
			string?,
			/** The UUID of the media element associated with the opened marker (optional). */
			string?,
			/** The currentTime of the marker's media element (optional). */
			number?,
			/** The paused state ('p') of the marker's media element (optional). */
			string?
		];
		/**
		* # HTMLMicrioElement state controller (`micrio.state`)
		*
		* Manages the global application state associated with the main `<micr-io>` element.
		* Provides Svelte stores for reactive UI updates and methods for state serialization.
		*/
		class Main {
			private micrio;
			/** Writable Svelte store holding the currently active tour object (VideoTour or MarkerTour), or undefined if no tour is active. */
			readonly tour: Writable<Models.ImageData.VideoTour | Models.ImageData.MarkerTour | undefined>;
			/** Getter for the current value of the {@link tour} store. */
			get $tour(): Models.ImageData.VideoTour | Models.ImageData.MarkerTour | undefined;
			/** Writable Svelte store holding the marker object currently opened in the *main* active image, or undefined if none is open. */
			readonly marker: Writable<Models.ImageData.Marker | undefined>;
			/** Writable Svelte store holding the ID of the marker currently being hovered over. */
			readonly markerHoverId: Writable<string | undefined>;
			/** Getter for the current value of the {@link marker} store. */
			get $marker(): Models.ImageData.Marker | undefined;
			/** Writable Svelte store holding the marker object whose popup is currently displayed. */
			readonly popup: Writable<Models.ImageData.Marker | undefined>;
			/** Writable Svelte store holding the data for the currently displayed popover (custom page or gallery). See {@link Models.State.PopoverType}. */
			readonly popover: Writable<Models.State.PopoverType | undefined>;
			/** UI state stores. */
			ui: {
				/** Writable store controlling the visibility of the main UI controls (bottom right). */
				controls: Writable<boolean>;
				/** Writable store controlling the visibility of zoom buttons. */
				zoom: Writable<boolean>;
				/** Writable store controlling the visibility of all UI elements (e.g., for fullscreen or specific modes). */
				hidden: Writable<boolean>;
				/** Writable store: true when gallery controls are hovered or focused, keeping all UI visible. */
				hover: Writable<boolean>;
			};
			/**
			 * Gets the current state of the Micrio viewer as a serializable JSON object.
			 * This object captures the active image(s), viewports, open markers, active tour,
			 * and media playback states, allowing the exact state to be restored later or elsewhere.
			 *
			 * @example
			 * ```javascript
			 * const currentState = micrio.state.get();
			 * // Store or transmit `currentState`
			 * ```
			 * @returns The current state as a {@link MicrioStateJSON} object, or undefined if no image is loaded.
			 */
			get(): MicrioStateJSON | undefined;
			/**
			 * Sets the Micrio viewer state from a previously saved {@link MicrioStateJSON} object.
			 * This will attempt to restore the active image, viewports, open markers, active tour,
			 * and media playback states.
			 *
			 * @example
			 * ```javascript
			 * const savedState = // ... load state object ...
			 * micrio.state.set(savedState);
			 * ```
			 * @param s The state object to load.
			 */
			set(s: MicrioStateJSON): Promise<void>;
		}
		/**
		* # MicrioImage state controller (`micrioImage.state`)
		*
		* Manages the state specific to a single {@link MicrioImage} instance,
		* primarily its viewport and currently opened marker.
		*/
		class Image {
			private image;
			/** Writable Svelte store holding the current viewport [centerX, centerY, width, height] of this image. */
			readonly view: Writable<Models.Camera.View | undefined>;
			/** Getter for the current value of the {@link view} store. */
			get $view(): Models.Camera.View | undefined;
			/**
			 * Writable Svelte store holding the currently active marker within *this specific image*.
			 * Can be set with a marker ID string or a full marker object. Setting to undefined closes the marker.
			 */
			readonly marker: Writable<Models.ImageData.Marker | string | undefined>;
			/** Getter for the current value of the {@link marker} store. */
			get $marker(): Models.ImageData.Marker | undefined;
			/** Writable Svelte store holding the currently displayed layer index (for Omni objects). */
			readonly layer: Writable<number>;
		}
	}
	/**
	 * Represents and controls a single Micrio image instance within the viewer.
	 * This class manages the image's metadata (info), cultural data (data),
	 * settings, camera, state, and interactions with the WebAssembly module
	 * for rendering and processing. It handles loading image tiles, embeds,
	 * markers, tours, and galleries associated with the image.
	 *
	 * Instances are typically created and managed by the main {@link HTMLMicrioElement}.
	 * @author Marcel Duin <marcel@micr.io>
	*/
	export class MicrioImage {
		wasm: Wasm;
		private attr;
		opts: {
			/** Optional sub area [x0, y0, x1, y1] defining placement within a parent canvas (for embeds/galleries). */
			area?: Models.Camera.ViewRect;
			/** For split screen, the primary image this one is secondary to. */
			secondaryTo?: MicrioImage;
			/** If true, passively follows the view changes of the primary split-screen image. */
			isPassive?: boolean;
			/** If true, this image is embedded within another image (affects rendering/camera). */
			isEmbed?: boolean;
			/** If true, uses the parent image's camera instead of creating its own (for switch/omni galleries). */
			useParentCamera?: boolean;
		};
		/** The unique identifier (Micrio ID) for this image. */
		id: string;
		/** A unique instance identifier (UUID) generated for this specific instance. */
		readonly uuid: string;
		/** Svelte Readable store holding the image's core information (dimensions, format, settings, etc.). See {@link Models.ImageInfo.ImageInfo}. */
		readonly info: Readable<Models.ImageInfo.ImageInfo | undefined>;
		/** Getter for the current value of the {@link info} store.
		 * @readonly
		*/
		get $info(): Models.ImageInfo.ImageInfo | undefined;
		/** Svelte Writable store holding the image's specific settings, often merged from attributes and info data. See {@link Models.ImageInfo.Settings}. */
		readonly settings: Writable<Models.ImageInfo.Settings>;
		/** Getter for the current value of the {@link settings} store. */
		get $settings(): Models.ImageInfo.Settings;
		/** Svelte Writable store holding the image's cultural data (markers, tours, text content for the current language). See {@link Models.ImageData.ImageData}. */
		readonly data: Writable<Models.ImageData.ImageData | undefined>;
		/** Getter for the current value of the {@link data} store. */
		get $data(): Models.ImageData.ImageData | undefined;
		/** State manager specific to this image instance (view, active marker, etc.). See {@link State.Image}. */
		readonly state: State.Image;
		/** The virtual camera instance controlling the view for this image. */
		camera: Camera;
		/** Svelte Writable store holding the HTMLVideoElement if this image represents a video. */
		readonly video: Writable<HTMLVideoElement | undefined>;
		/** Svelte Writable store indicating if this image's canvas is currently visible and being rendered.
		 * @readonly
		*/
		readonly visible: Writable<boolean>;
		/** Album information if this image is part of a V5 album. */
		album?: Models.Album | undefined;
		/** Gallery swiper instance, if this image is part of a swipe gallery. */
		swiper: GallerySwiper | undefined;
		/** Stores the camera view state when a marker is opened, used to return to the previous view. */
		openedView: Models.Camera.View | undefined;
		/** Base path URI for fetching `data.[lang].json` files. */
		dataPath: string;
		/** Stores an error message if loading failed. */
		error: string | undefined;
		/** Svelte Writable store holding the calculated pixel viewport [left, top, width, height] of this image within the main canvas. */
		readonly viewport: Writable<Models.Camera.ViewRect>;
		/** Array of child {@link MicrioImage} instances embedded within this image. */
		readonly embeds: MicrioImage[];
		/** Grid controller instance, if this image is a grid container. */
		grid: Grid | undefined;
		/** Base path for fetching image tiles. */
		tileBase: string | undefined;
		/**
		 * Adds an embedded MicrioImage (representing another Micrio image or video) within this image.
		 * @param info Partial info data for the embed.
		 * @param area The placement area `[x0, y0, x1, y1]` within the parent image.
		 * @param opts Embedding options (opacity, fit, etc.).
		 * @returns The newly created embedded {@link MicrioImage} instance.
		 */
		addEmbed(info: Partial<Models.ImageInfo.ImageInfo>, area: Models.Camera.ViewRect, opts?: Models.Embeds.EmbedOptions): MicrioImage;
		/** Gets the HTMLMediaElement associated with a video embed ID. */
		getEmbedMediaElement(id: string): HTMLMediaElement | undefined;
		/** Fades in the image smoothly or instantly. */
		fadeIn(direct?: boolean): void;
		/** Fades out the image smoothly or instantly. */
		fadeOut(direct?: boolean): void;
	}
	/**
	 * Direction-keyed area rectangles for grid/gallery slide and swipe transitions.
	 * Areas use [x0, y0, x1, y1] in normalized parent-canvas coordinates and
	 * extend outside [0,1] to represent off-screen positions.
	 *
	 * Direction conventions (degrees of motion of the entering image):
	 *   0   = enters from top
	 *   90  = enters from right
	 *   180 = enters from bottom
	 *   270 = enters from left
	 *
	 * @author Marcel Duin <marcel@micr.io>
	 */
	/** Slide transition entry areas (entering image starts half-off-screen). */
	export const slideAreas: Record<number, Models.Camera.ViewRect>;
	/** Swipe transition entry areas (entering image starts fully off-screen). */
	export const swipeAreas: Record<number, Models.Camera.ViewRect>;
	/** Swipe transition exit areas (leaving image moves fully off-screen). */
	export const swipeExitAreas: Record<number, Models.Camera.ViewRect>;
	/** Centered visible slot. */
	export const centerArea: Models.Camera.ViewRect;
	/** Off-screen slot to the left, same height. */
	export const leftSlot: Models.Camera.ViewRect;
	/** Off-screen slot to the right, same height. */
	export const rightSlot: Models.Camera.ViewRect;
	/**
	 * Returns the horizontal slot area for an integer offset from the active slot.
	 * offset=0 → centered visible; positive → off to the right; negative → off to the left.
	 */
	export const horizontalSlot: (offset: number) => Models.Camera.ViewRect;
	/**
	 * Micrio grid display controller
	 * @author Marcel Duin <marcel@micr.io>
	 */
	/**
	 * Controls the display and interaction logic for grid layouts.
	 * Instantiated on the primary {@link MicrioImage} if grid data is present.
	 * Accessed via `micrioImage.grid`.
	 */
	export class Grid {
		micrio: HTMLMicrioElement;
		image: MicrioImage;
		/** Array of {@link MicrioImage} instances currently part of the grid definition (loaded). */
		readonly images: MicrioImage[];
		/** Array of {@link MicrioImage} instances currently visible in the grid layout. */
		current: MicrioImage[];
		/** If true, the HTML grid overlay remains visible and interactive even when an image is focused. */
		clickable: boolean;
		/** Writable Svelte store holding the currently focused {@link MicrioImage} instance, or undefined if in grid view. */
		readonly focussed: Writable<MicrioImage | undefined>;
		/** Getter for the current value of the {@link focussed} store. */
		get $focussed(): MicrioImage | undefined;
		/** Writable Svelte store holding an array of {@link MicrioImage} instances whose markers should be displayed in the grid view. */
		readonly markersShown: Writable<MicrioImage[]>;
		/** Array storing the history of grid layouts for back navigation. */
		history: Models.Grid.GridHistory[];
		/** Writable Svelte store indicating the current depth in the grid history stack. */
		depth: Writable<number>;
		/** Default animation duration (seconds) when transitioning *into* a new layout or focused view. */
		aniDurationIn: number;
		/** Default animation duration (seconds) when transitioning *out* of a focused view or going back in history. */
		aniDurationOut: number;
		/** Delay (seconds) between individual image transitions for 'delayed' effects. */
		transitionDelay: number;
		/**
		 * The Grid constructor. Initializes the grid based on image settings.
		 * @param micrio The main HTMLMicrioElement instance.
		 * @param image The MicrioImage instance acting as the virtual container for the grid.
		*/
		constructor(micrio: HTMLMicrioElement, image: MicrioImage);
		/**
		 * Sets the grid layout based on an input string or array of image definitions.
		 * This is the main method for changing the grid's content and appearance.
		 *
		 * @param input The grid definition. Can be:
		 *   - A semicolon-separated string following the format defined in `Grid.getString`.
		 *   - An array of {@link MicrioImage} instances.
		 *   - An array of objects `{image: MicrioImage, ...GridImageOptions}`.
		 * @param opts Options controlling the transition and layout.
		 * @returns A Promise that resolves with the array of currently displayed {@link MicrioImage} instances when the transition completes.
		*/
		set(input?: string | MicrioImage[] | ({
			image: MicrioImage;
		} & Models.Grid.GridImageOptions)[], opts?: {
			noHistory?: boolean;
			keepGrid?: boolean;
			horizontal?: boolean;
			duration?: number;
			view?: Models.Camera.View;
			noCamAni?: boolean;
			forceAreaAni?: boolean;
			noBlur?: boolean;
			noFade?: boolean;
			transition?: Models.Grid.GridSetTransition;
			forceAni?: boolean;
			coverLimit?: boolean;
			cover?: boolean;
			scale?: number;
			columns?: number;
		}): Promise<MicrioImage[]>;
		/**
		 * Parses an individual image grid string into a GridImage object.
		 * @param s The grid string for a single image.
		 * @returns The parsed `Models.Grid.GridImage` object.
		*/
		getImage(s: string): Models.Grid.GridImage;
		/**
		 * Converts an ImageInfo object and options back into the grid string format.
		 * @returns The grid encoded string for this image.
		*/
		getString: (i: Models.ImageInfo.ImageInfo, opts?: Models.Grid.GridImageOptions) => string;
		/** Fade out unused images in the grid and clean up their button references.
		 * @param images The images to hide
		*/
		private removeImages;
		/** Checks whether current viewed image is (part of) grid */
		insideGrid(): boolean;
		/** Reset the grid to its initial layout
		 * @param duration Duration in seconds
		 * @param noCamAni Don't do any camera animating
		 * @param forceAni Force animation on all grid images
		 * @returns Promise when the transition is complete
		*/
		reset(duration?: number, noCamAni?: boolean, forceAni?: boolean): Promise<MicrioImage[]>;
		/** Fly to the viewports of any markers containing a class name
		 * @param tag The class name to match
		 * @param duration Optional duration in ms
		 * @param noZoom Don't zoom into the markers, just filter the images
		 * @returns Promise when the transition is complete
		*/
		flyToMarkers(tag?: string, duration?: number, noZoom?: boolean): Promise<MicrioImage[]>;
		/** Go back one step in the grid history
		 * @param duration Optional duration for transition
		 * @returns Promise when the transition is complete
		*/
		back(duration?: number): Promise<void>;
		/** Open a grid image full size and set it as the main active image
		 * @param img The image
		 * @param opts Focus options
		 * @returns Promise for when the transition completes
		*/
		focus(img: MicrioImage | undefined, opts?: Models.Grid.FocusOptions): Promise<void>;
		/** Unfocusses any currently focussed image */
		blur(): void;
		/** Do an (external) action
		 * @param action The action type enum or string
		 * @param data Optional action data
		 * @param duration Optional action duration
		*/
		action(action: Enums.Grid.GridActionType | string, data?: string, duration?: number): void;
		/** Enlarge a specific image idx of the currently shown grid
		 * @param idx The image index of the current grid
		 * @param width The image target number of columns
		 * @param height The image target number of rows
		 * @returns Promise when the transition is completed
		*/
		enlarge(idx: number, width: number, height?: number): Promise<MicrioImage[]>;
		/** Get the relative in-grid viewport of the image */
		getRelativeView(image: MicrioImage, view: Models.Camera.ViewRect): Models.Camera.ViewRect;
	}
	/**
	 * Video tour controller. Manages playback and camera animation for video tours
	 * defined by a timeline of view rectangles and durations.
	 * @author Marcel Duin <marcel@micr.io>
	 */
	/**
	 * Controls the playback of a video tour, animating the camera according
	 * to a predefined timeline and synchronizing with associated audio/video media.
	 * Instances are typically created and managed by the `Tour.svelte` component.
	 */
	export class VideoTourInstance {
		private image;
		private data;
		/**
		 * Creates a VideoTourInstance.
		 * @param image The parent {@link MicrioImage} instance.
		 * @param data The {@link Models.ImageData.VideoTour} data object.
		 */
		constructor(image: MicrioImage, data: Models.ImageData.VideoTour);
		/** Cleans up the tour instance, stops animations, and re-hooks events if necessary. */
		destroy(): void;
		/** Parses the raw timeline data from the tour content into the internal `timeline` array. */
		read(): void;
		/** Getter for the total duration of the tour in seconds. */
		get duration(): number;
		/** Setter for the total duration (updates internal content). */
		set duration(v: number);
		/** Getter for the current paused state. */
		get paused(): boolean;
		/** Getter indicating if the tour has ended. */
		get ended(): boolean;
		/** Getter for the current playback time in seconds. */
		get currentTime(): number;
		/** Setter for the current playback time (seeks to the corresponding progress). */
		set currentTime(v: number);
		/** Getter for the current progress percentage (0-1). */
		get progress(): number;
		/** Setter for the current progress percentage (seeks to that point). */
		set progress(v: number);
		/** Starts or resumes tour playback. */
		play(): void;
		/** Pauses the tour playback. */
		pause(): void;
		/**
		 * Seeks the tour to a specific progress percentage.
		 * @param perc The target progress (0-1).
		 */
		private setProgress;
	}
	/**
	 * Lightweight inline SVG icon definitions, replacing @fortawesome/free-solid-svg-icons + svelte-fa.
	 * Each icon is a tuple: [width, height, svgPath].
	 * @author Marcel Duin <marcel@micr.io>
	 */
	export type MicrioIcon = [width: number, height: number, path: string];
	export const icons: {
		readonly arrowDown: [384, 512, "M169.4 502.6c12.5 12.5 32.8 12.5 45.3 0l160-160c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L224 402.7 224 32c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 370.7-105.4-105.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3l160 160z"];
		readonly arrowLeft: [512, 512, "M9.4 233.4c-12.5 12.5-12.5 32.8 0 45.3l160 160c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L109.3 288 480 288c17.7 0 32-14.3 32-32s-14.3-32-32-32l-370.7 0 105.4-105.4c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0l-160 160z"];
		readonly arrowRight: [512, 512, "M502.6 278.6c12.5-12.5 12.5-32.8 0-45.3l-160-160c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L402.7 224 32 224c-17.7 0-32 14.3-32 32s14.3 32 32 32l370.7 0-105.4 105.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0l160-160z"];
		readonly arrowUp: [384, 512, "M214.6 9.4c-12.5-12.5-32.8-12.5-45.3 0l-160 160c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L160 109.3 160 480c0 17.7 14.3 32 32 32s32-14.3 32-32l0-370.7 105.4 105.4c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3l-160-160z"];
		readonly bars: [448, 512, "M0 96C0 78.3 14.3 64 32 64l384 0c17.7 0 32 14.3 32 32s-14.3 32-32 32L32 128C14.3 128 0 113.7 0 96zM0 256c0-17.7 14.3-32 32-32l384 0c17.7 0 32 14.3 32 32s-14.3 32-32 32L32 288c-17.7 0-32-14.3-32-32zM448 416c0 17.7-14.3 32-32 32L32 448c-17.7 0-32-14.3-32-32s14.3-32 32-32l384 0c17.7 0 32 14.3 32 32z"];
		readonly chevronDown: [448, 512, "M201.4 406.6c12.5 12.5 32.8 12.5 45.3 0l192-192c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L224 338.7 54.6 169.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3l192 192z"];
		readonly circleExclamation: [512, 512, "M256 512a256 256 0 1 1 0-512 256 256 0 1 1 0 512zm0-192a32 32 0 1 0 0 64 32 32 0 1 0 0-64zm0-192c-18.2 0-32.7 15.5-31.4 33.7l7.4 104c.9 12.6 11.4 22.3 23.9 22.3 12.6 0 23-9.7 23.9-22.3l7.4-104c1.3-18.2-13.1-33.7-31.4-33.7z"];
		readonly closedCaptioning: [512, 512, "M0 128C0 92.7 28.7 64 64 64l384 0c35.3 0 64 28.7 64 64l0 256c0 35.3-28.7 64-64 64L64 448c-35.3 0-64-28.7-64-64L0 128zm152 80l32 0c4.4 0 8 3.6 8 8 0 13.3 10.7 24 24 24s24-10.7 24-24c0-30.9-25.1-56-56-56l-32 0c-30.9 0-56 25.1-56 56l0 80c0 30.9 25.1 56 56 56l32 0c30.9 0 56-25.1 56-56 0-13.3-10.7-24-24-24s-24 10.7-24 24c0 4.4-3.6 8-8 8l-32 0c-4.4 0-8-3.6-8-8l0-80c0-4.4 3.6-8 8-8zm168 8c0-4.4 3.6-8 8-8l32 0c4.4 0 8 3.6 8 8 0 13.3 10.7 24 24 24s24-10.7 24-24c0-30.9-25.1-56-56-56l-32 0c-30.9 0-56 25.1-56 56l0 80c0 30.9 25.1 56 56 56l32 0c30.9 0 56-25.1 56-56 0-13.3-10.7-24-24-24s-24 10.7-24 24c0 4.4-3.6 8-8 8l-32 0c-4.4 0-8-3.6-8-8l0-80z"];
		readonly compress: [448, 512, "M160 64c0-17.7-14.3-32-32-32S96 46.3 96 64l0 64-64 0c-17.7 0-32 14.3-32 32s14.3 32 32 32l96 0c17.7 0 32-14.3 32-32l0-96zM32 320c-17.7 0-32 14.3-32 32s14.3 32 32 32l64 0 0 64c0 17.7 14.3 32 32 32s32-14.3 32-32l0-96c0-17.7-14.3-32-32-32l-96 0zM352 64c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 96c0 17.7 14.3 32 32 32l96 0c17.7 0 32-14.3 32-32s-14.3-32-32-32l-64 0 0-64zM320 320c-17.7 0-32 14.3-32 32l0 96c0 17.7 14.3 32 32 32s32-14.3 32-32l0-64 64 0c17.7 0 32-14.3 32-32s-14.3-32-32-32l-96 0z"];
		readonly ellipsisVertical: [128, 512, "M64 144a56 56 0 1 1 0-112 56 56 0 1 1 0 112zm0 224c30.9 0 56 25.1 56 56s-25.1 56-56 56-56-25.1-56-56 25.1-56 56-56zm56-112c0 30.9-25.1 56-56 56s-56-25.1-56-56 25.1-56 56-56 56 25.1 56 56z"];
		readonly expand: [448, 512, "M32 32C14.3 32 0 46.3 0 64l0 96c0 17.7 14.3 32 32 32s32-14.3 32-32l0-64 64 0c17.7 0 32-14.3 32-32s-14.3-32-32-32L32 32zM64 352c0-17.7-14.3-32-32-32S0 334.3 0 352l0 96c0 17.7 14.3 32 32 32l96 0c17.7 0 32-14.3 32-32s-14.3-32-32-32l-64 0 0-64zM320 32c-17.7 0-32 14.3-32 32s14.3 32 32 32l64 0 0 64c0 17.7 14.3 32 32 32s32-14.3 32-32l0-96c0-17.7-14.3-32-32-32l-96 0zM448 352c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 64-64 0c-17.7 0-32 14.3-32 32s14.3 32 32 32l96 0c17.7 0 32-14.3 32-32l0-96z"];
		readonly externalLink: [512, 512, "M320 0c-17.7 0-32 14.3-32 32s14.3 32 32 32l82.7 0-201.4 201.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L448 109.3 448 192c0 17.7 14.3 32 32 32s32-14.3 32-32l0-160c0-17.7-14.3-32-32-32L320 0zM80 96C35.8 96 0 131.8 0 176L0 432c0 44.2 35.8 80 80 80l256 0c44.2 0 80-35.8 80-80l0-80c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 80c0 8.8-7.2 16-16 16L80 448c-8.8 0-16-7.2-16-16l0-256c0-8.8 7.2-16 16-16l80 0c17.7 0 32-14.3 32-32s-14.3-32-32-32L80 96z"];
		readonly globe: [512, 512, "M351.9 280l-190.9 0c2.9 64.5 17.2 123.9 37.5 167.4 11.4 24.5 23.7 41.8 35.1 52.4 11.2 10.5 18.9 12.2 22.9 12.2s11.7-1.7 22.9-12.2c11.4-10.6 23.7-28 35.1-52.4 20.3-43.5 34.6-102.9 37.5-167.4zM160.9 232l190.9 0C349 167.5 334.7 108.1 314.4 64.6 303 40.2 290.7 22.8 279.3 12.2 268.1 1.7 260.4 0 256.4 0s-11.7 1.7-22.9 12.2c-11.4 10.6-23.7 28-35.1 52.4-20.3 43.5-34.6 102.9-37.5 167.4zm-48 0C116.4 146.4 138.5 66.9 170.8 14.7 78.7 47.3 10.9 131.2 1.5 232l111.4 0zM1.5 280c9.4 100.8 77.2 184.7 169.3 217.3-32.3-52.2-54.4-131.7-57.9-217.3L1.5 280zm398.4 0c-3.5 85.6-25.6 165.1-57.9 217.3 92.1-32.7 159.9-116.5 169.3-217.3l-111.4 0zm111.4-48C501.9 131.2 434.1 47.3 342 14.7 374.3 66.9 396.4 146.4 399.9 232l111.4 0z"];
		readonly image: [448, 512, "M64 32C28.7 32 0 60.7 0 96L0 416c0 35.3 28.7 64 64 64l320 0c35.3 0 64-28.7 64-64l0-320c0-35.3-28.7-64-64-64L64 32zm64 80a48 48 0 1 1 0 96 48 48 0 1 1 0-96zM272 224c8.4 0 16.1 4.4 20.5 11.5l88 144c4.5 7.4 4.7 16.7 .5 24.3S368.7 416 360 416L88 416c-8.9 0-17.2-5-21.3-12.9s-3.5-17.5 1.6-24.8l56-80c4.5-6.4 11.8-10.2 19.7-10.2s15.2 3.8 19.7 10.2l26.4 37.8 61.4-100.5c4.4-7.1 12.1-11.5 20.5-11.5z"];
		readonly layerGroup: [512, 512, "M232.5 5.2c14.9-6.9 32.1-6.9 47 0l218.6 101c8.5 3.9 13.9 12.4 13.9 21.8s-5.4 17.9-13.9 21.8l-218.6 101c-14.9 6.9-32.1 6.9-47 0L13.9 149.8C5.4 145.8 0 137.3 0 128s5.4-17.9 13.9-21.8L232.5 5.2zM48.1 218.4l164.3 75.9c27.7 12.8 59.6 12.8 87.3 0l164.3-75.9 34.1 15.8c8.5 3.9 13.9 12.4 13.9 21.8s-5.4 17.9-13.9 21.8l-218.6 101c-14.9 6.9-32.1 6.9-47 0L13.9 277.8C5.4 273.8 0 265.3 0 256s5.4-17.9 13.9-21.8l34.1-15.8zM13.9 362.2l34.1-15.8 164.3 75.9c27.7 12.8 59.6 12.8 87.3 0l164.3-75.9 34.1 15.8c8.5 3.9 13.9 12.4 13.9 21.8s-5.4 17.9-13.9 21.8l-218.6 101c-14.9 6.9-32.1 6.9-47 0L13.9 405.8C5.4 401.8 0 393.3 0 384s5.4-17.9 13.9-21.8z"];
		readonly link: [576, 512, "M419.5 96c-16.6 0-32.7 4.5-46.8 12.7-15.8-16-34.2-29.4-54.5-39.5 28.2-24 64.1-37.2 101.3-37.2 86.4 0 156.5 70 156.5 156.5 0 41.5-16.5 81.3-45.8 110.6l-71.1 71.1c-29.3 29.3-69.1 45.8-110.6 45.8-86.4 0-156.5-70-156.5-156.5 0-1.5 0-3 .1-4.5 .5-17.7 15.2-31.6 32.9-31.1s31.6 15.2 31.1 32.9c0 .9 0 1.8 0 2.6 0 51.1 41.4 92.5 92.5 92.5 24.5 0 48-9.7 65.4-27.1l71.1-71.1c17.3-17.3 27.1-40.9 27.1-65.4 0-51.1-41.4-92.5-92.5-92.5zM275.2 173.3c-1.9-.8-3.8-1.9-5.5-3.1-12.6-6.5-27-10.2-42.1-10.2-24.5 0-48 9.7-65.4 27.1L91.1 258.2c-17.3 17.3-27.1 40.9-27.1 65.4 0 51.1 41.4 92.5 92.5 92.5 16.5 0 32.6-4.4 46.7-12.6 15.8 16 34.2 29.4 54.6 39.5-28.2 23.9-64 37.2-101.3 37.2-86.4 0-156.5-70-156.5-156.5 0-41.5 16.5-81.3 45.8-110.6l71.1-71.1c29.3-29.3 69.1-45.8 110.6-45.8 86.6 0 156.5 70.6 156.5 156.9 0 1.3 0 2.6 0 3.9-.4 17.7-15.1 31.6-32.8 31.2s-31.6-15.1-31.2-32.8c0-.8 0-1.5 0-2.3 0-33.7-18-63.3-44.8-79.6z"];
		readonly minus: [448, 512, "M0 256c0-17.7 14.3-32 32-32l384 0c17.7 0 32 14.3 32 32s-14.3 32-32 32L32 288c-17.7 0-32-14.3-32-32z"];
		readonly pause: [384, 512, "M48 32C21.5 32 0 53.5 0 80L0 432c0 26.5 21.5 48 48 48l64 0c26.5 0 48-21.5 48-48l0-352c0-26.5-21.5-48-48-48L48 32zm224 0c-26.5 0-48 21.5-48 48l0 352c0 26.5 21.5 48 48 48l64 0c26.5 0 48-21.5 48-48l0-352c0-26.5-21.5-48-48-48l-64 0z"];
		readonly play: [448, 512, "M91.2 36.9c-12.4-6.8-27.4-6.5-39.6 .7S32 57.9 32 72l0 368c0 14.1 7.5 27.2 19.6 34.4s27.2 7.5 39.6 .7l336-184c12.8-7 20.8-20.5 20.8-35.1s-8-28.1-20.8-35.1l-336-184z"];
		readonly playCircle: [512, 512, "M0 256a256 256 0 1 1 512 0 256 256 0 1 1 -512 0zM188.3 147.1c-7.6 4.2-12.3 12.3-12.3 20.9l0 176c0 8.7 4.7 16.7 12.3 20.9s16.8 4.1 24.3-.5l144-88c7.1-4.4 11.5-12.1 11.5-20.5s-4.4-16.1-11.5-20.5l-144-88c-7.4-4.5-16.7-4.7-24.3-.5z"];
		readonly plus: [448, 512, "M256 64c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 160-160 0c-17.7 0-32 14.3-32 32s14.3 32 32 32l160 0 0 160c0 17.7 14.3 32 32 32s32-14.3 32-32l0-160 160 0c17.7 0 32-14.3 32-32s-14.3-32-32-32l-160 0 0-160z"];
		readonly share: [512, 512, "M307.8 18.4c-12 5-19.8 16.6-19.8 29.6l0 80-112 0c-97.2 0-176 78.8-176 176 0 113.3 81.5 163.9 100.2 174.1 2.5 1.4 5.3 1.9 8.1 1.9 10.9 0 19.7-8.9 19.7-19.7 0-7.5-4.3-14.4-9.8-19.5-9.4-8.8-22.2-26.4-22.2-56.7 0-53 43-96 96-96l96 0 0 80c0 12.9 7.8 24.6 19.8 29.6s25.7 2.2 34.9-6.9l160-160c12.5-12.5 12.5-32.8 0-45.3l-160-160c-9.2-9.2-22.9-11.9-34.9-6.9z"];
		readonly video: [576, 512, "M96 64c-35.3 0-64 28.7-64 64l0 256c0 35.3 28.7 64 64 64l256 0c35.3 0 64-28.7 64-64l0-256c0-35.3-28.7-64-64-64L96 64zM464 336l73.5 58.8c4.2 3.4 9.4 5.2 14.8 5.2 13.1 0 23.7-10.6 23.7-23.7l0-240.6c0-13.1-10.6-23.7-23.7-23.7-5.4 0-10.6 1.8-14.8 5.2L464 176 464 336z"];
		readonly volumeHigh: [640, 512, "M533.6 32.5c-10.3-8.4-25.4-6.8-33.8 3.5s-6.8 25.4 3.5 33.8C557.5 113.8 592 180.8 592 256s-34.5 142.2-88.7 186.3c-10.3 8.4-11.8 23.5-3.5 33.8s23.5 11.8 33.8 3.5C598.5 426.7 640 346.2 640 256S598.5 85.2 533.6 32.5zM473.1 107c-10.3-8.4-25.4-6.8-33.8 3.5s-6.8 25.4 3.5 33.8C475.3 170.7 496 210.9 496 256s-20.7 85.3-53.2 111.8c-10.3 8.4-11.8 23.5-3.5 33.8s23.5 11.8 33.8 3.5c43.2-35.2 70.9-88.9 70.9-149s-27.7-113.8-70.9-149zm-60.5 74.5c-10.3-8.4-25.4-6.8-33.8 3.5s-6.8 25.4 3.5 33.8C393.1 227.6 400 241 400 256s-6.9 28.4-17.7 37.3c-10.3 8.4-11.8 23.5-3.5 33.8s23.5 11.8 33.8 3.5C434.1 312.9 448 286.1 448 256s-13.9-56.9-35.4-74.5zM80 352l48 0 134.1 119.2c6.4 5.7 14.6 8.8 23.1 8.8 19.2 0 34.8-15.6 34.8-34.8l0-378.4c0-19.2-15.6-34.8-34.8-34.8-8.5 0-16.7 3.1-23.1 8.8L128 160 80 160c-26.5 0-48 21.5-48 48l0 96c0 26.5 21.5 48 48 48z"];
		readonly volumeXmark: [576, 512, "M48 352l48 0 134.1 119.2c6.4 5.7 14.6 8.8 23.1 8.8 19.2 0 34.8-15.6 34.8-34.8l0-378.4c0-19.2-15.6-34.8-34.8-34.8-8.5 0-16.7 3.1-23.1 8.8L96 160 48 160c-26.5 0-48 21.5-48 48l0 96c0 26.5 21.5 48 48 48zM367 175c-9.4 9.4-9.4 24.6 0 33.9l47 47-47 47c-9.4 9.4-9.4 24.6 0 33.9s24.6 9.4 33.9 0l47-47 47 47c9.4 9.4 24.6 9.4 33.9 0s9.4-24.6 0-33.9l-47-47 47-47c9.4-9.4 9.4-24.6 0-33.9s-24.6-9.4-33.9 0l-47 47-47-47c-9.4-9.4-24.6-9.4-33.9 0z"];
		readonly xmark: [384, 512, "M55.1 73.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L147.2 256 9.9 393.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L192.5 301.3 329.9 438.6c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L237.8 256 375.1 118.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L192.5 210.7 55.1 73.4z"];
	};
	/**
	 * # Micrio JSON data model
	 *
	 * This page details the data models used by Micrio.
	 *
	 * This data is created in the [Micrio editor](https://dash.micr.io/), and published as static JSON file per image, and optionally any language-specific data such as image markers, tours, audio, etc.
	 *
	 * Each Micrio image uses two data sources, which are retrieved from the Micrio servers:
	 *
	 * 1. **{@link ImageInfo}**: `info.json`: the base image data such as resolution, image type, and basic image settings. This is accessible in JS as {@link MicrioImage.info} as the Readable store, and {@link MicrioImage.$info} for its current value.
	 *
	 * 2. **{@link ImageData}**: `pub.json`: all published image content, which is accessible in JS as {@link MicrioImage.data} as the Writable store, and {@link MicrioImage.$data} for its current value.
	 *
	 */
	export namespace Models {
		/** Language-keyed localization map. */
		type I18n<T> = {
			[lang: string]: T;
		};
		type RevisionType = {
			[key: string]: number;
		};
		/**
		 * # Base image data
		 *
		 * The MicrioData.ImageInfo.ImageInfo JSON data object, used to pass to {@link HTMLMicrioElement.open}.
		 *
		 * The static image information, such as original resolution, image type, title, and all non-language specific **settings** ({@link ImageInfo.Settings}), such as initial viewport, camera behavior, and 360&deg; settings.
		 *
		 * The only required field is `id`. If only the `id` field is specified, Micrio attempts to download the additional image data by itself (`info.json`), published by the Micrio servers. This data will also include image title, and any custom viewing settings set in the image editor.
		 *
		 * This is a minimal accepted example:
		 *
		 * ```json
		 * {
		 * 	"id": "dzzLm",
		 * }
		 * ```
		 *
		 * If you have manually entered the image `width` and `height`, _it will not download_ the `info.json` file, assuming you have provided correct and complete data:
		 *
		 * ```json
		 * {
		 * 	"id": "dzzLm",
		 * 	"width": 41472,
		 * 	"height": 30219
		 * }
		 * ```
		 *
		 * Optionally, when using {@link HTMLMicrioElement} `<micr-io>` tag attributes, these will overwrite whatever is loaded from the server. So if in the Micrio editor you have enabled the fullscreen toggle button, you can disable it in your own HTML using `<micr-io data-fullscreen="false">`.
		 *
		 *
		 */
		namespace ImageInfo {
			/** A Micrio image's main static image data object */
			type ImageInfo = {
				/** The image id */
				id: string;
				/** The image base path URI, with a trailing `/`
				 * @default https://b.micr.io/
				*/
				path: string;
				/** The Micrio version this image was created in
				 * @default autoloaded
				*/
				version: string;
				/** Created date */
				created?: number;
				/** Has new viewport model, optimized for 360 images */
				viewsWH?: boolean;
				/** For V5+: published revisions per language */
				revision?: RevisionType;
				/** The original image width
				 * @default autoloaded
				*/
				width: number;
				/** The original image height
				 * @default autoloaded
				*/
				height: number;
				/** The original tile size in px
				 * @default autoloaded
				*/
				tileSize: number;
				/** Use an alternative image ID for the image tiles */
				tilesId?: string;
				/** Use an alternative basePath for image tiles */
				tileBasePath?: string;
				/** Optional custom file extension for tiles */
				tileExtension?: string;
				/** Optional watermark image URI */
				watermark?: string;
				/** Force the `path` attribute to be used to get the info.json data */
				forceInfoPath?: boolean;
				/** The image settings, such as viewport/UI settings, camera and user event behavior
				 * NOTE: to modify this at runtime, use the MicrioImage.settings Writable store.
				*/
				settings?: Partial<ImageInfo.Settings>;
				/** Optional organisation data */
				organisation?: ImageInfo.Organisation;
				/** The image title (default: autoloaded) */
				title?: string;
				/** The initial data language */
				lang?: string;
				/** The image is 360 degrees */
				is360?: boolean;
				/** The image tiles are in WebP format */
				isWebP?: boolean;
				/** The image tiles are in PNG format */
				isPng?: boolean;
				/** The tiled image is in DeepZoom format */
				isDeepZoom?: boolean;
				/** The image has a IIIF source */
				isIIIF?: boolean;
				/** Use a custom, single source uri for the zoomable image / video */
				isSingle?: boolean;
				/** A custom format (`dz` for DeepZoom, `iiif` for IIIF) */
				format?: string;
				/** Optional IIIF source for tiles */
				iiifManifest?: string;
				/** The album (V5+) ID */
				albumId?: string;
				/** Single-canvas sequence -- IIIF Presentation API 3 */
				type?: ('Manifest' | 'Canvas' | 'AnnotationPage' | 'Annotation' | 'Image');
				items?: Partial<ImageInfo.ImageInfo>[];
				body?: Partial<ImageInfo.ImageInfo> & {
					format: string;
					width: number;
					height: number;
					service: {
						id: string;
						type: 'ImageService3';
					}[];
				};
				/** The 360 tour space ID */
				spacesId?: string;
			};
			interface Organisation {
				name: string;
				slug: string;
				baseUrl?: string;
				href?: string;
				logo?: Assets.Image;
				gtmId?: string;
				branding?: boolean;
				fontFamily?: string;
			}
			/** Micrio image settings, which is on load included as {@link ImageInfo}`.settings`. */
			type Settings = {
				/** The starting viewport */
				view?: Camera.View;
				/** Restrict navigation to this viewport (`[x0,y0,x1,y1]`) */
				restrict?: Camera.View;
				/** Load a cover-initing image focussed on this coordinate (`[x, y]`) */
				focus?: [number, number];
				/** When opening the image without a predefined deeplink, open this */
				start?: {
					type: ('marker' | 'markerTour' | 'tour' | 'page');
					id: string;
				};
				/** Use a custom uri for the info json file */
				infoUrl?: string;
				/** Force refresh for published data JSON file */
				forceDataRefresh?: boolean;
				/** Render this image as a static image */
				static?: boolean;
				/** Use a custom thumbnail image uri */
				thumbSrc?: string;
				/** The starting viewport. Possible values `cover` and `contain`. Defaults to `contain` */
				initType?: string;
				/** The user cannot zoom out more than a fully covered view */
				limitToCoverScale?: boolean;
				/** Initialize the image when the container is scrolled into view (default: `false`) */
				lazyload?: number;
				/** Don't load any custom JS or CSS scripts */
				noExternals?: boolean;
				/** Don't load this image's {@link ImageData.ImageData} (markers, tours, etc) */
				skipMeta?: boolean;
				/** Don't auto-load first available non-preferred data language */
				onlyPreferredLang?: boolean;
				/** Do a crossfade when navigating between images (default: true) */
				fadeBetween?: boolean;
				/** Optional image crossfade duration, in seconds */
				crossfadeDuration?: number;
				/** Embedded images/videos fade in/out duration, in seconds */
				embedFadeDuration?: number;
				/** When being re-shown, always restart */
				embedRestartWhenShown?: boolean;
				/** Don't stop drawing frames when idle */
				keepRendering?: boolean;
				/** Don't load GTM module */
				noGTag?: boolean;
				/** With routing enabled, enable marker/tour deeplinks */
				routerMarkerTours?: boolean;
				/** Skip the deepest zoom levels */
				skipBaseLevels?: number;
				/** The camera animation speed (default: 1) */
				camspeed?: number;
				/** Kinetic dragging sensitivity (default: 1) */
				dragElasticity?: number;
				/** The maximum zoom level in % of the original (default: 1) */
				zoomLimit?: number;
				/** Turn off support for high DPI screens */
				noRetina?: boolean;
				/** Adjust the maximum zoom of high DPI screens to that of regular displays */
				zoomLimitDPRFix?: boolean;
				/** Allow the user to pan and zoom out of image bounds */
				freeMove?: boolean;
				/** When navigating back to this image from another image, reset the initial view */
				resetView?: boolean;
				/** Don't smooth out pixels when zooming in > 100% */
				noSmoothing?: boolean;
				/** Hook user events (default: true) */
				hookEvents?: boolean;
				/** Hook keyboard controls (default: false) */
				hookKeys?: boolean;
				/** Don't allow the user to zoom in or out */
				noZoom?: boolean;
				/** Use the mousewheel or trackpad scrolling for zooming (default: true) */
				hookScroll?: boolean;
				/** Allow pinch to zoom on touch devices (default: true) */
				hookPinch?: boolean;
				/** Allow panning through the image (default: true) */
				hookDrag?: boolean;
				/** Force two-finger panning on touch devices (default: false) */
				twoFingerPan?: boolean;
				/** Force using the CTRL/CMD-keys to zoom in using scrolling (default: false) */
				controlZoom?: boolean;
				/** Don't allow less than minimum scale zooming when pinching */
				pinchZoomOutLimit?: boolean;
				/** Don't load any UI elements */
				noUI?: boolean;
				/** Don't show any controls in the UI */
				noControls?: boolean;
				/** Show a fullscreen button if supported */
				fullscreen?: boolean;
				/** Don't show the Micrio logo on the top left */
				noLogo?: boolean;
				/** Don't show the organisation logo on the top right */
				noOrgLogo?: boolean;
				/** Don't show the menu bar with tours and custom pages */
				noToolbar?: boolean;
				/** Show an info modal with the image title and description */
				showInfo?: boolean;
				/** Show a social sharing button */
				social?: boolean;
				/** Show the minimap (default: true) */
				minimap?: boolean;
				/** Don't fade out the minimap (default: false) */
				alwaysShowMinimap?: boolean;
				/** The minimap maximum width, in px (default: 200) */
				minimapWidth?: number;
				/** The minimap maximum height, in px (default: 160) */
				minimapHeight?: number;
				/** More natural camera zooming animation during transitions (default: `true`) */
				doTourJumps?: boolean;
				/** Enable the audio controller (default: `true`) */
				audio?: boolean;
				/** The starting audio volume [0-1] (default: `1`) */
				startVolume?: number;
				/** The audio volume when other media is playing `[0-1]` (default: `0`) */
				mutedVolume?: number;
				/** Mute the audio when the current browser tab loses focus */
				muteOnBlur?: boolean;
				/** The physical width of the object in cm */
				cmWidth?: number;
				/** The physical height of the object in cm */
				cmHeight?: number;
				/** Overlapping markers are clustered */
				clusterMarkers?: boolean;
				/** The clustered marker radius */
				clusterMarkerRadius?: number;
				/** A static split-screen Micrio Image ID */
				micrioSplitLink?: string;
				/** When this is a secondary image in split screen, allow independent navigating */
				secondaryInteractive?: boolean;
				/** When this is a secondary image, don't follow the main image's navigation */
				noFollow?: boolean;
				/** Dark/light theme */
				theme?: ("dark" | "light" | "os");
				/** Load a custom JS file with this image */
				js?: {
					/** The asset href */
					href: string;
				};
				/** Load a custom CSS file with this image */
				css?: {
					/** The asset href */
					href: string;
				};
				/** All markers are scaled with the image */
				markersScale?: boolean;
				/** Albums */
				gallery?: GallerySettings;
				album?: AlbumInfo; /** V5 only */
				/** FOR OMNI OBJECTS */
				omni?: OmniSettings;
				/** Optional marker settings */
				_markers?: MarkerSettings;
				/** Optional settings for 360 images/video */
				_360?: {
					/** A 360 video object */
					video?: Assets.Video;
					/** @deprecated Use `Spaces.SpaceImage.rotationY` (radians). Normalized
					 *  [0,1] image-X offset, 0.5 = identity. Still honoured for back-compat. */
					trueNorth?: number;
					/** 2D embed X rotation in 360 */
					rotX?: number;
					/** 2D embed Y rotation in 360 */
					rotY?: number;
					/** 2D embed Z rotation in 360 */
					rotZ?: number;
					/** 2D embed IFRAME scale */
					scale?: number;
				};
				/** Freeform custom settings, this is the "Custom JSON" field in the image editor */
				_meta?: {
					[key: string]: any;
				};
				/** UI customizations */
				ui?: Partial<UserInterfaceSettings>;
				/** Grid: can click individual grid images */
				gridClickable?: boolean;
				/** Grid: transition duration, in seconds */
				gridTransitionDuration?: number;
				/** Grid: transition duration going back, in seconds */
				gridTransitionDurationOut?: number;
				/** ADVANCED: A fragment shader for WebGL postprocessing
				 * This shader MUST have and use:
				 * uniform sampler2D u_image; // the render buffer texture
				 * varying vec2 v_texCoord;   // the texture coordinate
				 * uniform float u_time;	  // elapsed time in seconds
				*/
				postProcessingFragmentShader?: string;
				/** Watermark opacity, defaults to 0.075 */
				watermarkOpacity?: number;
			};
			type GallerySettings = {
				/** Gallery has an associated .bin archive with thumbnails */
				archive?: string;
				/** Archive layer offset */
				archiveLayerOffset?: number;
				/** Gallery sorting */
				sort?: ('name' | '-name' | 'created' | '-created');
				/** Gallery type */
				type?: ('swipe' | 'swipe-full' | 'switch' | 'omni' | 'grid');
				/** The gallery opening image ID */
				startId?: string;
				/** Pages are combined to 2x1 spreads */
				isSpreads?: boolean;
				/** For spreads, number of cover pages to show as single page */
				coverPages?: number;
				revisions?: {
					[key: string]: RevisionType;
				};
			};
			type OmniSettings = {
				/** Number of frames */
				frames: number;
				/** Starting frame index */
				startIndex: number;
				/** The camera field of view in radians */
				fieldOfView: number;
				/** The camera vertical angle in radians */
				verticalAngle: number;
				/** The distance of the object center to the camera */
				distance: number;
				/** Adjust the center for an object */
				offsetX: number;
				/** Put the labels on the side of the object */
				sideLabels?: boolean;
				/** Which frame is 0deg rotation */
				frontIndex?: number;
				/** Layers */
				layers?: {
					i18n: {
						[key: string]: string | undefined;
					};
				}[];
				/** Optional starting layer idx */
				layerStartIndex?: number;
				/** Hide the rotation dial */
				noDial?: boolean;
				/** Show degrees on dial */
				showDegrees?: boolean;
				/** Gallery is omni object photography over 2 axes */
				twoAxes?: boolean;
				/** Don't add key bindings for rotating */
				noKeys?: boolean;
			};
			/** Image-wide marker settings */
			type MarkerSettings = {
				/** An image-wise custom marker icon */
				markerIcon?: Assets.Image;
				/** The default marker color */
				markerColor?: string;
				/** The default marker size in px */
				markerSize?: string;
				/** Zoom out when closing a marker */
				zoomOutAfterClose?: boolean;
				/** Relative speed factor when zooming out after close */
				zoomOutAfterCloseSpeed?: number;
				/** Always show the titles for all markers */
				showTitles?: boolean;
				/** Don't print any marker titles at all */
				noTitles?: boolean;
				/** Don't scale titles if marker is scaling */
				titlesNoScale?: boolean;
				/** All markers are sized to their viewports */
				viewportIsMarker?: boolean;
				/** All marker embeds are printed in HTML, not WebGL */
				embedsInHtml?: boolean;
				/** Auto-start a marker tour when just opening marker */
				autoStartTour?: boolean;
				/** Always auto-start a marker tour from the beginning */
				autoStartTourAtBeginning?: boolean;
				/** Auto-progress a tour step when marker media has ended */
				tourAutoProgress?: boolean;
				/** Tour controls in popup */
				tourControlsInPopup?: boolean;
				/** Show tour step counter in marker popup */
				tourStepCounterInPopup?: boolean;
				/** Allow marker popups to be minimized */
				canMinimizePopup?: boolean;
				/** Svelte transition-in animation for popup */
				popupAnimation?: any;
				/** Place primary body text above any media in popup */
				primaryBodyFirst?: boolean;
				/** Prevent all autoplay */
				preventAutoPlay?: boolean;
				/** Don't do anything when clicking markers */
				noMarkerActions?: boolean;
				/** Hide markers when tour is running */
				hideMarkersDuringTour?: boolean;
				/** Keep popup opened in between marker tour steps */
				keepPopupsDuringTourTransitions?: boolean;
				/** Optional custom uploaded icons */
				customIcons?: Assets.Image[];
			};
			/** Custom interface settings */
			type UserInterfaceSettings = {
				controls?: {
					/** Show the culture switch button if there are multiple available languages */
					cultureSwitch?: boolean;
					/** Serial tour timebar clicking other segment always goes to start of chapter */
					serialTourNoTimeScrub?: boolean;
				};
				icons?: {
					/** The raw SVG string for zoom-in */
					zoomIn?: string;
					/** The raw SVG string for zoom-out */
					zoomOut?: string;
					/** The raw SVG string for fullscreen-start */
					fullscreenEnter?: string;
					/** The raw SVG string for fullscreen-stop */
					fullscreenLeave?: string;
					/** The raw SVG string for close */
					close?: string;
					/** Next step button */
					next?: string;
					/** Previous step button */
					prev?: string;
					/** Play button */
					play?: string;
					/** Pause button */
					pause?: string;
					/** Subtitles icon */
					subtitles?: string;
					/** Subtitles turned off icon */
					subtitlesOff?: string;
					/** Muted icon */
					muted?: string;
					/** Unmuted icon */
					unmuted?: string;
					/** Arrow up icon */
					up?: string;
					/** Arrow down icon */
					down?: string;
				};
			};
		}
		/**
		* # Image content data
		*
		* The image content {@link ImageData} JSON object, which is accessible as {@link MicrioImage.data} as the Writable store, and {@link MicrioImage.$data} for its current value.
		*
		* This JSON data includes, for all published languages for this image:
		*
		* * Markers
		* * Marker tours
		* * Video tours
		* * Audio, music
		* * In-image embeds
		* * Custom menu screens and content pages
		*
		* To access the data of the current viewed image, use:
		*
		* ```js
		* // The current shown image value of the .data store Writable
		* const data = micrio.$current.$data;
		*
		* if(data) console.log(`The current image has ${data.markers.length} markers!`);
		* else console.warn('The current image has no data set.');
		* ```
		*
		* To subscribe to any data changes:
		*
		* ```js
		* micrio.$current.data.subscribe(data => {
		* 	console.log('Image has new or updated data!', data);
		* })
		* ```
		*
		* To set your own custom data:
		*
		* ```js
		* micrio.$current.data.set({
		* 	"markers": [
		* 		{
		* 			"i18n": {
		* 				"en": {
		* 					"title": "This is a test marker!"
		*				}
		*			},
		* 			"x": .5,
		* 			"y": .5
		* 		}
		* 	]
		* })
		* ```
		*
		* Or to update an existing loaded data object:
		*
		* ```js
		* micrio.$current.data.update(data => {
		* 	data.markers.push({
		* 		"i18n": {
		* 			"en": {
		* 				"title": "This is a newly added marker"
		*			}
		*		},
		* 		"x": .6,
		* 		"y": .5
		* 	});
		* 	return data;
		* })
		* ```
		*/
		namespace ImageData {
			/** The main data JSON structure */
			type ImageData = {
				/** V5+: Save revision */
				revision?: RevisionType;
				/** Localized image details */
				i18n?: I18n<ImageDetailsCultureData>;
				/** Markers */
				markers?: ImageData.Marker[];
				/** Marker tours */
				markerTours?: ImageData.MarkerTour[];
				/** Video tours */
				tours?: ImageData.VideoTour[];
				/** In-image embeds */
				embeds?: ImageData.Embed[];
				/** Custom menu pages */
				pages?: ImageData.Menu[];
				/** Music playlist */
				music?: {
					/** The audio assets */
					items: Assets.Audio[];
					/** Loop the playlist */
					loop: boolean;
					/** The music audio volume [0-1] (default: `1`) */
					volume?: number;
				};
			};
			interface ImageDetailsCultureData {
				/** Optional lang-specific image title */
				title?: string;
				/** Optional lang-specific image description */
				description?: string;
				/** Image copyright information */
				copyright?: string;
				/** Original source URI */
				sourceUrl?: string;
			}
			interface MarkerCultureData {
				/** The main marker title */
				title?: string;
				/** The marker url slug */
				slug?: string;
				/** Alternative title to display as marker label */
				label?: string;
				/** Marker main body HTML */
				body?: string;
				/** Marker secondary body HTML */
				bodySecondary?: string;
				/** Audio asset */
				audio?: Assets.Audio;
				/** An optional iframe embed url */
				embedUrl?: string;
				/** Embed title */
				embedTitle?: string;
				/** Embed description */
				embedDescription?: string;
			}
			/** A Marker */
			type Marker = {
				/** The marker ID */
				id: string;
				/** The relative marker X coordinate [0-1] */
				x: number;
				/** The relative marker Y coordinate [0-1] */
				y: number;
				i18n?: I18n<MarkerCultureData>;
				/** Omni-objects: radius from center */
				radius?: number;
				/** Rotation is concave: it's on the back of a front-rounded shape */
				backside?: boolean;
				/** Omni-objects: offset rotation in radians */
				rotation?: number;
				/** Omni-objects: custom visibility between these radians */
				visibleArc?: [number, number];
				/** The viewport to zoom to when the marker is opened */
				view?: Camera.View;
				/** If an image has multiple layers, switch to this layer */
				imageLayer?: number;
				/** Content type, for displaying */
				type?: ('default' | 'image' | 'audio' | 'video' | 'media' | 'link' | 'waypoint' | 'cluster');
				/** Popup type */
				popupType?: ('popup' | 'popover' | 'none' | 'micrioLink');
				/** If type is area, this HTML embed will be used for the marker */
				clickableArea?: Models.ImageData.Embed;
				/** Custom marker tags which will be also used as classnames on the marker elements */
				tags?: string[];
				/** Autoplay the audio asset when the marker is opened */
				audioAutoPlay?: boolean;
				/** Autoplay video embed when the marker is opened */
				embedAutoPlay?: boolean;
				/** Don't draw a marker element */
				noMarker?: boolean;
				/** A custom HTML element instead of the default <button> */
				htmlElement?: HTMLElement;
				/** Having the embed iframe printed mutes audio */
				embedMutesAudio?: boolean;
				/** Images inside marker popup */
				images?: Assets.Image[];
				/** Video tour which plays when the marker is opened */
				videoTour?: VideoTour;
				/** Positional audio asset */
				positionalAudio?: Assets.AudioLocation;
				/** Optional function that overrides all behavior */
				onclick?: (m: ImageData.Marker) => void;
				/** Additional options */
				data?: MarkerData;
			};
			/** Optional individual marker settings */
			type MarkerData = {
				/** A custom marker icon image */
				icon?: Assets.Image;
				/** A predefined custom icon idx in MarkerSettings */
				customIconIdx?: number;
				/** This marker links to this image */
				micrioLink?: Partial<ImageInfo.ImageInfo>;
				/** This marker opens secondary split image with id */
				micrioSplitLink?: string;
				/** Don't animate the camera when opening this marker */
				noAnimate?: boolean;
				/** Show the title below the marker
				 * @deprecated Use the main marker setting for this
				*/
				showTitle?: boolean;
				/** Don't open a large image viewer/gallery on image click */
				preventImageOpen?: boolean;
				/** Force a marker popup no matter what */
				notEmpty?: boolean;
				/** Jump the camera when opening this marker */
				doJump?: boolean;
				/** This marker is not closeable */
				alwaysOpen?: boolean;
				/** The marker scales with the zooming image */
				scales?: boolean;
				/** Grid tour transition animation */
				gridTourTransition?: Grid.MarkerFocusTransition;
				/** Optional custom settings. This is the "Custom JSON" field in the marker editor */
				_meta?: {
					/** For in grid multi-image tour, this step is in grid view */
					gridView?: boolean;
					/** Custom grid actions, action and action data |-separated */
					gridAction?: string;
					/** When opening this marker inside a grid, resize the tile to this */
					gridSize?: number | string;
					/** Any other value is accepted */
					[key: string]: any;
				};
			};
			/**
			 * An embedded element inside the main image. This could be an image,
			 * iframe embed, or simple empty HTML element (Spaces).
			 * This is created in the [Micrio editor](https://dash.micr.io/) or Spaces.
			 */
			type Embed = Partial<ImageInfo.ImageInfo> & {
				/** The area inside the main image to place the embed */
				area: Camera.View;
				/** Original asset url */
				src?: string;
				/** An optional iframe src url */
				frameSrc?: string;
				/** Autoplay YT/Vimeo */
				autoplayFrame?: boolean;
				/** Optional title */
				title?: string;
				/** An optional Micrio ID */
				micrioId?: string;
				/** Optional image width */
				width?: number;
				/** Optional image height */
				height?: number;
				/** Optional isPng */
				isPng?: boolean;
				/** IsWebP */
				isWebP?: boolean;
				/** Opacity */
				opacity?: number;
				/** Click interaction */
				clickAction?: ('markerId' | 'href');
				/** Click action target */
				clickTarget?: string;
				/** Opens link in new window */
				clickTargetBlank?: boolean;
				/** Unique instance ID */
				uuid?: string;
				/** Relative scale for IFRAME embed in 360 */
				scale?: number;
				/** X rotation in 360 */
				rotX?: number;
				/** Y rotation in 360 */
				rotY?: number;
				/** Z rotation in 360 */
				rotZ?: number;
				scaleX?: number;
				scaleY?: number;
				/** A video asset */
				video?: Assets.Video & {
					/** Don't play video when smaller than % of screen */
					pauseWhenSmallerThan?: number;
					/** Don't play video when larger than % of screen */
					pauseWhenLargerThan?: number;
				};
				/** Hide while not playing video/media */
				hideWhenPaused?: boolean;
			};
			interface TourCultureData {
				/** The tour title */
				title?: string;
				/** The tour url slug */
				slug?: string;
				/** The tour description */
				description?: string;
			}
			/** The MicrioTour abstract shared class for both {@link MarkerTour} and {@link VideoTour}
			 * @abstract
			*/
			type Tour = {
				/** The tour id */
				id: string;
				/** Localized tour culture data */
				i18n?: I18n<TourCultureData>;
				/** Auto-minimize controls while playing and idle */
				minimize?: boolean;
				/** Cannot close this tour */
				cannotClose?: boolean;
				/** Exit the tour on finish */
				closeOnFinish?: boolean;
			};
			/** A single videotour timeline viewport */
			type VideoTourView = {
				/** Start time in seconds */
				start: number;
				/** End time in seconds */
				end: number;
				/** Viewport name */
				title?: string;
				/** View rectangle */
				rect: Camera.View;
			};
			interface VideoTourCultureData extends TourCultureData {
				/** The tour duration in seconds */
				duration: number;
				/** An optional audio file */
				audio?: Assets.Audio;
				/** Optional subtitles */
				subtitle?: Assets.Subtitle;
				/** The timeline data */
				timeline: VideoTourView[];
				/** Custom events in tour timeline */
				events: Event[];
			}
			/**
			 * A Micrio video tour -- a timed sequence of viewport, with optional audio file.
			 * This is created in the [Micrio editor](https://dash.micr.io/).
			 */
			type VideoTour = Tour & {
				/** Localized videotour culture data */
				i18n?: I18n<VideoTourCultureData>;
				/** Don't hide the markers when running */
				keepMarkers?: boolean;
				/** Don't disable user navigation when running */
				keepInteraction?: boolean;
				/** The tour is a direct outside instance using legacy [x0,y0,x1,y1] viewports */
				isLegacy?: boolean;
				/** Current running tour instance */
				instance?: VideoTourInstance;
			};
			/** Timed events inside a {@link ImageData.VideoTour} */
			type Event = {
				/** Start time in seconds */
				start: number;
				/** End time in seconds */
				end: number;
				/** Custom event name */
				action?: string;
				/** Custom event data */
				data?: string;
				/** Optional ID to hook to */
				id?: string;
				/** The event is currently active */
				active?: boolean;
			};
			/**
			 * A Micrio marker tour -- a sequence of markers, which the user can navigate
			 * through. This is created in the [Micrio editor](https://dash.micr.io/).
			 */
			type MarkerTour = Tour & {
				/** Tour steps */
				steps: string[];
				/** No user controls */
				noControls?: boolean;
				/** Optional tour image asset */
				image?: Assets.Image;
				/** This is a scrolling tour */
				scrollable?: boolean;
				/** Don't reset view when tour ends */
				keepLastStep?: boolean;
				/** Chapter-based multi-video serial tour */
				isSerialTour?: boolean;
				/** Print the chapters in the interface */
				printChapters?: boolean;
				/** Internally generated propagated step data by Micrio */
				stepInfo?: MarkerTourStepInfo[];
				/** Internally calculated total duration, sum of all step durations */
				duration?: number;
				/** Current tour step getter */
				currentStep?: number;
				/** Start on this tour step */
				initialStep?: number;
				/** Go to next step -- for running tours */
				next?: () => void;
				/** Go to prev step -- for running tours */
				prev?: () => void;
				/** Go to step -- for running tours */
				goto?: (n: number) => void;
			};
			/** Auto generated metadata for marker tours */
			type MarkerTourStepInfo = {
				markerId: string;
				marker: Marker;
				micrioId: string;
				duration: number;
				imageHasOtherMarkers?: boolean;
				startView?: Camera.View;
				chapter?: number;
				/** For in grid multi-image tour, stay in the grid view */
				gridView?: boolean;
				/** Media current time */
				currentTime?: number;
				/** Media has ended */
				ended?: boolean;
				hasSubtitle?: boolean;
			};
			interface MenuPageButton {
				/** Localized button title */
				i18nTitle: {
					[key: string]: string;
				};
				/** Button action type */
				type: ('close' | 'marker' | 'mtour' | 'vtour' | 'link');
				/** The action value */
				action?: string;
				/** Link opens in net tab */
				blankTarget?: boolean;
			}
			interface MenuCultureData {
				/** The menu title */
				title?: string;
				/** For page: iframe embed */
				embed?: string;
				/** For page: content HTML */
				content?: string;
			}
			/**
			 * A custom pop-out menu containing content pages or direct external links to
			 * websites, or direct links to opening a marker.
			 * This is created in the [Micrio editor](https://dash.micr.io/).
			 */
			type Menu = {
				/** The menu ID */
				id: string;
				/** Localized culture data */
				i18n?: I18n<MenuCultureData>;
				/** Child menu elements */
				children?: Menu[];
				/** Open this marker when clicking menu */
				markerId?: string;
				/** Direct link url for menu button */
				link?: string;
				/** Opens the link in a new window */
				linkTargetBlank?: boolean;
				/** Optional direct action function when clicked */
				action?: Function;
				/** For page: page image */
				image?: Assets.Image;
				/** Custom page action buttons */
				buttons?: MenuPageButton[];
			};
		}
		namespace Assets {
			type BaseAsset = {
				/** The asset title (not filename) */
				title: string;
				/** The asset file name */
				fileName?: string;
				/** The file uri */
				src: string;
				/** File size in bytes */
				size: number;
				/** Created */
				uploaded: number;
			};
			type Audio = BaseAsset & {
				/** The sample duration */
				duration: number;
				/** The sample volume */
				volume: number;
			};
			type AudioLocation = Audio & {
				/** Autoplay the sample */
				alwaysPlay: boolean;
				/** Loop the audio */
				loop: boolean;
				/** Pause X seconds between plays */
				repeatAfter: number;
				/** Don't play on mobile */
				noMobile: boolean;
				/** The radius of the audible circle */
				radius: number;
			};
			/** An image asset uploaded in the Micrio editor */
			type Image = BaseAsset & {
				id?: string;
				/** The image original width */
				width: number;
				/** The image original height */
				height: number;
				/** If the image is available as Micrio image, its ID */
				micrioId?: string;
				/** If the image has a Micrio version, optional alternative image tile ID */
				tilesId?: string;
				/** Is PNG */
				isPng?: boolean;
				/** IsWebP */
				isWebP?: boolean;
				/** Used DeepZoom format */
				isDeepZoom?: boolean;
				/** V5+: Translatable description */
				i18n?: I18n<{
					title?: string;
					description?: string;
				}>;
			};
			type Video = BaseAsset & {
				/** The video width */
				width: number;
				/** The video height */
				height: number;
				/** The video duration */
				duration: number;
				/** Video is muted */
				muted: boolean;
				/** Video loops */
				loop: boolean;
				/** Video loops after X seconds waiting */
				loopAfter?: number;
				/** Video autoplays */
				autoplay: boolean;
				/** Cloudflare Stream ID */
				streamId?: string;
				/** Show controls */
				controls: boolean;
				/** Video has alpha transparency */
				transparent: boolean;
				/** Video has a separately uploaded Mac H265 transparent src */
				hasH265?: boolean;
			};
			type Subtitle = BaseAsset;
		}
		/** 360 tours, formerly SPACES */
		namespace Spaces {
			interface SpaceImage {
				/** The Micrio ID */
				id: string;
				/** X position of 360 image in zone */
				x: number;
				/** Y position of 360 image in zone */
				y: number;
				/** Z position of 360 image in zone */
				z: number;
				/** Y-axis sphere rotation in radians (aligns linked 360 images). */
				rotationY: number;
			}
			interface Space {
				/** The 360 image */
				images: SpaceImage[];
				/** The zone name */
				name: string;
				/** 360 linked Micrio IDs */
				links: [string, string, {
					[key: string]: WayPointSettings;
				}?][];
				/** Custom icon lib */
				icons?: Assets.Image[];
				/** Multi-image marker tours */
				markerTours?: ImageData.MarkerTour[];
			}
			interface WaypointInterface {
				el?: HTMLElement;
				settings: WayPointSettings;
				coords: WaypointCoords;
				deleted?: boolean;
			}
			interface WayPointSettings {
				i18n: {
					[key: string]: {
						title: string;
					};
				};
				/** A predefined custom icon idx */
				customIconIdx?: number;
				coords?: WaypointCoords;
			}
			type DirectionVector = [number, number, number];
			interface WaypointCoords {
				x: number;
				y: number;
				baseScale: number;
				scale: number;
				rotX: number;
				rotY: number;
				rotZ: number;
				custom?: boolean;
			}
		}
		/** OmniImages */
		namespace Omni {
			interface Frame {
				id: string;
				image: MicrioImage;
				visible: Writable<boolean>;
				frame: number;
				thumbSrc?: string;
				baseTileIdx: number;
				ptr: number;
				opts: {
					area: Camera.ViewRect;
				};
			}
		}
		namespace Grid {
			/** Grid .focus() transition from current view */
			type MarkerFocusTransition = ('crossfade' | 'slide' | 'slide-horiz' | 'slide-vert' | 'slide-up' | 'slide-down' | 'slide-right' | 'slide-left' | 'swipe' | 'swipe-horiz' | 'swipe-vert' | 'swipe-up' | 'swipe-down' | 'swipe-right' | 'swipe-left' | 'behind' | 'behind-left' | 'behind-right');
			type GridSetTransition = ('crossfade' | 'behind' | 'behind-delayed' | 'appear-delayed');
			/** Virtual ImageInfo extension to support grid logic */
			interface GridImage extends Partial<ImageInfo.ImageInfo> {
				size: [number, number?];
				area?: Camera.ViewRect;
				view?: Camera.ViewRect;
			}
			interface GridHistory {
				layout: string;
				horizontal: boolean;
				view?: Camera.View;
			}
			interface GridImageOptions {
				view?: Camera.View;
				area?: Camera.ViewRect;
				size?: number[];
			}
			interface FocusOptions {
				/** Optional target image view */
				view?: Camera.View;
				/** Transition duration in ms */
				duration?: number;
				/** Transition animation, defaults to crossfade */
				transition?: Grid.MarkerFocusTransition;
				/** Set the target viewport immediately */
				noViewAni?: boolean;
				/** Animate the previously focussed image to this view during exit transition */
				exitView?: Camera.View;
				/** Limit the focussed image to cover view, defaults to false */
				coverLimit?: boolean;
				/** Open as cover view, but don't limit it */
				cover?: boolean;
				/** Blur the image during transition, in pixels */
				blur?: number;
			}
		}
		/** Albums */
		interface AlbumInfo {
			/** The album ID */
			id: string;
			/** The album name */
			name: string;
			/** The album UX type */
			type: ('swipe' | 'switch' | 'grid');
			/** The album image sorting */
			sort?: ('name' | '-name' | 'created' | '-created');
			/** Album pages are shown as book spreads */
			isSpreads?: boolean;
			/** The number of single cover pages in case of spreads */
			coverPages?: number;
			/** Published revision number */
			revision: number;
			/** Available page data (markers, etc) */
			published: {
				[key: string]: RevisionType;
			};
			/** Album organisation */
			organisation?: ImageInfo.Organisation;
		}
		interface Album {
			/** The number of pages in this album */
			numPages: number;
			/** The current page index */
			currentIndex: number;
			/** The album info */
			info?: AlbumInfo;
			/** Go to previous page */
			prev: () => void;
			/** Go to next page */
			next: () => void;
			/** Go to specific page index */
			goto: (n: number) => void;
			/** Album has been initialized and hooked */
			hooked?: boolean;
			/** Strip-swipe only: writable store tracking the currently active child
			 * MicrioImage. Consumers (e.g. ZoomButtons) can subscribe to bind their
			 * controls to the image under focus instead of the virtual parent. */
			currentImage?: Writable<import("ts/image").MicrioImage>;
		}
		namespace Camera {
			/** A numeric array or Float64Array used for camera geometry. */
			type CameraArray = number[] | Float64Array;
			/** A viewport rectangle `[x0, y0, x1, y1]` (corners). */
			export type ViewRect = CameraArray;
			/** An area definition `[x0, y0, width, height]` (origin + size). */
			export type View = CameraArray;
			/** Coordinate tuple, [x, y, scale] */
			export type Coords = [number, number, number?] | Float64Array;
			/** A 360 vector for use in Spaces */
			export type Vector = {
				direction: number;
				distanceX: number;
				distanceY: number;
			};
			export type TimingFunction = ('ease' | 'ease-in' | 'ease-out' | 'linear');
			export interface AnimationOptions {
				/** Animation duration in ms */
				duration?: number;
				/** Limit the viewport to fill the screen */
				limit?: boolean;
				/** In case of automatic duration, speed factor (1 = 100%) */
				speed?: number;
				/** Transition timing function */
				timingFunction?: TimingFunction;
			}
			export {};
		}
		namespace Embeds {
			interface EmbedOptions {
				/** The embed opacity */
				opacity?: number;
				/** Do not print this embed until this zoom level (% of original) */
				fromScale?: number;
				/** The embed will have a minimal memory footprint, without its own camera */
				asImage?: boolean;
				/** Fit the embed's original size into the specified area. Defaults to 'stretch' */
				fit?: ('contain' | 'cover' | 'stretch');
			}
		}
		namespace State {
			/** Popover interface state type */
			interface PopoverType {
				contentPage?: ImageData.Menu;
				image?: MicrioImage;
				marker?: ImageData.Marker;
				markerTour?: ImageData.MarkerTour;
				gallery?: Assets.Image[];
				galleryStart?: string;
				showLangSelect?: boolean;
			}
		}
		namespace Canvas {
			interface ViewRect {
				width: number;
				height: number;
				left: number;
				top: number;
				ratio: number;
				scale: number;
				portrait: boolean;
			}
		}
		type MicrioEvent<T = any> = Event & {
			detail: T;
		};
		interface MicrioEventDetails {
			/** The main Micrio image is loaded and fully shown */
			'show': HTMLMicrioElement;
			/** Before the ImageInfo settings are read, this event allows you to alter them */
			'pre-info': ImageInfo.ImageInfo;
			/** Before the ImageData contents are read, this event allows you to alter it */
			'pre-data': {
				[micrioId: string]: ImageData.ImageData;
			};
			/** The main Micrio element has initialized and is being printed */
			'print': ImageInfo.ImageInfo;
			/** Individual image data is loaded and Micrio will start rendering */
			'load': MicrioImage;
			/** The user has switched available languages */
			'lang-switch': string;
			/** The camera has zoomed */
			'zoom': {
				image: MicrioImage;
				view: Camera.View;
			};
			/** The camera has moved */
			'move': {
				image: MicrioImage;
				view: Camera.View;
			};
			/** A frame has been drawn */
			'draw': void;
			/** The <micr-io> element was resized */
			'resize': DOMRect;
			/** The user has started panning */
			'panstart': void;
			/** The user has stopped panning */
			'panend': {
				duration: number;
				movedX: number;
				movedY: number;
			};
			/** The user has stopped pinching */
			'pinchstart': void;
			/** The user has stopped pinching */
			'pinchend': {
				duration: number;
				movedX: number;
				movedY: number;
			};
			/** A marker has been opened and the camera animation is starting */
			'marker-open': ImageData.Marker;
			/** A marker has been fully opened and the camera is done, and popup shown */
			'marker-opened': ImageData.Marker;
			/** A marker has been successfully closed */
			'marker-closed': ImageData.Marker;
			/** A tour has been successfully started */
			'tour-start': ImageData.Tour;
			/** A tour has been successfully stopped */
			'tour-stop': ImageData.Tour;
			/** A tour's UI interface has automatically minimized */
			'tour-minimize': boolean;
			/** Fires for each marker step in a marker tour */
			'tour-step': ImageData.MarkerTour | ImageData.VideoTour;
			/** A multi-image tour is played/resumed */
			'serialtour-play': ImageData.MarkerTour;
			/** A multi-image tour is paused */
			'serialtour-pause': ImageData.MarkerTour;
			/** A video tour has started from the beginning (can be part of a marker tour) */
			'videotour-start': ImageData.VideoTour;
			/** A video tour has ended or is aborted (can be part of a marker tour) */
			'videotour-stop': ImageData.VideoTour;
			/** A video tour is played or resumed */
			'videotour-play': void;
			/** A video tour is paused */
			'videotour-pause': void;
			/** A video tour has ended */
			'tour-ended': ImageData.MarkerTour | ImageData.VideoTour;
			/** When a video tour has custom events, they will be fired like this */
			'tour-event': ImageData.Event;
			/** The audio controller has been successfully initialized and can play audio */
			'audio-init': void;
			/** The audio has been muted */
			'audio-mute': void;
			/** The audio has been unmuted */
			'audio-unmute': void;
			/** Fires when there is autoplay audio or video which was disallowed by the browser */
			'autoplay-blocked': void;
			/** Media was blocked from autoplaying */
			'media-blocked': void;
			/** Media has started playing */
			'media-play': void;
			/** Media has stopped playing */
			'media-pause': void;
			/** Media has ended */
			'media-ended': void;
			/** A media timeupdate tick */
			'timeupdate': number;
			/** A custom popover page was opened */
			'page-open': ImageData.Menu;
			/** A custom popover page was closed */
			'page-closed': ImageData.Menu;
			/** Triggers on album image change */
			'gallery-show': number;
			/** The grid controller has initialized */
			'grid-init': Grid;
			/** All images in the grid have loaded */
			'grid-load': void;
			/** The grid layout has changed */
			'grid-layout-set': Grid;
			/** The main grid view is activated */
			'grid-focus': MicrioImage;
			/** The main grid has lost focus, i.e., navigated away */
			'grid-blur': void;
			/** Split screen mode has started */
			'splitscreen-start': MicrioImage;
			/** Split screen mode has stopped */
			'splitscreen-stop': MicrioImage;
			/** When there is any user action, this event fires. Deferred and fires at a maximum rate of every 500ms */
			'update': Array<string>;
		}
		type MicrioEventMap = {
			[K in keyof MicrioEventDetails]: MicrioEvent<MicrioEventDetails[K]>;
		};
		namespace Attributes {
			interface MicrioCustomAttributes {
				/** The image ID */
				'id'?: string;
				/** The data language code to use. Default: 'en' */
				'lang'?: string;
				/** For custom hosted Micrio images, specify the root URL. Default: Based on image */
				'data-path'?: string;
				/** Set this to 'cover' to start the image using the full viewport. Default: undefined */
				'data-inittype'?: string;
				/** The user cannot zoom out further than the full viewport. Default: undefined */
				'data-coverlimit'?: boolean;
				/** Only start loading the image when it's been scrolled into the user's view. Default: false */
				'lazyload'?: boolean;
				/** Do not load any metadata (markers, tours, etc). Default: false */
				'data-skipmeta'?: boolean;
				/** Simulate an <img/> element. No logo, loader bar, and no event listeners. Default: false */
				'data-static'?: boolean;
				/** Read and write deeplinks to opened tours and markers. Default: null */
				'data-router'?: string;
				/** Sending user input as GA Events to any available GTag instance (does nothing if none). Default: true */
				'data-gtag'?: boolean;
				/** Set the speed factor for camera animations. Default: 1 */
				'data-camspeed'?: number;
				/** Can pan outside the image's limits. Default: false */
				'data-freemove'?: boolean;
				/** Set the percentage (1=100%) of how far a user can zoom in. Default: 1 */
				'data-zoomlimit'?: number;
				/** Set the initial viewport rectangle of the image. Default: [0,0,1,1] */
				'data-view'?: number[];
				/** Set focus point of the image, treated as the center in case of image overflows. Default: [0.5, 0.5] */
				'data-focus'?: number[];
				/** Keep drawing frames, even if there is no movement. Default: false */
				'data-keeprendering'?: boolean;
				/** When turned off, high DPI screens will have its zoom limited to visually 100% of pixel size. Default: true */
				'data-normalize-dpr'?: boolean;
				/** No event handlers will be set up, and the image will be non-interactive. Default: true */
				'data-events'?: boolean;
				/** Use your keyboard to navigate through the image. Default: false */
				'data-keys'?: boolean;
				/** Use trackpad/touchscreen pinching for zooming. Default: true */
				'data-pinch-zoom'?: boolean;
				/** Use mousewheel/trackpad scrolling for zooming. Default: true */
				'data-scroll-zoom'?: boolean;
				/** The user must press CTRL/CMD when zooming with the mousewheel. Default: false */
				'data-control-zoom'?: boolean;
				/** Requires the user to use two fingers to pan the image on touch devices. Default: false */
				'data-two-finger-pan'?: boolean;
				/** The user cannot zoom at all. Default: true */
				'data-zooming'?: boolean;
				/** Use dragging and touch events for panning. Default: true */
				'data-dragging'?: boolean;
				/** No HTML UI elements will be printed. Default: true */
				'data-ui'?: boolean;
				/** No control buttons will be printed. Default: true */
				'data-controls'?: boolean;
				/** Show a fullscreen switching button on supported platforms. Default: true */
				'data-fullscreen'?: boolean;
				/** Show a social sharing link menu. Default: false */
				'data-social'?: boolean;
				/** The Micrio logo is displayed. Default: true */
				'data-logo'?: boolean;
				/** The optional Organisation logo (top right) will be hidden. Default: true */
				'data-logo-org'?: boolean;
				/** No top menu bar will be printed. Default: true */
				'data-toolbar'?: boolean;
				/** Show an image info panel with the title and description. Default: false */
				'data-show-info'?: boolean;
				/** An interactive minimap will be shown. Default: false */
				'data-minimap'?: boolean;
				/** The minimap will always be visible. Default: true */
				'data-minimap-hide'?: boolean;
				/** The minimap height in pixels. Default: 160 */
				'data-minimap-height'?: number;
				/** The minimap width in pixels. Default: 200 */
				'data-minimap-width'?: number;
				/** All audio will be disabled if this attribute is present. */
				'muted'?: boolean;
				/** The general sound volume for music/sfx (between 0 and 1). Default: 1 */
				'volume'?: number;
				/** Fade music to this volume while other audio plays (between 0 and 1). Default: 0 */
				'data-mutedvolume'?: number;
				/** Configuration for the grid which the viewer will use. */
				'data-grid'?: string;
				/** Toggle limited rendering mode in WebAssembly. */
				'data-limited'?: boolean;
			}
		}
	}
	/**
	 * Handles WebGL postprocessing effects.
	 * Sets up a framebuffer to render the main scene to a texture,
	 * then renders a fullscreen quad using that texture and a custom fragment shader
	 * to apply effects like bloom, vignette, etc.
	 */
	export class PostProcessor {
		private gl;
		/** Framebuffer object used as the render target for the main scene. */
		frameBuffer: WebGLFramebuffer;
		/**
		 * Creates a PostProcessor instance.
		 * Compiles the shaders, creates the framebuffer and texture, and sets up attributes/uniforms.
		 * @param gl The WebGL rendering context.
		 * @param micrio The main HTMLMicrioElement instance (used for WebGL utilities).
		 * @param fragmentShader The source code for the custom fragment shader implementing the effect.
		 */
		constructor(gl: WebGL2RenderingContext | WebGLRenderingContext, micrio: HTMLMicrioElement, fragmentShader: string);
		/**
		 * Renders the postprocessing effect.
		 * Binds the postprocessing shader, sets up attributes, binds the scene texture,
		 * passes uniforms (like time), and draws the fullscreen quad.
		 * Assumes the main scene has already been rendered to this instance's framebuffer.
		 */
		render(): void;
		/**
		 * Resizes the framebuffer texture when the canvas size changes.
		 */
		resize(): void;
		/** Disposes WebGL resources used by the PostProcessor. */
		dispose(): void;
	}
	/**
	 * Manages the HTML `<canvas>` element used for WebGL rendering,
	 * handles resizing, and provides viewport information.
	 * Accessed via `micrio.canvas`.
	 */
	export class Canvas {
		private micrio;
		/** The main WebGL rendering `<canvas>` element. */
		readonly element: HTMLCanvasElement;
		/** Object containing current viewport dimensions, position, and ratios. */
		readonly viewport: Models.Canvas.ViewRect;
		/** Writable Svelte store indicating if the client is likely a mobile device. */
		readonly isMobile: Writable<boolean>;
		/** Getter for the current value of the {@link isMobile} store. */
		get $isMobile(): boolean;
		/**
		 * Creates a Canvas controller instance.
		 * @param micrio The main HTMLMicrioElement instance.
		 */
		constructor(micrio: HTMLMicrioElement);
		/**
		 * Gets the appropriate device pixel ratio for rendering.
		 * Clamped between 1 and 2, disabled on iOS and if `noRetina` setting is true.
		 * @param s Optional image settings object to check for `noRetina`.
		 * @returns The calculated device pixel ratio.
		 */
		getRatio: (s?: Partial<Models.ImageInfo.Settings>) => number;
		/**
		 * Sets virtual offset margins in the Wasm controller.
		 * This likely affects how viewports are calculated or limited.
		 * @param width The horizontal offset margin in pixels.
		 * @param height The vertical offset margin in pixels.
		*/
		setMargins(width: number, height: number): void;
	}
	/** Type alias for common event types handled. */
	export type AllEvents = WheelEvent | MouseEvent | TouchEvent;
	/** Internal state variables used by the Events controller. */
	export type EventStateVars = {
		/** Dragging state */
		drag: {
			/** Previous pointer coordinates [x, y] during drag. */
			prev: number[] | undefined;
			/** Start coordinates and timestamp [x, y, time] of the drag. */
			start: number[];
		};
		/** Double-tap state */
		dbltap: {
			/** Timestamp of the last tap. */
			lastTapped: number;
		};
		/** Pinching state */
		pinch: {
			/** The image being pinched (relevant for split-screen). */
			image: MicrioImage | undefined;
			/** Initial distance between pinch points. */
			sDst: number;
			/** Was panning active before pinching started? */
			wasPanning: boolean;
		};
		/** State for debouncing 'update' events. */
		updates: {
			/** Timeout ID for the debounced update. */
			to: number;
			/** Stack of event types that triggered the update. */
			stack: string[];
		};
	};
	/** Event listener options for passive listeners. */
	export const eventPassive: AddEventListenerOptions;
	/** Event listener options for passive, capturing listeners. */
	export const eventPassiveCapture: AddEventListenerOptions;
	/** Event listener options for non-passive listeners (allowing preventDefault). */
	export const noEventPassive: AddEventListenerOptions;
	/** Utility function to stop event propagation and prevent default browser behavior. */
	export function cancelPrevent(e: AllEvents): void;
	/**
	 * Context object providing access to shared state for event handlers.
	 * This is passed to each handler module to avoid circular dependencies.
	 */
	export interface EventContext {
		/** The main Micrio element */
		micrio: HTMLMicrioElement;
		/** The canvas element where events are captured */
		el: HTMLCanvasElement;
		/** Whether events are currently enabled */
		isEnabled(): boolean;
		/** Whether the user is currently panning */
		isPanning(): boolean;
		/** Whether the user is currently pinching */
		isPinching(): boolean;
		/** Set panning state */
		setPanning(value: boolean): void;
		/** Set pinching state */
		setPinching(value: boolean): void;
		/** Get/set wheeling state */
		isWheeling(): boolean;
		setWheeling(value: boolean): void;
		/** Whether Ctrl/Cmd key is required for wheel zoom */
		isControlZoom(): boolean;
		/** Whether two fingers are required for touch panning */
		isTwoFingerPan(): boolean;
		/** Event state variables */
		vars: EventStateVars;
		/** Get visible images */
		getVisible(): MicrioImage[] | undefined;
		/** Get image under coordinates */
		getImage(c: {
			x: number;
			y: number;
		}): MicrioImage | undefined;
		/** Dispatch custom event */
		dispatch<K extends keyof Models.MicrioEventDetails>(type: K, detail?: Models.MicrioEventDetails[K]): void;
		/** Active pointers map for pinch detection */
		activePointers: Map<number, {
			x: number;
			y: number;
		}>;
		/** Captured pointer ID for dragging */
		capturedPointerId: number | undefined;
		setCapturedPointerId(id: number | undefined): void;
		/** Current pinch factor */
		pinchFactor: number | undefined;
		setPinchFactor(value: number | undefined): void;
		/** Previous scale during gestures */
		pScale: number;
		setPScale(value: number): void;
		/** Has used Ctrl for zoom */
		hasUsedCtrl: boolean;
		setHasUsedCtrl(value: boolean): void;
		/** Has touch support */
		hasTouch: boolean;
	}
	/**
	 * List of internal Micrio event types that should trigger a debounced 'update' event.
	 * The 'update' event signals that the overall state relevant for external integrations might have changed.
	 * @readonly
	 */
	export const UpdateEvents: (keyof Models.MicrioEventMap)[];
	/**
	 * Update event handler module.
	 * Manages debounced 'update' event dispatching when internal state changes.
	 */
	export class UpdateHandler {
		private ctx;
		constructor(ctx: EventContext);
		/** Hooks listeners for events that should trigger a debounced 'update' event. */
		hook(): void;
		/** Unhooks listeners for the debounced 'update' event. */
		unhook(): void;
		/**
		 * Event listener callback that queues the event type and triggers the debounced dispatch.
		 * @param e The Event object.
		 */
		private handleEvent;
		/**
		 * Dispatches the 'update' event with the accumulated event types and current state.
		 * Clears the event stack.
		 */
		private dispatch;
	}
	export { UpdateEvents } from "ts/events/update";
	/**
	 * Handles user input events (mouse, touch, keyboard, wheel, gestures) for the Micrio viewer.
	 * Translates browser events into camera movements (pan, zoom), dispatches custom Micrio events,
	 * and manages interaction states like panning, pinching, and enabled/disabled states.
	 * Accessed via `micrio.events`.
	 * @author Marcel Duin <marcel@micr.io>
	 */
	export class Events implements EventContext {
		/** Writable Svelte store indicating if event handling is currently enabled. Set to false during tours or animations. */
		enabled: Writable<boolean>;
		/** Getter for the current value of the {@link enabled} store. */
		get $enabled(): boolean;
		/** Current pinch zoom factor relative to the start of the pinch. Undefined when not pinching. */
		pinchFactor: number | undefined;
		private dragHandler;
		private pinchHandler;
		private pointerPinchHandler;
		private gestureHandler;
		private wheelHandler;
		private keyboardHandler;
		private doubleTapHandler;
		private updateHandler;
		isEnabled(): boolean;
		isPanning(): boolean;
		isPinching(): boolean;
		setPanning(value: boolean): void;
		setPinching(value: boolean): void;
		isWheeling(): boolean;
		setWheeling(value: boolean): void;
		isControlZoom(): boolean;
		isTwoFingerPan(): boolean;
		getVisible(): MicrioImage[] | undefined;
		setCapturedPointerId(id: number | undefined): void;
		setPinchFactor(value: number | undefined): void;
		setPScale(value: number): void;
		setHasUsedCtrl(value: boolean): void;
		/**
		 * Checks if the user is currently interacting with the map via panning, pinching, or wheeling.
		 * @returns True if the user is actively navigating.
		*/
		get isNavigating(): boolean;
		/** Hooks all necessary event listeners based on current settings. */
		hook(): void;
		/** Unhooks all attached event listeners. */
		unhook(): void;
		/** Hooks keyboard event listeners. */
		hookKeys(): void;
		/** Unhooks keyboard event listeners. */
		unhookKeys(): void;
		/** Hooks zoom-related event listeners (pinch, scroll, double-tap/click). */
		hookZoom(): void;
		/** Unhooks zoom-related event listeners. */
		unhookZoom(): void;
		/** Hooks mouse wheel/scroll event listeners. */
		hookScroll(): void;
		/** Unhooks mouse wheel/scroll event listeners. */
		unhookScroll(): void;
		/** Hooks touch pinch and macOS gesture event listeners. */
		hookPinch(): void;
		/** Unhooks touch pinch and macOS gesture event listeners. */
		unhookPinch(): void;
		/** Hooks pointer down/move/up listeners for drag panning. */
		hookDrag(): void;
		/** Unhooks pointer listeners for drag panning. */
		unhookDrag(): void;
	}
	/**
	 * Drag/pan event handler module.
	 * Handles pointer down/move/up events for panning the image.
	 */
	export class DragHandler {
		private ctx;
		private hooked;
		constructor(ctx: EventContext);
		/** Hooks pointer down/move/up listeners for drag panning. */
		hook(): void;
		/** Unhooks pointer listeners for drag panning. */
		unhook(): void;
		/**
		 * Handles the start of a drag/pan operation (pointerdown).
		 * @param e The PointerEvent.
		 * @param force If true, forces drag start even if target isn't the canvas.
		 */
		start(e: PointerEvent, force?: boolean): void;
		/**
		 * Handles pointer movement during a drag/pan operation.
		 * @param e The PointerEvent.
		 */
		private move;
		/**
		 * Handles the end of a drag/pan operation (pointerup).
		 * @param e Optional PointerEvent.
		 * @param noKinetic If true, prevents kinetic coasting animation.
		 * @param noDispatch If true, suppresses the 'panend' event.
		 */
		stop(e?: PointerEvent, noKinetic?: boolean, noDispatch?: boolean): void;
		/**
		 * Handles `pointercancel` (e.g. when the browser hijacks the touch for
		 * its own scrolling/zooming because the gesture started on an element
		 * without `touch-action: none`). Cleans up panning state without
		 * triggering kinetic motion or a regular `panend`.
		 */
		private cancel;
	}
	/**
	 * Touch pinch event handler module (iOS).
	 * Handles touchstart/touchmove/touchend events for pinch-to-zoom gestures.
	 */
	export class PinchHandler {
		private ctx;
		private dragHandler;
		constructor(ctx: EventContext, dragHandler: DragHandler);
		/** Hooks touch pinch event listeners (iOS only). */
		hook(): void;
		/** Unhooks touch pinch event listeners. */
		unhook(): void;
		/**
		 * Handles the start of a touch pinch gesture (touchstart with two fingers).
		 * @param e The TouchEvent.
		 */
		start(e: TouchEvent | Event): void;
		/**
		 * Handles touch movement during a pinch gesture.
		 * @param e The TouchEvent.
		 */
		private move;
		/**
		 * Handles the end of a touch pinch gesture (touchend).
		 * @param e The TouchEvent or MouseEvent.
		 */
		stop(e: MouseEvent | TouchEvent): void;
	}
	/**
	 * Pointer-based pinch event handler module.
	 * Handles pointerdown/pointermove/pointerup events for pinch-to-zoom gestures.
	 * Works on Windows touchscreens, Android, and other platforms supporting Pointer Events.
	 */
	export class PointerPinchHandler {
		private ctx;
		private dragHandler;
		constructor(ctx: EventContext, dragHandler: DragHandler);
		/** Hooks pointer pinch event listeners. */
		hook(): void;
		/** Unhooks pointer pinch event listeners. */
		unhook(): void;
		/**
		 * Handles pointer down for multi-touch pinch detection.
		 * @param e The PointerEvent.
		 */
		start(e: PointerEvent): void;
		/**
		 * Handles pointer move during a multi-touch pinch gesture.
		 * @param e The PointerEvent.
		 */
		private move;
		/**
		 * Handles pointer up/cancel - always called to track active pointers.
		 * Also ends pinch gesture when needed.
		 * @param e The PointerEvent.
		 */
		end(e: PointerEvent): void;
	}
	/**
	 * macOS trackpad gesture event handler module.
	 * Handles gesturestart/gesturechange/gestureend events for trackpad pinch-to-zoom.
	 */
	export class GestureHandler {
		private ctx;
		constructor(ctx: EventContext);
		/** Hooks macOS gesture event listeners. */
		hook(): void;
		/** Unhooks macOS gesture event listeners. */
		unhook(): void;
		/**
		 * GestureEvent interface for macOS trackpad gestures.
		 * @param e The Event object.
		 * @returns Gesture data or null if not a gesture event.
		 */
		private getGestureEvent;
		/**
		 * Handles macOS trackpad gesture events.
		 * Translates gesture scale into zoom actions.
		 * @param e The GestureEvent.
		 */
		private handle;
	}
	/**
	 * Mouse wheel/scroll event handler module.
	 * Handles wheel events for zooming and panning.
	 */
	export class WheelHandler {
		private ctx;
		/** Flag indicating if scroll listeners are attached. */
		hooked: boolean;
		/** Timeout ID for debouncing the 'wheelend' event. */
		private wheelEndTo;
		constructor(ctx: EventContext);
		/** Hooks mouse wheel/scroll event listeners. */
		hook(): void;
		/** Unhooks mouse wheel/scroll event listeners. */
		unhook(): void;
		/**
		 * Handles mouse wheel events for zooming.
		 * @param e The WheelEvent.
		 * @param force Force handling even if conditions normally prevent it.
		 * @param offX Optional X offset for zoom focus.
		 */
		handle(e: WheelEvent | Event, force?: boolean, offX?: number): void;
		/** Clears the wheeling state after a short delay. */
		private end;
	}
	/**
	 * Keyboard event handler module.
	 * Handles keydown events for keyboard navigation (arrows, +/-).
	 */
	export class KeyboardHandler {
		private ctx;
		constructor(ctx: EventContext);
		/** Hooks keyboard event listeners. */
		hook(): void;
		/** Unhooks keyboard event listeners. */
		unhook(): void;
		/**
		 * Handles keydown events for keyboard navigation.
		 * @param e The KeyboardEvent.
		 */
		private handle;
	}
	/**
	 * Double-tap/click event handler module.
	 * Handles double-tap (touch) and double-click (mouse) events for zooming.
	 */
	export class DoubleTapHandler {
		private ctx;
		constructor(ctx: EventContext);
		/** Hooks double-tap event listener (mobile). */
		hookTap(): void;
		/** Unhooks double-tap event listener. */
		unhookTap(): void;
		/** Hooks double-click event listener (desktop). */
		hookClick(): void;
		/** Unhooks double-click event listener. */
		unhookClick(): void;
		/**
		 * Handles double-tap detection on touch devices.
		 * @param e The TouchEvent.
		 */
		private tap;
		/**
		 * Handles double-click (mouse) or double-tap (touch) events for zooming.
		 * Zooms in if zoomed out, zooms out fully otherwise.
		 * @param e The MouseEvent or TouchEvent.
		 */
		private click;
	}
	export { Events } from "ts/events/facade";
	export { DragHandler } from "ts/events/drag";
	export { PinchHandler } from "ts/events/pinch";
	export { PointerPinchHandler } from "ts/events/pointer-pinch";
	export { GestureHandler } from "ts/events/gesture";
	export { WheelHandler } from "ts/events/wheel";
	export { KeyboardHandler } from "ts/events/keyboard";
	export { DoubleTapHandler } from "ts/events/doubletap";
	export { UpdateHandler } from "ts/events/update";
	export { type AllEvents, type EventStateVars, type EventContext, eventPassive, eventPassiveCapture, noEventPassive, cancelPrevent, } from "ts/events/shared";
	/**
	 * Language-related constants and utilities.
	 */
	/**
	 * The browser's current locale string (e.g., 'en-US', 'nl-NL'), falling back to 'en-EN'.
	 * Used for initializing the `languageNames` object.
	 */
	export const locale: string;
	/**
	 * An `Intl.DisplayNames` object configured to provide human-readable language names
	 * based on the browser's locale. Used for displaying language options in the UI.
	 * Will be `undefined` if `Intl.DisplayNames` is not supported by the browser.
	 *
	 * @example
	 * ```javascript
	 * languageNames?.of('nl'); // Output might be "Dutch" (depending on browser locale)
	 * ```
	 */
	export const languageNames: Intl.DisplayNames | undefined;
	/**
	 * An array of language codes that are typically written Right-to-Left (RTL).
	 * Used by the `HTMLMicrioElement` to set the `dir="rtl"` attribute when an RTL language is selected.
	 */
	export const rtlLanguageCodes: string[];
	/**
	 * Interface defining the structure for UI button translations.
	 * Each key corresponds to a specific UI element's title or label.
	 */
	interface ButtonTranslations {
		close: string;
		zoomIn: string;
		zoomOut: string;
		fullscreenToggle: string;
		switchLanguage: string;
		share: string;
		audioMute: string;
		audioUnmute: string;
		closeMarker: string;
		tourStepNext: string;
		tourStepPrev: string;
		tourStop: string;
		minimize: string;
		play: string;
		pause: string;
		stop: string;
		subtitlesToggle: string;
		galleryPrev: string;
		galleryNext: string;
		menuToggle: string;
		waypointFollow: string;
	}
	/**
	 * Object containing translations for UI button titles in different languages.
	 * The keys are language codes (e.g., 'en', 'nl'), and the values are objects
	 * conforming to the `ButtonTranslations` interface.
	 */
	export const langs: {
		[key: string]: ButtonTranslations;
	};
	/**
	 * Writable Svelte store holding the currently active `ButtonTranslations` object.
	 * Defaults to English ('en'). UI components subscribe to this store to display
	 * translated text based on the currently selected language.
	 * The language is typically changed by updating the `micrio._lang` store, which
	 * should then trigger an update to this `i18n` store.
	 */
	export const i18n: Writable<ButtonTranslations>;
	/**
	 * The main Micrio custom HTML element `<micr-io>`.
	 * This class acts as the central controller for the Micrio viewer, managing
	 * the WebGL canvas, WebAssembly module, Svelte UI, state, events, and image loading.
	 *
	 * It orchestrates the interaction between different parts of the library and
	 * exposes methods and properties for controlling the viewer.
	 *
	 * @example
	 * ```html
	 * <micr-io id="image123"></micr-io>
	 * <script>
	 *   const viewer = document.querySelector('micr-io');
	 *   viewer.open('image456');
	 *   viewer.addEventListener('marker-click', (e) => console.log(e.detail));
	 * </script>
	 * ```
	 *
	 * [[include:./ts/element.md]]
	 *
	 * @author Marcel Duin <marcel@micr.io>
	*/
	export class HTMLMicrioElement extends HTMLElement {
		/** Observed attributes trigger `attributeChangedCallback` when changed. */
		static get observedAttributes(): string[];
		/** The Micrio library version number. */
		static VERSION: string;
		/** Static cache store for downloaded JSON files (like image info). */
		static jsonCache: Map<string, Object>;
		/** Array holding all instantiated {@link MicrioImage} objects managed by this element. */
		readonly canvases: MicrioImage[];
		/**
		 * Writable Svelte store holding the currently active main {@link MicrioImage}.
		 * Use `<micr-io>.open()` to change the active image.
		 * Subscribe to this store to react to image changes.
		 * Access the current value directly using the {@link $current} getter.
		 */
		readonly current: Writable<MicrioImage | undefined>;
		/** Writable Svelte store holding an array of currently visible {@link MicrioImage} instances (relevant for split-screen or grid). */
		readonly visible: Writable<MicrioImage[]>;
		/**
		 * Getter for the current value of the {@link current} store.
		 * Provides direct access to the active {@link MicrioImage} instance.
		 * @readonly
		*/
		get $current(): MicrioImage | undefined;
		/** Getter for the virtual {@link Camera} instance of the currently active image. */
		get camera(): Camera | undefined;
		/** The controller managing the HTML `<canvas>` element, resizing, and viewport. */
		readonly canvas: Canvas;
		/** The controller managing user input events (mouse, touch, keyboard) and dispatching custom events. */
		readonly events: Events;
		/** The main state manager, providing access to various application states (UI visibility, active marker, tour, etc.). See {@link State.Main}. */
		readonly state: State.Main;
		/** The Google Analytics integration controller. */
		private readonly analytics;
		/** The URL router, handling deep linking and history management. */
		private readonly _router;
		/** Writable Svelte store indicating if barebone texture downloading is enabled (lower quality, less bandwidth). */
		readonly barebone: Writable<boolean>;
		/** Custom settings object provided programmatically, overriding server-fetched settings. */
		defaultSettings?: Partial<Models.ImageInfo.Settings>;
		/** Holds data for the current 360 space, if applicable (loaded via `data-space` attribute or API). */
		spaceData: Models.Spaces.Space | undefined;
		addEventListener<K extends keyof Models.MicrioEventMap>(type: K, listener: (this: HTMLMicrioElement, ev: Models.MicrioEventMap[K]) => any, options?: boolean | AddEventListenerOptions): void;
		addEventListener<K extends keyof HTMLElementEventMap>(type: K, listener: (this: HTMLMicrioElement, ev: HTMLElementEventMap[K]) => any, options?: boolean | AddEventListenerOptions): void;
		addEventListener(type: string, listener: (this: HTMLMicrioElement, ev: Event) => any, options?: boolean | AddEventListenerOptions): void;
		removeEventListener<K extends keyof Models.MicrioEventMap>(type: K, listener: (this: HTMLMicrioElement, ev: Models.MicrioEventMap[K]) => any, options?: boolean | EventListenerOptions): void;
		removeEventListener<K extends keyof HTMLElementEventMap>(type: K, listener: (this: HTMLMicrioElement, ev: HTMLElementEventMap[K]) => any, options?: boolean | EventListenerOptions): void;
		removeEventListener(type: string, listener: (this: HTMLMicrioElement, ev: Event) => any, options?: boolean | EventListenerOptions): void;
		/** Destroys the Micrio instance, cleans up resources, and removes event listeners. */
		destroy(): void;
		/**
		 * Opens a Micrio image by its ID or by providing partial image info data.
		 * This is the primary method for loading and displaying images.
		 *
		 * @param idOrInfo An image ID string (e.g., 'abcdef123') or a partial {@link Models.ImageInfo.ImageInfo} object.
		 * @param opts Options for opening the image.
		 * @returns The {@link MicrioImage} instance being opened.
		*/
		open(idOrInfo: string | Partial<Models.ImageInfo.ImageInfo>, opts?: {
			/** If true, keeps the grid view active instead of focusing on the opened image. */
			gridView?: boolean;
			/** If true, opens the image as a secondary split-screen view. */
			splitScreen?: boolean;
			/** The primary image when opening in split-screen mode. Defaults to the current main image. */
			splitTo?: MicrioImage;
			/** If true, opens the split-screen view passively (doesn't take focus). */
			isPassive?: boolean;
			/** An optional starting view to apply immediately. */
			startView?: Models.Camera.View;
			/** For 360 transitions, provides the direction vector from the previous image. */
			vector?: Models.Camera.Vector;
		}): MicrioImage;
		/**
		 * Closes an opened MicrioImage.
		 * For split-screen images, it triggers the split-end transition.
		 * For main images, it removes the canvas from the Wasm controller.
		 * @param img The {@link MicrioImage} instance to close.
		*/
		close(img: MicrioImage): void;
		/** Holds loaded grid info data if applicable. */
		gridInfoData: {
			images: Models.ImageInfo.ImageInfo[];
		} | undefined;
		/** Getter for the current language code. */
		get lang(): string;
		/** Setter for the current language code. Triggers language change logic. */
		set lang(l: string);
	}
	export interface MicrioUIProps {
		/** The main HTMLMicrioElement instance. Provided by element.ts */
		micrio: HTMLMicrioElement;
		/** If true, suppresses rendering of most UI elements (except markers if data-ui="markers"). */
		noHTML: boolean;
		/** If true, suppresses rendering of the Micrio logo. Defaults to `noHTML`. */
		noLogo?: boolean;
		/** Loading progress (0-1), used for the progress indicator. */
		loadingProgress?: number;
		/** Optional error message to display. */
		error?: string | undefined;
	}
	/**
	 * Handles integration with Google Tag Manager (gtag.js) for tracking Micrio events.
	 * Listens to specific Micrio custom events and sends corresponding events to GTM.
	 */
	export class GoogleTag {
		private micrio;
		/**
		 * Creates a GoogleTag instance.
		 * @param micrio The main HTMLMicrioElement instance.
		*/
		constructor(micrio: HTMLMicrioElement);
	}
	export { i18n, langs } from "ts/i18n/strings";
	export { locale, languageNames, rtlLanguageCodes } from "ts/i18n/locale";
	/**
	 * Manages the loading, playback, and WebGL integration of embedded videos
	 * that are rendered directly onto the Micrio canvas texture (not as HTML elements).
	 * Used internally by the `Embed.svelte` component when `printGL` is true.
	 * Handles HLS playback via hls.js if necessary.
	 */
	export class GLEmbedVideo {
		private wasm;
		private image;
		private embed;
		private paused;
		private moved;
		/**
		 * Creates a GLEmbedVideo instance.
		 * @param wasm The Wasm controller instance.
		 * @param image The parent MicrioImage instance where the video is embedded.
		 * @param embed The embed data object.
		 * @param paused Initial paused state (e.g., due to pause-on-zoom).
		 * @param moved Callback function to notify when position/state changes (triggers Wasm render).
		 */
		constructor(wasm: Wasm, image: MicrioImage, embed: Models.ImageData.Embed, paused: boolean, // Initial paused state
		moved: () => void);
		/** Cleans up resources when the parent Embed component is unmounted. */
		unmount(): void;
	}
	/**
	 * Media player type definitions and interfaces.
	 * @author Marcel Duin <marcel@micr.io>
	 */
	/**
	 * Common interface for all media player adapters.
	 * Abstracts the differences between HTML5, YouTube, Vimeo, and HLS players.
	 */
	export interface MediaPlayerAdapter {
		/** Play the media */
		play(): Promise<void>;
		/** Pause the media */
		pause(): void;
		/** Get current playback time in seconds */
		getCurrentTime(): Promise<number>;
		/** Set current playback time in seconds */
		setCurrentTime(time: number): void;
		/** Get total duration in seconds */
		getDuration(): Promise<number>;
		/** Check if media is currently paused */
		isPaused(): Promise<boolean>;
		/** Set muted state */
		setMuted(muted: boolean): void;
		/** Set volume (0-1) */
		setVolume(volume: number): void;
		/** Clean up resources */
		destroy(): void;
		/** Whether this adapter requires manual time updates via interval */
		readonly requiresTimeTick: boolean;
	}
	/**
	 * Event callbacks for player state changes.
	 */
	export interface PlayerEventCallbacks {
		onPlay?: () => void;
		onPause?: () => void;
		onEnded?: () => void;
		onSeeking?: () => void;
		onSeeked?: () => void;
		onTimeUpdate?: (time: number) => void;
		onDurationChange?: (duration: number) => void;
		onError?: (error: Error) => void;
		onBuffering?: () => void;
		onReady?: () => void;
		onBlocked?: () => void;
	}
	/**
	 * Configuration for creating a player adapter.
	 */
	export interface PlayerConfig {
		width: number;
		height: number;
		autoplay?: boolean;
		loop?: boolean;
		muted?: boolean;
		volume?: number;
		startTime?: number;
	}
	/**
	 * HTML5 Media Element adapter.
	 * Wraps native <audio> and <video> elements with a common interface.
	 * @author Marcel Duin <marcel@micr.io>
	 */
	/**
	 * Adapter for native HTML5 audio/video elements.
	 */
	export class HTML5PlayerAdapter implements MediaPlayerAdapter {
		private element;
		private callbacks;
		readonly requiresTimeTick = false;
		constructor(element: HTMLMediaElement, callbacks?: PlayerEventCallbacks);
		private attachEventListeners;
		play(): Promise<void>;
		pause(): void;
		getCurrentTime(): Promise<number>;
		setCurrentTime(time: number): void;
		getDuration(): Promise<number>;
		isPaused(): Promise<boolean>;
		setMuted(muted: boolean): void;
		setVolume(volume: number): void;
		destroy(): void;
	}
	/**
	 * Adapter for HLS.js streaming video.
	 * Extends HTML5PlayerAdapter since HLS.js attaches to a video element.
	 */
	export class HLSPlayerAdapter implements MediaPlayerAdapter {
		private element;
		private hlsSrc;
		private callbacks;
		readonly requiresTimeTick = false;
		private hls;
		private html5Adapter;
		private destroyed;
		constructor(element: HTMLVideoElement, hlsSrc: string, callbacks?: PlayerEventCallbacks);
		/**
		 * Loads HLS.js and attaches to the video element.
		 */
		initialize(): Promise<void>;
		play(): Promise<void>;
		pause(): void;
		getCurrentTime(): Promise<number>;
		setCurrentTime(time: number): void;
		getDuration(): Promise<number>;
		isPaused(): Promise<boolean>;
		setMuted(muted: boolean): void;
		setVolume(volume: number): void;
		destroy(): void;
	}
	/**
	 * Adapter for YouTube IFrame Player API.
	 */
	export class YouTubePlayerAdapter implements MediaPlayerAdapter {
		private frame;
		private config;
		private callbacks;
		readonly requiresTimeTick = true;
		private player;
		private destroyed;
		constructor(frame: HTMLIFrameElement, config: PlayerConfig, callbacks?: PlayerEventCallbacks);
		/**
		 * Loads the YouTube API and initializes the player.
		 */
		initialize(): Promise<void>;
		private handleStateChange;
		play(): Promise<void>;
		pause(): void;
		getCurrentTime(): Promise<number>;
		setCurrentTime(time: number): void;
		getDuration(): Promise<number>;
		isPaused(): Promise<boolean>;
		setMuted(muted: boolean): void;
		setVolume(_volume: number): void;
		destroy(): void;
	}
	/**
	 * Adapter for Vimeo Player API.
	 */
	export class VimeoPlayerAdapter implements MediaPlayerAdapter {
		private frame;
		private config;
		private callbacks;
		readonly requiresTimeTick = false;
		private player;
		private destroyed;
		constructor(frame: HTMLIFrameElement, config: PlayerConfig, callbacks?: PlayerEventCallbacks);
		/**
		 * Loads the Vimeo API and initializes the player.
		 */
		initialize(): Promise<void>;
		play(): Promise<void>;
		pause(): void;
		getCurrentTime(): Promise<number>;
		setCurrentTime(time: number): void;
		getDuration(): Promise<number>;
		isPaused(): Promise<boolean>;
		setMuted(muted: boolean): void;
		setVolume(volume: number): void;
		destroy(): void;
	}
	/**
	 * Media player adapters module.
	 * Provides unified interfaces for different media player types.
	 * @author Marcel Duin <marcel@micr.io>
	 */
	export type { MediaPlayerAdapter, PlayerEventCallbacks, PlayerConfig } from "ts/media/types";
	export { HTML5PlayerAdapter } from "ts/media/html5-adapter";
	export { YouTubePlayerAdapter } from "ts/media/youtube-adapter";
	export { VimeoPlayerAdapter } from "ts/media/vimeo-adapter";
	export { HLSPlayerAdapter } from "ts/media/hls-adapter";
	export { GLEmbedVideo } from "ts/media/embedvideo";
	export { VideoTourInstance } from "ts/media/videotour";
	export { Router } from "ts/nav/router";
	export { Grid } from "ts/nav/grid";
	export { GallerySwiper } from "ts/nav/swiper";
	export { Wasm } from "ts/render/wasm";
	export { WebGL } from "ts/render/webgl";
	export { Canvas } from "ts/render/canvas";
	export { PostProcessor } from "ts/render/postprocess";
	export { archive } from "ts/render/archive";
	export { loadTexture, runningThreads, numThreads, abortDownload } from "ts/render/textures";
	export type { TextureBitmap } from "ts/render/textures";
	/**
	 * Micrio Engine — TypeScript compute core for the Micrio image viewer.
	 *
	 * This module replaces the WebAssembly/AssemblyScript compute layer.
	 * It provides the same computational logic (camera math, tile pyramid
	 * management, animation engine, 360 sphere geometry, matrix/vector math)
	 * as pure TypeScript classes.
	 *
	 * @author Marcel Duin <marcel@micr.io>
	 */
	export { Main } from "engine/main";
	export { default as Canvas } from "engine/canvas";
	export { default as Image } from "engine/image";
	export { default as WebGL } from "engine/webgl";
	export { default as Camera } from "engine/camera";
	export { default as Ani } from "engine/camera.ani";
	export { default as Kinetic } from "engine/camera.kinetic";
	export { View, Coordinates, Viewport, DrawRect } from "engine/shared";
	export { Mat4, Vec4 } from "engine/webgl.mat";
	export { Bicubic, easeInOut, easeIn, easeOut, linear, mod1, modPI, twoNth, longitudeDistance } from "engine/utils";
	export { PI, PI2, PIh, segsX, segsY, base360Distance } from "engine/globals";
}declare module "svelte/store" {
	/** Callback to inform of a value updates.
	*/
	export type Subscriber<T> = (value: T) => void;
	/** Unsubscribes from value updates.
	*/
	export type Unsubscriber = () => void;
	/** Callback to update a value.
	*/
	export type Updater<T> = (value: T) => T;
	/** Cleanup logic callback. */
	type Invalidator<T> = (value?: T) => void;
	/** Start and stop notification callbacks.
	 * @internal
	*/
	export type StartStopNotifier<T> = (set: Subscriber<T>) => Unsubscriber | void;
	/** Readable interface for subscribing. See the main SvelteStore article on how to use it in Micrio. */
	export interface Readable<T> {
		/**
		 * Subscribe on value changes.
		 * @param run subscription callback
		 * @param invalidate cleanup callback
		 */
		subscribe(this: void, run: Subscriber<T>, invalidate?: Invalidator<T>): Unsubscriber;
	}
	/** Writable interface for both updating and subscribing. See the main SvelteStore article on how to use it in Micrio. */
	export interface Writable<T> extends Readable<T> {
		/**
		 * Set value and inform subscribers.
		 * @param value to set
		 */
		set(this: void, value: T): void;
		/**
		 * Update value using callback and inform subscribers.
		 * @param updater callback
		 */
		update(this: void, updater: Updater<T>): void;
	}
	/**
	 * Creates a `Readable` store that allows reading by subscription.
	 * @internal
	 * @param value initial value
	 * @param {StartStopNotifier}start start and stop notifications for subscriptions
	 */
	export function readable<T>(value?: T, start?: StartStopNotifier<T>): Readable<T>;
	/**
	 * Create a `Writable` store that allows both updating and reading by subscription.
	 * @internal
	 * @param {*=}value initial value
	 * @param {StartStopNotifier=}start start and stop notifications for subscriptions
	 */
	export function writable<T>(value?: T, start?: StartStopNotifier<T>): Writable<T>;
	/** One or more `Readable`s.
	 * @internal
	*/
	type Stores = Readable<any> | [Readable<any>, ...Array<Readable<any>>] | Array<Readable<any>>;
	/** One or more values from `Readable` stores.
	 * @internal
	*/
	type StoresValues<T> = T extends Readable<infer U> ? U : {
		[K in keyof T]: T[K] extends Readable<infer U> ? U : never;
	};
	/**
	 * Derived value store by synchronizing one or more readable stores and
	 * applying an aggregation function over its input values.
	 *
	 * @internal
	 * @param stores - input stores
	 * @param fn - function callback that aggregates the values
	 * @param initial_value - when used asynchronously
	 */
	export function derived<S extends Stores, T>(stores: S, fn: (values: StoresValues<S>, set: (value: T) => void) => Unsubscriber | void, initial_value?: T): Readable<T>;
	/**
	 * Derived value store by synchronizing one or more readable stores and
	 * applying an aggregation function over its input values.
	 *
	 * @internal
	 * @param stores - input stores
	 * @param fn - function callback that aggregates the values
	 * @param initial_value - initial value
	 */
	export function derived<S extends Stores, T>(stores: S, fn: (values: StoresValues<S>) => T, initial_value?: T): Readable<T>;
	/**
	 * Derived value store by synchronizing one or more readable stores and
	 * applying an aggregation function over its input values.
	 *
	 * @internal
	 * @param stores - input stores
	 * @param fn - function callback that aggregates the values
	 */
	export function derived<S extends Stores, T>(stores: S, fn: (values: StoresValues<S>) => T): Readable<T>;
	/**
	 * Get the current value from a store by subscribing and immediately unsubscribing.
	 * @internal
	 * @param store readable
	 */
	 export function get<T>(store: Readable<T>): T;

}
