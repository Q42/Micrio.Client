# Micrio Client Architecture

## 1. Overview

The Micrio client is a high-performance web component (`<micr-io>`) for displaying deeply zoomable images and interactive content. It's built primarily using:

*   **TypeScript:** For the core application logic, component orchestration, and interactions.
*   **Svelte 5:** For building the reactive user interface components.
*   **Pure TypeScript Compute Engine (`src/engine/`):** Replaces the previous AssemblyScript/WebAssembly layer. Handles performance-critical tasks like rendering calculations, camera math, tile pyramid management, and animation interpolation.
*   **WebGL:** For rendering tiled images, 360-degree panoramas, and embedded elements efficiently.

## 2. Core Layers

The application is structured into three main layers:

### Core TypeScript Layer (`src/ts/`)

This layer acts as the central orchestrator, managed primarily by the `HTMLMicrioElement` class (`element.ts`) which defines the `<micr-io>` custom element. Its responsibilities include:

*   Initializing and managing the lifecycle of the web component.
*   Loading and managing one or more `MicrioImage` instances (`image.ts`), each representing a viewable image and its associated data/state.
*   Hosting the compute engine via the `Engine` controller (`render/engine.ts`), which bridges the engine to DOM/WebGL.
*   Managing the WebGL context and rendering pipeline via the `WebGL` controller (`render/webgl.ts`).
*   Handling user input events via the `Events` controller (`events.ts`).
*   Managing global application state (`State.Main` in `state.ts`).
*   Mounting and providing data to the Svelte UI layer.
*   Handling routing (`router.ts`) and analytics (`analytics.ts`).

*For more details, see [.ai/app-analysis.md](.ai/app-analysis.md)*

### Svelte UI Layer (`src/svelte/`)

This layer is responsible for rendering the user interface. It's built with Svelte 5 components organized into `common/`, `components/`, `ui/`, and `virtual/` directories.

*   The root component is `Main.svelte`, which orchestrates the display of all other UI elements.
*   Components react to changes in the application state (managed by `State.Main` and `State.Image` from the TS layer) and image data/settings stores.
*   It provides UI elements like the toolbar, control buttons, minimap, marker popups, tour controls, galleries, and popovers.
*   "Virtual" components often handle complex logic tightly coupled with the core TS/engine layers (e.g., `virtual/Markers.svelte` manages marker rendering logic, `virtual/Tour.svelte` manages tour playback UI).

*For more details, see [.ai/svelte-analysis.md](.ai/svelte-analysis.md)*

### Compute Engine Layer (`src/engine/`)

A pure-TypeScript compute core that replaced the previous WebAssembly/AssemblyScript layer. Organized into logical subdirectories:

| Directory | Contents | Purpose |
|-----------|----------|---------|
| `engine/main.ts` | `Main` class | Root controller: owns canvases, render loop, host callbacks |
| `engine/globals.ts` | Constants | Shared math constants and segmentation parameters |
| `engine/camera/` | `Camera`, `Ani`, `Kinetic` | 2D camera math, bezier-curve animations, inertia scrolling |
| `engine/canvas/` | `TileCanvas`, `Image` | Tile-rendering surface, tile pyramid and layer management |
| `engine/webgl/` | `SphericalView`, `Mat4`, `Vec4` | 360 spherical camera, 4x4 matrix/4D vector math |
| `engine/shared/` | `View`, `Coordinates`, `Viewport`, `DrawRect` | Shared data structures with zero-copy Float64Array views |
| `engine/utils/` | `Bicubic`, easing functions | Cubic bezier easing curves and math utilities |

*   Managed by the `Engine` class (`ts/render/engine.ts`).
*   Performs camera math, view transformations, coordinate conversions (2D & 360).
*   Calculates which image tiles are needed for the current view.
*   Steps through camera animations frame-by-frame.
*   Handles 360-degree rendering logic and matrix calculations.
*   Communicates with the host via callbacks set on `Main` for requesting tile draws or signaling animation completion.
*   The public `Camera` API (`ts/camera.ts`) holds a direct reference to its engine `TileCanvas` for zero-overhead compute calls.

*For more details, see [.ai/wasm-analysis.md](.ai/wasm-analysis.md)*

## 3. Data Flow & Models

The application primarily uses two data models, defined in `src/types/models.ts`:

*   **`ImageInfo`:** Static image metadata (dimensions, type, settings). Usually loaded from `info.json`.
*   **`ImageData`:** Dynamic, language-specific content (markers, tours, embeds, pages). Usually loaded from `pub.json` (V5+) or `data.[lang].json` (V4).

Data is typically fetched using the browser's Fetch API (`ts/utils.ts`). Optional binary archives (`.bin`) can be used for pre-packaged gallery thumbnails or omni-object base layers.

## 4. Architecture Diagram

```mermaid
graph TD
    subgraph "Browser / HTML"
        HTML[index.html] --> CustomElement["<micr-io>"]
        BrowserEvents["Browser Events (Mouse, Touch, Keyboard, Resize)"] --> TSEvents["ts/events.ts<br>Events"]
        BrowserAPIs["Browser APIs (WebGL, Web Audio, Fetch, Fullscreen, Share)"]
    end

    subgraph Data
        InfoJSON["info.json<br>(ImageInfo)"]
        DataJSON["pub.json / data.[lang].json<br>(ImageData)"]
        TileImages["Image Tiles (JPG/WebP/PNG)"]
        ArchiveBin[".bin Archive (Optional)"]
    end

    subgraph "Core TypeScript Layer"
        CustomElement --> Element["ts/element.ts<br>HTMLMicrioElement"]

        Element --> EngineController["ts/render/engine.ts<br>Engine"]
        Element --> WebGLController["ts/render/webgl.ts<br>WebGL"]
        Element --> TSEvents
        Element --> StateMain["ts/state.ts<br>State.Main"]
        Element --> CanvasController["ts/render/canvas.ts<br>Canvas"]
        Element --> Router["ts/nav/router.ts<br>Router"]
        Element --> Analytics["ts/analytics.ts<br>GoogleTag"]
        Element --> Utils["ts/utils.ts"]
        Element --> Globals["ts/globals.ts"]
        Element -- Manages --> ImageInstances("MicrioImage[]<br>canvases")

        ImageInstances -- Contains --> MicrioImage["ts/image.ts<br>MicrioImage"]
        MicrioImage -- Uses --> ImageInfoStore["info Store<br>(Models.ImageInfo)"]
        MicrioImage -- Uses --> ImageDataStore["data Store<br>(Models.ImageData)"]
        MicrioImage -- Uses --> SettingsStore["settings Store<br>(Models.ImageInfo.Settings)"]
        MicrioImage -- "Has a" --> TSCamera["ts/camera.ts<br>Camera"]
        MicrioImage -- "Has a" --> StateImage["ts/state.ts<br>State.Image"]
        MicrioImage -- "Interacts with" --> EngineController

        Utils --> InfoJSON
        Utils --> DataJSON
        Utils --> ArchiveBin

        ImageInfoStore -- "Loaded from" --> InfoJSON
        ImageDataStore -- "Loaded from" --> DataJSON

        EngineController --> EngineCompute["engine/Main + TileCanvas + Camera"]
        WebGLController --> BrowserAPIs
        TSEvents --> Element
        StateMain -- Manages --> StateImage
        Router --> BrowserEvents["URL Hash Change"]

        Element -- Mounts --> SvelteMain["svelte/Main.svelte"]
    end

    subgraph "Svelte UI Layer"
        SvelteMain -- "Uses Context" --> Element
        SvelteMain -- Renders --> SvelteToolbar["components/Toolbar.svelte"]
        SvelteMain -- Renders --> SvelteControls["common/Controls.svelte"]
        SvelteMain -- Renders --> SvelteMarkers["virtual/Markers.svelte"]
        SvelteMain -- Renders --> SvelteMinimap["components/Minimap.svelte"]
        SvelteMain -- Renders --> SveltePopup["components/MarkerPopup.svelte"]
        SvelteMain -- Renders --> SveltePopover["components/Popover.svelte"]
        SvelteMain -- Renders --> SvelteTour["virtual/Tour.svelte"]
        SvelteMain -- Renders --> SvelteEmbed["virtual/Embed.svelte"]
        SvelteMain -- Renders --> SvelteAudio["virtual/AudioController.svelte"]
        SvelteMain -- Renders --> SvelteGallery["common/Gallery.svelte"]
        SvelteMain -- Renders --> SvelteMedia["components/Media.svelte"]
        SvelteMain -- Renders --> SvelteUI["ui/* (Buttons, Icons, etc)"]

        SvelteToolbar -- Uses --> SvelteMenu["components/Menu.svelte"]
        SvelteMarkers -- Uses --> SvelteMarker["virtual/Marker.svelte"]
        SvelteMarkers -- Uses --> SvelteWaypoint["components/Waypoint.svelte"]
        SveltePopup -- Uses --> SvelteMarkerContent["common/MarkerContent.svelte"]
        SvelteMarkerContent -- Uses --> SvelteMedia
        SvelteMarkerContent -- Uses --> SvelteArticle["common/Article.svelte"]
        SvelteTour -- Uses --> SvelteSerialTour["virtual/SerialTour.svelte"]
        SvelteTour -- Uses --> SvelteMediaControls["components/MediaControls.svelte"]
        SvelteEmbed -- Uses --> MicrioImage
        SvelteEmbed -- Uses --> SvelteMedia
        SvelteAudio -- Uses --> SvelteAudioLoc["virtual/AudioLocation.svelte"]
        SvelteAudio -- Uses --> SvelteAudioPlaylist["virtual/AudioPlaylist.svelte"]

        SvelteMain -- Reads --> StateMain
        SvelteMain -- Reads --> StateImage
        SvelteMain -- Reads --> ImageInfoStore
        SvelteMain -- Reads --> ImageDataStore
        SvelteMain -- Reads --> SettingsStore

        SvelteControls -- Calls --> TSCamera
        SvelteControls -- Calls --> Element["Fullscreen API"]
        SvelteControls -- Calls --> BrowserAPIs["Share API"]
        SvelteMarkers -- Reads --> ImageDataStore
        SvelteMarkers -- Reads --> StateImage["view Store"]
        SvelteMarker -- Calls --> StateImage["marker Store"]
        SveltePopup -- Calls --> StateImage["marker Store"]
        SveltePopup -- Calls --> StateMain["tour Store"]
        SvelteTour -- "Reads/Writes" --> StateMain["tour Store"]
        SveltePopover -- "Reads/Writes" --> StateMain["popover Store"]
    end

    subgraph "Compute Engine Layer (src/engine)"
        EngineController -- "Hosts & Bridges" --> EngineMain["main.ts<br>Main"]

        EngineMain -- Manages --> EngineCanvases("TileCanvas[]")
        EngineCanvases -- Contains --> EngineCanvas["canvas/canvas.ts<br>TileCanvas"]
        EngineCanvas -- Manages --> EngineImages("Image[]")
        EngineCanvas -- "Has a" --> EngineCamera["camera/camera.ts<br>Camera (2D)"]
        EngineCanvas -- "Has a" --> EngineWebGL["webgl/webgl.ts<br>SphericalView (360)"]
        EngineCanvas -- "Has a" --> EngineAni["camera/ani.ts<br>Ani"]
        EngineCanvas -- "Has a" --> EngineKinetic["camera/kinetic.ts<br>Kinetic"]
        EngineImages -- Contains --> EngineImage["canvas/image.ts<br>Image"]
        EngineImage -- Manages --> EngineLayer["Layer[]"]

        EngineWebGL -- Uses --> EngineMat["webgl/mat.ts<br>Mat4, Vec4"]
        EngineAni -- Uses --> EngineUtils["utils/utils.ts<br>Bicubic"]

        EngineMain -- "Calls host" --> DrawTile["drawTile(...)"]
        EngineMain -- "Calls host" --> AniDone["aniDone(...)"]
        EngineMain -- "Calls host" --> ViewSet["viewSet(...)"]
        EngineMain -- "Calls host" --> ViewportSet["viewportSet(...)"]

        TSCamera -- "Direct calls" --> EngineCanvas
        TSCamera -- "Direct calls" --> EngineCamera
        TSCamera -- "Direct calls" --> EngineWebGL
        TSCamera -- "Direct calls" --> EngineAni
        TSCamera -- "Direct calls" --> EngineKinetic

        DrawTile --> TileImages
        DrawTile --> WebGLController["WebGL Rendering"]
    end
```

## 5. Key Interactions

*   **TS Core <-> Compute Engine:** The `Engine` controller (`ts/render/engine.ts`) instantiates the engine's `Main` class, wires up host callbacks (drawTile, drawQuad, setMatrix, etc.), and drives the render loop. The public `Camera` class (`ts/camera.ts`) holds a direct reference to its engine `TileCanvas` for zero-overhead compute calls — there is no intermediate proxy layer. The engine calls back into the host via callbacks to request tile drawing, report animation completion, or update viewport state.
*   **TS Core <-> Svelte UI:** The `HTMLMicrioElement` mounts the root Svelte component (`Main.svelte`) and passes itself down via Svelte's context API. Svelte components access core functionality and state through this context (e.g., `micrio.state`, `micrio.current`, `micrio.open()`). State changes are propagated reactively using Svelte stores managed within the TS layer (`ts/state.ts`). UI events often trigger methods on the `micrio` instance or update its state stores.
