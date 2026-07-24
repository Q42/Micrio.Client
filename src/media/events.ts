import { MicrioElement } from '$core/component';
import type { Models } from '$types/models';

/** Props for the MicrioEvents component. @internal */
export interface EventsProps {
	events: Models.ImageData.Event[];
	currentTime?: number;
	duration: number;
}

/** Custom element that dispatches tour-event custom events at defined media cue points. */
class MicrioEvents extends MicrioElement<EventsProps> {
	static tag = 'micrio-events';

	#props: EventsProps = { events: [], duration: 0 };

	/** Called externally from Media to check/send event triggers at currentTime */
	update: ((time: number) => void) | undefined;

	/** @internal */
	_onMount() {
		const micrio = this._getMicrio();
		if (!micrio) return;

		const events = this.#props.events;
		const duration = this.#props.duration;
		events.forEach(e => {
			e.start = Number(e.start || 0);
			e.end = Math.min(Number(e.end || 0), duration);
		});

		this.update = (time: number) => {
			for (const e of this.#props.events) {
				const active = e.start <= time && e.end >= time;
				if (active != !!e.active) {
					e.active = active;
					micrio.events._dispatch('tour-event', { ...e });
				}
			}
		};
	}

	/** @internal */
	_setProps(props: Partial<EventsProps>) {
		Object.assign(this.#props, props);
	}

	/** @internal */
	_onDestroy() {
		const micrio = this._getMicrio();
		if (micrio) {
			const events = this.#props.events;
			events.forEach(e => {
				const active = e.active;
				if (active) { e.active = false; micrio.events._dispatch('tour-event', { ...e }); }
			});
		}
	}
}

customElements.define(MicrioEvents.tag, MicrioEvents);
