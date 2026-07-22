"use client";

import { useEffect, useState } from "react";

import {
  getSessionProfile,
  subscribeSessionProfile,
  type SessionUser,
} from "@/lib/clientAuth";

export const useSessionProfile = () => {
  const [session, setSession] = useState<SessionUser | null>(null);

  useEffect(() => {
    setSession(getSessionProfile());
    return subscribeSessionProfile(() => {
      setSession(getSessionProfile());
    });
  }, []);

  return session;
};
