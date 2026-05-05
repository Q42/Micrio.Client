/**
 * Micrio Engine — TypeScript compute core for the Micrio image viewer.
 *
 * This module replaces the WebAssembly/AssemblyScript compute layer.
 * It provides the same computational logic (camera math, tile pyramid
 * management, animation engine, 360 sphere geometry, matrix/vector math)
 * as pure TypeScript classes.
 *
 * @author Marcel Duin <marcel@micr.io>
 */

export { Main } from './main';
export { default as Canvas } from './canvas';
export { default as Image } from './image';
export { default as WebGL } from './webgl';
export { default as Camera } from './camera';
export { default as Ani } from './camera.ani';
export { default as Kinetic } from './camera.kinetic';
export { View, Coordinates, Viewport, DrawRect } from './shared';
export { Mat4, Vec4 } from './webgl.mat';
export { Bicubic, easeInOut, easeIn, easeOut, linear, mod1, modPI, twoNth, longitudeDistance } from './utils';
export { PI, PI2, PIh, segsX, segsY, base360Distance } from './globals';
