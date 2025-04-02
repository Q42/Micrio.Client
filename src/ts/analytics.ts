import { VERSION } from './version';
import type { HTMLMicrioElement } from './element';

/**
 * Handles integration with Google Tag Manager (gtag.js) for tracking Micrio events.
 * Listens to specific Micrio custom events and sends corresponding events to GTM.
 */
export class GoogleTag {
	/**
	 * List of Micrio event types that are tracked by default.
	 * @internal
	 */
	static events = ['load', 'show', 'hide',
		'marker-open', 'marker-opened', 'marker-closed',
		'tour-start', 'tour-stop', 'tour-step', 'tour-ended'
	];

	/**
	 * Reference to the global `gtag` function provided by Google Tag Manager script.
	 * Uses the globally declared type from `declare global`.
	 * @internal
	 */
	private gtag = 'gtag' in window ? window['gtag'] : undefined; // Use the typed global gtag

	/** Flag indicating if event listeners are currently attached. @internal */
	private hooked:boolean = false;

	/**
	 * Creates a GoogleTag instance.
	 * @param micrio The main HTMLMicrioElement instance.
	*/
	constructor(
		private micrio:HTMLMicrioElement
	) { this.tag = this.tag.bind(this) } // Bind the tag method

	/**
	 * Hooks up event listeners to track Micrio events if gtag is available.
	 * Sends an 'init' event immediately upon hooking.
	 * @internal
	 */
	hook() : void {
		if(this.hooked || !this.gtag) return; // Exit if already hooked or gtag function not found
		this.hooked = true;
		this.tag(new CustomEvent('init')); // Send initial event
		// Add listeners for tracked Micrio events
		GoogleTag.events.forEach(e => this.micrio.addEventListener(e, this.tag));
	}

	/**
	 * Unhooks event listeners. Sends a 'hide' event upon unhooking.
	 * @internal
	 */
	unhook() : void {
		if(!this.hooked) return; // Exit if not hooked
		this.hooked = false;
		this.tag(new CustomEvent('hide')); // Send final event before unhooking
		// Remove listeners
		GoogleTag.events.forEach(e => this.micrio.removeEventListener(e, this.tag));
	}

	/**
	 * Event listener callback that formats and sends event data to Google Tag Manager.
	 * @internal
	 * @param e The Micrio CustomEvent object.
	*/
	private tag(e:Event) : void {
		if (!this.gtag) return; // Ensure gtag exists before sending

		const d = (e as CustomEvent).detail; // Get event detail
		const $curr = this.micrio.$current; // Get current image instance

		// Construct the gtag event parameters object
		const detail:any = {
			'event_category': 'Micrio', // Standard category
			'event_action': e.type, // Use Micrio event type as action
		};

		// Add current language if available
		if(this.micrio.lang) detail['culture'] = this.micrio.lang;

		// Add version information for specific events
		if(e.type == 'init') detail['micrio_version'] = VERSION; // Use imported VERSION
		if(e.type == 'load' && $curr?.$info) detail['image_version'] = $curr.$info.version;

		// Extract event value (e.g., tour step index) if present in detail
		const value = d !== null && typeof d == 'object' && 'currentStep' in d ? d.currentStep : null;
		if(value != null) detail['event_value'] = value;

		// Construct event label (Micrio element ID + optional title from detail or image info)
		// TODO: Consider using slugs from router for more consistent labeling if available
		const title:string = d && !!d['title'] ? d['title'] // Use title from event detail if present
			: $curr && $curr.$info && $curr.$info.title; // Fallback to current image title
		detail['event_label'] = this.micrio.id + (title ? ' - ' + title : ''); // Combine ID and title

		// Send the event to Google Tag Manager
		// @ts-ignore
		this.gtag('event', e.type, detail);
	}
}
