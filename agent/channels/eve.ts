import { eveChannel } from "eve/channels/eve";
import { type AuthFn, localDev, placeholderAuth, vercelOidc } from "eve/channels/auth";

// Production and preview deployments are protected by Vercel Authentication
// for all deployment URLs. This project currently has one team owner, so the
// protected caller maps to one stable user identity for per-user OAuth grants.
const protectedOwner: AuthFn<Request> = (request) => {
  const environment = process.env.VERCEL_ENV;
  if (
    process.env.VERCEL !== "1" ||
    (environment !== "production" && environment !== "preview") ||
    !process.env.VERCEL_PROJECT_ID ||
    !request.headers.get("x-vercel-id")
  ) {
    return null;
  }

  return {
    authenticator: "vercel-deployment-protection",
    issuer: process.env.VERCEL_PROJECT_ID,
    principalId: "jarvis-owner",
    principalType: "user",
    attributes: { deploymentEnvironment: environment },
  };
};

export default eveChannel({
  auth: [
    // Lets the Eve CLI and trusted Vercel runtimes reach the deployed agent.
    vercelOidc(),
    // Browser requests pass through Vercel Authentication before reaching this app.
    protectedOwner,
    // Open on localhost for `eve dev` and the REPL; ignored in production.
    localDev(),
    // Fail closed if a request isn't covered by the deployment protection above.
    placeholderAuth(),
  ],
});
