/** How an embed is presented after its configuration has been resolved. @internal */
export type EmbedMode = 'html' | 'gl' | 'gl+overlay'

/** @internal */
export interface EmbedPresentation {
	readonly mode: EmbedMode
	readonly rawVideo: boolean
	readonly noEvents: boolean
}

/** @internal */
export interface EmbedPresentationInput {
	readonly isBook3d: boolean
	readonly imageAsHtml: boolean
	readonly forceGL: boolean
	readonly isSmall: boolean
	readonly hasSrc: boolean
	readonly hasSubImage: boolean
	readonly hasVideo: boolean
	readonly videoControls: boolean
	readonly videoTransparent: boolean
	readonly clickAction: boolean
	readonly frameSrc: boolean
	readonly hasMarker: boolean
}

/** @internal */
export function embedPresentation(input: EmbedPresentationInput): EmbedPresentation {
	const gl =
		!input.isBook3d &&
		!input.imageAsHtml &&
		((input.hasSubImage && (input.forceGL || !input.isSmall || !input.hasSrc)) ||
			(input.hasVideo && !input.videoControls && !input.videoTransparent))
	const html = !gl || input.clickAction
	let mode: EmbedMode = 'html'
	if (gl) {
		mode = html ? 'gl+overlay' : 'gl'
	}
	return {
		mode,
		rawVideo: gl && input.hasVideo,
		noEvents: !input.clickAction && !input.frameSrc && !input.hasMarker && !(input.hasVideo && input.videoControls),
	}
}
