/**
 * Browser and OS detection utilities.
 * @author Marcel Duin <marcel@micr.io>
 */

/** Type definition for the Browser detection object. */
type BrowserInfo = {
	iOS: boolean; // Is it an iOS device (iPhone, iPad, iPod)?
	firefox: boolean; // Is the browser Firefox?
	OSX: boolean; // Is the operating system macOS?
	hasTouch: boolean; // Does the browser support touch events?
	safari: boolean; // Is the browser Safari (including iOS Safari)?
};

/** User agent string for browser detection. */
const ua = navigator.userAgent;

/**
 * Object containing boolean flags for detected browser/OS features.
 * @internal
 */
export const Browser: BrowserInfo = {
	iOS: /ipad|iphone|ipod/i.test(ua),
	firefox: /firefox/i.test(ua),
	OSX: /macintosh/i.test(ua) && /os\ x/i.test(ua),
	hasTouch: 'TouchEvent' in self, // Check for TouchEvent support
	safari: false // Initialized later
};

// Refine Safari detection (must be OSX/iOS, contain 'safari' or 'instagram', but not 'chrome')
Browser.safari = (Browser.OSX || Browser.iOS) && (/safari/i.test(ua) || /instagram/i.test(ua)) && !/chrome/i.test(ua);

// Correct detection for iPads identifying as macOS but supporting touch events
if (Browser.OSX && (Browser.safari && 'TouchEvent' in self)) {
	Browser.iOS = true;
	Browser.OSX = false;
}

