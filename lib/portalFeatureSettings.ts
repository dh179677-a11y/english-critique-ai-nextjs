export interface PortalFeatureSettings {
  isSelfPracticeVisible: boolean;
}

export const DEFAULT_PORTAL_FEATURE_SETTINGS: PortalFeatureSettings = {
  isSelfPracticeVisible: false,
};

const PORTAL_FEATURE_SETTINGS_KEY = "ep_portal_feature_settings_v1";
const PORTAL_FEATURE_SETTINGS_EVENT = "ep:portal-feature-settings-change";

const isBrowser = () => typeof window !== "undefined";

const normalizePortalFeatureSettings = (value: unknown): PortalFeatureSettings => {
  if (!value || typeof value !== "object") {
    return DEFAULT_PORTAL_FEATURE_SETTINGS;
  }

  const input = value as Partial<PortalFeatureSettings>;
  return {
    isSelfPracticeVisible:
      typeof input.isSelfPracticeVisible === "boolean"
        ? input.isSelfPracticeVisible
        : DEFAULT_PORTAL_FEATURE_SETTINGS.isSelfPracticeVisible,
  };
};

export const getPortalFeatureSettings = (): PortalFeatureSettings => {
  if (!isBrowser()) {
    return DEFAULT_PORTAL_FEATURE_SETTINGS;
  }

  try {
    const raw = window.localStorage.getItem(PORTAL_FEATURE_SETTINGS_KEY);
    if (!raw) {
      return DEFAULT_PORTAL_FEATURE_SETTINGS;
    }

    return normalizePortalFeatureSettings(JSON.parse(raw));
  } catch {
    return DEFAULT_PORTAL_FEATURE_SETTINGS;
  }
};

export const savePortalFeatureSettings = (settings: PortalFeatureSettings) => {
  if (!isBrowser()) {
    return;
  }

  const normalized = normalizePortalFeatureSettings(settings);
  window.localStorage.setItem(PORTAL_FEATURE_SETTINGS_KEY, JSON.stringify(normalized));
  window.dispatchEvent(
    new CustomEvent<PortalFeatureSettings>(PORTAL_FEATURE_SETTINGS_EVENT, {
      detail: normalized,
    })
  );
};

async function requestPortalFeatureSettings<T>(
  action: "getPortalFeatureSettings" | "setPortalFeatureSettings",
  payload?: Record<string, unknown>
): Promise<T> {
  const response = await fetch("/api/portal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, payload }),
  });

  const json = (await response.json()) as {
    ok: boolean;
    data?: T;
    error?: string;
  };

  if (!response.ok || !json.ok) {
    throw new Error(json.error || "功能开关保存失败");
  }

  return json.data as T;
}

export const hydratePortalFeatureSettings = async () => {
  const settings = await requestPortalFeatureSettings<PortalFeatureSettings>(
    "getPortalFeatureSettings"
  );
  savePortalFeatureSettings(settings);
  return settings;
};

export const persistPortalFeatureSettings = async (
  settings: PortalFeatureSettings
) => {
  const normalized = normalizePortalFeatureSettings(settings);
  savePortalFeatureSettings(normalized);

  const saved = await requestPortalFeatureSettings<PortalFeatureSettings>(
    "setPortalFeatureSettings",
    { settings: normalized }
  );
  savePortalFeatureSettings(saved);
  return saved;
};

export const subscribePortalFeatureSettings = (
  listener: (settings: PortalFeatureSettings) => void
) => {
  if (!isBrowser()) {
    return () => undefined;
  }

  const handleChange = (event?: Event) => {
    if (event instanceof CustomEvent && event.detail) {
      listener(normalizePortalFeatureSettings(event.detail));
      return;
    }

    listener(getPortalFeatureSettings());
  };

  window.addEventListener(PORTAL_FEATURE_SETTINGS_EVENT, handleChange);
  window.addEventListener("storage", handleChange);

  return () => {
    window.removeEventListener(PORTAL_FEATURE_SETTINGS_EVENT, handleChange);
    window.removeEventListener("storage", handleChange);
  };
};
