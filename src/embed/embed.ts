import { createElement, IFRAME_ALLOW } from '$utils/dom'
import { MicrioElement } from '$core/component'
import type { HTMLMicrioElement } from '$core/element'
import type { Models } from '$types/models'
import type { MicrioImage } from '$core/image'
import { get } from '$core/store'
import { Browser } from '$utils/browser'
import { GLEmbedVideo } from '$media/embedvideo'

/** Properties for configuring an embed element (image, video, iframe, or GL content). @internal */
export interface EmbedProps {
	/** The embed data from the image manifest. */
	embed: Models.ImageData.Embed
	/** The parent MicrioImage instance. */
	image: MicrioImage
	/** Optional associated marker used for click actions. */
	marker?: Models.ImageData.Marker
}
import './embed.css'
import { randomUUID } from '$utils/id'

/** Custom element that renders an embed (image, video, iframe, or GL-embedded Micrio image) positioned within a Micrio scene. */
class MicrioEmbed extends MicrioElement<EmbedProps> {
	/** HTML tag name for this custom element. @internal */
	static tag = 'micrio-embed'

	#props: Partial<EmbedProps> = {}

	#micrio!: HTMLMicrioElement
	#info!: Models.ImageInfo.ImageInfo
	#glImage?: MicrioImage
	#glVideo?: GLEmbedVideo
	#container?: HTMLElement
	/** True while the embed container is hidden through an inline `display` (360/book3d placement). */
	#hidden = false
	#videoEl?: HTMLVideoElement
	#figureEl?: HTMLElement
	/** The built content element (`img`/`button`/`iframe`/`video`) whose size follows the placement. */
	#contentEl?: HTMLElement
	/** Latest values received from the view/viewport store subscriptions. */
	#view?: Models.Camera.View
	#viewport?: Models.Camera.View
	#loopDelayTo: ReturnType<typeof setTimeout> | undefined
	/** Pending debounce for printing a book3d embed (waits for the view to settle). */
	#book3dPrintTo: ReturnType<typeof globalThis.setTimeout> | undefined
	/** True until the one-time book3d print delay after the embed is placed in the DOM has elapsed. */
	#book3dPendingPrint = false

	#is360 = false
	#autoplay = true
	#isSVG = false
	#isSmall = false
	#screenIsHDR = false
	#isBook3d = false
	#embedImageAsHtml = false
	#printGL = false
	#noEvents = false
	#href: string | undefined
	#hrefBlankTarget = false
	#isRawVideo = false
	#hasHtml = false
	#paused = false
	#widthCapped = 0
	#hideWhenPaused = false

	#w = 0
	#h = 0
	#cX = 0
	#cY = 0
	#s = 1
	#rotX = 0
	#rotY = 0
	#rotZ = 0
	#scaleX = 1
	#scaleY = 1
	#x = 0
	#y = 0
	#scaleVal = 0
	/** True if `is360 || isBook3d`; static per embed. */
	#isMat = false
	/** Static matrix inputs computed once per placement. */
	#matrixScale = 1
	#contentWidth = 1
	/** Last written values, so unchanged properties are never rewritten. */
	#lastMatrix = ''
	#lastX = Number.NaN
	#lastY = Number.NaN
	#lastS = Number.NaN
	#lastOpacity = 1
	/** Last applied video-paused UI state. */
	#pausedUI = false
	#buttonStyle = ''

	/** @internal */
	_onMount() {
		const { embed, image, marker } = this.#props
		const micrio = this._getMicrio()
		if (!micrio || !embed || !image) {
			return
		}
		this.#micrio = micrio

		const info = image.$info
		this.#info = info

		if (!embed.uuid) {
			embed.uuid = randomUUID()
		}

		this.#is360 = image._is360
		this.#autoplay = embed.video?.autoplay ?? true

		const { grid } = image
		if (grid !== undefined) {
			const focused = grid._focussed
			const markersShown = grid._markersShown
			const updateInactive = () => {
				const f = get(focused)
				const ms = get(markersShown)
				const inactive = f !== undefined && f !== image && ms.indexOf(image) < 0
				this.#container?.classList.toggle('inactive', inactive)
			}
			this._watch(focused, updateInactive)
			this._watch(markersShown, updateInactive)
		}

		this.#glImage = image._embeds.find((i) => i.uuid === embed.uuid || i.$info?.title === embed.uuid)

		this.#screenIsHDR = matchMedia('(dynamic-range: high)').matches || Browser.OSX

		this.#isSVG = embed.src?.toLowerCase().endsWith('.svg') ?? false
		this.#isSmall = embed.width && embed.height ? embed.width * embed.height < 1048576 : false

		const isIOS14 = /iPhone OS 14_/i.test(navigator.userAgent)
		// `data-embeds-inside-gl` render mode:
		// - 'auto' (default, same as omitting the attribute): platform and size
		//   heuristics decide — WebGL on capable/HDR setups, small images as <img>.
		// - 'true': force every GL-capable embed into WebGL, overriding those
		//   heuristics (small images rendered as <img>, non-HDR videos, the
		//   SVG/iOS14 fallbacks).
		// - 'false': force every embed to be rendered as HTML.
		// Embeds that can't be rendered in WebGL (iframes, src-only images, videos
		// with controls or alpha transparency) still fall back to HTML in any mode.
		const glAttrValue = this.#micrio.dataset.embedsInsideGl
		const glMode: Models.Attributes.EmbedGLMode =
			glAttrValue === 'true' || glAttrValue === 'false' ? glAttrValue : 'auto'
		const forceGL = glMode === 'true'
		this.#embedImageAsHtml =
			glMode === 'false' ||
			(glMode === 'auto' && (this.#isSVG || isIOS14 || (!this.#screenIsHDR && Boolean(embed.video))))

		// 3d books have their own WebGL renderer
		this.#isBook3d = this.#micrio.$current?.album?.info?.type === 'book3d'
		this.#isMat = this.#is360 || this.#isBook3d

		this.#printGL =
			!this.#isBook3d &&
			!this.#embedImageAsHtml &&
			Boolean(
				(embed.micrioId && (forceGL || !this.#isSmall || !embed.src)) ||
				(embed.video && !embed.video.controls && !embed.video.transparent),
			)

		// A video with native controls is interactive content: it must not be
		// swallowed by the overlay's `no-events` (inherited pointer-events: none).
		this.#noEvents = !embed.clickAction && !embed.frameSrc && !marker && !embed.video?.controls
		this.#href = embed.clickAction === 'href' ? embed.clickTarget : undefined
		this.#hrefBlankTarget = Boolean(this.#href && embed.clickTargetBlank)

		this.#isRawVideo = this.#printGL && Boolean(embed.video)
		this.#hasHtml = !this.#printGL || Boolean(embed.clickAction)
		this.#hideWhenPaused = Boolean(embed.hideWhenPaused)

		if (embed.video && !embed.video.controls) {
			embed.video.muted = true
		}

		this.#readPlacement()

		if (this.#hasHtml) {
			this.#buildDOM(embed, marker)
		}

		if (this.#isBook3d && this.#hasHtml) {
			// Set the print delay once, at placement time: keep the embed hidden
			// for 500ms so it doesn't paint through pages being swiped past.
			this.#book3dPendingPrint = true
			this.#book3dPrintTo = setTimeout(() => {
				this.#book3dPrintTo = undefined
				this.#book3dPendingPrint = false
				this.#applyPosition()
			}, 500)
		}

		if (this.#printGL) {
			this.#printInsideGL()
		}

		const camOwner = image.camera?.image
		const moveSrc = camOwner !== undefined && camOwner !== image ? camOwner : image

		if (this.#hasHtml || Boolean(embed.video?.pauseWhenSmallerThan) || Boolean(embed.video?.pauseWhenLargerThan)) {
			// Cache the emitted values and reposition directly. Store updates happen
			// inside the render frame, so this stays in-phase with the draw and never
			// needs its own animation frame.
			this._watch(moveSrc.state.view, (v) => {
				this.#view = v
				this.#applyPosition()
			})
			this._watch(moveSrc._viewport, (v) => {
				this.#viewport = v
				this.#applyPosition()
			})
		}

		this.#applyPosition()
		this.addEventListener('change', this.#onChange)
	}

	#readPlacement() {
		const { embed } = this.#props
		if (!embed) {
			return
		}
		const a = embed.area
		this.#w = a[2]
		this.#h = a[3]
		this.#cX = a[0] + this.#w / 2
		this.#cY = a[1] + this.#h / 2
		this.#s = embed.scale || 1
		this.#rotX = embed.rotX ?? 0
		this.#rotY = embed.rotY ?? 0
		this.#rotZ = embed.rotZ ?? 0
		this.#scaleX = embed.scaleX ?? 1
		this.#scaleY = embed.scaleY ?? 1

		// The video cap drives both the HTML <video> size (also for book3d, where
		// the style math below is skipped) and its rendered width, so it has to be
		// known before the early return. Malformed zero dimensions fall back to the
		// area width instead of dividing by zero.
		if (embed.video) {
			const { width: vw, height: vh } = embed.video
			if (vw > 0 && vh > 0) {
				this.#widthCapped =
					vw > vh
						? Math.min(vw, this.#w * this.#info.width, 2048)
						: Math.min(vh, this.#h * this.#info.height, 2048) / (vh / vw)
			} else {
				this.#widthCapped = this.#w * this.#info.width
			}
		}

		// Static inputs for the 360/book3d matrix — computed once per placement.
		this.#matrixScale = (!this.#isBook3d ? 1 : this.#w) * this.#s
		if (!this.#isBook3d) {
			this.#contentWidth = 1
		} else if (embed.frameSrc || embed.video) {
			this.#contentWidth = this.#w * this.#info.width
		} else if (embed.src) {
			this.#contentWidth = embed.width || this.#w * this.#info.width
		} else {
			this.#contentWidth = 100
		}

		const isGLEmbeddedMicrio = this.#printGL && Boolean(embed.micrioId) && Boolean(embed.width)
		const htmlButtonEmbedScale = isGLEmbeddedMicrio ? 10 : 1

		if (this.#isBook3d) {
			return
		}

		let scaleDiv = 1
		if (!this.#printGL) {
			scaleDiv = this.#s
		} else if (embed.width) {
			scaleDiv = this.#w
		}
		let scale = this.#w * ((this.#info.width / (embed.width ?? 100) / scaleDiv) * (this.#is360 ? Math.PI / 2 : 1))

		const styles: string[] = []

		if (isGLEmbeddedMicrio && embed.width !== undefined) {
			scale = (this.#w / (embed.width / this.#info.width)) * htmlButtonEmbedScale * (this.#is360 ? Math.PI / 2 : 1)
			styles.push(`width:${embed.width / htmlButtonEmbedScale}px`)
		}

		styles.push(`--ratio:${((this.#w / this.#h) * this.#info.width) / this.#info.height};--scale:${scale}`)

		if (this.#isSVG && embed.height) {
			styles.push(`height:${embed.height}px`)
		}

		this.#buttonStyle = styles.join(';')
	}

	#buildDOM(embed: Models.ImageData.Embed, marker?: Models.ImageData.Marker) {
		this.#container = createElement(this.#href ? 'a' : 'div', {
			className:
				(this.#noEvents ? 'no-events' : '') +
					(this.#hideWhenPaused && !this.#printGL && Boolean(embed.video) ? ' hide-when-paused' : '') +
					(this.#is360 || this.#isBook3d ? ' embed3d' : '') || undefined,
			id: embed.id ? `e-${embed.id}` : undefined,
			props: this.#href ? { href: this.#href } : { role: 'figure' },
			attrs: this.#href && this.#hrefBlankTarget ? { target: '_blank' } : undefined,
			events: {
				click: () => {
					this.#click()
				},
				keydown: () => {
					this.#click()
				},
			},
			parent: this,
		})

		if (embed.video && !this.#printGL) {
			this.#buildVideoContent(embed)
		} else if (embed.frameSrc) {
			this.#buildIframeContent(embed)
		} else if (!this.#printGL && embed.src) {
			this.#contentEl = createElement('img', {
				props: { src: embed.src, alt: 'Embed' },
				attrs: { 'data-scroll-through': '' },
				parent: this.#container,
			})
			this.#applyContentSize()
		} else {
			const $_lang = get(this.#micrio._lang)
			const title = embed.title || marker?.i18n?.[$_lang]?.title
			this.#contentEl = createElement('button', {
				props: title ? { title } : undefined,
				attrs: { 'data-scroll-through': '', 'aria-label': 'embed-button' },
				parent: this.#container,
			})
			this.#applyContentSize()
		}
	}

	/**
	 * Applies the placement-derived size (and, for a video, its rendered scale) to the
	 * built content element. Called once after building and again on an editor `change`,
	 * so an embed's size follows its data after mount as well — the single source of
	 * truth for content sizing.
	 */
	#applyContentSize() {
		const el = this.#contentEl
		const { embed } = this.#props
		if (!el || !embed) {
			return
		}
		if (el instanceof HTMLVideoElement) {
			const { video } = embed
			if (!video || !this.#widthCapped) {
				return
			}
			// Malformed dimensions have no aspect to honour.
			const aspect = video.width > 0 && video.height > 0 ? video.width / video.height : 1
			el.width = Math.round(this.#widthCapped)
			el.height = Math.round(this.#widthCapped / aspect)
			const relScale = (this.#w * this.#info.width) / this.#widthCapped
			el.style.transform = relScale === 1 ? '' : `scale(${relScale})`
			return
		}
		if (el instanceof HTMLIFrameElement) {
			el.width = String(Math.round(this.#w * this.#info.width))
			el.height = String(Math.round(this.#h * this.#info.height))
			return
		}
		el.style.cssText = this.#buttonStyle
		if (this.#isSVG && el instanceof HTMLImageElement) {
			if (embed.width !== undefined) {
				el.width = embed.width
			}
			if (embed.height !== undefined) {
				el.height = embed.height
			}
		}
	}

	#buildVideoContent(embed: Models.ImageData.Embed) {
		const { video } = embed
		if (!video) {
			return
		}
		const vid = createElement('video', {
			props: {
				src: video.src,
				controls: video.controls,
				loop: video.loop && (!video.loopAfter || video.loopAfter <= 0),
				muted: video.muted,
				playsInline: true,
				crossOrigin: 'anonymous',
				preload: 'metadata',
			},
			children:
				video.transparent && video.hasH265 && video.src?.endsWith('.webm')
					? [
							createElement('source', {
								props: {
									src: video.src.replace('.webm', '.mp4'),
									type: 'video/mp4;codecs=hvc1',
								},
							}),
						]
					: undefined,
		})

		this.#figureEl = createElement('figure', {
			children: [vid],
			parent: this.#container,
		})
		this.#videoEl = vid
		this.#contentEl = vid
		this.#applyContentSize()

		if (embed.id && this.#props.image) {
			this.#props.image._setEmbedMediaElement(embed.id, vid)
		}

		if (video.loop && video.loopAfter != null && video.loopAfter > 0) {
			const { loopAfter } = video
			vid.loop = false
			const onEnded = () => {
				this.#loopDelayTo = setTimeout(() => {
					if (!this.#paused) {
						vid.play().catch(() => {})
					}
				}, loopAfter * 1000)
			}
			vid.addEventListener('ended', onEnded)
		}

		if (!this.#paused && this.#autoplay) {
			vid.play().catch(() => {})
		}
	}

	#buildIframeContent(embed: Models.ImageData.Embed) {
		const src = embed.frameSrc
		if (!src) {
			return
		}
		this.#contentEl = createElement('iframe', {
			parent: this.#container,
			props: { src },
			attrs: {
				frameborder: '0',
				allow: IFRAME_ALLOW,
				allowfullscreen: '',
			},
		})
		this.#applyContentSize()
	}

	#printInsideGL() {
		const { embed, image } = this.#props
		if (!embed || !image) {
			return
		}

		const opacity = embed.hideWhenPaused ? 0.01 : (embed.opacity ?? 1)

		if (this.#glImage && (this.#glImage._placed || image._embeds.includes(this.#glImage))) {
			this.#glImage.camera.setArea(embed.area)
			this.#glImage.camera.setRotation(this.#rotX, this.#rotY, this.#rotZ)
			if (this.#glImage._placed) {
				image.engine._fadeImage(this.#glImage, opacity)
			}
		} else {
			this.#glImage = image.addEmbed(
				{
					...embed,
					id: embed.video ? embed.id : embed.micrioId,
					title: embed.uuid,
					path: this.#info.tileBasePath ?? this.#info.path,
					isSingle: Boolean(embed.video),
					isVideo: Boolean(embed.video),
				},
				{
					_360: { rotX: this.#rotX, rotY: this.#rotY, rotZ: this.#rotZ },
				},
				embed.area,
				{ opacity, asImage: false },
			)
		}

		if (this.#isRawVideo) {
			this.#glVideo = new GLEmbedVideo(image.engine, this.#glImage, embed, this.#paused, () => {
				this.#applyPosition()
			})
		}

		image.engine.render()
	}

	#applyPosition() {
		const { embed, image } = this.#props
		if (!embed || !image) {
			return
		}
		if (!this.#isBook3d && !image.engine.ready) {
			return
		}

		const vp = this.#viewport
		const view = this.#view

		if (view && vp && vp[2] > 0 && vp[3] > 0 && view[2] > 0 && view[3] > 0) {
			this.#x = vp[0] + ((this.#cX - view[0]) / view[2]) * vp[2]
			this.#y = vp[1] + ((this.#cY - view[1]) / view[3]) * vp[3]
			this.#scaleVal = vp[2] / (view[2] * this.#info.width)
		} else {
			const coo = image.camera._getXYDirect(this.#cX, this.#cY)
			this.#x = coo[0]
			this.#y = coo[1]
			this.#scaleVal = coo[2]
		}

		if (this.#container) {
			const c = this.#container,
				s = c.style

			if (this.#isBook3d && this.#book3dPendingPrint) {
				// Keep a book3d embed hidden until the one-time placement delay
				// elapses, so it doesn't print through pages flashing by during
				// a rapid swipe.
				if (!this.#hidden) {
					this.#hidden = true
					s.display = 'none'
				}
			} else if (this.#isMat) {
				// 360/book3d: recompute the matrix and write it straight to the
				// `transform` property (never `style.cssText`), skipping both the
				// write and the property recalculation when nothing changed.
				const matrix = image.camera
					.getMatrix(
						this.#cX,
						this.#cY,
						this.#matrixScale,
						this.#contentWidth,
						this.#rotX,
						this.#rotY,
						this.#rotZ,
						undefined,
						this.#scaleX,
						this.#scaleY,
					)
					.join(',')
				const hidden = !matrix
				if (hidden !== this.#hidden) {
					this.#hidden = hidden
					s.display = hidden ? 'none' : ''
				}
				if (!hidden && matrix !== this.#lastMatrix) {
					this.#lastMatrix = matrix
					s.transform = `matrix3d(${matrix})`
				}
			} else {
				if (this.#hidden) {
					this.#hidden = false
					s.display = ''
				}
				// 2D: only the position/scale custom properties change. Compare the
				// cached numbers and only build/write a property when it changed.
				if (this.#x !== this.#lastX) {
					this.#lastX = this.#x
					s.setProperty('--x', `${this.#x}px`)
				}
				if (this.#y !== this.#lastY) {
					this.#lastY = this.#y
					s.setProperty('--y', `${this.#y}px`)
				}
				if (this.#scaleVal !== this.#lastS) {
					this.#lastS = this.#scaleVal
					s.setProperty('--s', `${this.#scaleVal}`)
				}
			}

			if (!(this.#isBook3d && this.#book3dPendingPrint)) {
				// Opacity is static per embed; only touch it when it actually changes.
				const opacity = embed.opacity !== undefined && embed.opacity !== 1 ? embed.opacity : 1
				if (opacity !== this.#lastOpacity) {
					this.#lastOpacity = opacity
					if (opacity !== 1) {
						s.setProperty('--opacity', `${opacity}`)
					} else {
						s.removeProperty('--opacity')
					}
				}
			}
		}

		if ((embed.video?.pauseWhenSmallerThan || embed.video?.pauseWhenLargerThan) && this.#w) {
			this.#paused = this.#shouldPause()
			const glVideo = this.#glVideo
			const vid = glVideo?._vid
			if (glVideo && vid) {
				if (this.#paused) {
					if (!vid.paused) {
						vid.pause()
					}
				} else if (vid.paused) {
					glVideo._cancelTimeout()
					if (image?.$settings?.embedRestartWhenShown) {
						vid.currentTime = 0
					}
					void vid.play()
				}
			}
			this.#syncVideoPause(image)
		}
	}

	#syncVideoPause(image: MicrioImage) {
		const v = this.#videoEl
		if (!v) {
			return
		}
		if (this.#figureEl && this.#pausedUI !== this.#paused) {
			this.#pausedUI = this.#paused
			this.#figureEl.classList.toggle('paused', this.#paused)
		}
		if (this.#paused) {
			if (!v.paused) {
				v.pause()
			}
		} else if (v.paused) {
			if (image?.$settings?.embedRestartWhenShown) {
				v.currentTime = 0
			}
			v.play().catch(() => {})
		}
	}

	#shouldPause(): boolean {
		const { embed } = this.#props
		if (!embed) {
			return !this.#autoplay
		}
		const vid = embed.video
		if (!vid?.pauseWhenSmallerThan && !vid?.pauseWhenLargerThan) {
			return !this.#autoplay
		}
		const { width, height } = this.#micrio.canvas.viewport
		// The canvas viewport is 0x0 until the element is resized; dividing by it
		// would make the screen size infinite and pause every pauseWhenLargerThan
		// video at startup.
		const screenSize =
			this.#scaleVal && width > 0 && height > 0
				? Math.max(
						(this.#w * this.#info.width * this.#scaleVal) / width,
						(this.#h * this.#info.height * this.#scaleVal) / height,
					)
				: 0
		return Boolean(
			(vid.pauseWhenSmallerThan && screenSize < vid.pauseWhenSmallerThan) ||
			(vid.pauseWhenLargerThan && screenSize > vid.pauseWhenLargerThan),
		)
	}

	#click = () => {
		const { embed, image, marker } = this.#props
		if (!embed) {
			return
		}
		const markerId = embed.clickAction === 'markerId' ? embed.clickTarget : marker?.id
		if (!markerId || !image || this.#href) {
			return
		}
		image.state.marker.set(markerId)
	}

	#onChange = (e: Event) => {
		const { embed } = this.#props
		if (embed !== undefined && hasObjectDetail(e)) {
			Object.assign(embed, e.detail)
		}
		this.#readPlacement()
		this.#applyContentSize()
		// A WebGL embed is placed through its camera, not an overlay.
		const gl = this.#glImage
		if (gl !== undefined && embed !== undefined) {
			gl.camera.setArea(embed.area)
			gl.camera.setRotation(this.#rotX, this.#rotY, this.#rotZ)
		}
		// Editor-driven change: apply immediately (outside the render frame).
		this.#applyPosition()
	}

	/** @internal */
	_setProps(props: Partial<EmbedProps>) {
		Object.assign(this.#props, props)
	}

	/** @internal */
	_onDestroy() {
		clearTimeout(this.#loopDelayTo)
		clearTimeout(this.#book3dPrintTo)
		// Stop an HTML <video> (the GL path is stopped by #glVideo._unmount below):
		// a detached media element otherwise keeps decoding and playing, and the
		// registry entry is dropped further down.
		this.#videoEl?.pause()
		this.#glVideo?._unmount()

		const { embed, image } = this.#props
		if (this.#glImage && this.#glImage._placed && image) {
			image.engine._fadeImage(this.#glImage, 0)
			image.engine.render()
		}

		if (embed?.video && embed.id && image) {
			image._setEmbedMediaElement(embed.id)
		}

		this.removeEventListener('change', this.#onChange)
		if (this.#container) {
			this.#container.removeEventListener('click', this.#click)
			this.#container.removeEventListener('keydown', this.#click)
		}
	}
}

/**
 * True when `e` carries a usable object `detail` payload (e.g. an editor-driven
 * property update dispatched as a CustomEvent). The check is runtime-driven
 * because the event is also dispatched by external code.
 */
function hasObjectDetail(e: Event): e is Event & { detail: object } {
	return 'detail' in e && e.detail !== undefined && e.detail !== null && typeof e.detail === 'object'
}

customElements.define(MicrioEmbed.tag, MicrioEmbed)
