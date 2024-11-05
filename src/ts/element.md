
# The main Micrio HTML element

The main `<micr-io>` controller instance, which extends a basic `HTMLElement`.

This controls all necessary rendering components and images to display.

Creating a Micrio element is easy:

```html
<micr-io id="{your image ID}"></micr-io>
```

## Attribute settings
You can customize the Micrio behavior by setting its HTML element attributes.
These will be parsed to a {@link Models.ImageInfo.ImageInfo} JSON object, and overwrite any values
received from the server.


### Image info
| Attribute   | Description | Default value |
| ----------- | ----------- | ------------- |
| `id` | The image id, required | |
| `width` | The image original width, optional when ID is specified | `auto` |
| `height` | The image original height, optional when ID is specified | `auto` |


### General options

| Attribute   | Description | Default value |
| ----------- | ----------- | ------------- |
| `lang` | The primary data language code | `en` |
| `lazyload` | Initialize the image when the element scrolls into the view | `false` |
| `data-path` | The image bath path URI | depends on image version |
| `data-force-path` | Force `info.json` calls to be from the `data-path` parameter | `false` |
| `data-skipmeta` | Don't download image data (markers, tours, etc) | `false` |
| `data-gtag` | Uses Google Analytics for sending user events, if available | `true` |


### Display options

| Attribute   | Description | Default value |
| ----------- | ----------- | ------------- |
| `data-focus` | The image opening focal point coordinates `x, y` | `0.5, 0.5` |
| `data-view` | The image opening {@link View} | `0, 0, 1, 1` |
| `data-zoomlimit` | The zoom limit (1=100% of original) | `1` |
| `data-coverlimit` | Limit the viewport to always fill the screen | `false` |
| `data-inittype` | The starting viewport, `cover` filling the screen | The full image |
| `data-is360` | Render the image as 360&deg; | `auto` |
| `data-normalize-dpr` | Users with high DPI screens can zoom in as far as regular screens | `true` |


### User input events and behavior

| Attribute   | Description | Default value |
| ----------- | ----------- | ------------- |
| `data-events` | Enable or disable user input events | `true` |
| `data-keys` | Enable keyboard camera navigation controls | `false` |
| `data-zooming` | Allow the user to zoom | `true` |
| `data-scroll-zoom` | Allow the user to use the mousewheel to zoom | `true` |
| `data-pinch-zoom` | Allow the user to use touch pinching to zoom | `true` |
| `data-dragging` | Allow the user to pan the image by dragging it | `true` |
| `data-two-finger-pan` | On touch, the users needs to use two fingers to pan the image | `false` |
| `data-control-zoom` | Using a mouse, the user must press `ctrl` or `cmd` to zoom using the scroll wheel | `false` |
| `data-camspeed` | Default camera animation speed | `1` |
| `data-freemove` | Can pan outside the image's limits | `false` |
| `data-elasticity` | The kinetic dragging elasticity | `1` |


### User interface options

| Attribute   | Description | Default value |
| ----------- | ----------- | ------------- |
| `data-ui` | Enables the HTML UI. Set to `markers` to only show markers, or `none` for zero HTML | `true` |
| `data-controls` | Shows control buttons on the bottom right | `true` |
| `data-social` | Put social sharing icons in the control buttons | `true` |
| `data-fullscreen` | Place a fullscreen switch on the bottom right | `true` |
| `data-logo` | Shows the Micrio logo on the top left | `true` |
| `data-logo-org` | Shows the custom organisation logo on the top right | `true` |
| `data-toolbar` | Prints the toolbar at the top | `true` |
| `data-show-info` | Shows the image info panel if available at the bottom left | `true` |
| `data-minimap` | Show the minimap | `true` |
| `data-minimap-hide` | Autohide the minimap when zoomed out fully | `true` |
| `data-minimap-height` | The maximum minimap width in pixels | `200` |
| `data-minimap-width` | The maximum minimap height in pixels | `160` |


### Audio options

| Attribute   | Description | Default value |
| ----------- | ----------- | ------------- |
| `muted` | Mute all positional audio and music in the image | `false` |
| `volume` | The default positional audio and music volume | `1` |
| `data-musicvolume` | The default music volume | `1` |
| `data-mutedvolume` | The volume to fade positional audio and music to when muted | `0` |

