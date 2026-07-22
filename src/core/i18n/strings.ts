import { writable, type Writable } from '$core/store';

type TranslationKeys =
	| 'close' | 'zoomIn' | 'zoomOut' | 'fullscreenToggle'
	| 'switchLanguage' | 'share' | 'audioMute' | 'audioUnmute'
	| 'closeMarker' | 'tourStepNext' | 'tourStepPrev' | 'tourStop'
	| 'minimize' | 'play' | 'pause' | 'stop'
	| 'subtitlesToggle' | 'galleryPrev' | 'galleryNext'
	| 'menuToggle' | 'waypointFollow' | 'tours' | 'markerTours' | 'videoTours';

type ButtonTranslations = Record<TranslationKeys, string>;

const langKeys = ['en', 'nl', 'de'];

const strings = {
	close: ['Close', 'Sluit', 'Schließen'],
	zoomIn: ['Zoom in', 'Zoom in', 'Vergrößern'],
	zoomOut: ['Zoom out', 'Zoom uit', 'Verkleinern'],
	fullscreenToggle: ['Toggle fullscreen', 'Volledig scherm aan / uit', 'Vollbild umschalten'],
	switchLanguage: ['Switch language', 'Kies taal', 'Sprache wechseln'],
	share: ['Share', 'Deel', 'Teilen'],
	audioMute: ['Mute audio', 'Geluid uit', 'Ton stummschalten'],
	audioUnmute: ['Unmute audio', 'Geluid aan', 'Ton einschalten'],
	closeMarker: ['Close this marker', 'Sluit deze marker', 'Diesen Marker schließen'],
	tourStepNext: ['Next step', 'Volgende stap', 'Nächster Schritt'],
	tourStepPrev: ['Previous step', 'Vorige stap', 'Vorheriger Schritt'],
	tourStop: ['Stop this tour', 'Stop deze tour', 'Tour beenden'],
	minimize: ['Minimize', 'Minimaliseer', 'Minimieren'],
	play: ['Play', 'Start', 'Abspielen'],
	pause: ['Pause', 'Pauzeer', 'Pause'],
	stop: ['Stop', 'Stop', 'Stopp'],
	subtitlesToggle: ['Toggle subtitles', 'Ondertitels aan / uit', 'Untertitel umschalten'],
	galleryPrev: ['Previous image', 'Vorige afbeelding', 'Vorheriges Bild'],
	galleryNext: ['Next image', 'Volgende afbeelding', 'Nächstes Bild'],
	menuToggle: ['Toggle menu', 'Menu openen / sluiten', 'Menü umschalten'],
	waypointFollow: ['Go this way', 'Ga deze richting', 'Diesen Weg gehen'],
	tours: ['Tours', 'Tours', 'Touren'],
	markerTours: ['Marker tours', 'Marker tours', 'Marker-Touren'],
	videoTours: ['Video tours', 'Video tours', 'Video-Touren'],
} satisfies Record<TranslationKeys, [string, string, string]>;

export const langs: Record<string, ButtonTranslations> = {};

const keys = Object.keys(strings) as TranslationKeys[];

for (let i = 0; i < langKeys.length; i++) {
	const lang: Partial<Record<TranslationKeys, string>> = {};
	for (const key of keys) {
		lang[key] = strings[key][i];
	}
	langs[langKeys[i]] = lang as ButtonTranslations;
}

export const i18n:Writable<ButtonTranslations> = writable(langs.en);
