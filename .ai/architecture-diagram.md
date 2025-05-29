graph TD

%% Add legend and explanations
subgraph Legend
    direction LR
    A[Component]:::component -->|Data Flow| B[Component]
    C[Component] -->|Event| D[Component]
    E[Layer]:::layer
end

classDef component fill:#e6f7ff,stroke:#1890ff
classDef layer fill:#f9f7ff,stroke:#722ed1

subgraph "Browser Layer"
    HTML[index.html] --> CustomElement["<micr-io>"]
    BrowserEvents["Browser Events"] --> TSEvents["ts/events.ts<br>Events"]
    BrowserAPIs["Browser APIs"] --> WebGLController
    BrowserAPIs --> CanvasController
    BrowserAPIs --> TSEvents
end

    subgraph Data
        InfoJSON["info.json<br>(ImageInfo)"]
        DataJSON["pub.json / data.[lang].json<br>(ImageData)"]
        WasmBinary["micrio.wasm"]
        TileImages["Image Tiles (JPG/WebP/PNG)"]
        ArchiveBin[".bin Archive (Optional)"]
    end

    subgraph "TypeScript Layer"
        CustomElement --> Element["ts/element.ts<br>HTMLMicrioElement"]
        
        Element --> WasmController["ts/wasm.ts<br>Wasm"]
        Element --> WebGLController["ts/webgl.ts<br>WebGL"]
        Element --> TSEvents
        Element --> StateMain["ts/state.ts<br>State.Main"]
        Element --> CanvasController["ts/canvas.ts<br>Canvas"]
        Element --> Router["ts/router.ts<br>Router"]
        Element --> Analytics["ts/analytics.ts<br>GoogleTag"]
        Element --> Utils["ts/utils.ts"]
        Element --> Globals["ts/globals.ts"]
        Element -- Manages --> ImageInstances("MicrioImage[]<br>canvases")

        ImageInstances -- Contains --> MicrioImage["ts/image.ts<br>MicrioImage"]
        MicrioImage -- Uses --> ImageInfoStore["info Store"]
        MicrioImage -- Uses --> ImageDataStore["data Store"]
        MicrioImage -- Uses --> SettingsStore["settings Store"]
        MicrioImage -- "Has a" --> TSCamera["ts/camera.ts<br>Camera"]
        MicrioImage -- "Has a" --> StateImage["ts/state.ts<br>State.Image"]
        MicrioImage -- "Interacts with" --> WasmController

        Utils --> InfoJSON
        Utils --> DataJSON
        Utils --> ArchiveBin

        ImageInfoStore -- "Loaded from" --> InfoJSON
        ImageDataStore -- "Loaded from" --> DataJSON

        WasmController --> WasmBinary
        TSEvents --> Element
        StateMain -- Manages --> StateImage
        Router --> BrowserEvents["URL Hash Change"]

        Element -- Mounts --> SvelteMain["svelte/Main.svelte"]
    end

    subgraph "Svelte Layer"
        SvelteMain -- "Uses Context" --> Element
        SvelteMain -- Renders --> SvelteToolbar["Toolbar"]
        SvelteMain -- Renders --> SvelteControls["Controls"]
        SvelteMain -- Renders --> SvelteMarkers["Markers"]
        SvelteMain -- Renders --> SvelteMinimap["Minimap"]
        SvelteMain -- Renders --> SveltePopup["MarkerPopup"]
        SvelteMain -- Renders --> SveltePopover["Popover"]
        SvelteMain -- Renders --> SvelteTour["Tour"]
        SvelteMain -- Renders --> SvelteEmbed["Embed"]
        SvelteMain -- Renders --> SvelteAudio["AudioController"]
        SvelteMain -- Renders --> SvelteGallery["Gallery"]
        SvelteMain -- Renders --> SvelteMedia["Media"]
        SvelteMain -- Renders --> SvelteUI["UI Components"]

        SvelteToolbar --> SvelteMenu["Menu"]
        SvelteMarkers --> SvelteMarker["Marker"]
        SvelteMarkers --> SvelteWaypoint["Waypoint"]
        SveltePopup --> SvelteMarkerContent["MarkerContent"]
        SvelteMarkerContent --> SvelteMedia
        SvelteMarkerContent --> SvelteArticle["Article"]
        SvelteTour --> SvelteSerialTour["SerialTour"]
        SvelteTour --> SvelteMediaControls["MediaControls"]
        SvelteEmbed --> MicrioImage
        SvelteEmbed --> SvelteMedia
        SvelteAudio --> SvelteAudioLoc["AudioLocation"]
        SvelteAudio --> SvelteAudioPlaylist["AudioPlaylist"]

        SvelteMain --> StateMain
        SvelteMain --> StateImage
        SvelteMain --> ImageInfoStore
        SvelteMain --> ImageDataStore
        SvelteMain --> SettingsStore

        SvelteControls --> TSCamera
        SvelteControls --> Element
        SvelteControls --> BrowserAPIs
        SvelteMarkers --> ImageDataStore
        SvelteMarkers --> StateImage
        SvelteMarker --> StateImage
        SveltePopup --> StateImage
        SveltePopup --> StateMain
        SvelteTour --> StateMain
        SveltePopover --> StateMain
    end

    subgraph "WASM Layer"
        WasmController -- "Loads & Interacts" --> WasmMain["main.ts<br>Main"]
        
        WasmMain -- Manages --> WasmCanvasInstances("Canvas[]")
        WasmCanvasInstances -- Contains --> WasmCanvas["canvas.ts<br>Canvas"]
        WasmCanvas -- Manages --> WasmImageInstances("Image[]")
        WasmCanvas -- "Has a" --> WasmCamera["camera.ts<br>Camera (2D)"]
        WasmCanvas -- "Has a" --> WasmWebGL["webgl.ts<br>WebGL (360)"]
        WasmCanvas -- "Has a" --> WasmAni["camera.ani.ts<br>Ani"]
        WasmCanvas -- "Has a" --> WasmKinetic["camera.kinetic.ts<br>Kinetic"]
        WasmImageInstances -- Contains --> WasmImage["image.ts<br>Image"]
        WasmImage -- Manages --> WasmLayer["Layer[]"]
        
        WasmWebGL --> WasmMat["webgl.mat.ts<br>Mat4, Vec4"]
        WasmAni --> WasmUtils["utils.ts<br>Bicubic"]
        
        WasmMain -- "Calls JS" --> DrawTile["JS: drawTile"]
        WasmMain -- "Calls JS" --> AniDone["JS: aniDone"]
        WasmMain -- "Calls JS" --> ViewSet["JS: viewSet"]
        WasmMain -- "Calls JS" --> ViewportSet["JS: viewportSet"]
        
        WasmController --> WasmExports["exports.ts<br>Exports"]
        WasmExports --> WasmMain
        WasmExports --> WasmCanvas
        WasmExports --> WasmCamera
        WasmExports --> WasmWebGL
        WasmExports --> WasmAni
        WasmExports --> WasmKinetic
        
        DrawTile --> TileImages
        DrawTile --> WebGLController
    end

%% Layer Explanations
subgraph Layer Explanations
    BrowserLayer["**Browser Layer**: Handles DOM rendering, user events, and browser API access"]
    TSLayer["**TypeScript Layer**: Manages core application logic, state, and WASM integration"]
    SvelteLayer["**Svelte Layer**: Implements UI components and user interactions"]
    WASMLayer["**WASM Layer**: Handles performance-critical operations and complex calculations"]
end

%% Key Interactions
subgraph Key Interactions
    BrowserToTS["Browser Events → TypeScript: User input handling"]
    TSToWASM["TypeScript → WASM: Offload heavy computations"]
    WASMToBrowser["WASM → Browser: Rendering instructions"]
    SvelteToTS["Svelte → TypeScript: State updates"]
end
