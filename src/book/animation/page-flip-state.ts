/** Where one page-flip slot is in its drag/animation cycle. @internal */
export type SlotPhase = 'idle' | 'dragging' | 'left' | 'right'

/** True while a slot is animating towards a side. @internal */
export const isSlotAnimating = (phase: SlotPhase): boolean => phase === 'left' || phase === 'right'

/** The numeric animation target for a phase (`1` left, `-1` right, `0` idle). @internal */
export const slotDirection = (phase: SlotPhase): number => {
	if (phase === 'left') {
		return 1
	}
	return phase === 'right' ? -1 : 0
}
