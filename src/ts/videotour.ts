/**
 * Video tour controller. Manages playback and camera animation for video tours
 * defined by a timeline of view rectangles and durations.
 * @author Marcel Duin <marcel@micr.io>
 */

import type { Models } from '../types/models';
import type { HTMLMicrioElement } from './element';
import type { MicrioImage } from './image';

import { get } from 'svelte/store';
import { View } from './utils';

/**
 * Internal representation of a segment in a video tour timeline.
 * @internal
 */
type VideoTourSegment = {
	/** Duration of the camera animation for this segment (ms). */
	duration: number;
	/** Duration to pause at the end of this segment's animation (ms). */
	pauseDuration: number;
	/** Start time of this segment's animation (ms). */
	start: number;
	/** Target camera view for this segment. */
	view: Models.Camera.View;
}


/**
 * Controls the playback of a video tour, animating the camera according
 * to a predefined timeline and synchronizing with associated audio/video media.
 * Instances are typically created and managed by the `Tour.svelte` component.
 */
export class VideoTourInstance {
	/** The parsed timeline segments derived from the tour data. @internal */
	private timeline: VideoTourSegment[] = [];

	/** Index of the currently active or upcoming timeline segment. @internal */
	private currentIndex: number|undefined;

	/** Progress percentage (0-1) to start the tour at (used by `setProgress`). @internal */
	private startAt: number|undefined;

	/** Timeout ID for scheduling the next step or pause. @internal */
	private _to:number|undefined;

	/** Internal flag indicating if the tour is currently paused by the user. @internal */
	private _paused:boolean = true;

	/** Flag indicating if the tour is actively playing (not paused or ended). @internal */
	private playing: boolean = false;

	/** Timestamp (ms since epoch) when the tour was last paused. @internal */
	private pausedAt: number|undefined;

	/** Flag indicating if the tour was paused before seeking. @internal */
	private wasPaused: boolean = false;

	/** Timestamp (ms since epoch) when the tour playback started or resumed. @internal */
	private startedAt: number|undefined;

	/** Flag indicating if user interaction events should be disabled during playback. @internal */
	private unhookEvents: boolean = false;

	/** The language-specific content data for the tour. @internal */
	private content: Models.ImageData.VideoTourCultureData;

	/** Reference to the main HTMLMicrioElement. @internal */
	private micrio: HTMLMicrioElement;

	/** The camera view when the tour started, used for resetting. @internal */
	private initialView: Models.Camera.View|undefined;

	/**
	 * Creates a VideoTourInstance.
	 * @param image The parent {@link MicrioImage} instance.
	 * @param data The {@link Models.ImageData.VideoTour} data object.
	 */
	constructor(
		private image: MicrioImage,
		private data: Models.ImageData.VideoTour
	) {
		this.micrio = image.wasm.micrio;
		this.initialView = image.camera.getView(); // Store initial view

		// Get language-specific content or fallback
		const content = 'timeline' in data ? <unknown>data as Models.ImageData.VideoTourCultureData
			: data.i18n?.[get(this.micrio._lang)] ?? undefined;

		if(!content) throw new Error('No valid content for video tour!'); // Ensure content exists

		this.content = content;

		// Determine if events should be unhooked based on tour data and current state
		this.unhookEvents = !data.keepInteraction && this.micrio.events.$enabled;

		data.instance = this; // Assign this instance to the tour data object

		this.read(); // Parse the timeline data

		this.micrio.events.dispatch('videotour-start', this.data); // Dispatch start event
	}

	/** Cleans up the tour instance, stops animations, and re-hooks events if necessary. */
	destroy() : void {
		if(this.unhookEvents) this.micrio.events.enabled.set(true); // Re-enable events
		if(!this.playing) return; // Exit if not playing
		this.image.camera.stop(); // Stop any camera animation
		this.micrio.removeAttribute('data-videotour-playing'); // Remove playing attribute
		this.micrio.events.dispatch('videotour-stop', this.data); // Dispatch stop event

		// Reset state variables
		this.playing = false;
		delete this.startedAt;
		delete this.data.instance; // Remove instance reference from data
		this.startAt = undefined;

		clearTimeout(this._to); // Clear any pending timeouts
	}

	/** Parses the raw timeline data from the tour content into the internal `timeline` array. */
	public read() : void {
		const isV5 = !!this.data.i18n; // Check if using V5 data format
		const dur = isV5 ? 1 : this.content.duration; // Duration multiplier (V5 times are relative 0-1)
		const timeline = this.content.timeline;

		this.timeline.length = 0; // Clear existing timeline

		// Convert raw timeline steps into internal VideoTourSegment format
		for(let i=0;i<timeline.length;i++) {
			const s = timeline[i], p = timeline[i-1]; // Current and previous raw steps
			const start = p ? p.end * dur : 0; // Calculate animation start time based on previous step's end
			this.timeline.push({
				view: s.rect, // Target view rectangle
				start: start * 1000, // Animation start time (ms)
				duration: (s.start * dur - start) * 1000, // Animation duration (ms)
				pauseDuration: (s.end - s.start) * dur * 1000 // Pause duration at the end of animation (ms)
			});
		}

		// If playback was already started, re-apply progress after parsing
		if(this.startedAt && !this.playing) this.progress = this.currentTime;
	}

	/** Getter for the total duration of the tour in seconds. */
	get duration():number { return Number(this.content.duration) }
	/** Setter for the total duration (updates internal content). */
	set duration(v:number) { this.content.duration = v }
	/** Getter for the current paused state. */
	get paused():boolean { return this._paused }
	/** Getter indicating if the tour has ended. */
	get ended():boolean { return this.currentTime >= this.duration }
	/** Getter for the current playback time in seconds. */
	get currentTime():number { return (this.pausedAt ? this.pausedAt : this.startedAt ? (Date.now() - this.startedAt) : 0) / 1000 }
	/** Setter for the current playback time (seeks to the corresponding progress). */
	set currentTime(v:number) { this.setProgress(v / this.content.duration) }
	/** Getter for the current progress percentage (0-1). */
	get progress():number { return this.currentTime / this.content.duration }
	/** Setter for the current progress percentage (seeks to that point). */
	set progress(v:number) { this.setProgress(v) }

	/** Starts or resumes tour playback. */
	play(): void {
		this.startedPlaying(); // Dispatch events and set attributes

		this.wasPaused = false; // Reset wasPaused flag

		// Resume from paused state
		if(this.pausedAt) {
			this.startedAt = Date.now() - (this.pausedAt); // Adjust start time based on pause duration
			this._paused = false;
			this.gotoTime(this.pausedAt); // Seek to the paused time
			this.pausedAt = undefined; // Clear paused timestamp
		}
		// Start from beginning or specified start point
		else if(!this.playing) {
			this.startedAt = Date.now(); // Set start time
			if(this.startAt === undefined) this.gotoStep(0,0); // Go to first step if no specific start point
			else this.gotoTime(this.duration * this.startAt * 1000); // Go to specified start time
			this.startAt = undefined; // Clear start point
		}

		this._paused = false; // Set paused state
		this.playing = true; // Set playing state
	}

	/** Pauses the tour playback. */
	pause(): void {
		if(this._paused || this.currentIndex == undefined || this.startedAt == undefined) return; // Exit if already paused or not started
		this._paused = true;
		this.stoppedPlaying(); // Dispatch events and set attributes

		clearTimeout(this._to); // Clear any pending step timeouts

		// Stop camera animation only if it was initiated by the tour timeline
		if(this.currentIndex >= 0) this.image.camera.stop();

		// If paused at the very end, reset the tour
		if(this.ended) this.reset();
		// Otherwise, store the current time when paused
		else this.pausedAt = Date.now() - this.startedAt;
	}

	/** Resets the tour state after ending or stopping. @internal */
	private reset(): void {
		this.stoppedPlaying();
		this.pausedAt = undefined;
		this.playing = false;
		this.read(); // Re-parse timeline (might not be necessary?)
	}

	/**
	 * Navigates the camera animation to a specific timeline step.
	 * Schedules the animation start based on the step's start time.
	 * @internal
	 * @param index The index of the target timeline segment.
	 * @param perc Optional starting progress percentage for the animation (0-1).
	 */
	private gotoStep(
		index:number,
		perc?:number // Start at this percentage of the segment transition
	) : void {
		if(this.startedAt == undefined) return; // Exit if tour hasn't started

		clearTimeout(this._to); // Clear existing timeout

		// Check if index is out of bounds (end of tour)
		if(!this.timeline[index]) {
			// Schedule pause at the end of the total duration if not already paused
			if(!this.paused || !this.wasPaused) {
				const remainingTime = Math.max(0, Math.round(this.duration*1000 - (Date.now() - this.startedAt)));
				this._to = <any>setTimeout(() => this.pause(), remainingTime) as number;
			}
			return;
		}

		const step = this.timeline[index]; // Get the target step data

		// Calculate time difference until the step should start
		const diff = Math.round(step.start - (Date.now() - this.startedAt));
		this.currentIndex = index; // Update current index
		this.image.camera.stop(); // Stop any previous camera animation

		// Schedule the animation start or start immediately if diff <= 0
		if(diff > 0) {
			if(!this._paused) // Only schedule if not paused
				this._to = <any>setTimeout(() => this.startAni(perc), diff) as number;
		}
		else this.startAni(perc); // Start animation immediately
	}

	/** Schedules navigation to the next step after the current step's pause duration. @internal */
	private nextStep() : void {
		if(this.currentIndex != undefined) this.gotoStep(this.currentIndex+1);
	}

	/** Gets the target view for a specific step index. @internal */
	private getView(i:number) : Models.Camera.View|undefined {
		const step = this.timeline[i];
		return step?.view;
	}

	/**
	 * Starts the camera animation for the current step.
	 * @internal
	 * @param perc Optional starting progress percentage for the animation (0-1).
	 */
	private startAni(perc:number=0) : void {
		if(this.currentIndex == undefined || isNaN(perc)) return; // Exit if index or percentage is invalid
		const step = this.timeline[this.currentIndex];

		if(step == undefined) return; // Exit if step data not found

		const nextView = View.toCenterJSON(step.view)!;
		const _prevView = this.getView(this.currentIndex-1);
		const prevView = _prevView ? View.toCenterJSON(_prevView) : undefined;
		const area = this.image.opts?.area;

		if(this.wasPaused && prevView) {
			const b:number = this.micrio.wasm.e.ease(perc);

			const iView = {
				centerX: prevView.centerX * (1-b) + nextView.centerX * b,
				centerY: prevView.centerY * (1-b) + nextView.centerY * b,
				width: prevView.width * (1-b) + nextView.width * b,
				height: prevView.height * (1-b) + nextView.height * b,
			};
			this.image.camera.setView([iView.centerX-iView.width/2, iView.centerY-iView.height/2, iView.width, iView.height], {noLimit: true, area});
			this.nextStep();
		} else {
			const flyPromise = this.image.camera.flyToView(step.view, {
				duration: step.duration,
				progress: perc,
				prevView: prevView ? [
					prevView.centerX-prevView.width/2,
					prevView.centerY-prevView.height/2,
					prevView.width,
					prevView.height
				] : undefined,
				area
			});
			flyPromise.then(() => { if(this.currentIndex != undefined && step == this.timeline[this.currentIndex]) this.nextStep() }).catch(() => {});
		}
	}

	/** Sets playing state attributes and dispatches events. @internal */
	private startedPlaying() : void {
		this.micrio.setAttribute('data-videotour-playing','');
		this.micrio.events.dispatch('videotour-play');
		if(this.unhookEvents) this.micrio.events.enabled.set(false); // Disable user interaction
	}

	/** Clears playing state attributes and dispatches events. @internal */
	private stoppedPlaying() : void {
		this.micrio.removeAttribute('data-videotour-playing');
		this.micrio.events.dispatch('videotour-pause');
		if(this.unhookEvents) this.micrio.events.enabled.set(true); // Re-enable user interaction
	}

	/**
	 * Seeks the tour to a specific progress percentage.
	 * @param perc The target progress (0-1).
	 */
	private setProgress(perc:number) : void {
		perc = Math.max(0, Math.min(1, perc)); // Clamp progress value
		this.wasPaused = !!this.paused || !this.playing; // Store current paused state
		this.pause(); // Pause playback before seeking

		// If tour wasn't paused before seeking, immediately set internal state back to playing
		if(!this.wasPaused) {
			this._paused = false;
			this.startedPlaying();
		}

		// Calculate target time in milliseconds
		const newTime:number = this.duration * perc * 1000;
		this.pausedAt = newTime; // Set paused time to target time

		this.gotoTime(newTime); // Seek the animation/camera to the target time

		// If tour was playing before seek, resume playback immediately
		if(!this.wasPaused) {
			this.pausedAt = undefined; // Clear paused time
			this._paused = false; // Ensure paused state is false
		} else {
			// If it was paused, ensure it remains paused after seeking
			this.pause();
		}
	}

	/**
	 * Seeks the tour playback to a specific timestamp (in milliseconds).
	 * Finds the correct timeline segment and starts the animation from the calculated progress.
	 * @internal
	 * @param ms The target timestamp in milliseconds.
	 */
	private gotoTime(ms:number) : void {
		let step: VideoTourSegment | null = null;
		let i=0;
		// Find the timeline segment containing the target timestamp
		for(;i<this.timeline.length;i++)
			if(this.timeline[i].start > ms) break; // Stop when segment start time is past the target time
			else step = this.timeline[i]; // Store the last segment whose start time is <= target time

		i--; // Adjust index to the segment containing the time

		if(!step && i>0) return; // Should not happen if ms <= duration
		else if (!step) { // If time is before the first step's animation starts
			if(this.timeline.length) this.image.camera.stop(); // Stop any animation
			if(!this.paused) // If playing, schedule start of first step
				this.gotoStep(0);
		}
		else { // If time is within or after a step's animation
			this.image.camera.stop(); // Stop current animation

			// Calculate progress percentage within the current step's animation
			const perc = step.duration > 0 ? (ms - step.start) / step.duration : 0;
			// Adjust the main `startedAt` timestamp to reflect the seek
			this.startedAt = Date.now() - step.start - (step.duration * perc);

			// Handle potential NaN if seeking exactly to the start (ms == step.start)
			if(isNaN(this.startedAt)) {
				this.startedAt = Date.now() - ms;
			}

			if(perc > 1) { // If time is within the pause duration *after* the animation
				this.gotoStep(i+1); // Schedule the next step
				// Set camera view to the end state of the current step instantly
				if(step.view != null) this.image.camera.setView(step.view, {noLimit: true});
			}
			else { // If time is within the animation duration of the current step
				// Set view to the start of the *previous* step instantly (needed for correct interpolation start)
				if(i > 0) this.image.camera.setView(this.timeline[i-1].view, {noLimit: true});
				// Start the animation for the current step at the calculated progress percentage
				this.gotoStep(i, perc);
			}
		}
	}

}

// Expose class globally (for potential external use or debugging)
/** @ts-ignore */
window['MicrioVideoTour'] = VideoTourInstance;
