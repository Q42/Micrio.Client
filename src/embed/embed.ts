import { createElement } from '$utils/dom';
import { MicrioElement } from '$core/component';
import type { HTMLMicrioElement } from '$core/element';
import type { Models } from '$types/models';
import type { MicrioImage } from '$core/image';
import { get } from '$core/store';
import { Browser } from '$utils/browser';
import { GLEmbedVideo } from '$media/embedvideo';

/** Properties for configuring an embed element (image, video, iframe, or GL content). @internal */
export interface EmbedProps {
	/** The embed data from the image manifest. */
	embed: Models.ImageData.Embed;
	/** The parent MicrioImage instance. */
	image: MicrioImage;
	/** Optional associated marker used for click actions. */
	marker?: Models.ImageData.Marker;
}
import './embed.css';
import { randomUUID } from '$utils/id';

/** Custom element that renders an embed (image, video, iframe, or GL-embedded Micrio image) positioned within a Micrio scene. */
class MicrioEmbed extends MicrioElement<EmbedProps> {
	/** HTML tag name for this custom element. @internal */
	static tag = 'micrio-embed';

	#props: EmbedProps = { embed: null!, image: null! };

	#micrio!: HTMLMicrioElement;
	#info!: Models.ImageInfo.ImageInfo;
	#glImage?: MicrioImage;
	#glVideo?: GLEmbedVideo;
	#container?: HTMLElement;
	#videoEl?: HTMLVideoElement;
	#figureEl?: HTMLElement;
	#moveRaf: number | undefined;
	#loopDelayTo: any;
	/** Pending debounce for printing a book3d embed (waits for the view to settle). */
	#book3dPrintTo: number | undefined;
	/** True until the one-time book3d print delay after the embed is placed in the DOM has elapsed. */
	#book3dPendingPrint = false;

	#is360 = false;
	#autoplay = true;
	#isSVG = false;
	#isSmall = false;
	#screenIsHDR = false;
	#isBook3d = false;
	#embedImageAsHtml = false;
	#printGL = false;
	#noEvents = false;
	#href: string | undefined;
	#hrefBlankTarget = false;
	#isRawVideo = false;
	#hasHtml = false;
	#paused = false;
	#widthCapped = 0;
	#hideWhenPaused = false;

	#w = 0;
	#h = 0;
	#cX = 0;
	#cY = 0;
	#s = 1;
	#rotX = 0;
	#rotY = 0;
	#rotZ = 0;
	#scaleX = 1;
	#scaleY = 1;
	#x = 0;
	#y = 0;
	#scaleVal = 0;
	#matrix = '';
	#buttonStyle = '';

	/** @internal */
	_onMount() {
		const { embed, image, marker } = this.#props;
		this.#micrio = this._getMicrio()!;
		if (!this.#micrio || !embed || !image) return;

		this.#info = image.$info!;
		if (!this.#info) return;

		if (!embed.uuid) embed.uuid = randomUUID();

		this.#is360 = image._is360;
		this.#autoplay = embed.video?.autoplay ?? true;

		const grid = image.grid;
		if (grid) {
			const focused = grid._focussed;
			const markersShown = grid._markersShown;
			const updateInactive = () => {
				const f = get(focused);
				const ms = markersShown ? get(markersShown) : undefined;
				const inactive = !!(grid && f && f != image && ms && ms.indexOf(image) < 0);
				this.#container?.classList.toggle('inactive', inactive);
			};
			this._watch(focused, updateInactive);
			if (markersShown) this._watch(markersShown, updateInactive);
		}

		this.#glImage = image._embeds.find(i => i.uuid == embed.uuid || i.$info?.title == embed.uuid) as MicrioImage | undefined;

		this.#screenIsHDR = matchMedia('(dynamic-range: high)').matches || Browser.OSX;

		this.#isSVG = embed.src?.toLowerCase().endsWith('.svg') ?? false;
		this.#isSmall = embed.width && embed.height ? embed.width * embed.height < 1048576 : false;

		const isIOS14 = /iPhone OS 14_/i.test(navigator.userAgent);
		const glAttrValue = this.#micrio.getAttribute('data-embeds-inside-gl');
		this.#embedImageAsHtml = this.#isSVG || isIOS14 || (!this.#screenIsHDR && !this.#micrio.hasAttribute('data-embeds-inside-gl') && !!embed.video) || glAttrValue == 'false';

		// 3d books have their own WebGL renderer
		this.#isBook3d = this.#micrio.$current?.album?.info?.type == 'book3d';

		this.#printGL = !this.#isBook3d && !this.#embedImageAsHtml && !!(
			(embed.micrioId && (!this.#isSmall || !embed.src))
			|| (embed.video && !embed.video.controls && !embed.video.transparent)
		);

		this.#noEvents = !embed.clickAction && !embed.frameSrc && !marker;
		this.#href = embed.clickAction == 'href' ? embed.clickTarget : undefined;
		this.#hrefBlankTarget = !!(this.#href && embed.clickTargetBlank);

		this.#isRawVideo = this.#printGL && !!embed.video;
		this.#hasHtml = !this.#printGL || !!embed.clickAction;
		this.#hideWhenPaused = !!embed.hideWhenPaused;

		if (embed.video && !embed.video.controls) {
			embed.video.muted = true;
		}

		this.#readPlacement();

		if (this.#hasHtml) this.#buildDOM(embed, marker);

		if (this.#isBook3d && this.#hasHtml) {
			// Set the print delay once, at placement time: keep the embed hidden
			// for 500ms so it doesn't paint through pages being swiped past.
			this.#book3dPendingPrint = true;
			this.#book3dPrintTo = setTimeout(() => {
				this.#book3dPrintTo = undefined;
				this.#book3dPendingPrint = false;
				this.#applyPosition();
			}, 500);
		}

		if (this.#printGL) this.#printInsideGL();

		const camOwner = image.camera?.image;
		const moveSrc = camOwner && camOwner !== image ? camOwner : image;

		if (this.#hasHtml || !!embed.video?.pauseWhenSmallerThan || !!embed.video?.pauseWhenLargerThan) {
			this._watch(moveSrc.state.view, () => this.#moved());
			this._watch(moveSrc._viewport, () => this.#moved());
		}

		this.#applyPosition();
		this.addEventListener('change', this.#onChange);
	}

	#readPlacement() {
		const { embed } = this.#props;
		const a = embed.area;
		this.#w = a[2];
		this.#h = a[3];
		this.#cX = a[0] + this.#w / 2;
		this.#cY = a[1] + this.#h / 2;
		this.#s = embed.scale || 1;
		this.#rotX = embed.rotX ?? 0;
		this.#rotY = embed.rotY ?? 0;
		this.#rotZ = embed.rotZ ?? 0;
		this.#scaleX = embed.scaleX ?? 1;
		this.#scaleY = embed.scaleY ?? 1;

		const isGLEmbeddedMicrio = this.#printGL && embed.micrioId && embed.width;
		const htmlButtonEmbedScale = isGLEmbeddedMicrio ? 10 : 1;

		if(this.#isBook3d) return;

		let scale = this.#w * (this.#info.width / (embed.width ?? 100) / (!this.#printGL ? this.#s : embed.width ? this.#w : 1) * (this.#is360 ? Math.PI / 2 : 1));

		const styles: string[] = [];

		if (isGLEmbeddedMicrio && embed.width) {
			scale = this.#w / (embed.width / this.#info.width) * htmlButtonEmbedScale * (this.#is360 ? Math.PI / 2 : 1);
			styles.push(`width:${embed.width / htmlButtonEmbedScale}px`);
		}

		styles.push(`--ratio:${this.#w / this.#h * this.#info.width / this.#info.height};--scale:${scale}`);

		if (this.#isSVG && embed.height) {
			styles.push(`height:${embed.height}px`);
		}

		this.#buttonStyle = styles.join(';');

		if (embed.video) {
			if (embed.video.width > embed.video.height)
				this.#widthCapped = Math.min(embed.video.width, this.#w * this.#info.width, 2048);
			else
				this.#widthCapped = Math.min(embed.video.height, this.#h * this.#info.height, 2048) / (embed.video.height / embed.video.width);
		}
	}

	#buildDOM(embed: Models.ImageData.Embed, marker?: Models.ImageData.Marker) {
		this.#container = createElement(this.#href ? 'a' : 'div', {
			className: (this.#noEvents ? 'no-events' : '')
				+ (this.#hideWhenPaused && !this.#printGL && !!embed.video ? ' hide-when-paused' : '') || undefined,
			id: embed.id ? 'e-' + embed.id : undefined,
			props: this.#href ? { href: this.#href } : { role: 'figure' },
			attrs: this.#href && this.#hrefBlankTarget ? { target: '_blank' } : undefined,
			events: {
				click: () => this.#click(),
				keydown: () => this.#click()
			},
			parent: this
		});

		if (embed.video && !this.#printGL) {
			this.#buildVideoContent(embed);
		} else if (embed.frameSrc) {
			this.#buildIframeContent(embed);
		} else if (!this.#printGL && embed.src) {
			createElement('img', {
				props: {
					src: embed.src, alt: 'Embed',
					...(this.#isSVG && embed.width ? { width: embed.width } : {}),
					...(this.#isSVG && embed.height ? { height: embed.height } : {}),
				},
				style: this.#buttonStyle,
				attrs: { 'data-scroll-through': '' },
				parent: this.#container
			});
		} else {
			const $_lang = get(this.#micrio._lang);
			const title = embed.title || (marker?.i18n?.[$_lang]?.title);
			createElement('button', {
				props: title ? { title } : undefined,
				style: this.#buttonStyle,
				attrs: { 'data-scroll-through': '', 'aria-label': 'embed-button' },
				parent: this.#container
			});
		}
	}

	#buildVideoContent(embed: Models.ImageData.Embed) {
		const video = embed.video!;
		const width = this.#widthCapped;
		const height = width / (video.width / video.height);
		const wCalc = this.#w * this.#info.width;
		const relScale = wCalc / width;

		const vid = createElement('video', {
			props: {
				src: video.src!,
				width: Math.round(width),
				height: Math.round(height),
				controls: !!video.controls,
				loop: !!video.loop && (!video.loopAfter || video.loopAfter <= 0),
				muted: !!video.muted,
				playsInline: true,
				crossOrigin: 'anonymous',
				preload: 'metadata'
			},
			style: relScale !== 1 ? `transform:scale(${relScale})` : undefined,
			children: video.transparent && video.hasH265 && video.src?.endsWith('.webm') ? [
				createElement('source', {
					props: {
						src: video.src.replace('.webm', '.mp4'),
						type: 'video/mp4;codecs=hvc1'
					}
				})
			] : undefined
		});

		this.#figureEl = createElement('figure', {
			children: [vid],
			parent: this.#container!
		});
		this.#videoEl = vid;

		if (embed.id && this.#props.image) {
			this.#props.image._setEmbedMediaElement(embed.id, vid);
		}

		if (video.loop && video.loopAfter != null && video.loopAfter > 0) {
			vid.loop = false;
			const onEnded = () => {
				this.#loopDelayTo = setTimeout(() => {
					if (!this.#paused) vid.play().catch(() => {});
				}, video.loopAfter! * 1000);
			};
			vid.addEventListener('ended', onEnded);
		}

		if (!this.#paused && this.#autoplay) {
			vid.play().catch(() => {});
		}
	}

	#buildIframeContent(embed: Models.ImageData.Embed) {
		createElement('iframe', {
			parent: this.#container,
			props: {
				src: embed.frameSrc!,
				width: String(Math.round(this.#w * this.#info.width)),
				height: String(Math.round(this.#h * this.#info.height))
			},
			attrs: {
				frameborder: '0',
				allow: 'autoplay; encrypted-media',
				allowfullscreen: ''
			}
		});
	}

	#printInsideGL() {
		const { embed, image } = this.#props;
		if (!image) return;

		const opacity = embed.hideWhenPaused ? 0.01 : (embed.opacity ?? 1);

		if (this.#glImage && (this.#glImage._placed || image._embeds.includes(this.#glImage))) {
			this.#glImage.camera.setArea(embed.area as Models.Camera.View);
			this.#glImage.camera.setRotation(this.#rotX, this.#rotY, this.#rotZ);
			if (this.#glImage._placed) image.engine._fadeImage(this.#glImage, opacity);
		} else {
			this.#glImage = image.addEmbed({
				...embed,
				...{
					id: embed.video ? embed.id : embed.micrioId,
					title: embed.uuid,
					path: this.#info.tileBasePath ?? this.#info.path,
					isSingle: !!embed.video,
					isVideo: !!embed.video,
				}
			}, {
				_360: { rotX: this.#rotX, rotY: this.#rotY, rotZ: this.#rotZ }
			}, embed.area as Models.Camera.View, { opacity, asImage: false });
		}

		if (this.#isRawVideo) {
			this.#glVideo = new GLEmbedVideo(image.engine, this.#glImage!, embed, this.#paused, () => this.#moved());
		}

		image.engine.render();
	}

	#moved() {
		if (this.#moveRaf !== undefined) return;
		this.#moveRaf = requestAnimationFrame(() => {
			this.#moveRaf = undefined;
			this.#applyPosition();
		});
	}

	#applyPosition() {
		const { embed, image } = this.#props;
		if (!this.#isBook3d && !image?.engine.ready) return;

		const vp = get(image._viewport);
		const view = get(image.state.view);

		if (view && vp?.[2] > 0 && vp?.[3] > 0 && view[2] > 0 && view[3] > 0) {
			this.#x = vp[0] + (this.#cX - view[0]) / view[2] * vp[2];
			this.#y = vp[1] + (this.#cY - view[1]) / view[3] * vp[3];
			this.#scaleVal = vp[2] / (view[2] * this.#info.width);
		} else {
			const coo = image.camera._getXYDirect(this.#cX, this.#cY);
			[this.#x, this.#y, this.#scaleVal] = Array.from(coo) as [number, number, number];
		}

		const isMat = this.#is360 || this.#isBook3d;

		if (isMat) {
			// The content's width in CSS pixels as it renders before the matrix.
			// `scale` stays a fraction of the page width, so the matrix maps the
			// content to that fraction regardless of its pixel size.
			const contentWidth = !this.#isBook3d ? 1 : embed.frameSrc || embed.video
				? this.#w * this.#info.width
				: embed.src
					? (embed.width || this.#w * this.#info.width)
					: 100;
			const mat = image.camera.getMatrix(this.#cX, this.#cY, (!this.#isBook3d ? 1 : this.#w) * this.#s, contentWidth, this.#rotX, this.#rotY, this.#rotZ, undefined, this.#scaleX, this.#scaleY);
			this.#matrix = Array.from(mat).join(',');
		}

		if (this.#container) {
			const style = isMat
				? this.#matrix ? `transform:matrix3d(${this.#matrix});` : 'display:none'
				: `--x:${this.#x}px;--y:${this.#y}px;--s:${this.#scaleVal};`;

			const opStyle = embed.opacity !== undefined && embed.opacity !== 1
				? `--opacity:${embed.opacity};`
				: '';

			if (this.#isBook3d && this.#book3dPendingPrint) {
				// Keep a book3d embed hidden until the one-time placement delay
				// elapses, so it doesn't print through pages flashing by during
				// a rapid swipe.
				this.#container.style.cssText = 'display:none';
			} else {
				this.#container.style.cssText = style + opStyle;
				this.#container.classList.toggle('embed3d', this.#is360 || this.#isBook3d);
			}
		}

		if ((embed.video?.pauseWhenSmallerThan || embed.video?.pauseWhenLargerThan) && this.#w) {
			this.#paused = this.#shouldPause();
			const vid = this.#glVideo?._vid;
			if (vid) {
				if (this.#paused) {
					if (!vid.paused) vid.pause();
				} else {
					if (vid.paused) {
						this.#glVideo!._cancelTimeout();
						if (image?.$settings?.embedRestartWhenShown) vid.currentTime = 0;
						vid.play();
					}
				}
			}
			this.#syncVideoPause(image);
		}
	}

	#syncVideoPause(image: MicrioImage) {
		const v = this.#videoEl;
		if (!v) return;
		if (this.#figureEl) this.#figureEl.classList.toggle('paused', this.#paused);
		if (this.#paused) {
			if (!v.paused) v.pause();
		} else {
			if (v.paused) {
				if (image?.$settings?.embedRestartWhenShown) v.currentTime = 0;
				v.play().catch(() => {});
			}
		}
	}

	#shouldPause(): boolean {
		const { embed } = this.#props;
		const vid = embed.video;
		if (!vid?.pauseWhenSmallerThan && !vid?.pauseWhenLargerThan) return !this.#autoplay;
		const vp = this.#micrio.canvas.viewport;
		const screenSize = this.#scaleVal
			? Math.max(
				(this.#w * this.#info.width) * this.#scaleVal / vp.width,
				(this.#h * this.#info.height) * this.#scaleVal / vp.height
			)
			: 0;
		return !!(
			(vid.pauseWhenSmallerThan && screenSize < vid.pauseWhenSmallerThan)
			|| (vid.pauseWhenLargerThan && screenSize > vid.pauseWhenLargerThan)
		);
	}

	#click() {
		const { embed, image, marker } = this.#props;
		const markerId = embed.clickAction == 'markerId' ? embed.clickTarget : marker?.id;
		if (!markerId || !image || this.#href) return;
		image.state.marker.set(markerId);
	}

	#onChange(e: Event) {
		if (e && 'detail' in e) {
			const emb = e.detail as Models.ImageData.Embed;
			const target = this.#props.embed as Record<string, any>;
			for (const x of Object.keys(emb as Record<string, unknown>)) {
				target[x] = (emb as Record<string, any>)[x];
			}
		}
		this.#readPlacement();
		this.#moved();
	}

	/** @internal */
	_setProps(props: Partial<EmbedProps>) {
		Object.assign(this.#props, props);
	}

	/** @internal */
	_onDestroy() {
		clearTimeout(this.#loopDelayTo);
		clearTimeout(this.#book3dPrintTo);
		if (this.#moveRaf !== undefined) {
			cancelAnimationFrame(this.#moveRaf);
			this.#moveRaf = undefined;
		}
		this.#glVideo?._unmount();

		const { embed, image } = this.#props;
		if (this.#glImage && this.#glImage._placed && image) {
			image.engine._fadeImage(this.#glImage, 0);
			image.engine.render();
		}

		if (embed.video && embed.id && image) {
			image._setEmbedMediaElement(embed.id);
		}

		this.removeEventListener('change', this.#onChange);
		if (this.#container) {
			this.#container.removeEventListener('click', this.#click);
			this.#container.removeEventListener('keydown', this.#click);
		}
	}
}

customElements.define(MicrioEmbed.tag, MicrioEmbed);
