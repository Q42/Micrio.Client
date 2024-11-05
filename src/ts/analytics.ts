import { VERSION } from './version';
import type { HTMLMicrioElement } from './element';

export class GoogleTag {
	/** @internal */
	static events = ['load', 'show', 'hide',
		'marker-open', 'marker-opened', 'marker-closed',
		'tour-start', 'tour-stop', 'tour-step', 'tour-ended'
	];

	/** @ts-ignore @internal */
	private gtag:(a:string, b?:string, c?:Object) => void = window['gtag'];

	/** @internal */
	private hooked:boolean = false;

	/** Google Tag Manager tracker
	 * @param {!HTMLMicrioElement} micrio The Micrio instance
	*/
	constructor(
		private micrio:HTMLMicrioElement
	) { this.tag = this.tag.bind(this) }

	/** @internal */
	hook() : void {
		if(this.hooked || !this.gtag) return;
		this.hooked = true;
		this.tag(new CustomEvent('init'));
		GoogleTag.events.forEach(e => this.micrio.addEventListener(e, this.tag));
	}

	/** @internal */
	unhook() : void {
		if(!this.hooked) return;
		this.hooked = false;
		this.tag(new CustomEvent('hide'));
		GoogleTag.events.forEach(e => this.micrio.removeEventListener(e, this.tag));
	}

	/** Tag an event
	 * @internal
	*/
	private tag(e:Event) : void {
		const d = (e as CustomEvent).detail;
		const $curr = this.micrio.$current;
		const detail:any = {
			'event_category': 'Micrio',
			'event_action': e.type,
		};

		if(this.micrio.lang) detail['culture'] = this.micrio.lang;

		if(e.type == 'init') detail['micrio_version'] = Number(VERSION);
		if(e.type == 'load' && $curr?.$info) detail['image_version'] = $curr.$info.version;

		const value = d !== null && typeof d == 'object' && 'currentStep' in d ? d.currentStep : null;
		if(value != null) detail['event_value'] = value;

		const title:string = d && !!d['title'] ? d['title'] : $curr && $curr.$info && $curr.$info.title;
		detail['event_label'] = this.micrio.id + (title ? ' - ' + title : '');

		this.gtag('event', e.type, detail);
	}
}
