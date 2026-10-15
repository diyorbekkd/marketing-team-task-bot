import { ApplicationError } from "@/application/errors";

type DataError = Readonly<{ code?: string; message: string }>;

export function mapDataError(error: DataError | null, fallback: string): ApplicationError {
  if (error?.code === "PT409") {
    return new ApplicationError("CONFLICT", error.message);
  }
  if (error?.code === "23505") {
    return new ApplicationError("CONFLICT", "This operation conflicts with a newer or existing record.");
  }
  if (error?.code === "PGRST116" || error?.code === "P0002") {
    return new ApplicationError("NOT_FOUND", fallback);
  }
  if (error?.code === "42501") {
    return new ApplicationError("FORBIDDEN", "The database rejected this operation.");
  }
  if (error?.code === "22023" || error?.code === "23514") {
    return new ApplicationError("INVALID_INPUT", "The database rejected invalid input.");
  }
  return new ApplicationError("INTEGRATION_UNAVAILABLE", fallback);
}
