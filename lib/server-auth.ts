const OWNER_ID = "jarvis-owner";

export function isOwnerRequest(request: Request): boolean {
  if (process.env.NODE_ENV !== "production") return true;

  // Vercel Authentication is enabled for every deployment in this project.
  // The platform applies it before these routes and stamps x-vercel-id.
  return (
    process.env.VERCEL === "1" &&
    (process.env.VERCEL_ENV === "production" || process.env.VERCEL_ENV === "preview") &&
    Boolean(process.env.VERCEL_PROJECT_ID) &&
    Boolean(request.headers.get("x-vercel-id"))
  );
}

export function ownerId(): string {
  return OWNER_ID;
}
