type VisionContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

type VisionProvider = {
  name: string;
  endpoint: string;
  apiKey: string;
  model: string;
  useXApiKey?: boolean;
};

export type VisionChatOptions = {
  systemPrompt?: string;
  userText: string;
  images?: string[];
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
};

export class VisionChatError extends Error {
  providerErrors: string[];

  constructor(providerErrors: string[]) {
    super(providerErrors.length ? providerErrors.join("；") : "没有可用的视觉模型配置");
    this.name = "VisionChatError";
    this.providerErrors = providerErrors;
  }
}

const getEnv = (name: string) => process.env[name]?.trim() || "";

const joinChatEndpoint = (baseUrl: string) =>
  `${baseUrl.replace(/\/$/, "")}/chat/completions`;

const isSkippedVisionModel = (model: string) => {
  const normalized = model.toLowerCase().replace(/[._]/g, "-");
  return normalized === "doubao-seed-2-0-lite" || normalized.startsWith("doubao-seed-2-0-lite-");
};

const getDoubaoVisionProvider = (): VisionProvider | null => {
  const model = getEnv("DOUBAO_TEXT_IMAGE_MODEL") || getEnv("DOUBAO_VISION_MODEL");
  const apiKey = getEnv("DOUBAO_TEXT_IMAGE_API_KEY") || getEnv("DOUBAO_API_KEY");
  if (!model || !apiKey) return null;
  if (isSkippedVisionModel(model)) return null;

  const baseUrl =
    getEnv("DOUBAO_TEXT_IMAGE_BASE_URL") ||
    getEnv("DOUBAO_CHAT_BASE_URL") ||
    getEnv("DOUBAO_BASE_URL") ||
    "https://ark.cn-beijing.volces.com/api/v3";

  return {
    name: "doubao-vision",
    endpoint: joinChatEndpoint(baseUrl),
    apiKey,
    model,
    useXApiKey: getEnv("DOUBAO_USE_X_API_KEY") === "true",
  };
};

const getLlmProvider = (): VisionProvider | null => {
  if (getEnv("STORYFLOW_USE_LLM_VISION_FALLBACK") !== "true") return null;
  const baseUrl = getEnv("LLM_BASE_URL");
  const apiKey = getEnv("LLM_API_KEY");
  const model = getEnv("LLM_MODEL");
  if (!baseUrl || !apiKey || !model) return null;
  if (isSkippedVisionModel(model)) return null;
  return {
    name: "llm-vision",
    endpoint: joinChatEndpoint(baseUrl),
    apiKey,
    model,
  };
};

export const getVisionProviderSummary = () => {
  const providers = [getDoubaoVisionProvider(), getLlmProvider()].filter(
    (provider): provider is VisionProvider => Boolean(provider)
  );
  return providers.map((provider) => `${provider.name}:${provider.model}`);
};

export const hasVisionChatProvider = () =>
  Boolean(getDoubaoVisionProvider() || getLlmProvider());

const extractAssistantText = (value: unknown) => {
  const response = value as {
    choices?: Array<{
      message?: {
        content?: unknown;
      };
    }>;
  };
  const content = response.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const item = part as { text?: unknown; content?: unknown; value?: unknown };
      if (typeof item.text === "string") return item.text;
      if (typeof item.content === "string") return item.content;
      if (typeof item.value === "string") return item.value;
      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
};

const extractErrorMessage = (raw: string, parsed: unknown) => {
  const value = parsed as {
    error?: { message?: unknown };
    message?: unknown;
  } | null;
  if (typeof value?.error?.message === "string") return value.error.message;
  if (typeof value?.message === "string") return value.message;
  return raw || "vision request failed";
};

const callProvider = async (
  provider: VisionProvider,
  options: VisionChatOptions,
  withResponseFormat: boolean
) => {
  const images = (options.images || []).filter((url) =>
    /^data:image\/|^https?:\/\//i.test(url)
  );
  const content: VisionContentPart[] = [
    {
      type: "text",
      text: options.userText,
    },
    ...images.map((url) => ({
      type: "image_url" as const,
      image_url: { url },
    })),
  ];
  const messages = [
    ...(options.systemPrompt
      ? [
          {
            role: "system",
            content: options.systemPrompt,
          },
        ]
      : []),
    {
      role: "user",
      content,
    },
  ];
  const response = await fetch(provider.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${provider.apiKey}`,
      ...(provider.useXApiKey ? { "X-Api-Key": provider.apiKey } : {}),
    },
    body: JSON.stringify({
      model: provider.model,
      temperature: options.temperature ?? 0,
      max_tokens: options.maxTokens ?? 512,
      ...(withResponseFormat && options.jsonMode
        ? { response_format: { type: "json_object" } }
        : {}),
      messages,
    }),
  });

  const raw = await response.text();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    throw new Error(`${provider.name} ${response.status}: ${extractErrorMessage(raw, parsed)}`);
  }

  const text = extractAssistantText(parsed);
  if (!text) {
    throw new Error(`${provider.name}: empty assistant response`);
  }
  return {
    provider: provider.name,
    model: provider.model,
    text,
  };
};

export const requestVisionChatCompletion = async (options: VisionChatOptions) => {
  const providers = [getDoubaoVisionProvider(), getLlmProvider()].filter(
    (provider): provider is VisionProvider => Boolean(provider)
  );
  const providerErrors: string[] = [];

  for (const provider of providers) {
    try {
      return await callProvider(provider, options, Boolean(options.jsonMode));
    } catch (firstError) {
      if (options.jsonMode) {
        try {
          return await callProvider(provider, options, false);
        } catch (secondError) {
          providerErrors.push(
            secondError instanceof Error
              ? secondError.message
              : `${provider.name}: vision request failed`
          );
          continue;
        }
      }
      providerErrors.push(
        firstError instanceof Error
          ? firstError.message
          : `${provider.name}: vision request failed`
      );
    }
  }

  if (!providers.length) {
    providerErrors.push(
      "缺少视觉模型配置：请配置 DOUBAO_TEXT_IMAGE_MODEL + DOUBAO_TEXT_IMAGE_API_KEY"
    );
  }
  throw new VisionChatError(providerErrors);
};
