import { MicrioElement } from '$ts/component';
import type { Models } from '$types/models';
import type { HTMLMicrioElement } from '$ts/element';

export interface EventsProps {
	events: Models.ImageData.Event[];
	currentTime?: number;
	duration: number;
}

export class MicrioEvents extends MicrioElement<EventsProps> {
	static tag = 'micrio-events';
	static styles = '';

	#props: EventsProps = { events: [], duration: 0 };

	/** Called externally from Media to check/send event triggers at currentTime */
	update: ((time: number) => void) | undefined;

	onMount() {
		const micrio = this.inject<HTMLMicrioElement>('micrio');
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
					micrio.events.dispatch('tour-event', { ...e });
				}
			}
		};
	}

	setProps(props: Partial<EventsProps>) {
		Object.assign(this.#props, props);
	}

	onDestroy() {
		const micrio = this.inject<HTMLMicrioElement>('micrio');
		if (micrio) {
			const events = this.#props.events;
			events.forEach(e => {
				const active = e.active;
				if (active) { e.active = false; micrio.events.dispatch('tour-event', { ...e }); }
			});
		}
	}
}

customElements.define(MicrioEvents.tag, MicrioEvents);
