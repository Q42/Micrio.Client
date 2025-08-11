# ResizableArea Component Usage Example

## Overview

The `ResizableArea` component provides an interactive, resizable circular/elliptical overlay that follows pan and zoom transformations in Micrio images. This component is perfect for creating selection tools, region-of-interest markers, or annotation areas.

## Basic Usage

```svelte
<script>
  import ResizableArea from './src/svelte/components/ResizableArea.svelte';
  import ResizableAreaDemo from './src/svelte/components/ResizableAreaDemo.svelte';
  
  // Get the current Micrio image instance
  const image = micrio.$current;
  
  // Area state
  let areaData = {
    centerX: 0.5,
    centerY: 0.5, 
    width: 0.2,
    height: 0.2
  };
  
  function handleAreaUpdate(newArea) {
    areaData = newArea;
    console.log('Area updated:', newArea);
    
    // You can save this data, send to server, etc.
    saveAreaToServer(newArea);
  }
</script>

<!-- Basic implementation -->
<ResizableArea
  {image}
  centerX={areaData.centerX}
  centerY={areaData.centerY}
  width={areaData.width}
  height={areaData.height}
  onUpdate={handleAreaUpdate}
/>

<!-- Demo with controls -->
<ResizableAreaDemo {image} />
```

## Integration with Main.svelte

To integrate into the main Micrio component, add to `Main.svelte`:

```svelte
<!-- In the template section, after existing overlays -->
{#if $current && showResizableArea}
  <ResizableArea
    image={$current}
    centerX={areaSettings.centerX}
    centerY={areaSettings.centerY}
    width={areaSettings.width}
    height={areaSettings.height}
    lockAspectRatio={areaSettings.lockAspectRatio}
    visible={areaSettings.visible}
    onUpdate={handleAreaUpdate}
  />
{/if}
```

## Advanced Configuration

```svelte
<ResizableArea
  {image}
  centerX={0.3}
  centerY={0.4}
  width={0.25}
  height={0.15}
  minSize={0.05}
  maxSize={0.6}
  lockAspectRatio={true}
  class="custom-area"
  visible={true}
  onUpdate={(area) => {
    // Handle updates
    console.log('Area changed:', area);
    
    // Example: Trigger analytics
    micrio.analytics?.track('area_modified', {
      centerX: area.centerX,
      centerY: area.centerY,
      width: area.width,
      height: area.height,
      area: area.width * area.height
    });
    
    // Example: Update URL hash
    const hash = `#area=${area.centerX},${area.centerY},${area.width},${area.height}`;
    window.history.replaceState(null, '', hash);
  }}
/>
```

## Custom Styling

The component supports custom styling through CSS classes:

```css
/* Custom area styling */
.custom-area .resizable-area {
  border-color: rgba(255, 0, 100, 0.8);
  background: rgba(255, 0, 100, 0.1);
  border-width: 3px;
}

.custom-area .resize-handle {
  background: rgba(255, 0, 100, 0.9);
  border-color: white;
  width: 10px;
  height: 10px;
}

.custom-area .resizable-area:hover {
  border-color: rgba(255, 0, 100, 1);
  background: rgba(255, 0, 100, 0.2);
}
```

## API Reference

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `image` | `MicrioImage` | required | The Micrio image instance |
| `centerX` | `number` | `0.5` | Center X coordinate (0-1) |
| `centerY` | `number` | `0.5` | Center Y coordinate (0-1) |
| `width` | `number` | `0.2` | Width relative to image (0-1) |
| `height` | `number` | `0.2` | Height relative to image (0-1) |
| `minSize` | `number` | `0.05` | Minimum size constraint |
| `maxSize` | `number` | `0.8` | Maximum size constraint |
| `lockAspectRatio` | `boolean` | `false` | Lock aspect ratio during resize |
| `class` | `string` | `''` | Additional CSS class |
| `visible` | `boolean` | `true` | Whether area is visible |
| `onUpdate` | `function` | `undefined` | Callback for area changes |

### Events

The `onUpdate` callback receives an object with the current area state:

```typescript
interface AreaState {
  centerX: number;  // Center X (0-1)
  centerY: number;  // Center Y (0-1) 
  width: number;    // Width (0-1)
  height: number;   // Height (0-1)
}
```

## Use Cases

1. **Region of Interest Selection**: Allow users to select areas for detailed analysis
2. **Crop Tool**: Provide cropping functionality for image editing
3. **Annotation Areas**: Mark specific regions for comments or metadata
4. **Focus Areas**: Highlight important regions in educational content
5. **Measurement Tool**: Combined with scale data, measure real-world areas
6. **Search/Filter**: Select areas to search for similar content

## Integration with Micrio Features

### With Markers
```svelte
<!-- Show markers only within the selected area -->
{#if marker.x >= areaState.centerX - areaState.width/2 && 
     marker.x <= areaState.centerX + areaState.width/2 &&
     marker.y >= areaState.centerY - areaState.height/2 && 
     marker.y <= areaState.centerY + areaState.height/2}
  <Marker {marker} {image} />
{/if}
```

### With Tours
```svelte
<!-- Create a tour step that includes the area -->
const tourStep = {
  view: [
    areaState.centerX - areaState.width/2,
    areaState.centerY - areaState.height/2, 
    areaState.centerX + areaState.width/2,
    areaState.centerY + areaState.height/2
  ],
  // ... other step properties
};
```

### With Analytics
```javascript
// Track area usage
micrio.addEventListener('area_created', (e) => {
  const { area } = e.detail;
  analytics.track('area_tool_used', {
    area_size: area.width * area.height,
    position: [area.centerX, area.centerY],
    image_id: micrio.$current.id
  });
});
```

## Browser Support

The component uses modern web APIs:
- Pointer Events (good support across modern browsers)
- CSS Grid and Flexbox
- ES6+ JavaScript features

For older browser support, consider polyfills for Pointer Events.

## Performance Notes

- The component automatically subscribes to view changes and updates positions accordingly
- Coordinate transformations are efficient and cached where possible
- Resize handles are hidden on very small sizes to improve performance
- Touch interactions are optimized for mobile devices

## Accessibility

- The area is keyboard accessible (tab to focus, arrow keys to move)
- Proper ARIA roles and labels are applied
- High contrast resize handles for visibility
- Screen reader compatible