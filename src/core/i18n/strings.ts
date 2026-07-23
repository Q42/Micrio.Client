import { writable, type Writable } from '$core/store';

type TranslationKeys =
	| '_close' | '_zoomIn' | '_zoomOut' | '_fullscreenToggle'
	| '_switchLanguage' | '_share' | '_audioMute' | '_audioUnmute'
	| '_closeMarker' | '_tourStepNext' | '_tourStepPrev' | '_tourStop'
	| '_minimize' | '_play' | '_pause' | '_stop'
	| '_subtitlesToggle' | '_galleryPrev' | '_galleryNext'
	| '_menuToggle' | '_waypointFollow' | '_tours' | '_markerTours' | '_videoTours';

type ButtonTranslations = Record<TranslationKeys, string>;

const langKeys = ['en', 'nl', 'de'];

const strings = {
	_close: ['Close', 'Sluit', 'Schließen'],
	_zoomIn: ['Zoom in', 'Zoom in', 'Vergrößern'],
	_zoomOut: ['Zoom out', 'Zoom uit', 'Verkleinern'],
	_fullscreenToggle: ['Toggle fullscreen', 'Volledig scherm aan / uit', 'Vollbild umschalten'],
	_switchLanguage: ['Switch language', 'Kies taal', 'Sprache wechseln'],
	_share: ['Share', 'Deel', 'Teilen'],
	_audioMute: ['Mute audio', 'Geluid uit', 'Ton stummschalten'],
	_audioUnmute: ['Unmute audio', 'Geluid aan', 'Ton einschalten'],
	_closeMarker: ['Close this marker', 'Sluit deze marker', 'Diesen Marker schließen'],
	_tourStepNext: ['Next step', 'Volgende stap', 'Nächster Schritt'],
	_tourStepPrev: ['Previous step', 'Vorige stap', 'Vorheriger Schritt'],
	_tourStop: ['Stop this tour', 'Stop deze tour', 'Tour beenden'],
	_minimize: ['Minimize', 'Minimaliseer', 'Minimieren'],
	_play: ['Play', 'Start', 'Abspielen'],
	_pause: ['Pause', 'Pauzeer', 'Pause'],
	_stop: ['Stop', 'Stop', 'Stopp'],
	_subtitlesToggle: ['Toggle subtitles', 'Ondertitels aan / uit', 'Untertitel umschalten'],
	_galleryPrev: ['Previous image', 'Vorige afbeelding', 'Vorheriges Bild'],
	_galleryNext: ['Next image', 'Volgende afbeelding', 'Nächstes Bild'],
	_menuToggle: ['Toggle menu', 'Menu openen / sluiten', 'Menü umschalten'],
	_waypointFollow: ['Go this way', 'Ga deze richting', 'Diesen Weg gehen'],
	_tours: ['Tours', 'Tours', 'Touren'],
	_markerTours: ['Marker tours', 'Marker tours', 'Marker-Touren'],
	_videoTours: ['Video tours', 'Video tours', 'Video-Touren'],
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
