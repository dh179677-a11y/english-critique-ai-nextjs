import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  getHomePathForRole,
  type AppUser,
  type SessionUser,
  type UserRole,
} from "@/lib/clientAuth";
import { readPortalStore } from "@/lib/portalStore";
import { verifySessionToken } from "@/lib/sessionCookie";

function isStudentExpired(user: AppUser) {
  if (user.role !== "student") return false;
  if (!user.expiryAt) return false;
  return Date.now() > user.expiryAt;
}

export async function getValidatedServerSession(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const session = verifySessionToken(cookieStore.get("ep_session")?.value);
  if (!session) {
    return null;
  }

  const store = await readPortalStore();
  const user = store.users.find(
    (item) => item.username === session.username && item.role === session.role
  );

  if (!user) {
    return null;
  }

  if (user.role === "student" && (user.status === "inactive" || isStudentExpired(user))) {
    return null;
  }

  return {
    username: user.username,
    role: user.role,
    displayName: user.displayName,
    teacherUsername: user.teacherUsername,
  };
}

export async function requireServerSession(allowedRoles?: UserRole[]) {
  const session = await getValidatedServerSession();
  if (!session) {
    redirect("/login");
  }

  if (allowedRoles?.length && !allowedRoles.includes(session.role)) {
    redirect(getHomePathForRole(session.role));
  }

  return session;
}
