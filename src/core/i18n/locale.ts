export const locale:string = navigator?.language ?? 'en-EN';

export const languageNames = 'Intl' in self && Intl.DisplayNames ? new Intl.DisplayNames([locale], { type: 'language' }) : undefined;

const rtlBases = ['ar', 'dv', 'fa', 'he', 'iw', 'ku', 'ps', 'sd', 'syr', 'ug', 'ur', 'yi'];

export function isRTL(lang: string): boolean {
	return rtlBases.some(base => lang === base || lang.startsWith(base + '-'));
}
