/**
 * Media utilities for source parsing, type detection, and player management.
 * @author Marcel Duin <marcel@micr.io>
 */

import type { Models } from '../../types/models';
import { MediaType, FrameType } from '../../types/internal';

// ============================================================================
// Source Parsing
// ============================================================================

/** YouTube URL regex pattern */
const YOUTUBE_URL_PATTERN = /((?:https?:)?\/\/)?((?:www|m)\.)?((?:youtube\.com|youtu.be|youtube-nocookie\.com))(\/(?:[\w\-]+\?v=|embed\/|v\/)?)([\w\-]+)(\S+)?/;

/** Vimeo URL regex pattern */
const VIMEO_URL_PATTERN = /vimeo\.com/;

/** Time parameter regex (e.g., t=120) */
const TIME_PARAM_PATTERN = /^.*t=(\d+).*$/;

/** YouTube no-cookies host */
export const YOUTUBE_HOST = 'https://www.youtube-nocookie.com';

/**
 * Parsed media source information.
 */
export interface ParsedMediaSource {
	/** The detected media type */
	type: MediaType;
	/** The frame type for iframe embeds (YouTube/Vimeo) */
	frameType?: FrameType;
	/** The normalized/processed source URL */
	src?: string;
	/** Original source URL */
	originalSrc?: string;
	/** YouTube video ID (if applicable) */
	youtubeId?: string;
	/** Vimeo video ID (if applicable) */
	vimeoId?: string;
	/** Vimeo hash token (if applicable) */
	vimeoToken?: string;
	/** Cloudflare video ID (if applicable) */
	cloudflareId?: string;
	/** Micrio embed data [id, width?, height?, lang?] */
	micrioEmbed?: string[];
	/** Start time extracted from URL (seconds) */
	startTime?: number;
	/** Whether the source is a Cloudflare stream */
	isCloudflare: boolean;
	/** M3U8 URL for HLS streams */
	hlsSrc?: string;
}

/**
 * Sanitizes and normalizes a media source URL.
 */
function sanitizeSource(src: string | undefined): string | undefined {
	if (!src) return undefined;

	// Extract src from iframe tags
	if (/<iframe /.test(src)) {
		src = src.replace(/^.* src="([^"]+)".*$/, '$1');
	}

	// Convert video:// protocol to https://
	if (src.startsWith('video://')) {
		src = src.replace('video:', 'https:');
	}

	return src;
}

/**
 * Parses a media source URL and determines its type and configuration.
 */
export function parseMediaSource(
	src: string | undefined,
	tour: Models.ImageData.VideoTour | null,
	useNativeFrames: boolean = false,
	currentTime: number = 0
): ParsedMediaSource {
	src = sanitizeSource(src);
	const srcLower = src?.toLowerCase();

	// Default result
	const result: ParsedMediaSource = {
		type: MediaType.None,
		originalSrc: src,
		isCloudflare: false,
	};

	// No source but has tour = VideoTour (audio-only)
	if (!src && tour) {
		result.type = MediaType.VideoTour;
		return result;
	}

	if (!src || !srcLower) return result;

	// Check for Cloudflare video
	if (src.startsWith('cfvid://')) {
		result.isCloudflare = true;
		result.cloudflareId = src.slice(8);
		result.hlsSrc = `https://videodelivery.net/${result.cloudflareId}/manifest/video.m3u8`;
		result.type = MediaType.Video;
		return result;
	}

	// Audio file
	if (srcLower.endsWith('.mp3')) {
		result.type = MediaType.Audio;
		result.src = src;
		return result;
	}

	// Video file
	if (srcLower.endsWith('.mp4') || srcLower.endsWith('.webm')) {
		result.type = MediaType.Video;
		result.src = src;
		return result;
	}

	// Micrio embed
	if (srcLower.startsWith('micrio://')) {
		result.type = MediaType.Micrio;
		result.micrioEmbed = src.slice(9).split(',');
		return result;
	}

	// Check for YouTube
	if (!useNativeFrames) {
		const ytMatch = YOUTUBE_URL_PATTERN.exec(src);
		if (ytMatch?.[5]) {
			// Handle playlist URLs
			if (ytMatch[5] === 'playlist') {
				const listId = /list=([^&]+)/.exec(src);
				if (listId?.[1]) {
					result.type = MediaType.IFrame;
					result.src = `${YOUTUBE_HOST}/embed/videoseries?list=${listId[1]}`;
					return result;
				}
			} else {
				// Single video URL
				result.type = MediaType.IFrame;
				result.frameType = FrameType.YouTube;
				result.youtubeId = ytMatch[5];

				// Extract start time
				const startTime = TIME_PARAM_PATTERN.test(src)
					? Number(src.replace(TIME_PARAM_PATTERN, '$1'))
					: currentTime;
				result.startTime = Math.round(startTime);

				result.src = `${YOUTUBE_HOST}/embed/${ytMatch[5]}?autoplay=0&enablejsapi=1&controls=0&start=${result.startTime}`;
				return result;
			}
		}

		// Check for Vimeo
		if (VIMEO_URL_PATTERN.test(src)) {
			const idMatch = src.match(/\/(\d+)/);
			if (idMatch?.[1]) {
				result.type = MediaType.IFrame;
				result.frameType = FrameType.Vimeo;
				result.vimeoId = idMatch[1];

				// Extract hash token
				const tokenPart = src.slice(src.indexOf(idMatch[1]) + idMatch[1].length + 1);
				result.vimeoToken = tokenPart.replace(/\?.*$/, '') || undefined;

				const startTime = Math.round(currentTime);
				result.src = `https://player.vimeo.com/video/${idMatch[1]}?${
					result.vimeoToken ? `h=${result.vimeoToken}&` : ''
				}title=0&portrait=0&sidedock=0&byline=0&controls=0#t=${startTime}s`;
				return result;
			}
		}
	}

	// Generic HTTP URL = iframe
	if (srcLower.startsWith('http')) {
		result.type = MediaType.IFrame;
		result.src = src;
		return result;
	}

	return result;
}

// ============================================================================
// Native HLS Support Detection
// ============================================================================

/**
 * Checks if the browser natively supports HLS playback.
 */
export function hasNativeHLS(el?: HTMLMediaElement): boolean {
	const video = el ?? document.createElement('video');
	return video.canPlayType('application/vnd.apple.mpegurl') !== '';
}

// ============================================================================
// iOS Shared Audio Element
// ============================================================================

let _iOSAudioElement: HTMLAudioElement | undefined;

/**
 * Returns a shared Audio element instance for iOS.
 * This is a workaround for iOS audio playback restrictions where user
 * interaction is required per audio element.
 */
export function getIOSAudioElement(): HTMLAudioElement {
	if (!_iOSAudioElement) {
		_iOSAudioElement = new Audio();
	}
	return _iOSAudioElement;
}
