"use client";

import React, { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getSessionUser } from "@/lib/clientAuth";

interface AuthGateProps {
  children: React.ReactNode;
}

const AuthGate: React.FC<AuthGateProps> = ({ children }) => {
  const [ready, setReady] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const currentUser = getSessionUser();

    if (!currentUser) {
      if (pathname !== "/login" && pathname !== "/register") {
        router.replace("/login");
      }
      return;
    }

    setReady(true);
  }, [pathname, router]);

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
