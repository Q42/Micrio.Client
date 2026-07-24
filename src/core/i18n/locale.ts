/** The user's browser locale string, falling back to `'en-EN'`. @internal */
export const locale:string = navigator?.language ?? 'en-EN';

/** `Intl.DisplayNames` instance for resolving language names in the user's locale, or `undefined` if unsupported. @internal */
export const languageNames = 'Intl' in self && Intl.DisplayNames ? new Intl.DisplayNames([locale], { type: 'language' }) : undefined;

const rtlBases = ['ar', 'dv', 'fa', 'he', 'iw', 'ku', 'ps', 'sd', 'syr', 'ug', 'ur', 'yi'];

/** Checks whether a language code is a right-to-left language. @internal */
export function isRTL(lang: string): boolean {
	return rtlBases.some(base => lang === base || lang.startsWith(base + '-'));
}
