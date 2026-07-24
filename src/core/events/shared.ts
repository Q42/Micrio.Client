import type { HTMLMicrioElement } from '$core/element';
import type { MicrioImage } from '$core/image';
import type { Models } from '$types/models';

/** Type alias for common event types handled. */
export type AllEvents = WheelEvent | MouseEvent | TouchEvent;

/** Internal state variables used by the Events controller. */
export type EventStateVars = {
	/** Dragging state */
	_drag: {
		/** Previous pointer coordinates [x, y] during drag. */
		_prev: number[] | undefined,
		/** Start coordinates and timestamp [x, y, time] of the drag. */
		_start: number[],
		/** The image being panned, captured at drag start. */
		_image: MicrioImage | undefined,
	},
	/** Double-tap state */
	_dbltap: {
		/** Timestamp of the last tap. */
		_lastTapped: number
	},
	/** Pinching state */
	_pinch: {
		/** The image being pinched. */
		_image: MicrioImage | undefined,
		/** Initial distance between pinch points. */
		_sDst: number;
		/** Was panning active before pinching started? */
		_wasPanning: boolean;
	},
};

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
	_micrio: HTMLMicrioElement;
	/** The canvas element where events are captured */
	_el: HTMLCanvasElement;
	/** Whether events are currently enabled */
	_isEnabled(): boolean;
	/** Whether the user is currently panning */
	_panning: boolean;
	/** Whether the user is currently pinching */
	_pinching: boolean;
	/** Whether the user is currently zooming via mouse wheel */
	_wheeling: boolean;
	/** Whether Ctrl/Cmd key is required for wheel zoom */
	_controlZoom: boolean;
	/** Whether two fingers are required for touch panning */
	_twoFingerPan: boolean;
	/** Event state variables */
	_vars: EventStateVars;
	/** Get visible images */
	_getVisible(): MicrioImage[] | undefined;
	/** Get image under coordinates */
	_getImage(c: { x: number, y: number }): MicrioImage | undefined;
	/** Dispatch custom event */
	_dispatch<K extends keyof Models.MicrioEventDetails>(
		type: K,
		detail?: Models.MicrioEventDetails[K]
	): void;
	/** Active pointers map for pinch detection */
	_activePointers: Map<number, { x: number, y: number }>;
	/** Captured pointer ID for dragging */
	_capturedPointerId: number | undefined;
	/** Current pinch factor */
	_pinchFactor: number | undefined;
	/** Previous scale during gestures */
	_pScale: number;
	/** Has used Ctrl for zoom */
	_hasUsedCtrl: boolean;
	/** Has touch support */
	_hasTouch: boolean;
}
