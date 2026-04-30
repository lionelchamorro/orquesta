import { randomBytes } from "node:crypto";
import type { PlanStore } from "./plan-store";

export const SESSION_TOKEN_BYTES = 32;

export const getOrCreateSessionToken = async (store: PlanStore): Promise<string> => {
  const tokenFile = Bun.file(store.crewPath("session.token"));
  if (await tokenFile.exists()) {
    const token = (await tokenFile.text()).trim();
    if (token.length >= SESSION_TOKEN_BYTES) return token;
  }
  const token = randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
  await Bun.write(store.crewPath("session.token"), `${token}\n`);
  return token;
};

const parseCookies = (header: string | null): Record<string, string> => {
  if (!header) return {};
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim().split("="))
      .filter((parts): parts is [string, string] => parts.length === 2 && parts[0].length > 0)
      .map(([key, value]) => [key, decodeURIComponent(value)]),
  );
};

export const requestHasSessionToken = (req: Request, sessionToken?: string): boolean => {
  if (!sessionToken) return true;
  const url = new URL(req.url);
  const headerToken = req.headers.get("x-orquesta-token") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const queryToken = url.searchParams.get("token");
  const cookieToken = parseCookies(req.headers.get("cookie")).orquesta_token;
  return headerToken === sessionToken || queryToken === sessionToken || cookieToken === sessionToken;
};

export const sessionCookie = (sessionToken: string): string =>
  `orquesta_token=${encodeURIComponent(sessionToken)}; Path=/; SameSite=Strict; HttpOnly`;
