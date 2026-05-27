export type AppErrorCode =
  | "BAD_REQUEST"
  | "NOT_FOUND"
  | "UNSUPPORTED_MEDIA"
  | "CONFIGURATION_ERROR"
  | "INGEST_FAILED"
  | "EXPORT_FAILED";

export class AppError extends Error {
  constructor(
    public readonly code: AppErrorCode,
    message: string,
    public readonly status = 500,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function toErrorResponse(error: unknown) {
  if (error instanceof AppError) {
    return {
      status: error.status,
      body: {
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      },
    };
  }

  return {
    status: 500,
    body: {
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "An unexpected service error occurred.",
      },
    },
  };
}
