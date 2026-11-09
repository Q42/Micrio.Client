import { assertNever, type MachineState } from '$core/machine'

/** @internal */
export interface MarkerSessionState extends MachineState {
	phase: 'closed' | 'opening' | 'open' | 'kept-for-link'
	markerId?: string
	popup: boolean
	popover: boolean
}

/** @internal */
export type MarkerSessionEvent =
	| { type: 'select'; markerId: string }
	| { type: 'opened' }
	| { type: 'close' }
	| { type: 'link-follow' }
	| { type: 'popup'; open: boolean }
	| { type: 'popover'; open: boolean }

/** @internal */
export const markerSessionInitial: MarkerSessionState = {
	phase: 'closed',
	popup: false,
	popover: false,
}

/** @internal */
export function reduceMarkerSession(
	state: Readonly<MarkerSessionState>,
	event: MarkerSessionEvent,
): MarkerSessionState | null {
	switch (event.type) {
		case 'select': {
			return { ...state, phase: 'opening', markerId: event.markerId }
		}
		case 'opened': {
			return state.phase === 'open' ? null : { ...state, phase: 'open' }
		}
		case 'close': {
			return state.phase === 'closed' && state.markerId === undefined
				? null
				: { ...state, phase: 'closed', markerId: undefined, popup: false, popover: false }
		}
		case 'link-follow': {
			return state.phase === 'kept-for-link' ? null : { ...state, phase: 'kept-for-link', popup: true }
		}
		case 'popup': {
			return state.popup === event.open ? null : { ...state, popup: event.open }
		}
		case 'popover': {
			return state.popover === event.open ? null : { ...state, popover: event.open }
		}
		default: {
			return assertNever(event)
		}
	}
}
