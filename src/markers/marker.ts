import { MicrioElement } from '$core/component';
import type { Models } from '$types/models';
import type { MicrioImage } from '$core/image';
import { get, tick } from '$core/store';
import { getSpaceVector } from '$utils/space';
import { createElement } from '$utils/dom';

export interface MarkerProps {
	marker: Models.ImageData.Marker;
	image?: MicrioImage;
	forceHidden?: boolean;
	coords?: Map<string, [number, number, number?, number?]>;
	overlapped?: boolean;
}
import './marker.css';

class MicrioMarker extends MicrioElement<MarkerProps> {
	static tag = 'micrio-marker';

	#props: MarkerProps = { marker: null! };
	#opened = false;
	#behindCam = false;
	#x = 0;
	#y = 0;
	#scaleVal = 1;
	#w = 0;
	#matrix = '';
	#fto: any;
	// Omni arc visibility: target frame index and [start, end] frame range
	#omniIndex = 0;
	#omniArc: [number, number] | undefined;

	_onMount() {
		const { marker, image, forceHidden = false } = this.#props;
		const micrio = this._getMicrio();
		if (!micrio || !image || !marker) return;

		const markerImages = MicrioElement._markerImages;
		if (!markerImages.has(marker.id) && image) markerImages.set(marker.id, image);

		const events = micrio.events;
		const $_lang = get(micrio._lang);
		const markerSettings = image.$settings._markers ?? {};
		const content = marker.i18n?.[$_lang];
		const data = marker.data ?? {};
		const noTitles = marker.data?.showTitle === false || !!markerSettings.noTitles || !!image.$settings.omni?.sideLabels;
		const noToolTips = /[?&]micrioNoTooltips/.test(location.search) || !!image.$settings.omni?.sideLabels;

		// Derive marker view from video tour
		if (marker.videoTour) {
			const vt = marker.videoTour;
			const timeline = vt.i18n?.[$_lang]?.timeline;
			if (timeline?.length) marker.view = timeline[0].rect;
		}

		const showLabel = content && (!noTitles) && (content.label || content.title);
		const cluster = marker.type == 'cluster';
		const icon = !cluster && marker.type == 'link' ? 'link' : marker.type == 'media' ? 'play' : undefined;
		const customIcon = marker.data?.customIconIdx != undefined
			? image.$settings._markers?.customIcons?.[marker.data.customIconIdx]
			: marker.data?.icon || markerSettings.markerIcon;
		const hasIcon = !!icon || !!customIcon;
		const defaultClass = hasIcon || marker.type == 'default';

		// Omni arc: precompute target frame and visible range from marker rotation/visibleArc
		const omni = image.$settings.omni;
		if (image._isOmni && omni) {
			const rot = (marker.rotation ?? 0) + (marker.backside ? Math.PI : 0);
			this.#omniIndex = image.camera._getOmniFrame(rot) ?? 0;
			if (marker.visibleArc) {
				const a0 = image.camera._getOmniFrame(marker.visibleArc[0]);
				const a1 = image.camera._getOmniFrame(marker.visibleArc[1]);
				if (a0 != null && a1 != null) this.#omniArc = [a0, a1];
			}
		}

		const scales = !!marker.data?.scales || !!image.$settings.markersScale;
		const moved = () => {
			if (image._is360 && scales) {
				this.#matrix = image.camera.getMatrix(marker.x, marker.y, 1, 1, 0, 0, 0).join(',');
				this.style.setProperty('--mat', `matrix3d(${this.#matrix})`);
				this.classList.add('mat3d');
			} else {
				const xy = image.camera._getXYDirect(marker.x, marker.y, {
					radius: marker.radius, rotation: marker.rotation
				});
				[this.#x, this.#y, this.#scaleVal, this.#w] = xy;
				if (image._is360) this.#behindCam = this.#w > 0;
				else if (image._isOmni && omni) {
					if (this.#omniArc && marker.rotation != null) {
						const numFrames = omni.frames / (omni.layers?.length ?? 1);
						let delta = (image.omni?.currentIndex ?? 0) - this.#omniIndex;
						if (delta > numFrames / 2) delta -= numFrames;
						if (delta < -numFrames / 2) delta += numFrames;
						this.#behindCam = delta <= this.#omniArc[0] || delta >= this.#omniArc[1];
					} else if (omni.distance) {
						this.#behindCam = this.#w < 0;
					}
				}
				this.style.setProperty('--x', `${this.#x}px`);
				this.style.setProperty('--y', `${this.#y}px`);
				if (scales) {
					this.style.setProperty('--scale', `${this.#scaleVal}`);
				}
				this.classList.remove('mat3d');
				this.classList.toggle('behind', this.#behindCam);
			}
		};

		const click = () => {
			if (marker.onclick) return marker.onclick(marker);
			if (markerSettings.noMarkerActions) return;
			if (marker.type == 'cluster') {
				if (marker.view && micrio.$current?.$info) {
					image.camera.flyToView(marker.view, { area: image.opts?.area, limitZoom: true });
				}
			} else {
				image.state.marker.set(marker);
			}
		};

		const focus = () => {
			if (markerSettings.noMarkerActions) return;
			(this.parentNode as HTMLElement)?.scrollTo(0, 0);
			clearTimeout(this.#fto);
			this.#fto = setTimeout(() => {
				const px = image.camera.getXY(marker.x, marker.y);
				if (!this.#opened && (px[0] < 0 || px[0] >= micrio.offsetWidth || px[1] < 0 || px[1] >= micrio.offsetHeight || (image._is360 ? px[3] > 4 : false)))
					image.camera.flyToCoo([marker.x, marker.y], { speed: 2, limit: true }).catch(() => { });
			}, 150);
		};

		const activated = async () => {
			if (this.#opened) return;
			this.#opened = true;
			this.classList.add('opened');
			clearTimeout(this.#fto);
			if (markerSettings.noMarkerActions) return;
			events._dispatch('marker-open', marker);
			const $tour = get(micrio.state.tour);
			if ($tour && (!('steps' in $tour) || !$tour.steps?.some((s: string) => s.startsWith(marker.id)))) micrio.state.tour.set(undefined);
			await tick();
			if (marker.view && !data.noAnimate && !marker.videoTour) {
				image.camera.flyToView(marker.view, {
					area: image.opts?.area,
					omniIndex: image._isOmni ? this.#omniIndex : undefined,
					isJump: true
				}).then(openContent).catch(() => {
					if (image.state.$marker === marker) {
						image._openedView = undefined;
						image.state.marker.set(undefined);
					}
				});
			} else {
				openContent();
			}
		};

		const openContent = async () => {
			if (cluster) return;
			if (image.state.$marker != marker) {
				if (!image.state.$marker) return;
				return image.state.marker.set(marker);
			}
			if (markerSettings.noMarkerActions) return;

			const $tour = get(micrio.state.tour);
			events._dispatch('marker-opened', marker);
			if (marker.popupType != 'popup' || (!content?.title && !content?.body && !content?.bodySecondary && !content?.embedUrl && !marker.images?.length && !marker.videoTour)) {
				// no popup - handle popover or video tour
				if (marker.popupType == 'popover') {
					micrio.state.popover.set({ marker, image, markerTour: $tour && 'steps' in $tour ? $tour : undefined });
				} else if (marker.videoTour && !$tour) {
					micrio.state.tour.set(marker.videoTour);
					const unsub = micrio.state.tour.subscribe(t => {
						if (!t) { unsub(); image.state.marker.set(undefined); }
					});
				}
			} else {
				tick().then(() => micrio.state.popup.set(marker));
			}

			const linkId = data.micrioLink?.id;
			if (linkId) {
				tick().then(() => {
					image.camera.stop();
					micrio.open(linkId, { vector: getSpaceVector(micrio, linkId)?.vector });
				});
			}
		};

		const close = () => {
			this.classList.remove('opened');
			events._dispatch('marker-closed', marker);
			micrio.state.popover.set(undefined);
			micrio.state.popup.set(undefined);
		};

		this._addCleanup(image.state.marker.subscribe(m => {
			if (typeof m == 'string' && m == marker.id) image.state.marker.set(marker);
			else if (m == marker) activated();
			else if (m && m != marker) {
				if (this.#opened) close();
				this.#opened = false;
				image.camera.stop();
			}
			else if (!m && !data.alwaysOpen) {
				if (this.#opened) close();
				else this.classList.remove('opened');
				this.#opened = false;
				image.camera.stop();
			}
		}));

		if (!marker.noMarker) {
			this._addCleanup(image.state.view.subscribe(() => {
				moved();
			}));
		}

		if (!forceHidden) {
			tick().then(() => {
				const $popup = get(micrio.state.popup);
				const $tour = get(micrio.state.tour);
				if (this.#opened && !marker.noMarker && $popup && $popup != marker && !$tour) {
					image.state.marker.set(undefined);
				} else if (data.alwaysOpen) {
					openContent();
				}
			});
		}

		// Build DOM
		this.classList.toggle('cluster', cluster);
		this.classList.toggle('default', !!defaultClass);
		this.classList.toggle('has-icon', hasIcon);
		this.classList.toggle('has-custom-icon', !!customIcon);

		if (!marker.htmlElement && !marker.noMarker) {
			const btn = createElement('button', {
				props: {
					...(noToolTips || cluster ? {} : { title: content?.label || content?.title || '' }),
					id: marker.id
				},
				attrs: { 'data-scroll-through': '' },
				events: {
					click,
					focus,
					blur: () => clearTimeout(this.#fto),
					mouseenter: () => micrio.state.markerHoverId.set(marker.id),
					mouseleave: () => micrio.state.markerHoverId.set(undefined)
				},
				parent: this
			});

			if (customIcon) {
				createElement('img', {
					props: {
						src: typeof customIcon == 'string' ? customIcon : customIcon.src,
						alt: ''
					},
					parent: btn
				});
			} else if (icon) {
				createElement('micrio-icon', {
					setProps: { name: icon },
					parent: btn
				});
			}

			if (showLabel) {
				createElement('label', {
					textContent: content?.label || content?.title || '',
					attrs: {
						for: marker.id,
						'data-scroll-through': ''
					},
					parent: btn
				});
			}
		}

		// Initial position
		if (!marker.noMarker) moved();

		// Marker tags as classes
		if (marker.tags) marker.tags.forEach(c => this.classList.add(c));
	}

	_setProps(props: Partial<MarkerProps>) {
		Object.assign(this.#props, props);
	}

	_onDestroy() {
		clearTimeout(this.#fto);
	}
}

customElements.define(MicrioMarker.tag, MicrioMarker);
