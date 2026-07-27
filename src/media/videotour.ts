/**
 * Video tour controller. Manages playback and camera animation for video tours
 * defined by a timeline of view rectangles and durations.
 * @author Marcel Duin <marcel@micr.io>
 */

import type { Models } from '$types/models';
import type { HTMLMicrioElement } from '$core/element';
import type { MicrioImage } from '$core/image';

import { get } from '$core/store';
import { toCenterJSON } from '$utils/math';
import { easeInOut } from '$render/easing';

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
 * Instances are typically created and managed internally.
 */
export class VideoTourInstance {
	/** The parsed timeline segments derived from the tour data. @internal */
	#timeline: VideoTourSegment[] = [];
	/** Index of the currently active or upcoming timeline segment. @internal */
	#currentIndex: number | undefined;
	/** Progress percentage (0-1) to start the tour at (used by `setProgress`). @internal */
	#startAt: number | undefined;
	/** Timeout ID for scheduling the next step or pause. @internal */
	#_to: ReturnType<typeof setTimeout> | undefined;
	/** Internal flag indicating if the tour is currently paused by the user. @internal */
	#_paused = true;
	/** Flag indicating if the tour is actively playing (not paused or ended). @internal */
	#playing = false;
	/** Timestamp (ms since epoch) when the tour was last paused. @internal */
	#pausedAt: number | undefined;
	/** Flag indicating if the tour was paused before seeking. @internal */
	#wasPaused = false;
	/** Timestamp (ms since epoch) when the tour playback started or resumed. @internal */
	#startedAt: number | undefined;
	/** Flag indicating if user interaction events should be disabled during playback. @internal */
	#unhookEvents = false;
	/** The language-specific content data for the tour. @internal */
	#content: Models.ImageData.VideoTourCultureData;
	/** Reference to the main HTMLMicrioElement. @internal */
	#micrio: HTMLMicrioElement;
	/** Reference to the parent MicrioImage. @internal */
	#image: MicrioImage;
	/** The tour data object. @internal */
	#data: Models.ImageData.VideoTour;

	/**
	 * Creates a VideoTourInstance.
	 * @param image The parent {@link MicrioImage} instance.
	 * @param data The {@link Models.ImageData.VideoTour} data object.
	 */
	constructor(
		image: MicrioImage,
		data: Models.ImageData.VideoTour
	) {
		this.#image = image;
		this.#data = data;
		this.#micrio = image.engine.micrio;
		const content = data.i18n?.[get(this.#micrio._lang)];
		if (!content) throw new Error('No valid content for video tour!');
		this.#content = content;
		this.#unhookEvents = !data.keepInteraction && this.#micrio.events.$enabled;
		data.instance = this;
		this.read();
		this.#initEvents();
		this.#micrio.events._dispatch('videotour-start', this.#data);
	}

	/** Cleans up the tour instance, stops animations, and re-hooks events if necessary. */
	destroy(): void {
		if (this.#unhookEvents) this.#micrio.events.enabled.set(true);
		this.#deactivateEvents();
		this.#micrio.removeAttribute('data-tour-active');
		clearTimeout(this.#_to);
		if (this.#playing) {
			this.#image.camera.stop();
			this.#playing = false;
		}
		this.#micrio.events._dispatch('videotour-stop', this.#data);
		this.#startedAt = undefined;
		this.#data.instance = undefined;
		this.#startAt = undefined;
	}

	/** Parses the raw timeline data from the tour content into the internal `timeline` array. */
	read(): void {
		const timeline = this.#content.timeline;
		this.#timeline = [];
		for (let i = 0; i < timeline.length; i++) {
			const s = timeline[i], p = timeline[i - 1];
			const start = p ? p.end : 0;
			this.#timeline.push({
				view: s.rect,
				start: start * 1000,
				duration: (s.start - start) * 1000,
				pauseDuration: (s.end - s.start) * 1000
			});
		}
		if (this.#startedAt && !this.#playing) this.progress = this.currentTime;
	}

	/** Initializes event data by clamping end times to duration. @internal */
	#initEvents(): void {
		const events = this.#content.events;
		if (!events?.length) return;
		const duration = this.duration;
		for (const e of events) {
			e.start = Number(e.start || 0);
			e.end = Math.min(Number(e.end || 0), duration);
		}
	}

	/** Deactivates any currently active events, dispatching a final `tour-event`. @internal */
	#deactivateEvents(): void {
		const events = this.#content.events;
		if (!events?.length) return;
		for (const e of events) {
			if (e.active) {
				e.active = false;
				this.#micrio.events._dispatch('tour-event', { ...e });
			}
		}
	}

	/**
	 * Checks all tour events against the given time and dispatches `tour-event`
	 * when an event becomes active or inactive.
	 * Called externally during playback (e.g. from MicrioMedia time updates).
	 */
	updateEvents(time: number): void {
		const events = this.#content.events;
		if (!events?.length) return;
		for (const e of events) {
			const active = e.start <= time && e.end >= time;
			if (active != !!e.active) {
				e.active = active;
				this.#micrio.events._dispatch('tour-event', { ...e });
			}
		}
	}

	/** Getter for the total duration of the tour in seconds. */
	get duration(): number { return Number(this.#content.duration) }
	/** Setter for the total duration (updates internal content). */
	set duration(v: number) { this.#content.duration = v }
	/** Getter for the current paused state. */
	get paused(): boolean { return this.#_paused }
	/** Getter indicating if the tour has ended. */
	get ended(): boolean { return this.currentTime >= this.duration }
	/** Getter for the current playback time in seconds. */
	get currentTime(): number { return (this.#pausedAt ?? (this.#startedAt ? Date.now() - this.#startedAt : 0)) / 1000 }
	/** Setter for the current playback time (seeks to the corresponding progress). */
	set currentTime(v: number) { this.#setProgress(v / this.#content.duration) }
	/** Getter for the current progress percentage (0-1). */
	get progress(): number { return this.currentTime / this.#content.duration }
	/** Setter for the current progress percentage (seeks to that point). */
	set progress(v: number) { this.#setProgress(v) }

	/** Starts or resumes tour playback. */
	play(): void {
		this.#startedPlaying();
		this.#wasPaused = false;

		if (this.#pausedAt) {
			this.#startedAt = Date.now() - this.#pausedAt;
			this.#_paused = false;
			this.#gotoTime(this.#pausedAt);
			this.#pausedAt = undefined;
		} else if (!this.#playing) {
			this.#startedAt = Date.now();
			if (this.#startAt === undefined) this.#gotoStep(0, 0);
			else this.#gotoTime(this.duration * this.#startAt * 1000);
			this.#startAt = undefined;
		}

		this.#_paused = false;
		this.#playing = true;
	}

	/** Pauses the tour playback. */
	pause(): void {
		if (this.#_paused || this.#currentIndex == undefined || this.#startedAt == undefined) return;
		this.#_paused = true;
		this.#stoppedPlaying();
		clearTimeout(this.#_to);
		if (this.#currentIndex >= 0) this.#image.camera.stop();
		if (this.ended) this.#reset();
		else this.#pausedAt = Date.now() - this.#startedAt;
	}

	/** Resets the tour state after ending or stopping. @internal */
	#reset(): void {
		this.#stoppedPlaying();
		this.#pausedAt = undefined;
		this.#playing = false;
		this.read();
	}

	/**
	 * Navigates the camera animation to a specific timeline step.
	 * Schedules the animation start based on the step's start time.
	 * @internal
	 * @param index The index of the target timeline segment.
	 * @param perc Optional starting progress percentage for the animation (0-1).
	 */
	#gotoStep(index: number, perc?: number): void {
		if (this.#startedAt == undefined) return;
		clearTimeout(this.#_to);

		if (!this.#timeline[index]) {
			if (!this.paused || !this.#wasPaused) {
				const remaining = Math.max(0, Math.round(this.duration * 1000 - (Date.now() - this.#startedAt)));
				if (remaining > 0) this.#_to = setTimeout(() => this.pause(), remaining);
			}
			return;
		}

		const step = this.#timeline[index];
		const diff = Math.round(step.start - (Date.now() - this.#startedAt));
		this.#currentIndex = index;
		this.#image.camera.stop();

		if (diff > 0) {
			if (!this.#_paused) this.#_to = setTimeout(() => this.#startAni(perc), diff);
		} else {
			this.#startAni(perc);
		}
	}

	/** Schedules navigation to the next step after the current step's pause duration. @internal */
	#nextStep(): void {
		if (this.#currentIndex != undefined) this.#gotoStep(this.#currentIndex + 1);
	}

	/**
	 * Starts the camera animation for the current step.
	 * @internal
	 * @param perc Optional starting progress percentage for the animation (0-1).
	 */
	#startAni(perc = 0): void {
		if (this.#currentIndex == undefined || isNaN(perc)) return;
		const step = this.#timeline[this.#currentIndex];
		if (!step) return;

		const prevStep = this.#timeline[this.#currentIndex - 1];
		const prevView: Models.Camera.View | undefined = prevStep?.view;

		if (this.#wasPaused && prevView) {
			const p = easeInOut.get(perc);
			const pv = toCenterJSON(prevView);
			const nv = toCenterJSON(step.view);
			this.#image.camera.setView([
				pv.centerX * (1 - p) + nv.centerX * p - (pv.width * (1 - p) + nv.width * p) / 2,
				pv.centerY * (1 - p) + nv.centerY * p - (pv.height * (1 - p) + nv.height * p) / 2,
				pv.width * (1 - p) + nv.width * p,
				pv.height * (1 - p) + nv.height * p
			], { noLimit: true });
			this.#nextStep();
		} else {
			this.#image.camera.flyToView(step.view, {
				duration: step.duration,
				progress: perc,
				prevView,
			}).then(() => {
				if (this.#currentIndex != undefined && step === this.#timeline[this.#currentIndex])
					this.#nextStep();
			}).catch(() => {});
		}
	}

	/** Sets playing state attributes and dispatches events. @internal */
	#startedPlaying(): void {
		this.#micrio.setAttribute('data-tour-active', '');
		this.#micrio.events._dispatch('videotour-play');
		if (this.#unhookEvents) this.#micrio.events.enabled.set(false);
	}

	/** Clears playing state attributes and dispatches events. @internal */
	#stoppedPlaying(): void {
		//this.#micrio.removeAttribute('data-tour-active');
		this.#micrio.events._dispatch('videotour-pause');
		if (this.#unhookEvents) this.#micrio.events.enabled.set(true);
	}

	/**
	 * Seeks the tour to a specific progress percentage.
	 * @param perc The target progress (0-1).
	 */
	#setProgress(perc: number): void {
		perc = Math.max(0, Math.min(1, perc));
		this.#wasPaused = !!this.paused || !this.#playing;
		this.pause();

		if (!this.#wasPaused) {
			this.#_paused = false;
			this.#startedPlaying();
		}

		const newTime = this.duration * perc * 1000;
		this.#pausedAt = newTime;
		this.#gotoTime(newTime);

		if (!this.#wasPaused) {
			this.#pausedAt = undefined;
			this.#_paused = false;
		} else {
			this.pause();
		}
	}

	/**
	 * Seeks the tour playback to a specific timestamp (in milliseconds).
	 * Finds the correct timeline segment and starts the animation from the calculated progress.
	 * @internal
	 * @param ms The target timestamp in milliseconds.
	 */
	#gotoTime(ms: number): void {
		let seg: VideoTourSegment | undefined;
		let i = 0;
		for (; i < this.#timeline.length && this.#timeline[i].start <= ms; i++)
			seg = this.#timeline[i];

		if (!seg) {
			if (this.#timeline.length) this.#image.camera.stop();
			if (!this.paused) this.#gotoStep(0);
			this.updateEvents(ms / 1000);
			return;
		}

		this.#image.camera.stop();
		const perc = seg.duration > 0 ? (ms - seg.start) / seg.duration : 0;
		this.#startedAt = Date.now() - seg.start - seg.duration * perc;

		if (perc > 1) {
			this.#gotoStep(i);
			if (seg.view) this.#image.camera.setView(seg.view, { noLimit: true });
		} else {
			if (i > 1) this.#image.camera.setView(this.#timeline[i - 2].view, { noLimit: true });
			this.#gotoStep(i - 1, perc);
		}

		this.updateEvents(ms / 1000);
	}
}
