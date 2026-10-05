import { describe, expect, it } from 'vitest'
import { ErrorCodes, MicrioError, getErrorMessage } from '../../src/core/error'

const response = (status: number) => ({ status }) as Response

describe('MicrioError.fromResponse', () => {
	it('maps HTTP status classes to error codes', () => {
		expect(MicrioError.fromResponse(response(404)).code).toBe(ErrorCodes.NETWORK_NOT_FOUND)
		expect(MicrioError.fromResponse(response(500)).code).toBe(ErrorCodes.NETWORK_SERVER_ERROR)
		expect(MicrioError.fromResponse(response(599)).code).toBe(ErrorCodes.NETWORK_SERVER_ERROR)
		expect(MicrioError.fromResponse(response(0)).code).toBe(ErrorCodes.NETWORK_OFFLINE)
		expect(MicrioError.fromResponse(response(408)).code).toBe(ErrorCodes.NETWORK_TIMEOUT)
		// 504 is checked *after* the 5xx range above, so it classifies as a server error.
		expect(MicrioError.fromResponse(response(504)).code).toBe(ErrorCodes.NETWORK_SERVER_ERROR)
	})

	it('falls back to UNKNOWN for unlisted statuses', () => {
		expect(MicrioError.fromResponse(response(403)).code).toBe(ErrorCodes.UNKNOWN)
		expect(MicrioError.fromResponse(response(200)).code).toBe(ErrorCodes.UNKNOWN)
	})

	it('keeps the status code and prefixes the context in the message', () => {
		const e = MicrioError.fromResponse(response(404), 'fetchJson(x)')
		expect(e.statusCode).toBe(404)
		expect(e.message).toBe('fetchJson(x): HTTP 404')
		expect(e.name).toBe('MicrioError')
		expect(e).toBeInstanceOf(Error)
	})

	it('always has a human-readable display message', () => {
		const e = MicrioError.fromResponse(response(404))
		expect(e.displayMessage.length).toBeGreaterThan(0)
		expect(e.displayMessage).not.toContain('HTTP')
	})
})

describe('MicrioError.fromError', () => {
	it('categorizes by message content', () => {
		expect(MicrioError.fromError(new Error('Failed to fetch network')).code).toBe(ErrorCodes.NETWORK_OFFLINE)
		expect(MicrioError.fromError(new Error('request timeout')).code).toBe(ErrorCodes.NETWORK_TIMEOUT)
		expect(MicrioError.fromError(new Error('Cross-origin blocked')).code).toBe(ErrorCodes.NETWORK_CORS)
		expect(MicrioError.fromError(new Error('WebGL context lost')).code).toBe(ErrorCodes.WEBGL_UNSUPPORTED)
		expect(MicrioError.fromError(new Error('out of memory')).code).toBe(ErrorCodes.WEBGL_OUT_OF_MEMORY)
		expect(MicrioError.fromError(new Error('wasm load failed')).code).toBe(ErrorCodes.WASM_LOAD_FAILED)
		expect(MicrioError.fromError(new Error('something else')).code).toBe(ErrorCodes.UNKNOWN)
	})

	it('is case-insensitive and keeps the cause plus context', () => {
		const cause = new Error('WebGL is unsupported')
		const e = MicrioError.fromError(cause, 'engine.init')
		expect(e.code).toBe(ErrorCodes.WEBGL_UNSUPPORTED)
		expect(e.cause).toBe(cause)
		expect(e.message).toBe('engine.init: WebGL is unsupported')
	})
})

describe('getErrorMessage', () => {
	it('prefers the display message for MicrioError', () => {
		const e = new MicrioError('raw', { code: ErrorCodes.DATA_NOT_FOUND })
		expect(getErrorMessage(e)).toBe(e.displayMessage)
		expect(getErrorMessage(e)).not.toBe('raw')
	})

	it('passes through plain Errors and strings', () => {
		expect(getErrorMessage(new Error('boom'))).toBe('boom')
		expect(getErrorMessage('boom')).toBe('boom')
	})

	it('stringifies primitives and falls back for objects', () => {
		expect(getErrorMessage(404)).toBe('404')
		expect(getErrorMessage(false)).toBe('false')
		expect(getErrorMessage(null)).toBe('An unknown error has occurred')
		const noValue: unknown = undefined
		expect(getErrorMessage(noValue)).toBe('An unknown error has occurred')
		expect(getErrorMessage({ some: 'object' })).toBe('An unknown error has occurred')
	})
})
