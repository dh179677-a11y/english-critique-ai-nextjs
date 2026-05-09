"use client";

import React, { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  clearSessionUser,
  getHomePathForRole,
  setSessionUser,
  useSessionProfile,
  type UserRole,
} from "@/lib/clientAuth";
import { getServerSession } from "@/lib/portalClient";

interface AuthGateProps {
  children: React.ReactNode;
  allowedRoles?: UserRole[];
}

const AuthGate: React.FC<AuthGateProps> = ({ children, allowedRoles }) => {
  const cachedSession = useSessionProfile();
  const allowedRoleKey = allowedRoles?.slice().sort().join("|") || "";
  const resolvedAllowedRoles = React.useMemo(
    () => (allowedRoleKey ? (allowedRoleKey.split("|") as UserRole[]) : []),
    [allowedRoleKey]
  );
  const hasCachedAccess =
    !!cachedSession &&
    (!resolvedAllowedRoles.length || resolvedAllowedRoles.includes(cachedSession.role));
  const [ready, setReady] = useState(hasCachedAccess);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (hasCachedAccess) {
      setReady(true);
    }
  }, [hasCachedAccess]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        const currentUser = await getServerSession();

        if (!currentUser) {
          clearSessionUser();
          if (pathname !== "/login" && pathname !== "/register") {
            router.replace("/login");
          }
          return;
        }

        setSessionUser(currentUser);

        if (
          resolvedAllowedRoles.length &&
          !resolvedAllowedRoles.includes(currentUser.role)
        ) {
          router.replace(getHomePathForRole(currentUser.role));
          return;
        }

        if (!cancelled) {
          setReady(true);
        }
      } catch {
        clearSessionUser();
        if (pathname !== "/login" && pathname !== "/register") {
          router.replace("/login");
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [allowedRoleKey, pathname, resolvedAllowedRoles, router]);

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 text-gray-600">
        正在校验登录状态...
      </div>
    );
  }

  return <>{children}</>;
};

export default AuthGate;
