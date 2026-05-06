import { createHmac, timingSafeEqual } from "crypto";
import type { NextRequest, NextResponse } from "next/server";

import type { AppUser, SessionUser } from "@/lib/clientAuth";

const SESSION_COOKIE_NAME = "ep_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

interface SessionPayload extends SessionUser {
  exp: number;
}

function getSessionSecret() {
  return (
    process.env.SESSION_SECRET ||
    process.env.NEXT_PUBLIC_INVITE_CODE ||
    "change-this-session-secret"
  );
}

function toBase64Url(input: string) {
  return Buffer.from(input, "utf8").toString("base64url");
}

function fromBase64Url(input: string) {
  return Buffer.from(input, "base64url").toString("utf8");
}

function sign(input: string) {
  return createHmac("sha256", getSessionSecret()).update(input).digest("base64url");
}

function shouldUseSecureCookie(request?: NextRequest) {
  const override = process.env.SESSION_COOKIE_SECURE?.trim().toLowerCase();

  if (override === "true") return true;
  if (override === "false") return false;

  if (request) {
    const forwardedProto = request.headers.get("x-forwarded-proto");
    if (forwardedProto) {
      return forwardedProto.split(",")[0].trim() === "https";
    }

    return request.nextUrl.protocol === "https:";
  }

  return process.env.NODE_ENV === "production";
}

export function toSessionUser(user: AppUser | SessionUser): SessionUser {
  return {
    username: user.username,
    role: user.role,
    displayName: user.displayName,
    teacherUsername: "teacherUsername" in user ? user.teacherUsername : undefined,
  };
}

export function createSessionToken(user: AppUser | SessionUser) {
  const payload: SessionPayload = {
    ...toSessionUser(user),
    exp: Date.now() + SESSION_MAX_AGE * 1000,
  };
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signature = sign(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export function verifySessionToken(token?: string | null): SessionUser | null {
  if (!token) return null;

  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) return null;

  const expectedSignature = sign(encodedPayload);
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");
  const actualBuffer = Buffer.from(signature, "utf8");

  if (
    expectedBuffer.length !== actualBuffer.length ||
    !timingSafeEqual(expectedBuffer, actualBuffer)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(fromBase64Url(encodedPayload)) as SessionPayload;
    if (!payload.username || !payload.role || !payload.displayName) {
      return null;
    }
    if (payload.exp <= Date.now()) {
      return null;
    }

    return {
      username: payload.username,
      role: payload.role,
      displayName: payload.displayName,
      teacherUsername: payload.teacherUsername,
    };
  } catch {
    return null;
  }
}

export function setSessionCookie(
  response: NextResponse,
  user: AppUser | SessionUser,
  request?: NextRequest
) {
  response.cookies.set(SESSION_COOKIE_NAME, createSessionToken(user), {
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureCookie(request),
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export function clearSessionCookie(response: NextResponse, request?: NextRequest) {
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureCookie(request),
    path: "/",
    maxAge: 0,
  });
}

export function getSessionFromRequest(request: NextRequest) {
  return verifySessionToken(request.cookies.get(SESSION_COOKIE_NAME)?.value);
}
