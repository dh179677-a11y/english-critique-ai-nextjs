"use client";

import React, { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  getHomePathForRole,
  getSessionProfile,
  type UserRole,
} from "@/lib/clientAuth";

interface AuthGateProps {
  children: React.ReactNode;
  allowedRoles?: UserRole[];
}

const AuthGate: React.FC<AuthGateProps> = ({ children, allowedRoles }) => {
  const [ready, setReady] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const currentUser = getSessionProfile();

    if (!currentUser) {
      if (pathname !== "/login" && pathname !== "/register") {
        router.replace("/login");
      }
      return;
    }

    if (allowedRoles?.length && !allowedRoles.includes(currentUser.role)) {
      router.replace(getHomePathForRole(currentUser.role));
      return;
    }

    setReady(true);
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
