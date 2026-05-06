"use client";

import React, { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  clearSessionUser,
  getHomePathForRole,
  setSessionUser,
  type UserRole,
} from "@/lib/clientAuth";
import { getServerSession } from "@/lib/portalClient";

interface AuthGateProps {
  children: React.ReactNode;
  allowedRoles?: UserRole[];
}

const AuthGate: React.FC<AuthGateProps> = ({ children, allowedRoles }) => {
  const [ready, setReady] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

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

        if (allowedRoles?.length && !allowedRoles.includes(currentUser.role)) {
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
  }, [allowedRoles, pathname, router]);

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
