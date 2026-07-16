import { writable } from '$core/store';

const CAPTIONS_KEY = 'micrio-captions-disable';

export const captionsEnabled = writable<boolean>(localStorage.getItem(CAPTIONS_KEY) != '1');

captionsEnabled.subscribe(b => {
	if (b) localStorage.removeItem(CAPTIONS_KEY);
	else localStorage.setItem(CAPTIONS_KEY, '1');
});
