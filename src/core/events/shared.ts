import type { HTMLMicrioElement } from '$core/element';
import type { MicrioImage } from '$core/image';
import type { Models } from '$types/models';

/** Type alias for common event types handled. @internal */
export type AllEvents = WheelEvent | MouseEvent | TouchEvent;

/** Internal state variables used by the Events controller. @internal */
export type EventStateVars = {
	/** @internal Dragging state */
	_drag: {
		/** @internal Previous pointer coordinates [x, y] during drag. */
		_prev: number[] | undefined,
		/** @internal Start coordinates and timestamp [x, y, time] of the drag. */
		_start: number[],
		/** @internal The image being panned, captured at drag start. */
		_image: MicrioImage | undefined,
	},
	/** @internal Double-tap state */
	_dbltap: {
		/** @internal Timestamp of the last tap. */
		_lastTapped: number
	},
	/** @internal Pinching state */
	_pinch: {
		/** @internal The image being pinched. */
		_image: MicrioImage | undefined,
		/** @internal Initial distance between pinch points. */
		_sDst: number;
		/** @internal Was panning active before pinching started? */
		_wasPanning: boolean;
	},
};

/** Event listener options for passive listeners. @internal */
export const eventPassive: AddEventListenerOptions = { passive: true };

/** Event listener options for passive, capturing listeners. @internal */
export const eventPassiveCapture: AddEventListenerOptions = { passive: true, capture: true };

/** Event listener options for non-passive listeners (allowing preventDefault). @internal */
export const noEventPassive: AddEventListenerOptions = { passive: false };

/** Utility function to stop event propagation and prevent default browser behavior. @internal */
export function cancelPrevent(e: AllEvents): void {
	e.stopPropagation();
	e.preventDefault();
}

/**
 * Context object providing access to shared state for event handlers.
 * This is passed to each handler module to avoid circular dependencies.
 */
export interface EventContext {
	/** @internal The main Micrio element */
	_micrio: HTMLMicrioElement;
	/** @internal The canvas element where events are captured */
	_el: HTMLCanvasElement;
	/** @internal Whether the user is currently panning */
	_panning: boolean;
	/** @internal Whether the user is currently pinching */
	_pinching: boolean;
	/** @internal Whether the user is currently zooming via mouse wheel */
	_wheeling: boolean;
	/** @internal Whether Ctrl/Cmd key is required for wheel zoom */
	_controlZoom: boolean;
	/** @internal Whether two fingers are required for touch panning */
	_twoFingerPan: boolean;
	/** @internal Event state variables */
	_vars: EventStateVars;
	/** @internal Get visible images */
	_getVisible(): MicrioImage[] | undefined;
	/** @internal Get image under coordinates */
	_getImage(c: { x: number, y: number }): MicrioImage | undefined;
	/** @internal Dispatch custom event */
	_dispatch<K extends keyof Models.MicrioEventDetails>(
		type: K,
		detail?: Models.MicrioEventDetails[K]
	): void;
	/** @internal Active pointers map for pinch detection */
	_activePointers: Map<number, { x: number, y: number }>;
	/** @internal Captured pointer ID for dragging */
	_capturedPointerId: number | undefined;
	/** @internal Current pinch factor */
	_pinchFactor: number | undefined;
	/** @internal Previous scale during gestures */
	_pScale: number;
	/** @internal Has used Ctrl for zoom */
	_hasUsedCtrl: boolean;
	/** @internal Has touch support */
	_hasTouch: boolean;
}
