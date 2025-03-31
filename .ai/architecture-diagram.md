graph TD
    subgraph "Browser / HTML"
        HTML[index.html] --> CustomElement["<micr-io>"]
        BrowserEvents["Browser Events (Mouse, Touch, Keyboard, Resize)"] --> TSEvents["ts/events.ts<br>Events"]
        BrowserAPIs["Browser APIs (WebGL, Web Audio, Fetch, Fullscreen, Share)"]
    end

    subgraph Data
        InfoJSON["info.json<br>(ImageInfo)"]
        DataJSON["pub.json / data.[lang].json<br>(ImageData)"]
        WasmBinary["micrio.wasm"]
        TileImages["Image Tiles (JPG/WebP/PNG)"]
        ArchiveBin[".bin Archive (Optional)"]
    end

    subgraph "Core TypeScript Layer"
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
        MicrioImage -- Uses --> ImageInfoStore["info Store<br>(Models.ImageInfo)"]
        MicrioImage -- Uses --> ImageDataStore["data Store<br>(Models.ImageData)"]
        MicrioImage -- Uses --> SettingsStore["settings Store<br>(Models.ImageInfo.Settings)"]
        MicrioImage -- "Has a" --> TSCamera["ts/camera.ts<br>Camera"]
        MicrioImage -- "Has a" --> StateImage["ts/state.ts<br>State.Image"]
        MicrioImage -- "Interacts with" --> WasmController

        Utils --> InfoJSON
        Utils --> DataJSON
        Utils --> ArchiveBin

        ImageInfoStore -- "Loaded from" --> InfoJSON
        ImageDataStore -- "Loaded from" --> DataJSON

        WasmController --> WasmBinary
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

    subgraph "WebAssembly Layer (src/wasm)"
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

        WasmWebGL -- Uses --> WasmMat["webgl.mat.ts<br>Mat4, Vec4"]
        WasmAni -- Uses --> WasmUtils["utils.ts<br>Bicubic"]

        WasmMain -- "Calls JS" --> DrawTile["JS: drawTile(...)"]
        WasmMain -- "Calls JS" --> AniDone["JS: aniDone(...)"]
        WasmMain -- "Calls JS" --> ViewSet["JS: viewSet(...)"]
        WasmMain -- "Calls JS" --> ViewportSet["JS: viewportSet(...)"]

        WasmController -- Calls --> WasmExports["exports.ts<br>Exported Functions"]
        WasmExports -- Calls --> WasmMain
        WasmExports -- Calls --> WasmCanvas
        WasmExports -- Calls --> WasmCamera
        WasmExports -- Calls --> WasmWebGL
        WasmExports -- Calls --> WasmAni
        WasmExports -- Calls --> WasmKinetic

        DrawTile --> TileImages
        DrawTile --> WebGLController["WebGL Rendering"]
    end
