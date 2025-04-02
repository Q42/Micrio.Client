import { writable, type Writable } from "svelte/store";

/**
 * Interface defining the structure for UI button translations.
 * Each key corresponds to a specific UI element's title or label.
 */
interface ButtonTranslations {
	close: string;
	zoomIn: string;
	zoomOut: string;
	fullscreenToggle: string;
	switchLanguage: string;
	share: string;
	audioMute: string;
	audioUnmute: string;
	closeMarker: string;
	tourStepNext: string;
	tourStepPrev: string;
	tourStop: string;
	minimize: string;
	play: string;
	pause: string;
	stop: string;
	subtitlesToggle: string;
	galleryPrev: string;
	galleryNext: string;
	menuToggle: string;
	waypointFollow: string;
}

/**
 * Object containing translations for UI button titles in different languages.
 * The keys are language codes (e.g., 'en', 'nl'), and the values are objects
 * conforming to the `ButtonTranslations` interface.
 */
export const langs : {
	[key: string]: ButtonTranslations
} = {
	/** English translations */
	en: {
		close: 'Close',
		zoomIn: 'Zoom in',
		zoomOut: 'Zoom out',
		fullscreenToggle: 'Toggle fullscreen',
		switchLanguage: 'Switch language',
		share: 'Share',
		audioMute: 'Mute audio',
		audioUnmute: 'Unmute audio',
		closeMarker: 'Close this marker',
		tourStepNext: 'Next step',
		tourStepPrev: 'Previous step',
		tourStop: 'Stop this tour',
		minimize: 'Minimize',
		play: 'Play',
		pause: 'Pause',
		stop: 'Stop',
		subtitlesToggle: 'Toggle subtitles',
		galleryPrev: 'Previous image',
		galleryNext: 'Next image',
		menuToggle: 'Toggle menu',
		waypointFollow: 'Go this way',
	},
	/** Dutch translations */
	nl: {
		close: 'Sluit',
		zoomIn: 'Zoom in',
		zoomOut: 'Zoom uit',
		fullscreenToggle: 'Volledig scherm aan / uit',
		switchLanguage: 'Kies taal',
		share: 'Deel',
		audioMute: 'Geluid uit',
		audioUnmute: 'Geluid aan',
		closeMarker: 'Sluit deze marker',
		tourStepNext: 'Volgende stap',
		tourStepPrev: 'Vorige stap',
		tourStop: 'Stop deze tour',
		minimize: 'Minimaliseer',
		play: 'Start',
		pause: 'Pauzeer',
		stop: 'Stop',
		subtitlesToggle: 'Ondertitels aan / uit',
		galleryPrev: 'Vorige afbeelding',
		galleryNext: 'Volgende afbeelding',
		menuToggle: 'Menu openen / sluiten',
		waypointFollow: 'Ga deze richting',
	},
	// TODO: Add more languages as needed
};

/**
 * Writable Svelte store holding the currently active `ButtonTranslations` object.
 * Defaults to English ('en'). UI components subscribe to this store to display
 * translated text based on the currently selected language.
 * The language is typically changed by updating the `micrio._lang` store, which
 * should then trigger an update to this `i18n` store.
 */
export const i18n:Writable<ButtonTranslations> = writable(langs.en);
