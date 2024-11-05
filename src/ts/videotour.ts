/**
 * Video tour controller
 * @author Marcel Duin <marcel@micr.io>
 * @copyright Q42 Internet BV, Micrio, 2015 - 2024
 * @link https://micr.io/ , https://q42.nl/en/
*/

import type { Models } from '../types/models';
import type { HTMLMicrioElement } from './element';
import type { MicrioImage } from './image';

import { get } from 'svelte/store';

/** Internal video tour segment JSON data
 * @internal
*/
type VideoTourSegment = {
	duration: number;
	pauseDuration: number;
	start: number;
	view: Models.Camera.View;
}


/** The Video Tour class */
export class VideoTourInstance {
	/** The tour timeline */
	private timeline: VideoTourSegment[] = [];

	/** Current timeline segment index
	 * @internal
	*/
	private currentIndex: number|undefined;

	/** (Re)start the tour at this point
	 * @internal
	*/
	private startAt: number|undefined;

	/** Internal timeout handle
	 * @internal
	*/
	private _to:number|undefined;

	/** The playing state
	 * @internal
	*/
	private playing: boolean = false;

	/** Internal paused state
	 * @internal
	*/
	private _paused:boolean = true;

	/** Paused at timestamp
	 * @internal
	*/
	private pausedAt: number|undefined;

	/** Is paused
	 * @internal
	*/
	private wasPaused: boolean = false;

	/** Started at timestamp
	 * @internal
	*/
	private startedAt: number|undefined;

	/** Unhook user events while playing
	 * @internal
	*/
	private unhookEvents: boolean = false;

	private content: Models.ImageData.VideoTourCultureData;

	/** Micrio instance */
	private micrio: HTMLMicrioElement;

	/** Starting view
	 * @internal
	*/
	private initialView: Models.Camera.View|undefined;

	/** Set the data */
	constructor(
		private image: MicrioImage,
		private data: Models.ImageData.VideoTour
	) {
		this.micrio = image.wasm.micrio;
		this.initialView = image.camera.getView();

		const content = 'timeline' in data ? <unknown>data as Models.ImageData.VideoTourCultureData
			: data.i18n?.[get(this.micrio._lang)] ?? undefined;

		if(!content) throw new Error('No valid content for video tour!');

		this.content = content;

		// For video tour, by default unhook events when running
		this.unhookEvents = !data.keepInteraction && this.micrio.events.$enabled;

		data.instance = this;

		this.read();

		this.micrio.events.dispatch('videotour-start', this.data);
	}

	destroy() : void {
		if(this.unhookEvents) this.micrio.events.enabled.set(true);
		if(!this.playing) return;
		this.image.camera.stop();
		this.micrio.removeAttribute('data-videotour-playing');
		this.micrio.events.dispatch('videotour-stop', this.data);

		this.playing = false;

		delete this.startedAt;
		delete this.data.instance;
		this.startAt = undefined;

		clearTimeout(this._to);
	}

	/** Parse the timeline data */
	public read() : void {
		const isV5 = !!this.data.i18n;
		const dur = isV5 ? 1 : this.content.duration;
		const timeline = this.content.timeline;

		this.timeline.length = 0;

		for(let i=0;i<timeline.length;i++) {
			const s = timeline[i], p = timeline[i-1];
			const start = p && p.end * dur || 0;
			this.timeline.push({
				view: s.rect,
				start: start * 1000,
				duration: (s.start * dur - start) * 1000,
				pauseDuration: (s.end - s.start) * dur * 1000
			});
		}

		if(this.startedAt && !this.playing) this.progress = this.currentTime;
	}

	get duration():number { return Number(this.content.duration) }
	set duration(v:number) { this.content.duration = v }
	get paused():boolean { return this._paused }
	get ended():boolean { return this.currentTime >= this.duration }
	get currentTime():number { return (this.pausedAt ? this.pausedAt : this.startedAt ? (Date.now() - this.startedAt) : 0) / 1000 }
	set currentTime(v:number) { this.setProgress(v / this.content.duration) }
	get progress():number { return this.currentTime / this.content.duration }
	set progress(v:number) { this.setProgress(v) }

	/** Play/resume the tour */
	play(): void {
		this.startedPlaying();

		this.wasPaused = false;

		// Resume from paused state
		if(this.pausedAt) {
			this.startedAt = Date.now() - (this.pausedAt);
			this._paused = false;
			this.gotoTime(this.pausedAt);
			this.pausedAt = undefined;
		}

		// Start from beginning
		else if(!this.playing) {
			this.startedAt = Date.now();
			if(this.startAt === undefined) this.gotoStep(0,0);
			else this.gotoTime(this.duration * this.startAt * 1000);
			this.startAt = undefined;
		}

		this._paused = false;
		this.playing = true;
	}

	/** Pause the tour */
	pause(): void {
		if(this._paused || this.currentIndex == undefined || this.startedAt == undefined) return;
		this._paused = true;
		this.stoppedPlaying();

		clearTimeout(this._to);

		// Only stop camera when it's doing an animation from our timeline
		if(this.currentIndex >= 0) this.image.camera.stop();

		if(this.ended) this.reset();
		else this.pausedAt = Date.now() - this.startedAt;
	}

	/** Reset after ended
	 * @internal
	*/
	private reset(): void {
		this.stoppedPlaying();
		this.pausedAt = undefined;
		this.playing = false;
		this.read();
	}

	/** Go to time segment index */
	private gotoStep(
		/** The segment index */
		index:number,
		/** Start at the percentage of the segment transition */
		perc?:number
	) : void {
		if(this.startedAt == undefined) return;

		clearTimeout(this._to);

		if(!this.timeline[index]) { // reached end of tour
			// If not playing, do nothing
			if(!this.paused || !this.wasPaused) (this._to = <any>setTimeout(() => this.pause(),
				Math.round(this.duration*1000 - (Date.now() - this.startedAt))
			) as number);
			return;
		}

		const step = this.timeline[index];

		const diff = Math.round(step.start - (Date.now() - this.startedAt));
		this.currentIndex = index;
		this.image.camera.stop();

		if(diff > 0) {
			if(!this._paused)
				this._to = <any>setTimeout(() => this.startAni(perc), diff) as number;
		}
		else this.startAni(perc);
	}

	/** Go to the next tour segment */
	private nextStep() : void {
		if(this.currentIndex != undefined) this.gotoStep(this.currentIndex+1);
	}

	/** Get a viewport for a step index */
	private getView(i:number) : Models.Camera.View|undefined {
		const step = this.timeline[i];
		if(step == undefined) return this.initialView ?? this.image.camera.getView();
		else return step.view;
	}

	/** Start a segment animation */
	private startAni(
		/** Start at this animation percentage */
		perc:number=0
	) : void {
		if(this.currentIndex == undefined || isNaN(perc)) return;
		const step = this.timeline[this.currentIndex];

		if(step == undefined) return;

		const next = step.view;

		const prev = this.getView(this.currentIndex-1);

		const area = this.image.opts?.area;

		if(this.wasPaused && prev) { // simple set view
			// Get beziered value
			const b:number = this.micrio.wasm.e.ease(perc);
			this.image.camera.setView([
				prev[0] * (1-b) + next[0] * b,
				prev[1] * (1-b) + next[1] * b,
				prev[2] * (1-b) + next[2] * b,
				prev[3] * (1-b) + next[3] * b,
			], {noLimit: true, area});
			this.nextStep();
		}

		else {
			this.image.camera.flyToView(next, {duration:step.duration, progress: perc, prevView: prev, area})
				.then(() => { if(this.currentIndex != undefined && step == this.timeline[this.currentIndex]) this.nextStep() })
				.catch(() => {});
		}
	}

	/** For setting eventing and class also when paused
	 * @internal
	*/
	private startedPlaying() : void {
		this.micrio.setAttribute('data-videotour-playing','');
		this.micrio.events.dispatch('videotour-play');
		if(this.unhookEvents) this.micrio.events.enabled.set(false);
	}

	/** For setting eventing and class also when paused
	 * @internal
	*/
	private stoppedPlaying() : void {
		this.micrio.removeAttribute('data-videotour-playing');
		this.micrio.events.dispatch('videotour-pause');
		if(this.unhookEvents) this.micrio.events.enabled.set(true);
	}

	/** Set the tour to this progress percentage */
	private setProgress(perc:number) : void {
		perc = Math.max(0, Math.min(1, perc));
		this.wasPaused = !!this.paused || !this.playing;
		this.pause();
		if(!this.wasPaused) {
			this._paused = false;
			this.startedPlaying();
		}

		// Switch to time
		const newTime:number = this.duration * perc * 1000;
		this.pausedAt = newTime;

		this.gotoTime(newTime);
		if(this.wasPaused) this.pause();
		else {
			this.pausedAt = 0;
			this._paused = false;
		}
	}

	/** Go to a timestamp in milliseconds */
	private gotoTime(ms:number) : void {
		let step = null, i=0;
		for(;i<this.timeline.length;i++)
			if(this.timeline[i].start > ms) break;
			else step = this.timeline[i];

		i--;

		if(!step && i>0) return;
		else if (!step) { // Before first step
			if(this.timeline.length) this.image.camera.stop();
			if(!this.paused)
				this.gotoStep(0);
		}
		else {
			this.image.camera.stop();

			const perc = step.duration > 0 ? (ms - step.start) / step.duration : 0;
			this.startedAt = Date.now() - step.start - (step.duration * perc);

			// Before first transition
			if(isNaN(this.startedAt)) {
				this.startedAt = Date.now() - ms;
			}

			if(perc > 1) { // In between steps
				this.gotoStep(i+1);
				if(step.view != null) this.image.camera.setView(step.view, {noLimit: true});
			}
			else { // In a step -- update the ani
				// Set view of previous step
				if(i > 0) this.image.camera.setView(this.timeline[i-1].view, {noLimit: true});
				this.gotoStep(i, perc);
			}
		}

	}

}

/** @ts-ignore */
window['MicrioVideoTour'] = VideoTourInstance;
