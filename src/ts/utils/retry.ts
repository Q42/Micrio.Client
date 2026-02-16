/**
 * Retry utility for resilient network operations.
 * Implements exponential backoff with jitter to avoid thundering herd.
 * @author Marcel Duin <marcel@micr.io>
 */

import { MicrioError, ErrorCodes } from './error';

/**
 * Options for retry operations.
 * @internal
 */
export interface RetryOptions {
	/** Maximum number of retry attempts (default: 3) */
	maxAttempts?: number;
	/** Initial delay in milliseconds (default: 1000) */
	initialDelayMs?: number;
	/** Maximum delay in milliseconds (default: 30000) */
	maxDelayMs?: number;
	/** Multiplier for exponential backoff (default: 2) */
	backoffMultiplier?: number;
	/** Whether to add random jitter to delay (default: true) */
	jitter?: boolean;
	/** Optional callback for retry attempts */
	onRetry?: (attempt: number, error: Error, nextDelay: number) => void;
	/** Optional predicate to determine if error is retryable */
	isRetryable?: (error: Error) => boolean;
}

/**
 * Default retry configuration.
 * @internal
 */
const defaultRetryOptions: Required<RetryOptions> = {
	maxAttempts: 3,
	initialDelayMs: 1000,
	maxDelayMs: 30000,
	backoffMultiplier: 2,
	jitter: true,
	onRetry: () => {},
	isRetryable: (error: Error) => {
		// Retry on network errors and 5xx server errors
		if (error instanceof MicrioError) {
			return error.retryable || 
				[ErrorCodes.NETWORK_TIMEOUT, ErrorCodes.NETWORK_SERVER_ERROR].includes(error.code);
		}
		// Retry on common network error messages
		const msg = error.message.toLowerCase();
		return msg.includes('network') || 
			   msg.includes('timeout') || 
			   msg.includes('failed to fetch') ||
			   msg.includes('internet');
	}
};

/**
 * Calculates delay with exponential backoff and optional jitter.
 * @internal
 */
function calculateDelay(attempt: number, options: Required<RetryOptions>): number {
	// Exponential backoff: initialDelay * multiplier^attempt
	const exponentialDelay = options.initialDelayMs * Math.pow(options.backoffMultiplier, attempt - 1);
	
	// Cap at max delay
	const cappedDelay = Math.min(exponentialDelay, options.maxDelayMs);
	
	// Add jitter (±25%) to prevent thundering herd
	if (options.jitter) {
		const jitterAmount = cappedDelay * 0.25;
		return cappedDelay + (Math.random() * jitterAmount * 2 - jitterAmount);
	}
	
	return cappedDelay;
}

/**
 * Sleeps for specified milliseconds.
 * @internal
 */
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Executes an async function with retry logic.
 * 
 * @example
 * ```typescript
 * const data = await withRetry(
 *   () => fetchJson('https://example.com/data.json'),
 *   { maxAttempts: 5, onRetry: (attempt, error) => console.log(`Retry ${attempt}`) }
 * );
 * ```
 * 
 * @internal
 * @template T Return type of the operation
 * @param operation The async operation to execute
 * @param options Retry configuration options
 * @returns Promise resolving to the operation result
 * @throws The last error encountered if all retries fail
 */
export async function withRetry<T>(
	operation: () => Promise<T>,
	options: RetryOptions = {}
): Promise<T> {
	const config = { ...defaultRetryOptions, ...options };
	let lastError: Error;

	for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
		try {
			return await operation();
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));

			// Don't retry on final attempt
			if (attempt >= config.maxAttempts) {
				break;
			}

			// Check if error is retryable
			if (!config.isRetryable(lastError)) {
				throw lastError;
			}

			// Calculate and apply delay
			const delayMs = calculateDelay(attempt, config);
			config.onRetry(attempt, lastError, delayMs);
			await sleep(delayMs);
		}
	}

	throw lastError!;
}

/**
 * Wraps a fetch call with retry logic.
 * Automatically retries on network errors and 5xx responses.
 * 
 * @example
 * ```typescript
 * const response = await fetchWithRetry('https://example.com/data.json');
 * ```
 * 
 * @internal
 * @param url URL to fetch
 * @param init Fetch options
 * @param options Retry configuration
 * @returns Promise resolving to the Response
 */
export async function fetchWithRetry(
	url: string,
	init?: RequestInit,
	options?: RetryOptions
): Promise<Response> {
	return withRetry(
		async () => {
			const response = await fetch(url, init);
			
			// Don't retry 4xx errors (client errors)
			if (response.status >= 400 && response.status < 500 && response.status !== 408) {
				return response;
			}
			
			// Throw on error responses to trigger retry
			if (!response.ok) {
				throw MicrioError.fromResponse(response, `Failed to fetch ${url}`);
			}
			
			return response;
		},
		options
	);
}
