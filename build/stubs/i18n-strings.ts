import { writable } from '$core/store';

/** Minimal-build stub for `$core/i18n/strings` — translation bundles are excluded from the core build. */
export const langs: Record<string, undefined> = {};
export const i18n = writable(undefined);
