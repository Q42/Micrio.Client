/**
 * Custom error class for Micrio-specific errors.
 * @author Marcel Duin <marcel@micr.io>
 */

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
	readonly code?: string;

	constructor(message: string, options?: { cause?: Error; code?: string; displayMessage?: string }) {
		super(message);
		this.name = 'MicrioError';
		this.displayMessage = options?.displayMessage ?? message;
		this.cause = options?.cause;
		this.code = options?.code;
		// Maintains proper stack trace for where error was thrown (only in V8)
		if ('captureStackTrace' in Error && typeof Error.captureStackTrace === 'function') {
			Error.captureStackTrace(this, MicrioError);
		}
	}
}

