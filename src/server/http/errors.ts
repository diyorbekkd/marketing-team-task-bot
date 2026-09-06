import "server-only";

import { ZodError } from "zod";
import { ApplicationError } from "@/application/errors";

const STATUS_BY_CODE = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INVALID_INPUT: 400,
  INTEGRATION_UNAVAILABLE: 503,
} as const;

export function errorResponse(error: unknown): Response {
  if (error instanceof ApplicationError) {
    return Response.json({ error: error.message, code: error.code }, { status: STATUS_BY_CODE[error.code] });
  }
  if (error instanceof ZodError) {
    return Response.json(
      { error: "Invalid request.", code: "INVALID_INPUT", issues: error.issues.map((issue) => ({ path: issue.path, message: issue.message })) },
      { status: 400 },
    );
  }
  console.error("Unhandled API error.");
  return Response.json({ error: "Internal server error.", code: "INTERNAL_ERROR" }, { status: 500 });
}
