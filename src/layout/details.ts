import { MicrioElement } from '$core/component'
import type { Models } from '$types/models'
import { get } from '$core/store'
import { createElement } from '$utils/dom'

/** Props for the image details layout element @internal */
export interface DetailsProps {
	info: Models.ImageInfo.ImageInfo
	data: Models.ImageData.ImageData
}
import './details.css'

/** Shape of legacy (pre-i18n) image data, which carried its localized details at the top level. */
interface LegacyImageData {
	i18n?: unknown
	title?: unknown
	description?: unknown
	copyright?: unknown
	sourceUrl?: unknown
}

/** Reads a legacy string field (typed `unknown` because it is not part of the current model). */
function legacyString(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined
}

/** Legacy (pre-i18n) image data, carrying its localized details at the top level. */
function legacyDetails(data: Models.ImageData.ImageData): Models.ImageData.ImageDetailsCultureData {
	const legacy: LegacyImageData = data
	return {
		title: legacyString(legacy.title),
		description: legacyString(legacy.description),
		copyright: legacyString(legacy.copyright),
		sourceUrl: legacyString(legacy.sourceUrl),
	}
}

/** Custom element displaying image details (title, description, copyright, source link) */
class MicrioDetails extends MicrioElement<DetailsProps> {
	/** The custom element tag name @internal */
	static tag = 'micrio-details'

	#props: Partial<DetailsProps> = {}
	#detailsEl!: HTMLDetailsElement

	/** @internal */
	_onMount() {
		const micrio = this._getMicrio()
		if (!micrio) {
			return
		}

		this.#detailsEl = createElement('details', {
			parent: this,
		})

		// The shown metadata is language-dependent, so re-render on a UI language change
		this._watchLater(micrio._lang, () => {
			this.#render()
		})

		this.#render()
	}

	/** @internal */
	_setProps(props: Partial<DetailsProps>) {
		if (props.info !== undefined) {
			this.#props.info = props.info
		}
		if (props.data !== undefined) {
			this.#props.data = props.data
		}
		if (this.isConnected) {
			this.#render()
		}
	}

	#render() {
		const { info } = this.#props
		const { data } = this.#props
		const micrio = this._getMicrio()
		const $_lang = micrio ? get(micrio._lang) : undefined
		const $current = micrio ? get(micrio.current) : undefined
		if (!info || !$_lang || !$current) {
			return
		}

		const cData = data?.i18n ? data.i18n[$_lang] : data && legacyDetails(data)
		const title = cData?.title ?? info.title ?? ''
		const description = cData?.description
		const link = cData?.sourceUrl
		const copyright = cData?.copyright
		if (!title && !description && !link) {
			return
		}

		this.#detailsEl.replaceChildren()

		if (title) {
			createElement('summary', {
				children: [createElement('span', { textContent: title })],
				parent: this.#detailsEl,
			})
		}

		if (description) {
			createElement('div', { innerHTML: description, parent: this.#detailsEl })
		}

		if (link) {
			createElement('p', {
				parent: this.#detailsEl,
				children: [
					createElement('a', {
						props: { href: link, target: '_blank', rel: 'noopener noreferrer' },
						textContent: copyright || link,
					}),
				],
			})
		}
	}
}

customElements.define(MicrioDetails.tag, MicrioDetails)
