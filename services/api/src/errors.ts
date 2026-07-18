export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly code = "request_error",
  ) {
    super(message);
  }
}

export function badRequest(error: unknown): HttpError {
  return error instanceof HttpError
    ? error
    : new HttpError(
        400,
        error instanceof Error ? error.message : "Invalid request",
        "invalid_request",
      );
}
