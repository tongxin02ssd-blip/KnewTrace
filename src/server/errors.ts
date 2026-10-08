import type { AppError } from "../shared/types.js";

export class KnowTraceError extends Error {
  constructor(
    public readonly details: AppError,
    public readonly httpStatus = 500,
  ) {
    super(details.message);
    this.name = "KnowTraceError";
  }
}

export const appError = (error: unknown, fallback: AppError): AppError => {
  if (error instanceof KnowTraceError) return error.details;
  if (error instanceof Error) return { ...fallback, message: error.message || fallback.message };
  return fallback;
};

export const requireConfig = (value: string | undefined, name: string, stage: string) => {
  if (!value) {
    throw new KnowTraceError({
      code: "CONFIG_MISSING",
      message: `${name} is not configured. Add it to .env and restart the server.`,
      stage,
      retryable: true,
    }, 503);
  }
  return value;
};
