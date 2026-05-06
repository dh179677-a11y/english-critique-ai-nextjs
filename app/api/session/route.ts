import { NextRequest, NextResponse } from "next/server";

import type { AppUser } from "@/lib/clientAuth";
import { readPortalStore } from "@/lib/portalStore";
import { clearSessionCookie, getSessionFromRequest } from "@/lib/sessionCookie";

function isStudentExpired(user: AppUser) {
  if (user.role !== "student") return false;
  if (!user.expiryAt) return false;
  return Date.now() > user.expiryAt;
}

export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ ok: true, data: null });
  }

  const store = await readPortalStore();
  const user = store.users.find(
    (item) => item.username === session.username && item.role === session.role
  );

  if (!user) {
    const response = NextResponse.json({ ok: true, data: null });
    clearSessionCookie(response);
    return response;
  }

  if (user.role === "student" && (user.status === "inactive" || isStudentExpired(user))) {
    const response = NextResponse.json({ ok: true, data: null });
    clearSessionCookie(response);
    return response;
  }

  return NextResponse.json({
    ok: true,
    data: {
      username: user.username,
      role: user.role,
      displayName: user.displayName,
      teacherUsername: user.teacherUsername,
    },
  });
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  clearSessionCookie(response);
  return response;
}
