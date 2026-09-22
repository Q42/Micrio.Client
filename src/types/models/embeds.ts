import type { Assets } from './assets';

export namespace Embeds {
  export interface EmbedOptions {
    /** The embed opacity */
    opacity?: number;
    /** Do not print this embed until this zoom level (% of original) */
    fromScale?: number;
    /** The embed will have a minimal memory footprint, without its own camera */
    asImage?: boolean;
    /** Fit the embed's original size into the specified area. Defaults to 'stretch' */
    fit?: "contain" | "cover" | "stretch";
    /** Parallax factor for panning within a 2D image: 1 (default) moves with the camera 1:1, <1 moves slower (background), >1 moves faster (foreground) */
    parallax?: number;
    /** Exclude this embed from pointer hit-testing (drag/zoom targeting), so it acts as a decorative, non-interactive layer */
    isPassiveSecondary?: boolean;
    /** Which canvas to draw this embed on: 'back' (default, behind the DOM/UI layer) or 'front' (above it) */
    target?: 'back' | 'front';
    /** Alternate content states this embed cycles through via `.nextState()`/`.setState()` on the returned MicrioImage. When provided, the embed's initial texture is populated from `states[initialState]`. */
    states?: EmbedState[];
    /** Index of the state to show initially (default 0). Only meaningful when `states` is provided. */
    initialState?: number;
  }

  /** A single alternate content state for a GL embed: either a static image or a video. */
  export type EmbedState = EmbedImageState | EmbedVideoState;

  export interface EmbedImageState {
    /** URL for this state's static image */
    src: string;
    /** Use NEAREST (pixelated) magnification filtering for this state's texture */
    noSmoothing?: boolean;
  }

  /** Same field shape a JSON-driven video embed uses, kept structurally compatible with `Models.ImageData.Embed` */
  export interface EmbedVideoState {
    video?: Assets.Video & { pauseWhenSmallerThan?: number; pauseWhenLargerThan?: number };
    width?: number;
    height?: number;
    hideWhenPaused?: boolean;
    id?: string;
  }
}
