// Re-export all event handler modules
export { DragHandler } from './drag';
export { PinchHandler } from './pinch';
export { PointerPinchHandler } from './pointer-pinch';
export { GestureHandler } from './gesture';
export { WheelHandler } from './wheel';
export { KeyboardHandler } from './keyboard';
export { DoubleTapHandler } from './doubletap';
export { UpdateHandler, UpdateEvents } from './update';

// Re-export shared types and utilities
export {
	type AllEvents,
	type EventStateVars,
	type EventContext,
	supportsPassive,
	eventPassive,
	eventPassiveCapture,
	noEventPassive,
	cancelPrevent,
} from './shared';

