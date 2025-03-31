# Micrio Svelte Component Analysis

This document analyzes the structure and functionality of the Svelte components used in the Micrio client application (`src/svelte/`), optimized for AI assistant understanding. The components are organized into `common/`, `components/`, `ui/`, and `virtual/` directories.

## Root Component (`Main.svelte`)

*   **Purpose:** The main entry point for the Svelte UI, mounted within the `<micr-io>` custom element. Orchestrates the rendering of all other UI elements.
*   **Props:**
    *   `micrio`: The `HTMLMicrioElement` instance.
    *   `noHTML`: Boolean, if true, suppresses rendering of most UI elements (except markers if `data-ui="markers"`).
    *   `noLogo`: Boolean, suppresses Micrio logo.
    *   `loadingProgress`: Number (0-1), displays loading indicator.
    *   `error`: String, displays error message if present.
*   **Context:**
    *   Provides the `micrio` instance via `setContext('micrio', micrio)`.
    *   Provides a `WeakMap` (`markerImages`) to link markers back to their parent `MicrioImage`.
    *   Provides global `volume` and `mediaPaused` Svelte stores.
    *   Provides an `srt` store for subtitle display.
*   **Functionality:**
    *   Subscribes to `micrio.current` (the active `MicrioImage`) to access its `info`, `data`, and `settings` stores.
    *   Conditionally renders sub-components based on application state (`micrio.state`) and image settings (`$settings`).
    *   Handles auto-starting markers, tours, or pages based on `settings.start`.
    *   Manages the display of:
        *   Logos (`ui/Logo.svelte`, `ui/LogoOrg.svelte`)
        *   Toolbar (`components/Toolbar.svelte`)
        *   Markers (`virtual/Markers.svelte`)
        *   Minimap (`components/Minimap.svelte`)
        *   Main Controls (`common/Controls.svelte`)
        *   Galleries (`common/Gallery.svelte`)
        *   Image Details (`common/Details.svelte`)
        *   Marker Popups (`components/MarkerPopup.svelte`)
        *   Tours (`virtual/Tour.svelte`)
        *   Popovers (`components/Popover.svelte`)
        *   Subtitles (`common/Subtitles.svelte`)
        *   Embeds (`virtual/Embed.svelte`)
        *   Audio (`virtual/AudioController.svelte`, `components/Media.svelte`)
        *   Errors (`common/Error.svelte`)
        *   Loading Indicator (`ui/ProgressCircle.svelte`)

## `common/` Components

*   **`Controls.svelte`**:
    *   **Purpose:** Renders the main control buttons (zoom, fullscreen, mute, language, share) typically in the bottom-right.
    *   **Context:** Uses `micrio` context.
    *   **State:** Subscribes to `micrio.state.ui` stores (`controls`, `zoom`, `hidden`), `micrio.isMuted`, `micrio.current` (for settings), `micrio._lang`.
    *   **Functionality:** Shows/hides buttons based on state and settings (`noZoom`, `fullscreen`, `social`, etc.). Handles language switching UI. Renders separate zoom controls for secondary split-screen images. Uses `navigator.share`.
*   **`Gallery.svelte`**:
    *   **Purpose:** Displays image galleries (swipe, switch, omni modes). Likely uses `swiper.ts`.
    *   **Props:** `images`, `omni`.
    *   **Context:** Uses `micrio` context.
    *   **Functionality:** Renders gallery UI based on type. Handles navigation between images/frames. Interacts with `Omni` settings for 3D object viewing.
*   **`MarkerContent.svelte`**:
    *   **Purpose:** Renders the content *inside* a `MarkerPopup.svelte`.
    *   **Props:** `marker`, `destroying` (store indicating if popup is closing), `noEmbed`, `noImages`, `noGallery`.
    *   **Context:** Uses `micrio`, `markerImages`.
    *   **Functionality:** Displays marker title, body (`Article.svelte`), images (clickable to open gallery popover), audio/video/embeds (`Media.svelte`). Handles media autoplay logic. Dispatches `close` event on media end for tour progression.
*   **`Details.svelte`**:
    *   **Purpose:** Displays image title and description, likely in a modal/popover shown via `settings.showInfo`.
    *   **Props:** `info`, `data`.
*   **`Error.svelte`**:
    *   **Purpose:** Displays an error message overlay.
    *   **Props:** `message`.
*   **`Subtitles.svelte`**:
    *   **Purpose:** Displays subtitles provided via the `srt` context store.
    *   **Props:** `src`, `raised`.

## `components/` Components

*   **`Toolbar.svelte`**:
    *   **Purpose:** Renders the top-left menu bar.
    *   **Context:** Uses `micrio` context.
    *   **State:** Subscribes to `micrio.current` (for `data`), `micrio.state` (`tour`, `marker`, `popover`).
    *   **Functionality:** Dynamically builds menu from `data.pages`, `data.markerTours`, `data.tours`. Uses `Menu.svelte` recursively. Hides when tours/markers/popovers are active. Adapts to mobile layout.
*   **`Menu.svelte`**:
    *   **Purpose:** Renders a single menu item in the toolbar, potentially with children for submenus.
    *   **Props:** `menu` (data object), `originalId`, `on:close`.
    *   **Functionality:** Displays title, handles click actions (open marker, link, run function, toggle submenu). Recursively renders child `Menu.svelte` components.
*   **`MarkerPopup.svelte`**:
    *   **Purpose:** Displays the popup window for an opened marker.
    *   **Props:** `marker`.
    *   **Context:** Uses `micrio`, `markerImages`.
    *   **State:** Subscribes to `micrio.state.tour`.
    *   **Functionality:** Uses `MarkerContent.svelte` to render content. Provides close button (closes marker or advances tour). Conditionally shows tour controls (prev/next). Supports minimization. Manages adding/removing marker-specific embeds.
*   **`Minimap.svelte`**:
    *   **Purpose:** Displays a small overview map showing the current viewport location.
    *   **Props:** `image`.
    *   **Functionality:** Renders a low-resolution version of the image and draws a rectangle representing the current view. Likely interacts with `image.state.view`.
*   **`ZoomButtons.svelte`**:
    *   **Purpose:** Renders zoom-in and zoom-out buttons.
    *   **Props:** `image` (optional, defaults to `$current`).
    *   **Functionality:** Calls `image.camera.zoomIn()` or `image.camera.zoomOut()` on click. Disables buttons at zoom limits.
*   **`Media.svelte`**:
    *   **Purpose:** A versatile component for rendering media (audio, video, YouTube/Vimeo embeds, video tours).
    *   **Props:** `src`, `uuid`, `image`, `tour`, `autoplay`, `controls`, `volume`, `destroying`, `bind:paused`, etc.
    *   **Functionality:** Handles media playback, controls display, autoplay, volume control (via context), synchronization with video tours, subtitle display (`Subtitles.svelte`), and event dispatching (`ended`).
*   **`MediaControls.svelte`**:
    *   **Purpose:** Renders playback controls (play/pause, progress bar, volume, subtitles toggle) for the `Media.svelte` component.
*   **`Popover.svelte`**:
    *   **Purpose:** A generic popover/modal component used for displaying custom pages (`data.pages`), image galleries, or language selection.
    *   **Props:** `popover` (state object defining content).
    *   **Functionality:** Renders content based on the `popover` prop type (e.g., uses `Article.svelte` for pages, `Gallery.svelte` for galleries). Provides a close mechanism.
*   **`Waypoint.svelte`**:
    *   **Purpose:** Renders navigation markers used in 360 tours (`spaceData`).
    *   **Props:** `image`, `targetId`, `settings`.
    *   **Functionality:** Displays an icon at the calculated 3D position. Clicking it likely triggers `micrio.open()` with the `targetId` and vector information.

## `ui/` Components

These are basic, stateless UI elements:

*   `Button.svelte`: Renders a styled button with an icon type.
*   `ButtonGroup.svelte`: Groups buttons together visually.
*   `Dial.svelte`: Renders a rotational dial, likely used for omni-object controls.
*   `Fullscreen.svelte`: Button to toggle fullscreen mode for a given element.
*   `Icon.svelte`: Renders an SVG icon based on a type prop.
*   `Logo.svelte`: Renders the Micrio logo.
*   `LogoOrg.svelte`: Renders the organization logo.
*   `ProgressBar.svelte`: Simple horizontal progress bar.
*   `ProgressCircle.svelte`: Circular loading/progress indicator.

## `virtual/` Components

These components manage complex logic or rendering tied closely to the core engine:

*   **`Markers.svelte`**:
    *   **Purpose:** Manages the rendering and logic for all markers associated with an image. Does *not* render the popups (that's `MarkerPopup.svelte`).
    *   **Props:** `image`.
    *   **Functionality:** Subscribes to `image.data` for marker list. Renders individual `Marker.svelte` and `Waypoint.svelte` components. Handles marker clustering, viewport positioning, "fancy labels" for omni-objects, and marker visibility logic (e.g., in grids).
*   **`Marker.svelte`** (used by `Markers.svelte`):
    *   **Purpose:** Renders a single marker icon/element on the image surface.
    *   **Props:** `marker`, `image`, `coords` (Map), `overlapped`.
    *   **Functionality:** Calculates screen position based on marker coordinates and camera state (subscribes to `image.state.view`). Applies styles (icon, color, size) based on marker data and global settings. Handles click events to set `image.state.marker` (which triggers `MarkerPopup.svelte` via `micrio.state.popup`). Handles hover states (`micrio.state.markerHoverId`).
*   **`Tour.svelte`**:
    *   **Purpose:** Manages the UI and playback logic for active tours (both marker and video tours).
    *   **Props:** `tour` (the active tour object from `micrio.state.tour`), `noHTML`.
    *   **Functionality:** Renders tour-specific controls (play/pause, progress bar for video tours; prev/next for marker tours). Interacts with `VideoTourInstance` or marker tour state (`$tour.next`, `$tour.prev`) to control playback/navigation. Handles tour start/stop/progress updates.
*   **`Embed.svelte`**:
    *   **Purpose:** Manages the rendering and interaction logic for a single embedded element (`data.embeds`).
    *   **Props:** `embed` (data object).
    *   **Functionality:** Creates/manages a child `MicrioImage` instance if the embed is another Micrio image. Renders iframes or uses `Media.svelte` for embedded video/audio. Calculates position/size based on `embed.area` and potentially 360 rotation/scale properties. Handles click actions defined in `embed.clickAction`.
*   **`AudioController.svelte`**:
    *   **Purpose:** Manages background music playlist (`data.music`) and positional audio sources (`data.markers` with `positionalAudio`).
    *   **Props:** `volume`, `data`, `is360`.
    *   **Functionality:** Uses Web Audio API to play/manage audio sources. Adjusts volume based on distance for positional audio. Handles playlist logic (looping, transitions).
*   **`AudioLocation.svelte`** (likely used by `AudioController.svelte`):
    *   **Purpose:** Represents a single positional audio source tied to a marker's location.
*   **`AudioPlaylist.svelte`** (likely used by `AudioController.svelte`):
    *   **Purpose:** Manages the playback of a sequence of audio tracks (background music).
*   **`Events.svelte`**:
    *   **Purpose:** Seems related to handling custom events within video tours (`VideoTourCultureData.events`).
*   **`SerialTour.svelte`** (likely used by `Tour.svelte`):
    *   **Purpose:** Handles the specific UI and logic for multi-chapter "Serial Tours".

This structure separates concerns well, with `virtual/` handling core logic, `components/` building features, `common/` providing complex reusable parts, and `ui/` offering basic blocks. State flows reactively via Svelte stores and context.