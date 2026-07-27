/**
 * # The Micrio Client Viewer
 * 
 * The `<micr-io>` viewer client.
 * 
 * For the TypeScript API documentation (these pages), start your journey at the `<micr-io>`
 * element definition: {@link HTMLMicrioElement}
 * 
 * Main documentation page: https://doc.micr.io/ .
 *
 * Visit https://doc.micr.io/client/embedding.html for documentation on how to embed
 * it inside your own website.
 * 
 * See https://doc.micr.io/client/v6/js-api.html for how to use Micrio's internal API, and
 * https://doc.micr.io/client/v6/tutorials/js.html for a tutorial.
 * 
 * For version change logs, see https://github.com/Q42/Micrio.Client/releases
 *
 * @category Micrio
 * @module Micrio
 * @author Marcel Duin <marcel@micr.io>
 *
*/

import { HTMLMicrioElement } from '$core/element'; // Import the main custom element class
import { VERSION } from '$core/version'; // Import the library version string
import '$layout/main'; // Import and register the root UI custom element

// Assign the version string to the custom element class for static access.
HTMLMicrioElement.VERSION = VERSION;

// Define the custom HTML element <micr-io> using the prepared class.
// This makes the element available for use in HTML.
customElements.define('micr-io', HTMLMicrioElement);

// Log a styled message to the console indicating the library version and website.
console.info('%c\u25C8' + '%c Micrio' + ' %cv'+VERSION+' - https://micr.io/', 'color: #00d4ee', 'color: #c5ff5b', 'color: inherit');
