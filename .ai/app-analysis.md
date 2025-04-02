# Micrio Client Application Analysis

This document provides an AI-readable analysis of the Micrio client application's architecture, data models, and core functionalities based on the `src/` directory.

## Architecture Overview

The Micrio client is a web component-based application built using TypeScript and Svelte 5 (Runes mode). It leverages WebAssembly (Wasm) for performance-critical rendering and camera calculations, and WebGL for rendering image tiles and embeds.

The core architecture revolves around the `<micr-io>` custom HTML element (`src/ts/element.ts`), which acts as the main orchestrator. This element manages:

1.  **Image Instances:** Handles loading and managing one or more `MicrioImage` instances (`src/ts/image.ts`). Each `MicrioImage` represents a zoomable image (standard, 360, IIIF, omni-object) and encapsulates its specific data, state, and camera.
2.  **WebGL Rendering:** Uses a `WebGL` controller (`src/ts/webgl.ts`) to manage the WebGL context and rendering pipeline.
3.  **WebAssembly Module:** Interacts with a Wasm module (`src/ts/wasm.ts`) for efficient tile calculations, camera transformations, and other intensive tasks.
4.  **State Management:** Employs a Svelte store-based state management system (`src/ts/state.ts`) for both global application state (`State.Main`) and individual image state (`State.Image`).
5.  **UI Rendering:** Mounts and manages the main Svelte UI component (`src/svelte/Main.svelte`).
6.  **Event Handling:** Manages user interactions (mouse, touch, keyboard) via an `Events` controller (`src/ts/events.ts`).
7.  **Camera Control:** Each `MicrioImage` has an associated `Camera` instance (`src/ts/camera.ts`) that handles viewport calculations, animations (zoom, pan, fly-to), and coordinate transformations, often delegating to the Wasm module.

## Data Models (`src/types/models.ts`)

The application uses two primary JSON data structures fetched from the Micrio servers or provided directly:

1.  **`ImageInfo` (`info.json`)**: Contains static, non-language-specific information about an image:
    *   `id`: Unique Micrio image ID.
    *   `width`, `height`: Original image dimensions.
    *   `tileSize`: Size of image tiles.
    *   `path`: Base path for fetching data/tiles.
    *   `is360`, `isWebP`, `isIIIF`, `isDeepZoom`, `format`: Flags indicating image type/format.
    *   `settings`: A nested object containing numerous configuration options for:
        *   Initial view (`view`, `initType`, `focus`).
        *   Navigation limits (`restrict`, `zoomLimit`, `freeMove`).
        *   Camera behavior (`camspeed`, `dragElasticity`).
        *   User interaction hooks (`hookEvents`, `hookKeys`, `hookScroll`, `hookPinch`, `hookDrag`).
        *   UI elements (`noUI`, `fullscreen`, `minimap`, `noLogo`, `noToolbar`, `theme`).
        *   Features like galleries (`gallery`), omni-objects (`omni`), 360 video (`_360`), markers (`_markers`), grids (`grid`).
        *   Audio settings (`audio`, `startVolume`, `muteOnBlur`).
        *   Custom JS/CSS (`js`, `css`).
    *   `organisation`: Optional branding information.
    *   `albumId`: V5+ album identifier.
    *   `revision`: V5+ revision numbers per language for `pub.json`.

2.  **`ImageData` (`pub.json` or `data.[lang].json`)**: Contains dynamic, potentially language-specific content associated with an image:
    *   `i18n`: Language-specific overrides for `title`, `description`, `copyright`.
    *   `markers`: Array of interactive points on the image. Each marker has:
        *   `id`, `x`, `y`: Position and identifier.
        *   `i18n`: Language-specific `title`, `body`, `audio`, `embedUrl`, etc.
        *   `view`: Target viewport when opened.
        *   `type`: Content type (image, audio, video, link, etc.).
        *   `popupType`: How content is displayed (popup, popover, none).
        *   `images`, `audio`, `embedUrl`: Associated media/content.
        *   `data`: Marker-specific settings (custom icon, link behavior, scaling).
    *   `markerTours`: Array of guided tours based on a sequence of markers.
    *   `tours` (Video Tours): Array of timed camera animations, often synced with audio/subtitles.
    *   `embeds`: Array of elements (images, videos, iframes, other Micrio instances) placed within the main image at specific `area`s.
    *   `pages`: Array of custom content pages accessible via the toolbar menu.
    *   `music`: Background audio playlist.

## Core Functionality

*   **Image Loading & Display:** Loads tiled images (Micrio format, DeepZoom, IIIF) and renders them efficiently using WebGL, allowing deep zooming and smooth panning. Supports various image types including standard 2D, 360 panoramas, and multi-frame omni-objects.
*   **Interaction:** Handles user input for navigation (dragging, scrolling/pinching to zoom, keyboard controls) and interaction with UI elements and markers.
*   **Markers:** Displays interactive markers on the image. Clicking markers can trigger actions like zooming to a specific view, showing popups/popovers with rich content (text, images, audio, video, embeds), linking to other Micrio images, or navigating tours.
*   **Tours:** Supports two types of tours:
    *   **Marker Tours:** Step-by-step navigation through a predefined sequence of markers.
    *   **Video Tours:** Timed camera animations synchronized with audio narration and subtitles.
*   **Embeds:** Allows embedding other content (images, videos via `Media` component, iframes, even other Micrio instances) directly within the zoomable image space.
*   **Galleries/Albums:** Supports different modes for displaying collections of images:
    *   **Swipe/Switch:** Navigating between full images.
    *   **Grid:** Displaying multiple images in a configurable grid layout.
    *   **Omni:** Viewing 3D objects captured as a sequence of images, allowing rotation.
*   **UI Components:** Provides a customizable UI (`Main.svelte` and sub-components) including:
    *   Toolbar for accessing tours and custom pages.
    *   Controls for zoom, fullscreen, audio, etc.
    *   Minimap for navigation context.
    *   Popups/Popovers for displaying marker/page content.
    *   Loading indicators and error messages.
*   **State Management & Routing:** Maintains application state (current view, open marker/tour) and supports deep-linking via URL hash routing (`src/ts/router.ts`). Allows saving/restoring the complete application state.
*   **Customization:** Highly configurable through `ImageInfo.settings` and HTML attributes on the `<micr-io>` tag. Supports custom CSS/JS loading and custom UI icons.

## Key Files & Modules

*   `src/ts/main.ts`: Application entry point, defines `<micr-io>` element.
*   `src/ts/element.ts`: Core logic for the `<micr-io>` custom element.
*   `src/ts/image.ts`: Class representing a single Micrio image instance.
*   `src/types/models.ts`: TypeScript definitions for `ImageInfo` and `ImageData`.
*   `src/ts/camera.ts`: Camera logic and viewport control.
*   `src/ts/wasm.ts`: Interface with the WebAssembly module.
*   `src/ts/webgl.ts`: WebGL rendering logic.
*   `src/ts/state.ts`: Application and image state management.
*   `src/ts/events.ts`: User input event handling.
*   `src/ts/router.ts`: URL hash routing for deep-linking.
*   `src/svelte/Main.svelte`: Root Svelte UI component.
*   `src/svelte/components/`: Reusable UI components (Markers, Popups, Minimap, etc.).
*   `src/svelte/virtual/`: Components managing virtual aspects like Tours, Markers logic, Embeds.
*   `src/svelte/ui/`: Basic UI building blocks (Button, Icon, Progress, etc.).
*   `src/ts/utils.ts`: Utility functions (fetching JSON, deep copy, etc.).
*   `src/ts/globals.ts`: Global constants and default settings.