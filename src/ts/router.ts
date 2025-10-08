import type { HTMLMicrioElement } from './element';
import type { Models } from '../types/models';
import type { MicrioImage } from './image';

import { get } from 'svelte/store';

import { slugify, once } from './utils';

/**
 * Handles URL routing for the Micrio viewer, enabling deep linking to specific images,
 * markers, tours, and language states. It updates the browser's URL (hash or path)
 * based on the viewer state and reads the URL on load or navigation to restore state.
 * @internal
 */
export class Router {
	/** Events that trigger a URL update. @internal */
	private static events:string[] = [
		'load', // Image loaded
		'tour-start',
		'tour-stop',
		'marker-open',
		'marker-closed',
		'page-open', // Custom page popover opened
		'page-closed',
		'lang-switch'
	];

	/** If true, uses History API (pushState/replaceState) with pathnames instead of hash fragments. @internal */
	private isStatic:boolean = false;

	/** The current route string derived from the URL. @internal */
	private route:string|undefined;

	/** Flag indicating if the initial image has loaded. @internal */
	private loaded:boolean = false;

	/** Flag indicating if the initial route has been read and applied. @internal */
	private inited:boolean = false;

	/** Flag to prevent reading the URL while the router is actively writing it. @internal */
	private setting:boolean = false;

	/** Timeout ID for debouncing write operations. @internal */
	private _to:number|undefined;

	/** Stores the previously active language to detect changes. @internal */
	private prevLang:string|undefined;

	/** If true, updates the document title based on the current state. */
	public writeTitle:boolean = false;

	/**
	 * Creates the Router instance.
	 * @param micrio The main <micr-io> instance.
	 */
	constructor(private micrio:HTMLMicrioElement) { }

	/**
	 * Hooks up event listeners for URL changes and state updates.
	 * @internal
	*/
	hook() : void {
		// Determine routing mode (static path or hash)
		this.isStatic = this.micrio.getAttribute('data-router') == 'static';

		// Bind methods
		this.read = this.read.bind(this);
		this.write = this.write.bind(this);
		this.writeDeferred = this.writeDeferred.bind(this);

		// Read initial route once the first image is potentially loaded
		once(this.micrio.current).then(() => { this.loaded = true; this.read() })
		// Listen to internal events to trigger URL updates
		Router.events.forEach(e => this.micrio.addEventListener(e, this.write));

		// Enable title writing automatically if on the Micrio domain
		if(location.hostname == 'i.micr.io') this.writeTitle = true;

		// Listen for browser navigation events (back/forward buttons)
		window.addEventListener(this.isStatic ? 'popstate': 'hashchange', this.read);
	}

	/**
	 * Unhooks event listeners.
	 * @internal
	*/
	unhook() : void {
		Router.events.forEach(e => this.micrio.removeEventListener(e, this.write));
		window.removeEventListener(this.isStatic ? 'popstate': 'hashchange', this.read);
	}

	/**
	 * Recursively searches through menu pages to find one matching a slug.
	 * @internal
	 * @param slug The URL slug to find.
	 * @param pages The array of menu pages to search.
	 * @param lang The current language code.
	 * @returns The matching Menu object or undefined.
	 */
	private findPage(slug: string, pages: Models.ImageData.Menu[]|undefined, lang:string) : Models.ImageData.Menu|undefined {
		if(pages) for(let i=0;i<pages.length;i++) {
			// Get language-specific data or fallback
			const cData = pages[i]?.i18n?.[lang] ?? (<unknown>pages[i] as Models.ImageData.MenuCultureData);
			// Check current page title slug or recursively search children
			let m = slugify(cData.title) == slug ? pages[i]
				: this.findPage(slug, pages[i].children, lang);
			if(m) return m; // Return if found
		}
	}

	/**
	 * Reads the current URL (pathname or hash) and updates the Micrio state accordingly.
	 * Parses the route segments to identify image ID, language, slugs for tours/markers/pages.
	 * @internal
	*/
	private read() : void {
		// Prevent reading if not loaded or currently writing the URL
		if(!this.loaded || this.setting) return;
		// Get route string from pathname or hash
		this.route = (this.isStatic ? location.pathname : location.hash).slice(1);
		// Split route into segments
		const [id, lang, slug, markerOrTourOrPage, marker] = this.route.split('/');

		const main = this.micrio.$current;
		// Open image if ID in URL is different from current
		const curr = id && main?.id != id ? this.micrio.open(id) : undefined;

		// Wait for data of current and potentially newly opened image
		if(main) Promise.all([
				once(main.data, {allowUndefined: true}),
				curr ? once(curr.data, {allowUndefined: true}) : undefined // Wait for new image data if applicable
			]).then((d2:[Models.ImageData.ImageData|undefined, Models.ImageData.ImageData|undefined]) => {
			if(!d2[0]) return this.inited = true; // Exit if no data for main image
			if(this.prevLang === undefined) this.prevLang = this.micrio.lang; // Store initial language

			// Check setting to disable marker tour routing
			if(curr?.$settings.routerMarkerTours === false) return;

			// Check for deeplinked menu page slug
			if(d2[0].pages?.length && markerOrTourOrPage) {
				const page = this.findPage(markerOrTourOrPage.toLowerCase(), d2[0].pages, lang);
				if(page) {
					this.micrio.state.popover.set({contentPage: page}); // Open page in popover
					return; // Stop further processing if page found
				}
			}

			// Find tour based on slug (marker tour if 'marker' segment exists, otherwise video tour)
			const tour = !markerOrTourOrPage ? undefined
				: marker ? d2.map(d => d?.markerTours?.find(t => slugify(t.i18n?.[lang]?.slug) == markerOrTourOrPage))[0] // Find marker tour by slug
					: d2.map(d => d?.tours?.find(t => slugify(t.i18n?.[lang]?.slug) == markerOrTourOrPage))[0]; // Find video tour by slug

			// Determine marker slug (either the last segment, or the 4th if no tour found)
			const markerSlug = marker || (!tour && markerOrTourOrPage);

			// Find marker based on slug (check title or slug property)
			const m = markerSlug ? (d2[1]??d2[0]).markers?.find(m => // Use new image data if available, else current
				(m.i18n?.[lang]?.slug ?? slugify((<unknown>m as Models.ImageData.MarkerCultureData).title)) == markerSlug // Check slug first, then title slug
				// Special check for finding marker within a tour's steps (if marker slug matches a step marker slug)
				|| (tour && ('steps' in tour) && tour.stepInfo?.map(m => m.marker).find(m => m.i18n?.[lang]?.slug == markerSlug))
			) : undefined;

			// Handle tour/marker state updates
			if(m && tour && 'steps' in tour) {
				// If both marker and marker tour found, set initial step for the tour
				tour.initialStep = tour.steps.findIndex(s => s.startsWith(m.id));
			} else {
				// If no marker found via slug, close any open popups
				if(!m) this.micrio.state.popup.set(undefined);
				// Set the found marker (or undefined) on the relevant image instance
				(curr??main).state.marker.set(m);
			}

			// Set the global tour state
			this.micrio.state.tour.set(tour);

			// Update document title if enabled
			if(this.writeTitle) this.setTitle();

			this.inited = true; // Mark router as initialized
		});
	}

	/**
	 * Updates the document title based on the current image, tour, and marker.
	 * @internal
	*/
	private setTitle() {
		const lang = get(this.micrio._lang);
		const img = this.micrio.$current;
		if(!img) return;
		// Construct title parts (image, tour, marker)
		const title = [
			img.$data?.i18n?.[lang]?.title ?? img?.$info?.title, // Image title
			this.micrio.state.$tour?.i18n?.[lang]?.title, // Tour title
			this.micrio.state.$marker?.i18n?.[lang]?.title // Marker title
		].filter(p => !!p).reverse(); // Filter empty parts and reverse order
		// Set document title
		document.title = title.join(' - ') + ' | Micrio';
	}

	/**
	 * Event listener callback that triggers a debounced URL write operation.
	 * @internal
	 * @param e The triggering event.
	*/
	private write(e:Event) : void {
		// Ignore if not loaded/initialized or currently switching images
		if(!this.micrio.$current || !this.loaded || !this.inited) return;

		// Special handling for marker-open: if marker links to another image,
		// wait for the 'load' event of the new image instead of writing URL now.
		switch(e.type) {
			case 'marker-open':
				const m = this.micrio.state.$marker;
				if(m && m.data && m.data.micrioLink) return; // Marker links elsewhere
			break;
		}

		// Debounce the actual write operation
		clearTimeout(this._to);
		this._to = <any>setTimeout(() => this.writeDeferred(e.type == 'load'), 50) as number;
	}

	/**
	 * Performs the actual URL update after debouncing.
	 * Constructs the new route string based on current state and updates the browser history/hash.
	 * @internal
	 * @param replaceState If true, uses `history.replaceState` instead of `pushState`.
	*/
	private writeDeferred(replaceState:boolean) : void {
		const tour = this.micrio.state.$tour;
		let curr = this.micrio.$current;
		let marker = curr?.state.$marker;
		const lang = this.micrio.lang;

		// Force replaceState if language changed
		if(lang != this.prevLang) {
			replaceState = true;
			this.prevLang = lang;
		}

		// Get titles/slugs for constructing the path
		const title = curr?.$data?.i18n?.[lang]?.title ?? curr?.$info?.title ?? '';
		const noMarkerTour = curr?.$settings.routerMarkerTours === false; // Check setting
		const markerContent = marker && (typeof marker != 'string') ? marker.i18n?.[lang] ?? (<unknown>marker  as Models.ImageData.MarkerCultureData) : undefined;
		const page = get(this.micrio.state.popover)?.contentPage;
		const pCData = !page ? undefined : page.i18n?.[lang] ?? (<unknown>page as Models.ImageData.MenuCultureData);

		let id = curr?.id; // Start with current image ID

		// Adjust ID and potentially marker if in a multi-image tour
		if(tour && 'steps' in tour && tour.steps.length && tour.stepInfo) {
			// Find the step belonging to the *original* image of the tour
			const ownImageStep = tour.stepInfo.find(s => s.markerId == tour.steps.find(s => !s.includes(',')));
			if(ownImageStep) {
				id = ownImageStep.micrioId; // Use the original image ID for the route
				curr = this.micrio.wasm.images.find(i => i.id == id) as MicrioImage; // Get original image instance
				// If no marker is explicitly open, use the marker of the initial tour step for the URL
				if(!marker && tour.initialStep !== undefined && tour.initialStep >= 0)
					marker = tour.stepInfo[tour.initialStep].marker;
			}
		}

		// Construct the path segments
		const path = [
			id, // Image ID
			lang, // Language
			slugify(title)??'', // Image title slug
			// Add tour/marker/page slug based on current state
			...(noMarkerTour ? [] : pCData ? [slugify(pCData.title)] : [ // Use page slug if popover open
				tour?.i18n?.[lang]?.slug ?? null, // Tour slug
				markerContent?.slug ?? slugify(markerContent?.title) ?? null // Marker slug (prefer slug, fallback to title)
			])
		].filter(p => !!p).join('/'); // Filter empty parts and join with '/'

		if(path == this.route) return; // Don't update if route hasn't changed

		this.setting = true; // Prevent reading the URL we are about to write
		// Update browser URL
		if(this.isStatic) { // Use History API
			if(replaceState) history.replaceState(null, '', '/' + path + location.search);
			else history.pushState(null, '', '/' + path + location.search);
		}
		else { // Use hash fragment
			location.hash = path;
		}
		this.route = path; // Store the new route
		if(this.writeTitle) this.setTitle(); // Update document title if enabled
		// Reset setting flag after a short delay
		setTimeout(() => this.setting = false, 250);
	}
}
