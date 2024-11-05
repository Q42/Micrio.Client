import type { HTMLMicrioElement } from './element';
import type { Models } from '../types/models';
import type { MicrioImage } from './image';

import { get } from 'svelte/store';

import { slugify, once } from './utils';

/** The image router
 * @internal
*/
export class Router {
	/** @internal */
	private static events:string[] = [
		'load',
		'tour-start',
		'tour-stop',
		'marker-open',
		'marker-closed',
		'page-open',
		'page-closed',
		'lang-switch'
	];

	/** @internal */
	private isStatic:boolean = false;

	/** @internal */
	private route:string|undefined;

	/** @internal */
	private loaded:boolean = false;

	/** @internal */
	private inited:boolean = false;

	/** @internal */
	private setting:boolean = false;

	/** @internal */
	private _to:number|undefined;

	/** @internal */
	private prevLang:string|undefined;

	public writeTitle:boolean = false;

	/** Create the WebAssembly instance
	 * @param micrio The main <micr-io> instance
	*/
	constructor(private micrio:HTMLMicrioElement) { }

	/** Hook the router
	 * @internal
	*/
	hook() : void {
		this.isStatic = this.micrio.getAttribute('data-router') == 'static';

		this.read = this.read.bind(this);
		this.write = this.write.bind(this);
		this.writeDeferred = this.writeDeferred.bind(this);

		once(this.micrio.current).then(() => { this.loaded = true; this.read() })
		Router.events.forEach(e => this.micrio.addEventListener(e, this.write));

		if(location.hostname == 'i.micr.io') this.writeTitle = true;

		window.addEventListener(this.isStatic ? 'popstate': 'hashchange', this.read);
	}

	/** Unhook the router
	 * @internal
	*/
	unhook() : void {
		Router.events.forEach(e => this.micrio.removeEventListener(e, this.write));
		window.removeEventListener(this.isStatic ? 'popstate': 'hashchange', this.read);
	}

	/** Recursive page finder for deeplinked menu page
	 * @internal
	*/
	private findPage(slug: string, pages: Models.ImageData.Menu[]|undefined, lang:string) : Models.ImageData.Menu|undefined {
		if(pages) for(let i=0;i<pages.length;i++) {
			const cData = pages[i]?.i18n?.[lang] ?? (<unknown>pages[i] as Models.ImageData.MenuCultureData);
			let m = slugify(cData.title) == slug ? pages[i]
				: this.findPage(slug, pages[i].children, lang);
			if(m) return m;
		}
	}

	/** Read the hash or pathname and set state
	 * @internal
	*/
	private read() : void {
		if(!this.loaded || this.setting) return;
		this.route = (this.isStatic ? location.pathname : location.hash).slice(1);
		const [id, lang, slug, markerOrTourOrPage, marker] = this.route.split('/');

		const main = this.micrio.$current;
		const curr = id && main?.id != id ? this.micrio.open(id) : undefined;

		if(main) Promise.all([
				once(main.data, {allowUndefined: true}),
				curr ? once(curr.data, {allowUndefined: true}) : undefined
			]).then((d2:[Models.ImageData.ImageData|undefined, Models.ImageData.ImageData|undefined]) => {
			if(!d2[0]) return this.inited = true;
			if(this.prevLang === undefined) this.prevLang = this.micrio.lang;

			if(curr?.$settings.routerMarkerTours === false) return;

			// Can deeplink to menu pages
			if(d2[0].pages?.length && markerOrTourOrPage) {
				const page = this.findPage(markerOrTourOrPage.toLowerCase(), d2[0].pages, lang);
				if(page) return this.micrio.state.popover.set({contentPage: page});
			}

			const tour = !markerOrTourOrPage ? undefined
				: marker ? d2.map(d => d?.markerTours?.find(t => slugify(t.i18n?.[lang]?.slug) == markerOrTourOrPage))[0]
					: d2.map(d => d?.tours?.find(t => slugify(t.i18n?.[lang]?.slug) == markerOrTourOrPage))[0];
			const markerSlug = marker || !tour && markerOrTourOrPage;

			const m = markerSlug ? (d2[1]??d2[0]).markers?.find(m =>
				(m.i18n?.[lang]?.slug ??(<unknown>m as Models.ImageData.MarkerCultureData).title) == markerSlug
				|| (tour && ('steps' in tour) && tour.stepInfo?.map(m => m.marker).find(m => m.i18n?.[lang]?.slug == markerSlug))
			) : undefined;

			// Close any opened popups if no marker
			if(m && tour && 'steps' in tour)
				tour.initialStep = tour.steps.findIndex(s => s.startsWith(m.id));
			else {
				if(!m) this.micrio.state.popup.set(undefined);
				(curr??main).state.marker.set(m);
			}

			this.micrio.state.tour.set(tour);

			if(this.writeTitle) this.setTitle();

			this.inited = true;
		});
	}

	/** Update the document title
	 * @internal
	*/
	private setTitle() {
		const lang = get(this.micrio._lang);
		const img = this.micrio.$current;
		if(!img) return;
		const title = [
			img.$data?.i18n?.[lang]?.title ?? img?.$info?.title,
			this.micrio.state.$tour?.i18n?.[lang]?.title,
			this.micrio.state.$marker?.i18n?.[lang]?.title
		].filter(p => !!p).reverse();
		document.title = title.join(' - ') + ' | Micrio';
	}

	/** Write the path to url
	 * @internal
	*/
	private write(e:Event) : void {
		if(!this.micrio.$current || !this.loaded || !this.inited) return;

		switch(e.type) {
			// If it's a marker being opened and linking to another image,
			// Do nothing and just wait for the next image to open
			case 'marker-open':
				const m = this.micrio.state.$marker;
				if(m && m.data && m.data.micrioLink) return;
			break;
		}

		clearTimeout(this._to);
		this._to = <any>setTimeout(() => this.writeDeferred(e.type == 'load'), 50) as number;
	}

	/** Deferred path writing
	 * @internal
	*/
	private writeDeferred(replaceState:boolean) : void {
		const tour = this.micrio.state.$tour;
		let curr = this.micrio.$current;
		let marker = curr?.state.$marker;
		const lang = this.micrio.lang;
		if(lang != this.prevLang) {
			replaceState = true;
			this.prevLang = lang;
		}
		const title = curr?.$data?.i18n?.[lang]?.title ?? curr?.$info?.title ?? '';
		const noMarkerTour = curr?.$settings.routerMarkerTours === false;
		const markerContent = marker && (typeof marker != 'string') ? marker.i18n?.[lang] ?? (<unknown>marker  as Models.ImageData.MarkerCultureData) : undefined;
		const page = get(this.micrio.state.popover)?.contentPage;
		const pCData = !page ? undefined : page.i18n?.[lang] ?? (<unknown>page as Models.ImageData.MenuCultureData);

		let id = curr?.id;

		// If multi-image tour, keep ID of main image
		if(tour && 'steps' in tour && tour.steps.length && tour.stepInfo) {
			const ownImageStep = tour.stepInfo.find(s => s.markerId == tour.steps.find(s => !s.includes(',')));
			if(ownImageStep) {
				id = ownImageStep.micrioId;
				curr = this.micrio.wasm.images.find(i => i.id == id) as MicrioImage;
				if(!marker && tour.initialStep) marker = tour.stepInfo[tour.initialStep].marker;
			}
		}

		
		const path = [
			id,
			lang,
			slugify(title)??'',
			...(noMarkerTour ? [] : pCData ? [slugify(pCData.title)] : [
				tour?.i18n?.[lang]?.slug ?? null,
				markerContent?.slug ?? null
			])
		].filter(p => !!p).join('/');
		if(path == this.route) return;
		this.setting = true;
		if(this.isStatic) {
			if(replaceState) history.replaceState(null, '', '/' + path + location.search);
			else history.pushState(null, '', '/' + path + location.search);
		}
		else location.hash = path;
		this.route = path;
		if(this.writeTitle) this.setTitle();
		setTimeout(() => this.setting = false, 250);
	}
}
