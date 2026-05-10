import {
  ensureStoryflowBootstrap,
  fetchAccessibleStoryflowDocuments,
  fetchTeacherStoryflowLibrary,
  persistStoryflowDocument,
  persistStoryflowDocumentOrder,
  persistStoryflowFolder,
  persistStoryflowFolderOrder,
  removeStoryflowDocument,
  removeStoryflowFolder,
  replaceStoryflowDocument,
  replaceStoryflowFolder,
} from "@/lib/storyflowPortalClient";
import type { AnalysisResult } from "@/types";

export interface StoryflowMindMap {
  beginning: string[];
  middle: string[];
  end: string[];
}

export interface StoryflowPageAnalysis {
  pageIndex: number;
  pageTitle: string;
  storyBeat: string;
  visibleText: string;
  clozeHint?: string;
  bilingualHint: string;
  speakingPrompt: string[];
  keyVocabulary: string[];
}

export interface StoryflowAnalysis {
  title: string;
  summary: string;
  fullText: string;
  characters: string[];
  setting: {
    time: string;
    place: string;
  };
  mindMap: StoryflowMindMap;
  pages: StoryflowPageAnalysis[];
  shadowPageTexts?: string[];
  keywords: string[];
  teacherGuide: string[];
}

export interface StoryflowAudioTrack {
  fileName: string;
  mimeType: string;
  objectKey: string;
  durationSec: number;
}

export type StoryflowPageAudioSegmentSlot = "single" | "left" | "right";

export interface StoryflowPageAudioSegment {
  pageIndex: number;
  slot?: StoryflowPageAudioSegmentSlot;
  trackIndex: number;
  startSec: number;
  endSec: number;
}

export interface StoryflowAudioMapping {
  tracks: StoryflowAudioTrack[];
  pageSegments: StoryflowPageAudioSegment[];
}

export interface StoryflowCustomView {
  kind: "single" | "spread";
  pages: Array<number | null>;
}

export interface StoryflowTaskAssessments {
  shadow?: AnalysisResult;
  speaking?: AnalysisResult;
  performance?: AnalysisResult;
}

export interface StoryflowSpeakingPracticeRecord {
  id: string;
  createdAt: number;
  durationSec: number;
  promptRevealCount: number;
  originalRevealCount: number;
  totalPages: number;
  practicedPages: number;
  score: number;
  ratingLabel: string;
  promptViewedTexts: Array<{
    pageIndex: number;
    text: string;
  }>;
  originalViewedTexts: Array<{
    pageIndex: number;
    text: string;
  }>;
}

export type StoryflowPerformanceSectionKey =
  | "imageSorting"
  | "keywords"
  | "sentenceFrames"
  | "storyMap"
  | "performanceTask"
  | "parentTips";

export interface StoryflowPerformanceSectionConfig {
  title: string;
  description: string;
  visible: boolean;
  image?: string;
  content: string[];
}

export interface StoryflowPerformanceConfig {
  sections: Record<StoryflowPerformanceSectionKey, StoryflowPerformanceSectionConfig>;
}

export interface StoryflowFolder {
  id: string;
  teacherUsername: string;
  name: string;
  createdAt: number;
  sortOrder?: number;
}

export interface StoryflowDocument {
  id: string;
  teacherUsername: string;
  sourceName: string;
  createdAt: number;
  updatedAt?: number;
  sortOrder?: number;
  folderId?: string | null;
  category?: string;
  thumbnail?: string;
  thumbnailObjectKey?: string;
  pageCount: number;
  images?: string[];
  pageObjectKeys?: string[];
  sourceAssets?: Array<{
    fileName: string;
    mimeType: string;
    objectKey: string;
  }>;
  customShadowViews?: StoryflowCustomView[];
  shadowAudio?: StoryflowAudioMapping;
  assessments?: StoryflowTaskAssessments;
  speakingPracticeRecords?: StoryflowSpeakingPracticeRecord[];
  performanceConfig?: StoryflowPerformanceConfig;
  pairEditorModePages?: number[];
  analysis: StoryflowAnalysis;
}

const STORYFLOW_KEY = "ep_storyflow_docs_v1";
const STORYFLOW_FOLDER_KEY = "ep_storyflow_folders_v1";
const STORYFLOW_DOCUMENT_CACHE_TTL_MS = 60_000;

const isBrowser = () => typeof window !== "undefined";

const readJson = <T,>(key: string, fallback: T): T => {
  if (!isBrowser()) return fallback;

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const writeJson = (key: string, value: unknown) => {
  if (!isBrowser()) return;
  window.localStorage.setItem(key, JSON.stringify(value));
};

const toFiniteNumber = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const normalizeTeacherUsername = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

const normalizePracticeTextEntries = (
  value: unknown
): StoryflowSpeakingPracticeRecord["promptViewedTexts"] => {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const current = item as { pageIndex?: unknown; text?: unknown };
      const pageIndex = toFiniteNumber(current.pageIndex, -1);
      const text = typeof current.text === "string" ? current.text.trim() : "";
      if (pageIndex < 0 || !text) return null;
      return { pageIndex, text };
    })
    .filter(
      (item): item is StoryflowSpeakingPracticeRecord["promptViewedTexts"][number] =>
        Boolean(item)
    );
};

const normalizeSpeakingPracticeRecords = (value: unknown) => {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const current = item as Partial<StoryflowSpeakingPracticeRecord>;
      const id = typeof current.id === "string" && current.id.trim() ? current.id.trim() : "";
      const createdAt = toFiniteNumber(current.createdAt, Date.now());
      if (!id) return null;

      return {
        id,
        createdAt,
        durationSec: Math.max(0, toFiniteNumber(current.durationSec, 0)),
        promptRevealCount: Math.max(0, toFiniteNumber(current.promptRevealCount, 0)),
        originalRevealCount: Math.max(0, toFiniteNumber(current.originalRevealCount, 0)),
        totalPages: Math.max(0, toFiniteNumber(current.totalPages, 0)),
        practicedPages: Math.max(0, toFiniteNumber(current.practicedPages, 0)),
        score: Math.max(0, Math.min(100, toFiniteNumber(current.score, 0))),
        ratingLabel:
          typeof current.ratingLabel === "string" && current.ratingLabel.trim()
            ? current.ratingLabel.trim()
            : "待评定",
        promptViewedTexts: normalizePracticeTextEntries(current.promptViewedTexts),
        originalViewedTexts: normalizePracticeTextEntries(current.originalViewedTexts),
      } satisfies StoryflowSpeakingPracticeRecord;
    })
    .filter((item): item is StoryflowSpeakingPracticeRecord => Boolean(item))
    .sort((left, right) => right.createdAt - left.createdAt);
};

const PERFORMANCE_SECTION_ORDER: StoryflowPerformanceSectionKey[] = [
  "imageSorting",
  "keywords",
  "sentenceFrames",
  "storyMap",
  "performanceTask",
  "parentTips",
];

const PERFORMANCE_SECTION_TITLES: Record<StoryflowPerformanceSectionKey, string> = {
  imageSorting: "图片排序卡",
  keywords: "关键词卡",
  sentenceFrames: "支架句型卡",
  storyMap: "故事地图",
  performanceTask: "脱稿表演任务单",
  parentTips: "家长陪练提示语",
};

const normalizeStringArray = (value: unknown, limit = 8) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .slice(0, limit);
};

const normalizeShadowPageTexts = (value: unknown, pageCount: number) => {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, Math.max(0, pageCount))
    .map((item) => (typeof item === "string" ? item : ""));
};

const normalizeStoryflowPages = (value: unknown, pageCount: number): StoryflowPageAnalysis[] => {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const current = item as Partial<StoryflowPageAnalysis>;
      const pageIndex = toFiniteNumber(current.pageIndex, -1);
      if (pageIndex < 0 || pageIndex >= pageCount) return null;

      return {
        pageIndex,
        pageTitle:
          typeof current.pageTitle === "string" && current.pageTitle.trim()
            ? current.pageTitle.trim()
            : `Page ${pageIndex + 1}`,
        storyBeat: typeof current.storyBeat === "string" ? current.storyBeat : "",
        visibleText: typeof current.visibleText === "string" ? current.visibleText : "",
        clozeHint: typeof current.clozeHint === "string" ? current.clozeHint : "",
        bilingualHint: typeof current.bilingualHint === "string" ? current.bilingualHint : "",
        speakingPrompt: normalizeStringArray(current.speakingPrompt, 8),
        keyVocabulary: normalizeStringArray(current.keyVocabulary, 8),
      } satisfies StoryflowPageAnalysis;
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((left, right) => left.pageIndex - right.pageIndex);
};

const normalizeCustomShadowViews = (
  value: unknown,
  pageCount: number
): StoryflowCustomView[] | undefined => {
  if (!Array.isArray(value) || pageCount <= 0) return undefined;

  const normalized = value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const current = item as Partial<StoryflowCustomView>;

      if (current.kind === "single") {
        const page = toFiniteNumber(current.pages?.[0], -1);
        if (page < 0 || page >= pageCount) return null;
        return { kind: "single", pages: [page] } satisfies StoryflowCustomView;
      }

      if (current.kind === "spread") {
        const leftRaw = current.pages?.[0];
        const rightRaw = current.pages?.[1];
        const left =
          leftRaw === null ? null : typeof leftRaw === "number" && leftRaw >= 0 && leftRaw < pageCount ? leftRaw : null;
        const right =
          rightRaw === null
            ? null
            : typeof rightRaw === "number" && rightRaw >= 0 && rightRaw < pageCount
              ? rightRaw
              : null;

        if (left === null && right === null) return null;
        if (typeof left === "number" && typeof right === "number" && left === right) {
          return { kind: "single", pages: [left] } satisfies StoryflowCustomView;
        }

        return { kind: "spread", pages: [left, right] } satisfies StoryflowCustomView;
      }

      return null;
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  return normalized.length ? normalized : undefined;
};

const dedupeStrings = (items: string[], limit = 8) => {
  const seen = new Set<string>();
  const next: string[] = [];

  items.forEach((item) => {
    const normalized = item.trim();
    if (!normalized) return;
    const key = normalized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    next.push(normalized);
  });

  return next.slice(0, limit);
};

const normalizeAudioSegmentSlot = (
  value: unknown
): StoryflowPageAudioSegmentSlot => {
  return value === "left" || value === "right" || value === "single" ? value : "single";
};

export const buildDefaultStoryflowPerformanceConfig = (
  analysis: StoryflowAnalysis
): StoryflowPerformanceConfig => {
  const imageSortingContent = (analysis.pages || [])
    .map((page, index) => page.pageTitle?.trim() || `第 ${index + 1} 页`)
    .filter(Boolean)
    .slice(0, 6);
  const sentenceFrames = dedupeStrings(
    (analysis.pages || []).flatMap((page) => page.speakingPrompt || []),
    4
  );
  const storyMapItems = [
    ...(analysis.mindMap?.beginning || []).slice(0, 2).map((item) => `开头：${item}`),
    ...(analysis.mindMap?.middle || []).slice(0, 2).map((item) => `经过：${item}`),
    ...(analysis.mindMap?.end || []).slice(0, 2).map((item) => `结尾：${item}`),
  ].filter(Boolean);
  const parentTips =
    normalizeStringArray(analysis.teacherGuide, 4).length > 0
      ? normalizeStringArray(analysis.teacherGuide, 4)
      : [
          "先请孩子自己观察图片，再用问题提示回忆。",
          "多鼓励孩子用完整句表达，不急着直接给答案。",
          "复述时可以加入动作和表情，增强故事感。",
        ];

  return {
    sections: {
      imageSorting: {
        title: PERFORMANCE_SECTION_TITLES.imageSorting,
        description: "让孩子按顺序观察和排列图片，先把故事脉络说清楚。",
        visible: true,
        image: "",
        content: imageSortingContent.length
          ? imageSortingContent
          : ["看图排序", "按顺序说一说", "用一句话概括每页内容"],
      },
      keywords: {
        title: PERFORMANCE_SECTION_TITLES.keywords,
        description: "用关键词快速唤起故事内容，帮助孩子搭建表达支架。",
        visible: true,
        image: "",
        content: normalizeStringArray(analysis.keywords, 8).length
          ? normalizeStringArray(analysis.keywords, 8)
          : ["character", "setting", "problem", "solution"],
      },
      sentenceFrames: {
        title: PERFORMANCE_SECTION_TITLES.sentenceFrames,
        description: "给出开口句型，让孩子更容易连贯表达。",
        visible: true,
        image: "",
        content: sentenceFrames.length
          ? sentenceFrames
          : [
              "At the beginning, ...",
              "Then, ...",
              "After that, ...",
              "In the end, ...",
            ],
      },
      storyMap: {
        title: PERFORMANCE_SECTION_TITLES.storyMap,
        description: "用故事结构帮助孩子抓住开头、经过和结尾。",
        visible: true,
        image: "",
        content: storyMapItems.length
          ? storyMapItems
          : ["开头：人物和场景", "经过：发生了什么", "结尾：结果怎么样"],
      },
      performanceTask: {
        title: PERFORMANCE_SECTION_TITLES.performanceTask,
        description: "把支架整合成脱稿表演任务，逐步完成完整复述。",
        visible: true,
        image: "",
        content: [
          "先按顺序看图，回忆主要情节。",
          "结合关键词和句型，完整复述故事。",
          "加入动作、表情和语气，进行脱稿表演。",
        ],
      },
      parentTips: {
        title: PERFORMANCE_SECTION_TITLES.parentTips,
        description: "给家长一套可直接使用的陪练提醒语。",
        visible: true,
        image: "",
        content: parentTips,
      },
    },
  };
};

const normalizePerformanceSection = (
  value: unknown,
  fallback: StoryflowPerformanceSectionConfig
): StoryflowPerformanceSectionConfig => {
  const item =
    value && typeof value === "object"
      ? (value as Partial<StoryflowPerformanceSectionConfig>)
      : {};

  return {
    title: fallback.title,
    description:
      typeof item.description === "string" && item.description.trim()
        ? item.description.trim()
        : fallback.description,
    visible: typeof item.visible === "boolean" ? item.visible : fallback.visible,
    image:
      typeof item.image === "string" && item.image.trim() ? item.image.trim() : fallback.image,
    content: normalizeStringArray(item.content, 8).length
      ? normalizeStringArray(item.content, 8)
      : fallback.content,
  };
};

const normalizeStoryflowPerformanceConfig = (
  value: unknown,
  analysis: StoryflowAnalysis
): StoryflowPerformanceConfig => {
  const fallback = buildDefaultStoryflowPerformanceConfig(analysis);
  const current =
    value && typeof value === "object"
      ? (value as Partial<StoryflowPerformanceConfig>)
      : {};
  const rawSections =
    current.sections && typeof current.sections === "object" ? current.sections : {};

  return {
    sections: PERFORMANCE_SECTION_ORDER.reduce<
      Record<StoryflowPerformanceSectionKey, StoryflowPerformanceSectionConfig>
    >((result, key) => {
      result[key] = normalizePerformanceSection(
        (rawSections as Partial<
          Record<StoryflowPerformanceSectionKey, StoryflowPerformanceSectionConfig>
        >)[key],
        fallback.sections[key]
      );
      return result;
    }, {} as Record<StoryflowPerformanceSectionKey, StoryflowPerformanceSectionConfig>),
  };
};

export const normalizeStoryflowDocument = (
  value: unknown,
  fallbackOrder = 0
): StoryflowDocument | null => {
  if (!value || typeof value !== "object") return null;

  const item = value as Partial<StoryflowDocument>;
  const teacherUsername = normalizeTeacherUsername(item.teacherUsername);
  const id = typeof item.id === "string" && item.id.trim() ? item.id.trim() : "";
  const analysis =
    item.analysis && typeof item.analysis === "object"
      ? (item.analysis as StoryflowAnalysis)
      : null;

  if (!teacherUsername || !id || !analysis) {
    return null;
  }

  const createdAt = toFiniteNumber(item.createdAt, Date.now());
  const updatedAt = toFiniteNumber(item.updatedAt, createdAt);
  const assetPageCount = Math.max(item.pageObjectKeys?.length || 0, item.images?.length || 0);
  const pageCount = assetPageCount || toFiniteNumber(item.pageCount, 0);
  const normalizedAnalysis: StoryflowAnalysis = {
    ...analysis,
    pages: normalizeStoryflowPages(analysis.pages, pageCount),
    shadowPageTexts: normalizeShadowPageTexts(analysis.shadowPageTexts, pageCount),
  };
  const pairEditorModePages = Array.isArray(item.pairEditorModePages)
    ? item.pairEditorModePages
        .map((entry) => toFiniteNumber(entry, -1))
        .filter((entry, index, collection) =>
          entry >= 0 &&
          entry < pageCount &&
          Number.isInteger(entry) &&
          collection.indexOf(entry) === index
        )
        .sort((left, right) => left - right)
    : [];
  const shadowAudio =
    item.shadowAudio &&
    typeof item.shadowAudio === "object" &&
    Array.isArray(item.shadowAudio.tracks)
      ? {
          tracks: item.shadowAudio.tracks,
          pageSegments: Array.isArray(item.shadowAudio.pageSegments)
            ? item.shadowAudio.pageSegments
                .map((segment) => {
                  if (!segment || typeof segment !== "object") return null;
                  const current = segment as Partial<StoryflowPageAudioSegment>;
                  const pageIndex = toFiniteNumber(current.pageIndex, -1);
                  const trackIndex = toFiniteNumber(current.trackIndex, -1);
                  const startSec = Math.max(0, toFiniteNumber(current.startSec, 0));
                  const endSec = Math.max(startSec + 0.15, toFiniteNumber(current.endSec, startSec + 0.15));
                  if (pageIndex < 0 || pageIndex >= pageCount || trackIndex < 0) return null;
                  return {
                    pageIndex,
                    slot: normalizeAudioSegmentSlot(current.slot),
                    trackIndex,
                    startSec,
                    endSec,
                  } satisfies StoryflowPageAudioSegment;
                })
                .filter(
                  (
                    segment
                  ): segment is {
                    pageIndex: number;
                    slot: StoryflowPageAudioSegmentSlot;
                    trackIndex: number;
                    startSec: number;
                    endSec: number;
                  } => Boolean(segment)
                )
                .sort((left, right) => {
                  if (left.pageIndex !== right.pageIndex) return left.pageIndex - right.pageIndex;
                  const order = { single: 0, left: 1, right: 2 };
                  return order[left.slot || "single"] - order[right.slot || "single"];
                })
            : [],
        }
      : undefined;

  return {
    ...item,
    id,
    teacherUsername,
    sourceName:
      typeof item.sourceName === "string" && item.sourceName.trim()
        ? item.sourceName.trim()
        : analysis.title || "未命名绘本",
    createdAt,
    updatedAt,
    sortOrder: toFiniteNumber(item.sortOrder, fallbackOrder || updatedAt || createdAt),
    folderId:
      typeof item.folderId === "string" && item.folderId.trim()
        ? item.folderId.trim()
        : null,
    category:
      typeof item.category === "string" && item.category.trim()
        ? item.category.trim()
        : "",
    pageCount,
    customShadowViews: normalizeCustomShadowViews(item.customShadowViews, pageCount),
    shadowAudio,
    pairEditorModePages,
    speakingPracticeRecords: normalizeSpeakingPracticeRecords(item.speakingPracticeRecords),
    performanceConfig: normalizeStoryflowPerformanceConfig(item.performanceConfig, normalizedAnalysis),
    analysis: normalizedAnalysis,
  };
};

export const normalizeStoryflowFolder = (
  value: unknown,
  fallbackOrder = 0
): StoryflowFolder | null => {
  if (!value || typeof value !== "object") return null;

  const item = value as Partial<StoryflowFolder>;
  const teacherUsername = normalizeTeacherUsername(item.teacherUsername);
  const id = typeof item.id === "string" && item.id.trim() ? item.id.trim() : "";
  const name = typeof item.name === "string" ? item.name.trim() : "";

  if (!teacherUsername || !id || !name) {
    return null;
  }

  const createdAt = toFiniteNumber(item.createdAt, Date.now());

  return {
    id,
    teacherUsername,
    name,
    createdAt,
    sortOrder: toFiniteNumber(item.sortOrder, fallbackOrder || createdAt),
  };
};

let cachedDocuments: StoryflowDocument[] = [];
let cachedFolders: StoryflowFolder[] = [];
let persistQueue: Promise<void> = Promise.resolve();
const hydratedAccessibleDocumentsAt = new Map<string, number>();
const inFlightAccessibleDocumentRequests = new Map<
  string,
  Promise<StoryflowDocument[]>
>();

const normalizeDocuments = (documents: StoryflowDocument[]) =>
  documents
    .map((item, index) => normalizeStoryflowDocument(item, documents.length - index))
    .filter((item): item is StoryflowDocument => Boolean(item));

const normalizeFolders = (folders: StoryflowFolder[]) =>
  folders
    .map((item, index) => normalizeStoryflowFolder(item, folders.length - index))
    .filter((item): item is StoryflowFolder => Boolean(item));

const setDocumentsCache = (documents: StoryflowDocument[]) => {
  cachedDocuments = normalizeDocuments(documents);
};

const setFoldersCache = (folders: StoryflowFolder[]) => {
  cachedFolders = normalizeFolders(folders);
};

const hasFreshAccessibleDocuments = (teacherUsername: string) => {
  const lastHydratedAt = hydratedAccessibleDocumentsAt.get(teacherUsername) || 0;
  return (
    Date.now() - lastHydratedAt < STORYFLOW_DOCUMENT_CACHE_TTL_MS &&
    cachedDocuments.some((item) => item.teacherUsername === teacherUsername)
  );
};

const queuePersist = (task: () => Promise<void>) => {
  persistQueue = persistQueue
    .catch(() => undefined)
    .then(task)
    .catch((error) => {
      console.error("Failed to persist storyflow library:", error);
    });
  return persistQueue;
};

export const hydrateTeacherStoryflowLibrary = async (teacherUsername: string) => {
  const normalized = teacherUsername.trim();
  if (!normalized) {
    return { documents: [], folders: [] };
  }

  await ensureStoryflowBootstrap();
  const library = await fetchTeacherStoryflowLibrary(normalized);
  setDocumentsCache([
    ...cachedDocuments.filter((item) => item.teacherUsername !== normalized),
    ...library.documents,
  ]);
  setFoldersCache([
    ...cachedFolders.filter((item) => item.teacherUsername !== normalized),
    ...library.folders,
  ]);
  return library;
};

export const hydrateTeacherStoryflowDocuments = async (teacherUsername: string) => {
  const { documents } = await hydrateTeacherStoryflowLibrary(teacherUsername);
  return documents;
};

export const hydrateAccessibleTeacherStoryflowDocuments = async (
  teacherUsername: string
) => {
  const normalized = teacherUsername.trim();
  if (!normalized) return [];

  if (hasFreshAccessibleDocuments(normalized)) {
    return getTeacherStoryflowDocuments(normalized);
  }

  const inFlightRequest = inFlightAccessibleDocumentRequests.get(normalized);
  if (inFlightRequest) {
    return inFlightRequest;
  }

  const request = ensureStoryflowBootstrap()
    .then(() => fetchAccessibleStoryflowDocuments(normalized))
    .then((documents) => {
      setDocumentsCache([
        ...cachedDocuments.filter((item) => item.teacherUsername !== normalized),
        ...documents,
      ]);
      hydratedAccessibleDocumentsAt.set(normalized, Date.now());
      return documents;
    })
    .finally(() => {
      inFlightAccessibleDocumentRequests.delete(normalized);
    });

  inFlightAccessibleDocumentRequests.set(normalized, request);
  return request;
};

export const hydrateTeacherStoryflowFolders = async (teacherUsername: string) => {
  const { folders } = await hydrateTeacherStoryflowLibrary(teacherUsername);
  return folders;
};

export const hydrateStoryflowDocumentsForTeachers = async (teacherUsernames: string[]) => {
  const normalized = Array.from(new Set(teacherUsernames.map((item) => item.trim()).filter(Boolean)));
  await Promise.all(normalized.map((teacherUsername) => hydrateTeacherStoryflowDocuments(teacherUsername)));
  return cachedDocuments;
};

export const hydrateAccessibleStoryflowDocumentsForTeachers = async (
  teacherUsernames: string[]
) => {
  const normalized = Array.from(
    new Set(teacherUsernames.map((item) => item.trim()).filter(Boolean))
  );
  await Promise.all(
    normalized.map((teacherUsername) =>
      hydrateAccessibleTeacherStoryflowDocuments(teacherUsername)
    )
  );
  return cachedDocuments;
};

const getDocSortValue = (item: StoryflowDocument) =>
  toFiniteNumber(item.sortOrder, toFiniteNumber(item.updatedAt, item.createdAt));

const getFolderSortValue = (item: StoryflowFolder) =>
  toFiniteNumber(item.sortOrder, item.createdAt);

export const getTeacherStoryflowDocuments = (
  teacherUsername: string
): StoryflowDocument[] => {
  const normalized = teacherUsername.trim();
  if (!normalized) return [];

  return cachedDocuments
    .filter((item) => item.teacherUsername === normalized)
    .sort((left, right) => {
      const diff = getDocSortValue(right) - getDocSortValue(left);
      return diff !== 0 ? diff : right.createdAt - left.createdAt;
    });
};

export const primeAccessibleTeacherStoryflowDocuments = (
  teacherUsername: string,
  documents: StoryflowDocument[]
) => {
  const normalized = teacherUsername.trim();
  if (!normalized) return [];

  setDocumentsCache([
    ...cachedDocuments.filter((item) => item.teacherUsername !== normalized),
    ...documents,
  ]);
  hydratedAccessibleDocumentsAt.set(normalized, Date.now());
  return getTeacherStoryflowDocuments(normalized);
};

export const getTeacherStoryflowFolders = (
  teacherUsername: string
): StoryflowFolder[] => {
  const normalized = teacherUsername.trim();
  if (!normalized) return [];

  return cachedFolders
    .filter((item) => item.teacherUsername === normalized)
    .sort((left, right) => {
      const diff = getFolderSortValue(right) - getFolderSortValue(left);
      if (diff !== 0) return diff;
      return left.name.localeCompare(right.name, undefined, {
        sensitivity: "base",
        numeric: true,
      });
    });
};

export const saveTeacherStoryflowDocument = (
  teacherUsername: string,
  payload: {
    sourceName: string;
    thumbnail?: string;
    thumbnailObjectKey?: string;
    images?: string[];
    pageObjectKeys?: string[];
    sourceAssets?: Array<{
      fileName: string;
      mimeType: string;
      objectKey: string;
    }>;
    shadowAudio?: StoryflowAudioMapping;
    assessments?: StoryflowTaskAssessments;
    performanceConfig?: StoryflowPerformanceConfig;
    analysis: StoryflowAnalysis;
  }
): StoryflowDocument => {
  const normalized = teacherUsername.trim();
  const timestamp = Date.now();
  const document: StoryflowDocument = {
    id: `story_${timestamp}_${Math.random().toString(36).slice(2, 8)}`,
    teacherUsername: normalized,
    sourceName: payload.sourceName.trim() || payload.analysis.title || "未命名绘本",
    createdAt: timestamp,
    updatedAt: timestamp,
    sortOrder: timestamp,
    folderId: null,
    category: "",
    thumbnail: payload.thumbnail,
    thumbnailObjectKey: payload.thumbnailObjectKey,
    pageCount: payload.pageObjectKeys?.length || payload.images?.length || 0,
    images: payload.images,
    pageObjectKeys: payload.pageObjectKeys,
    sourceAssets: payload.sourceAssets || [],
    customShadowViews: undefined,
    shadowAudio: payload.shadowAudio,
    assessments: payload.assessments,
    performanceConfig: normalizeStoryflowPerformanceConfig(
      payload.performanceConfig,
      payload.analysis
    ),
    analysis: payload.analysis,
  };

  setDocumentsCache([document, ...cachedDocuments]);
  void queuePersist(async () => {
    await persistStoryflowDocument(document);
  });

  return document;
};

export const deleteTeacherStoryflowDocument = (
  teacherUsername: string,
  documentId: string
) => {
  const normalized = teacherUsername.trim();
  if (!normalized || !documentId) return;

  setDocumentsCache(
    cachedDocuments.filter(
      (item) =>
        !(item.teacherUsername === normalized && item.id === documentId)
    )
  );
  void queuePersist(async () => {
    await removeStoryflowDocument(normalized, documentId);
  });
};

export const updateTeacherStoryflowDocument = (
  teacherUsername: string,
  documentId: string,
  updater: (document: StoryflowDocument) => StoryflowDocument
): StoryflowDocument | null => {
  const normalized = teacherUsername.trim();
  if (!normalized || !documentId) return null;

  const all = cachedDocuments;
  let updatedDocument: StoryflowDocument | null = null;

  const next = all.map((item) => {
    if (item.teacherUsername !== normalized || item.id !== documentId) {
      return item;
    }

    const updated = updater(item);
    updatedDocument = {
      ...updated,
      id: item.id,
      teacherUsername: item.teacherUsername,
      createdAt: item.createdAt,
      updatedAt: Date.now(),
      sortOrder: toFiniteNumber(updated.sortOrder, getDocSortValue(item)),
      folderId:
        typeof updated.folderId === "string" && updated.folderId.trim()
          ? updated.folderId.trim()
          : null,
      category:
        typeof updated.category === "string" ? updated.category.trim() : "",
    };
    return updatedDocument;
  });

  setDocumentsCache(next);
  if (updatedDocument) {
    void queuePersist(async () => {
      await replaceStoryflowDocument(normalized, updatedDocument as StoryflowDocument);
    });
  }
  return updatedDocument;
};

export const reorderTeacherStoryflowDocuments = (
  teacherUsername: string,
  orderedDocumentIds: string[]
) => {
  const normalized = teacherUsername.trim();
  if (!normalized) return [];

  const teacherDocs = getTeacherStoryflowDocuments(normalized);
  const teacherDocIds = new Set(teacherDocs.map((item) => item.id));
  const preferredOrder = orderedDocumentIds.filter((id) => teacherDocIds.has(id));
  const remainingIds = teacherDocs
    .map((item) => item.id)
    .filter((id) => !preferredOrder.includes(id));
  const nextOrder = [...preferredOrder, ...remainingIds];
  const baseSortOrder = Date.now() + nextOrder.length;
  const sortOrderById = new Map(
    nextOrder.map((id, index) => [id, baseSortOrder - index] as const)
  );

  const nextDocuments = cachedDocuments.map((item) =>
    item.teacherUsername === normalized && sortOrderById.has(item.id)
      ? {
          ...item,
          sortOrder: sortOrderById.get(item.id),
          updatedAt: item.updatedAt || item.createdAt,
        }
      : item
  );

  setDocumentsCache(nextDocuments);
  void queuePersist(async () => {
    await persistStoryflowDocumentOrder(normalized, nextOrder);
  });
  return getTeacherStoryflowDocuments(normalized);
};

export const createTeacherStoryflowFolder = (
  teacherUsername: string,
  folderName: string
): StoryflowFolder => {
  const normalized = teacherUsername.trim();
  const name = folderName.trim();
  if (!normalized || !name) {
    throw new Error("文件夹名称不能为空。");
  }

  const timestamp = Date.now();
  const folder: StoryflowFolder = {
    id: `story_folder_${timestamp}_${Math.random().toString(36).slice(2, 8)}`,
    teacherUsername: normalized,
    name,
    createdAt: timestamp,
    sortOrder: timestamp,
  };

  setFoldersCache([folder, ...cachedFolders]);
  void queuePersist(async () => {
    await persistStoryflowFolder(folder);
  });
  return folder;
};

export const updateTeacherStoryflowFolder = (
  teacherUsername: string,
  folderId: string,
  updater: (folder: StoryflowFolder) => StoryflowFolder
): StoryflowFolder | null => {
  const normalized = teacherUsername.trim();
  if (!normalized || !folderId) return null;

  let updatedFolder: StoryflowFolder | null = null;
  const nextFolders = cachedFolders.map((item) => {
    if (item.teacherUsername !== normalized || item.id !== folderId) {
      return item;
    }

    const updated = updater(item);
    updatedFolder = {
      ...updated,
      id: item.id,
      teacherUsername: item.teacherUsername,
      createdAt: item.createdAt,
      name: updated.name.trim() || item.name,
      sortOrder: toFiniteNumber(updated.sortOrder, getFolderSortValue(item)),
    };
    return updatedFolder;
  });

  setFoldersCache(nextFolders);
  if (updatedFolder) {
    void queuePersist(async () => {
      await replaceStoryflowFolder(normalized, updatedFolder as StoryflowFolder);
    });
  }
  return updatedFolder;
};

export const deleteTeacherStoryflowFolder = (
  teacherUsername: string,
  folderId: string
) => {
  const normalized = teacherUsername.trim();
  if (!normalized || !folderId) return;

  setFoldersCache(
    cachedFolders.filter(
      (item) => !(item.teacherUsername === normalized && item.id === folderId)
    )
  );

  setDocumentsCache(
    cachedDocuments.map((item) =>
      item.teacherUsername === normalized && item.folderId === folderId
        ? { ...item, folderId: null, updatedAt: Date.now() }
        : item
    )
  );
  void queuePersist(async () => {
    await removeStoryflowFolder(normalized, folderId);
  });
};

export const reorderTeacherStoryflowFolders = (
  teacherUsername: string,
  orderedFolderIds: string[]
) => {
  const normalized = teacherUsername.trim();
  if (!normalized) return [];

  const folders = getTeacherStoryflowFolders(normalized);
  const folderIds = new Set(folders.map((item) => item.id));
  const preferredOrder = orderedFolderIds.filter((id) => folderIds.has(id));
  const remainingIds = folders
    .map((item) => item.id)
    .filter((id) => !preferredOrder.includes(id));
  const nextOrder = [...preferredOrder, ...remainingIds];
  const baseSortOrder = Date.now() + nextOrder.length;
  const sortOrderById = new Map(
    nextOrder.map((id, index) => [id, baseSortOrder - index] as const)
  );

  setFoldersCache(
    cachedFolders.map((item) =>
      item.teacherUsername === normalized && sortOrderById.has(item.id)
        ? { ...item, sortOrder: sortOrderById.get(item.id) }
        : item
    )
  );

  void queuePersist(async () => {
    await persistStoryflowFolderOrder(normalized, nextOrder);
  });
  return getTeacherStoryflowFolders(normalized);
};
