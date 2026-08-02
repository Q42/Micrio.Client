export interface LightingParam {
	key: string;
	default: number;
}

export interface LightingPreset {
	name: string;
	isAnimated: boolean;
	params: LightingParam[];
}

export interface LightingState {
	_lightDir: [number, number, number];
	_lightColor: [number, number, number];
	_ambientColor: [number, number, number];
	_numPointLights: number;
	_pointLightPos: Float32Array;
	_pointLightColor: Float32Array;
	_pointLightIntensity: Float32Array;
	_bumpStrength: number;
}

const MAX_POINT_LIGHTS = 8;

function flickerSeed(i: number, t: number, flickerAmt: number): number {
	const phase = i * 2.1;
	const slow = Math.sin(t * 1.7 + phase) * 0.45;
	const mid = Math.sin(t * 3.9 + phase * 1.4) * 0.3;
	const fast = Math.sin(t * 7.1 + phase * 2.8) * 0.15;
	const crackle = Math.abs(Math.sin(t * 10.3 + phase * 5.1)) * 0.2;
	const raw = 0.5 + (slow + mid + fast + crackle) * flickerAmt;
	return Math.max(0.1, Math.min(1.0, raw));
}

function clamp01(n: number): number {
	return Math.max(0, Math.min(1, n));
}

function normalize(v: number[]): [number, number, number] {
	const len = Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]);
	if (len < 1e-9) return [0, 1, 0];
	return [v[0]/len, v[1]/len, v[2]/len];
}

function crackleFlicker(t: number): number {
	const base = Math.sin(t * 1.7) * 0.5 + 0.5;
	const c1 = Math.abs(Math.sin(t * 8.3 + 0.7)) * 0.25;
	const c2 = Math.abs(Math.sin(t * 13.7 + 1.3)) * 0.15;
	const c3 = Math.abs(Math.sin(t * 19.1 + 2.1)) * 0.08;
	return Math.max(0, Math.min(1, 0.6 + 0.4 * (base + c1 + c2 + c3)));
}

// Preset display metadata (labels, icons, param types/min/max/step, dropdown
// options) is no longer shipped as runtime data. Only `name`, `isAnimated`,
// and each param's `key`/`default` are consumed by the renderer and BookViewer.
const LIGHTING_PRESETS: LightingPreset[] = [
	// { name: 'daylight', icon: '☀️', isAnimated: false,
	//   params: [{ key: 'timeOfDay', label: 'Time of Day', type: 'slider', min: 0, max: 24, step: 0.5 }] }
	{
		name: 'daylight',
		isAnimated: false,
		params: [{ key: 'timeOfDay', default: 12 }],
	},
	// { name: 'incandescent', icon: '💡', isAnimated: false,
	//   params: [{ key: 'wattage', label: 'Bulb Wattage', type: 'dropdown',
	//     options: ['40W Cozy', '60W Normal', '100W Bright'] }] }
	{
		name: 'incandescent',
		isAnimated: false,
		params: [{ key: 'wattage', default: 1 }],
	},
	// { name: 'candlelight', icon: '🕯️', isAnimated: true,
	//   params: [
	//     { key: 'candleCount', label: 'Candles', type: 'slider', min: 1, max: 12, step: 1 },
	//     { key: 'spread', label: 'Spread', type: 'slider', min: 0.2, max: 2.5, step: 0.1 },
	//     { key: 'intensity', label: 'Intensity', type: 'slider', min: 0.2, max: 1.5, step: 0.05 },
	//     { key: 'flicker', label: 'Flicker', type: 'slider', min: 0.0, max: 1.0, step: 0.05 } ] }
	{
		name: 'candlelight',
		isAnimated: true,
		params: [
			{ key: 'candleCount', default: 3 },
			{ key: 'spread', default: 2.0 },
			{ key: 'intensity', default: 0.65 },
			{ key: 'flicker', default: 0.2 },
		],
	},
	// { name: 'rainy day', icon: '🌧️', isAnimated: true,
	//   params: [{ key: 'stormLevel', label: 'Storm Level', type: 'dropdown',
	//     options: ['Drizzle', 'Rain', 'Downpour'] }] }
	{
		name: 'rainy day',
		isAnimated: true,
		params: [{ key: 'stormLevel', default: 1 }],
	},
	// { name: 'moonlight', icon: '🌙', isAnimated: true,
	//   params: [{ key: 'moonPhase', label: 'Moon Phase', type: 'dropdown',
	//     options: ['Full Moon', 'Gibbous', 'Crescent'] }] }
	{
		name: 'moonlight',
		isAnimated: true,
		params: [{ key: 'moonPhase', default: 0 }],
	},
	// { name: 'fireplace', icon: '🔥', isAnimated: true,
	//   params: [
	//     { key: 'fireIntensity', label: 'Fire Intensity', type: 'slider', min: 0.3, max: 1.0, step: 0.05 },
	//     { key: 'crackle', label: 'Crackle', type: 'slider', min: 0.0, max: 1.0, step: 0.05 } ] }
	{
		name: 'fireplace',
		isAnimated: true,
		params: [
			{ key: 'fireIntensity', default: 0.8 },
			{ key: 'crackle', default: 0.6 },
		],
	},
	// { name: 'haunted', icon: '🦇', isAnimated: true,
	//   params: [{ key: 'spookiness', label: 'Spookiness', type: 'slider', min: 0.2, max: 1.0, step: 0.05 }] }
	{
		name: 'haunted',
		isAnimated: true,
		params: [{ key: 'spookiness', default: 0.7 }],
	},
];

export function getPresets(): LightingPreset[] {
	return LIGHTING_PRESETS;
}

export function getPreset(name: string): LightingPreset | undefined {
	return LIGHTING_PRESETS.find(p => p.name === name);
}

export function computeLighting(
	presetName: string,
	params: Record<string, number>,
	time: number,
): LightingState {
	const posArr = new Float32Array(MAX_POINT_LIGHTS * 3);
	const colArr = new Float32Array(MAX_POINT_LIGHTS * 3);
	const intArr = new Float32Array(MAX_POINT_LIGHTS);

	const makeState = (
		_lightDir: [number, number, number],
		_lightColor: [number, number, number],
		_ambientColor: [number, number, number],
		_numPointLights: number,
		_bumpStrength: number,
	): LightingState => ({
		_lightDir,
		_lightColor,
		_ambientColor,
		_numPointLights,
		_pointLightPos: posArr,
		_pointLightColor: colArr,
		_pointLightIntensity: intArr,
		_bumpStrength,
	});

	const empty = (): LightingState =>
		makeState([0, 1, 0], [1, 1, 1], [0.15, 0.15, 0.18], 0, 0.4);

	switch (presetName) {
		// ── ☀️ daylight ──
		case 'daylight': {
			const tod = params.timeOfDay ?? 12;
			const sunAngle = ((tod / 24) * 2.0 - 0.5) * Math.PI; // -π/2 at 6h, +π/2 at 18h
			const sunHeight = Math.sin(sunAngle);
			const dir = normalize([Math.cos(sunAngle), Math.max(0.05, sunHeight), -0.35]);

			const morningWarmth = Math.max(0, 1 - Math.abs(tod - 6.5) / 3.5);
			const eveningWarmth = Math.max(0, 1 - Math.abs(tod - 17.5) / 3.5);
			const warmth = Math.max(morningWarmth, eveningWarmth);

			const lightR = 0.85 + warmth * 0.15;
			const lightG = 0.82 + warmth * 0.08;
			const lightB = 0.76 - warmth * 0.2;

			const nightFactor = sunHeight < 0 ? Math.min(1, -sunHeight * 2) : 0;
			const ambR = 0.12 + sunHeight * 0.08 - nightFactor * 0.04;
			const ambG = 0.12 + sunHeight * 0.08 - nightFactor * 0.04;
			const ambB = 0.18 + sunHeight * 0.06 - nightFactor * 0.08;

			return makeState(
				dir,
				[clamp01(lightR), clamp01(lightG), clamp01(lightB)],
				[clamp01(ambR), clamp01(ambG), clamp01(ambB)],
				0,
				0.4,
			);
		}

		// ── 💡 incandescent ──
		case 'incandescent': {
			const wattage = params.wattage ?? 1;
			const wattBasis = [0.5, 1.0, 1.4][Math.round(wattage)] ?? 1.0;
			const lightScale = 0.6 + 0.4 * wattBasis;
			const warmth = 0.4 - wattBasis * 0.15;

			return makeState(
				normalize([0.3, 0.85, 0.35]),
				[0.95 * lightScale, 0.75 * lightScale, 0.45 * lightScale],
				[0.1 + warmth * 0.05, 0.08 + warmth * 0.04, 0.05 + warmth * 0.02],
				0,
				0.4,
			);
		}

		// ── 🕯️ candlelight ──
		case 'candlelight': {
			const count = Math.round(params.candleCount ?? 4);
			const spread = params.spread ?? 1.0;
			const brightness = params.intensity ?? 0.7;
			const flickerAmt = params.flicker ?? 0.7;

			const half = Math.ceil(count / 2);

			for (let i = 0; i < count && i < MAX_POINT_LIGHTS; i++) {
				const side = i < half ? -1 : 1;
				const idx = i < half ? i : i - half;
				const step = half <= 1 ? 0 : idx / (half - 1);

				const px = side * (1.2 + step * 2.2 * spread);
				const pz = -1.5 - step * 2.0 * spread - Math.sin(i * 2.7) * 0.5 * spread;
				const py = 0.8 + Math.sin(i * 1.3) * 0.5;

				posArr[i * 3] = px;
				posArr[i * 3 + 1] = py;
				posArr[i * 3 + 2] = pz;

				const flicker = flickerSeed(i, time, flickerAmt);
				const intensity = brightness * (0.5 + flicker * 1.8);

				colArr[i * 3] = 0.95;
				colArr[i * 3 + 1] = 0.6;
				colArr[i * 3 + 2] = 0.18;
				intArr[i] = intensity;
			}

			return makeState(
				[0, 1, 0],
				[0, 0, 0],
				[0.06, 0.04, 0.04],
				count,
				0.5,
			);
		}

		// ── 🌧️ rainy day ──
		case 'rainy day': {
			const stormLevel = params.stormLevel ?? 1;
			const dimTable = [0.45, 0.3, 0.15];
			const dim = dimTable[Math.round(stormLevel)] ?? 0.3;
			const rainPulse = 1 - Math.abs(Math.sin(time * 0.13 + 0.7)) * 0.15 * dim;

			return makeState(
				normalize([0.1, 0.7, 0.4]),
				[0.55 * rainPulse, 0.58 * rainPulse, 0.62 * rainPulse],
				[0.08 * dim, 0.09 * dim, 0.13 * dim],
				0,
				0.5,
			);
		}

		// ── 🌙 moonlight ──
		case 'moonlight': {
			const phase = params.moonPhase ?? 0;
			const brightnessTable = [1.0, 0.55, 0.22];
			const b = brightnessTable[Math.round(phase)] ?? 0.55;

			const moonPulse = 1 + Math.sin(time * 0.05) * 0.03;

			return makeState(
				normalize([-0.5, 0.65, 0.35]),
				[0.22 * b * moonPulse, 0.28 * b * moonPulse, 0.42 * b * moonPulse],
				[0.02 * b, 0.025 * b, 0.06 * b],
				0,
				0.6,
			);
		}

		// ── 🔥 fireplace ──
		case 'fireplace': {
			const intensity = params.fireIntensity ?? 0.8;
			const crackleAmt = params.crackle ?? 0.6;
			const flicker = crackleFlicker(time);
			const fireFlicker = 0.6 + 0.4 * flicker;

			posArr[0] = -3.5;
			posArr[0 + 1] = 1.2;
			posArr[0 + 2] = -2.5;
			colArr[0] = 1.0;
			colArr[0 + 1] = 0.45;
			colArr[0 + 2] = 0.08;
			intArr[0] = intensity * fireFlicker * 4.0;

			posArr[3] = 3.5;
			posArr[3 + 1] = 1.1;
			posArr[3 + 2] = -2.5;
			colArr[3] = 1.0;
			colArr[3 + 1] = 0.5;
			colArr[3 + 2] = 0.1;
			intArr[1] = intensity * fireFlicker * 3.0;

			const cracklePulse = 1 - Math.abs(Math.sin(time * 9.7)) * crackleAmt * 0.4;
			const cracklePulse2 = 1 - Math.abs(Math.sin(time * 14.3 + 1.1)) * crackleAmt * 0.25;
			intArr[0] *= cracklePulse;
			intArr[1] *= cracklePulse2;

			return makeState(
				[0, 1, 0],
				[0, 0, 0],
				[0.08 * intensity, 0.04 * intensity, 0.03 * intensity],
				2,
				0.5,
			);
		}

		// ── 🦇 haunted ──
		case 'haunted': {
			const spookiness = params.spookiness ?? 0.7;
			const spookPulse = Math.sin(time * 0.7 + 0.3) * 0.3 + 0.7;
			const greenPulse = Math.sin(time * 1.3) * 0.5 + 0.5;

			const lightR = 0.08 + greenPulse * spookiness * 0.35;
			const lightG = 0.12 + spookiness * 0.5;
			const lightB = 0.05 + (1 - greenPulse) * spookiness * 0.3;

			const ambR = 0.02 + spookiness * 0.04;
			const ambG = 0.03 + spookiness * 0.05;
			const ambB = 0.02 + spookiness * 0.03;

			return makeState(
				normalize([0.4, 0.5, 0.3]),
				[lightR * spookPulse, lightG * spookPulse, lightB * spookPulse],
				[ambR, ambG, ambB],
				0,
				0.5,
			);
		}

		default:
			return empty();
	}
}
