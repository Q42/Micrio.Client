import { MicrioElement } from '$ts/component';
import type { HTMLMicrioElement } from '$ts/element';
import type { Models } from '$types/models';
import type { MicrioImage } from '$ts/image';
import { get } from '$ts/store';
import { once } from '$ts/utils/store';
import { i18n } from '$ts/i18n/strings';
import './micrio-menu';
import './micrio-button';

export class MicrioToolbar extends MicrioElement {
	static tag = 'micrio-toolbar';
	static styles = `micrio-toolbar{display:contents}
micrio-toolbar menu.micrio-toolbar{position:absolute;top:calc(var(--micrio-border-margin) - (var(--micrio-button-size) / 2 - 27px));left:var(--micrio-border-margin);margin:0;padding:0;color:#fff;text-shadow:1px 1px 2px #000;transition:transform .25s ease;z-index:1}
@media(max-width:500px){micrio-toolbar .micrio-button.toggle{position:absolute;top:var(--micrio-border-margin);left:0;height:34px;width:34px;box-shadow:none;z-index:2}
micrio-toolbar .micrio-button.toggle.indent{left:35px}
micrio-toolbar menu.micrio-toolbar{transform:translate3d(0,0,0);width:100%;height:100%;background:rgba(0,0,0,0.75);top:0;left:0;padding:32px 0;overflow-y:auto;overflow-x:hidden;box-sizing:border-box;backdrop-filter:var(--micrio-background-filter);z-index:1}
micrio-toolbar menu.micrio-toolbar:not(.shown){transform:translate3d(calc(-100% - var(--micrio-border-margin) * 2),0,0)}
}
@media(min-width:501px){micrio-toolbar menu.indent{margin-left:calc(var(--micrio-border-margin) * 2 + 25px)}
micrio-toolbar menu>.micrio-menu:not(:hover)>button.micrio-menu{margin-bottom:-15px}
}`;

	#unsubs: (() => void)[] = [];
	#data: Models.ImageData.ImageData | undefined;
	#shown = false;
	#indented = false;
	#isMobile = false;

	onMount() {
		const micrio = this.inject<HTMLMicrioElement>('micrio');
		if (!micrio) return;

		const { _lang } = micrio;

		this.#isMobile = window.innerWidth <= 500;
		const resize = () => { this.#isMobile = window.innerWidth <= 500; this.#render(); };

		this.#unsubs.push(micrio.current.subscribe(c => {
			if (!c) return;
			once(c.info).then(() => { this.#indented = !c.$settings.noLogo; this.#render(); });
			this.#unsubs.push(c.data.subscribe(d => { this.#data = d; this.#render(); }));
		}));

		this.#unsubs.push(micrio.state.tour.subscribe(() => this.#render()));
		this.#unsubs.push(micrio.state.marker.subscribe(() => this.#render()));
		this.#unsubs.push(micrio.state.popover.subscribe(() => this.#render()));
		this.#unsubs.push(_lang.subscribe(() => this.#render()));

		window.addEventListener('resize', resize);
		this.#unsubs.push(() => window.removeEventListener('resize', resize));

		(this as any).__toggle = () => this.#shown = !this.#shown;

		this.#render();
	}

	#render() {
		const micrio = this.inject<HTMLMicrioElement>('micrio');
		if (!micrio) return;
		const { _lang, spaceData, state: micrioState } = micrio;
		const $_lang = get(_lang);
		const $tour = get(micrioState.tour);
		const $marker = get(micrioState.marker);
		const $popover = get(micrioState.popover);
		const $i18n = get(i18n);
		const originalId = (micrio.$current as MicrioImage)?.id;

		const hasTourLang = (t: any): boolean => !!t.i18n?.[$_lang];
		const hasPageLang = (p: Models.ImageData.Menu): boolean => !!(p as any).i18n?.[$_lang];
		const hidden = !!$tour || !!$marker || !!$popover;

		const markerTours = ((this.#data?.markerTours ?? []).concat((spaceData as any)?.markerTours ?? [])).filter(hasTourLang);
		const hasMarkerTours = markerTours.length > 0;
		const videoTours = (this.#data?.tours?.filter(hasTourLang) ?? []) as any[];
		const hasVideoTours = videoTours.length > 0;
		const hasBothTourTypes = hasMarkerTours && hasVideoTours;
		const mainPages = this.#data?.pages
			? (this.#data.pages.filter(p => !p.id?.startsWith('_') && hasPageLang(p)) as any[])
				.concat(this.#data.pages.filter(p => p.id?.startsWith('_')))
			: undefined;
		const empty = !(mainPages?.length || hasMarkerTours || hasVideoTours);

		if (empty || hidden) { this.innerHTML = ''; return; }

		this.replaceChildren();

		const menu = document.createElement('menu');
		menu.className = 'micrio-toolbar';
		menu.classList.toggle('shown', !hidden && this.#shown);
		menu.classList.toggle('indent', this.#indented);

		if (mainPages) {
			for (const page of mainPages) {
				const child = document.createElement('micrio-menu') as any;
				child.setProps({ menu: page, originalId, onclose: () => { if (this.#isMobile) this.#shown = false; } });
				menu.appendChild(child);
			}
		}

		if (hasMarkerTours) {
			const child = document.createElement('micrio-menu') as any;
			child.setProps({
				onclose: () => { if (this.#isMobile) this.#shown = false; },
				menu: {
					id: crypto.randomUUID(),
					i18n: { [$_lang]: { title: hasBothTourTypes ? $i18n.markerTours : $i18n.tours } },
					children: markerTours.map((t: any) => ({
						id: crypto.randomUUID(),
						i18n: { [$_lang]: { title: t.i18n?.[$_lang]?.title ?? '(Untitled)' } },
						action: () => { t.initialStep = 0; micrioState.tour.set(t); }
					}))
				}
			});
			menu.appendChild(child);
		}

		if (hasVideoTours) {
			const child = document.createElement('micrio-menu') as any;
			child.setProps({
				onclose: () => { if (this.#isMobile) this.#shown = false; },
				menu: {
					id: crypto.randomUUID(),
					i18n: { [$_lang]: { title: hasBothTourTypes ? $i18n.videoTours : $i18n.tours } },
					children: videoTours.map((t: any) => ({
						id: crypto.randomUUID(),
						i18n: { [$_lang]: { title: t.i18n?.[$_lang]?.title ?? '(Untitled)' } },
						action: () => {
							if (micrio.$current && micrio.$current.id != originalId) micrio.open(originalId);
							micrioState.tour.set(t);
						}
					}))
				}
			});
			menu.appendChild(child);
		}

		this.appendChild(menu);

		if (this.#isMobile) {
			const btn = document.createElement('micrio-button') as any;
			btn.setProps({
				title: $i18n.menuToggle,
				type: this.#shown ? 'close' : 'ellipsis-vertical',
				className: 'toggle transparent' + (this.#indented ? ' indent' : ''),
				onclick: (this as any).__toggle
			});
			this.appendChild(btn);
		}
	}

	onDestroy() {
		for (const fn of this.#unsubs) fn();
		this.#unsubs = [];
	}
}

customElements.define(MicrioToolbar.tag, MicrioToolbar);
