import type { Models } from './models';

export type PREDEFINED = [string, Models.ImageInfo.ImageInfo, Models.ImageData.ImageData|undefined];

/** Enum for identifying media type. */
export enum MediaType { None = 0, IFrame = 1, Video = 2, Audio = 3, VideoTour = 4, Micrio = 5 }
/** Enum for identifying iframe player type. */
export enum FrameType { YouTube = 1, Vimeo = 2 }
