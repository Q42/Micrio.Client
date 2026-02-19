/**
 * Custom error class for Micrio-specific errors.
 * @author Marcel Duin <marcel@micr.io>
 */

/**
 * Error codes for categorizing Micrio errors.
 * Allows programmatic handling and user-friendly messages.
 * @internal
 */
export const ErrorCodes = {
	// Network errors
	NETWORK_OFFLINE: 'E001',
	NETWORK_TIMEOUT: 'E002',
	NETWORK_CORS: 'E003',
	NETWORK_NOT_FOUND: 'E004',
	NETWORK_SERVER_ERROR: 'E005',
	
	// WebGL errors
	WEBGL_UNSUPPORTED: 'E100',
	WEBGL_CONTEXT_LOST: 'E101',
	WEBGL_SHADER_COMPILE: 'E102',
	WEBGL_OUT_OF_MEMORY: 'E103',
	
	// Data errors
	DATA_INVALID: 'E200',
	DATA_NOT_FOUND: 'E201',
	DATA_PARSE_ERROR: 'E202',
	DATA_VERSION_MISMATCH: 'E203',
	
	// Runtime errors
	WASM_LOAD_FAILED: 'E300',
	WASM_RUNTIME_ERROR: 'E301',
	IMAGE_LOAD_FAILED: 'E302',
	TOUR_LOAD_FAILED: 'E303',
	
	// Unknown
	UNKNOWN: 'E999'
} as const;

/** Type for error codes */
export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];

/**
 * User-friendly error messages for display to end users.
 * These should be clear, actionable, and non-technical.
 * @internal
 */
export const UserErrorMessages: Record<ErrorCode, string> = {
	[ErrorCodes.NETWORK_OFFLINE]: 'You appear to be offline. Please check your internet connection and try again.',
	[ErrorCodes.NETWORK_TIMEOUT]: 'The connection timed out. Please try again.',
	[ErrorCodes.NETWORK_CORS]: 'Unable to load content due to security restrictions.',
	[ErrorCodes.NETWORK_NOT_FOUND]: 'The requested image or content could not be found.',
	[ErrorCodes.NETWORK_SERVER_ERROR]: 'The server encountered an error. Please try again later.',
	
	[ErrorCodes.WEBGL_UNSUPPORTED]: 'Your browser does not support WebGL, which is required to view this content. Please try a different browser.',
	[ErrorCodes.WEBGL_CONTEXT_LOST]: 'The graphics context was lost. The page will attempt to recover.',
	[ErrorCodes.WEBGL_SHADER_COMPILE]: 'There was a problem initializing the graphics. Please try refreshing the page.',
	[ErrorCodes.WEBGL_OUT_OF_MEMORY]: 'Your device is low on memory. Try closing other browser tabs or applications.',
	
	[ErrorCodes.DATA_INVALID]: 'The image data appears to be invalid or corrupted.',
	[ErrorCodes.DATA_NOT_FOUND]: 'The requested content could not be loaded.',
	[ErrorCodes.DATA_PARSE_ERROR]: 'There was a problem processing the image information.',
	[ErrorCodes.DATA_VERSION_MISMATCH]: 'This image uses an unsupported format version.',
	
	[ErrorCodes.WASM_LOAD_FAILED]: 'Failed to load the image viewer engine. Please try refreshing the page.',
	[ErrorCodes.WASM_RUNTIME_ERROR]: 'An error occurred in the image viewer. Please try refreshing the page.',
	[ErrorCodes.IMAGE_LOAD_FAILED]: 'Failed to load the image. Please try again.',
	[ErrorCodes.TOUR_LOAD_FAILED]: 'Failed to load the tour. Some features may be unavailable.',
	
	[ErrorCodes.UNKNOWN]: 'An unexpected error occurred. Please try refreshing the page.'
};

/**
 * Custom error class for Micrio-specific errors.
 * Provides consistent error handling across the application.
 * @internal
 */
export class MicrioError extends Error {
	/** Human-readable error message for display */
	readonly displayMessage: string;
	/** Original error if this wraps another error */
	readonly cause?: Error;
	/** Error code for programmatic handling */
	readonly code: ErrorCode;
	/** HTTP status code if applicable */
	readonly statusCode?: number;

	constructor(
		message: string,
		options?: {
			cause?: Error;
			code?: ErrorCode;
			displayMessage?: string;
			statusCode?: number;
		}
	) {
		super(message);
		this.name = 'MicrioError';
		this.code = options?.code ?? ErrorCodes.UNKNOWN;
		this.displayMessage = options?.displayMessage ?? UserErrorMessages[this.code];
		this.cause = options?.cause;
		this.statusCode = options?.statusCode;

		// Maintains proper stack trace for where error was thrown (only in V8)
		if ('captureStackTrace' in Error && typeof Error.captureStackTrace === 'function') {
			Error.captureStackTrace(this, MicrioError);
		}
	}

	/**
	 * Creates a MicrioError from a fetch Response.
	 * Categorizes HTTP status codes into appropriate error types.
	 */
	static fromResponse(response: Response, context?: string): MicrioError {
		const status = response.status;
		let code: ErrorCode = ErrorCodes.UNKNOWN;

		if (status === 404) {
			code = ErrorCodes.NETWORK_NOT_FOUND;
		} else if (status >= 500 && status < 600) {
			code = ErrorCodes.NETWORK_SERVER_ERROR;
		} else if (status === 0) {
			code = ErrorCodes.NETWORK_OFFLINE;
		} else if (status === 408 || status === 504) {
			code = ErrorCodes.NETWORK_TIMEOUT;
		}

		return new MicrioError(
			`${context ? context + ': ' : ''}HTTP ${status}`,
			{ code, statusCode: status }
		);
	}

	/**
	 * Creates a MicrioError from a generic Error, attempting to categorize it.
	 */
	static fromError(error: Error, context?: string): MicrioError {
		const message = error.message.toLowerCase();
		let code: ErrorCode = ErrorCodes.UNKNOWN;

		// Categorize common error messages
		if (message.includes('network') || message.includes('internet') || message.includes('offline')) {
			code = ErrorCodes.NETWORK_OFFLINE;
		} else if (message.includes('timeout')) {
			code = ErrorCodes.NETWORK_TIMEOUT;
		} else if (message.includes('cors') || message.includes('cross-origin')) {
			code = ErrorCodes.NETWORK_CORS;
		} else if (message.includes('webgl') || message.includes('webglcontext')) {
			code = ErrorCodes.WEBGL_UNSUPPORTED;
		} else if (message.includes('memory') || message.includes('out of memory')) {
			code = ErrorCodes.WEBGL_OUT_OF_MEMORY;
		} else if (message.includes('wasm') || message.includes('webassembly')) {
			code = ErrorCodes.WASM_LOAD_FAILED;
		}

		return new MicrioError(
			`${context ? context + ': ' : ''}${error.message}`,
			{ code, cause: error }
		);
	}
}

