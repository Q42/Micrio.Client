import { assertNever } from '$core/machine'

/** Lifecycle of one tile texture slot. `failed` is terminal until eviction. @internal */
export type TilePhase = 'empty' | 'requesting' | 'ready' | 'drawn' | 'failed'

/** @internal */
export type TileEvent =
	| { type: 'request' }
	| { type: 'loaded' }
	| { type: 'drawn' }
	| { type: 'failed' }
	| { type: 'evict' }

/** @internal */
export function reduceTilePhase(phase: TilePhase, event: TileEvent): TilePhase {
	switch (event.type) {
		case 'request': {
			return phase === 'empty' ? 'requesting' : phase
		}
		case 'loaded': {
			return phase === 'requesting' ? 'ready' : phase
		}
		case 'drawn': {
			return phase === 'ready' ? 'drawn' : phase
		}
		case 'failed': {
			return phase === 'requesting' || phase === 'ready' ? 'failed' : phase
		}
		case 'evict': {
			return phase === 'requesting' || phase === 'ready' || phase === 'drawn' || phase === 'failed' ? 'empty' : phase
		}
		default: {
			return assertNever(event)
		}
	}
}
