import { atan2, modPI, pyth, mod1 } from './utils'
import { Coordinates, PI, PI2, PIh } from './shared'
import { Vec4, Mat4 } from './webgl.mat'
import Canvas from './canvas'
import { segsX, segsY } from './globals'

/** Handles 360 camera logic, perspective, and related WebGL calculations. */
export default class WebGL {
	// --- Matrices ---
	/** Projection matrix (perspective). Exposed for JS/WebGL use. */
	readonly pMatrix : Mat4 = new Mat4;
	/** Inverse projection matrix (used for coordinate conversions). */
	private readonly iMatrix : Mat4 = new Mat4;
	/** Rotation matrix (used for CSS 3D transforms). */
	private readonly rMatrix : Mat4 = new Mat4;

	// --- Vectors ---
	/** Current camera position offset (used for 360 transitions). */
	readonly position : Vec4 = new Vec4;

	/** Base radius for 360 sphere calculations. */
	radius : f64 = 10;

	/** Current effective scale factor (derived from perspective). */
	scale : f64 = 0;

	// --- 360 Image Aspect Ratio Correction ---
	/** Vertical scaling factor for non-2:1 aspect ratio 360 images. */
	scaleY : f64 = 1;
	/** Vertical offset factor for non-2:1 aspect ratio 360 images. */
	offY : f64 = 0;
	/** Degrees of freedom Y (unused?). */
	dofY : f64 = 1;

	// --- 360 Movement Limits ---
	/** Horizontal rotation limit factor (0 = no limit, 1 = full lock). */
	limitX: f64 = 0;
	/** Vertical rotation limit factor (0 = no limit, 1 = full lock). */
	limitY : f64 = 0;

	// --- 360 Camera Orientation ---
	/** Base yaw offset (incorporates trueNorth setting). */
	baseYaw: f64 = 0;
	/** Current yaw (horizontal rotation) in radians. */
	yaw: f64 = 0;
	/** Current pitch (vertical rotation) in radians. */
	pitch: f64 = 0;

	// --- Perspective / Field of View ---
	/** Default perspective value (field of view equivalent). */
	defaultPerspective : f64 = PIh; // 90deg default FoV
	/** Current perspective value. */
	perspective : f64 = PIh;
	/** Maximum allowed perspective (widest FoV). */
	maxPerspective : f64 = PIh;
	/** Minimum allowed perspective (narrowest FoV / max zoom). */
	minPerspective : f64 = PIh;

	// --- Temporary/Reusable Objects ---
	/** Reusable vector for calculations. */
	readonly vec4: Vec4 = new Vec4();
	/** Reusable coordinates object for conversions. */
	readonly coo: Coordinates = new Coordinates;
	/** Float64Array buffer for 360-degree viewport [centerX, centerY, width, height] for efficient JS access. */
	readonly view360Buffer : Float64Array = new Float64Array(4);


	/** Horizontal offset based on trueNorth setting. */
	offX:number = 0;

	constructor(
		private canvas: Canvas
	) {
		// Calculate initial horizontal offset and base yaw based on trueNorth
		this.offX = .5-this.canvas.trueNorth;
		this.baseYaw = this.offX * PI * 2;

		// Calculate vertical scaling and offset if it's a 360 image with non-standard aspect ratio
		if(this.canvas.is360) {
			this.scaleY = this.canvas.height / (this.canvas.width / 2); // Ratio relative to 2:1
			this.offY = (1 - this.scaleY) / 4; // Vertical offset to center the content
		}
	}

	/** Sets the horizontal and vertical movement limits. */
	setLimits(x:f64, y:f64) : void {
		this.limitX = x; // Horizontal limit factor
		this.limitY = y; // Vertical limit factor
		// Adjust max perspective (widest FoV) based on vertical limit
		this.maxPerspective = PIh;
		if(y > 0) this.maxPerspective = min(this.maxPerspective, this.maxPerspective * y * 1.5); // Heuristic adjustment
		// Re-apply perspective to enforce new limits
		this.setPerspective(this.perspective, true);
	}

	/** Updates the projection and rotation matrices based on current state. */
	update(noPersp:bool = false) : void {
		const c = this.canvas;
		const el = c.el; // Canvas element viewport

		// Update perspective matrix unless explicitly skipped
		if(!noPersp) this.pMatrix.perspective(this.perspective, el.aspect, 0.0001, c.is360 ? 20 : 100);

		if(c.is360) {
			const pM = this.pMatrix;
			// Clamp pitch within +/- 90 degrees
			this.pitch = min(PI/2, max(-PI/2, this.pitch));
			// Apply rotations to the projection matrix
			pM.rotateX(this.pitch);
			pM.rotateY(this.yaw);
			// Apply translation (for 360 transitions)
			pM.translate(this.position.x, this.position.y, this.position.z);

			// --- Calculate Rotation Matrix for CSS 3D ---
			// (Used for positioning HTML elements like markers in 3D space)
			const rM = this.rMatrix;
			rM.perspectiveCss(this.perspective); // Apply simplified perspective
			rM.translate(0,0,el.height/el.ratio/2); // Translate based on element height? Seems odd.
			rM.rotateX(-this.pitch); // Apply inverse pitch
			rM.rotateY(this.yaw); // Apply yaw

			// Store current direction in degrees
			this.coo.direction = (this.yaw / PI * 180) % 360;


		} else { // 2D Canvas
			const v = c.view;
			// Apply 2D translation based on view center and aspect ratio
			this.pMatrix.translate(
				-(v.centerX - .5) * c.aspect, // Horizontal offset
				v.centerY - .5,              // Vertical offset
				-v.height / 2                // Z offset based on view height (simple ortho?)
			);
		}

		// Update the Float32Array representation for WebGL
		this.pMatrix.toArray();
	}

	/* ================== EVENTS ================== */

	/**
	 * Applies rotation based on pixel delta from mouse/touch drag.
	 * @param xPx Horizontal pixel delta.
	 * @param yPx Vertical pixel delta.
	 * @param duration Duration (0 for immediate, non-zero likely unused here).
	 * @param time Current timestamp (performance.now()).
	 */
	rotate(xPx:f64, yPx:f64, duration: f64, time: f64) : void {
		const c = this.canvas;
		// Calculate rotation amount based on pixel delta, canvas size, scale, and perspective
		const fact = max(1, this.perspective); // Rotation sensitivity decreases as FoV narrows
		this.yaw += xPx / c.width / this.scale * PI * 2 * fact;
		this.pitch += yPx / c.height / this.scale * PI * this.scaleY * fact; // Apply vertical aspect correction

		// Wrap yaw around 2*PI
		this.yaw = modPI(this.yaw);

		// Apply pitch and yaw limits if enabled
		if(c.coverLimit || this.limitY > 0) this.limitPitch();
		if(this.limitX > 0) this.limitYaw();

		// Add step to kinetic tracker if it's an immediate rotation (not part of animation)
		if(duration == 0) c.kinetic.addStep(xPx*2, yPx*2, time); // Multiply delta?

		// Update matrices
		this.update();
		
		// Sync logical view with new camera state for compatibility
		this.syncLogicalView();
	}

	/** Clamps the pitch value based on perspective and vertical limits. */
	private limitPitch() : void {
		const halfPerspective = this.perspective / 2;
		// Calculate max pitch based on vertical limit and aspect correction
		const maxPitch = PI * this.scaleY / 2 * (this.limitY > 0 ? this.limitY : 1);

		// Clamp pitch: ensure view edge doesn't go past the pole + limit
		this.pitch = this.pitch > 0 ? min(maxPitch, this.pitch + halfPerspective) - halfPerspective
			: max(-maxPitch, this.pitch - halfPerspective) + halfPerspective;
	}

	/** Clamps the yaw value based on horizontal limits. */
	private limitYaw() : void {
		// Calculate horizontal field of view based on perspective and aspect ratio
		const halfHorizontalFov = this.perspective/2*this.canvas.el.aspect;
		// Calculate max yaw based on horizontal limit
		const maxYaw = PI * (this.limitX > 0 ? this.limitX : 1);

		// Wrap current yaw to be within [-PI, PI) for easier comparison
		let y = this.yaw; while(y >= PI) y-=PI*2; while (y < -PI) y+=PI*2; // More robust wrapping
		// Clamp yaw: ensure view edge doesn't go past the limit boundary
		this.yaw = modPI(min(max(maxYaw, halfHorizontalFov) - halfHorizontalFov, max(min(-maxYaw, -halfHorizontalFov) + halfHorizontalFov, y)));
	}

	/**
	 * Applies zoom by adjusting the perspective.
	 * @param factor Zoom amount (perspective delta).
	 * @param dur Animation duration (0 for immediate).
	 * @param speed Animation speed factor.
	 * @param noLimit Ignore perspective limits.
	 * @param t Current timestamp (performance.now()).
	 * @returns Animation duration.
	 */
	zoom(factor: f64, dur: f64, speed: f64, noLimit: bool, t: f64) : f64 {
		const c = this.canvas;
		factor /= 2; // Halve the factor?
		if(dur != 0) { // If animating
			dur = c.ani.zoom(factor, dur, speed, noLimit, t); // Delegate to Ani controller
		} else { // If immediate zoom
			// Adjust factor based on current scale and canvas size
			factor /= this.scale * pyth(c.width, c.height) / 20;
			// Apply perspective change directly
			this.setPerspective(this.perspective + factor, noLimit);
		}
		return dur;
	}

	/** Sets the perspective (FoV) and updates related state. */
	setPerspective(perspective: f64, noLimit: bool) : void {
		const c = this.canvas;
		this.perspective = perspective;
		// Apply perspective limits if not disabled or if it's 360
		if(!noLimit || c.is360) {
			this.perspective = min(this.maxPerspective, max(this.minPerspective, this.perspective));
		}
		// Re-apply pitch/yaw limits after perspective change
		if(c.coverLimit || this.limitY > 0) this.limitPitch();
		if(this.limitX > 0) this.limitYaw();
		// Update the projection matrix
		this.pMatrix.perspective(this.perspective, c.el.aspect, 0.0001, c.is360 ? 12 : 100); // Different far plane for 360?
		// Recalculate effective scale based on new perspective
		this.readScale();
		// Update matrices (without recalculating perspective)
		this.update(true);
		
		// Sync logical view with new perspective for compatibility
		this.syncLogicalView();
	}

	/** Recalculates the effective scale based on coordinate conversion. */
	readScale() : void {
		// Calculate scale by comparing screen distance between two points (center and center+1px)
		// with their corresponding image coordinate distance.
		const el = this.canvas.el;
		const cX:f64 = el.width/2;
		const cY:f64 = el.height/2;

		const center0 = this.getCoo(cX, cY).x; // Image X at screen center
		const center1 = this.getCoo(cX+1, cY+1).x; // Image X at screen center + 1px offset
		// Calculate scale: 1 / (deltaImageX / deltaScreenX) / imageWidth
		// Handle wrap-around for deltaImageX
		this.scale = 1 / ((center1+(center1 < center0 ? 1 : 0))-center0) / this.canvas.width;
	}

	/* ================== END EVENTS ================== */

	/** Sets the camera orientation based on a target logical view (deprecated for 360 images). */
	setView() : void {
		// This method is deprecated for 360 images - use setView360() instead
		// Keep for backward compatibility and 2D image fallback only
		const c = this.canvas;
		// This shouldn't be called for 360 images anymore
		if(c.is360) return;
		
		const v = c.view;
		// Calculate target yaw and pitch from view center
		this.yaw = ((v.x0 - this.offX + v.width/2) - .5) * PI * 2;
		this.pitch = (((v.y0 + v.height/2) - .5) * PI) * this.scaleY;
		// Set perspective based on view height, applying limits
		this.setPerspective(min(this.maxPerspective, v.height * PI * this.scaleY), true);
	}

	/** Sets the camera orientation directly. */
	setDirection(yaw:f64, pitch:f64, persp:f64) : void {
		// Apply base yaw (true north offset)
		this.yaw = modPI(yaw - this.baseYaw);
		this.pitch = pitch;
		// Set perspective if provided, otherwise just update matrices
		if(persp != 0) this.setPerspective(persp, false);
		else this.update();
		
		// Sync logical view with new camera state for compatibility
		this.syncLogicalView();
	}

	/** Sets the camera orientation using 360-degree viewport format (center + dimensions). */
	setView360(centerX: f64, centerY: f64, width: f64, height: f64, noLimit: bool = false, correctNorth: bool = false) : void {
		// Apply true north correction if requested
		const adjustedCenterX = correctNorth ? centerX + this.canvas.trueNorth : centerX;
		
		// Convert View360 directly to camera parameters
		this.yaw = (adjustedCenterX - .5) * PI * 2;
		this.pitch = (centerY - .5) * PI * this.scaleY;
		// Set perspective based on height, applying limits unless disabled
		this.setPerspective(min(this.maxPerspective, height * PI * this.scaleY), noLimit);
		
		// Update the logical view to match the new camera state (for compatibility)
		// Convert back to standard view format and store in canvas.view
		const x0 = centerX - width / 2;
		const y0 = centerY - height / 2;
		const x1 = centerX + width / 2;
		const y1 = centerY + height / 2;
		this.canvas.view.set(x0, y0, x1, y1);
		this.canvas.view.changed = true;
	}

	/** Gets the current camera state as 360-degree viewport format. */
	getView360() : Float64Array {
		// Calculate center coordinates from camera orientation
		const centerX = mod1(this.yaw / (PI * 2) + .5);
		const centerY = (this.pitch / this.scaleY) / PI + .5;
		
		// Calculate dimensions from perspective
		const height = this.perspective / PI / this.scaleY;
		const c = this.canvas;
		const width = height * (c.el.width == 0 ? 1 : .5 * sqrt(c.el.aspect)) / (c.aspect/2);
		
		// Return as Float64Array for WASM export compatibility
		unchecked(this.view360Buffer[0] = centerX);
		unchecked(this.view360Buffer[1] = centerY);
		unchecked(this.view360Buffer[2] = width);
		unchecked(this.view360Buffer[3] = height);
		return this.view360Buffer;
	}

	/** Synchronizes the logical view with the current camera state for 360 images. */
	private syncLogicalView() : void {
		const c = this.canvas;
		if(!c.is360) return; // Only for 360 images
		
		// Calculate current View360 from camera state
		const centerX = mod1(this.yaw / (PI * 2) + .5);
		const centerY = (this.pitch / this.scaleY) / PI + .5;
		const height = this.perspective / PI / this.scaleY;
		const width = height * (c.el.width == 0 ? 1 : .5 * sqrt(c.el.aspect)) / (c.aspect/2);
		
		// Convert to standard view format and update logical view
		const x0 = centerX - width / 2;
		const y0 = centerY - height / 2;
		const x1 = centerX + width / 2;
		const y1 = centerY + height / 2;
		
		// Update the logical view
		c.view.set(x0, y0, x1, y1);
		c.view.changed = true;
	}

	/** Applies translation offset for 360 space transitions. */
	moveTo(distance: f64, distanceY: f64, direction: f64, addYaw: f64) : void {
		const dir:f64 = direction * PI * 2 + addYaw; // Target direction including offset
		// Calculate XYZ offset based on distance and direction
		this.position.x = -distance * Math.sin(dir);
		this.position.y = distanceY; // Vertical offset
		this.position.z = distance * Math.cos(dir);
		// Mark view as changed and update matrices
		this.canvas.view.changed = true;
		this.update();
	}

	/** Handles canvas resize events for 360 mode. */
	resize() : void {
		const c = this.canvas;
		const el = c.el;
		c.camera.setCanvas(); // Update 2D camera calculations first
		// Recalculate minimum perspective based on new dimensions and max scale
		this.minPerspective = min(.5, el.height / c.height) / c.maxScale * this.scaleY * PI / el.ratio * el.scale;
		// Re-apply current perspective to enforce new limits and update matrices
		this.setPerspective(this.perspective, true);
	}

	// --- Coordinate Conversion Functions ---

	/** Converts screen pixel coordinates to 360 image coordinates [0-1]. */
	getCoo(pxX:f64, pxY:f64) : Coordinates {
		const el = this.canvas.el;
		// Convert screen pixels to Normalized Device Coordinates (NDC) [-1, 1]
		this.vec4.x = (pxX * el.ratio / el.width) * 2 - 1;
		this.vec4.y = -((pxY * el.ratio / el.height) * 2 - 1); // Y is inverted in NDC
		this.vec4.z = 1; // Point on the far plane
		this.vec4.w = 1;

		// --- Unproject NDC to World Space ---
		// Copy current projection matrix
		this.iMatrix.copy(this.pMatrix);
		// Invert the projection matrix
		this.iMatrix.invert();
		// Transform NDC vector by inverse matrix
		this.vec4.transformMat4(this.iMatrix);

		// --- Convert World Space Direction to Spherical Coordinates ---
		// Normalize the resulting direction vector
		this.vec4.normalize();
		// Calculate longitude (yaw) using atan2, adjust for base yaw offset
		this.coo.x = atan2(this.vec4.x,-this.vec4.z)/PI/2+.5+this.offX;
		// Calculate latitude (pitch) using asin, adjust for vertical scaling
		this.coo.y = .5 - Math.asin(this.vec4.y) / PI / this.scaleY;
		// Store current scale and depth/direction info
		this.coo.scale = this.scale;
		this.coo.w = this.position.x + this.position.z; // Store combined translation Z?
		this.coo.direction = this.yaw + this.baseYaw; // Store current absolute yaw

		return this.coo;
	}

	/** Converts 360 image coordinates [0-1] to screen pixel coordinates. */
	getXYZ(x: f64, y: f64) : Coordinates {
		const el = this.canvas.el;
		// Convert image coordinates to 3D vector on the sphere
		this.getVec3(x, y); // Populates this.vec4

		// --- Project 3D Vector to Screen Space ---
		// Convert NDC (-1 to 1) to screen pixels (0 to width/height)
		this.coo.x = ((this.vec4.x + 1) / 2) * el.width / el.ratio;
		this.coo.y = ((-this.vec4.y + 1) / 2) * el.height / el.ratio; // Y is inverted
		this.coo.scale = this.scale; // Store current scale
		this.coo.w = -this.vec4.w; // Store negative w component (depth)

		return this.coo;
	}

	/**
	 * Calculates the 3D vector corresponding to a point on the 360 sphere.
	 * @param x Horizontal coordinate (longitude, 0-1).
	 * @param y Vertical coordinate (latitude, 0-1).
	 * @param abs If true, ignore current camera rotation (get absolute position).
	 * @param rad Radius of the sphere to project onto.
	 * @returns The calculated 3D vector (Vec4) in this.vec4.
	 */
	getVec3(x: f64, y: f64, abs:bool = false, rad:f64=this.radius) : Vec4 {
		// Convert normalized coordinates to radians
		x*=-PI*2; // Longitude (wraps)
		y-=.5;    // Center latitude at 0
		y*=-PI;   // Convert latitude to radians
		y*=this.scaleY; // Apply vertical aspect correction

		// Calculate 3D coordinates on the sphere
		const cY = Math.cos(y); // Cosine of latitude
		this.vec4.x = cY * Math.sin(x)*rad;
		this.vec4.y = Math.sin(y)*rad;
		this.vec4.z = cY * Math.cos(x)*rad;
		this.vec4.w = 1;

		// Apply projection matrix if not requesting absolute coordinates
		if(!abs) this.vec4.transformMat4(this.pMatrix);

		return this.vec4;
	}

	/**
	 * Calculates the combined transformation matrix for placing an element (e.g., marker)
	 * at a specific point on the 360 sphere with given rotations and scale.
	 * Suitable for use with CSS 3D transforms.
	 * @param x Horizontal coordinate (0-1).
	 * @param y Vertical coordinate (0-1).
	 * @param scale Scale factor relative to base size.
	 * @param radius Distance from the center (defaults to sphere radius).
	 * @param rX Rotation around X-axis (pitch).
	 * @param rY Rotation around Y-axis (yaw).
	 * @param rZ Rotation around Z-axis (roll).
	 * @param transY Additional translation along the Y-axis in 3D space.
	 * @param sX Additional scaling along the X-axis.
	 * @param sY Additional scaling along the Y-axis.
	 * @returns The calculated 4x4 transformation matrix.
	 */
	getMatrix(x: f64, y: f64, scale: f64, radius: f64, rX: f64, rY: f64, rZ: f64, transY: f64, sX: f64=1, sY: f64=1) : Mat4 {
		// Use default radius if not provided
		if(isNaN(radius)) radius = this.radius;

		// Start with identity matrix
		this.iMatrix.identity();

		// Adjust radius based on sphere size? Seems like scaling radius by itself.
		radius *= this.radius * (100 / PI2); // This scaling seems arbitrary

		// Convert normalized image coordinates to radians
		x*=-PI*2; // Longitude
		y-=.5;    // Center latitude
		y*=PI * this.scaleY; // Apply vertical aspect correction

		// Calculate 3D position vector on the sphere
		const cY = Math.cos(y);
		this.vec4.x = cY * Math.sin(x);
		this.vec4.y = Math.sin(y);
		this.vec4.z = cY * Math.cos(x);

		// --- Apply Transformations (in reverse order for matrix multiplication) ---
		// 1. Apply camera position offset (for 360 transitions) scaled by radius ratio
		this.iMatrix.translate(
			this.position.x * radius/this.radius,
			-this.position.y * radius/this.radius + transY * this.radius, // Apply additional Y translation
			this.position.z * radius/this.radius
		);

		// 2. Apply base yaw (true north)
		this.iMatrix.rotateY(this.baseYaw);

		// 3. Translate to the point on the sphere surface
		this.iMatrix.translate(
			this.vec4.x * radius,
			this.vec4.y * radius,
			this.vec4.z * radius
		);

		// 4. Rotate to align with surface normal + apply element's Y rotation
		this.iMatrix.rotateY(atan2(this.vec4.x,this.vec4.z) + PI + rY);
		// 5. Apply pitch based on latitude + element's X rotation
		this.iMatrix.rotateX(this.vec4.y + rX); // Should this be -Math.sin(y)?
		// 6. Apply element's Z rotation (roll)
		this.iMatrix.rotateZ(rZ);

		// 7. Apply additional X/Y scaling
		this.iMatrix.scaleXY(sX, sY);

		// 8. Apply overall element scale relative to base size
		this.iMatrix.scale(scale/PI/this.radius); // Scaling seems complex, depends on radius?

		// 9. Multiply by the CSS rotation matrix (rMatrix) to align with screen view
		this.iMatrix.multiply(this.rMatrix);

		return this.iMatrix;
	}

	/** Generates vertex data for a segment of the 360 sphere geometry. */
	setTile360(x: f64, y: f64, w: f64, h: f64) : void {
		// Adjust y/h based on vertical scaling/offset for non-2:1 aspect ratios
		y *= this.scaleY; y/= 2; y -= .25; y += this.offY;
		h *= this.scaleY; h/= 2;

		const v = this.canvas.main.vertexBuffer360; // Target vertex buffer
		const a = this.radius; // Sphere radius
		const sW = w / segsX; // Width of a segment
		const sH = h / segsY; // Height of a segment
		const pi2 = PI * 2;

		// Iterate through vertical and horizontal segments
		for(let pY:u32=0;pY<segsY;pY++) {
			for(let pX:u32=0;pX<segsX;pX++) {
				// Calculate index in the vertex buffer for the current quad (2 triangles = 6 vertices)
				const i:u32 = (pY * segsX + pX) * 6 * 3; // 6 vertices * 3 coords (x,y,z)
				// Calculate angles (in radians) for the four corners of the quad
				const l = -(x + sW * pX) * pi2; // Left longitude
				const t = -(y + sH * pY) * pi2; // Top latitude (inverted?)
				const r = -(x + sW * (pX+1)) * pi2; // Right longitude
				const b = -(y + sH * (pY+1)) * pi2; // Bottom latitude (inverted?)
				// Pre-calculate trig values for efficiency
				const cL = Math.cos(l) * a, sL = Math.sin(l) * a; // Left cos/sin scaled by radius
				const cR = Math.cos(r) * a, sR = Math.sin(r) * a; // Right cos/sin scaled by radius
				const cT = Math.cos(t), cB = Math.cos(b); // Top/Bottom cosines (latitude)
				const sT = Math.sin(t) * a, sB = Math.sin(b) * a; // Top/Bottom sines scaled by radius (Y coord)

				// --- Populate Vertex Buffer (2 triangles: TL, BL, TR and TR, BL, BR) ---
				// Triangle 1: Top-Left (TL)
				unchecked(v[i+0] = <f32>(cT * sL)); // x = cos(lat) * sin(lon) * radius
				unchecked(v[i+1] = <f32>sT);        // y = sin(lat) * radius
				unchecked(v[i+2] = <f32>(cT * cL)); // z = cos(lat) * cos(lon) * radius

				// Triangle 1 & 2: Bottom-Left (BL)
				unchecked(v[i+3] = v[i+9] = <f32>(cB * sL));
				unchecked(v[i+4] = v[i+10] = <f32>sB);
				unchecked(v[i+5] = v[i+11] = <f32>(cB * cL));

				// Triangle 1 & 2: Top-Right (TR)
				unchecked(v[i+6] = v[i+15] = <f32>(cT * sR));
				unchecked(v[i+7] = v[i+16] = <f32>sT); // Re-use y from TL
				unchecked(v[i+8] = v[i+17] = <f32>(cT * cR));

				// Triangle 2: Bottom-Right (BR)
				unchecked(v[i+12] = <f32>(cB * sR));
				unchecked(v[i+13] = <f32>sB); // Re-use y from BL
				unchecked(v[i+14] = <f32>(cB * cR));
			}
		}
	}
}
