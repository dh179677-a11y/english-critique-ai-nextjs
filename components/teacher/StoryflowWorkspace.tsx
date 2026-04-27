"use client";

import Link from "next/link";
import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import {
  getTeacherStudents,
  type AppUser,
  type SessionUser,
} from "@/lib/clientAuth";
import {
  getTeacherStoryflowAssignments,
  publishStoryflowAssignments,
  type StoryflowAssignment,
  updateStoryflowAssignment,
} from "@/lib/storyflowAssignments";
import type { AnalysisResult } from "@/types";
import {
  buildDefaultStoryflowPerformanceConfig,
  deleteTeacherStoryflowDocument,
  getTeacherStoryflowDocuments,
  saveTeacherStoryflowDocument,
  updateTeacherStoryflowDocument,
  type StoryflowAnalysis,
  type StoryflowAudioTrack,
  type StoryflowCustomView,
  type StoryflowDocument,
  type StoryflowPerformanceConfig,
  type StoryflowPerformanceSectionConfig,
  type StoryflowPerformanceSectionKey,
  type StoryflowSpeakingPracticeRecord,
  type StoryflowTaskAssessments,
} from "@/lib/storyflowStore";
import PerformanceTaskPreview, {
  PERFORMANCE_SECTION_ORDER,
} from "@/components/storyflow/PerformanceTaskPreview";

const MAX_PREVIEW_PAGES = 6;
const MAX_IMAGE_EDGE = 1200;

type TabKey = "mindmap" | "shadow" | "speaking" | "performance" | "feedback";
type ShadowView =
  | { kind: "single"; pages: [number] }
  | { kind: "spread"; pages: [number | null, number | null] };
type StoryflowAssessmentKey = "shadow" | "speaking" | "performance";
type PdfJsModule = Awaited<typeof import("pdfjs-dist/legacy/build/pdf.mjs")>;
type PdfJsDocumentInit = Parameters<PdfJsModule["getDocument"]>[0];

type ShadowReaderHandle = {
  autoplayCurrentPage: () => void;
};

type ShadowRecordingClip = {
  blob: Blob;
  createdAt: number;
  durationSec: number;
};

interface StoryflowWorkspaceProps {
  session: SessionUser;
  initialDocumentId?: string | null;
}

interface PendingAsset {
  sourceFile: File;
  sourceFileName: string;
  sourceMimeType: string;
  previewImages: string[];
}

interface PendingAudioAsset {
  sourceFile: File;
  sourceFileName: string;
  sourceMimeType: string;
  durationSec: number;
}

type StoryflowRematchDiagnostics = {
  tracks: Array<{
    trackIndex: number;
    fileName: string;
    durationSec: number;
    transcriptText?: string;
    segments: Array<{
      startSec: number;
      endSec: number;
      text: string;
    }>;
  }>;
  pages: Array<{
    pageIndex: number;
    pageText: string;
    matchedTrackIndex: number | null;
    matchedTrackFileName: string;
    startSec: number | null;
    endSec: number | null;
    score: number | null;
    matchedText: string;
    accepted?: boolean;
  }>;
};

const STORYFLOW_ASSESSMENT_META: Record<
  StoryflowAssessmentKey,
  {
    title: string;
    homeworkType: string;
    accentClass: string;
    badgeClass: string;
  }
> = {
  shadow: {
    title: "影子跟读得分点评",
    homeworkType: "影子跟读",
    accentClass: "text-emerald-700",
    badgeClass: "bg-emerald-100 text-emerald-700",
  },
  speaking: {
    title: "看图说话得分点评",
    homeworkType: "看图说话",
    accentClass: "text-sky-700",
    badgeClass: "bg-sky-100 text-sky-700",
  },
  performance: {
    title: "脱稿表演得分点评",
    homeworkType: "脱稿表演",
    accentClass: "text-violet-700",
    badgeClass: "bg-violet-100 text-violet-700",
  },
};

const STORYFLOW_SCORE_FIELDS: Array<{
  key: keyof Pick<
    AnalysisResult,
    "fluency" | "pronunciation" | "intonation" | "vocabulary" | "emotion"
  >;
  label: string;
}> = [
  { key: "fluency", label: "流畅度" },
  { key: "pronunciation", label: "发音" },
  { key: "intonation", label: "语调" },
  { key: "vocabulary", label: "词汇" },
  { key: "emotion", label: "表达" },
];

const clampScore = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

const createEmptyAssessmentResult = (
  homeworkType: string,
  bookName: string,
  tutorName: string
): AnalysisResult => ({
  studentName: "",
  bookName,
  homeworkType,
  tutorName,
  fluency: { score: 0, comment: "" },
  pronunciation: { score: 0, comment: "" },
  intonation: { score: 0, comment: "" },
  vocabulary: { score: 0, comment: "" },
  emotion: { score: 0, comment: "" },
  overallComment: "",
  suggestions: [],
  grammarSummary: "",
});

const normalizeAssessmentResult = (
  result: AnalysisResult | undefined,
  homeworkType: string,
  bookName: string,
  tutorName: string
): AnalysisResult => {
  const fallback = createEmptyAssessmentResult(homeworkType, bookName, tutorName);
  if (!result) return fallback;

  return {
    studentName: result.studentName || "",
    bookName: result.bookName || bookName,
    homeworkType: result.homeworkType || homeworkType,
    tutorName: result.tutorName || tutorName,
    fluency: {
      score: clampScore(result.fluency?.score || 0),
      comment: result.fluency?.comment || "",
    },
    pronunciation: {
      score: clampScore(result.pronunciation?.score || 0),
      comment: result.pronunciation?.comment || "",
    },
    intonation: {
      score: clampScore(result.intonation?.score || 0),
      comment: result.intonation?.comment || "",
    },
    vocabulary: {
      score: clampScore(result.vocabulary?.score || 0),
      comment: result.vocabulary?.comment || "",
    },
    emotion: {
      score: clampScore(result.emotion?.score || 0),
      comment: result.emotion?.comment || "",
    },
    overallComment: result.overallComment || "",
    suggestions: Array.isArray(result.suggestions)
      ? result.suggestions.map((item) => item.trim()).filter(Boolean)
      : [],
    grammarSummary: result.grammarSummary || "",
  };
};

const buildStoryflowAssessments = (
  document: StoryflowDocument,
  tutorName: string
): Record<StoryflowAssessmentKey, AnalysisResult> => {
  const bookName = document.analysis.title || document.sourceName || "";
  return {
    shadow: normalizeAssessmentResult(
      document.assessments?.shadow,
      STORYFLOW_ASSESSMENT_META.shadow.homeworkType,
      bookName,
      tutorName
    ),
    speaking: normalizeAssessmentResult(
      document.assessments?.speaking,
      STORYFLOW_ASSESSMENT_META.speaking.homeworkType,
      bookName,
      tutorName
    ),
    performance: normalizeAssessmentResult(
      document.assessments?.performance,
      STORYFLOW_ASSESSMENT_META.performance.homeworkType,
      bookName,
      tutorName
    ),
  };
};

const formatTime = (value: number) =>
  new Date(value).toLocaleString("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const formatAudioSeconds = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(2)}s` : "--";

const isDisplayUrl = (value?: string | null) =>
  typeof value === "string" &&
  (value.startsWith("data:") || value.startsWith("http://") || value.startsWith("https://"));

let pdfJsModulePromise: Promise<PdfJsModule> | null = null;
const PDFJS_VERSION = "5.6.205";
const PDFJS_CDN_CANDIDATES = [
  `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/legacy/build/pdf.mjs`,
  `https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/legacy/build/pdf.mjs?module`,
];
const PDFJS_WORKER_CDN_CANDIDATES = [
  `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/legacy/build/pdf.worker.min.mjs`,
  `https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/legacy/build/pdf.worker.min.mjs?module`,
];

const importPdfJsFromUrl = (url: string) =>
  import(/* webpackIgnore: true */ url) as Promise<PdfJsModule>;

const configurePdfJs = (module: PdfJsModule, preferredWorkerUrl?: string) => {
  const workerUrl = preferredWorkerUrl || PDFJS_WORKER_CDN_CANDIDATES[0];
  if ("GlobalWorkerOptions" in module && module.GlobalWorkerOptions) {
    module.GlobalWorkerOptions.workerSrc = workerUrl;
  }
  return module;
};

const loadPdfJs = async () => {
  if (!pdfJsModulePromise) {
    pdfJsModulePromise = (async () => {
      let lastError: unknown = null;

      for (let index = 0; index < PDFJS_CDN_CANDIDATES.length; index += 1) {
        const url = PDFJS_CDN_CANDIDATES[index];
        try {
          const module = await importPdfJsFromUrl(url);
          return configurePdfJs(module, PDFJS_WORKER_CDN_CANDIDATES[index] || undefined);
        } catch (error) {
          lastError = error;
        }
      }

      try {
        return configurePdfJs(await import("pdfjs-dist/legacy/build/pdf.mjs"));
      } catch (error) {
        lastError = error;
      }

      throw new Error(
        lastError instanceof Error
          ? `PDF 解析组件加载失败：${lastError.message}`
          : "PDF 解析组件加载失败"
      );
    })();
  }

  return pdfJsModulePromise;
};

const parsePageRangeFromAudioName = (
  name: string,
  pageCount = Number.MAX_SAFE_INTEGER
) => {
  const lower = name.toLowerCase();
  const patterns = [
    /(?:^|[\s._-])page[\s._-]?(\d{1,3})\s*[-~]\s*(\d{1,3})(?:[\s._-]|$)/,
    /(?:^|[\s._-])p[\s._-]?(\d{1,3})\s*[-~]\s*(\d{1,3})(?:[\s._-]|$)/,
    /(?:^|[\s._-])(\d{1,3})\s*[-~]\s*(\d{1,3})(?:[\s._-]|$)/,
  ];

  for (const pattern of patterns) {
    const match = lower.match(pattern);
    if (!match?.[1] || !match[2]) continue;
    const startPageNo = Number(match[1]);
    const endPageNo = Number(match[2]);
    if (!Number.isFinite(startPageNo) || !Number.isFinite(endPageNo)) continue;
    const normalizedStart = Math.max(1, Math.min(startPageNo, endPageNo));
    const normalizedEnd = Math.min(pageCount, Math.max(startPageNo, endPageNo));
    if (normalizedStart > normalizedEnd) continue;
    return {
      startPageIndex: normalizedStart - 1,
      endPageIndex: normalizedEnd - 1,
    };
  }

  return null;
};

const parsePageIndexFromAudioName = (name: string, pageCount = Number.MAX_SAFE_INTEGER) => {
  const lower = name.toLowerCase();
  if (parsePageRangeFromAudioName(lower, pageCount)) {
    return null;
  }
  const patterns = [
    /(?:^|[\s._-])page[\s._-]?(\d{1,3})(?:[\s._-]|$)/,
    /(?:^|[\s._-])p[\s._-]?(\d{1,3})(?:[\s._-]|$)/,
    /(?:^|[\s._-])(\d{1,3})(?:[\s._-]|$)/,
  ];
  for (const pattern of patterns) {
    const match = lower.match(pattern);
    if (!match?.[1]) continue;
    const pageNo = Number(match[1]);
    if (Number.isFinite(pageNo) && pageNo >= 1 && pageNo <= pageCount) {
      return pageNo - 1;
    }
  }
  return null;
};

const sortAudioAssets = <T extends { sourceFileName: string }>(items: T[]) =>
  [...items].sort((left, right) => {
    const leftHint = parsePageIndexFromAudioName(left.sourceFileName);
    const rightHint = parsePageIndexFromAudioName(right.sourceFileName);
    const leftRange = parsePageRangeFromAudioName(left.sourceFileName);
    const rightRange = parsePageRangeFromAudioName(right.sourceFileName);
    if (typeof leftHint === "number" && typeof rightHint === "number") {
      return leftHint - rightHint;
    }
    if (typeof leftHint === "number") return -1;
    if (typeof rightHint === "number") return 1;
    if (leftRange && rightRange) {
      return leftRange.startPageIndex - rightRange.startPageIndex;
    }
    if (leftRange) return -1;
    if (rightRange) return 1;
    return left.sourceFileName.localeCompare(right.sourceFileName, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });

const getMediaDuration = (file: File): Promise<number> =>
  new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.src = objectUrl;

    const cleanup = () => {
      URL.revokeObjectURL(objectUrl);
      audio.src = "";
    };

    audio.onloadedmetadata = () => {
      const duration = Number.isFinite(audio.duration) ? Math.max(0, audio.duration) : 0;
      cleanup();
      resolve(duration);
    };
    audio.onerror = () => {
      cleanup();
      resolve(0);
    };
  });

const DEFAULT_AUDIO_SEGMENT_SEC = 3;

const getAudioMimeType = (file: File) => {
  if (file.type && file.type.startsWith("audio/")) {
    return file.type;
  }
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith(".m4a")) return "audio/mp4";
  if (lowerName.endsWith(".wav")) return "audio/wav";
  if (lowerName.endsWith(".ogg")) return "audio/ogg";
  if (lowerName.endsWith(".webm")) return "audio/webm";
  if (lowerName.endsWith(".mp3")) return "audio/mpeg";
  return "audio/mpeg";
};

const getTextWeight = (text: string) => {
  const clean = text.trim();
  if (!clean) return 1;
  const words = clean.split(/\s+/).filter(Boolean).length;
  return Math.max(1, words);
};

const buildAudioMapping = (
  pageCount: number,
  shadowPageTexts: string[],
  tracks: StoryflowAudioTrack[]
) => {
  if (!tracks.length || pageCount <= 0) {
    return {
      tracks,
      pageSegments: [],
    };
  }

  const pageSegments: Array<{
    pageIndex: number;
    trackIndex: number;
    startSec: number;
    endSec: number;
  }> = [];
  const pageIndexes = Array.from({ length: pageCount }, (_, idx) => idx);
  const playablePageIndexes = pageIndexes.filter(
    (pageIndex) => (shadowPageTexts[pageIndex] || "").trim().length > 0
  );

  const parsePageIndexFromFileName = (fileName: string) =>
    parsePageIndexFromAudioName(fileName, pageCount);
  const parsePageRangeFromFileName = (fileName: string) =>
    parsePageRangeFromAudioName(fileName, pageCount);

  const compareNatural = (a: string, b: string) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

  const pushWeightedSegments = (
    targetTrackIndex: number,
    pages: number[],
    totalDuration: number
  ) => {
    if (!pages.length || totalDuration <= 0) {
      pages.forEach((pageIndex) => {
        pageSegments.push({
          pageIndex,
          trackIndex: targetTrackIndex,
          startSec: 0,
          endSec: 0,
        });
      });
      return;
    }

    const weights = pages.map((pageIndex) =>
      getTextWeight(shadowPageTexts[pageIndex] || "")
    );
    const weightSum = weights.reduce((sum, value) => sum + value, 0) || pages.length;
    let cursor = 0;

    pages.forEach((pageIndex, idx) => {
      const ratio = weights[idx] / weightSum;
      const duration = idx === pages.length - 1 ? totalDuration - cursor : totalDuration * ratio;
      const startSec = Math.max(0, cursor);
      const endSec = Math.max(startSec, Math.min(totalDuration, startSec + duration));
      pageSegments.push({
        pageIndex,
        trackIndex: targetTrackIndex,
        startSec,
        endSec,
      });
      cursor = endSec;
    });
  };

  if (!playablePageIndexes.length) {
    return { tracks, pageSegments: [] };
  }

  if (tracks.length === 1) {
    if (playablePageIndexes.length !== 1) {
      return { tracks, pageSegments: [] };
    }
    pageSegments.push({
      pageIndex: playablePageIndexes[0],
      trackIndex: 0,
      startSec: 0,
      endSec: tracks[0].durationSec,
    });
    return { tracks, pageSegments };
  }

  // Explicit mapping by filename page hints (supports partial mapping).
  const orderedTrackMeta = tracks
    .map((track, trackIndex) => ({
      track,
      trackIndex,
      pageIndexHint: parsePageIndexFromFileName(track.fileName),
      pageRangeHint: parsePageRangeFromFileName(track.fileName),
    }))
    .sort((left, right) => {
      if (typeof left.pageIndexHint === "number" && typeof right.pageIndexHint === "number") {
        return left.pageIndexHint - right.pageIndexHint;
      }
      if (typeof left.pageIndexHint === "number") return -1;
      if (typeof right.pageIndexHint === "number") return 1;
      if (left.pageRangeHint && right.pageRangeHint) {
        return left.pageRangeHint.startPageIndex - right.pageRangeHint.startPageIndex;
      }
      if (left.pageRangeHint) return -1;
      if (right.pageRangeHint) return 1;
      return compareNatural(left.track.fileName, right.track.fileName);
    });

  const usedPages = new Set<number>();
  const unmatchedTracks: Array<{ track: StoryflowAudioTrack; trackIndex: number }> = [];

  orderedTrackMeta.forEach((meta) => {
    if (
      typeof meta.pageIndexHint === "number" &&
      meta.pageIndexHint >= 0 &&
      meta.pageIndexHint < pageCount &&
      playablePageIndexes.includes(meta.pageIndexHint) &&
      !usedPages.has(meta.pageIndexHint)
    ) {
      usedPages.add(meta.pageIndexHint);
      pageSegments.push({
        pageIndex: meta.pageIndexHint,
        trackIndex: meta.trackIndex,
        startSec: 0,
        endSec: meta.track.durationSec,
      });
      return;
    }
    if (meta.pageRangeHint) {
      const pageRangeHint = meta.pageRangeHint;
      const rangedPages = pageIndexes.filter(
        (pageIndex) =>
          pageIndex >= pageRangeHint.startPageIndex &&
          pageIndex <= pageRangeHint.endPageIndex &&
          playablePageIndexes.includes(pageIndex) &&
          !usedPages.has(pageIndex)
      );
      if (rangedPages.length) {
        rangedPages.forEach((pageIndex) => {
          usedPages.add(pageIndex);
        });
        pushWeightedSegments(meta.trackIndex, rangedPages, meta.track.durationSec);
        return;
      }
    }
    unmatchedTracks.push({
      track: meta.track,
      trackIndex: meta.trackIndex,
    });
  });

  const unmatchedPages = playablePageIndexes.filter((pageIndex) => !usedPages.has(pageIndex));

  if (unmatchedTracks.length && unmatchedPages.length) {
    const pairCount = Math.min(unmatchedTracks.length, unmatchedPages.length);
    for (let index = 0; index < pairCount; index += 1) {
      pageSegments.push({
        pageIndex: unmatchedPages[index],
        trackIndex: unmatchedTracks[index].trackIndex,
        startSec: 0,
        endSec: unmatchedTracks[index].track.durationSec,
      });
    }
  }

  if (pageSegments.length) {
    const dedup = new Map<number, (typeof pageSegments)[number]>();
    pageSegments.forEach((segment) => {
      if (!dedup.has(segment.pageIndex)) {
        dedup.set(segment.pageIndex, segment);
      }
    });
    const ordered = [...dedup.values()].sort((a, b) => a.pageIndex - b.pageIndex);
    return { tracks, pageSegments: ordered };
  }

  if (tracks.length === playablePageIndexes.length) {
    playablePageIndexes.forEach((pageIndex, trackIndex) => {
      pageSegments.push({
        pageIndex,
        trackIndex,
        startSec: 0,
        endSec: tracks[trackIndex].durationSec,
      });
    });
    return { tracks, pageSegments };
  }

  return { tracks, pageSegments };
};

const getDisplayPageText = (
  _title: string,
  _pageIndex: number | null | undefined,
  rawText: string
) => {
  return rawText.trim();
};

const buildResolvedShadowTexts = (
  analysis: StoryflowAnalysis,
  pageCount: number
) => {
  const pageGroups = new Map<number, StoryflowAnalysis["pages"]>();
  (analysis.pages || []).forEach((page) => {
    const group = pageGroups.get(page.pageIndex) || [];
    group.push(page);
    pageGroups.set(page.pageIndex, group);
  });
  const baseTexts = analysis.shadowPageTexts || [];
  const maxPageIndex =
    (analysis.pages || []).reduce((max, page) => Math.max(max, page.pageIndex + 1), 0);
  const length = Math.max(baseTexts.length, maxPageIndex, pageCount);

  return Array.from({ length }, (_, index) => {
    const pages = pageGroups.get(index) || [];
    const baseText = normalizeStoryText(baseTexts[index] || "");
    if (baseText) {
      return baseText;
    }

    return mergeStoryTextSegments(
      pages.flatMap((page) => [page.visibleText, page.storyBeat])
    );
  });
};

const preserveExistingAudioMapping = (
  shadowAudio: StoryflowDocument["shadowAudio"],
  pageCount: number,
  shadowPageTexts: string[] = []
) => {
  if (!shadowAudio?.tracks?.length) return shadowAudio;

  const nextSegments = (shadowAudio.pageSegments || [])
    .filter(
      (segment) =>
        Number.isFinite(segment.pageIndex) &&
        segment.pageIndex >= 0 &&
        segment.pageIndex < pageCount &&
        (shadowPageTexts[segment.pageIndex] || "").trim().length > 0 &&
        Number.isFinite(segment.trackIndex) &&
        segment.trackIndex >= 0 &&
        segment.trackIndex < shadowAudio.tracks.length
    )
    .sort((left, right) => left.pageIndex - right.pageIndex);

  return {
    tracks: shadowAudio.tracks,
    pageSegments: nextSegments,
  };
};

const renderMergedAudioToWav = async (clips: Blob[]) => {
  const AudioContextCtor =
    typeof window !== "undefined"
      ? window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      : null;

  if (!AudioContextCtor) {
    throw new Error("当前浏览器不支持音频合并");
  }

  const decodeContext = new AudioContextCtor();
  try {
    const buffers = await Promise.all(
      clips.map(async (clip) => decodeContext.decodeAudioData(await clip.arrayBuffer()))
    );

    if (!buffers.length) {
      throw new Error("没有可合并的录音");
    }

    const sampleRate = 16000;
    const totalDuration = buffers.reduce((sum, buffer) => sum + buffer.duration, 0);
    const offlineContext = new OfflineAudioContext(1, Math.ceil(totalDuration * sampleRate), sampleRate);
    let cursorSec = 0;

    buffers.forEach((buffer) => {
      const source = offlineContext.createBufferSource();
      source.buffer = buffer;
      source.connect(offlineContext.destination);
      source.start(cursorSec);
      cursorSec += buffer.duration;
    });

    const rendered = await offlineContext.startRendering();
    const channelData = rendered.getChannelData(0);
    const wavBuffer = new ArrayBuffer(44 + channelData.length * 2);
    const view = new DataView(wavBuffer);

    const writeString = (offset: number, value: string) => {
      for (let index = 0; index < value.length; index += 1) {
        view.setUint8(offset + index, value.charCodeAt(index));
      }
    };

    writeString(0, "RIFF");
    view.setUint32(4, 36 + channelData.length * 2, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, "data");
    view.setUint32(40, channelData.length * 2, true);

    let offset = 44;
    for (let index = 0; index < channelData.length; index += 1) {
      const sample = Math.max(-1, Math.min(1, channelData[index]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }

    return new Blob([wavBuffer], { type: "audio/wav" });
  } finally {
    void decodeContext.close().catch(() => undefined);
  }
};

const moveArrayItem = <T,>(items: T[], fromIndex: number, toIndex: number) => {
  if (
    fromIndex < 0 ||
    fromIndex >= items.length ||
    toIndex < 0 ||
    toIndex >= items.length ||
    fromIndex === toIndex
  ) {
    return [...items];
  }

  const next = [...items];
  const [picked] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, picked);
  return next;
};

const DEFAULT_SPEAKING_PROMPTS = [
  "Who is in this page?",
  "What happened here?",
  "Retell this page in English.",
];

const GENERIC_SPEAKING_PROMPT_PATTERNS = [
  "who is in this page",
  "what happened here",
  "retell this page in english",
  "画面中有谁",
  "他们在做什么",
  "用英文复述这一页的句子",
];

const SPEAKING_STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "this",
  "that",
  "these",
  "those",
  "my",
  "your",
  "his",
  "her",
  "our",
  "their",
  "some",
  "any",
  "one",
  "two",
  "three",
  "and",
  "or",
  "but",
  "to",
  "of",
  "in",
  "on",
  "at",
  "for",
  "with",
  "from",
]);

const COMMON_PAGE_VERBS = new Set([
  "is",
  "are",
  "am",
  "was",
  "were",
  "be",
  "being",
  "been",
  "has",
  "have",
  "had",
  "can",
  "could",
  "will",
  "would",
  "should",
  "do",
  "does",
  "did",
  "go",
  "goes",
  "went",
  "come",
  "comes",
  "came",
  "see",
  "sees",
  "saw",
  "look",
  "looks",
  "looked",
  "play",
  "plays",
  "played",
  "run",
  "runs",
  "ran",
  "sit",
  "sits",
  "sat",
  "say",
  "says",
  "said",
  "like",
  "likes",
  "liked",
  "love",
  "loves",
  "loved",
  "make",
  "makes",
  "made",
  "help",
  "helps",
  "helped",
  "find",
  "finds",
  "found",
  "get",
  "gets",
  "got",
]);

const normalizePromptText = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const normalizeStoryText = (value: string) =>
  value
    .replace(/\s+/g, " ")
    .replace(/\s([,.;:!?])/g, "$1")
    .trim();

const mergeStoryTextSegments = (segments: Array<string | null | undefined>) => {
  const seen = new Set<string>();
  const merged: string[] = [];

  segments.forEach((segment) => {
    const normalized = normalizeStoryText(segment || "");
    if (!normalized) return;
    const dedupKey = normalized.toLowerCase();
    if (seen.has(dedupKey)) return;
    seen.add(dedupKey);
    merged.push(normalized);
  });

  return merged.join(" ");
};

const isGenericSpeakingPrompt = (prompts: string[] | undefined) => {
  if (!prompts?.length) return true;
  return prompts.every((prompt) => {
    const normalized = normalizePromptText(prompt);
    return GENERIC_SPEAKING_PROMPT_PATTERNS.some((pattern) =>
      normalized.includes(pattern)
    );
  });
};

const getSpeakingPromptContext = (visibleText: string) => {
  const rawTokens = visibleText.match(/[A-Za-z']+/g) || [];
  const lowerTokens = rawTokens.map((token) => token.toLowerCase());
  const verbIndex = lowerTokens.findIndex(
    (token) =>
      COMMON_PAGE_VERBS.has(token) || token.endsWith("ed") || token.endsWith("ing")
  );

  const subjectTokens = rawTokens.slice(
    0,
    verbIndex > 0 ? Math.min(verbIndex, 3) : Math.min(2, rawTokens.length)
  );
  const cleanedSubjectTokens = subjectTokens.filter(
    (token) => !SPEAKING_STOP_WORDS.has(token.toLowerCase())
  );
  const subject = cleanedSubjectTokens.join(" ").trim();
  const verb = verbIndex >= 0 ? lowerTokens[verbIndex] : "";
  const focusToken =
    rawTokens
      .slice(verbIndex >= 0 ? verbIndex + 1 : 0)
      .find((token) => !SPEAKING_STOP_WORDS.has(token.toLowerCase())) || "";

  return {
    subject,
    verb,
    focusToken,
  };
};

const buildContentSpeakingPrompts = (visibleText: string) => {
  const normalized = visibleText.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return DEFAULT_SPEAKING_PROMPTS;
  }

  const { subject, verb, focusToken } = getSpeakingPromptContext(normalized);
  const subjectHint = subject || "the main character";
  const focusHint = focusToken || "the key detail";

  let actionPrompt = "What is happening on this page?";
  if (["has", "have", "had"].includes(verb)) {
    actionPrompt = `What does ${subjectHint} have on this page?`;
  } else if (["is", "are", "am", "was", "were", "be", "being", "been"].includes(verb)) {
    actionPrompt = `What is ${subjectHint} like on this page?`;
  } else if (verb) {
    actionPrompt = `What is ${subjectHint} doing on this page?`;
  }

  const recallPrompt =
    focusToken && focusToken.toLowerCase() !== subject.toLowerCase()
      ? `Which key word can help you remember the sentence? Try "${focusHint.toLowerCase()}".`
      : "Can you retell this page with the same sentence pattern as the book?";

  return [
    subject
      ? "Who is this page mainly about?"
      : "Who or what is this page mainly about?",
    actionPrompt,
    recallPrompt.replace(/"[^"]+"/g, "the key word"),
  ];
};

const buildContentTeacherHint = (visibleText: string) => {
  const normalized = visibleText.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "可先引导学生先观察图片，再根据原文复述。";
  }

  const { subject, verb, focusToken } = getSpeakingPromptContext(normalized);
  if (subject && ["has", "have", "had"].includes(verb)) {
    return "可先引导孩子先说出主角，再追问这个角色有什么明显特点。";
  }
  if (subject && verb) {
    return "可先让孩子先说出主角，再回忆这一页发生了什么或做了什么。";
  }
  if (focusToken) {
    return "可先从最显眼的画面细节入手，帮助孩子一步步找回这一页的原句。";
  }
  return "可先引导学生先观察图片，再根据原文复述。";
};

const buildBlankWordHint = (word: string) => {
  const trimmed = word.trim();
  if (trimmed.length <= 1) return trimmed;
  return "_".repeat(Math.max(3, trimmed.length));
};

const buildClozePromptHint = (
  visibleText: string,
  storyKeywords: string[],
  fullText: string,
  pageKeywords: string[]
) => {
  const normalized = normalizeStoryText(visibleText);
  if (!normalized) return "";

  const words = normalized.match(/[A-Za-z']+/g) || [];
  if (!words.length) return normalized;

  const lowerWords = words.map((word) => word.toLowerCase());
  const keywordSet = new Set(storyKeywords.map((word) => word.toLowerCase()));
  const pageKeywordSet = new Set(pageKeywords.map((word) => word.toLowerCase()));
  const fullTextFrequency = new Map<string, number>();

  normalizeStoryText(fullText)
    .toLowerCase()
    .match(/[a-z']+/g)
    ?.forEach((word) => {
      fullTextFrequency.set(word, (fullTextFrequency.get(word) || 0) + 1);
    });

  const candidateIndexes = lowerWords
    .map((word, index) =>
      SPEAKING_STOP_WORDS.has(word) || word.length <= 1 ? -1 : index
    )
    .filter((index) => index >= 0);

  if (!candidateIndexes.length) {
    return normalized.replace(/[A-Za-z']+/g, (word, offset) =>
      offset === 0 ? word : buildBlankWordHint(word)
    );
  }

  const blankCount = Math.max(
    1,
    Math.min(
      candidateIndexes.length,
      candidateIndexes.length >= 9 ? 4 : candidateIndexes.length >= 6 ? 3 : candidateIndexes.length >= 3 ? 2 : 1
    )
  );

  const scoredCandidates = candidateIndexes
    .map((index) => {
      const word = lowerWords[index];
      const frequency = fullTextFrequency.get(word) || 0;
      const isStoryKeyword = keywordSet.has(word);
      const isPageKeyword = pageKeywordSet.has(word);
      const isSubjectOrFocus = (() => {
        const { subject, focusToken } = getSpeakingPromptContext(normalized);
        return (
          subject.toLowerCase().split(/\s+/).includes(word) ||
          focusToken.toLowerCase() === word
        );
      })();

      let score = words[index].length;
      if (isStoryKeyword) score += 12;
      if (isPageKeyword) score += 7;
      if (isSubjectOrFocus) score += 5;
      if (frequency > 1) score += frequency * 2;
      if (index > 0 && index < words.length - 1) score += 1;

      return { index, score };
    })
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.index - right.index;
    });

  const blankIndexes = new Set(
    scoredCandidates.slice(0, blankCount).map((item) => item.index)
  );

  let wordCursor = 0;
  return normalized.replace(/[A-Za-z']+/g, (word) => {
    const currentIndex = wordCursor;
    wordCursor += 1;
    return blankIndexes.has(currentIndex) ? buildBlankWordHint(word) : word;
  });
};

const buildPreviewPagesFromShadowTexts = (
  previousPages: StoryflowAnalysis["pages"],
  shadowTexts: string[]
): StoryflowAnalysis["pages"] => {
  const pageGroups = new Map<number, StoryflowAnalysis["pages"]>();
  previousPages.forEach((page) => {
    const group = pageGroups.get(page.pageIndex) || [];
    group.push(page);
    pageGroups.set(page.pageIndex, group);
  });
  const maxPageIndex = previousPages.reduce((max, page) => Math.max(max, page.pageIndex + 1), 0);
  const targetCount = Math.max(maxPageIndex, shadowTexts.length, 1);

  return Array.from({ length: targetCount }, (_, index) => {
    const previousGroup = pageGroups.get(index) || [];
    const previous = previousGroup[0];
    const baseText = normalizeStoryText(shadowTexts[index] || "");
    const visibleText =
      baseText ||
      mergeStoryTextSegments(
        previousGroup.flatMap((page) => [page.visibleText, page.storyBeat])
      );
    const words = visibleText
      .split(/[^A-Za-z']+/)
      .map((item) => item.trim().toLowerCase())
      .filter((item) => item.length > 1);
    const keyVocabulary = Array.from(new Set(words)).slice(0, 6);

    return {
      pageIndex: index,
      pageTitle: previous?.pageTitle || `Page ${index + 1}`,
      storyBeat: visibleText,
      visibleText,
      bilingualHint:
        previous?.bilingualHint && previous.bilingualHint !== "请先观察图片，再根据原文复述。"
          ? previous.bilingualHint
          : buildContentTeacherHint(visibleText),
      speakingPrompt:
        previous?.speakingPrompt?.length && !isGenericSpeakingPrompt(previous.speakingPrompt)
          ? previous.speakingPrompt
          : buildContentSpeakingPrompts(visibleText),
      keyVocabulary,
    };
  });
};

type SpeakingPracticePage = StoryflowAnalysis["pages"][number] & {
  sourcePageIndexes: number[];
};

type SpeakingPracticeDraft = {
  startedAt: number;
  promptRevealCount: number;
  originalRevealCount: number;
  visitedPageIndexes: number[];
  promptViewedTexts: Array<{
    pageIndex: number;
    text: string;
  }>;
  originalViewedTexts: Array<{
    pageIndex: number;
    text: string;
  }>;
};

const scoreSpeakingPractice = ({
  durationSec,
  promptRevealCount,
  originalRevealCount,
  totalPages,
  practicedPages,
}: {
  durationSec: number;
  promptRevealCount: number;
  originalRevealCount: number;
  totalPages: number;
  practicedPages: number;
}) => {
  const safeTotalPages = Math.max(1, totalPages);
  const expectedDurationSec = Math.max(20, safeTotalPages * 18);
  const durationDeltaRatio = Math.min(
    1.4,
    Math.abs(durationSec - expectedDurationSec) / expectedDurationSec
  );
  const durationScore = Math.max(35, Math.round(100 - durationDeltaRatio * 45));
  const coverageScore = Math.round(
    Math.max(0, Math.min(1, practicedPages / safeTotalPages)) * 100
  );
  const promptScore = Math.max(
    35,
    Math.round(100 - promptRevealCount * Math.max(8, Math.round(22 / safeTotalPages)))
  );
  const originalScore = Math.max(
    20,
    Math.round(100 - originalRevealCount * Math.max(14, Math.round(34 / safeTotalPages)))
  );
  const score = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        coverageScore * 0.36 +
          durationScore * 0.18 +
          promptScore * 0.2 +
          originalScore * 0.26
      )
    )
  );

  const ratingLabel =
    score >= 88 ? "A" : score >= 72 ? "B" : "C";

  return {
    score,
    ratingLabel,
  };
};

const formatPracticeDuration = (durationSec: number) => {
  const seconds = Math.max(0, Math.round(durationSec));
  const minutes = Math.floor(seconds / 60);
  const remain = seconds % 60;
  if (minutes <= 0) return `${remain}秒`;
  return `${minutes}分${remain.toString().padStart(2, "0")}秒`;
};

const formatPracticeTime = (timestamp: number) => {
  if (!timestamp) return "";
  const value = new Date(timestamp);
  return `${value.getMonth() + 1}/${value.getDate()} ${value
    .getHours()
    .toString()
    .padStart(2, "0")}:${value.getMinutes().toString().padStart(2, "0")}`;
};

const summarizePracticeTexts = (
  items: Array<{
    pageIndex: number;
    text: string;
  }>
) => {
  if (!items.length) return "无";
  return items
    .slice()
    .sort((left, right) => left.pageIndex - right.pageIndex)
    .map((item) => `P${item.pageIndex + 1}: ${item.text}`)
    .join(" / ");
};

const buildSpeakingPracticePages = (
  previousPages: StoryflowAnalysis["pages"],
  shadowTexts: string[],
  pageObjectKeys: string[]
): SpeakingPracticePage[] => {
  const previewPages = buildPreviewPagesFromShadowTexts(previousPages, shadowTexts);
  const mergedPages: SpeakingPracticePage[] = [];

  previewPages.forEach((page) => {
    const visibleText = normalizeStoryText(page.visibleText || "");
    if (!visibleText) return;

    const pageObjectKey = pageObjectKeys[page.pageIndex] || "";
    const lastPage = mergedPages[mergedPages.length - 1];
    const lastPageObjectKey = lastPage ? pageObjectKeys[lastPage.pageIndex] || "" : "";

    if (lastPage && pageObjectKey && lastPageObjectKey && pageObjectKey === lastPageObjectKey) {
      const mergedText = mergeStoryTextSegments([lastPage.visibleText, visibleText]);
      const words = mergedText
        .split(/[^A-Za-z']+/)
        .map((item) => item.trim().toLowerCase())
        .filter((item) => item.length > 1);

      lastPage.sourcePageIndexes.push(page.pageIndex);
      lastPage.visibleText = mergedText;
      lastPage.storyBeat = mergedText;
      lastPage.bilingualHint = buildContentTeacherHint(mergedText);
      lastPage.speakingPrompt = buildContentSpeakingPrompts(mergedText);
      lastPage.keyVocabulary = Array.from(new Set(words)).slice(0, 6);
      return;
    }

    mergedPages.push({
      ...page,
      visibleText,
      storyBeat: visibleText,
      bilingualHint: buildContentTeacherHint(visibleText),
      speakingPrompt: buildContentSpeakingPrompts(visibleText),
      sourcePageIndexes: [page.pageIndex],
    });
  });

  return mergedPages;
};

const resizeImageFile = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      let { width, height } = img;
      if (width > height && width > MAX_IMAGE_EDGE) {
        height = Math.round((height * MAX_IMAGE_EDGE) / width);
        width = MAX_IMAGE_EDGE;
      } else if (height > MAX_IMAGE_EDGE) {
        width = Math.round((width * MAX_IMAGE_EDGE) / height);
        height = MAX_IMAGE_EDGE;
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");

      if (!context) {
        reject(new Error("图片处理失败"));
        return;
      }

      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      context.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", 0.74));
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("图片加载失败"));
    };

    img.src = objectUrl;
  });

const renderPdfToImages = async (file: File) => {
  const pdfjsLib = await loadPdfJs();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({
    data: arrayBuffer,
    disableWorker: true,
  } as PdfJsDocumentInit).promise;
  const totalPages = pdf.numPages;

  const pickPageNumbers = () => {
    if (totalPages <= MAX_PREVIEW_PAGES) {
      return Array.from({ length: totalPages }, (_, index) => index + 1);
    }

    const middle = Math.max(1, Math.floor(totalPages / 2));
    const candidates = [
      1,
      2,
      middle,
      middle + 1,
      totalPages - 1,
      totalPages,
    ];
    const unique = [...new Set(candidates)]
      .filter((value) => value >= 1 && value <= totalPages)
      .sort((left, right) => left - right);

    // If still not enough (very small books), fill from start.
    while (unique.length < MAX_PREVIEW_PAGES) {
      const next = unique.length + 1;
      if (next > totalPages) break;
      if (!unique.includes(next)) unique.push(next);
    }

    return unique.slice(0, MAX_PREVIEW_PAGES);
  };

  const pageNumbers = pickPageNumbers();
  const images: string[] = [];

  for (const pageNumber of pageNumbers) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1.2 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const context = canvas.getContext("2d");

    if (!context) continue;

    await page.render({
      canvas,
      canvasContext: context,
      viewport,
    }).promise;

    images.push(canvas.toDataURL("image/jpeg", 0.64));
  }

  return images;
};

const normalizePdfText = (value: string) =>
  value
    .replace(/\s+/g, " ")
    .replace(/\s([,.;:!?])/g, "$1")
    .trim();

const normalizeForSimilarity = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const levenshteinDistance = (source: string, target: string) => {
  if (source === target) return 0;
  if (!source.length) return target.length;
  if (!target.length) return source.length;

  const matrix = Array.from({ length: source.length + 1 }, () =>
    Array(target.length + 1).fill(0)
  );
  for (let i = 0; i <= source.length; i += 1) matrix[i][0] = i;
  for (let j = 0; j <= target.length; j += 1) matrix[0][j] = j;

  for (let i = 1; i <= source.length; i += 1) {
    for (let j = 1; j <= target.length; j += 1) {
      const cost = source[i - 1] === target[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[source.length][target.length];
};

const computePronunciationScore = (
  targetText: string,
  spokenText: string,
  recordedDurationSec: number,
  referenceDurationSec: number
) => {
  const target = normalizeForSimilarity(targetText);
  const spoken = normalizeForSimilarity(spokenText);

  let textScore = 0;
  if (target && spoken) {
    const distance = levenshteinDistance(spoken, target);
    const maxLen = Math.max(spoken.length, target.length) || 1;
    const charSimilarity = Math.max(0, 1 - distance / maxLen);

    const targetTokens = target.split(" ").filter(Boolean);
    const spokenTokens = new Set(spoken.split(" ").filter(Boolean));
    const covered = targetTokens.filter((token) => spokenTokens.has(token)).length;
    const tokenCoverage = targetTokens.length ? covered / targetTokens.length : 0;
    textScore = Math.round((charSimilarity * 0.6 + tokenCoverage * 0.4) * 100);
  } else if (target) {
    textScore = 55;
  }

  const durationScore =
    recordedDurationSec > 0 && referenceDurationSec > 0
      ? Math.max(
          0,
          Math.round(
            100 - (Math.abs(recordedDurationSec - referenceDurationSec) / referenceDurationSec) * 120
          )
        )
      : 60;

  const finalScore = Math.max(
    0,
    Math.min(100, Math.round(textScore * 0.78 + durationScore * 0.22))
  );
  return {
    finalScore,
    textScore,
    durationScore,
  };
};

const uploadPdfAllPagesToCos = async (
  file: File,
  onProgress?: (currentPage: number, totalPages: number) => void
) => {
  const pdfjsLib = await loadPdfJs();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({
    data: arrayBuffer,
    disableWorker: true,
  } as PdfJsDocumentInit).promise;
  const totalPages = pdf.numPages;
  const objectKeys: string[] = [];
  const pageTexts: string[] = [];

  for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
    onProgress?.(pageNumber, totalPages);
    // eslint-disable-next-line no-await-in-loop
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1.2 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const context = canvas.getContext("2d");

    if (!context) {
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const textContent = await page.getTextContent();
    const pageText = normalizePdfText(
      (textContent.items as Array<{ str?: string }>)
        .map((item) => (typeof item?.str === "string" ? item.str : ""))
        .filter(Boolean)
        .join(" ")
    );
    pageTexts.push(pageText);

    // eslint-disable-next-line no-await-in-loop
    await page.render({
      canvas,
      canvasContext: context,
      viewport,
    }).promise;

    const dataUrl = canvas.toDataURL("image/jpeg", 0.64);
    // eslint-disable-next-line no-await-in-loop
    const blob = await dataUrlToBlob(dataUrl);
    // eslint-disable-next-line no-await-in-loop
    const objectKey = await uploadBlobToCos(
      `${file.name.replace(/\.[^.]+$/, "")}-page-${pageNumber}.jpg`,
      "image/jpeg",
      blob,
      "page"
    );
    objectKeys.push(objectKey);
  }

  return {
    objectKeys,
    pageTexts,
  };
};

const dataUrlToBlob = async (dataUrl: string) => {
  const response = await fetch(dataUrl);
  return response.blob();
};

const fetchWithTimeout = async (
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number
) => {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timer);
  }
};

const requestUploadTarget = async (
  fileName: string,
  mimeType: string,
  uploadKind: "source" | "page" | "audio"
) => {
  const response = await fetchWithTimeout(
    "/api/storyflow/upload",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        fileName,
        mimeType,
        uploadKind,
      }),
    },
    20000
  );

  const payload = (await response.json()) as
    | { objectKey: string; uploadUrl: string; mimeType: string }
    | { error: string };

  if (!response.ok || "error" in payload) {
    throw new Error("error" in payload ? payload.error : "获取上传签名失败");
  }

  return payload;
};

const uploadBlobToCos = async (
  fileName: string,
  mimeType: string,
  blob: Blob,
  uploadKind: "source" | "page" | "audio"
) => {
  const target = await requestUploadTarget(fileName, mimeType, uploadKind);
  const uploadResponse = await fetchWithTimeout(
    target.uploadUrl,
    {
      method: "PUT",
      headers: {
        "Content-Type": target.mimeType,
      },
      body: blob,
    },
    180000
  );

  if (!uploadResponse.ok) {
    throw new Error(`上传到 COS 失败：${uploadResponse.status}`);
  }

  return target.objectKey;
};

const resolveNeededObjectKeys = (documents: StoryflowDocument[], activeId: string | null) => {
  const keys = new Set<string>();

  for (const item of documents) {
    if (item.thumbnailObjectKey) {
      keys.add(item.thumbnailObjectKey);
    }
    if (item.id === activeId) {
      item.pageObjectKeys?.forEach((key) => keys.add(key));
      item.shadowAudio?.tracks.forEach((track) => keys.add(track.objectKey));
      item.sourceAssets?.forEach((asset) => keys.add(asset.objectKey));
    }
  }

  return [...keys];
};

const StoryflowWorkspace: React.FC<StoryflowWorkspaceProps> = ({
  session,
  initialDocumentId = null,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const replaceImageInputRef = useRef<HTMLInputElement | null>(null);
  const insertImageInputRef = useRef<HTMLInputElement | null>(null);
  const shadowReaderRef = useRef<ShadowReaderHandle | null>(null);
  const [documents, setDocuments] = useState<StoryflowDocument[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("mindmap");
  const [isSidePanelOpen, setIsSidePanelOpen] = useState(false);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isPublishOpen, setIsPublishOpen] = useState(false);
  const [selectedPublishStudentIds, setSelectedPublishStudentIds] = useState<string[]>([]);
  const [replacingPageIndex, setReplacingPageIndex] = useState<number | null>(null);
  const [insertingAfterPageIndex, setInsertingAfterPageIndex] = useState<number | null>(null);
  const [speakingPageIndex, setSpeakingPageIndex] = useState(0);
  const [shadowViewIndex, setShadowViewIndex] = useState(0);
  const [sourceName, setSourceName] = useState("");
  const [pendingAssets, setPendingAssets] = useState<PendingAsset[]>([]);
  const [pendingAudioAssets, setPendingAudioAssets] = useState<PendingAudioAsset[]>([]);
  const [resolvedUrls, setResolvedUrls] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const refreshDocuments = () => {
    const next = getTeacherStoryflowDocuments(session.username);
    setDocuments(next);
    setActiveId((current) => {
      if (current && next.some((item) => item.id === current)) {
        return current;
      }
      if (initialDocumentId && next.some((item) => item.id === initialDocumentId)) {
        return initialDocumentId;
      }
      return next[0]?.id || null;
    });
  };

  useEffect(() => {
    refreshDocuments();
  }, [session.username, initialDocumentId]);

  const pendingImages = useMemo(
    () => pendingAssets.flatMap((asset) => asset.previewImages),
    [pendingAssets]
  );

  const activeDocument = useMemo(
    () => documents.find((item) => item.id === activeId) || null,
    [activeId, documents]
  );
  const teacherStudents = useMemo<AppUser[]>(
    () => getTeacherStudents(session.username),
    [session.username]
  );
  const selectedPublishStudents = useMemo(
    () => teacherStudents.filter((student) => selectedPublishStudentIds.includes(student.id)),
    [selectedPublishStudentIds, teacherStudents]
  );

  useEffect(() => {
    setSpeakingPageIndex(0);
    setShadowViewIndex(0);
  }, [activeId]);

  useEffect(() => {
    setSelectedPublishStudentIds([]);
    setIsPublishOpen(false);
  }, [activeId]);

  useEffect(() => {
    const neededKeys = resolveNeededObjectKeys(documents, activeId).filter(
      (key) => !resolvedUrls[key]
    );

    if (!neededKeys.length) {
      return;
    }

    let disposed = false;

    const resolveUrls = async () => {
      try {
        const response = await fetch("/api/storyflow/urls", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ objectKeys: neededKeys }),
        });

        const payload = (await response.json()) as
          | { urls: Record<string, string> }
          | { error: string };

        if (!response.ok || "error" in payload) {
          throw new Error("error" in payload ? payload.error : "地址生成失败");
        }

        if (!disposed) {
          setResolvedUrls((current) => ({
            ...current,
            ...payload.urls,
          }));
        }
      } catch (resolveError) {
        if (!disposed) {
          setError(
            resolveError instanceof Error ? resolveError.message : "地址生成失败"
          );
        }
      }
    };

    void resolveUrls();

    return () => {
      disposed = true;
    };
  }, [activeId, documents, resolvedUrls]);

  const getDocumentThumbnailUrl = (document: StoryflowDocument) => {
    if (isDisplayUrl(document.thumbnail)) {
      return document.thumbnail!;
    }
    if (document.thumbnailObjectKey) {
      return resolvedUrls[document.thumbnailObjectKey] || "";
    }
    return "";
  };

  const getDocumentPageUrl = (document: StoryflowDocument, pageIndex: number) => {
    const pageObjectKey = document.pageObjectKeys?.[pageIndex];
    if (pageObjectKey) {
      return resolvedUrls[pageObjectKey] || getDocumentThumbnailUrl(document);
    }
    const legacyImage = document.images?.[pageIndex];
    if (isDisplayUrl(legacyImage)) {
      return legacyImage!;
    }
    return getDocumentThumbnailUrl(document);
  };

  const getDocumentAudioTrackUrl = (
    document: StoryflowDocument,
    trackIndex: number
  ) => {
    const track = document.shadowAudio?.tracks?.[trackIndex];
    if (!track) return "";
    return resolvedUrls[track.objectKey] || "";
  };

  const applyDocumentUpdate = (
    documentId: string,
    updater: (document: StoryflowDocument) => StoryflowDocument
  ) => {
    const updated = updateTeacherStoryflowDocument(
      session.username,
      documentId,
      updater
    );
    if (!updated) return null;

    const next = getTeacherStoryflowDocuments(session.username);
    setDocuments(next);
    setActiveId(updated.id);
    return updated;
  };

  const handleMovePage = (fromIndex: number, toIndex: number) => {
    if (!activeDocument) return;

    applyDocumentUpdate(activeDocument.id, (document) => {
      const oldPageKeys = [...(document.pageObjectKeys || [])];
      const oldImages = [...(document.images || [])];
      const oldTexts = Array.from(
        { length: Math.max(oldPageKeys.length, document.analysis.shadowPageTexts?.length || 0) },
        (_, idx) => document.analysis.shadowPageTexts?.[idx] || ""
      );

      const nextPageKeys = moveArrayItem(oldPageKeys, fromIndex, toIndex);
      const nextImages = oldImages.length ? moveArrayItem(oldImages, fromIndex, toIndex) : oldImages;
      const nextTexts = moveArrayItem(oldTexts, fromIndex, toIndex);

      const nextPages = buildPreviewPagesFromShadowTexts(document.analysis.pages || [], nextTexts);
      const nextShadowAudio =
        document.shadowAudio?.tracks?.length
          ? buildAudioMapping(nextPageKeys.length, nextTexts, document.shadowAudio.tracks)
          : document.shadowAudio;

      return {
        ...document,
        pageObjectKeys: nextPageKeys,
        images: nextImages,
        pageCount: nextPageKeys.length || nextImages.length || document.pageCount,
        thumbnailObjectKey: nextPageKeys[0] || document.thumbnailObjectKey,
        analysis: {
          ...document.analysis,
          pages: nextPages,
          shadowPageTexts: nextTexts,
        },
        shadowAudio: nextShadowAudio,
      };
    });
    setShadowViewIndex(0);
    setNotice("页面顺序已更新。");
  };

  const handleSavePageText = (pageIndex: number, text: string) => {
    if (!activeDocument) return;
    applyDocumentUpdate(activeDocument.id, (document) => {
      const size = Math.max(
        document.pageObjectKeys?.length || 0,
        document.analysis.shadowPageTexts?.length || 0
      );
      const nextTexts = Array.from({ length: size }, (_, idx) =>
        document.analysis.shadowPageTexts?.[idx] || ""
      );
      nextTexts[pageIndex] = text.trim();
      const nextPages = buildPreviewPagesFromShadowTexts(document.analysis.pages || [], nextTexts);

      return {
        ...document,
        analysis: {
          ...document.analysis,
          pages: nextPages,
          shadowPageTexts: nextTexts,
        },
        shadowAudio: preserveExistingAudioMapping(document.shadowAudio, size, nextTexts),
      };
    });
    setNotice(`第 ${pageIndex + 1} 页文字已保存。`);
  };

  const handleSaveAllPageTexts = (texts: string[]) => {
    if (!activeDocument) return;
    applyDocumentUpdate(activeDocument.id, (document) => {
      const size = Math.max(
        document.pageObjectKeys?.length || 0,
        document.analysis.shadowPageTexts?.length || 0,
        texts.length
      );
      const nextTexts = Array.from({ length: size }, (_, idx) => (texts[idx] || "").trim());
      const nextPages = buildPreviewPagesFromShadowTexts(document.analysis.pages || [], nextTexts);

      return {
        ...document,
        analysis: {
          ...document.analysis,
          pages: nextPages,
          shadowPageTexts: nextTexts,
          fullText: nextTexts.filter(Boolean).join("\n"),
        },
        shadowAudio: preserveExistingAudioMapping(document.shadowAudio, size, nextTexts),
      };
    });
    setNotice("全部页面文字已保存。");
  };

  const handleRecognizeTexts = async () => {
    if (!activeDocument) return;
    const currentDocumentId = activeDocument.id;
    const currentPageKeys = activeDocument.pageObjectKeys || [];
    if (!currentPageKeys.length) {
      setError("当前文档没有可识别的页面。");
      return;
    }

    setError(null);
    setNotice("正在重新识别页面文本...");

    const currentTexts = buildResolvedShadowTexts(
      activeDocument.analysis,
      currentPageKeys.length || activeDocument.pageCount || 0
    );

    try {
      const response = await fetchWithTimeout(
        "/api/storyflow/analyze",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            sourceName: activeDocument.sourceName || activeDocument.analysis.title || "",
            pageObjectKeys: currentPageKeys,
            previewPageObjectKeys: currentPageKeys.slice(0, MAX_PREVIEW_PAGES),
            providedShadowPageTexts: currentTexts,
          }),
        },
        420000
      );

      const payload = (await response.json()) as StoryflowAnalysis | { error: string };
      if (!response.ok || "error" in payload) {
        throw new Error("error" in payload ? payload.error : "重新识别失败");
      }

      applyDocumentUpdate(currentDocumentId, (document) => {
        const nextTexts = Array.from(
          {
            length: Math.max(
              document.pageObjectKeys?.length || 0,
              payload.shadowPageTexts?.length || 0,
              currentTexts.length
            ),
          },
          (_, idx) => {
            const analyzed = payload.shadowPageTexts?.[idx];
            if (typeof analyzed === "string" && analyzed.trim()) {
              return analyzed.trim();
            }
            const existing = currentTexts[idx];
            return typeof existing === "string" ? existing.trim() : "";
          }
        );
        const nextPages = buildPreviewPagesFromShadowTexts(
          payload.pages?.length ? payload.pages : document.analysis.pages || [],
          nextTexts
        );
        const nextPageCount = document.pageObjectKeys?.length || nextTexts.length;

        return {
          ...document,
          analysis: {
            ...document.analysis,
            ...payload,
            fullText: nextTexts.filter(Boolean).join("\n"),
            pages: nextPages,
            shadowPageTexts: nextTexts,
          },
          shadowAudio: preserveExistingAudioMapping(document.shadowAudio, nextPageCount, nextTexts),
        };
      });

      setNotice("页面文本已重新识别并更新。");
    } catch (recognizeError) {
      setError(
        recognizeError instanceof Error ? recognizeError.message : "重新识别文本失败"
      );
      setNotice(null);
    }
  };

  const handleSaveAudioMapping = (
    pageIndex: number,
    trackIndex: number,
    startSec: number,
    endSec: number
  ) => {
    if (!activeDocument) return;
    applyDocumentUpdate(activeDocument.id, (document) => {
      const tracks = document.shadowAudio?.tracks || [];
      if (!tracks.length) return document;
      const safeTrackIndex = Math.min(Math.max(0, Math.floor(trackIndex)), tracks.length - 1);
      const trackDuration = Math.max(0, tracks[safeTrackIndex].durationSec || 0);
      const safeStart =
        trackDuration > 0
          ? Math.max(0, Math.min(startSec || 0, trackDuration))
          : Math.max(0, startSec || 0);
      const safeEnd =
        trackDuration > 0
          ? Math.max(
              safeStart + 0.2,
              Math.min(Number.isFinite(endSec) ? endSec : trackDuration, trackDuration)
            )
          : Math.max(
              safeStart + 0.2,
              Number.isFinite(endSec) ? endSec : safeStart + DEFAULT_AUDIO_SEGMENT_SEC
            );

      const existing = document.shadowAudio?.pageSegments || [];
      const nextSegments = [
        ...existing.filter((segment) => segment.pageIndex !== pageIndex),
        {
          pageIndex,
          trackIndex: safeTrackIndex,
          startSec: safeStart,
          endSec: safeEnd,
        },
      ].sort((left, right) => left.pageIndex - right.pageIndex);

      return {
        ...document,
        shadowAudio: {
          tracks,
          pageSegments: nextSegments,
        },
      };
    });
    setNotice(`第 ${pageIndex + 1} 页音频映射已保存。`);
  };

  const handleSaveAllAudioMappings = (
    mappings: Array<{
      pageIndex: number;
      trackIndex: number;
      startSec: number;
      endSec: number;
    }>
  ) => {
    if (!activeDocument) return;
    applyDocumentUpdate(activeDocument.id, (document) => {
      const tracks = document.shadowAudio?.tracks || [];
      if (!tracks.length) return document;

      const nextSegments = mappings
        .map((mapping) => {
          const safePageIndex = Math.max(0, Math.floor(mapping.pageIndex));
          const safeTrackIndex = Math.min(
            Math.max(0, Math.floor(mapping.trackIndex)),
            tracks.length - 1
          );
          const trackDuration = Math.max(0, tracks[safeTrackIndex].durationSec || 0);
          const safeStart =
            trackDuration > 0
              ? Math.max(0, Math.min(mapping.startSec || 0, trackDuration))
              : Math.max(0, mapping.startSec || 0);
          const safeEnd =
            trackDuration > 0
              ? Math.max(
                  safeStart + 0.2,
                  Math.min(
                    Number.isFinite(mapping.endSec) ? mapping.endSec : trackDuration,
                    trackDuration
                  )
                )
              : Math.max(
                  safeStart + 0.2,
                  Number.isFinite(mapping.endSec)
                    ? mapping.endSec
                    : safeStart + DEFAULT_AUDIO_SEGMENT_SEC
                );

          return {
            pageIndex: safePageIndex,
            trackIndex: safeTrackIndex,
            startSec: safeStart,
            endSec: safeEnd,
          };
        })
        .filter((segment) => Number.isFinite(segment.pageIndex))
        .sort((left, right) => left.pageIndex - right.pageIndex);

      return {
        ...document,
        shadowAudio: {
          tracks,
          pageSegments: nextSegments,
        },
      };
    });
    setNotice("全部页面音频映射已保存。");
  };

  const handleRematchAudioWithTexts = async (
    texts: string[]
  ): Promise<StoryflowRematchDiagnostics | null> => {
    if (!activeDocument) return null;
    setError(null);
    setNotice("正在识别音频并按页面文字自动匹配...");

    const currentDocumentId = activeDocument.id;
    const currentTracks = activeDocument.shadowAudio?.tracks || [];
    if (!currentTracks.length) {
      setError("没有可用于匹配的音频。");
      return null;
    }

    const size = Math.max(
      activeDocument.pageObjectKeys?.length || 0,
      activeDocument.analysis.shadowPageTexts?.length || 0,
      texts.length
    );
    const nextTexts = Array.from({ length: size }, (_, idx) =>
      (texts[idx] || "").trim()
    );

    try {
      const response = await fetchWithTimeout(
        "/api/storyflow/rematch-audio",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            pageTexts: nextTexts,
            tracks: currentTracks,
          }),
        },
        240000
      );

      const payload = (await response.json()) as
        | {
            matches?: Array<{
              pageIndex?: number;
              trackIndex?: number;
              startSec?: number;
              endSec?: number;
              score?: number;
            }>;
            matchedCount?: number;
            totalPages?: number;
            diagnostics?: StoryflowRematchDiagnostics;
          }
        | { error: string };

      if (!response.ok || "error" in payload) {
        throw new Error("error" in payload ? payload.error : "自动匹配失败");
      }

      const aiMatches = Array.isArray(payload.matches)
        ? payload.matches
            .map((item) => ({
              pageIndex: Number(item.pageIndex),
              trackIndex: Number(item.trackIndex),
              startSec: Number(item.startSec),
              endSec: Number(item.endSec),
              score: Number(item.score),
            }))
            .filter(
              (item) =>
                Number.isFinite(item.pageIndex) &&
                item.pageIndex >= 0 &&
                Number.isFinite(item.trackIndex) &&
                item.trackIndex >= 0 &&
                Number.isFinite(item.startSec) &&
                Number.isFinite(item.endSec)
            )
        : [];

      applyDocumentUpdate(currentDocumentId, (document) => {
        const tracks = document.shadowAudio?.tracks || [];
        if (!tracks.length) return document;
        const exactSegments = aiMatches
          .filter((matched) => (nextTexts[matched.pageIndex] || "").trim().length > 0)
          .map((matched) => {
          const safeTrackIndex = Math.min(
            Math.max(0, Math.floor(matched.trackIndex)),
            tracks.length - 1
          );
          const trackDuration = Math.max(0, tracks[safeTrackIndex]?.durationSec || 0);
          const startSec = Math.max(0, Number(matched.startSec) || 0);
          const endSec = Math.max(startSec + 0.2, Number(matched.endSec) || startSec + 0.2);
          const boundedEnd =
            trackDuration > 0 ? Math.min(trackDuration, endSec) : endSec;
          return {
            pageIndex: matched.pageIndex,
            trackIndex: safeTrackIndex,
            startSec,
            endSec: Math.max(startSec + 0.2, boundedEnd),
          };
        })
        .sort(
          (left, right) => left.pageIndex - right.pageIndex
        );

        const nextPages = buildPreviewPagesFromShadowTexts(
          document.analysis.pages || [],
          nextTexts
        );

        return {
          ...document,
          analysis: {
            ...document.analysis,
            pages: nextPages,
            shadowPageTexts: nextTexts,
          },
          shadowAudio: {
            tracks,
            pageSegments: exactSegments,
          },
        };
      });

      const matchedCount = Number(payload.matchedCount) || aiMatches.length;
      const totalPages =
        Number(payload.totalPages) ||
        nextTexts.filter((item) => item.trim().length > 0).length;
      setNotice(`自动匹配完成：${matchedCount}/${totalPages} 页已按语音定位。`);
      return payload.diagnostics || null;
    } catch (error) {
      applyDocumentUpdate(currentDocumentId, (document) => {
        const tracks = document.shadowAudio?.tracks || [];
        if (!tracks.length) return document;
        const nextPages = buildPreviewPagesFromShadowTexts(
          document.analysis.pages || [],
          nextTexts
        );
        return {
          ...document,
          analysis: {
            ...document.analysis,
            pages: nextPages,
            shadowPageTexts: nextTexts,
          },
          shadowAudio: {
            tracks,
            pageSegments: document.shadowAudio?.pageSegments || [],
          },
        };
      });
      setError(
        error instanceof Error
          ? `自动匹配失败：${error.message}`
          : "自动匹配失败。"
      );
      setNotice(null);
      return null;
    }
  };

  const handleReplacePageImageTrigger = (pageIndex: number) => {
    setReplacingPageIndex(pageIndex);
    replaceImageInputRef.current?.click();
  };

  const handleInsertPageImageTrigger = (pageIndex: number) => {
    setInsertingAfterPageIndex(pageIndex);
    insertImageInputRef.current?.click();
  };

  const handleReplacePageImage = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    try {
      if (!activeDocument || replacingPageIndex === null) return;
      const file = event.target.files?.[0];
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        throw new Error("仅支持图片替换页面");
      }

      setError(null);
      setNotice(`正在替换第 ${replacingPageIndex + 1} 页图片...`);
      const dataUrl = await resizeImageFile(file);
      const blob = await dataUrlToBlob(dataUrl);
      const objectKey = await uploadBlobToCos(
        `${activeDocument.sourceName || "story"}-replace-page-${replacingPageIndex + 1}-${Date.now()}.jpg`,
        "image/jpeg",
        blob,
        "page"
      );

      applyDocumentUpdate(activeDocument.id, (document) => {
        const nextPageKeys = [...(document.pageObjectKeys || [])];
        if (!nextPageKeys.length || replacingPageIndex >= nextPageKeys.length) {
          return document;
        }
        nextPageKeys[replacingPageIndex] = objectKey;

        const currentViews = getEffectiveShadowViews(document);
        const targetViewIndex = currentViews.findIndex((item) =>
          item.pages.some((page) => page === replacingPageIndex)
        );
        const targetView = targetViewIndex >= 0 ? currentViews[targetViewIndex] : null;
        let nextCustomViews = document.customShadowViews;

        // Replace image as spread fill:
        // - if current page belongs to a spread, replace both sides with same image
        // - if current page is single, convert that single to a spread view and use same image
        if (targetView?.kind === "spread") {
          const [leftPage, rightPage] = targetView.pages;
          if (typeof leftPage === "number") {
            nextPageKeys[leftPage] = objectKey;
          }
          if (typeof rightPage === "number") {
            nextPageKeys[rightPage] = objectKey;
          }
          if (typeof leftPage !== "number" || typeof rightPage !== "number") {
            const normalizedViews = serializeCustomViews(currentViews);
            if (targetViewIndex >= 0) {
              normalizedViews[targetViewIndex] = {
                kind: "spread",
                pages: [replacingPageIndex, replacingPageIndex],
              };
              nextCustomViews = normalizedViews;
            }
          }
        } else {
          const normalizedViews = serializeCustomViews(currentViews);
          if (targetViewIndex >= 0) {
            normalizedViews[targetViewIndex] = {
              kind: "spread",
              pages: [replacingPageIndex, replacingPageIndex],
            };
            nextCustomViews = normalizedViews;
          }
        }

        const nextSourceAssets = [
          ...(document.sourceAssets || []),
          {
            fileName: file.name,
            mimeType: "image/jpeg",
            objectKey,
          },
        ];

        return {
          ...document,
          pageObjectKeys: nextPageKeys,
          thumbnailObjectKey:
            replacingPageIndex === 0 ? objectKey : document.thumbnailObjectKey,
          sourceAssets: nextSourceAssets,
          customShadowViews: nextCustomViews,
        };
      });

      setNotice(`第 ${replacingPageIndex + 1} 页图片已替换。`);
    } catch (replaceError) {
      setError(
        replaceError instanceof Error ? replaceError.message : "替换图片失败"
      );
    } finally {
      setReplacingPageIndex(null);
      if (event.target) {
        event.target.value = "";
      }
    }
  };

  const handleInsertPageImage = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    try {
      if (!activeDocument || insertingAfterPageIndex === null) return;
      const file = event.target.files?.[0];
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        throw new Error("新增页面仅支持图片");
      }

      setError(null);
      setNotice(`正在新增页面到第 ${insertingAfterPageIndex + 1} 页之后...`);
      const dataUrl = await resizeImageFile(file);
      const blob = await dataUrlToBlob(dataUrl);
      const objectKey = await uploadBlobToCos(
        `${activeDocument.sourceName || "story"}-insert-page-${Date.now()}.jpg`,
        "image/jpeg",
        blob,
        "page"
      );

      applyDocumentUpdate(activeDocument.id, (document) => {
        const oldPageKeys = [...(document.pageObjectKeys || [])];
        const oldImages = [...(document.images || [])];
        const oldTexts = Array.from(
          {
            length: Math.max(
              oldPageKeys.length,
              document.analysis.shadowPageTexts?.length || 0
            ),
          },
          (_, idx) => document.analysis.shadowPageTexts?.[idx] || ""
        );

        const insertIndex = Math.min(
          Math.max(0, insertingAfterPageIndex + 1),
          oldPageKeys.length
        );
        const nextPageKeys = [...oldPageKeys];
        nextPageKeys.splice(insertIndex, 0, objectKey);
        const nextImages = oldImages.length ? [...oldImages] : oldImages;
        if (nextImages.length) {
          nextImages.splice(insertIndex, 0, "");
        }
        const nextTexts = [...oldTexts];
        nextTexts.splice(insertIndex, 0, "");
        const nextPages = buildPreviewPagesFromShadowTexts(
          document.analysis.pages || [],
          nextTexts
        );
        const nextShadowAudio =
          document.shadowAudio?.tracks?.length
            ? buildAudioMapping(nextPageKeys.length, nextTexts, document.shadowAudio.tracks)
            : document.shadowAudio;

        return {
          ...document,
          pageObjectKeys: nextPageKeys,
          images: nextImages,
          pageCount: nextPageKeys.length || document.pageCount,
          thumbnailObjectKey: nextPageKeys[0] || document.thumbnailObjectKey,
          sourceAssets: [
            ...(document.sourceAssets || []),
            {
              fileName: file.name,
              mimeType: "image/jpeg",
              objectKey,
            },
          ],
          customShadowViews: undefined,
          analysis: {
            ...document.analysis,
            pages: nextPages,
            shadowPageTexts: nextTexts,
          },
          shadowAudio: nextShadowAudio,
        };
      });

      setNotice("页面已新增。");
    } catch (insertError) {
      setError(insertError instanceof Error ? insertError.message : "新增页面失败");
    } finally {
      setInsertingAfterPageIndex(null);
      if (event.target) {
        event.target.value = "";
      }
    }
  };

  const handleDeletePage = (pageIndex: number) => {
    if (!activeDocument) return;
    const pageCount = activeDocument.pageObjectKeys?.length || activeDocument.pageCount || 0;
    if (pageCount <= 1) {
      setError("至少保留 1 页，不能继续删除。");
      return;
    }
    if (!window.confirm(`确认删除第 ${pageIndex + 1} 页吗？`)) return;

    applyDocumentUpdate(activeDocument.id, (document) => {
      const oldPageKeys = [...(document.pageObjectKeys || [])];
      if (pageIndex < 0 || pageIndex >= oldPageKeys.length) return document;
      const oldImages = [...(document.images || [])];
      const oldTexts = Array.from(
        {
          length: Math.max(
            oldPageKeys.length,
            document.analysis.shadowPageTexts?.length || 0
          ),
        },
        (_, idx) => document.analysis.shadowPageTexts?.[idx] || ""
      );

      const nextPageKeys = [...oldPageKeys];
      nextPageKeys.splice(pageIndex, 1);
      const nextImages = oldImages.length ? [...oldImages] : oldImages;
      if (nextImages.length > pageIndex) {
        nextImages.splice(pageIndex, 1);
      }
      const nextTexts = [...oldTexts];
      if (nextTexts.length > pageIndex) {
        nextTexts.splice(pageIndex, 1);
      }
      const nextPages = buildPreviewPagesFromShadowTexts(
        document.analysis.pages || [],
        nextTexts
      );
      const nextShadowAudio =
        document.shadowAudio?.tracks?.length
          ? buildAudioMapping(nextPageKeys.length, nextTexts, document.shadowAudio.tracks)
          : document.shadowAudio;

      return {
        ...document,
        pageObjectKeys: nextPageKeys,
        images: nextImages,
        pageCount: nextPageKeys.length || document.pageCount,
        thumbnailObjectKey: nextPageKeys[0] || document.thumbnailObjectKey,
        customShadowViews: undefined,
        analysis: {
          ...document.analysis,
          pages: nextPages,
          shadowPageTexts: nextTexts,
        },
        shadowAudio: nextShadowAudio,
      };
    });
    setNotice(`第 ${pageIndex + 1} 页已删除。`);
    setShadowViewIndex(0);
  };

  const handleSplitView = (viewIndex: number) => {
    if (!activeDocument) return;

    applyDocumentUpdate(activeDocument.id, (document) => {
      const currentViews = getEffectiveShadowViews(document);
      const target = currentViews[viewIndex];
      if (!target || target.kind !== "spread") return document;

      const [left, right] = target.pages;
      const replacements: ShadowView[] = [];
      if (typeof left === "number") replacements.push({ kind: "single", pages: [left] });
      if (typeof right === "number") replacements.push({ kind: "single", pages: [right] });
      if (!replacements.length) return document;

      const nextViews = [
        ...currentViews.slice(0, viewIndex),
        ...replacements,
        ...currentViews.slice(viewIndex + 1),
      ];

      return {
        ...document,
        customShadowViews: serializeCustomViews(nextViews),
      };
    });
    setNotice("已拆开当前对页。");
    setShadowViewIndex(0);
  };

  const handleMergeWithNextView = (viewIndex: number) => {
    if (!activeDocument) return;

    applyDocumentUpdate(activeDocument.id, (document) => {
      const currentViews = getEffectiveShadowViews(document);
      const first = currentViews[viewIndex];
      const second = currentViews[viewIndex + 1];
      if (!first || !second || first.kind !== "single" || second.kind !== "single") {
        return document;
      }

      const nextViews: ShadowView[] = [
        ...currentViews.slice(0, viewIndex),
        {
          kind: "spread",
          pages: [first.pages[0], second.pages[0]],
        },
        ...currentViews.slice(viewIndex + 2),
      ];

      return {
        ...document,
        customShadowViews: serializeCustomViews(nextViews),
      };
    });
    setNotice("已组合为对页。");
    setShadowViewIndex(0);
  };

  const handleChooseFiles = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;

    setError(null);
    setNotice(null);

    try {
      const nextAssets: PendingAsset[] = [];
      let currentPageCount = pendingImages.length;

      for (const file of files) {
        if (currentPageCount >= MAX_PREVIEW_PAGES) {
          break;
        }

        if (file.type === "application/pdf") {
          const pdfImages = await renderPdfToImages(file);
          const remaining = Math.max(0, MAX_PREVIEW_PAGES - currentPageCount);
          const limitedImages = pdfImages.slice(0, remaining);
          if (limitedImages.length) {
            nextAssets.push({
              sourceFile: file,
              sourceFileName: file.name,
              sourceMimeType: file.type,
              previewImages: limitedImages,
            });
            currentPageCount += limitedImages.length;
          }
          if (!sourceName) {
            setSourceName(file.name.replace(/\.pdf$/i, ""));
          }
          continue;
        }

        if (file.type.startsWith("image/")) {
          nextAssets.push({
            sourceFile: file,
            sourceFileName: file.name,
            sourceMimeType: file.type,
            previewImages: [await resizeImageFile(file)],
          });
          currentPageCount += 1;
          if (!sourceName) {
            setSourceName(file.name.replace(/\.[^.]+$/, ""));
          }
        }
      }

      const mergedAssets = [...pendingAssets, ...nextAssets];
      const mergedPageCount = mergedAssets.reduce(
        (sum, asset) => sum + asset.previewImages.length,
        0
      );
      if (mergedPageCount > MAX_PREVIEW_PAGES || files.length > nextAssets.length) {
        setNotice(`预览最多展示 ${MAX_PREVIEW_PAGES} 页；分析会基于整本绘本内容。`);
      }
      setPendingAssets(mergedAssets);
    } catch (uploadError) {
      setError(
        uploadError instanceof Error ? uploadError.message : "文件处理失败"
      );
    } finally {
      if (event.target) {
        event.target.value = "";
      }
    }
  };

  const handleChooseAudioFiles = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;

    setError(null);
    setNotice(null);

    try {
      const accepted = files.filter(
        (file) =>
          file.type.startsWith("audio/") ||
          /\.(mp3|m4a|wav|webm|ogg)$/i.test(file.name)
      );

      const nextAudioAssets: PendingAudioAsset[] = [];
      for (const file of accepted) {
        // eslint-disable-next-line no-await-in-loop
        const durationSec = await getMediaDuration(file);
        nextAudioAssets.push({
          sourceFile: file,
          sourceFileName: file.name,
          sourceMimeType: getAudioMimeType(file),
          durationSec,
        });
      }

      setPendingAudioAssets((current) =>
        sortAudioAssets([...current, ...nextAudioAssets])
      );
      if (nextAudioAssets.length) {
        setNotice(
          nextAudioAssets.length === 1
            ? "已添加 1 条音频，分析后会自动匹配到页面。"
            : `已添加 ${nextAudioAssets.length} 条音频，分析后会自动匹配到页面。`
        );
      }
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "音频处理失败");
    } finally {
      if (event.target) {
        event.target.value = "";
      }
    }
  };

  const handleAnalyze = async () => {
    if (!pendingAssets.length || !pendingImages.length) {
      setError("请先上传图片或 PDF");
      return;
    }

    setIsAnalyzing(true);
    setError(null);
    setNotice("正在上传到腾讯 COS...");

    try {
      const sourceAssets: StoryflowDocument["sourceAssets"] = [];
      const pageObjectKeys: string[] = [];
      const previewPageObjectKeys: string[] = [];
      const providedShadowPageTexts: string[] = [];

      for (const asset of pendingAssets) {
        const sourceObjectKey = await uploadBlobToCos(
          asset.sourceFileName,
          asset.sourceMimeType,
          asset.sourceFile,
          "source"
        );

        sourceAssets.push({
          fileName: asset.sourceFileName,
          mimeType: asset.sourceMimeType,
          objectKey: sourceObjectKey,
        });

        if (asset.sourceMimeType === "application/pdf") {
          setNotice("正在渲染 PDF 全部页面并上传到 COS...");
          // eslint-disable-next-line no-await-in-loop
          const pdfPayload = await uploadPdfAllPagesToCos(asset.sourceFile, (current, total) => {
            setNotice(`正在上传 PDF 到腾讯 COS：第 ${current}/${total} 页`);
          });
          const filteredPdf = filterPdfUploadedPages(
            pdfPayload.objectKeys,
            pdfPayload.pageTexts
          );
          pageObjectKeys.push(...filteredPdf.objectKeys);
          previewPageObjectKeys.push(
            ...filteredPdf.objectKeys.slice(0, MAX_PREVIEW_PAGES)
          );
          providedShadowPageTexts.push(...filteredPdf.pageTexts);
        } else {
          for (let index = 0; index < asset.previewImages.length; index += 1) {
            const previewImage = asset.previewImages[index];
            // eslint-disable-next-line no-await-in-loop
            const pageBlob = await dataUrlToBlob(previewImage);
            // eslint-disable-next-line no-await-in-loop
            const pageObjectKey = await uploadBlobToCos(
              `${asset.sourceFileName.replace(/\.[^.]+$/, "")}-page-${index + 1}.jpg`,
              "image/jpeg",
              pageBlob,
              "page"
            );
            pageObjectKeys.push(pageObjectKey);
            providedShadowPageTexts.push("");
            if (previewPageObjectKeys.length < MAX_PREVIEW_PAGES) {
              previewPageObjectKeys.push(pageObjectKey);
            }
          }
        }
      }

      const hasTextLayer = providedShadowPageTexts.some(
        (text) => typeof text === "string" && text.trim().length > 0
      );
      if (providedShadowPageTexts.length > 0 && !hasTextLayer) {
        setNotice("该 PDF 文本层为空，系统将自动启动 OCR 识别页面文字。");
      }

      setNotice("正在基于 COS 文件生成思维导图...");

      const response = await fetchWithTimeout(
        "/api/storyflow/analyze",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            sourceName: sourceName.trim(),
            pageObjectKeys,
            previewPageObjectKeys,
            providedShadowPageTexts,
          }),
        },
        420000
      );

      const payload = (await response.json()) as StoryflowAnalysis | { error: string };
      if (!response.ok || "error" in payload) {
        throw new Error("error" in payload ? payload.error : "分析失败");
      }

      const normalizedShadowTexts = Array.from(
        {
          length: Math.max(
            pageObjectKeys.length,
            payload.shadowPageTexts?.length || 0
          ),
        },
        (_, idx) => {
          const analyzed = payload.shadowPageTexts?.[idx];
          if (typeof analyzed === "string" && analyzed.trim()) {
            return analyzed.trim();
          }
          const provided = providedShadowPageTexts[idx];
          if (typeof provided === "string" && provided.trim()) {
            return provided.trim();
          }
          return "";
        }
      );
      const normalizedPayload: StoryflowAnalysis = {
        ...payload,
        shadowPageTexts: normalizedShadowTexts,
      };

      const saved = saveTeacherStoryflowDocument(session.username, {
        sourceName: sourceName.trim() || normalizedPayload.title || "未命名绘本",
        thumbnailObjectKey: pageObjectKeys[0],
        pageObjectKeys,
        sourceAssets,
        analysis: normalizedPayload,
      });

      const next = getTeacherStoryflowDocuments(session.username);
      setDocuments(next);
      setActiveId(saved.id);
      setActiveTab("mindmap");
      setPendingAssets([]);
      if (
        normalizedPayload.title &&
        normalizedPayload.title !== "未命名故事" &&
        normalizedPayload.title !== "Untitled Story"
      ) {
        setSourceName(normalizedPayload.title);
      }
      setResolvedUrls((current) => ({
        ...current,
      }));
      setNotice("分析完成，文件已上传到腾讯 COS 并保存到老师端资料库。");
    } catch (requestError) {
      const readableError =
        requestError instanceof DOMException && requestError.name === "AbortError"
          ? "分析超时：请减少页面数量或音频大小后重试。"
          : requestError instanceof Error
            ? requestError.message
            : "分析失败";
      setError(
        readableError
      );
      setNotice(null);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleAttachPendingAudio = async () => {
    if (!activeDocument) {
      setError("请先生成并选中一份图文导学资料，再单独处理音频。");
      return;
    }
    if (!pendingAudioAssets.length) {
      setError("当前没有待处理的音频。");
      return;
    }

    setError(null);
    setNotice("正在上传音频到当前资料...");

    try {
      const uploadedAudioTracks = await Promise.all(
        pendingAudioAssets.map(async (audioAsset) => {
          const mimeType = audioAsset.sourceMimeType || "audio/mpeg";
          const objectKey = await uploadBlobToCos(
            audioAsset.sourceFileName,
            mimeType,
            audioAsset.sourceFile,
            "audio"
          );
          return {
            fileName: audioAsset.sourceFileName,
            mimeType,
            objectKey,
            durationSec: audioAsset.durationSec,
          };
        })
      );

      applyDocumentUpdate(activeDocument.id, (document) => {
        const existingTracks = document.shadowAudio?.tracks || [];
        const nextTracks = [...existingTracks, ...uploadedAudioTracks];
        const nextSourceAssets = [
          ...(document.sourceAssets || []),
          ...uploadedAudioTracks.map((audio) => ({
            fileName: audio.fileName,
            mimeType: audio.mimeType,
            objectKey: audio.objectKey,
          })),
        ];
        const pageCount =
          document.pageObjectKeys?.length ||
          document.analysis.shadowPageTexts?.length ||
          document.pageCount ||
          0;
        const shadowTexts = buildResolvedShadowTexts(document.analysis, pageCount);

        return {
          ...document,
          sourceAssets: nextSourceAssets,
          shadowAudio: {
            tracks: nextTracks,
            pageSegments: [],
          },
        };
      });

      setPendingAudioAssets([]);
      setNotice("音频已添加到当前资料。需要时再点击“识别音频”进行匹配。");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "音频上传失败");
      setNotice(null);
    }
  };

  const handleDelete = (documentId: string) => {
    if (!window.confirm("确认删除这份图文导学资料吗？")) {
      return;
    }

    deleteTeacherStoryflowDocument(session.username, documentId);
    const next = getTeacherStoryflowDocuments(session.username);
    setDocuments(next);
    setActiveId(next[0]?.id || null);
  };

  const handleSaveAssessments = (assessments: StoryflowTaskAssessments) => {
    if (!activeDocument) return;
    applyDocumentUpdate(activeDocument.id, (document) => ({
      ...document,
      assessments: {
        ...document.assessments,
        ...assessments,
      },
    }));
    setNotice("得分点评已保存。");
  };

  const handleSaveSpeakingPracticeRecord = (record: StoryflowSpeakingPracticeRecord) => {
    if (!activeDocument) return;
    applyDocumentUpdate(activeDocument.id, (document) => ({
      ...document,
      speakingPracticeRecords: [record, ...(document.speakingPracticeRecords || [])].slice(0, 30),
    }));
    setNotice(`看图说话练习已记录，评级 ${record.ratingLabel}。`);
  };

  const handlePublishStoryflow = () => {
    if (!activeDocument) return;
    if (!selectedPublishStudents.length) {
      setError("请至少选择 1 名学生。");
      return;
    }

    publishStoryflowAssignments(
      session.username,
      session.displayName || session.username,
      activeDocument,
      selectedPublishStudents.map((student) => ({
        username: student.username,
        displayName: student.displayName,
      }))
    );
    setIsPublishOpen(false);
    setSelectedPublishStudentIds([]);
    setError(null);
    setNotice(`已将《${activeDocument.analysis.title || activeDocument.sourceName}》发布给 ${selectedPublishStudents.length} 名学生。`);
  };

  return (
    <div className="flex flex-col gap-5 xl:grid xl:grid-cols-[340px_minmax(0,1fr)]">
      <aside className="hidden space-y-5 xl:block">
        <SidePanel
          sourceName={sourceName}
          setSourceName={setSourceName}
          fileInputRef={fileInputRef}
          audioInputRef={audioInputRef}
          pendingImages={pendingImages}
          pendingAudioAssets={pendingAudioAssets}
          error={error}
          notice={notice}
          isAnalyzing={isAnalyzing}
          documents={documents}
          activeId={activeId}
          getDocumentThumbnailUrl={getDocumentThumbnailUrl}
          onChooseFiles={handleChooseFiles}
          onChooseAudioFiles={handleChooseAudioFiles}
          onAttachPendingAudio={() => {
            void handleAttachPendingAudio();
          }}
          onAnalyze={handleAnalyze}
          onSelectDocument={(id) => {
            setActiveId(id);
            setActiveTab("mindmap");
          }}
        />
      </aside>

      <section className="space-y-5">
        {activeDocument ? (
          <>
            <div className="overflow-hidden rounded-[1.8rem] bg-gradient-to-r from-sky-100 via-white to-indigo-100 p-5 shadow-[0_20px_60px_rgba(148,163,184,0.12)]">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-center gap-4">
                  {getDocumentThumbnailUrl(activeDocument) ? (
                    <img
                      src={getDocumentThumbnailUrl(activeDocument)}
                      alt={activeDocument.analysis.title}
                      className="h-20 w-20 rounded-[1.4rem] object-cover shadow-md"
                    />
                  ) : (
                    <div className="grid h-20 w-20 place-items-center rounded-[1.4rem] bg-sky-100 text-2xl font-black text-sky-700 shadow-md">
                      图
                    </div>
                  )}
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-700">
                      Storyflow
                    </p>
                    <h2 className="mt-2 text-[2rem] font-black text-slate-900">
                      {activeDocument.analysis.title}
                    </h2>
                    <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-600">
                      {activeDocument.analysis.summary || "暂无摘要。"}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => setIsSidePanelOpen(true)}
                    className="rounded-full bg-white/70 px-4 py-2 text-sm font-semibold text-slate-800 transition hover:bg-white xl:hidden"
                  >
                    上传/资料库
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsEditorOpen(true)}
                    className="rounded-full bg-white/75 px-4 py-2 text-sm font-semibold text-sky-700 transition hover:bg-white"
                  >
                    页面编辑
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!teacherStudents.length) {
                        setError("当前没有可发布的学生账号。请先在老师端创建学生。");
                        return;
                      }
                      setError(null);
                      setIsPublishOpen(true);
                    }}
                    className="rounded-full bg-white/75 px-4 py-2 text-sm font-semibold text-sky-700 transition hover:bg-white"
                  >
                    发布任务
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(activeDocument.id)}
                    className="rounded-full bg-white/75 px-4 py-2 text-sm font-semibold text-rose-600 transition hover:bg-white"
                  >
                    删除
                  </button>
                </div>
              </div>

              <div className="mt-5 flex flex-nowrap gap-3 overflow-x-auto rounded-[1.55rem] border border-sky-200/60 bg-sky-200/25 p-3 backdrop-blur">
                <TabButton
                  active={activeTab === "mindmap"}
                  onClick={() => setActiveTab("mindmap")}
                >
                  思维导图
                </TabButton>
                <TabButton
                  active={activeTab === "shadow"}
                  onClick={() => {
                    flushSync(() => {
                      setShadowViewIndex(0);
                      setActiveTab("shadow");
                    });
                    shadowReaderRef.current?.autoplayCurrentPage();
                  }}
                >
                  影子跟读
                </TabButton>
                <TabButton
                  active={activeTab === "speaking"}
                  onClick={() => setActiveTab("speaking")}
                >
                  看图说话
                </TabButton>
                <TabButton
                  active={activeTab === "performance"}
                  onClick={() => setActiveTab("performance")}
                >
                  脱稿表演
                </TabButton>
                <TabButton
                  active={activeTab === "feedback"}
                  onClick={() => setActiveTab("feedback")}
                >
                  得分点评
                </TabButton>
              </div>

              <div className="mt-5 flex gap-2 overflow-x-auto md:grid md:grid-cols-4 md:overflow-visible">
                <InfoPill
                  label="角色"
                  value={activeDocument.analysis.characters.join("、") || "未识别"}
                />
                <InfoPill
                  label="时间"
                  value={activeDocument.analysis.setting.time || "未识别"}
                />
                <InfoPill
                  label="地点"
                  value={activeDocument.analysis.setting.place || "未识别"}
                />
                <InfoPill
                  label="关键词"
                  value={
                    activeDocument.analysis.keywords.slice(0, 4).join(" / ") || "暂无"
                  }
                />
              </div>
            </div>

            {activeTab === "mindmap" ? (
              <MindMapBoard document={activeDocument} />
            ) : activeTab === "shadow" ? (
              <ShadowReader
                ref={shadowReaderRef}
                document={activeDocument}
                viewIndex={shadowViewIndex}
                onChangeViewIndex={setShadowViewIndex}
                getDocumentPageUrl={getDocumentPageUrl}
                getAudioTrackUrl={getDocumentAudioTrackUrl}
                savedAssessment={activeDocument.assessments?.shadow || null}
                onAssessmentChange={(result) => {
                  const normalized = normalizeAssessmentResult(
                    result,
                    STORYFLOW_ASSESSMENT_META.shadow.homeworkType,
                    activeDocument.analysis.title || activeDocument.sourceName || "",
                    session.username
                  );
                  applyDocumentUpdate(activeDocument.id, (document) => ({
                    ...document,
                    assessments: {
                      ...document.assessments,
                      shadow: normalized,
                    },
                  }));
                  setNotice("影子跟读评分已保存到得分点评。");
                }}
                onExit={() => setActiveTab("mindmap")}
              />
            ) : activeTab === "speaking" ? (
              <SpeakingDeck
                document={activeDocument}
                pageIndex={speakingPageIndex}
                onChangePageIndex={setSpeakingPageIndex}
                getDocumentPageUrl={getDocumentPageUrl}
                onSavePracticeRecord={handleSaveSpeakingPracticeRecord}
              />
            ) : activeTab === "performance" ? (
              <PerformanceTaskStudio
                document={activeDocument}
                teacherName={session.username}
                coverImageUrl={getDocumentThumbnailUrl(activeDocument)}
                onSaveConfig={(config) => {
                  applyDocumentUpdate(activeDocument.id, (document) => ({
                    ...document,
                    performanceConfig: config,
                  }));
                }}
                onNotice={setNotice}
                onError={setError}
              />
            ) : (
              <ScoreFeedbackBoard
                document={activeDocument}
                teacherName={session.username}
                onSaveAssessments={handleSaveAssessments}
              />
            )}
          </>
        ) : (
          <div className="grid min-h-[540px] place-items-center rounded-[1.8rem] bg-white/70 p-8 text-center shadow-[0_18px_50px_rgba(148,163,184,0.12)]">
            <div>
              <div className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-sky-100 text-3xl font-black text-sky-600">
                图
              </div>
              <h2 className="mt-5 text-3xl font-black text-slate-900">
                先上传一份绘本资料
              </h2>
              <p className="mt-3 max-w-xl text-sm leading-7 text-slate-500">
                这个模块会把老师上传的图片或 PDF 转成故事思维导图，并为每一页生成看图说话引导语。
              </p>
            </div>
          </div>
        )}
      </section>

      {isPublishOpen && activeDocument ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/35 px-4 py-8 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-[1.8rem] bg-white p-5 shadow-[0_24px_80px_rgba(15,23,42,0.24)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-500">
                  发布任务
                </p>
                <h3 className="mt-2 text-2xl font-black text-slate-900">
                  发布《{activeDocument.analysis.title || activeDocument.sourceName}》
                </h3>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  选择特定学生后发布。学生登录后会在任务入口看到并进入全屏练习页面。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsPublishOpen(false)}
                className="rounded-full bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600 transition hover:bg-slate-200"
              >
                关闭
              </button>
            </div>

            <div className="mt-4 max-h-[52vh] space-y-2 overflow-y-auto rounded-[1.4rem] bg-slate-50 p-3">
              {teacherStudents.map((student) => {
                const checked = selectedPublishStudentIds.includes(student.id);
                return (
                  <label
                    key={student.id}
                    className={`flex cursor-pointer items-center justify-between rounded-[1.1rem] border px-4 py-3 transition ${
                      checked
                        ? "border-sky-300 bg-sky-50"
                        : "border-transparent bg-white hover:border-slate-200"
                    }`}
                  >
                    <div>
                      <p className="text-sm font-bold text-slate-900">{student.displayName}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {student.username}
                        {student.className ? ` · ${student.className}` : ""}
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setSelectedPublishStudentIds((current) =>
                          checked
                            ? current.filter((id) => id !== student.id)
                            : [...current, student.id]
                        )
                      }
                      className="h-5 w-5 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                    />
                  </label>
                );
              })}
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-slate-500">
                已选择 <span className="font-bold text-slate-900">{selectedPublishStudents.length}</span> 名学生
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedPublishStudentIds([])}
                  className="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-200"
                >
                  清空
                </button>
                <button
                  type="button"
                  onClick={handlePublishStoryflow}
                  className="rounded-full bg-sky-600 px-5 py-2 text-sm font-bold text-white transition hover:bg-sky-500"
                >
                  发布给学生
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <input
        ref={replaceImageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          void handleReplacePageImage(event);
        }}
      />
      <input
        ref={insertImageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          void handleInsertPageImage(event);
        }}
      />

      {isEditorOpen && activeDocument ? (
        <div className="fixed inset-0 z-[60]">
          <button
            type="button"
            aria-label="close page editor overlay"
            onClick={() => setIsEditorOpen(false)}
            className="absolute inset-0 bg-slate-900/45"
          />
          <div className="absolute inset-x-0 bottom-0 top-4 mx-auto w-[min(1200px,96vw)] overflow-hidden rounded-[1.8rem] border border-white/60 bg-white shadow-[0_30px_80px_rgba(15,23,42,0.32)]">
            <PageEditorPanel
              document={activeDocument}
              views={getEffectiveShadowViews(activeDocument)}
              getDocumentPageUrl={getDocumentPageUrl}
              getDocumentAudioTrackUrl={getDocumentAudioTrackUrl}
              onMovePage={handleMovePage}
              onSavePageText={handleSavePageText}
              onSaveAllPageTexts={handleSaveAllPageTexts}
              onRecognizeTexts={handleRecognizeTexts}
              onSaveAudioMapping={handleSaveAudioMapping}
              onSaveAllAudioMappings={handleSaveAllAudioMappings}
              onRematchAudioWithTexts={handleRematchAudioWithTexts}
              onReplaceImage={handleReplacePageImageTrigger}
              onInsertPage={handleInsertPageImageTrigger}
              onDeletePage={handleDeletePage}
              onSplitView={handleSplitView}
              onMergeView={handleMergeWithNextView}
              onClose={() => setIsEditorOpen(false)}
            />
          </div>
        </div>
      ) : null}

      {isSidePanelOpen ? (
        <div className="fixed inset-0 z-50 xl:hidden">
          <button
            type="button"
            aria-label="close overlay"
            onClick={() => setIsSidePanelOpen(false)}
            className="absolute inset-0 bg-slate-900/35"
          />
          <div className="absolute inset-y-0 left-0 w-[min(420px,100%)] overflow-y-auto border-r border-white/60 bg-white/85 p-4 backdrop-blur">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-900">上传/资料库</p>
              <button
                type="button"
                onClick={() => setIsSidePanelOpen(false)}
                className="rounded-full bg-slate-900 px-3 py-2 text-xs font-semibold text-white"
              >
                关闭
              </button>
            </div>
            <SidePanel
              sourceName={sourceName}
              setSourceName={setSourceName}
              fileInputRef={fileInputRef}
              audioInputRef={audioInputRef}
              pendingImages={pendingImages}
              pendingAudioAssets={pendingAudioAssets}
              error={error}
              notice={notice}
              isAnalyzing={isAnalyzing}
              documents={documents}
              activeId={activeId}
              getDocumentThumbnailUrl={getDocumentThumbnailUrl}
              onChooseFiles={(event) => {
                void handleChooseFiles(event);
              }}
              onChooseAudioFiles={(event) => {
                void handleChooseAudioFiles(event);
              }}
              onAttachPendingAudio={() => {
                void handleAttachPendingAudio();
              }}
              onAnalyze={() => {
                void handleAnalyze();
              }}
              onSelectDocument={(id) => {
                setActiveId(id);
                setActiveTab("mindmap");
                setIsSidePanelOpen(false);
              }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
};

const PageEditorPanel = ({
  document,
  views,
  getDocumentPageUrl,
  getDocumentAudioTrackUrl,
  onMovePage,
  onSavePageText,
  onSaveAllPageTexts,
  onRecognizeTexts,
  onSaveAudioMapping,
  onSaveAllAudioMappings,
  onRematchAudioWithTexts,
  onReplaceImage,
  onInsertPage,
  onDeletePage,
  onSplitView,
  onMergeView,
  onClose,
}: {
  document: StoryflowDocument;
  views: ShadowView[];
  getDocumentPageUrl: (doc: StoryflowDocument, idx: number) => string;
  getDocumentAudioTrackUrl: (doc: StoryflowDocument, trackIndex: number) => string;
  onMovePage: (fromIndex: number, toIndex: number) => void;
  onSavePageText: (pageIndex: number, text: string) => void;
  onSaveAllPageTexts: (texts: string[]) => void;
  onRecognizeTexts: () => Promise<void>;
  onSaveAudioMapping: (
    pageIndex: number,
    trackIndex: number,
    startSec: number,
    endSec: number
  ) => void;
  onSaveAllAudioMappings: (
    mappings: Array<{
      pageIndex: number;
      trackIndex: number;
      startSec: number;
      endSec: number;
    }>
  ) => void;
  onRematchAudioWithTexts: (
    texts: string[]
  ) => Promise<StoryflowRematchDiagnostics | null> | StoryflowRematchDiagnostics | null;
  onReplaceImage: (pageIndex: number) => void;
  onInsertPage: (pageIndex: number) => void;
  onDeletePage: (pageIndex: number) => void;
  onSplitView: (viewIndex: number) => void;
  onMergeView: (viewIndex: number) => void;
  onClose: () => void;
}) => {
  const pageCount = document.pageObjectKeys?.length || document.pageCount || 0;
  const shadowTexts = useMemo(
    () => buildResolvedShadowTexts(document.analysis, pageCount),
    [document.analysis, pageCount]
  );

  const [draftTexts, setDraftTexts] = useState<string[]>(shadowTexts);
  const audioTracks = document.shadowAudio?.tracks || [];
  const [draftAudioMap, setDraftAudioMap] = useState<
    Record<number, { trackIndex: number; startSec: string; endSec: string; hasSegment: boolean }>
  >({});
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewCleanupRef = useRef<(() => void) | null>(null);
  const [audioPreviewState, setAudioPreviewState] = useState<{
    pageIndex: number | null;
    currentSec: number;
    isPlaying: boolean;
  }>({
    pageIndex: null,
    currentSec: 0,
    isPlaying: false,
  });
  const [isRematchingAudio, setIsRematchingAudio] = useState(false);
  const [rematchProgress, setRematchProgress] = useState(0);
  const [rematchStatus, setRematchStatus] = useState("");
  const [isRecognizingText, setIsRecognizingText] = useState(false);
  const [recognizeProgress, setRecognizeProgress] = useState(0);
  const [recognizeStatus, setRecognizeStatus] = useState("");
  const [rematchDiagnostics, setRematchDiagnostics] = useState<StoryflowRematchDiagnostics | null>(
    null
  );
  const hasAnyDraftText = draftTexts.some((item) => item.trim().length > 0);

  useEffect(() => {
    setDraftTexts(shadowTexts);
  }, [shadowTexts, document.id]);

  useEffect(() => {
    setRematchDiagnostics(null);
  }, [document.id]);

  useEffect(() => {
    const existingSegments = document.shadowAudio?.pageSegments || [];
    const segments = existingSegments;
    const segmentByPage = new Map<number, (typeof segments)[number]>();
    segments.forEach((segment) => {
      segmentByPage.set(segment.pageIndex, segment);
    });

    const nextDraft: Record<number, { trackIndex: number; startSec: string; endSec: string; hasSegment: boolean }> = {};
    Array.from({ length: pageCount }, (_, pageIndex) => pageIndex).forEach((pageIndex) => {
      const fromSegment = segmentByPage.get(pageIndex);
      const trackIndex = fromSegment?.trackIndex ?? 0;
      const duration = audioTracks[trackIndex]?.durationSec || 0;
      const startSec = fromSegment?.startSec ?? 0;
      const endSec = fromSegment?.endSec ?? startSec;

      nextDraft[pageIndex] = {
        trackIndex,
        startSec: Number.isFinite(startSec) ? String(startSec.toFixed(2)) : "0",
        endSec: Number.isFinite(endSec)
          ? String(endSec.toFixed(2))
          : String((duration > 0 ? duration : startSec).toFixed(2)),
        hasSegment: Boolean(fromSegment),
      };
    });
    setDraftAudioMap(nextDraft);
  }, [
    document.shadowAudio?.pageSegments,
    document.shadowAudio?.tracks,
    pageCount,
    document.id,
    shadowTexts,
    audioTracks,
  ]);

  const stopPreviewAudio = () => {
    if (previewCleanupRef.current) {
      previewCleanupRef.current();
      previewCleanupRef.current = null;
    }
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current.src = "";
      previewAudioRef.current = null;
    }
    setAudioPreviewState((current) => ({
      ...current,
      isPlaying: false,
    }));
  };

  useEffect(() => {
    return () => {
      stopPreviewAudio();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const parseSec = (value: string, fallback = 0) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  };

  const normalizeAudioDraftForPage = (pageIndex: number) => {
    const draft = draftAudioMap[pageIndex];
    const safeTrackIndex = Math.max(
      0,
      Math.min((draft?.trackIndex ?? 0), Math.max(0, audioTracks.length - 1))
    );
    const duration = Math.max(0, audioTracks[safeTrackIndex]?.durationSec || 0);
    const rawStart = parseSec(draft?.startSec || "0");
    const rawEnd = parseSec(
      draft?.endSec || (duration > 0 ? String(duration) : String(rawStart + DEFAULT_AUDIO_SEGMENT_SEC)),
      duration > 0 ? duration : rawStart + DEFAULT_AUDIO_SEGMENT_SEC
    );
    const start =
      duration > 0
        ? Math.max(0, Math.min(rawStart, duration))
        : Math.max(0, rawStart);
    const end =
      duration > 0
        ? Math.max(start + 0.2, Math.min(rawEnd, duration))
        : Math.max(start + 0.2, rawEnd, start + DEFAULT_AUDIO_SEGMENT_SEC);
    return {
      safeTrackIndex,
      duration,
      start,
      end,
      hasSegment: Boolean(draft?.hasSegment),
    };
  };

  const diagnosticByPage = useMemo(
    () =>
      new Map(
        (rematchDiagnostics?.pages || []).map((item) => [item.pageIndex, item] as const)
      ),
    [rematchDiagnostics]
  );

  const diagnosticTrackByIndex = useMemo(
    () =>
      new Map(
        (rematchDiagnostics?.tracks || []).map((item) => [item.trackIndex, item] as const)
      ),
    [rematchDiagnostics]
  );

  const handlePreviewSegment = (pageIndex: number) => {
    const { safeTrackIndex, start, end, hasSegment } = normalizeAudioDraftForPage(pageIndex);
    if (!hasSegment) return;
    const url = getDocumentAudioTrackUrl(document, safeTrackIndex);
    if (!url) return;

    if (
      audioPreviewState.isPlaying &&
      audioPreviewState.pageIndex === pageIndex
    ) {
      stopPreviewAudio();
      return;
    }

    stopPreviewAudio();
    const audio = new Audio(url);
    audio.preload = "auto";
    audio.volume = 1;
    audio.muted = false;
    previewAudioRef.current = audio;
    setAudioPreviewState({
      pageIndex,
      currentSec: start,
      isPlaying: true,
    });

    const finishCurrent = () => {
      if (previewCleanupRef.current === finishCurrent) {
        previewCleanupRef.current = null;
      }
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      audio.pause();
      audio.src = "";
      setAudioPreviewState((current) => ({
        ...current,
        isPlaying: false,
      }));
    };

    const onTimeUpdate = () => {
      const current = Math.max(start, audio.currentTime);
      setAudioPreviewState((prev) =>
        prev.pageIndex === pageIndex
          ? { ...prev, currentSec: current }
          : prev
      );
      if (current >= end - 0.02) {
        finishCurrent();
      }
    };

    const onEnded = () => {
      finishCurrent();
    };
    const onError = () => {
      finishCurrent();
    };

    previewCleanupRef.current = finishCurrent;
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    const startPlayback = () => {
      const durationSec = Number.isFinite(audio.duration) ? Math.max(0, audio.duration) : 0;
      const boundedStart =
        durationSec > 0 ? Math.min(start, Math.max(0, durationSec - 0.05)) : start;
      try {
        audio.currentTime = boundedStart;
      } catch {
        // ignore early seek failures on some browsers
      }
      void audio.play().catch(() => {
        finishCurrent();
      });
    };
    if (audio.readyState >= 1) {
      startPlayback();
    } else {
      audio.addEventListener("loadedmetadata", startPlayback, { once: true });
    }
  };

  const handleSeekPreview = (pageIndex: number, targetSec: number) => {
    setAudioPreviewState((current) =>
      current.pageIndex === pageIndex
        ? { ...current, currentSec: targetSec }
        : current
    );
    if (previewAudioRef.current && audioPreviewState.pageIndex === pageIndex) {
      previewAudioRef.current.currentTime = targetSec;
    }
  };

  const handleRematchAudio = async () => {
    if (!audioTracks.length || !hasAnyDraftText || isRematchingAudio) return;
    setIsRematchingAudio(true);
    setRematchProgress(8);
    setRematchStatus("正在识别音频并定位文本...");
    let progressTimer: number | null = null;
    try {
      progressTimer = window.setInterval(() => {
        setRematchProgress((current) => (current < 82 ? current + 3 : current));
      }, 350);
      setRematchStatus("正在转写音频...");
      const diagnostics = await Promise.resolve(onRematchAudioWithTexts(draftTexts));
      setRematchDiagnostics(diagnostics);
      setRematchStatus("正在保存映射...");
      setRematchProgress(94);
      setRematchStatus("自动匹配完成");
      setRematchProgress(100);
    } catch {
      setRematchStatus("自动匹配失败，请重试");
      setRematchProgress(0);
    } finally {
      if (progressTimer !== null) {
        window.clearInterval(progressTimer);
      }
      setTimeout(() => {
        setIsRematchingAudio(false);
        setRematchStatus("");
      }, 600);
    }
  };

  const handleRecognizeTexts = async () => {
    if (isRecognizingText) return;
    setIsRecognizingText(true);
    setRecognizeProgress(6);
    setRecognizeStatus("正在准备页面...");
    let progressTimer: number | null = null;
    try {
      progressTimer = window.setInterval(() => {
        setRecognizeProgress((current) => (current < 86 ? current + 3 : current));
      }, 450);
      setRecognizeStatus("正在识别 PDF / 图片文本...");
      await onRecognizeTexts();
      setRecognizeStatus("正在保存识别结果...");
      setRecognizeProgress(96);
      setRecognizeStatus("文本识别完成");
      setRecognizeProgress(100);
    } catch {
      setRecognizeStatus("文本识别失败，请重试");
      setRecognizeProgress(0);
    } finally {
      if (progressTimer !== null) {
        window.clearInterval(progressTimer);
      }
      window.setTimeout(() => {
        setRecognizeStatus("");
      }, 800);
      window.setTimeout(() => {
        setRecognizeProgress(0);
      }, 1000);
      setIsRecognizingText(false);
    }
  };

  const handleSaveAllTexts = () => {
    onSaveAllPageTexts(draftTexts);
  };

  const handleSaveAllAudio = () => {
    const mappings = Array.from({ length: pageCount }, (_, pageIndex) => {
      const { safeTrackIndex, start, end, hasSegment } = normalizeAudioDraftForPage(pageIndex);
      return {
        pageIndex,
        trackIndex: safeTrackIndex,
        startSec: start,
        endSec: end,
        hasSegment,
      };
    })
      .filter((item) => item.hasSegment)
      .map(({ hasSegment: _hasSegment, ...mapping }) => mapping);
    onSaveAllAudioMappings(mappings);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-600">
            Page Editor
          </p>
          <h3 className="mt-1 text-xl font-black text-slate-900">
            页面自由编辑
          </h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
        >
          关闭
        </button>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 overflow-hidden p-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <section className="min-h-0 overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h4 className="text-sm font-black text-slate-900">页面顺序 + 文字 + 图片</h4>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSaveAllTexts}
                className="rounded-full bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-sky-700"
              >
                保存全部文字
              </button>
              <button
                type="button"
                disabled={!audioTracks.length}
                onClick={handleSaveAllAudio}
                className="rounded-full bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                保存全部音频
              </button>
              <button
                type="button"
                disabled={isRecognizingText}
                onClick={() => {
                  void handleRecognizeTexts();
                }}
                className="rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {isRecognizingText ? "识别中..." : "识别文本"}
              </button>
              <button
                type="button"
                disabled={!audioTracks.length || !hasAnyDraftText || isRematchingAudio}
                onClick={() => {
                  void handleRematchAudio();
                }}
                className="rounded-full bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {isRematchingAudio ? "识别中..." : "识别音频"}
              </button>
              <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-500">
                {pageCount} 页
              </span>
            </div>
          </div>

          {rematchStatus ? (
            <div className="mb-3 rounded-xl border border-indigo-100 bg-indigo-50/70 px-3 py-2">
              <div className="mb-1 flex items-center justify-between text-xs">
                <p className="font-semibold text-indigo-700">{rematchStatus}</p>
                <p className="font-semibold text-indigo-600">{Math.max(0, Math.min(100, rematchProgress))}%</p>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-white">
                <div
                  className="h-full rounded-full bg-indigo-500 transition-all duration-200"
                  style={{ width: `${Math.max(0, Math.min(100, rematchProgress))}%` }}
                />
              </div>
            </div>
          ) : null}

          {recognizeStatus ? (
            <div className="mb-3 rounded-xl border border-emerald-100 bg-emerald-50/70 px-3 py-2">
              <div className="mb-1 flex items-center justify-between text-xs">
                <p className="font-semibold text-emerald-700">{recognizeStatus}</p>
                <p className="font-semibold text-emerald-600">
                  {Math.max(0, Math.min(100, recognizeProgress))}%
                </p>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-white">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all duration-200"
                  style={{ width: `${Math.max(0, Math.min(100, recognizeProgress))}%` }}
                />
              </div>
            </div>
          ) : null}

          {rematchDiagnostics ? (
            <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-3">
              <p className="text-sm font-bold text-amber-800">匹配诊断已生成</p>
              <p className="mt-1 text-xs leading-6 text-amber-700">
                下面每一页都会显示：当前文字、后端命中的转写文本、最终起止时间。这样可以直接看出是音频转写错了，还是页面匹配错了。
              </p>
            </div>
          ) : null}

          <div className="space-y-3">
            {Array.from({ length: pageCount }, (_, pageIndex) => (
              <div
                key={`${document.id}-editor-page-${pageIndex}`}
                className="rounded-2xl border border-slate-200 bg-white p-3"
              >
                <div className="flex flex-wrap items-start gap-3">
                  <div className="h-20 w-16 overflow-hidden rounded-xl border border-slate-100 bg-slate-100">
                    {getDocumentPageUrl(document, pageIndex) ? (
                      <img
                        src={getDocumentPageUrl(document, pageIndex)}
                        alt={`editor-page-${pageIndex + 1}`}
                        className="h-full w-full object-cover"
                      />
                    ) : null}
                  </div>

                  <div className="flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-700">
                        第 {pageIndex + 1} 页
                      </span>
                      <button
                        type="button"
                        disabled={pageIndex === 0}
                        onClick={() => onMovePage(pageIndex, pageIndex - 1)}
                        className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        上移
                      </button>
                      <button
                        type="button"
                        disabled={pageIndex === pageCount - 1}
                        onClick={() => onMovePage(pageIndex, pageIndex + 1)}
                        className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        下移
                      </button>
                      <button
                        type="button"
                        onClick={() => onInsertPage(pageIndex)}
                        className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-200"
                      >
                        增加页面
                      </button>
                      <button
                        type="button"
                        onClick={() => onReplaceImage(pageIndex)}
                        className="rounded-full bg-indigo-100 px-3 py-1 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-200"
                      >
                        替换图片
                      </button>
                      <button
                        type="button"
                        disabled={pageCount <= 1}
                        onClick={() => onDeletePage(pageIndex)}
                        className="rounded-full bg-rose-100 px-3 py-1 text-xs font-semibold text-rose-700 transition hover:bg-rose-200 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        删除页面
                      </button>
                    </div>

                    <textarea
                      value={draftTexts[pageIndex] || ""}
                      onChange={(event) => {
                        const next = [...draftTexts];
                        next[pageIndex] = event.target.value;
                        setDraftTexts(next);
                      }}
                      rows={3}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-sky-400"
                      placeholder="编辑这一页识别文字"
                    />
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => onSavePageText(pageIndex, draftTexts[pageIndex] || "")}
                        className="rounded-full bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-sky-700"
                      >
                        保存文字
                      </button>
                    </div>

                    {audioTracks.length ? (
                      <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-indigo-600">
                          Audio Mapping
                        </p>
                        <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_110px_110px_auto] sm:items-center">
                          <select
                            value={draftAudioMap[pageIndex]?.trackIndex ?? 0}
                            onChange={(event) => {
                              const trackIndex = Number(event.target.value);
                              const duration = audioTracks[trackIndex]?.durationSec || 0;
                              setDraftAudioMap((current) => ({
                                ...current,
                                [pageIndex]: {
                                  trackIndex,
                                  startSec: current[pageIndex]?.startSec ?? "0.00",
                                  endSec: current[pageIndex]?.endSec ?? duration.toFixed(2),
                                  hasSegment: current[pageIndex]?.hasSegment ?? false,
                                },
                              }));
                            }}
                            className="rounded-lg border border-indigo-200 bg-white px-2 py-2 text-xs text-slate-700 outline-none focus:border-indigo-400"
                          >
                            {audioTracks.map((track, trackIndex) => (
                              <option key={`${track.fileName}-${trackIndex}`} value={trackIndex}>
                                {track.fileName}
                              </option>
                            ))}
                          </select>
                          <input
                            type="number"
                            min={0}
                            step={0.1}
                            value={draftAudioMap[pageIndex]?.startSec ?? "0.00"}
                            onChange={(event) => {
                              const value = event.target.value;
                              const currentTrack = draftAudioMap[pageIndex]?.trackIndex ?? 0;
                              const duration = audioTracks[currentTrack]?.durationSec || 0;
                              const nextStart = Math.max(0, Math.min(Number(value || 0), duration));
                              const currentEnd = Number(draftAudioMap[pageIndex]?.endSec ?? duration);
                              const nextEnd = Math.max(nextStart + 0.05, currentEnd);
                              setDraftAudioMap((current) => ({
                                ...current,
                                [pageIndex]: {
                                  trackIndex: currentTrack,
                                  startSec: nextStart.toFixed(2),
                                  endSec: nextEnd.toFixed(2),
                                  hasSegment: true,
                                },
                              }));
                            }}
                            className="rounded-lg border border-indigo-200 bg-white px-2 py-2 text-xs text-slate-700 outline-none focus:border-indigo-400"
                            placeholder="start"
                          />
                          <input
                            type="number"
                            min={0}
                            step={0.1}
                            value={draftAudioMap[pageIndex]?.endSec ?? "0.00"}
                            onChange={(event) => {
                              const value = event.target.value;
                              const currentTrack = draftAudioMap[pageIndex]?.trackIndex ?? 0;
                              const duration = audioTracks[currentTrack]?.durationSec || 0;
                              const currentStart = Number(draftAudioMap[pageIndex]?.startSec ?? 0);
                              const nextEnd = Math.max(
                                currentStart + 0.05,
                                Math.min(Number(value || 0), duration || Number(value || 0))
                              );
                              setDraftAudioMap((current) => ({
                                ...current,
                                [pageIndex]: {
                                  trackIndex: currentTrack,
                                  startSec: currentStart.toFixed(2),
                                  endSec: nextEnd.toFixed(2),
                                  hasSegment: true,
                                },
                              }));
                            }}
                            className="rounded-lg border border-indigo-200 bg-white px-2 py-2 text-xs text-slate-700 outline-none focus:border-indigo-400"
                            placeholder="end"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              onSaveAudioMapping(
                                pageIndex,
                                draftAudioMap[pageIndex]?.trackIndex ?? 0,
                                Number(draftAudioMap[pageIndex]?.startSec ?? 0),
                                Number(draftAudioMap[pageIndex]?.endSec ?? 0)
                              )
                            }
                            className="rounded-full bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-700"
                          >
                            保存音频
                          </button>
                        </div>
                        {(() => {
                          const draft = draftAudioMap[pageIndex];
                          const trackIndex = draft?.trackIndex ?? 0;
                          const duration = Math.max(0, audioTracks[trackIndex]?.durationSec || 0);
                          const start = Math.max(
                            0,
                            Math.min(Number(draft?.startSec ?? 0), duration || Number(draft?.startSec ?? 0))
                          );
                          const end = Math.max(
                            start + 0.05,
                            Math.min(Number(draft?.endSec ?? duration), duration || Number(draft?.endSec ?? duration))
                          );
                          const progressValue =
                            audioPreviewState.pageIndex === pageIndex
                              ? audioPreviewState.currentSec
                              : start;
                          const canPreview =
                            Boolean(draft?.hasSegment) &&
                            Boolean(getDocumentAudioTrackUrl(document, trackIndex));
                          const timelineMax =
                            duration > 0
                              ? duration
                              : Math.max(
                                  end + DEFAULT_AUDIO_SEGMENT_SEC,
                                  start + DEFAULT_AUDIO_SEGMENT_SEC,
                                  10
                                );
                          const segmentWidthPercent =
                            duration > 0
                              ? Math.max(1, ((end - start) / duration) * 100)
                              : 0;
                          const segmentOffsetPercent =
                            duration > 0 ? (start / duration) * 100 : 0;
                          return (
                            <div className="mt-3 rounded-lg border border-indigo-100 bg-white px-3 py-3">
                              <div className="relative h-2 overflow-hidden rounded-full bg-slate-100">
                                {duration > 0 ? (
                                  <div
                                    className="absolute top-0 h-full rounded-full bg-indigo-300"
                                    style={{
                                      left: `${segmentOffsetPercent}%`,
                                      width: `${segmentWidthPercent}%`,
                                    }}
                                  />
                                ) : null}
                              </div>
                              <input
                                type="range"
                                min={0}
                                max={Math.max(0.1, timelineMax)}
                                step={0.01}
                                value={Math.max(0, Math.min(progressValue, Math.max(0.1, timelineMax)))}
                                onChange={(event) => {
                                  const target = Number(event.target.value);
                                  handleSeekPreview(pageIndex, target);
                                }}
                                className="mt-2 w-full accent-indigo-500"
                              />
                              <div className="mt-2 grid grid-cols-2 gap-2">
                                <div>
                                  <p className="text-[11px] font-semibold text-slate-500">Start (drag)</p>
                                  <input
                                    type="range"
                                    min={0}
                                    max={Math.max(0.1, timelineMax)}
                                    step={0.01}
                                    value={Math.max(0, Math.min(start, Math.max(0.1, timelineMax)))}
                                    onChange={(event) => {
                                      const nextStart = Number(event.target.value);
                                      setDraftAudioMap((current) => {
                                        const currentEnd = Number(current[pageIndex]?.endSec ?? end);
                                        const safeEnd = Math.max(nextStart + 0.05, currentEnd);
                                        return {
                                          ...current,
                                          [pageIndex]: {
                                            trackIndex,
                                            startSec: nextStart.toFixed(2),
                                            endSec: safeEnd.toFixed(2),
                                            hasSegment: true,
                                          },
                                        };
                                      });
                                    }}
                                    className="mt-1 w-full accent-indigo-500"
                                  />
                                </div>
                                <div>
                                  <p className="text-[11px] font-semibold text-slate-500">End (drag)</p>
                                  <input
                                    type="range"
                                    min={0}
                                    max={Math.max(0.1, timelineMax)}
                                    step={0.01}
                                    value={Math.max(0, Math.min(end, Math.max(0.1, timelineMax)))}
                                    onChange={(event) => {
                                      const nextEndRaw = Number(event.target.value);
                                      setDraftAudioMap((current) => {
                                        const currentStart = Number(current[pageIndex]?.startSec ?? start);
                                        const safeEnd = Math.max(currentStart + 0.05, nextEndRaw);
                                        return {
                                          ...current,
                                          [pageIndex]: {
                                            trackIndex,
                                            startSec: currentStart.toFixed(2),
                                            endSec: safeEnd.toFixed(2),
                                            hasSegment: true,
                                          },
                                        };
                                      });
                                    }}
                                    className="mt-1 w-full accent-indigo-500"
                                  />
                                </div>
                              </div>
                              <div className="mt-2 flex items-center justify-between">
                                <p className="text-[11px] text-slate-500">
                                  {start.toFixed(2)}s - {end.toFixed(2)}s / {duration.toFixed(2)}s
                                </p>
                                <button
                                  type="button"
                                  disabled={!canPreview}
                                  onClick={() => handlePreviewSegment(pageIndex)}
                                  className="rounded-full bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                                >
                                  {audioPreviewState.pageIndex === pageIndex && audioPreviewState.isPlaying
                                    ? "停止试听"
                                    : "试听片段"}
                                </button>
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    ) : null}

                    {(() => {
                      const diagnostic = diagnosticByPage.get(pageIndex);
                      if (!diagnostic) return null;
                      const diagnosticTrack =
                        typeof diagnostic.matchedTrackIndex === "number"
                          ? diagnosticTrackByIndex.get(diagnostic.matchedTrackIndex) || null
                          : null;

                      return (
                        <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-700">
                              Match Diagnostics
                            </p>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-amber-700">
                                匹配分数 {diagnostic.score !== null ? diagnostic.score.toFixed(2) : "--"}
                              </span>
                              <span
                                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                                  diagnostic.accepted
                                    ? "bg-emerald-100 text-emerald-700"
                                    : "bg-rose-100 text-rose-700"
                                }`}
                              >
                                {diagnostic.accepted ? "已用于映射" : "仅诊断，未覆盖音频"}
                              </span>
                            </div>
                          </div>

                          <div className="mt-3 grid gap-3 lg:grid-cols-2">
                            <div className="rounded-lg border border-white bg-white/80 p-3">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                                当前页文字
                              </p>
                              <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-800">
                                {draftTexts[pageIndex] || "(空)"}
                              </p>
                            </div>
                            <div className="rounded-lg border border-white bg-white/80 p-3">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                                最终命中结果
                              </p>
                              <div className="mt-2 space-y-1 text-sm leading-6 text-slate-700">
                                <p>
                                  音频：
                                  <span className="font-semibold text-slate-900">
                                    {diagnostic.matchedTrackFileName || "未命中"}
                                  </span>
                                </p>
                                <p>
                                  时间：
                                  <span className="font-semibold text-slate-900">
                                    {formatAudioSeconds(diagnostic.startSec)} - {formatAudioSeconds(diagnostic.endSec)}
                                  </span>
                                </p>
                                <p className="pt-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                                  命中的转写文本
                                </p>
                                <p className="whitespace-pre-line text-sm leading-6 text-slate-800">
                                  {diagnostic.matchedText || "(未命中任何片段)"}
                                </p>
                              </div>
                            </div>
                          </div>

                          {diagnosticTrack ? (
                            <details className="mt-3 rounded-lg border border-white bg-white/80 p-3">
                              <summary className="cursor-pointer text-sm font-semibold text-slate-800">
                                查看这条音频的后端转写片段
                              </summary>
                              <div className="mt-3 space-y-2">
                                <p className="text-xs text-slate-500">
                                  {diagnosticTrack.fileName} / 共 {diagnosticTrack.segments.length} 段 / 时长 {formatAudioSeconds(diagnosticTrack.durationSec)}
                                </p>
                                {diagnosticTrack.transcriptText ? (
                                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-700">
                                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                                      整条转写文本
                                    </p>
                                    <p className="mt-1 whitespace-pre-line">
                                      {diagnosticTrack.transcriptText}
                                    </p>
                                  </div>
                                ) : null}
                                <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
                                  {diagnosticTrack.segments.length ? (
                                    diagnosticTrack.segments.map((segment, segmentIndex) => {
                                      const isMatched =
                                        diagnostic.startSec !== null &&
                                        diagnostic.endSec !== null &&
                                        segment.endSec >= diagnostic.startSec - 0.02 &&
                                        segment.startSec <= diagnostic.endSec + 0.02;
                                      return (
                                        <div
                                          key={`${pageIndex}-${segmentIndex}-${segment.startSec}`}
                                          className={`rounded-lg border px-3 py-2 text-sm ${
                                            isMatched
                                              ? "border-amber-300 bg-amber-100/80"
                                              : "border-slate-200 bg-slate-50"
                                          }`}
                                        >
                                          <p className="text-[11px] font-semibold text-slate-500">
                                            {formatAudioSeconds(segment.startSec)} - {formatAudioSeconds(segment.endSec)}
                                          </p>
                                          <p className="mt-1 leading-6 text-slate-800">{segment.text}</p>
                                        </div>
                                      );
                                    })
                                  ) : (
                                    <p className="text-sm text-slate-500">后端没有返回可用转写片段。</p>
                                  )}
                                </div>
                              </div>
                            </details>
                          ) : null}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="min-h-0 overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h4 className="text-sm font-black text-slate-900">对页组合管理</h4>
            <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-500">
              {views.length} 组
            </span>
          </div>

          <div className="space-y-3">
            {views.length ? (
              views.map((view, viewIndex) => {
                const canMerge =
                  view.kind === "single" && views[viewIndex + 1]?.kind === "single";

                return (
                  <div
                    key={`${document.id}-view-${viewIndex}`}
                    className="rounded-2xl border border-slate-200 bg-white p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                        组 {viewIndex + 1}
                      </span>
                      <span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-700">
                        {view.kind === "spread" ? "对页" : "单页"}
                      </span>
                      <span className="text-xs text-slate-500">
                        {view.kind === "spread"
                          ? `L: ${typeof view.pages[0] === "number" ? view.pages[0] + 1 : "Blank"} / R: ${
                              typeof view.pages[1] === "number" ? view.pages[1] + 1 : "Blank"
                            }`
                          : `P: ${view.pages[0] + 1}`}
                      </span>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {view.kind === "spread" ? (
                        <button
                          type="button"
                          onClick={() => onSplitView(viewIndex)}
                          className="rounded-full bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-700 transition hover:bg-amber-200"
                        >
                          拆成两页
                        </button>
                      ) : null}

                      {canMerge ? (
                        <button
                          type="button"
                          onClick={() => onMergeView(viewIndex)}
                          className="rounded-full bg-emerald-100 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-200"
                        >
                          与下一页组为对页
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="rounded-xl bg-white px-4 py-6 text-center text-sm text-slate-500">
                暂无页面视图可编辑。
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};

const SidePanel = ({
  sourceName,
  setSourceName,
  fileInputRef,
  audioInputRef,
  pendingImages,
  pendingAudioAssets,
  error,
  notice,
  isAnalyzing,
  documents,
  activeId,
  getDocumentThumbnailUrl,
  onChooseFiles,
  onChooseAudioFiles,
  onAttachPendingAudio,
  onAnalyze,
  onSelectDocument,
}: {
  sourceName: string;
  setSourceName: (value: string) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  audioInputRef: React.RefObject<HTMLInputElement | null>;
  pendingImages: string[];
  pendingAudioAssets: PendingAudioAsset[];
  error: string | null;
  notice: string | null;
  isAnalyzing: boolean;
  documents: StoryflowDocument[];
  activeId: string | null;
  getDocumentThumbnailUrl: (doc: StoryflowDocument) => string;
  onChooseFiles: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onChooseAudioFiles: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onAttachPendingAudio: () => void;
  onAnalyze: () => void;
  onSelectDocument: (id: string) => void;
}) => (
  <div className="space-y-5">
    <section className="rounded-[1.7rem] bg-white p-5 shadow-[0_18px_50px_rgba(148,163,184,0.12)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-600">
            Teacher Upload
          </p>
          <h2 className="mt-2 text-2xl font-black text-slate-900">图文导学</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            上传图片或 PDF，自动生成故事思维导图和看图说话提纲。
          </p>
        </div>
        <div className="grid h-14 w-14 place-items-center rounded-[1.2rem] bg-sky-600 text-2xl font-black text-white">
          图
        </div>
      </div>

      <div className="mt-5 space-y-4">
        <div>
          <label className="mb-2 block text-sm font-semibold text-slate-700">
            资料名称
          </label>
          <input
            value={sourceName}
            onChange={(event) => setSourceName(event.target.value)}
            placeholder="例如：Oxford Reading Tree Stage 1"
            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-sky-400 focus:bg-white"
          />
        </div>

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="w-full rounded-2xl border border-dashed border-sky-300 bg-sky-50 px-4 py-4 text-sm font-semibold text-sky-700 transition hover:bg-sky-100"
        >
          上传图片 / PDF
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.pdf"
          multiple
          className="hidden"
          onChange={onChooseFiles}
        />

        <button
          type="button"
          onClick={() => audioInputRef.current?.click()}
          className="w-full rounded-2xl border border-dashed border-indigo-300 bg-indigo-50 px-4 py-4 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-100"
        >
          上传音频（影子跟读）
        </button>
        <input
          ref={audioInputRef}
          type="file"
          accept="audio/*,.mp3,.m4a,.wav,.webm,.ogg"
          multiple
          className="hidden"
          onChange={onChooseAudioFiles}
        />

        {pendingAudioAssets.length ? (
          <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 px-3 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-indigo-600">
              Audio Queue
            </p>
            <div className="mt-2 space-y-2">
              {pendingAudioAssets.map((asset, index) => (
                <div
                  key={`${asset.sourceFileName}-${index}`}
                  className="rounded-xl bg-white px-3 py-2 text-xs text-slate-700"
                >
                  <p className="truncate font-semibold">{asset.sourceFileName}</p>
                  <p className="mt-1 text-slate-500">
                    时长：{asset.durationSec > 0 ? `${asset.durationSec.toFixed(1)}s` : "未知"}
                  </p>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={onAttachPendingAudio}
              className="mt-3 w-full rounded-2xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700"
            >
              添加到当前资料
            </button>
          </div>
        ) : null}

        {pendingImages.length ? (
          <div className="grid grid-cols-3 gap-2">
            {pendingImages.map((image, index) => (
              <div
                key={`${image.slice(0, 16)}-${index}`}
                className="overflow-hidden rounded-2xl border border-slate-100 bg-slate-50"
              >
                <img
                  src={image}
                  alt={`pending-${index + 1}`}
                  className="h-20 w-full object-cover"
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl bg-slate-50 px-4 py-5 text-sm text-slate-400">
            还没有上传页面。建议控制在 4-6 页内，分析速度更稳定。
          </div>
        )}

        {error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
            {error}
          </div>
        ) : null}
        {notice ? (
          <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-700">
            {notice}
          </div>
        ) : null}

        <button
          type="button"
          disabled={isAnalyzing || !pendingImages.length}
          onClick={onAnalyze}
          className="w-full rounded-2xl bg-slate-900 px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {isAnalyzing ? "正在分析中..." : "开始生成思维导图"}
        </button>
      </div>
    </section>

    <section className="rounded-[1.7rem] bg-white p-5 shadow-[0_18px_50px_rgba(148,163,184,0.12)]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-black text-slate-900">老师资料库</h3>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">
            {documents.length} 份
          </span>
        </div>
        <Link
          href="/teacher/storyflow/library"
          className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-200"
        >
          整理资料
        </Link>
      </div>

      <div className="mt-4 space-y-3">
        {documents.length ? (
          documents.map((item) => {
            const thumbnailUrl = getDocumentThumbnailUrl(item);

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectDocument(item.id)}
                className={`flex w-full items-center gap-3 rounded-[1.35rem] border px-3 py-3 text-left transition ${
                  activeId === item.id
                    ? "border-sky-300 bg-sky-50"
                    : "border-slate-100 bg-slate-50 hover:border-slate-200 hover:bg-white"
                }`}
              >
                {thumbnailUrl ? (
                  <img
                    src={thumbnailUrl}
                    alt={item.analysis.title}
                    className="h-16 w-16 rounded-2xl object-cover"
                  />
                ) : (
                  <div className="grid h-16 w-16 place-items-center rounded-2xl bg-sky-100 text-lg font-black text-sky-700">
                    图
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-900">
                    {item.analysis.title}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {item.pageCount} 页 · {formatTime(item.createdAt)}
                  </p>
                </div>
              </button>
            );
          })
        ) : (
          <div className="rounded-2xl bg-slate-50 px-4 py-5 text-sm text-slate-400">
            还没有保存的导学资料。
          </div>
        )}
      </div>
    </section>
  </div>
);

const InfoPill = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-[1.3rem] bg-white/75 px-4 py-3 shadow-sm">
    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
      {label}
    </p>
    <p className="mt-2 text-sm font-semibold text-slate-700">{value}</p>
  </div>
);

const TabButton = ({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`rounded-full px-8 py-4 text-base font-semibold transition md:text-lg ${
      active
        ? "bg-sky-600/85 text-white shadow-sm shadow-sky-500/30"
        : "bg-white/55 text-slate-800 hover:bg-white/75"
    }`}
  >
    {children}
  </button>
);

const PERFORMANCE_EDITOR_META: Record<
  StoryflowPerformanceSectionKey,
  {
    accentClass: string;
    numberClass: string;
    helper: string;
    placeholder: string;
  }
> = {
  imageSorting: {
    accentClass: "bg-violet-100 text-violet-700",
    numberClass: "bg-violet-500 text-white",
    helper: "按故事顺序放入配图，帮助孩子先建立情节线索。",
    placeholder: "每行一条，如：先看图排序 / 再用一句话说一说",
  },
  keywords: {
    accentClass: "bg-amber-100 text-amber-700",
    numberClass: "bg-amber-500 text-white",
    helper: "填写本任务想重点提醒孩子使用的关键词。",
    placeholder: "每行一个关键词，如：bath / mud / rabbit",
  },
  sentenceFrames: {
    accentClass: "bg-sky-100 text-sky-700",
    numberClass: "bg-sky-500 text-white",
    helper: "提供开头句、连接句和结尾句，让孩子更顺畅地表达。",
    placeholder: "每行一句，如：At the beginning, ...",
  },
  storyMap: {
    accentClass: "bg-emerald-100 text-emerald-700",
    numberClass: "bg-emerald-500 text-white",
    helper: "把故事分成开头、经过、结尾，帮助孩子抓住结构。",
    placeholder: "每行一个结构点，如：开头：谁在做什么",
  },
  performanceTask: {
    accentClass: "bg-rose-100 text-rose-700",
    numberClass: "bg-rose-500 text-white",
    helper: "设置脱稿表演要求和完成方式。",
    placeholder: "每行一条任务要求，如：加入动作和表情",
  },
  parentTips: {
    accentClass: "bg-fuchsia-100 text-fuchsia-700",
    numberClass: "bg-fuchsia-500 text-white",
    helper: "给家长可直接照着说的陪练提示语。",
    placeholder: "每行一句提示语，如：先让孩子自己说，不急着提醒",
  },
};

const PerformanceTaskStudio = ({
  document,
  teacherName,
  coverImageUrl,
  onSaveConfig,
  onNotice,
  onError,
}: {
  document: StoryflowDocument;
  teacherName: string;
  coverImageUrl: string;
  onSaveConfig: (config: StoryflowPerformanceConfig) => void;
  onNotice: (value: string | null) => void;
  onError: (value: string | null) => void;
}) => (
  <PerformanceTaskStudioInner
    document={document}
    teacherName={teacherName}
    coverImageUrl={coverImageUrl}
    onSaveConfig={onSaveConfig}
    onNotice={onNotice}
    onError={onError}
  />
);

const PerformanceTaskStudioInner = ({
  document,
  teacherName,
  coverImageUrl,
  onSaveConfig,
  onNotice,
  onError,
}: {
  document: StoryflowDocument;
  teacherName: string;
  coverImageUrl: string;
  onSaveConfig: (config: StoryflowPerformanceConfig) => void;
  onNotice: (value: string | null) => void;
  onError: (value: string | null) => void;
}) => {
  const [isUploadingAll, setIsUploadingAll] = useState(false);
  const [uploadingSectionKey, setUploadingSectionKey] =
    useState<StoryflowPerformanceSectionKey | null>(null);
  const performanceConfig =
    document.performanceConfig || buildDefaultStoryflowPerformanceConfig(document.analysis);
  const visibleCount = PERFORMANCE_SECTION_ORDER.filter(
    (key) => performanceConfig.sections[key].visible
  ).length;

  const persistConfig = (updater: (config: StoryflowPerformanceConfig) => StoryflowPerformanceConfig) => {
    onError(null);
    onNotice(null);
    onSaveConfig(updater(performanceConfig));
  };

  const updateSection = (
    key: StoryflowPerformanceSectionKey,
    updater: (section: StoryflowPerformanceSectionConfig) => StoryflowPerformanceSectionConfig
  ) => {
    persistConfig((current) => ({
      ...current,
      sections: {
        ...current.sections,
        [key]: updater(current.sections[key]),
      },
    }));
  };

  const handleBatchUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []).filter((file) =>
      file.type.startsWith("image/")
    );
    if (!files.length) return;

    setIsUploadingAll(true);
    onError(null);
    onNotice(null);

    try {
      const resizedImages: string[] = [];
      const limitedFiles = files.slice(0, PERFORMANCE_SECTION_ORDER.length);
      for (const file of limitedFiles) {
        // eslint-disable-next-line no-await-in-loop
        resizedImages.push(await resizeImageFile(file));
      }

      persistConfig((current) => {
        const nextSections = { ...current.sections };
        PERFORMANCE_SECTION_ORDER.forEach((key, index) => {
          if (!resizedImages[index]) return;
          nextSections[key] = {
            ...nextSections[key],
            image: resizedImages[index],
          };
        });
        return {
          ...current,
          sections: nextSections,
        };
      });
      onNotice(`已按顺序把 ${resizedImages.length} 张图片分配到六个训练区域。`);
    } catch (error) {
      onError(error instanceof Error ? error.message : "图片处理失败");
    } finally {
      setIsUploadingAll(false);
      if (event.target) {
        event.target.value = "";
      }
    }
  };

  const handleSingleImageUpload = async (
    key: StoryflowPerformanceSectionKey,
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploadingSectionKey(key);
    onError(null);
    onNotice(null);

    try {
      const image = await resizeImageFile(file);
      updateSection(key, (section) => ({
        ...section,
        image,
      }));
      onNotice(`${performanceConfig.sections[key].title}图片已更新。`);
    } catch (error) {
      onError(error instanceof Error ? error.message : "图片处理失败");
    } finally {
      setUploadingSectionKey(null);
      if (event.target) {
        event.target.value = "";
      }
    }
  };

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.02fr)_minmax(420px,0.98fr)]">
      <section className="rounded-[1.8rem] border border-sky-100/80 bg-white/82 p-5 shadow-[0_18px_50px_rgba(148,163,184,0.12)] backdrop-blur">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-500">
              Performance Editor
            </p>
            <h3 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
              脱稿表演作业编辑区
            </h3>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              六个训练区域共用一套图片与文字支架。支持一次上传并按顺序自动分配，也可单独替换。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-700">
              已启用 {visibleCount} / 6
            </span>
            <label className="inline-flex cursor-pointer items-center rounded-full bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-700">
              {isUploadingAll ? "处理中..." : "一次上传 6 张图片"}
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleBatchUpload}
                disabled={isUploadingAll}
              />
            </label>
          </div>
        </div>

        <div className="mt-5 space-y-4">
          {PERFORMANCE_SECTION_ORDER.map((key, index) => {
            const section = performanceConfig.sections[key];
            const meta = PERFORMANCE_EDITOR_META[key];

            return (
              <div
                key={key}
                className="rounded-[1.55rem] border border-sky-100/90 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(247,250,255,0.98))] p-4 shadow-[0_12px_28px_rgba(120,149,188,0.08)]"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className={`grid h-7 w-7 place-items-center rounded-full text-xs font-semibold ${meta.numberClass}`}>
                      {index + 1}
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-[1.05rem] font-semibold tracking-tight text-slate-900">
                          {section.title}
                        </p>
                        <span className={`rounded-full px-2.5 py-1 text-[0.72rem] font-semibold ${meta.accentClass}`}>
                          {section.visible ? "显示中" : "已隐藏"}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-slate-500">{meta.helper}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      updateSection(key, (current) => ({
                        ...current,
                        visible: !current.visible,
                      }))
                    }
                    className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold transition ${
                      section.visible
                        ? "bg-sky-600 text-white shadow-sm shadow-sky-500/30 hover:bg-sky-700"
                        : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                    }`}
                  >
                    <span
                      className={`h-2.5 w-2.5 rounded-full ${
                        section.visible ? "bg-white" : "bg-slate-400"
                      }`}
                    />
                    {section.visible ? "显示" : "隐藏"}
                  </button>
                </div>

                <div className="mt-4 grid gap-4 xl:grid-cols-[182px_minmax(0,1fr)]">
                  <div className="space-y-3">
                    <div className="overflow-hidden rounded-[1.2rem] border border-sky-100 bg-slate-50">
                      {section.image ? (
                        <img
                          src={section.image}
                          alt={section.title}
                          className="h-[132px] w-full object-cover object-center"
                        />
                      ) : (
                        <div className="grid h-[132px] place-items-center px-4 text-center text-sm text-slate-400">
                          暂无区域配图
                        </div>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="inline-flex cursor-pointer items-center justify-center rounded-2xl bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-700 transition hover:bg-sky-100">
                        {uploadingSectionKey === key ? "处理中..." : "替换图片"}
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(event) => void handleSingleImageUpload(key, event)}
                          disabled={uploadingSectionKey === key}
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() =>
                          updateSection(key, (current) => ({
                            ...current,
                            image: "",
                          }))
                        }
                        className="rounded-2xl bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-200"
                      >
                        清空图片
                      </button>
                    </div>
                  </div>

                  <div className="grid gap-3">
                    <label className="grid gap-2">
                      <span className="text-sm font-semibold text-slate-700">区域说明</span>
                      <input
                        value={section.description}
                        onChange={(event) =>
                          updateSection(key, (current) => ({
                            ...current,
                            description: event.target.value,
                          }))
                        }
                        className="rounded-2xl border border-sky-100 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                        placeholder="这张卡片在学生端要起什么作用"
                      />
                    </label>

                    <label className="grid gap-2">
                      <span className="text-sm font-semibold text-slate-700">卡片内容</span>
                      <textarea
                        value={section.content.join("\n")}
                        onChange={(event) =>
                          updateSection(key, (current) => ({
                            ...current,
                            content: event.target.value
                              .split("\n")
                              .map((item) => item.trim())
                              .filter(Boolean)
                              .slice(0, 8),
                          }))
                        }
                        rows={4}
                        className="min-h-[118px] rounded-[1.2rem] border border-sky-100 bg-white px-4 py-3 text-sm leading-6 text-slate-700 outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                        placeholder={meta.placeholder}
                      />
                    </label>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-[1.8rem] border border-sky-100/80 bg-white/82 p-5 shadow-[0_18px_50px_rgba(148,163,184,0.12)] backdrop-blur">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-500">
              Student Preview
            </p>
            <h3 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
              学生端预览
            </h3>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              右侧实时预览学生在“脱稿表演”任务里看到的页面结构和内容。
            </p>
          </div>
          <div className="inline-flex rounded-full bg-sky-50 p-1">
            <span className="rounded-full bg-white px-3 py-1.5 text-sm font-semibold text-sky-700 shadow-sm">
              学生端预览
            </span>
            <span className="px-3 py-1.5 text-sm font-semibold text-slate-400">家长端预览</span>
          </div>
        </div>

        <div className="mt-4">
          <PerformanceTaskPreview
            document={document}
            config={performanceConfig}
            coverImageUrl={coverImageUrl}
            teacherName={teacherName}
            studentName="Leo"
            variant="teacher"
          />
        </div>
      </section>
    </div>
  );
};

const StudentShadowSubmissionBoard = ({
  document,
  teacherName,
}: {
  document: StoryflowDocument;
  teacherName: string;
}) => {
  const [assignments, setAssignments] = useState<StoryflowAssignment[]>([]);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [rescoringId, setRescoringId] = useState<string | null>(null);

  const totalPages = Math.max(
    document.pageObjectKeys?.length || 0,
    document.pageCount || 0,
    document.analysis.shadowPageTexts?.length || 0,
    document.analysis.pages?.length || 0
  );
  const referenceText = useMemo(
    () =>
      buildResolvedShadowTexts(document.analysis, totalPages)
        .map((text) => text.trim())
        .filter(Boolean)
        .join("\n"),
    [document.analysis, totalPages]
  );

  const refreshAssignments = () => {
    const next = getTeacherStoryflowAssignments(document.teacherUsername).filter(
      (item) => item.documentId === document.id
    );
    setAssignments(next);
    setNoteDrafts(
      next.reduce<Record<string, string>>((current, item) => {
        current[item.id] = item.shadowSubmission?.teacherNote || "";
        return current;
      }, {})
    );
  };

  useEffect(() => {
    refreshAssignments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [document.id, document.teacherUsername]);

  const handleSaveNote = (assignmentId: string) => {
    const updated = updateStoryflowAssignment(assignmentId, (current) => ({
      ...current,
      shadowSubmission: current.shadowSubmission
        ? {
            ...current.shadowSubmission,
            teacherNote: noteDrafts[assignmentId] || "",
          }
        : current.shadowSubmission,
    }));
    if (updated) {
      refreshAssignments();
    }
  };

  const handleRescore = async (assignment: StoryflowAssignment) => {
    const submission = assignment.shadowSubmission;
    if (!submission?.audioDataUrl) return;

    setRescoringId(assignment.id);
    try {
      const response = await fetch(submission.audioDataUrl);
      const blob = await response.blob();
      const formData = new FormData();
      formData.append("audio", blob, submission.audioFileName || "shadow-reading.wav");
      formData.append("referenceText", referenceText);
      formData.append("studentName", assignment.studentDisplayName || assignment.studentUsername);
      formData.append("bookName", document.analysis.title || document.sourceName || "");
      formData.append("homeworkType", "绘本跟读");
      formData.append("tutorName", teacherName);

      const scoreResponse = await fetch("/api/storyflow/score-audio", {
        method: "POST",
        body: formData,
      });
      const payload = (await scoreResponse.json()) as {
        result?: AnalysisResult;
        error?: string;
      };
      if (!scoreResponse.ok || !payload.result) {
        throw new Error(payload.error || "重新评分失败");
      }

      updateStoryflowAssignment(assignment.id, (current) => ({
        ...current,
        shadowSubmission: current.shadowSubmission
          ? {
              ...current.shadowSubmission,
              teacherAssessment: payload.result,
              teacherNote: noteDrafts[assignment.id] || current.shadowSubmission.teacherNote || "",
            }
          : current.shadowSubmission,
      }));
      refreshAssignments();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "重新评分失败");
    } finally {
      setRescoringId(null);
    }
  };

  return (
    <section className="rounded-[1.6rem] border border-slate-100 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
            Shadow Homework
          </p>
          <h4 className="mt-2 text-2xl font-black text-slate-900">学生影子跟读作业</h4>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            查看每位学生是否完成影子跟读，试听录音，并可重新评分和填写老师点评。
          </p>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">
          {assignments.length} 个任务
        </span>
      </div>

      <div className="mt-4 space-y-4">
        {assignments.length ? (
          assignments.map((assignment) => {
            const submission = assignment.shadowSubmission;
            const assessment =
              submission?.teacherAssessment || submission?.studentAssessment || null;
            const score = assessment
              ? Math.round(
                  (assessment.fluency.score +
                    assessment.pronunciation.score +
                    assessment.intonation.score +
                    assessment.vocabulary.score +
                    assessment.emotion.score) /
                    5
                )
              : null;

            return (
              <div
                key={assignment.id}
                className="rounded-[1.35rem] border border-slate-100 bg-slate-50 p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-lg font-bold text-slate-900">
                        {assignment.studentDisplayName}
                      </p>
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-bold ${
                          submission
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-slate-200 text-slate-600"
                        }`}
                      >
                        {submission ? "已提交" : "未完成"}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">
                      {submission
                        ? `提交时间：${formatTime(submission.completedAt)}`
                        : "学生还没有完成影子跟读作业。"}
                    </p>
                  </div>
                  {score !== null ? (
                    <div className="rounded-[1rem] bg-slate-900 px-4 py-3 text-center text-white">
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/70">
                        当前总分
                      </p>
                      <p className="mt-1 text-2xl font-black">{score}</p>
                    </div>
                  ) : null}
                </div>

                {submission ? (
                  <>
                    <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
                      <div className="rounded-[1.1rem] bg-white p-4 shadow-sm">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <p className="text-sm font-bold text-slate-800">学生录音</p>
                          <a
                            href={submission.audioDataUrl}
                            download={submission.audioFileName || "shadow-reading.wav"}
                            className="rounded-full bg-sky-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-sky-500"
                          >
                            下载音频
                          </a>
                        </div>
                        <audio controls src={submission.audioDataUrl} className="mt-3 w-full" />
                        <p className="mt-3 text-xs leading-5 text-slate-500">
                          时长 {formatAudioSeconds(submission.durationSec || 0)} · 录制片段 {submission.clipCount || 0} 段
                        </p>
                      </div>

                      <div className="rounded-[1.1rem] bg-white p-4 shadow-sm">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-bold text-slate-800">老师点评</p>
                          <button
                            type="button"
                            onClick={() => void handleRescore(assignment)}
                            disabled={rescoringId === assignment.id}
                            className="rounded-full bg-slate-900 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {rescoringId === assignment.id ? "评分中..." : "重新评分"}
                          </button>
                        </div>
                        <textarea
                          value={noteDrafts[assignment.id] || ""}
                          onChange={(event) =>
                            setNoteDrafts((current) => ({
                              ...current,
                              [assignment.id]: event.target.value,
                            }))
                          }
                          rows={5}
                          className="mt-3 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-700 outline-none"
                          placeholder="填写老师给学生的影子跟读反馈"
                        />
                        <button
                          type="button"
                          onClick={() => handleSaveNote(assignment.id)}
                          className="mt-3 rounded-full bg-sky-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-sky-500"
                        >
                          保存点评
                        </button>
                      </div>
                    </div>

                    {assessment ? (
                      <div className="mt-4 rounded-[1.1rem] bg-white p-4 shadow-sm">
                        <div className="grid gap-2 sm:grid-cols-5">
                          {[
                            ["流畅", assessment.fluency.score],
                            ["发音", assessment.pronunciation.score],
                            ["语调", assessment.intonation.score],
                            ["词汇", assessment.vocabulary.score],
                            ["表达", assessment.emotion.score],
                          ].map(([label, value]) => (
                            <div
                              key={`${assignment.id}_${String(label)}`}
                              className="rounded-xl bg-slate-50 px-3 py-2 text-center"
                            >
                              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                                {label}
                              </p>
                              <p className="mt-1 text-xl font-black text-slate-800">{value}</p>
                            </div>
                          ))}
                        </div>
                        <div className="mt-3 rounded-xl bg-slate-50 px-4 py-3">
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                            {submission.teacherAssessment ? "老师点评" : "当前评分点评"}
                          </p>
                          <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-700">
                            {assessment.overallComment}
                          </p>
                        </div>
                      </div>
                    ) : null}
                  </>
                ) : null}
              </div>
            );
          })
        ) : (
          <div className="rounded-[1.1rem] bg-slate-50 px-4 py-4 text-sm text-slate-500">
            这份绘本还没有发布给学生，或者还没有学生任务记录。
          </div>
        )}
      </div>
    </section>
  );
};

const ScoreFeedbackBoard = ({
  document,
  teacherName,
  onSaveAssessments,
}: {
  document: StoryflowDocument;
  teacherName: string;
  onSaveAssessments: (assessments: StoryflowTaskAssessments) => void;
}) => {
  const baselineAssessments = useMemo(
    () => buildStoryflowAssessments(document, teacherName),
    [document, teacherName]
  );
  const [draftAssessments, setDraftAssessments] = useState(baselineAssessments);

  useEffect(() => {
    setDraftAssessments(baselineAssessments);
  }, [baselineAssessments]);

  const hasChanges =
    JSON.stringify(draftAssessments) !== JSON.stringify(baselineAssessments);

  const updateScoreField = (
    key: StoryflowAssessmentKey,
    field: (typeof STORYFLOW_SCORE_FIELDS)[number]["key"],
    score: number
  ) => {
    setDraftAssessments((current) => ({
      ...current,
      [key]: {
        ...current[key],
        [field]: {
          ...current[key][field],
          score: clampScore(score),
        },
      },
    }));
  };

  const updateCommentField = (
    key: StoryflowAssessmentKey,
    field: (typeof STORYFLOW_SCORE_FIELDS)[number]["key"],
    comment: string
  ) => {
    setDraftAssessments((current) => ({
      ...current,
      [key]: {
        ...current[key],
        [field]: {
          ...current[key][field],
          comment,
        },
      },
    }));
  };

  const updateAssessmentText = (
    key: StoryflowAssessmentKey,
    field: "overallComment" | "grammarSummary",
    value: string
  ) => {
    setDraftAssessments((current) => ({
      ...current,
      [key]: {
        ...current[key],
        [field]: value,
      },
    }));
  };

  const updateSuggestions = (key: StoryflowAssessmentKey, value: string) => {
    setDraftAssessments((current) => ({
      ...current,
      [key]: {
        ...current[key],
        suggestions: value
          .split("\n")
          .map((item) => item.trim())
          .filter(Boolean),
      },
    }));
  };

  const handleSave = () => {
    onSaveAssessments(draftAssessments);
  };

  return (
    <div className="space-y-5 rounded-[1.8rem] bg-white/75 p-5 shadow-[0_18px_50px_rgba(148,163,184,0.12)]">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[1.5rem] bg-slate-50 px-4 py-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
            Score Feedback
          </p>
          <h3 className="mt-2 text-2xl font-black text-slate-900">得分点评</h3>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            这里汇总影子跟读、看图说话、脱稿表演三类评分。老师可以直接修改分数和点评内容。
          </p>
        </div>
        <button
          type="button"
          onClick={handleSave}
          className="rounded-full bg-slate-900 px-5 py-3 text-sm font-bold text-white transition hover:bg-slate-800"
        >
          保存点评
        </button>
      </div>

      {(["shadow", "speaking", "performance"] as StoryflowAssessmentKey[]).map((key) => {
        const assessment = draftAssessments[key];
        const meta = STORYFLOW_ASSESSMENT_META[key];
        const averageScore = Math.round(
          STORYFLOW_SCORE_FIELDS.reduce(
            (sum, item) => sum + assessment[item.key].score,
            0
          ) / STORYFLOW_SCORE_FIELDS.length
        );

        return (
          <section
            key={key}
            className="rounded-[1.6rem] border border-slate-100 bg-white p-5 shadow-sm"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-3 py-1 text-xs font-bold ${meta.badgeClass}`}>
                    {meta.homeworkType}
                  </span>
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                    {key === "shadow" ? "这是影子跟读的得分" : "老师可手动填写或修改"}
                  </span>
                </div>
                <h4 className={`mt-3 text-2xl font-black ${meta.accentClass}`}>{meta.title}</h4>
              </div>
              <div className="rounded-[1.2rem] bg-slate-900 px-4 py-3 text-center text-white">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/70">
                  总分
                </p>
                <p className="mt-1 text-3xl font-black">{averageScore}</p>
              </div>
            </div>

            <div className="mt-4 grid gap-3 xl:grid-cols-5">
              {STORYFLOW_SCORE_FIELDS.map((item) => (
                <div
                  key={`${key}-${item.key}`}
                  className="rounded-[1.2rem] border border-slate-100 bg-slate-50 p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-bold text-slate-800">{item.label}</p>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={assessment[item.key].score}
                      onChange={(event) =>
                        updateScoreField(key, item.key, Number(event.target.value) || 0)
                      }
                      className="w-16 rounded-lg border border-slate-200 bg-white px-2 py-1 text-right text-sm font-bold text-slate-900 outline-none ring-0"
                    />
                  </div>
                  <textarea
                    value={assessment[item.key].comment}
                    onChange={(event) =>
                      updateCommentField(key, item.key, event.target.value)
                    }
                    rows={4}
                    className="mt-3 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm leading-6 text-slate-700 outline-none"
                    placeholder={`${item.label}点评`}
                  />
                </div>
              ))}
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div className="rounded-[1.2rem] border border-slate-100 bg-slate-50 p-4">
                <p className="text-sm font-bold text-slate-800">整体点评</p>
                <textarea
                  value={assessment.overallComment}
                  onChange={(event) =>
                    updateAssessmentText(key, "overallComment", event.target.value)
                  }
                  rows={6}
                  className="mt-3 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm leading-6 text-slate-700 outline-none"
                  placeholder="填写整体点评内容"
                />
              </div>
              <div className="rounded-[1.2rem] border border-slate-100 bg-slate-50 p-4">
                <p className="text-sm font-bold text-slate-800">训练建议</p>
                <textarea
                  value={assessment.suggestions.join("\n")}
                  onChange={(event) => updateSuggestions(key, event.target.value)}
                  rows={6}
                  className="mt-3 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm leading-6 text-slate-700 outline-none"
                  placeholder={"每行一条建议"}
                />
              </div>
            </div>

            <div className="mt-4 rounded-[1.2rem] border border-slate-100 bg-slate-50 p-4">
              <p className="text-sm font-bold text-slate-800">补充说明</p>
              <textarea
                value={assessment.grammarSummary || ""}
                onChange={(event) =>
                  updateAssessmentText(key, "grammarSummary", event.target.value)
                }
                rows={4}
                className="mt-3 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm leading-6 text-slate-700 outline-none"
                placeholder="可补充老师备注、语法说明或课堂反馈"
              />
            </div>
          </section>
        );
      })}

      {hasChanges ? (
        <div className="rounded-[1.2rem] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          当前有未保存的点评修改。
        </div>
      ) : null}

      <StudentShadowSubmissionBoard document={document} teacherName={teacherName} />
    </div>
  );
};

const SpeakingDeck = ({
  document,
  pageIndex,
  onChangePageIndex,
  getDocumentPageUrl,
  onSavePracticeRecord,
}: {
  document: StoryflowDocument;
  pageIndex: number;
  onChangePageIndex: (index: number) => void;
  getDocumentPageUrl: (doc: StoryflowDocument, idx: number) => string;
  onSavePracticeRecord: (record: StoryflowSpeakingPracticeRecord) => void;
}) => {
  const totalPages = Math.max(
    document.pageObjectKeys?.length || 0,
    document.pageCount || 0,
    document.analysis.shadowPageTexts?.length || 0,
    document.analysis.pages?.length || 0
  );
  const shadowTexts = buildResolvedShadowTexts(document.analysis, totalPages);
  const pages = buildSpeakingPracticePages(
    document.analysis.pages || [],
    shadowTexts,
    document.pageObjectKeys || []
  );
  const safeIndex = Math.min(Math.max(0, pageIndex), Math.max(0, pages.length - 1));
  const page = pages[safeIndex];
  const total = pages.length;
  const [hintStage, setHintStage] = useState<0 | 1 | 2>(0);
  const [practiceStatus, setPracticeStatus] = useState<"idle" | "countdown" | "active">("idle");
  const [countdownValue, setCountdownValue] = useState(3);
  const [practiceDraft, setPracticeDraft] = useState<SpeakingPracticeDraft | null>(null);
  const [latestPracticeId, setLatestPracticeId] = useState<string | null>(null);
  const [isPracticeHistoryOpen, setIsPracticeHistoryOpen] = useState(false);
  const practiceRecords = document.speakingPracticeRecords || [];

  useEffect(() => {
    if (pageIndex !== safeIndex) {
      onChangePageIndex(safeIndex);
    }
  }, [onChangePageIndex, pageIndex, safeIndex]);

  useEffect(() => {
    setHintStage(0);
  }, [document.id, safeIndex]);

  useEffect(() => {
    setPracticeStatus("idle");
    setCountdownValue(3);
    setPracticeDraft(null);
    setLatestPracticeId(null);
    setIsPracticeHistoryOpen(false);
  }, [document.id]);

  useEffect(() => {
    if (practiceStatus !== "countdown") return undefined;

    if (countdownValue <= 1) {
      const timer = window.setTimeout(() => {
        setPracticeStatus("active");
        setCountdownValue(3);
        setPracticeDraft((current) =>
          current
            ? {
                ...current,
                startedAt: Date.now(),
              }
            : current
        );
      }, 1000);
      return () => window.clearTimeout(timer);
    }

    const timer = window.setTimeout(() => {
      setCountdownValue((current) => current - 1);
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [countdownValue, practiceStatus]);

  useEffect(() => {
    if (practiceStatus !== "active" || !page) return;

    setPracticeDraft((current) => {
      if (!current) return current;
      if (current.visitedPageIndexes.includes(page.pageIndex)) {
        return current;
      }
      return {
        ...current,
        visitedPageIndexes: [...current.visitedPageIndexes, page.pageIndex],
      };
    });
  }, [page, practiceStatus]);

  if (!page) {
    return (
      <div className="rounded-[1.8rem] bg-white p-6 text-center shadow-[0_18px_50px_rgba(148,163,184,0.12)]">
        暂无看图说话页面。
      </div>
    );
  }

  const canPrev = safeIndex > 0;
  const canNext = safeIndex < total - 1;
  const pageImageUrl = getDocumentPageUrl(document, page.pageIndex);
  const showTeacherHints = hintStage >= 1;
  const showOriginalText = hintStage >= 2;
  const isPracticeActive = practiceStatus === "active";
  const isCountingDown = practiceStatus === "countdown";
  const clozePromptHint = buildClozePromptHint(
    page.visibleText,
    document.analysis.keywords || [],
    document.analysis.fullText || "",
    page.keyVocabulary
  );
  const displayPromptText = showOriginalText ? page.visibleText : clozePromptHint;
  const latestPracticeRecord = latestPracticeId
    ? practiceRecords.find((item) => item.id === latestPracticeId) || null
    : practiceRecords[0] || null;

  const recordPracticeReveal = (kind: "prompt" | "original") => {
    if (!isPracticeActive) return;

    setPracticeDraft((current) => {
      if (!current) return current;

      if (kind === "prompt") {
        if (current.promptViewedTexts.some((item) => item.pageIndex === page.pageIndex)) {
          return current;
        }
        return {
          ...current,
          promptRevealCount: current.promptRevealCount + 1,
          promptViewedTexts: [
            ...current.promptViewedTexts,
            {
              pageIndex: page.pageIndex,
              text: page.visibleText,
            },
          ],
        };
      }

      if (current.originalViewedTexts.some((item) => item.pageIndex === page.pageIndex)) {
        return current;
      }
      return {
        ...current,
        originalRevealCount: current.originalRevealCount + 1,
        originalViewedTexts: [
          ...current.originalViewedTexts,
          {
            pageIndex: page.pageIndex,
            text: page.visibleText,
          },
        ],
      };
    });
  };

  const handleStartPractice = () => {
    setHintStage(0);
    setLatestPracticeId(null);
    setCountdownValue(3);
    setPracticeDraft({
      startedAt: 0,
      promptRevealCount: 0,
      originalRevealCount: 0,
      visitedPageIndexes: [page.pageIndex],
      promptViewedTexts: [],
      originalViewedTexts: [],
    });
    setPracticeStatus("countdown");
  };

  const handleFinishPractice = () => {
    if (practiceStatus !== "active" || !practiceDraft) return;

    const durationSec = Math.max(1, Math.round((Date.now() - practiceDraft.startedAt) / 1000));
    const practicedPages = practiceDraft.visitedPageIndexes.length;
    const { score, ratingLabel } = scoreSpeakingPractice({
      durationSec,
      promptRevealCount: practiceDraft.promptRevealCount,
      originalRevealCount: practiceDraft.originalRevealCount,
      totalPages: total,
      practicedPages,
    });

    const record: StoryflowSpeakingPracticeRecord = {
      id: `practice_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now(),
      durationSec,
      promptRevealCount: practiceDraft.promptRevealCount,
      originalRevealCount: practiceDraft.originalRevealCount,
      totalPages: total,
      practicedPages,
      score,
      ratingLabel,
      promptViewedTexts: practiceDraft.promptViewedTexts,
      originalViewedTexts: practiceDraft.originalViewedTexts,
    };

    onSavePracticeRecord(record);
    setLatestPracticeId(record.id);
    setIsPracticeHistoryOpen(true);
    setPracticeStatus("idle");
    setHintStage(0);
    setCountdownValue(3);
    setPracticeDraft(null);
  };

  return (
    <div className="max-h-[92vh] overflow-y-auto overflow-x-hidden rounded-[1.9rem] bg-[radial-gradient(circle_at_top,_rgba(147,197,253,0.7),_rgba(224,242,254,0.9)_55%,_rgba(240,249,255,0.98)_100%)] shadow-[0_18px_60px_rgba(59,130,246,0.14)]">
      <div className="relative flex min-h-[680px] flex-col">
        <div className="absolute inset-0 opacity-60">
          <div className="absolute -left-10 top-10 h-40 w-40 rounded-full bg-sky-200/40 blur-2xl" />
          <div className="absolute right-10 top-20 h-56 w-56 rounded-full bg-cyan-200/35 blur-3xl" />
          <div className="absolute left-1/2 top-1/2 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/35 blur-3xl" />
        </div>

        <div className="relative flex min-h-[240px] items-center justify-center px-4 pb-2 pt-4 md:min-h-[320px] md:px-6 lg:min-h-[420px]">
          <button
            type="button"
            disabled={!canPrev}
            onClick={() => onChangePageIndex(safeIndex - 1)}
            className="absolute left-5 top-1/2 z-10 grid h-14 w-14 -translate-y-1/2 place-items-center rounded-full bg-white/85 text-2xl font-black text-slate-700 shadow-md transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="prev speaking page"
          >
            ‹
          </button>

          <button
            type="button"
            disabled={!canNext}
            onClick={() => onChangePageIndex(safeIndex + 1)}
            className="absolute right-5 top-1/2 z-10 grid h-14 w-14 -translate-y-1/2 place-items-center rounded-full bg-white/85 text-2xl font-black text-slate-700 shadow-md transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="next speaking page"
          >
            ›
          </button>

          <div className="flex w-full max-w-[1040px] items-center justify-center">
            {pageImageUrl ? (
              <img
                src={pageImageUrl}
                alt={page.pageTitle}
                className="max-h-[54vh] w-auto max-w-full rounded-[1.6rem] object-contain shadow-[0_18px_40px_rgba(15,23,42,0.12)]"
              />
            ) : (
              <div className="grid h-[280px] w-full place-items-center rounded-[1.7rem] bg-white text-lg font-bold text-slate-400 shadow-sm md:h-[340px]">
                页面预览加载中
              </div>
            )}
          </div>

          {isCountingDown ? (
            <div className="absolute inset-0 z-20 flex items-center justify-center rounded-[1.6rem] bg-slate-950/28 backdrop-blur-[2px]">
              <div className="grid h-32 w-32 place-items-center rounded-full bg-white/92 text-5xl font-black text-sky-700 shadow-[0_18px_40px_rgba(15,23,42,0.18)]">
                {countdownValue}
              </div>
            </div>
          ) : null}

          <div className="absolute bottom-3 left-4 rounded-full bg-sky-500/75 px-4 py-2 text-sm font-black text-white shadow-lg shadow-sky-400/20 backdrop-blur md:left-5 md:text-base">
            练习页 {safeIndex + 1} / {total}
          </div>
        </div>

        <div className="relative flex justify-center px-4 pb-2">
          <div className="flex flex-wrap items-center justify-center gap-2 rounded-full bg-white/72 px-3 py-2 shadow-sm backdrop-blur">
            <button
              type="button"
              onClick={handleStartPractice}
              disabled={practiceStatus !== "idle"}
              className="rounded-full bg-sky-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              开始练习
            </button>
            <button
              type="button"
              onClick={handleFinishPractice}
              disabled={!isPracticeActive}
              className="rounded-full bg-sky-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              完成练习
            </button>
            <span className="rounded-full bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white opacity-90">
              {isCountingDown
                ? "倒计时中"
                : isPracticeActive
                  ? "练习进行中"
                  : "未开始"}
            </span>
          </div>
        </div>

        <div className="relative shrink-0 border-t border-white/50 bg-white/68 px-4 pb-4 pt-3 backdrop-blur md:px-5">
          <div className="mx-auto mb-2 h-1.5 w-16 rounded-full bg-sky-300/70" />

          <div className="mx-auto max-w-[1040px]">
            <div className="rounded-[1.25rem] border border-white/80 bg-white/82 px-4 py-0.5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-1.5">
                <div className="max-w-[720px]">
                  <p className="text-sm font-semibold text-slate-900">练习目标</p>
                  <p className="mt-0 text-sm leading-4 text-slate-600">
                    先看图片，自己回忆并复述这一页的绘本原文。想不起来时，再按顺序领取提示，不要一开始就看答案。
                  </p>
                </div>
                <div className="min-w-[104px] rounded-[1rem] bg-sky-50 px-3 py-0.5 text-center">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-500">
                    评分
                  </p>
                  <p className="mt-0 text-[1.2rem] font-black leading-tight text-sky-800">
                    {latestPracticeRecord?.ratingLabel || "-"}
                  </p>
                  <button
                    type="button"
                    onClick={() => setIsPracticeHistoryOpen((current) => !current)}
                    className="mt-0.5 rounded-full bg-sky-600 px-3 py-[3px] text-xs font-bold text-white transition hover:bg-sky-500"
                  >
                    练习记录
                  </button>
                </div>
              </div>
              <div className="mt-0 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setHintStage(0)}
                  disabled={!isPracticeActive}
                  className={`rounded-full bg-sky-600 px-3 py-1.5 text-xs font-bold text-white transition ${
                    hintStage === 0
                      ? "opacity-100"
                      : "opacity-80 hover:opacity-100"
                  } disabled:cursor-not-allowed disabled:opacity-45`}
                >
                  只看图片
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!isPracticeActive) return;
                    if (hintStage < 1) {
                      recordPracticeReveal("prompt");
                    }
                    setHintStage((current) => (current < 1 ? 1 : current));
                  }}
                  disabled={!isPracticeActive}
                  className={`rounded-full bg-sky-600 px-3 py-1.5 text-xs font-bold text-white transition ${
                    hintStage >= 1
                      ? "opacity-100"
                      : "opacity-80 hover:opacity-100"
                  } disabled:cursor-not-allowed disabled:opacity-45`}
                >
                  给点提示
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!isPracticeActive) return;
                    if (hintStage < 2) {
                      recordPracticeReveal("original");
                    }
                    setHintStage(2);
                  }}
                  disabled={!isPracticeActive}
                  className={`rounded-full bg-sky-600 px-3 py-1.5 text-xs font-bold text-white transition ${
                    hintStage >= 2
                      ? "opacity-100"
                      : "opacity-80 hover:opacity-100"
                  } disabled:cursor-not-allowed disabled:opacity-45`}
                >
                  显示原文
                </button>
              </div>
            </div>

            <div className="mt-3">
              <div className="rounded-[1.25rem] border border-emerald-100 bg-white/85 p-2 shadow-sm">
                {showTeacherHints ? (
                  <>
                    <div className="mt-0.5">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                        {showOriginalText ? "原文" : "原文填空"}
                      </p>
                      <div className="mt-1 rounded-[1.2rem] bg-emerald-50 px-3 py-3 shadow-inner shadow-emerald-100/50 md:px-4 md:py-4">
                        <p className="text-[1.125rem] font-semibold leading-[1.9] tracking-[0.03em] text-emerald-900 md:text-[1.85rem]">
                          {displayPromptText || "暂无原文提示"}
                        </p>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="mt-1 rounded-[1.1rem] bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-500">
                    点击“给点提示”会出现原文填空，帮助孩子慢慢想起原文。
                  </div>
                )}
              </div>
            </div>

            {isPracticeHistoryOpen ? (
              <div className="mt-4 rounded-[1.25rem] border border-white/80 bg-white/82 p-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">练习记录</p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      每次完成练习后，会自动记录时间、提示次数、原文次数和评级。
                    </p>
                  </div>
                </div>

                {practiceRecords.length ? (
                  <div className="mt-4 overflow-x-auto">
                    <table className="min-w-full border-separate border-spacing-y-2">
                      <thead>
                        <tr className="text-left text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                          <th className="px-3 py-2">练习时间</th>
                          <th className="px-3 py-2">用时</th>
                          <th className="px-3 py-2">看提示</th>
                          <th className="px-3 py-2">看原文</th>
                          <th className="px-3 py-2">练习页数</th>
                          <th className="px-3 py-2">评分</th>
                          <th className="px-3 py-2">提示英文总结</th>
                          <th className="px-3 py-2">原文英文总结</th>
                        </tr>
                      </thead>
                      <tbody>
                        {practiceRecords.map((record) => (
                          <tr
                            key={record.id}
                            className={`rounded-[1rem] bg-slate-50 text-sm text-slate-700 ${
                              record.id === latestPracticeId ? "ring-2 ring-sky-200" : ""
                            }`}
                          >
                            <td className="rounded-l-[1rem] px-3 py-3 font-semibold text-slate-900">
                              {formatPracticeTime(record.createdAt)}
                            </td>
                            <td className="px-3 py-3">{formatPracticeDuration(record.durationSec)}</td>
                            <td className="px-3 py-3">{record.promptRevealCount} 次</td>
                            <td className="px-3 py-3">{record.originalRevealCount} 次</td>
                            <td className="px-3 py-3">
                              {record.practicedPages}/{record.totalPages}
                            </td>
                            <td className="px-3 py-3 font-black text-sky-700">
                              {record.ratingLabel}
                            </td>
                            <td className="px-3 py-3 text-xs leading-5 text-slate-600">
                              {summarizePracticeTexts(record.promptViewedTexts)}
                            </td>
                            <td className="rounded-r-[1rem] px-3 py-3 text-xs leading-5 text-slate-600">
                              {summarizePracticeTexts(record.originalViewedTexts)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="mt-4 rounded-[1rem] bg-slate-50 px-4 py-4 text-sm text-slate-500">
                    还没有练习记录。点击“开始练习”完成一次后，这里会自动生成可对比的历史记录。
                  </div>
                )}
              </div>
            ) : null}

          </div>
        </div>
      </div>
    </div>
  );
};

const filterPdfUploadedPages = (
  objectKeys: string[],
  pageTexts: string[]
) => {
  return {
    objectKeys: [...objectKeys],
    pageTexts: [...pageTexts],
  };
};

const buildShadowViews = (totalPages: number, isPdfDocument: boolean): ShadowView[] => {
  if (totalPages <= 0) return [];
  if (totalPages === 1) return [{ kind: "single", pages: [0] }];

  if (!isPdfDocument) {
    const normalViews: ShadowView[] = [{ kind: "single", pages: [0] }];
    for (let index = 1; index < totalPages; index += 2) {
      if (index + 1 < totalPages) {
        normalViews.push({ kind: "spread", pages: [index, index + 1] });
      } else {
        normalViews.push({ kind: "single", pages: [index] });
      }
    }
    return normalViews;
  }

  // PDF display rule:
  // - page 1: single
  // - page 2: single
  // - from page 3 onward: spreads in reading order
  const pdfViews: ShadowView[] = [{ kind: "single", pages: [0] }];
  if (totalPages <= 1) return pdfViews;

  pdfViews.push({ kind: "single", pages: [1] });

  let index = 2;
  while (index < totalPages) {
    const next = index + 1;
    if (next < totalPages) {
      pdfViews.push({ kind: "spread", pages: [index, next] });
      index += 2;
      continue;
    }
    pdfViews.push({ kind: "single", pages: [index] });
    index += 1;
  }

  return pdfViews;
};

const serializeCustomViews = (views: ShadowView[]): StoryflowCustomView[] =>
  views.map((view) => ({
    kind: view.kind,
    pages: [...view.pages],
  }));

const parseCustomViews = (
  rawViews: StoryflowCustomView[] | undefined,
  totalPages: number
): ShadowView[] => {
  if (!rawViews?.length) return [];

  const normalized: ShadowView[] = [];

  for (const item of rawViews) {
    if (item.kind === "single") {
      const page = item.pages[0];
      if (
        typeof page === "number" &&
        page >= 0 &&
        page < totalPages
      ) {
        normalized.push({ kind: "single", pages: [page] });
      }
      continue;
    }

    if (item.kind === "spread") {
      const left = item.pages[0] ?? null;
      const right = item.pages[1] ?? null;
      const leftValid =
        left === null ||
        (typeof left === "number" &&
          left >= 0 &&
          left < totalPages);
      const rightValid =
        right === null ||
        (typeof right === "number" &&
          right >= 0 &&
          right < totalPages);
      if (leftValid && rightValid && (left !== null || right !== null)) {
        normalized.push({ kind: "spread", pages: [left, right] });
      }
    }
  }

  return normalized;
};

const getEffectiveShadowViews = (document: StoryflowDocument): ShadowView[] => {
  const totalPages = document.pageObjectKeys?.length || document.pageCount || 0;
  const isPdfDocument = (document.sourceAssets || []).some(
    (asset) => asset.mimeType === "application/pdf"
  );
  const custom = parseCustomViews(document.customShadowViews, totalPages);
  if (custom.length) return custom;
  return buildShadowViews(totalPages, isPdfDocument);
};

const ShadowReader = forwardRef<ShadowReaderHandle, {
  document: StoryflowDocument;
  viewIndex: number;
  onChangeViewIndex: (index: number) => void;
  getDocumentPageUrl: (doc: StoryflowDocument, idx: number) => string;
  getAudioTrackUrl: (doc: StoryflowDocument, trackIndex: number) => string;
  savedAssessment: AnalysisResult | null;
  onAssessmentChange: (result: AnalysisResult) => void;
  onExit: () => void;
}>(({
  document,
  viewIndex,
  onChangeViewIndex,
  getDocumentPageUrl,
  getAudioTrackUrl,
  savedAssessment,
  onAssessmentChange,
  onExit,
}, ref) => {
  const totalPages = document.pageObjectKeys?.length || document.pageCount || 0;
  const views = useMemo(() => getEffectiveShadowViews(document), [document]);
  const shadowTexts = useMemo(
    () => buildResolvedShadowTexts(document.analysis, totalPages),
    [document.analysis, totalPages]
  );
  const navigationSteps = useMemo(
    () =>
      views.flatMap((item, index) => {
        if (item.kind === "single") {
          return [{ viewIndex: index, focus: 0 as const, pageIndex: item.pages[0] }];
        }

        const left = item.pages[0];
        const right = item.pages[1];
        const steps: Array<{ viewIndex: number; focus: 0 | 1; pageIndex: number }> = [];
        const leftText =
          typeof left === "number" ? getDisplayPageText(document.analysis.title, left, shadowTexts[left] || "") : "";
        const rightText =
          typeof right === "number"
            ? getDisplayPageText(document.analysis.title, right, shadowTexts[right] || "")
            : "";
        const hasLeftText = Boolean(leftText.trim());
        const hasRightText = Boolean(rightText.trim());
        const isMergedSpreadStep =
          (hasLeftText && !hasRightText) ||
          (!hasLeftText && hasRightText) ||
          (hasLeftText &&
            hasRightText &&
            (left === right || leftText.trim().toLowerCase() === rightText.trim().toLowerCase()));

        if (isMergedSpreadStep) {
          const mergedPageIndex =
            typeof left === "number" && hasLeftText
              ? left
              : typeof right === "number"
                ? right
                : left;
          if (typeof mergedPageIndex === "number") {
            steps.push({ viewIndex: index, focus: 0, pageIndex: mergedPageIndex });
          }
          return steps;
        }

        if (typeof left === "number") {
          steps.push({ viewIndex: index, focus: 0, pageIndex: left });
        }
        if (typeof right === "number" && right !== left) {
          steps.push({ viewIndex: index, focus: 1, pageIndex: right });
        }

        return steps;
      }),
    [document.analysis.title, shadowTexts, views]
  );
  const findStepIndexForView = (targetViewIndex: number, preferredFocus: 0 | 1 = 0) => {
    if (!navigationSteps.length) return 0;
    const exact = navigationSteps.findIndex(
      (item) => item.viewIndex === targetViewIndex && item.focus === preferredFocus
    );
    if (exact >= 0) return exact;
    const sameView = navigationSteps.findIndex((item) => item.viewIndex === targetViewIndex);
    return sameView >= 0 ? sameView : 0;
  };
  const externalViewIndex = Math.min(
    Math.max(0, viewIndex),
    Math.max(0, views.length - 1)
  );
  const [stepIndex, setStepIndex] = useState(() => findStepIndexForView(externalViewIndex));
  const requestedViewIndexRef = useRef<number | null>(null);
  const safeStepIndex = Math.min(
    Math.max(0, stepIndex),
    Math.max(0, navigationSteps.length - 1)
  );
  const currentStep = navigationSteps[safeStepIndex] || null;
  const safeIndex = currentStep?.viewIndex ?? externalViewIndex;
  const spreadFocus = currentStep?.focus ?? 0;
  const view = views[safeIndex] || null;
  const activeView: ShadowView = view || { kind: "spread", pages: [null, null] };
  const canPrev = safeStepIndex > 0;
  const canNext = safeStepIndex < navigationSteps.length - 1;
  const leftPageIndex =
    activeView.kind === "spread" ? activeView.pages[0] : activeView.pages[0];
  const rightPageIndex = activeView.kind === "spread" ? activeView.pages[1] : null;
  const leftText =
    typeof leftPageIndex === "number" && typeof shadowTexts[leftPageIndex] === "string"
      ? getDisplayPageText(
          document.analysis.title,
          leftPageIndex,
          shadowTexts[leftPageIndex]
        )
      : "";
  const rightText =
    typeof rightPageIndex === "number" && typeof shadowTexts[rightPageIndex] === "string"
      ? getDisplayPageText(
          document.analysis.title,
          rightPageIndex,
          shadowTexts[rightPageIndex]
        )
      : "";
  const isLeftBlankPage = activeView.kind === "spread" && activeView.pages[0] === null;
  const isRightBlankPage = activeView.kind === "spread" && activeView.pages[1] === null;
  const leftDisplayText = isLeftBlankPage ? "" : leftText || "";
  const rightDisplayText = isRightBlankPage ? "" : rightText || "";
  const hasLeftDisplayText = Boolean(leftDisplayText.trim());
  const hasRightDisplayText = Boolean(rightDisplayText.trim());
  const isDuplicatedSpreadText =
    activeView.kind === "spread" &&
    hasLeftDisplayText &&
    hasRightDisplayText &&
    (activeView.pages[0] === activeView.pages[1] ||
      leftDisplayText.trim().toLowerCase() === rightDisplayText.trim().toLowerCase());
  const shouldMergeSpreadTextBox =
    activeView.kind === "spread" &&
    ((hasLeftDisplayText && !hasRightDisplayText) ||
      (!hasLeftDisplayText && hasRightDisplayText) ||
      isDuplicatedSpreadText);
  const mergedSpreadText = hasLeftDisplayText ? leftDisplayText : rightDisplayText;
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [playbackProgress, setPlaybackProgress] = useState(0);
  const [playbackProgressByPage, setPlaybackProgressByPage] = useState<Record<number, number>>({});
  const [isRecording, setIsRecording] = useState(false);
  const [recordedClipsByKey, setRecordedClipsByKey] = useState<Record<string, ShadowRecordingClip>>({});
  const [sessionAssessment, setSessionAssessment] = useState<AnalysisResult | null>(
    savedAssessment
  );
  const [isSubmittingSessionScore, setIsSubmittingSessionScore] = useState(false);
  const [sessionScoreError, setSessionScoreError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordingStartMsRef = useRef<number>(0);
  const autoPlayTokenRef = useRef(0);
  const lastAutoPlayKeyRef = useRef<string | null>(null);
  const lastSubmittedRecordingSignatureRef = useRef<string | null>(null);

  const stopAudioPlayback = (invalidateSequence = true) => {
    if (invalidateSequence) {
      autoPlayTokenRef.current += 1;
    }
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    setIsPlayingAudio(false);
    setPlaybackProgress(0);
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
  };

  useEffect(() => {
    return () => {
      stopAudioPlayback();
      stopRecording();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    stopAudioPlayback();
    stopRecording();
    setStepIndex(findStepIndexForView(externalViewIndex));
    requestedViewIndexRef.current = null;
    lastAutoPlayKeyRef.current = null;
    setPlaybackProgressByPage({});
    setRecordedClipsByKey({});
    setSessionAssessment(savedAssessment);
    setSessionScoreError(null);
    setIsSubmittingSessionScore(false);
    lastSubmittedRecordingSignatureRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [document.id, savedAssessment]);

  useEffect(() => {
    setSessionAssessment(savedAssessment);
  }, [savedAssessment]);

  useEffect(() => {
    if (requestedViewIndexRef.current === externalViewIndex) {
      requestedViewIndexRef.current = null;
      return;
    }
    if (safeIndex !== externalViewIndex) {
      lastAutoPlayKeyRef.current = null;
      setStepIndex(findStepIndexForView(externalViewIndex));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalViewIndex, navigationSteps, safeIndex]);

  const spreadPageIndexes =
    activeView.kind === "spread"
      ? activeView.pages.filter((pageIdx): pageIdx is number => typeof pageIdx === "number")
      : [];
  const mergedSpreadPageIndex =
    shouldMergeSpreadTextBox && activeView.kind === "spread"
      ? hasLeftDisplayText
        ? leftPageIndex
        : rightPageIndex
      : null;
  const activePageIndex =
    activeView.kind === "single"
      ? activeView.pages[0]
      : typeof mergedSpreadPageIndex === "number"
        ? mergedSpreadPageIndex
      : spreadPageIndexes[Math.min(spreadFocus, spreadPageIndexes.length - 1)];
  const activeTargetText =
    activeView.kind === "spread"
      ? shouldMergeSpreadTextBox
        ? mergedSpreadText
        : spreadFocus === 0
          ? leftText
          : rightText
      : leftText;
  const activeKey =
    typeof activePageIndex === "number"
      ? `${document.id}:${activePageIndex}:${spreadFocus}`
      : `${document.id}:none`;
  const buildRecordingStepKey = (step: { viewIndex: number; focus: 0 | 1; pageIndex: number }) =>
    `${document.id}:${step.viewIndex}:${step.focus}:${step.pageIndex}`;
  const recordableSteps = useMemo(
    () =>
      navigationSteps.filter((step) =>
        Boolean(
          getDisplayPageText(
            document.analysis.title,
            step.pageIndex,
            shadowTexts[step.pageIndex] || ""
          ).trim()
        )
      ),
    [document.analysis.title, navigationSteps, shadowTexts]
  );
  const currentRecordingStepKey = currentStep ? buildRecordingStepKey(currentStep) : activeKey;
  const recordedStepCount = recordableSteps.filter(
    (step) => Boolean(recordedClipsByKey[buildRecordingStepKey(step)])
  ).length;
  const sessionRecordingSignature = recordableSteps
    .map((step) => recordedClipsByKey[buildRecordingStepKey(step)]?.createdAt || 0)
    .join(":");
  const overallSessionScore = sessionAssessment
    ? Math.round(
        (sessionAssessment.fluency.score +
          sessionAssessment.pronunciation.score +
          sessionAssessment.intonation.score +
          sessionAssessment.vocabulary.score +
          sessionAssessment.emotion.score) /
          5
      )
    : null;

  const effectivePageSegments = useMemo(() => {
    const tracks = document.shadowAudio?.tracks || [];
    if (!tracks.length) return [];

    const existing = document.shadowAudio?.pageSegments || [];
    if (!existing.length) {
      return [];
    }

    const validExisting = existing
      .filter(
        (item) =>
          Number.isFinite(item.pageIndex) &&
          item.pageIndex >= 0 &&
          item.pageIndex < totalPages &&
          (shadowTexts[item.pageIndex] || "").trim().length > 0 &&
          Number.isFinite(item.trackIndex) &&
          item.trackIndex >= 0 &&
          item.trackIndex < tracks.length
      )
      .map((item) => ({
        pageIndex: item.pageIndex,
        trackIndex: item.trackIndex,
        startSec: Math.max(0, item.startSec || 0),
        endSec: Math.max(Math.max(0, item.startSec || 0) + 0.15, item.endSec || 0),
      }));

    if (!validExisting.length) {
      return [];
    }
    return validExisting.sort((left, right) => left.pageIndex - right.pageIndex);
  }, [document.shadowAudio, shadowTexts, totalPages]);

  const buildAudioUnitForPage = (pageIndex: number) => {
    const segment =
      effectivePageSegments.find((item) => item.pageIndex === pageIndex) || null;
    if (!segment) {
      return null;
    }
    const url = getAudioTrackUrl(document, segment.trackIndex);
    if (!url) return null;
    return {
      url,
      startSec: segment.startSec,
      endSec: segment.endSec,
      pageText: getDisplayPageText(
        document.analysis.title,
        pageIndex,
        shadowTexts[pageIndex] || ""
      ),
    };
  };

  const activeAudioUnit =
    typeof activePageIndex === "number" ? buildAudioUnitForPage(activePageIndex) : null;

  const hasPlayableAudio = Boolean(activeAudioUnit?.url);

  const leftHasPlayableAudio =
    typeof leftPageIndex === "number" && Boolean(buildAudioUnitForPage(leftPageIndex)?.url);
  const rightHasPlayableAudio =
    typeof rightPageIndex === "number" && Boolean(buildAudioUnitForPage(rightPageIndex)?.url);
  const viewHasPlayableAudio =
    activeView.kind === "spread"
      ? leftHasPlayableAudio || rightHasPlayableAudio
      : hasPlayableAudio;
  const currentProgress =
    typeof activePageIndex === "number" ? playbackProgressByPage[activePageIndex] || 0 : playbackProgress;
  const canPrevAction = canPrev;
  const canNextAction = canNext;
  const currentAutoPlayKey =
    typeof activePageIndex === "number"
      ? `${document.id}:${safeStepIndex}:${safeIndex}:${spreadFocus}:${activePageIndex}`
      : null;

  const playAudioUnit = (
    unit: NonNullable<typeof activeAudioUnit>,
    pageIndex: number,
    options?: { onFinish?: () => void }
  ) => {
    const audio = new Audio(unit.url);
    audio.preload = "auto";
    audio.volume = 1;
    audio.muted = false;
    audioRef.current = audio;

    const baseStart = Math.max(0, unit.startSec || 0);
    const baseEnd = Math.max(
      baseStart + 0.15,
      Number.isFinite(unit.endSec) ? unit.endSec : baseStart + 10
    );

    const segmentStart = baseStart;
    const segmentEnd = Math.max(segmentStart + 0.15, baseEnd);

    const finishCurrent = () => {
      if (cleanupRef.current === finishCurrent) {
        cleanupRef.current = null;
      }
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      audio.pause();
      audio.src = "";
      setIsPlayingAudio(false);
      setPlaybackProgressByPage((current) => ({
        ...current,
        [pageIndex]: 1,
      }));
      options?.onFinish?.();
    };

    const onTimeUpdate = () => {
      const progress = Math.max(
        0,
        Math.min(1, (audio.currentTime - segmentStart) / Math.max(0.01, segmentEnd - segmentStart))
      );
      setPlaybackProgress(progress);
      setPlaybackProgressByPage((current) => ({
        ...current,
        [pageIndex]: progress,
      }));
      if (audio.currentTime >= segmentEnd - 0.02) {
        finishCurrent();
      }
    };
    const onEnded = () => {
      finishCurrent();
    };
    const onError = () => {
      finishCurrent();
    };

    cleanupRef.current = finishCurrent;
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    const startPlayback = () => {
      const durationSec = Number.isFinite(audio.duration) ? Math.max(0, audio.duration) : 0;
      const boundedStart =
        durationSec > 0 ? Math.min(segmentStart, Math.max(0, durationSec - 0.05)) : segmentStart;
      try {
        audio.currentTime = boundedStart;
      } catch {
        // ignore early seek failures
      }
      void audio.play().catch(() => {
        finishCurrent();
      });
    };
    if (audio.readyState >= 1) {
      startPlayback();
    } else {
      audio.addEventListener("loadedmetadata", startPlayback, { once: true });
    }
  };

  const startPagePlayback = (
    pageIndex: number,
    onFinish?: () => void,
    options?: { preserveSequenceToken?: boolean }
  ) => {
    const unit = buildAudioUnitForPage(pageIndex);
    if (!unit) return false;
    stopAudioPlayback(!(options?.preserveSequenceToken ?? false));
    setIsPlayingAudio(true);
    playAudioUnit(unit, pageIndex, { onFinish });
    return true;
  };

  const handlePlayAudio = () => {
    if (isPlayingAudio) {
      stopAudioPlayback();
      return;
    }
    if (!hasPlayableAudio || typeof activePageIndex !== "number") {
      return;
    }
    startPagePlayback(activePageIndex);
  };

  const submitRecordedSessionForScoring = async (
    signature: string,
    clips: Record<string, ShadowRecordingClip>
  ) => {
    const orderedClips = recordableSteps
      .map((step) => clips[buildRecordingStepKey(step)]?.blob)
      .filter((clip): clip is Blob => Boolean(clip));

    if (!orderedClips.length) {
      return;
    }

    setIsSubmittingSessionScore(true);
    setSessionScoreError(null);
    try {
      const mergedAudio = await renderMergedAudioToWav(orderedClips);
      const referenceText = recordableSteps
        .map((step) =>
          getDisplayPageText(
            document.analysis.title,
            step.pageIndex,
            shadowTexts[step.pageIndex] || ""
          ).trim()
        )
        .filter(Boolean)
        .join("\n");

      const formData = new FormData();
      formData.append("audio", mergedAudio, `${document.analysis.title || "storyflow-reading"}.wav`);
      formData.append("referenceText", referenceText);
      formData.append("studentName", "");
      formData.append("bookName", document.analysis.title || document.sourceName || "");
      formData.append("homeworkType", "绘本跟读");
      formData.append("tutorName", "");

      const response = await fetch("/api/storyflow/score-audio", {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json()) as {
        result?: AnalysisResult;
        error?: string;
      };

      if (!response.ok || !payload.result) {
        throw new Error(payload.error || "整段录音评分失败");
      }

      lastSubmittedRecordingSignatureRef.current = signature;
      setSessionAssessment(payload.result);
      onAssessmentChange(payload.result);
    } catch (error) {
      lastSubmittedRecordingSignatureRef.current = signature;
      setSessionAssessment(null);
      setSessionScoreError(
        error instanceof Error ? error.message : "整段录音评分失败"
      );
    } finally {
      setIsSubmittingSessionScore(false);
    }
  };

  const attemptAutoPlayCurrentPage = () => {
    if (!viewHasPlayableAudio || typeof activePageIndex !== "number") {
      return false;
    }

    clearPagePracticeState();
    const started = startPagePlayback(activePageIndex);
    if (started && currentAutoPlayKey) {
      lastAutoPlayKeyRef.current = currentAutoPlayKey;
    }
    return started;
  };

  const clearPagePracticeState = () => {
    stopAudioPlayback();
    setPlaybackProgress(0);
  };

  useImperativeHandle(
    ref,
    () => ({
      autoplayCurrentPage: () => {
        lastAutoPlayKeyRef.current = null;
        void attemptAutoPlayCurrentPage();
      },
    }),
    [attemptAutoPlayCurrentPage]
  );

  useEffect(() => {
    lastAutoPlayKeyRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [document.id]);

  useLayoutEffect(() => {
    if (!view || !currentAutoPlayKey) {
      return;
    }
    if (lastAutoPlayKeyRef.current === currentAutoPlayKey) {
      return;
    }
    if (!viewHasPlayableAudio) return;

    attemptAutoPlayCurrentPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentAutoPlayKey, activePageIndex, safeIndex, spreadFocus, view, viewHasPlayableAudio]);

  useEffect(() => {
    if (!recordableSteps.length) {
      return;
    }
    if (recordedStepCount < recordableSteps.length) {
      return;
    }
    if (!sessionRecordingSignature || isSubmittingSessionScore) {
      return;
    }
    if (lastSubmittedRecordingSignatureRef.current === sessionRecordingSignature) {
      return;
    }
    void submitRecordedSessionForScoring(sessionRecordingSignature, recordedClipsByKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isSubmittingSessionScore,
    recordableSteps,
    recordedClipsByKey,
    recordedStepCount,
    sessionRecordingSignature,
  ]);

  const handlePlaySidePage = (side: "left" | "right") => {
    const pageIndex = side === "left" ? leftPageIndex : rightPageIndex;
    if (typeof pageIndex !== "number") return;
    const targetStepIndex = findStepIndexForView(safeIndex, side === "left" ? 0 : 1);
    if (targetStepIndex !== safeStepIndex) {
      lastAutoPlayKeyRef.current = null;
      setStepIndex(targetStepIndex);
      return;
    }
    lastAutoPlayKeyRef.current = `${document.id}:${safeIndex}:${side === "left" ? 0 : 1}:${pageIndex}`;
    startPagePlayback(pageIndex);
  };

  const handleRecordToggle = async () => {
    if (isRecording) {
      stopRecording();
      return;
    }

    if (!activeTargetText.trim()) return;

    try {
      setSessionScoreError(null);
      stopAudioPlayback();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recordingStartMsRef.current = Date.now();
      const chunks: Blob[] = [];
      const recordingKey = currentRecordingStepKey;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      recorder.onstop = () => {
        const recordedDurationSec = Math.max(0, (Date.now() - recordingStartMsRef.current) / 1000);
        const clipBlob = new Blob(chunks, {
          type: recorder.mimeType || "audio/webm",
        });
        if (clipBlob.size > 0) {
          setRecordedClipsByKey((current) => ({
            ...current,
            [recordingKey]: {
              blob: clipBlob,
              createdAt: Date.now(),
              durationSec: recordedDurationSec,
            },
          }));
          setSessionAssessment(null);
        }
        if (mediaStreamRef.current) {
          mediaStreamRef.current.getTracks().forEach((track) => track.stop());
          mediaStreamRef.current = null;
        }
        mediaRecorderRef.current = null;
        setIsRecording(false);
      };

      recorder.onerror = () => {
        if (mediaStreamRef.current) {
          mediaStreamRef.current.getTracks().forEach((track) => track.stop());
          mediaStreamRef.current = null;
        }
        mediaRecorderRef.current = null;
        setIsRecording(false);
      };

      recorder.start();
      setIsRecording(true);
    } catch {
      setIsRecording(false);
    }
  };

  const handlePrev = () => {
    clearPagePracticeState();
    stopRecording();
    lastAutoPlayKeyRef.current = null;
    if (!canPrev) {
      return;
    }
    const targetStepIndex = Math.max(0, safeStepIndex - 1);
    const targetStep = navigationSteps[targetStepIndex];
    if (!targetStep) return;

    setStepIndex(targetStepIndex);
    if (targetStep.viewIndex !== safeIndex) {
      requestedViewIndexRef.current = targetStep.viewIndex;
      onChangeViewIndex(targetStep.viewIndex);
    }
  };

  const handleNext = () => {
    clearPagePracticeState();
    stopRecording();
    lastAutoPlayKeyRef.current = null;
    if (!canNext) {
      return;
    }
    const targetStepIndex = Math.min(navigationSteps.length - 1, safeStepIndex + 1);
    const targetStep = navigationSteps[targetStepIndex];
    if (!targetStep) return;

    setStepIndex(targetStepIndex);
    if (targetStep.viewIndex !== safeIndex) {
      requestedViewIndexRef.current = targetStep.viewIndex;
      onChangeViewIndex(targetStep.viewIndex);
    }
  };

  if (!view) {
    return (
      <div className="rounded-[1.8rem] bg-white p-6 text-center shadow-[0_18px_50px_rgba(148,163,184,0.12)]">
        暂无可展示的页面。
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[1.9rem] bg-[radial-gradient(circle_at_top,_rgba(147,197,253,0.7),_rgba(224,242,254,0.9)_55%,_rgba(240,249,255,0.98)_100%)] shadow-[0_18px_60px_rgba(59,130,246,0.14)]">
      <div className="relative flex h-[min(94vh,1040px)] min-h-[720px] flex-col">
        <div className="absolute inset-0 opacity-60">
          <div className="absolute -left-10 top-10 h-40 w-40 rounded-full bg-sky-200/40 blur-2xl" />
          <div className="absolute right-10 top-20 h-56 w-56 rounded-full bg-indigo-200/35 blur-3xl" />
          <div className="absolute left-1/2 top-1/2 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/35 blur-3xl" />
        </div>

        <div className="relative flex min-h-[340px] flex-1 items-start justify-center px-5 pb-1 pt-6 md:min-h-[420px] md:pt-4">
          <button
            type="button"
            onClick={onExit}
            className="absolute left-5 top-5 grid h-12 w-12 place-items-center rounded-full bg-white/80 text-xl font-black text-slate-800 shadow-md transition hover:bg-white"
            aria-label="back"
          >
            ←
          </button>

          <button
            type="button"
            className="absolute right-5 top-5 grid h-12 w-12 place-items-center rounded-full bg-white/80 text-lg font-black text-slate-800 shadow-md transition hover:bg-white"
            aria-label="zoom"
            title="Zoom"
          >
            +
          </button>

          {view.kind === "single" ? (
            <div className="flex w-full max-w-[980px] items-center justify-center">
              <div className="aspect-video w-full">
              <ShadowPage
                url={getDocumentPageUrl(document, view.pages[0])}
                alt={`page-${view.pages[0] + 1}`}
                mode="single"
              />
              </div>
            </div>
          ) : (
            <div className="flex w-full max-w-[980px] items-center justify-center">
              <div className="aspect-video w-full">
              <ShadowSpreadPage
                leftUrl={
                  typeof view.pages[0] === "number"
                    ? getDocumentPageUrl(document, view.pages[0])
                    : null
                }
                rightUrl={
                  typeof view.pages[1] === "number"
                    ? getDocumentPageUrl(document, view.pages[1])
                    : null
                }
                alt={`spread-${typeof view.pages[0] === "number" ? view.pages[0] + 1 : "blank"}-${
                  typeof view.pages[1] === "number" ? view.pages[1] + 1 : "blank"
                }`}
              />
              </div>
            </div>
          )}

          <div className="absolute bottom-5 left-5 rounded-full bg-sky-500/70 px-5 py-2.5 text-base font-black text-white shadow-lg shadow-sky-400/20 backdrop-blur">
            {safeIndex + 1}/{views.length}
          </div>

          <button
            type="button"
            onClick={onExit}
            className="absolute bottom-5 right-5 rounded-full bg-sky-600/85 px-7 py-3.5 text-lg font-black text-white shadow-lg shadow-sky-500/25 backdrop-blur transition hover:bg-sky-600"
          >
            完成
          </button>
        </div>

        <div className="relative -mt-3 shrink-0 border-t border-white/50 bg-white/65 px-5 pb-4 pt-3 backdrop-blur">
          <div className="mx-auto mb-2 h-1.5 w-16 rounded-full bg-sky-300/70" />

          <div className="grid items-center gap-4 md:grid-cols-[64px_minmax(0,1fr)_64px]">
            <button
              type="button"
              onClick={handlePrev}
              disabled={!canPrevAction}
              className="grid h-14 w-14 place-items-center rounded-full bg-white text-2xl font-black text-slate-700 shadow-md transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="prev"
            >
              ‹
            </button>

            <div className="min-w-0">
              {view.kind === "spread" ? (
                <div className="grid gap-3 text-left sm:grid-cols-2">
                  {shouldMergeSpreadTextBox ? (
                    <div
                      role={
                        hasLeftDisplayText
                          ? leftHasPlayableAudio
                            ? "button"
                            : undefined
                          : rightHasPlayableAudio
                            ? "button"
                            : undefined
                      }
                      tabIndex={
                        hasLeftDisplayText
                          ? leftHasPlayableAudio
                            ? 0
                            : -1
                          : rightHasPlayableAudio
                            ? 0
                            : -1
                      }
                      onClick={() => {
                        if (hasLeftDisplayText && leftHasPlayableAudio) {
                          handlePlaySidePage("left");
                          return;
                        }
                        if (hasRightDisplayText && rightHasPlayableAudio) {
                          handlePlaySidePage("right");
                        }
                      }}
                      onKeyDown={(event) => {
                        const canPlay =
                          (hasLeftDisplayText && leftHasPlayableAudio) ||
                          (hasRightDisplayText && rightHasPlayableAudio);
                        if (!canPlay) return;
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          if (hasLeftDisplayText) {
                            handlePlaySidePage("left");
                          } else {
                            handlePlaySidePage("right");
                          }
                        }
                      }}
                      className={`sm:col-span-2 rounded-2xl border border-sky-300 bg-white/85 px-5 py-4 text-center transition ${
                        (hasLeftDisplayText && leftHasPlayableAudio) ||
                        (hasRightDisplayText && rightHasPlayableAudio)
                          ? "cursor-pointer hover:bg-white"
                          : ""
                      }`}
                    >
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-600">
                        Page Text
                      </p>
                      <p className="mt-2 text-base leading-relaxed text-slate-900">
                        {mergedSpreadText}
                      </p>
                    </div>
                  ) : (
                    <>
                      <div
                        role={leftHasPlayableAudio ? "button" : undefined}
                        tabIndex={leftHasPlayableAudio ? 0 : -1}
                        onClick={() => {
                          if (leftHasPlayableAudio) handlePlaySidePage("left");
                        }}
                        onKeyDown={(event) => {
                          if (!leftHasPlayableAudio) return;
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            handlePlaySidePage("left");
                          }
                        }}
                        className={`rounded-2xl border bg-white/75 px-4 py-3 transition ${
                          spreadFocus === 0
                            ? "border-sky-500 shadow-[0_0_0_2px_rgba(14,165,233,0.18)]"
                            : "border-sky-200"
                        } ${leftHasPlayableAudio ? "cursor-pointer hover:bg-white" : ""}`}
                      >
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-600">
                          Left Page
                        </p>
                        <p className="mt-1 text-base leading-relaxed text-slate-900">
                          {leftDisplayText}
                        </p>
                      </div>
                      <div
                        role={rightHasPlayableAudio ? "button" : undefined}
                        tabIndex={rightHasPlayableAudio ? 0 : -1}
                        onClick={() => {
                          if (rightHasPlayableAudio) handlePlaySidePage("right");
                        }}
                        onKeyDown={(event) => {
                          if (!rightHasPlayableAudio) return;
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            handlePlaySidePage("right");
                          }
                        }}
                        className={`rounded-2xl border bg-white/75 px-4 py-3 transition ${
                          spreadFocus === 1
                            ? "border-indigo-500 shadow-[0_0_0_2px_rgba(99,102,241,0.18)]"
                            : "border-indigo-200"
                        } ${rightHasPlayableAudio ? "cursor-pointer hover:bg-white" : ""}`}
                      >
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-indigo-600">
                          Right Page
                        </p>
                        <p className="mt-1 text-base leading-relaxed text-slate-900">
                          {rightDisplayText}
                        </p>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div
                  role={hasPlayableAudio ? "button" : undefined}
                  tabIndex={hasPlayableAudio ? 0 : -1}
                  onClick={() => {
                    if (hasPlayableAudio) handlePlayAudio();
                  }}
                  onKeyDown={(event) => {
                    if (!hasPlayableAudio) return;
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      handlePlayAudio();
                    }
                  }}
                  className={`rounded-2xl border px-4 py-3 text-left transition ${
                    hasPlayableAudio
                      ? "cursor-pointer border-sky-300 bg-white/85 hover:bg-white"
                      : "border-sky-200 bg-white/75"
                  }`}
                >
                  <p className="text-center text-xs font-semibold uppercase tracking-[0.16em] text-sky-600">
                    Page Text
                  </p>
                  <p className="mt-1 text-base leading-relaxed text-slate-900">
                    {leftText || ""}
                  </p>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={handleNext}
              disabled={!canNextAction}
              className="grid h-14 w-14 place-items-center rounded-full bg-white text-2xl font-black text-slate-700 shadow-md transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="next"
            >
              ›
            </button>
          </div>

          <div className="mt-3 grid items-center gap-4 md:grid-cols-[72px_minmax(0,1fr)_150px]">
            <button
              type="button"
              onClick={handlePlayAudio}
              disabled={!hasPlayableAudio}
              className={`grid h-14 w-14 place-items-center rounded-full text-xl font-black shadow-md transition ${
                hasPlayableAudio
                  ? isPlayingAudio
                    ? "bg-sky-600 text-white hover:bg-sky-700"
                    : "bg-white/80 text-sky-600 hover:bg-white"
                  : "cursor-not-allowed bg-slate-200 text-slate-400"
              }`}
              aria-label="audio"
              title={hasPlayableAudio ? "播放当前页音频" : "当前页没有可播放音频"}
            >
              🔊
            </button>

            <div className="text-center">
              <p className="text-[2rem] font-semibold tracking-tight text-emerald-600">
                {activeTargetText || ""}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                已录 {recordedStepCount}/{recordableSteps.length || 0} 句
              </p>
            </div>

            <div className="flex items-end justify-end gap-3">
              {isSubmittingSessionScore ? (
                <div className="rounded-2xl bg-sky-500 px-3 py-2 text-center text-white shadow-md">
                  <p className="text-sm font-black leading-none">评分中</p>
                  <p className="mt-1 text-xs font-semibold">整段录音</p>
                </div>
              ) : overallSessionScore !== null ? (
                <div className="rounded-2xl bg-emerald-500 px-3 py-2 text-center text-white shadow-md">
                  <p className="text-2xl font-black leading-none">
                    {overallSessionScore}
                  </p>
                  <p className="mt-1 text-xs font-semibold">总评</p>
                </div>
              ) : null}
              <button
                type="button"
                onClick={handleRecordToggle}
                disabled={!activeTargetText.trim()}
                className={`grid h-16 w-16 place-items-center rounded-[1.8rem] text-2xl shadow-lg transition ${
                  activeTargetText.trim()
                    ? isRecording
                      ? "bg-rose-500 text-white"
                      : "bg-gradient-to-br from-amber-200 via-yellow-200 to-amber-100 hover:brightness-105"
                    : "cursor-not-allowed bg-slate-200 text-slate-400"
                }`}
                aria-label="record-and-score"
                title={isRecording ? "点击停止录音" : "开始录音"}
              >
                🎙
              </button>
            </div>
          </div>

          {sessionScoreError ? (
            <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50/80 px-4 py-3 text-sm text-rose-600">
              {sessionScoreError}
            </div>
          ) : null}

          {sessionAssessment ? (
            <div className="mt-3 rounded-2xl border border-white/60 bg-white/70 px-4 py-4 shadow-sm backdrop-blur">
              <div className="grid gap-2 sm:grid-cols-5">
                {[
                  ["流畅", sessionAssessment.fluency.score],
                  ["发音", sessionAssessment.pronunciation.score],
                  ["语调", sessionAssessment.intonation.score],
                  ["词汇", sessionAssessment.vocabulary.score],
                  ["表达", sessionAssessment.emotion.score],
                ].map(([label, score]) => (
                  <div
                    key={String(label)}
                    className="rounded-xl bg-white px-3 py-2 text-center shadow-sm"
                  >
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                      {label}
                    </p>
                    <p className="mt-1 text-xl font-black text-slate-800">{score}</p>
                  </div>
                ))}
              </div>
              <div className="mt-3 rounded-xl bg-white/90 px-4 py-3 text-left shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                  AI 点评
                </p>
                <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-700">
                  {sessionAssessment.overallComment}
                </p>
              </div>
            </div>
          ) : null}

          <p className="mt-3 text-center text-xs text-slate-500">
            {document.analysis.title}
          </p>
        </div>
      </div>
    </div>
  );
});

const ShadowPage = ({
  url,
  alt,
  mode,
}: {
  url: string;
  alt: string;
  mode: "single" | "spread";
}) => {
  if (!url) {
    return (
      <div className="grid h-full min-h-[320px] w-full place-items-center rounded-[1.7rem] bg-white text-sm font-semibold text-slate-400 shadow-sm">
        页面预览加载中
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full items-center justify-center rounded-[1.7rem] bg-white p-2 shadow-sm">
      <img
        src={url}
        alt={alt}
        className={`${mode === "single" ? "max-w-full" : "max-w-full"} h-full min-h-0 w-full rounded-[1.4rem] object-contain`}
      />
    </div>
  );
};

const ShadowSpreadPage = ({
  leftUrl,
  rightUrl,
  alt,
}: {
  leftUrl?: string | null;
  rightUrl?: string | null;
  alt: string;
}) => {
  if (!leftUrl && !rightUrl) {
    return (
      <div className="grid h-full min-h-[320px] w-full place-items-center rounded-[1.7rem] bg-white text-sm font-semibold text-slate-400 shadow-sm">
        跨页预览加载中
      </div>
    );
  }

  const leftAlignClass = leftUrl
    ? rightUrl
      ? "justify-end"
      : "justify-center"
    : "justify-center";
  const rightAlignClass = rightUrl
    ? leftUrl
      ? "justify-start"
      : "justify-center"
    : "justify-center";
  const hasBothPages = Boolean(leftUrl && rightUrl);
  const isUnifiedSpread = hasBothPages && leftUrl === rightUrl;

  return (
    <div className="flex h-full min-h-0 w-full items-center justify-center rounded-[1.7rem] bg-white p-0 shadow-sm">
      <div
        role="img"
        aria-label={alt}
        className="h-full min-h-0 w-full overflow-hidden rounded-[1.6rem] bg-white"
      >
        {isUnifiedSpread ? (
          <div className="flex h-full min-h-0 w-full items-center justify-center">
            <img
              src={leftUrl as string}
              alt={`${alt}-unified`}
              className="h-full min-h-0 w-full object-cover"
            />
          </div>
        ) : hasBothPages ? (
          <div className="grid h-full min-h-0 w-full grid-cols-2 gap-0">
            <div className={`flex h-full min-h-0 items-center ${leftAlignClass}`}>
              <img
                src={leftUrl as string}
                alt={`${alt}-left`}
                className="-mr-px h-full min-h-0 w-full object-contain object-right"
              />
            </div>
            <div className={`flex h-full min-h-0 items-center ${rightAlignClass}`}>
              <img
                src={rightUrl as string}
                alt={`${alt}-right`}
                className="-ml-px h-full min-h-0 w-full object-contain object-left"
              />
            </div>
          </div>
        ) : (
          <div className="flex h-full min-h-0 w-full items-center justify-center">
            {leftUrl || rightUrl ? (
              <img
                src={(leftUrl || rightUrl) as string}
                alt={`${alt}-single`}
                className="h-full min-h-0 w-auto max-w-[50%] object-contain"
              />
            ) : (
              <div className="h-[58vh] max-h-[58vh] w-full rounded-xl bg-white" />
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const buildMindMapBranches = (document: StoryflowDocument) => {
  const analysis = document.analysis;
  const dynamicItems = [
    ...analysis.mindMap.beginning,
    ...analysis.mindMap.middle,
    ...analysis.mindMap.end,
  ]
    .map((item) => item.trim())
    .filter(Boolean);

  const fallbackItems = dynamicItems.length
    ? dynamicItems
    : [
        analysis.summary?.trim() || "Story line",
        analysis.keywords.slice(0, 4).join(" / ") || "Key ideas",
      ].filter(Boolean);

  const palette = [
    { lineClass: "bg-rose-400", boxClass: "border-sky-300" },
    { lineClass: "bg-orange-400", boxClass: "border-orange-300" },
    { lineClass: "bg-emerald-500", boxClass: "border-yellow-300" },
    { lineClass: "bg-cyan-500", boxClass: "border-cyan-300" },
    { lineClass: "bg-violet-500", boxClass: "border-violet-300" },
    { lineClass: "bg-fuchsia-500", boxClass: "border-fuchsia-300" },
  ];

  return fallbackItems.map((text, index) => {
    const tone = palette[index % palette.length];
    return {
      label: `Branch ${index + 1}`,
      text,
      lineClass: tone.lineClass,
      boxClass: tone.boxClass,
    };
  });
};

const MindMapBoard = ({ document }: { document: StoryflowDocument }) => {
  const branches = buildMindMapBranches(document);

  return (
    <div className="rounded-[1.9rem] bg-white p-6 shadow-[0_18px_50px_rgba(148,163,184,0.12)] md:p-8">
      <div className="grid gap-8 xl:grid-cols-[minmax(260px,340px)_minmax(0,1fr)] xl:items-center">
        <div className="flex justify-center xl:justify-start">
          <div className="min-h-[150px] w-full max-w-[340px] rounded-[1.7rem] border-[3px] border-sky-400 bg-white px-8 py-8 shadow-[0_18px_40px_rgba(56,189,248,0.14)]">
            <p className="text-center text-sm font-semibold uppercase tracking-[0.18em] text-sky-600">
              Central Topic
            </p>
            <p className="mt-4 text-center text-[1.75rem] font-semibold leading-tight text-slate-900">
              {document.analysis.title}
            </p>
          </div>
        </div>

        <div className="space-y-6">
          {branches.map((branch, index) => (
            <div key={`${branch.label}-${index}`} className="flex items-center gap-4">
              <div className={`hidden h-1 flex-1 rounded-full xl:block ${branch.lineClass}`} />
              <div className={`w-full rounded-[1.4rem] border-[3px] bg-white px-6 py-5 shadow-sm ${branch.boxClass}`}>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                  {branch.label}
                </p>
                <p className="mt-2 text-lg font-medium leading-snug text-slate-900">
                  {branch.text}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default StoryflowWorkspace;
