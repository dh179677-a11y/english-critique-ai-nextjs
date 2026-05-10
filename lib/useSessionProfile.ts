"use client";

import { useSyncExternalStore } from "react";

import { getSessionProfile, subscribeSessionProfile } from "@/lib/clientAuth";

export const useSessionProfile = () =>
  useSyncExternalStore(subscribeSessionProfile, getSessionProfile, () => null);
