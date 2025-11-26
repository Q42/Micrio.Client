import type { HTMLMicrioElement } from '../element';
import type { MicrioImage } from '../image';
import type { Models } from '../../types/models';

/** Type alias for common event types handled. */
export type AllEvents = WheelEvent | MouseEvent | TouchEvent;

/** Internal state variables used by the Events controller. */
export type EventStateVars = {
	/** Dragging state */
	drag: {
		/** Previous pointer coordinates [x, y] during drag. */
		prev: number[] | undefined,
		/** Start coordinates and timestamp [x, y, time] of the drag. */
		start: number[]
	},
	/** Double-tap state */
	dbltap: {
		/** Timestamp of the last tap. */
		lastTapped: number
	},
	/** Pinching state */
	pinch: {
		/** The image being pinched (relevant for split-screen). */
		image: MicrioImage | undefined,
		/** Initial distance between pinch points. */
		sDst: number;
		/** Was panning active before pinching started? */
		wasPanning: boolean;
	},
	/** State for debouncing 'update' events. */
	updates: {
		/** Timeout ID for the debounced update. */
		to: number,
		/** Stack of event types that triggered the update. */
		stack: string[]
	}
};

/** Flag indicating if passive event listeners are supported (assumed true). */
export const supportsPassive = true; // TODO: Add actual feature detection?

/** Event listener options for passive listeners. */
export const eventPassive: AddEventListenerOptions = { passive: true };

/** Event listener options for passive, capturing listeners. */
export const eventPassiveCapture: AddEventListenerOptions = { passive: true, capture: true };

/** Event listener options for non-passive listeners (allowing preventDefault). */
export const noEventPassive: AddEventListenerOptions = { passive: false };

/** Utility function to stop event propagation and prevent default browser behavior. */
export function cancelPrevent(e: AllEvents): void {
	e.stopPropagation();
	e.preventDefault();
}

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
	getImage(c: { x: number, y: number }): MicrioImage | undefined;
	/** Dispatch custom event */
	dispatch<K extends keyof Models.MicrioEventDetails>(
		type: K,
		detail?: Models.MicrioEventDetails[K]
	): void;
	/** Active pointers map for pinch detection */
	activePointers: Map<number, { x: number, y: number }>;
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

