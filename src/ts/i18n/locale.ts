/**
 * Language-related constants and utilities.
 */

/**
 * The browser's current locale string (e.g., 'en-US', 'nl-NL'), falling back to 'en-EN'.
 * Used for initializing the `languageNames` object.
 */
export const locale:string = navigator?.language ?? 'en-EN';

/**
 * An `Intl.DisplayNames` object configured to provide human-readable language names
 * based on the browser's locale. Used for displaying language options in the UI.
 * Will be `undefined` if `Intl.DisplayNames` is not supported by the browser.
 *
 * @example
 * ```javascript
 * languageNames?.of('nl'); // Output might be "Dutch" (depending on browser locale)
 * ```
 */
export const languageNames = 'Intl' in self && Intl.DisplayNames ? new Intl.DisplayNames([locale], { type: 'language' }) : undefined;

/**
 * An array of language codes that are typically written Right-to-Left (RTL).
 * Used by the `HTMLMicrioElement` to set the `dir="rtl"` attribute when an RTL language is selected.
 */
export const rtlLanguageCodes = [
	'ar', // Arabic
	'ar-AE', // Arabic (U.A.E.)
	'ar-BH', // Arabic (Bahrain)
	'ar-DJ', // Arabic (Djibouti)
	'ar-DZ', // Arabic (Algeria)
	'ar-EG', // Arabic (Egypt)
	'ar-IQ', // Arabic (Iraq)
	'ar-JO', // Arabic (Jordan)
	'ar-KW', // Arabic (Kuwait)
	'ar-LB', // Arabic (Lebanon)
	'ar-LY', // Arabic (Libya)
	'ar-MA', // Arabic (Morocco)
	'ar-OM', // Arabic (Oman)
	'ar-QA', // Arabic (Qatar)
	'ar-SA', // Arabic (Saudi Arabia)
	'ar-SD', // Arabic (Sudan)
	'ar-SY', // Arabic (Syria)
	'ar-TN', // Arabic (Tunisia)
	'ar-YE', // Arabic (Yemen)
	'dv', // Divehi (alternate code?)
	'dv-MV', // Divehi (Maldives)
	'fa', // Persian (alternate code?)
	'fa-AF', // Persian (Afghanistan)
	'fa-IR', // Persian (Iran)
	'he', // Hebrew
	'he-IL', // Hebrew (Israel)
	'iw', // Hebrew (obsolete code)
	'iw-PS', // Hebrew (Palestinian Authority) - Non-standard?
	'kd', // Unknown?
	'ku', // Kurdish (alternate code?)
	'ku-IQ', // Kurdish (Iraq)
	'ku-IR', // Kurdish (Iran)
	'ku-SY', // Kurdish (Syria)
	'ku-TR', // Kurdish (Turkey)
	'pk-PK', // Unknown? Pakistan?
	'ps', // Pashto
	'ps-AF', // Pashto (Afghanistan)
	'sd', // Sindhi (alternate code?)
	'sd-PK', // Sindhi (Pakistan)
	'syr-SY', // Syriac (Syria)
	'ug', // Uyghur
	'ug-CN', // Uyghur (China)
	'ur', // Urdu
	'ur-IN', // Urdu (India)
	'ur-PK', // Urdu (Pakistan)
	'yi', // Yiddish
	'yi-IL', // Yiddish (Israel)
	'yi-US' // Yiddish (United States)
];
// TODO: Verify non-standard/unknown codes ('dv', 'fa', 'iw-PS', 'kd', 'ku', 'pk-PK', 'sd'). Consider using only standard IETF language tags.
