export class AppError extends Error {
  constructor(message, { code = 'INTERNAL_ERROR', status = 500, retryable = false, details } = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.details = details;
  }
}

export function publicError(error) {
  if (error instanceof AppError) {
    return {
      status: error.status,
      body: {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details })
        }
      }
    };
  }
  return {
    status: 500,
    body: { error: { code: 'INTERNAL_ERROR', message: 'The agent service could not complete the request.' } }
  };
}
