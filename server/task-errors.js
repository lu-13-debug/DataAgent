// Never expose arbitrary provider/transport codes as part of the public task contract.
export const MODEL_ERROR_CODES = new Set(['INVALID_KEY', 'NO_PERMISSION', 'RATE_LIMITED', 'MODEL_UNSUPPORTED', 'OUTPUT_TRUNCATED', 'REASONING_ONLY', 'EMPTY_RESPONSE', 'REFUSED', 'PROTOCOL_ERROR', 'UNREACHABLE', 'TIMEOUT', 'CANCELLED', 'KEY_REQUIRED', 'RESPONSE_TOO_LARGE', 'INVALID_REPORT', 'REQUEST_REJECTED']);
export const isModelErrorCode = value => MODEL_ERROR_CODES.has(value);
