"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import PerformanceTaskPreview from "@/components/storyflow/PerformanceTaskPreview";
import type { SessionUser } from "@/lib/clientAuth";
import {
  buildDefaultStoryflowPerformanceConfig,
  getTeacherStoryflowDocuments,
  hydrateAccessibleTeacherStoryflowDocuments,
  type StoryflowAnalysis,
  type StoryflowCustomView,
  type StoryflowPageAudioSegmentSlot,
  type StoryflowSpeakingPracticeRecord,
  updateTeacherStoryflowDocument,
} from "@/lib/storyflowStore";
import {
  getStoryflowAssignmentById,
  hydrateStoryflowAssignmentById,
  type StoryflowAssignment,
  updateStoryflowAssignment,
} from "@/lib/storyflowAssignments";
import type { AnalysisResult } from "@/types";

type StoryflowTaskPlayerProps = {
  assignmentId: string;
  session: SessionUser;
  view?: "overview" | "task";
  taskMode?: TaskMode;
};

type ShadowView =
  | { kind: "single"; pages: [number] }
  | { kind: "spread"; pages: [number | null, number | null] };

type StudentPracticePage = StoryflowAnalysis["pages"][number] & {
  sourcePageIndexes: number[];
};

type TaskMode = "mindmap" | "shadow" | "speaking" | "performance" | "assessment";

type ShadowRecordingClip = {
  blob: Blob;
  createdAt: number;
  durationSec: number;
};

type PracticeAudioUnit = {
  pageIndex: number;
  slot: StoryflowPageAudioSegmentSlot;
  text: string;
  url: string;
  startSec: number;
  endSec: number;
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

type ShadowNavigationStep = {
  viewIndex: number;
  focus: 0 | 1;
  pageIndex: number;
};

const normalizeStudentAudioSlot = (value: unknown): StoryflowPageAudioSegmentSlot =>
  value === "left" || value === "right" ? value : "single";

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

const normalizeStoryText = (value: string) =>
  value
    .replace(/\s+/g, " ")
    .replace(/\s([,.;:!?])/g, "$1")
    .trim();

const splitDualPageText = (value: string) => {
  const normalized = value.replace(/\r\n?/g, "\n");
  const markerMatch = normalized.match(/\[RIGHT_PAGE\]/i);
  if (markerMatch && typeof markerMatch.index === "number") {
    return {
      leftText: normalized.slice(0, markerMatch.index).trim(),
      rightText: normalized
        .slice(markerMatch.index + markerMatch[0].length)
        .trim(),
    };
  }

  const blankLineDivider = normalized.split(/\n\s*\n/);
  if (blankLineDivider.length >= 2) {
    return {
      leftText: blankLineDivider[0].trim(),
      rightText: blankLineDivider.slice(1).join("\n\n").trim(),
    };
  }

  return {
    leftText: normalized.trim(),
    rightText: "",
  };
};

const joinDualPageText = (leftText: string, rightText: string) => {
  const safeLeft = leftText.trim();
  const safeRight = rightText.trim();
  if (safeLeft && safeRight) {
    return `${safeLeft}\n\n[RIGHT_PAGE]\n${safeRight}`;
  }
  return safeLeft || safeRight;
};

const getShadowStepText = (rawText: string, focus: 0 | 1) => {
  const { leftText, rightText } = splitDualPageText(rawText);
  if (rightText) {
    return (focus === 0 ? leftText : rightText).trim();
  }
  return leftText.trim();
};

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

const buildResolvedShadowTexts = (analysis: StoryflowAnalysis, pageCount: number) => {
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
    if (baseText) return baseText;
    return mergeStoryTextSegments(
      pages.flatMap((page) => [page.visibleText, page.storyBeat])
    );
  });
};

const getDisplayPageText = (
  _title: string,
  _pageIndex: number | null | undefined,
  rawText: string
) => rawText.trim();

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

const parseCustomViews = (
  rawViews: StoryflowCustomView[] | undefined,
  totalPages: number
): ShadowView[] => {
  if (!rawViews?.length) return [];

  const normalized: ShadowView[] = [];
  for (const item of rawViews) {
    if (item.kind === "single") {
      const page = item.pages[0];
      if (typeof page === "number" && page >= 0 && page < totalPages) {
        normalized.push({ kind: "single", pages: [page] });
      }
      continue;
    }

    if (item.kind === "spread") {
      const left = item.pages[0] ?? null;
      const right = item.pages[1] ?? null;
      const leftValid =
        left === null || (typeof left === "number" && left >= 0 && left < totalPages);
      const rightValid =
        right === null || (typeof right === "number" && right >= 0 && right < totalPages);
      if (leftValid && rightValid && (left !== null || right !== null)) {
        normalized.push({ kind: "spread", pages: [left, right] });
      }
    }
  }

  return normalized;
};

const getEffectiveShadowViews = (document: {
  pageObjectKeys?: string[];
  pageCount: number;
  sourceAssets?: Array<{ mimeType: string }>;
  customShadowViews?: StoryflowCustomView[];
}): ShadowView[] => {
  const totalPages = document.pageObjectKeys?.length || document.pageCount || 0;
  const isPdfDocument = (document.sourceAssets || []).some(
    (asset) => asset.mimeType === "application/pdf"
  );
  const custom = parseCustomViews(document.customShadowViews, totalPages);
  if (custom.length) return custom;
  return buildShadowViews(totalPages, isPdfDocument);
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
      let score = words[index].length;
      if (keywordSet.has(word)) score += 12;
      if (pageKeywordSet.has(word)) score += 7;
      if ((fullTextFrequency.get(word) || 0) > 1) score += (fullTextFrequency.get(word) || 0) * 2;
      if (index > 0 && index < words.length - 1) score += 1;
      return { index, score };
    })
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.index - right.index;
    });

  const blankIndexes = new Set(scoredCandidates.slice(0, blankCount).map((item) => item.index));

  let wordCursor = 0;
  return normalized.replace(/[A-Za-z']+/g, (word) => {
    const currentIndex = wordCursor;
    wordCursor += 1;
    return blankIndexes.has(currentIndex) ? buildBlankWordHint(word) : word;
  });
};

const buildStudentPracticePages = (
  previousPages: StoryflowAnalysis["pages"],
  shadowTexts: string[],
  pageObjectKeys: string[]
): StudentPracticePage[] => {
  const pageGroups = new Map<number, StoryflowAnalysis["pages"]>();
  previousPages.forEach((page) => {
    const group = pageGroups.get(page.pageIndex) || [];
    group.push(page);
    pageGroups.set(page.pageIndex, group);
  });
  const maxPageIndex = previousPages.reduce((max, page) => Math.max(max, page.pageIndex + 1), 0);
  const targetCount = Math.max(maxPageIndex, shadowTexts.length, pageObjectKeys.length, 1);
  const normalizedPages = Array.from({ length: targetCount }, (_, index) => {
    const previousGroup = pageGroups.get(index) || [];
    const previous = previousGroup[0];
    const baseText = normalizeStoryText(shadowTexts[index] || "");
    const visibleText =
      baseText ||
      mergeStoryTextSegments(previousGroup.flatMap((page) => [page.visibleText, page.storyBeat]));
    const words = visibleText
      .split(/[^A-Za-z']+/)
      .map((item) => item.trim().toLowerCase())
      .filter((item) => item.length > 1);

    return {
      pageIndex: index,
      pageTitle: previous?.pageTitle || `Page ${index + 1}`,
      storyBeat: visibleText,
      visibleText,
      bilingualHint: previous?.bilingualHint || "",
      speakingPrompt: previous?.speakingPrompt || [],
      keyVocabulary: Array.from(new Set(words)).slice(0, 6),
      sourcePageIndexes: [index],
    } satisfies StudentPracticePage;
  }).filter((page) => {
    const pageObjectKey = pageObjectKeys[page.pageIndex] || "";
    return Boolean(page.visibleText || pageObjectKey);
  });

  return normalizedPages;
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

  return {
    score,
    ratingLabel: score >= 88 ? "A" : score >= 72 ? "B" : "C",
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

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("音频转换失败"));
    };
    reader.onerror = () => reject(new Error("音频转换失败"));
    reader.readAsDataURL(blob);
  });

const fetchStoryflowUrls = async (objectKeys: string[]) => {
  const response = await fetch("/api/storyflow/urls", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ objectKeys }),
  });

  const payload = (await response.json()) as
    | { urls: Record<string, string> }
    | { error: string };

  if (!response.ok || !("urls" in payload)) {
    throw new Error("error" in payload ? payload.error : "任务资源加载失败");
  }

  return payload.urls;
};

const isDisplayUrl = (value?: string | null) =>
  typeof value === "string" &&
  (value.startsWith("data:") ||
    value.startsWith("blob:") ||
    value.startsWith("http://") ||
    value.startsWith("https://"));

const renderMergedAudioToWav = async (clips: Blob[]) => {
  const AudioContextCtor =
    typeof window !== "undefined"
      ? window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
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

const TASK_MODE_META: Array<{
  key: TaskMode;
  label: string;
  title: string;
  description: string;
}> = [
  {
    key: "mindmap",
    label: "思维导图",
    title: "绘本思维导图",
    description: "先看整本故事的结构，再开始后面的分项练习。",
  },
  {
    key: "shadow",
    label: "影子跟读",
    title: "影子跟读任务",
    description: "先看图片，再对照原文朗读这一页。",
  },
  {
    key: "speaking",
    label: "看图说话",
    title: "看图说话任务",
    description: "先只看图，回忆原文，必要时再领取提示。",
  },
  {
    key: "performance",
    label: "整本复述",
    title: "整本复述任务",
    description: "结合人物、关键词和思维导图，完整复述整本绘本。",
  },
  {
    key: "assessment",
    label: "得分点评",
    title: "老师点评",
    description: "查看这本绘本各项任务的得分与老师点评。",
  },
];

const OverviewIcon = ({
  kind,
  className = "h-6 w-6",
}: {
  kind:
    | "teacher"
    | "characters"
    | "time"
    | "place"
    | "keywords"
    | "mindmap"
    | "shadow"
    | "speaking"
    | "performance"
    | "assessment"
    | "back";
  className?: string;
}) => {
  if (kind === "teacher") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 4 4 8l8 4 8-4-8-4Z" />
        <path d="M7 10.5V14c0 1.8 2.2 3.5 5 3.5s5-1.7 5-3.5v-3.5" />
      </svg>
    );
  }
  if (kind === "characters") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="currentColor">
        <circle cx="9" cy="8" r="3.2" />
        <circle cx="16.5" cy="9" r="2.5" opacity="0.9" />
        <path d="M3.5 18.5c0-2.8 2.7-5.1 6-5.1s6 2.3 6 5.1v.8h-12v-.8Z" />
        <path d="M13 18.8c.2-2 2-3.6 4.3-3.6 2.4 0 4.3 1.7 4.3 3.8v.3H13v-.5Z" opacity="0.9" />
      </svg>
    );
  }
  if (kind === "time") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="5.5" width="16" height="14" rx="3" />
        <path d="M8 3.5v4" />
        <path d="M16 3.5v4" />
        <path d="M4 10h16" />
      </svg>
    );
  }
  if (kind === "place") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="currentColor">
        <path d="M12 4.2 4 10.3v1.1h1.7v7.2h4.9v-4.8h2.8v4.8h4.9v-7.2H20v-1.1l-8-6.1Z" />
      </svg>
    );
  }
  if (kind === "keywords") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="currentColor">
        <path d="M11.2 3.8H6.8c-.7 0-1.3.3-1.7.7L3.8 5.8c-.4.4-.7 1-.7 1.7v4.4c0 .7.3 1.3.7 1.7l6.8 6.8c.8.8 2 .8 2.8 0l6-6c.8-.8.8-2 0-2.8l-6.8-6.8c-.4-.4-1-.7-1.7-.7ZM7.8 9a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z" />
      </svg>
    );
  }
  if (kind === "mindmap") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="6.5" r="2.5" />
        <circle cx="6.5" cy="17" r="2.5" />
        <circle cx="17.5" cy="17" r="2.5" />
        <path d="M12 9v2.5" />
        <path d="M12 11.5 6.5 14.5" />
        <path d="M12 11.5l5.5 3" />
      </svg>
    );
  }
  if (kind === "shadow") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="9" y="3.5" width="6" height="11" rx="3" />
        <path d="M7 11.5a5 5 0 0 0 10 0" />
        <path d="M12 16.5V20" />
        <path d="M9 20h6" />
      </svg>
    );
  }
  if (kind === "speaking") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="currentColor">
        <path d="M12 3.8c-4.7 0-8.5 3-8.5 6.8 0 2.1 1.2 4 3.2 5.2l-.8 3.4 3.5-2c.8.2 1.7.3 2.6.3 4.7 0 8.5-3 8.5-6.8S16.7 3.8 12 3.8Z" />
      </svg>
    );
  }
  if (kind === "performance") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 4.5h8.5a2 2 0 0 1 2 2V19l-4-2-4 2V6.5a2 2 0 0 0-2-2Z" />
        <path d="M7 4.5a2 2 0 0 0-2 2V17a2 2 0 0 0 2 2h10.5" />
      </svg>
    );
  }
  if (kind === "assessment") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="currentColor">
        <path d="m12 3.8 2.5 5.1 5.6.8-4 4 .9 5.6-5-2.6-5 2.6.9-5.6-4-4 5.6-.8L12 3.8Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 12H8" />
      <path d="m12 8-4 4 4 4" />
    </svg>
  );
};

const StoryflowTaskPlayer: React.FC<StoryflowTaskPlayerProps> = ({
  assignmentId,
  session,
  view = "overview",
  taskMode: forcedTaskMode,
}) => {
  const router = useRouter();
  const [assignment, setAssignment] = useState<StoryflowAssignment | null>(() => {
    const cachedAssignment = getStoryflowAssignmentById(assignmentId);
    if (!cachedAssignment || cachedAssignment.studentUsername !== session.username) {
      return null;
    }
    return cachedAssignment;
  });
  const [error, setError] = useState<string | null>(null);
  const [resolvedUrls, setResolvedUrls] = useState<Record<string, string>>({});
  const [documentRefreshKey, setDocumentRefreshKey] = useState(0);
  const [pageIndex, setPageIndex] = useState(0);
  const [hintStage, setHintStage] = useState<0 | 1 | 2>(0);
  const [taskMode, setTaskMode] = useState<TaskMode>("mindmap");
  const [isPlayingShadowAudio, setIsPlayingShadowAudio] = useState(false);
  const [isRecordingShadow, setIsRecordingShadow] = useState(false);
  const [recordedShadowClips, setRecordedShadowClips] = useState<Record<string, ShadowRecordingClip>>({});
  const [shadowAssessment, setShadowAssessment] = useState<AnalysisResult | null>(null);
  const [isSubmittingShadowScore, setIsSubmittingShadowScore] = useState(false);
  const [shadowScoreError, setShadowScoreError] = useState<string | null>(null);
  const [isShadowFeedbackOpen, setIsShadowFeedbackOpen] = useState(false);
  const [practiceStatus, setPracticeStatus] = useState<"idle" | "countdown" | "active">("idle");
  const [countdownValue, setCountdownValue] = useState(3);
  const [practiceDraft, setPracticeDraft] = useState<SpeakingPracticeDraft | null>(null);
  const [latestPracticeId, setLatestPracticeId] = useState<string | null>(null);
  const [isPracticeHistoryOpen, setIsPracticeHistoryOpen] = useState(false);
  const [speakingPracticeRecords, setSpeakingPracticeRecords] = useState<StoryflowSpeakingPracticeRecord[]>([]);
  const shadowAudioRef = useRef<HTMLAudioElement | null>(null);
  const shadowAudioCleanupRef = useRef<(() => void) | null>(null);
  const shadowAudioTokenRef = useRef(0);
  const lastShadowAutoPlayKeyRef = useRef<string | null>(null);
  const lastSubmittedShadowSignatureRef = useRef<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordingStartMsRef = useRef<number>(0);

  useEffect(() => {
    let disposed = false;
    const refreshAccessibleDocuments = async (teacherUsername: string) => {
      await hydrateAccessibleTeacherStoryflowDocuments(teacherUsername);
      if (!disposed) {
        setDocumentRefreshKey((value) => value + 1);
      }
    };

    const cachedAssignment = getStoryflowAssignmentById(assignmentId);
    if (cachedAssignment?.studentUsername === session.username) {
      setAssignment(cachedAssignment);
      setError(null);
      void refreshAccessibleDocuments(cachedAssignment.teacherUsername).catch(() => undefined);
    }

    void hydrateStoryflowAssignmentById(assignmentId)
      .then((hydratedAssignment) => {
        const currentAssignment =
          hydratedAssignment || getStoryflowAssignmentById(assignmentId);
        if (!currentAssignment || currentAssignment.studentUsername !== session.username) {
          if (!disposed) {
            setAssignment(null);
            setError("没有找到这个任务，或者你没有权限查看。");
          }
          return;
        }

        if (!disposed) {
          setAssignment(currentAssignment);
          setError(null);
        }
        void refreshAccessibleDocuments(currentAssignment.teacherUsername).catch(() => {
          if (!disposed) {
            setDocumentRefreshKey((value) => value + 1);
          }
        });
      })
      .catch(() => {
        if (!disposed) {
          setAssignment(null);
          setError("任务加载失败，请刷新后重试。");
        }
      });

    return () => {
      disposed = true;
    };
  }, [assignmentId, session.username]);

  const document = useMemo(() => {
    if (!assignment) return null;
    return (
      getTeacherStoryflowDocuments(assignment.teacherUsername).find(
        (item) => item.id === assignment.documentId
      ) || null
    );
  }, [assignment, documentRefreshKey]);

  const pages = useMemo(() => {
    if (!document) return [];
    const totalPages = Math.max(document.pageObjectKeys?.length || 0, document.pageCount || 0, 1);
    const shadowTexts = buildResolvedShadowTexts(document.analysis, totalPages);
    return buildStudentPracticePages(
      document.analysis.pages || [],
      shadowTexts,
      document.pageObjectKeys || []
    );
  }, [document]);

  const safeIndex = Math.min(Math.max(0, pageIndex), Math.max(0, pages.length - 1));
  const page = pages[safeIndex] || null;

  useEffect(() => {
    setPageIndex(0);
    setHintStage(0);
    setTaskMode(forcedTaskMode || "mindmap");
    setRecordedShadowClips({});
    setShadowAssessment(
      assignment?.shadowSubmission?.teacherAssessment ||
        assignment?.shadowSubmission?.studentAssessment ||
        document?.assessments?.shadow ||
        null
    );
    setShadowScoreError(null);
    setIsShadowFeedbackOpen(false);
    lastShadowAutoPlayKeyRef.current = null;
    lastSubmittedShadowSignatureRef.current = null;
    setPracticeStatus("idle");
    setCountdownValue(3);
    setPracticeDraft(null);
    setLatestPracticeId(null);
    setIsPracticeHistoryOpen(false);
  }, [assignmentId, assignment?.shadowSubmission, document?.assessments?.shadow, forcedTaskMode]);

  useEffect(() => {
    if (!document?.pageObjectKeys?.length) return;
    const objectKeys = [
      ...(document.pageObjectKeys || []),
      ...((document.shadowAudio?.tracks || []).map((item) => item.objectKey)),
    ];
    void fetchStoryflowUrls(objectKeys)
      .then((urls) => {
        setResolvedUrls(urls);
      })
      .catch((fetchError) => {
        setError(fetchError instanceof Error ? fetchError.message : "任务资源加载失败");
      });
  }, [document]);

  useEffect(() => {
    setHintStage(0);
  }, [safeIndex]);

  useEffect(() => {
    setShadowAssessment(
      assignment?.shadowSubmission?.teacherAssessment ||
        assignment?.shadowSubmission?.studentAssessment ||
        document?.assessments?.shadow ||
        null
    );
  }, [assignment?.shadowSubmission, document?.id, document?.assessments?.shadow]);

  useEffect(() => {
    setSpeakingPracticeRecords(document?.speakingPracticeRecords || []);
  }, [document?.id, document?.speakingPracticeRecords]);

  useEffect(() => {
    return () => {
      shadowAudioTokenRef.current += 1;
      if (shadowAudioCleanupRef.current) {
        shadowAudioCleanupRef.current();
        shadowAudioCleanupRef.current = null;
      }
      if (shadowAudioRef.current) {
        shadowAudioRef.current.pause();
        shadowAudioRef.current.src = "";
        shadowAudioRef.current = null;
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
      }
    };
  }, []);

  const effectivePageSegments = useMemo(() => {
    const tracks = document?.shadowAudio?.tracks || [];
    if (!tracks.length) return [];

    return (document?.shadowAudio?.pageSegments || [])
      .filter(
        (item) =>
          Number.isFinite(item.pageIndex) &&
          item.pageIndex >= 0 &&
          Number.isFinite(item.trackIndex) &&
          item.trackIndex >= 0 &&
          item.trackIndex < tracks.length
      )
      .map((item) => ({
        pageIndex: item.pageIndex,
        slot: normalizeStudentAudioSlot(item.slot),
        trackIndex: item.trackIndex,
        startSec: Math.max(0, item.startSec || 0),
        endSec: Math.max(Math.max(0, item.startSec || 0) + 0.15, item.endSec || 0),
      }))
      .sort((left, right) => {
        if (left.pageIndex !== right.pageIndex) return left.pageIndex - right.pageIndex;
        const order = { single: 0, left: 1, right: 2 };
        return order[left.slot] - order[right.slot];
      });
  }, [document?.shadowAudio]);

  const resolvedTaskMode = forcedTaskMode || taskMode;
  const shadowTotalPages = Math.max(document?.pageObjectKeys?.length || 0, document?.pageCount || 0);
  const shadowTexts = useMemo(
    () => (document ? buildResolvedShadowTexts(document.analysis, shadowTotalPages) : []),
    [document, shadowTotalPages]
  );
  const shadowViews = useMemo(
    () => (document ? getEffectiveShadowViews(document) : []),
    [document]
  );
  const shadowNavigationSteps = useMemo(
    () =>
      !document
        ? []
        : shadowViews.flatMap((item, index) => {
            if (item.kind === "single") {
              const pageIndex = item.pages[0];
              const pageText = getDisplayPageText(
                document.analysis.title,
                pageIndex,
                shadowTexts[pageIndex] || ""
              );
              const { leftText, rightText } = splitDualPageText(pageText);
              if (leftText && rightText) {
                return [
                  { viewIndex: index, focus: 0 as const, pageIndex },
                  { viewIndex: index, focus: 1 as const, pageIndex },
                ];
              }
              return [{ viewIndex: index, focus: 0 as const, pageIndex }];
            }

            const left = item.pages[0];
            const right = item.pages[1];
            const steps: ShadowNavigationStep[] = [];
            const leftText =
              typeof left === "number"
                ? getDisplayPageText(document.analysis.title, left, shadowTexts[left] || "")
                : "";
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
    [document, shadowTexts, shadowViews]
  );
  const safeShadowStepIndex = Math.min(
    Math.max(0, pageIndex),
    Math.max(0, shadowNavigationSteps.length - 1)
  );
  const currentShadowStep = shadowNavigationSteps[safeShadowStepIndex] || null;
  const safeShadowViewIndex = currentShadowStep?.viewIndex ?? Math.min(Math.max(0, pageIndex), Math.max(0, shadowViews.length - 1));
  const spreadFocus = currentShadowStep?.focus ?? 0;
  const activeShadowView: ShadowView =
    shadowViews[safeShadowViewIndex] || { kind: "spread", pages: [null, null] };
  const leftPageIndex =
    activeShadowView.kind === "spread" ? activeShadowView.pages[0] : activeShadowView.pages[0];
  const rightPageIndex = activeShadowView.kind === "spread" ? activeShadowView.pages[1] : null;
  const singlePageText =
    activeShadowView.kind === "single" && typeof activeShadowView.pages[0] === "number"
      ? getDisplayPageText(
          document?.analysis.title || "",
          activeShadowView.pages[0],
          shadowTexts[activeShadowView.pages[0]] || ""
        )
      : "";
  const singlePageTextParts = splitDualPageText(singlePageText);
  const isSingleDualTextView =
    activeShadowView.kind === "single" &&
    Boolean(singlePageTextParts.leftText.trim() && singlePageTextParts.rightText.trim());
  const leftText =
    isSingleDualTextView
      ? singlePageTextParts.leftText
      : typeof leftPageIndex === "number"
      ? getDisplayPageText(document?.analysis.title || "", leftPageIndex, shadowTexts[leftPageIndex] || "")
      : "";
  const rightText =
    isSingleDualTextView
      ? singlePageTextParts.rightText
      : typeof rightPageIndex === "number"
      ? getDisplayPageText(document?.analysis.title || "", rightPageIndex, shadowTexts[rightPageIndex] || "")
      : "";
  const leftDisplayText = activeShadowView.kind === "spread" && activeShadowView.pages[0] === null ? "" : leftText || "";
  const rightDisplayText =
    activeShadowView.kind === "spread" && activeShadowView.pages[1] === null ? "" : rightText || "";
  const hasLeftDisplayText = Boolean(leftDisplayText.trim());
  const hasRightDisplayText = Boolean(rightDisplayText.trim());
  const isDuplicatedSpreadText =
    activeShadowView.kind === "spread" &&
    hasLeftDisplayText &&
    hasRightDisplayText &&
    (activeShadowView.pages[0] === activeShadowView.pages[1] ||
      leftDisplayText.trim().toLowerCase() === rightDisplayText.trim().toLowerCase());
  const shouldMergeSpreadTextBox =
    activeShadowView.kind === "spread" &&
    ((hasLeftDisplayText && !hasRightDisplayText) ||
      (!hasLeftDisplayText && hasRightDisplayText) ||
      isDuplicatedSpreadText);
  const mergedSpreadText = hasLeftDisplayText ? leftDisplayText : rightDisplayText;
  const spreadPageIndexes =
    activeShadowView.kind === "spread"
      ? activeShadowView.pages.filter((pageIdx): pageIdx is number => typeof pageIdx === "number")
      : [];
  const mergedSpreadPageIndex =
    shouldMergeSpreadTextBox && activeShadowView.kind === "spread"
      ? hasLeftDisplayText
        ? leftPageIndex
        : rightPageIndex
      : null;
  const activeShadowPageIndex =
    activeShadowView.kind === "single"
      ? activeShadowView.pages[0]
      : typeof mergedSpreadPageIndex === "number"
        ? mergedSpreadPageIndex
        : spreadPageIndexes[Math.min(spreadFocus, spreadPageIndexes.length - 1)];
  const activeShadowText =
    isSingleDualTextView
      ? spreadFocus === 0
        ? leftText
        : rightText
      : activeShadowView.kind === "spread"
      ? shouldMergeSpreadTextBox
        ? mergedSpreadText
        : spreadFocus === 0
          ? leftText
          : rightText
      : leftText;
  const activeShadowSlot: StoryflowPageAudioSegmentSlot =
    isSingleDualTextView
      ? spreadFocus === 0
        ? "left"
        : "right"
      : "single";
  const getSegmentsForShadowPage = (
    targetPageIndex: number,
    slot: StoryflowPageAudioSegmentSlot = "single"
  ) => {
    const normalizedSlot = normalizeStudentAudioSlot(slot);
    const exactMatches = effectivePageSegments.filter(
      (item) => item.pageIndex === targetPageIndex && item.slot === normalizedSlot
    );
    if (exactMatches.length) return exactMatches;
    if (normalizedSlot !== "single") {
      const fallbackSingleMatches = effectivePageSegments.filter(
        (item) => item.pageIndex === targetPageIndex && item.slot === "single"
      );
      if (fallbackSingleMatches.length) return fallbackSingleMatches;
    }
    return effectivePageSegments.filter((item) => item.pageIndex === targetPageIndex);
  };
  const buildShadowRecordingKey = (step: ShadowNavigationStep) =>
    `${assignmentId}:${step.viewIndex}:${step.focus}:${step.pageIndex}`;
  const shadowRecordableSteps = shadowNavigationSteps.filter((step) =>
    Boolean(
      getShadowStepText(
        getDisplayPageText(document?.analysis.title || "", step.pageIndex, shadowTexts[step.pageIndex] || ""),
        step.focus
      ).trim()
    )
  );
  const currentShadowRecordingKey = currentShadowStep
    ? buildShadowRecordingKey(currentShadowStep)
    : `${assignmentId}:none`;
  const canPrev = resolvedTaskMode === "shadow" ? safeShadowStepIndex > 0 : safeIndex > 0;
  const canNext =
    resolvedTaskMode === "shadow"
      ? safeShadowStepIndex < shadowNavigationSteps.length - 1
      : safeIndex < pages.length - 1;
  const pageImageUrl =
    page && document
      ? (isDisplayUrl(document.images?.[page.pageIndex]) ? document.images?.[page.pageIndex] || "" : "") ||
        resolvedUrls[document.pageObjectKeys?.[page.pageIndex] || ""]
      : "";
  const speakingPromptText =
    page && hintStage >= 2
      ? page.visibleText
      : page && hintStage >= 1
        ? (() => {
            if (page.clozeHint?.trim()) {
              return page.clozeHint.trim();
            }
            const { leftText, rightText } = splitDualPageText(page.visibleText || "");
            if (leftText && rightText) {
              return joinDualPageText(
                buildClozePromptHint(
                  leftText,
                  document?.analysis.keywords || [],
                  document?.analysis.fullText || "",
                  page.keyVocabulary
                ),
                buildClozePromptHint(
                  rightText,
                  document?.analysis.keywords || [],
                  document?.analysis.fullText || "",
                  page.keyVocabulary
                )
              );
            }
            return buildClozePromptHint(
              page.visibleText,
              document?.analysis.keywords || [],
              document?.analysis.fullText || "",
              page.keyVocabulary
            );
          })()
        : "";
  const activeTaskMeta = TASK_MODE_META.find((item) => item.key === resolvedTaskMode) || TASK_MODE_META[0];
  const storyKeywords = document?.analysis.keywords || [];
  const storyCharacters = document?.analysis.characters || [];
  const currentShadowSubmission = assignment?.shadowSubmission || null;
  const storySetting = [document?.analysis.setting?.time, document?.analysis.setting?.place]
    .filter(Boolean)
    .join(" · ");
  const coverImageUrl =
    (isDisplayUrl(document?.images?.[0]) ? document?.images?.[0] || "" : "") ||
    resolvedUrls[
      document?.pageObjectKeys?.[0] || document?.thumbnailObjectKey || ""
    ];
  const assessmentCards = [
    {
      label: "影子跟读",
      assessment:
        currentShadowSubmission?.teacherAssessment ||
        currentShadowSubmission?.studentAssessment ||
        document?.assessments?.shadow,
      note: currentShadowSubmission?.teacherNote || "",
    },
    {
      label: "看图说话",
      assessment: document?.assessments?.speaking,
      note: "",
    },
    {
      label: "脱稿表演",
      assessment: document?.assessments?.performance,
      note: "",
    },
  ];
  const practiceRecords = speakingPracticeRecords;
  const buildAudioUnitsForPracticePage = (practicePage: StudentPracticePage): PracticeAudioUnit[] =>
    !document
      ? []
      :
    practicePage.sourcePageIndexes
      .flatMap((sourcePageIndex) =>
        getSegmentsForShadowPage(sourcePageIndex)
          .map((segment) => {
            const url = resolvedUrls[document.shadowAudio?.tracks?.[segment.trackIndex]?.objectKey || ""] || "";
            if (!url) return null;
            return {
              pageIndex: sourcePageIndex,
              slot: segment.slot,
              text: normalizeStoryText(document.analysis.shadowPageTexts?.[sourcePageIndex] || practicePage.visibleText),
              url,
              startSec: segment.startSec,
              endSec: segment.endSec,
            } satisfies PracticeAudioUnit;
          })
          .filter((item): item is PracticeAudioUnit => Boolean(item))
      );
  const currentShadowAudioUnits =
    typeof activeShadowPageIndex === "number" && document
      ? getSegmentsForShadowPage(activeShadowPageIndex, activeShadowSlot)
          .map((segment) => {
            const url =
              resolvedUrls[document.shadowAudio?.tracks?.[segment.trackIndex]?.objectKey || ""] || "";
            if (!url) return null;
            return {
              pageIndex: activeShadowPageIndex,
              slot: segment.slot,
              text: activeShadowText,
              url,
              startSec: segment.startSec,
              endSec: segment.endSec,
            } satisfies PracticeAudioUnit;
          })
          .filter((item): item is PracticeAudioUnit => Boolean(item))
      : [];
  const hasShadowAudio = currentShadowAudioUnits.length > 0;
  const leftHasPlayableAudio =
    isSingleDualTextView
      ? typeof activeShadowView.pages[0] === "number" &&
        getSegmentsForShadowPage(activeShadowView.pages[0], "left").length > 0
      : typeof leftPageIndex === "number"
      ? getSegmentsForShadowPage(leftPageIndex).length > 0
      : false;
  const rightHasPlayableAudio =
    isSingleDualTextView
      ? typeof activeShadowView.pages[0] === "number" &&
        getSegmentsForShadowPage(activeShadowView.pages[0], "right").length > 0
      : typeof rightPageIndex === "number"
      ? getSegmentsForShadowPage(rightPageIndex).length > 0
      : false;
  const recordedShadowCount = shadowRecordableSteps.filter((step) =>
    Boolean(recordedShadowClips[buildShadowRecordingKey(step)])
  ).length;
  const shadowRecordingSignature = shadowRecordableSteps
    .map((step) => recordedShadowClips[buildShadowRecordingKey(step)]?.createdAt || 0)
    .join(":");
  const overallShadowScore = shadowAssessment
    ? Math.round(
        (shadowAssessment.fluency.score +
          shadowAssessment.pronunciation.score +
          shadowAssessment.intonation.score +
          shadowAssessment.vocabulary.score +
          shadowAssessment.emotion.score) /
          5
      )
    : null;
  const shadowAutoPlayKey =
    resolvedTaskMode === "shadow" && currentShadowAudioUnits.length && typeof activeShadowPageIndex === "number"
      ? `${assignmentId}:${safeShadowStepIndex}:${safeShadowViewIndex}:${spreadFocus}:${activeShadowPageIndex}:${currentShadowAudioUnits
          .map(
            (item) =>
              `${item.pageIndex}:${item.startSec.toFixed(2)}:${item.endSec.toFixed(2)}:${item.url}`
          )
          .join("|")}`
      : null;
  const shadowSimpleComment = shadowAssessment?.simpleComment?.trim() || "";
  const shadowFeedbackOverlay =
    isShadowFeedbackOpen && shadowAssessment ? (
      <div className="fixed inset-0 z-[120] bg-[rgba(0,0,0,0.3)] backdrop-blur-sm">
        <div className="flex h-screen w-screen items-center justify-center px-4 py-4 md:px-6 md:py-6">
          <div className="flex h-[92vh] w-[min(1440px,96vw)] flex-col overflow-hidden rounded-[2rem] border border-white/70 bg-white shadow-[0_30px_90px_rgba(15,23,42,0.22)]">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-500">
                  Shadow Feedback
                </p>
                <h3 className="mt-2 text-[1.9rem] font-black text-slate-900">
                  影子跟读点评
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsShadowFeedbackOpen(false)}
                className="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-200"
              >
                关闭
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-6">
              <div className="grid gap-3 sm:grid-cols-5">
                {[
                  ["流畅", shadowAssessment.fluency.score],
                  ["发音", shadowAssessment.pronunciation.score],
                  ["语调", shadowAssessment.intonation.score],
                  ["词汇", shadowAssessment.vocabulary.score],
                  ["表达", shadowAssessment.emotion.score],
                ].map(([label, score]) => (
                  <div
                    key={`shadow_feedback_${String(label)}`}
                    className="rounded-2xl bg-slate-50 px-3 py-4 text-center"
                  >
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                      {label}
                    </p>
                    <p className="mt-1 text-3xl font-black text-slate-900">{score}</p>
                  </div>
                ))}
              </div>

              <div className="mt-5 rounded-[1.8rem] bg-gradient-to-br from-sky-50 to-white px-6 py-6 ring-1 ring-sky-100">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-600">
                  点评
                </p>
                <p className="mt-4 whitespace-pre-line text-lg leading-9 text-slate-800">
                  {shadowAssessment.overallComment.trim() || shadowSimpleComment}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    ) : null;
  const showTeacherHints = hintStage >= 1;
  const showOriginalText = hintStage >= 2;
  const isPracticeActive = practiceStatus === "active";
  const isCountingDown = practiceStatus === "countdown";
  const displayPromptText = showOriginalText ? page?.visibleText || "" : speakingPromptText;
  const displayPromptParts = splitDualPageText(displayPromptText);
  const hasDualDisplayPrompt = Boolean(
    displayPromptParts.leftText.trim() && displayPromptParts.rightText.trim()
  );
  const latestPracticeRecord = latestPracticeId
    ? practiceRecords.find((item) => item.id === latestPracticeId) || null
    : practiceRecords[0] || null;
  const speakingRatingLabel = latestPracticeRecord?.ratingLabel || "待评分";
  const speakingStoryTitle =
    document?.analysis.title?.trim() || assignment?.documentTitle || activeTaskMeta.label;
  const speakingStatusLabel = isCountingDown ? "倒计时中" : isPracticeActive ? "练习进行中" : "准备开始";
  const speakingPromptTitle = showOriginalText ? "原文" : "提示";
  const practiceSummaryText = isPracticeActive
    ? "先看图复述，再按顺序领取提示。"
    : "先看图片，自己回忆并复述这一页的绘本原文。";
  const visitedProgressCount = practiceDraft?.visitedPageIndexes.length || 0;
  const canResetToImageOnly = practiceStatus !== "countdown";

  const stopShadowAudioPlayback = () => {
    shadowAudioTokenRef.current += 1;
    if (shadowAudioCleanupRef.current) {
      shadowAudioCleanupRef.current();
      shadowAudioCleanupRef.current = null;
    }
    if (shadowAudioRef.current) {
      shadowAudioRef.current.pause();
      shadowAudioRef.current.src = "";
      shadowAudioRef.current = null;
    }
    setIsPlayingShadowAudio(false);
  };

  const stopShadowRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
  };

  const playShadowAudioSequence = (units: PracticeAudioUnit[], unitIndex = 0, token = shadowAudioTokenRef.current) => {
    const currentUnit = units[unitIndex];
    if (!currentUnit) {
      setIsPlayingShadowAudio(false);
      return;
    }

    const audio = new Audio(currentUnit.url);
    shadowAudioRef.current = audio;
    audio.preload = "auto";

    const finishCurrent = () => {
      if (shadowAudioCleanupRef.current === finishCurrent) {
        shadowAudioCleanupRef.current = null;
      }
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      audio.pause();
      audio.src = "";
      if (shadowAudioRef.current === audio) {
        shadowAudioRef.current = null;
      }
      if (token !== shadowAudioTokenRef.current) return;
      if (unitIndex + 1 < units.length) {
        playShadowAudioSequence(units, unitIndex + 1, token);
        return;
      }
      setIsPlayingShadowAudio(false);
    };

    const segmentStart = Math.max(0, currentUnit.startSec || 0);
    const segmentEnd = Math.max(segmentStart + 0.15, currentUnit.endSec || 0);
    const onTimeUpdate = () => {
      if (audio.currentTime >= segmentEnd - 0.02) {
        finishCurrent();
      }
    };
    const onEnded = () => finishCurrent();
    const onError = () => finishCurrent();

    shadowAudioCleanupRef.current = finishCurrent;
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);

    const startPlayback = () => {
      try {
        audio.currentTime = segmentStart;
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

  const handlePlayShadowAudio = () => {
    if (isPlayingShadowAudio) {
      stopShadowAudioPlayback();
      return;
    }
    if (!currentShadowAudioUnits.length) return;
    stopShadowAudioPlayback();
    setIsPlayingShadowAudio(true);
    playShadowAudioSequence(currentShadowAudioUnits, 0, shadowAudioTokenRef.current);
  };

  const startCurrentShadowAudioPlayback = () => {
    if (!currentShadowAudioUnits.length) return false;
    stopShadowAudioPlayback();
    setIsPlayingShadowAudio(true);
    playShadowAudioSequence(currentShadowAudioUnits, 0, shadowAudioTokenRef.current);
    return true;
  };

  const handleRecordShadowToggle = async () => {
    if (isRecordingShadow) {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      return;
    }

    if (!activeShadowText.trim()) return;

    try {
      setShadowScoreError(null);
      stopShadowAudioPlayback();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recordingStartMsRef.current = Date.now();
      const chunks: Blob[] = [];
      const recordingKey = currentShadowRecordingKey;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      recorder.onstop = () => {
        const clipBlob = new Blob(chunks, {
          type: recorder.mimeType || "audio/webm",
        });
        if (clipBlob.size > 0) {
          setRecordedShadowClips((current) => ({
            ...current,
            [recordingKey]: {
              blob: clipBlob,
              createdAt: Date.now(),
              durationSec: Math.max(0, (Date.now() - recordingStartMsRef.current) / 1000),
            },
          }));
          setShadowAssessment(null);
        }
        if (mediaStreamRef.current) {
          mediaStreamRef.current.getTracks().forEach((track) => track.stop());
          mediaStreamRef.current = null;
        }
        mediaRecorderRef.current = null;
        setIsRecordingShadow(false);
      };

      recorder.onerror = () => {
        if (mediaStreamRef.current) {
          mediaStreamRef.current.getTracks().forEach((track) => track.stop());
          mediaStreamRef.current = null;
        }
        mediaRecorderRef.current = null;
        setIsRecordingShadow(false);
      };

      recorder.start();
      setIsRecordingShadow(true);
    } catch {
      setIsRecordingShadow(false);
      setShadowScoreError("无法启动录音，请检查麦克风权限。");
    }
  };

  const handleScoreShadowReading = async () => {
    if (!document || !assignment) {
      return;
    }
    const orderedClips = shadowRecordableSteps
      .map((step) => recordedShadowClips[buildShadowRecordingKey(step)]?.blob)
      .filter((clip): clip is Blob => Boolean(clip));

    if (!orderedClips.length) {
      setShadowScoreError("请先录制至少一页，再进行打分。");
      return;
    }

    setIsSubmittingShadowScore(true);
    setShadowScoreError(null);
    let mergedAudio: Blob | null = null;
    let audioDataUrl = "";
    try {
      mergedAudio = await renderMergedAudioToWav(orderedClips);
      audioDataUrl = await blobToDataUrl(mergedAudio);
      const referenceText = shadowRecordableSteps
        .map((step) =>
          getShadowStepText(
            getDisplayPageText(
              document.analysis.title,
              step.pageIndex,
              shadowTexts[step.pageIndex] || ""
            ),
            step.focus
          ).trim()
        )
        .filter(Boolean)
        .join("\n");

      const formData = new FormData();
      formData.append("audio", mergedAudio, `${document.analysis.title || "storyflow-reading"}.wav`);
      formData.append("referenceText", referenceText);
      formData.append("studentName", session.displayName || session.username);
      formData.append("bookName", document.analysis.title || document.sourceName || "");
      formData.append("homeworkType", "绘本跟读");
      formData.append("tutorName", assignment.teacherDisplayName || "");

      const response = await fetch("/api/storyflow/score-audio", {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json()) as {
        result?: AnalysisResult;
        error?: string;
      };

      if (!response.ok || !payload.result) {
        throw new Error(payload.error || "影子跟读评分失败");
      }

      lastSubmittedShadowSignatureRef.current = shadowRecordingSignature;
      setShadowAssessment(payload.result);
      const updatedAssignment = updateStoryflowAssignment(assignment.id, (current) => ({
        ...current,
        shadowSubmission: {
          completedAt: Date.now(),
          audioDataUrl,
          audioMimeType: mergedAudio?.type || "audio/wav",
          audioFileName: `${document.analysis.title || "storyflow-reading"}.wav`,
          durationSec: shadowRecordableSteps.reduce(
            (sum, step) => sum + (recordedShadowClips[buildShadowRecordingKey(step)]?.durationSec || 0),
            0
          ),
          clipCount: shadowRecordableSteps.length,
          studentAssessment: payload.result,
          teacherAssessment: current.shadowSubmission?.teacherAssessment || null,
          teacherNote: current.shadowSubmission?.teacherNote || "",
        },
      }));
      if (updatedAssignment) {
        setAssignment(updatedAssignment);
      }
    } catch (error) {
      if (mergedAudio && audioDataUrl) {
        const updatedAssignment = updateStoryflowAssignment(assignment.id, (current) => ({
          ...current,
          shadowSubmission: {
            completedAt: Date.now(),
            audioDataUrl,
            audioMimeType: mergedAudio?.type || "audio/wav",
            audioFileName: `${document.analysis.title || "storyflow-reading"}.wav`,
            durationSec: shadowRecordableSteps.reduce(
              (sum, step) => sum + (recordedShadowClips[buildShadowRecordingKey(step)]?.durationSec || 0),
              0
            ),
            clipCount: shadowRecordableSteps.length,
            studentAssessment: current.shadowSubmission?.studentAssessment || null,
            teacherAssessment: current.shadowSubmission?.teacherAssessment || null,
            teacherNote: current.shadowSubmission?.teacherNote || "",
          },
        }));
        if (updatedAssignment) {
          setAssignment(updatedAssignment);
        }
      }
      lastSubmittedShadowSignatureRef.current = shadowRecordingSignature;
      setShadowAssessment(null);
      setShadowScoreError(error instanceof Error ? error.message : "影子跟读评分失败");
    } finally {
      setIsSubmittingShadowScore(false);
    }
  };

  const recordPracticeReveal = (kind: "prompt" | "original") => {
    if (!isPracticeActive || !page) return;

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
    if (!page) return;
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
    if (practiceStatus !== "active" || !practiceDraft || !page || !document || !assignment) return;

    const durationSec = Math.max(1, Math.round((Date.now() - practiceDraft.startedAt) / 1000));
    const practicedPages = practiceDraft.visitedPageIndexes.length;
    const { score, ratingLabel } = scoreSpeakingPractice({
      durationSec,
      promptRevealCount: practiceDraft.promptRevealCount,
      originalRevealCount: practiceDraft.originalRevealCount,
      totalPages: pages.length,
      practicedPages,
    });

    const record: StoryflowSpeakingPracticeRecord = {
      id: `practice_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now(),
      durationSec,
      promptRevealCount: practiceDraft.promptRevealCount,
      originalRevealCount: practiceDraft.originalRevealCount,
      totalPages: pages.length,
      practicedPages,
      score,
      ratingLabel,
      promptViewedTexts: practiceDraft.promptViewedTexts,
      originalViewedTexts: practiceDraft.originalViewedTexts,
    };

    const nextRecords = [record, ...practiceRecords].slice(0, 30);
    setSpeakingPracticeRecords(nextRecords);
    setLatestPracticeId(record.id);
    setIsPracticeHistoryOpen(true);
    setPracticeStatus("idle");
    setHintStage(0);
    setCountdownValue(3);
    setPracticeDraft(null);

    updateTeacherStoryflowDocument(assignment.teacherUsername, document.id, (current) => ({
      ...current,
      speakingPracticeRecords: nextRecords,
    }));
  };

  useEffect(() => {
    if (resolvedTaskMode !== "shadow") {
      lastShadowAutoPlayKeyRef.current = null;
      stopShadowAudioPlayback();
      stopShadowRecording();
      return;
    }
    if (!shadowAutoPlayKey || !hasShadowAudio) {
      return;
    }
    if (lastShadowAutoPlayKeyRef.current === shadowAutoPlayKey) {
      return;
    }

    const started = startCurrentShadowAudioPlayback();
    if (started) {
      lastShadowAutoPlayKeyRef.current = shadowAutoPlayKey;
    }
  }, [resolvedTaskMode, shadowAutoPlayKey, hasShadowAudio]);

  useEffect(() => {
    if (resolvedTaskMode !== "shadow") {
      return;
    }
    if (!shadowRecordableSteps.length || recordedShadowCount < shadowRecordableSteps.length) {
      return;
    }
    if (!shadowRecordingSignature || isSubmittingShadowScore) {
      return;
    }
    if (lastSubmittedShadowSignatureRef.current === shadowRecordingSignature) {
      return;
    }
    void handleScoreShadowReading();
  }, [
    handleScoreShadowReading,
    isSubmittingShadowScore,
    shadowRecordableSteps.length,
    recordedShadowCount,
    resolvedTaskMode,
    shadowRecordingSignature,
  ]);

  useEffect(() => {
    if (resolvedTaskMode !== "speaking") return;
    setHintStage(0);
  }, [resolvedTaskMode, safeIndex]);

  useEffect(() => {
    if (resolvedTaskMode !== "speaking") return undefined;
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
  }, [countdownValue, practiceStatus, resolvedTaskMode]);

  useEffect(() => {
    if (resolvedTaskMode !== "speaking" || practiceStatus !== "active" || !page) return;

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
  }, [page, practiceStatus, resolvedTaskMode]);

  if (error) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-50 px-6 text-center">
        <div>
          <p className="text-2xl font-bold text-slate-900">{error}</p>
          <Link
            href="/tasks"
            className="mt-5 inline-flex rounded-full bg-sky-600 px-5 py-3 text-sm font-bold text-white"
          >
            返回任务列表
          </Link>
        </div>
      </div>
    );
  }

  if (!assignment || !document || !page) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-50 text-slate-500">
        正在加载任务...
      </div>
    );
  }

  if (view === "overview") {
    const overviewInfoCards = [
      {
        label: "角色",
        value: storyCharacters.join("、") || "未识别",
        icon: "characters" as const,
      },
      {
        label: "时间",
        value: document.analysis.setting?.time || "未识别",
        icon: "time" as const,
      },
      {
        label: "地点",
        value: document.analysis.setting?.place || "未识别",
        icon: "place" as const,
      },
      {
        label: "关键词",
        value: storyKeywords.slice(0, 6).join(" / ") || "暂无",
        icon: "keywords" as const,
      },
    ];
    const overviewTaskCardMeta: Record<
      TaskMode,
      { icon: Parameters<typeof OverviewIcon>[0]["kind"]; badgeClass: string }
    > = {
      mindmap: {
        icon: "mindmap",
        badgeClass: "bg-[linear-gradient(180deg,#d18bff,#9f58ff)] text-white",
      },
      shadow: {
        icon: "shadow",
        badgeClass: "bg-[linear-gradient(180deg,#ffb36a,#ff7b3d)] text-white",
      },
      speaking: {
        icon: "speaking",
        badgeClass: "bg-[linear-gradient(180deg,#63dc6f,#31bf58)] text-white",
      },
      performance: {
        icon: "performance",
        badgeClass: "bg-[linear-gradient(180deg,#5ca8ff,#2d79ff)] text-white",
      },
      assessment: {
        icon: "assessment",
        badgeClass: "bg-[linear-gradient(180deg,#ffd76a,#ffbc2d)] text-white",
      },
    };

    return (
      <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(201,231,255,0.92),_rgba(238,246,255,0.98)_38%,_#f6fbff_72%,_#eef5ff_100%)]">
        <div className="mx-auto flex min-h-screen max-w-[1680px] flex-col px-4 py-2.5 md:px-6 md:py-3">
          <div className="mb-2.5 flex items-start">
            <button
              type="button"
              onClick={() => router.push("/tasks")}
              className="flex h-12 w-12 items-center justify-center rounded-full border border-white/85 bg-white/72 text-sky-500 shadow-[0_14px_26px_rgba(120,149,188,0.16)] backdrop-blur transition hover:bg-white"
              aria-label="返回任务列表"
              title="返回任务列表"
            >
              <OverviewIcon kind="back" className="h-6 w-6" />
            </button>
          </div>

          <div className="relative overflow-hidden rounded-[1.65rem] border border-sky-100/85 bg-[linear-gradient(180deg,rgba(255,255,255,0.88),rgba(244,249,255,0.97))] px-6 py-6 shadow-[0_20px_52px_rgba(120,149,188,0.15)]">
            <div className="relative flex flex-col gap-4 lg:flex-row lg:items-start">
              <div className="h-[210px] w-[192px] shrink-0 overflow-hidden rounded-[1.35rem] border border-sky-100 bg-white shadow-[0_14px_32px_rgba(120,149,188,0.13)]">
                {coverImageUrl ? (
                  <img
                    src={coverImageUrl}
                    alt={assignment.documentTitle}
                    className="h-full w-full object-cover object-center"
                  />
                ) : (
                  <div className="grid h-full w-full place-items-center text-lg font-bold text-sky-600">
                    绘本封面
                  </div>
                )}
              </div>

              <div className="min-w-0 flex-1 pt-0.5">
                <p className="text-[0.88rem] font-semibold uppercase tracking-[0.3em] text-sky-500">
                  Storyflow
                </p>
                <h1 className="mt-2 text-[2.8rem] font-semibold leading-none tracking-tight text-slate-800">
                  {assignment.documentTitle}
                </h1>
                <p className="mt-4 max-w-5xl text-[0.95rem] font-normal leading-[1.7] text-slate-600">
                  {document.analysis.summary || "老师已为你准备好整本绘本任务，可以从下面选择不同练习。"}
                </p>
                <div className="mt-5 flex flex-wrap items-center gap-3 text-[0.95rem] font-normal text-slate-500">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-sky-50 text-sky-500 shadow-inner">
                    <OverviewIcon kind="teacher" className="h-5 w-5" />
                  </div>
                  <span>老师：{assignment.teacherDisplayName}</span>
                  <span className="text-slate-300">•</span>
                  <span>学生：{assignment.studentDisplayName}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-3.5 grid gap-3 xl:grid-cols-4">
            {overviewInfoCards.map((item) => (
              <div
                key={item.label}
                className="rounded-[1.4rem] border border-sky-100/90 bg-[linear-gradient(180deg,rgba(255,255,255,0.9),rgba(243,248,255,0.96))] px-4.5 py-4 shadow-[0_14px_34px_rgba(120,149,188,0.11)]"
              >
                <div className="flex items-center gap-2.5 pl-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-sky-50 text-sky-500 shadow-inner">
                    <OverviewIcon kind={item.icon} className="h-5 w-5" />
                  </div>
                  <p className="text-[0.94rem] font-semibold text-sky-500">{item.label}</p>
                </div>
                <p className="mt-3 pl-2 text-[0.98rem] font-medium leading-[1.34] tracking-tight text-slate-700 md:text-[1.28rem]">
                  {item.value}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-3.5 rounded-[1.6rem] border border-sky-100/90 bg-[linear-gradient(180deg,rgba(255,255,255,0.88),rgba(243,248,255,0.96))] px-3.5 py-3.5 shadow-[0_18px_48px_rgba(120,149,188,0.14)]">
            <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-5">
              {TASK_MODE_META.map((item) => {
                const modeMeta = overviewTaskCardMeta[item.key];
                return (
                  <Link
                    key={item.key}
                    href={`/tasks/${assignmentId}/${item.key}`}
                    className="group overflow-hidden rounded-[1.3rem] border border-sky-100/85 bg-[linear-gradient(180deg,rgba(255,255,255,0.94),rgba(247,250,255,0.96))] px-3.5 py-3.5 text-left shadow-[0_10px_24px_rgba(120,149,188,0.1)] transition hover:-translate-y-0.5 hover:shadow-[0_14px_30px_rgba(120,149,188,0.14)]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="h-[72px] w-[62px] shrink-0 overflow-hidden rounded-[0.85rem] border border-sky-100 bg-white shadow-sm">
                        {coverImageUrl ? (
                          <img
                            src={coverImageUrl}
                            alt={item.label}
                            className="h-full w-full object-cover object-center"
                          />
                        ) : (
                          <div className="grid h-full w-full place-items-center text-xs font-semibold text-sky-600">
                            封面
                          </div>
                        )}
                      </div>
                      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full shadow-[0_8px_18px_rgba(120,149,188,0.13)] ${modeMeta.badgeClass}`}>
                        <OverviewIcon kind={modeMeta.icon} className="h-[18px] w-[18px]" />
                      </div>
                    </div>
                    <div className="mt-2.5">
                      <p className="text-[0.94rem] font-semibold tracking-tight text-slate-800 md:text-[1rem]">
                        {item.label}
                      </p>
                      <p className="mt-1 text-[0.76rem] font-normal leading-5 text-slate-500">
                        {item.description}
                      </p>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const handleShadowPrev = () => {
    stopShadowAudioPlayback();
    stopShadowRecording();
    lastShadowAutoPlayKeyRef.current = null;
    setPageIndex((current) => Math.max(0, current - 1));
  };

  const handleShadowNext = () => {
    stopShadowAudioPlayback();
    stopShadowRecording();
    lastShadowAutoPlayKeyRef.current = null;
    setPageIndex((current) => Math.min(shadowNavigationSteps.length - 1, current + 1));
  };

  if (resolvedTaskMode === "speaking") {
    return (
      <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(190,225,255,0.9),_rgba(236,244,255,0.98)_42%,_#f6fbff_72%,_#eef5ff_100%)]">
        <div className="mx-auto flex min-h-screen max-w-[1680px] flex-col px-0 py-0">
          <div className="relative flex flex-1 flex-col overflow-hidden rounded-[2.4rem] border border-white/75 bg-[linear-gradient(180deg,rgba(255,255,255,0.78),rgba(241,247,255,0.96))] shadow-[0_28px_90px_rgba(120,149,188,0.22)] backdrop-blur-xl">
            <div className="absolute inset-0 overflow-hidden">
              <div className="absolute -left-16 top-8 h-52 w-52 rounded-full bg-sky-200/40 blur-3xl" />
              <div className="absolute right-0 top-0 h-64 w-64 rounded-full bg-blue-100/55 blur-3xl" />
              <div className="absolute bottom-0 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full bg-white/45 blur-3xl" />
            </div>

            <div className="relative flex flex-1 flex-col px-0 pb-px md:pb-1">
              <div className="rounded-none border-x-0 border-t-0 border-b-0 bg-white/58 px-0 pb-0 pt-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] backdrop-blur md:px-0 md:pb-0 md:pt-0">
                <div className="relative mx-auto flex min-h-[380px] max-w-[1460px] items-center justify-center md:min-h-[540px]">
                  <button
                    type="button"
                    onClick={() => router.back()}
                    className="absolute left-2 top-2 z-30 grid h-14 w-14 place-items-center rounded-full border border-white/85 bg-white/68 text-[2rem] font-semibold text-sky-500 shadow-[0_12px_28px_rgba(120,149,188,0.18)] backdrop-blur transition hover:bg-white md:left-4 md:top-4"
                    aria-label="返回上一页"
                    title="返回"
                  >
                    <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 12H8" />
                      <path d="m12 8-4 4 4 4" />
                    </svg>
                  </button>

                  <button
                    type="button"
                    disabled={!canPrev}
                    onClick={() => {
                      setHintStage(0);
                      setPageIndex(safeIndex - 1);
                    }}
                    className="absolute left-0 top-1/2 z-20 flex h-16 w-16 -translate-y-1/2 items-center justify-center rounded-full border border-white/85 bg-white/70 text-sky-500 shadow-[0_18px_36px_rgba(120,149,188,0.2)] backdrop-blur transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40 md:left-2"
                    aria-label="上一页"
                  >
                    <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m15 18-6-6 6-6" />
                    </svg>
                  </button>

                  <button
                    type="button"
                    disabled={!canNext}
                    onClick={() => {
                      setHintStage(0);
                      setPageIndex(safeIndex + 1);
                    }}
                    className="absolute right-0 top-1/2 z-20 flex h-16 w-16 -translate-y-1/2 items-center justify-center rounded-full border border-white/85 bg-white/70 text-sky-500 shadow-[0_18px_36px_rgba(120,149,188,0.2)] backdrop-blur transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40 md:right-2"
                    aria-label="下一页"
                  >
                    <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m9 6 6 6-6 6" />
                    </svg>
                  </button>

                  <div className="w-full px-12 md:px-20">
                    <div className="relative overflow-hidden rounded-[1.85rem] border border-white/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.84),rgba(249,251,255,0.92))] p-3 shadow-[0_20px_60px_rgba(120,149,188,0.14)] md:p-4">
                      {pageImageUrl ? (
                        <img
                          src={pageImageUrl}
                          alt={page.pageTitle}
                          className="mx-auto max-h-[64vh] w-full rounded-[1.5rem] object-contain"
                        />
                      ) : (
                        <div className="grid h-[320px] place-items-center rounded-[1.5rem] bg-white text-slate-400">
                          正在加载页面图片...
                        </div>
                      )}

                      {isCountingDown ? (
                        <div className="absolute inset-0 z-20 flex items-center justify-center rounded-[1.5rem] bg-slate-950/22 backdrop-blur-[2px]">
                          <div className="grid h-36 w-36 place-items-center rounded-full border border-white/70 bg-white/88 text-6xl font-black text-sky-600 shadow-[0_24px_60px_rgba(120,149,188,0.3)]">
                            {countdownValue}
                          </div>
                        </div>
                      ) : null}

                      {showTeacherHints && !isCountingDown ? (
                        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center px-6">
                          <div className="max-w-[82%] text-center">
                            <p className="mb-2 text-sm font-semibold uppercase tracking-[0.22em] text-white/90 drop-shadow-[0_2px_6px_rgba(0,0,0,0.28)] md:text-base">
                              {speakingPromptTitle}
                            </p>
                            {hasDualDisplayPrompt ? (
                              <div className="grid gap-3 text-left md:grid-cols-2">
                                <div className="rounded-[1.2rem] border border-sky-200/30 bg-[rgba(0,0,0,0.42)] px-4 py-3 shadow-[0_12px_32px_rgba(15,23,42,0.26)] md:px-6 md:py-4">
                                  <p className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-100">
                                    Left Page
                                  </p>
                                  <p className="mt-2 text-[1.32rem] font-semibold leading-[1.8] tracking-[0.01em] text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.38)] md:text-[1.6rem]">
                                    {displayPromptParts.leftText}
                                  </p>
                                </div>
                                <div className="rounded-[1.2rem] border border-violet-200/30 bg-[rgba(0,0,0,0.42)] px-4 py-3 shadow-[0_12px_32px_rgba(15,23,42,0.26)] md:px-6 md:py-4">
                                  <p className="text-sm font-semibold uppercase tracking-[0.18em] text-violet-100">
                                    Right Page
                                  </p>
                                  <p className="mt-2 text-[1.32rem] font-semibold leading-[1.8] tracking-[0.01em] text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.38)] md:text-[1.6rem]">
                                    {displayPromptParts.rightText}
                                  </p>
                                </div>
                              </div>
                            ) : (
                              <div className="rounded-[1.2rem] border border-white/10 bg-[rgba(0,0,0,0.42)] px-4 py-3 shadow-[0_12px_32px_rgba(15,23,42,0.26)] md:px-6 md:py-4">
                                <p className="text-[1.47rem] font-semibold leading-[1.8] tracking-[0.01em] text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.38)] md:text-[1.875rem]">
                                  {displayPromptText || "暂无提示内容"}
                                </p>
                              </div>
                            )}
                          </div>
                        </div>
                      ) : null}

                      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-white/80 bg-white/78 px-5 py-2 text-lg font-bold text-slate-600 shadow-[0_10px_24px_rgba(120,149,188,0.16)] backdrop-blur">
                        第 <span className="text-sky-600">{safeIndex + 1}</span> 页 / {pages.length}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-0 grid gap-[4px] xl:grid-cols-[minmax(0,1fr)_280px]">
                  <div className="rounded-[1.25rem] border border-white/85 bg-[linear-gradient(180deg,rgba(255,255,255,0.88),rgba(241,247,255,0.95))] px-4 py-1.5 shadow-[0_14px_34px_rgba(120,149,188,0.12)]">
                    <div className="flex items-center gap-2.5">
                      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-sky-100 text-sky-500 shadow-inner">
                        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8">
                          <circle cx="12" cy="12" r="7.5" />
                          <path d="M12 8v4l2.5 2.5" />
                          <path d="M20 4l-2.2 2.2" />
                        </svg>
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-[1rem] font-black text-slate-900 md:text-[1.08rem]">练习目标</p>
                          <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-bold text-sky-600">
                            {speakingStatusLabel}
                          </span>
                          <span className="rounded-full bg-white/80 px-3 py-1 text-xs font-semibold text-slate-500">
                            {visitedProgressCount}/{pages.length} 页
                          </span>
                        </div>
                        <p className="mt-0.5 text-[0.88rem] leading-5 text-slate-600 md:text-[0.92rem]">
                          {practiceSummaryText} 想不起来时，再按顺序领取提示，不要一开始就看答案。
                        </p>
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setIsPracticeHistoryOpen((current) => !current)}
                    className="rounded-[1.4rem] border border-white/85 bg-[linear-gradient(180deg,rgba(255,255,255,0.88),rgba(241,247,255,0.95))] px-4 py-2.5 text-left shadow-[0_14px_34px_rgba(120,149,188,0.12)] transition hover:bg-white"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="inline-flex items-center gap-2 rounded-full bg-white/78 px-3 py-2 shadow-sm">
                        <span className="text-xl text-amber-400">⭐</span>
                        <span className="text-sm font-bold text-slate-500">评分</span>
                      </div>
                      <span className="text-[2.15rem] font-black leading-none text-sky-500">
                        {speakingRatingLabel}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center justify-between border-t border-sky-100 pt-2 text-sky-600">
                      <span className="text-base font-bold">练习记录</span>
                      <span className="text-2xl leading-none">›</span>
                    </div>
                  </button>
                </div>

                {isPracticeHistoryOpen ? (
                  <div className="mt-[4px] rounded-[1.5rem] border border-white/85 bg-[linear-gradient(180deg,rgba(255,255,255,0.9),rgba(241,247,255,0.96))] px-4 py-3 shadow-[0_14px_34px_rgba(120,149,188,0.12)]">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-[1.1rem] font-black text-slate-900">练习记录</p>
                        <p className="mt-1 text-sm text-slate-500">
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
                                <td className="px-3 py-3 font-black text-sky-700">{record.ratingLabel}</td>
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

              <div className="mt-[4px] rounded-[1.6rem] border border-white/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.86),rgba(237,244,255,0.95))] px-2 py-2 shadow-[0_20px_60px_rgba(120,149,188,0.14)] backdrop-blur md:px-3 md:py-2.5">
                <div className="grid gap-[4px] md:grid-cols-2 xl:grid-cols-5">
                  <button
                    type="button"
                    onClick={handleStartPractice}
                    disabled={practiceStatus !== "idle"}
                    className="flex min-h-[43px] items-center justify-center gap-2 rounded-[1.45rem] bg-[linear-gradient(180deg,#4aa8ff,#1971ff)] px-4 py-2 text-left text-white shadow-[0_18px_30px_rgba(25,113,255,0.34)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <span className="grid h-7 w-7 place-items-center rounded-full bg-white/18 text-base">▶</span>
                    <span>
                      <span className="block text-[0.93rem] font-black">开始练习</span>
                      <span className="block text-[10px] text-white/82">
                        {practiceStatus === "idle" ? "进入 3 秒倒计时" : "当前不可开始"}
                      </span>
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      if (!canResetToImageOnly) return;
                      setHintStage(0);
                    }}
                    disabled={!canResetToImageOnly}
                    className={`flex min-h-[43px] items-center justify-center gap-2 rounded-[1.45rem] border px-3 py-2 text-left shadow-[0_14px_28px_rgba(120,149,188,0.12)] transition ${
                      hintStage === 0
                        ? "border-sky-200 bg-sky-50 text-sky-700"
                        : "border-white/85 bg-white/80 text-slate-700 hover:bg-white"
                    } disabled:cursor-not-allowed disabled:opacity-45`}
                  >
                    <span className="grid h-7 w-7 place-items-center rounded-full bg-sky-100 text-sky-500">
                      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
                        <circle cx="9" cy="10" r="1.4" />
                        <path d="m6.5 16 4.2-4.1 2.7 2.6 2.1-2.1 2 3.6" />
                      </svg>
                    </span>
                    <span>
                      <span className="block text-[0.78rem] font-black">只看图片</span>
                      <span className="block text-[10px] text-slate-500">隐藏所有文字提示</span>
                    </span>
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
                    className={`flex min-h-[43px] items-center justify-center gap-2 rounded-[1.45rem] border px-3 py-2 text-left shadow-[0_14px_28px_rgba(120,149,188,0.12)] transition ${
                      hintStage >= 1
                        ? "border-sky-200 bg-sky-50 text-sky-700"
                        : "border-white/85 bg-white/80 text-slate-700 hover:bg-white"
                    } disabled:cursor-not-allowed disabled:opacity-45`}
                  >
                    <span className="grid h-7 w-7 place-items-center rounded-full bg-sky-100 text-sky-500">
                      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <path d="M12 3a7 7 0 0 0-4 12.7V19a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-3.3A7 7 0 0 0 12 3Z" />
                        <path d="M9.5 21h5" />
                      </svg>
                    </span>
                    <span>
                      <span className="block text-[0.78rem] font-black">给点提示</span>
                      <span className="block text-[10px] text-slate-500">显示填空式回忆提示</span>
                    </span>
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
                    className={`flex min-h-[43px] items-center justify-center gap-2 rounded-[1.45rem] border px-3 py-2 text-left shadow-[0_14px_28px_rgba(120,149,188,0.12)] transition ${
                      hintStage >= 2
                        ? "border-sky-200 bg-sky-50 text-sky-700"
                        : "border-white/85 bg-white/80 text-slate-700 hover:bg-white"
                    } disabled:cursor-not-allowed disabled:opacity-45`}
                  >
                    <span className="grid h-7 w-7 place-items-center rounded-full bg-sky-100 text-sky-500">
                      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <path d="M7 4.5h8.5a2 2 0 0 1 2 2V19l-4-2-4 2V6.5a2 2 0 0 0-2-2Z" />
                        <path d="M7 4.5a2 2 0 0 0-2 2V17a2 2 0 0 0 2 2h10.5" />
                      </svg>
                    </span>
                    <span>
                      <span className="block text-[0.78rem] font-black">显示原文</span>
                      <span className="block text-[10px] text-slate-500">直接查看完整句子</span>
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={handleFinishPractice}
                    disabled={!isPracticeActive}
                    className="flex min-h-[43px] items-center justify-center gap-2 rounded-[1.45rem] border border-emerald-100 bg-[linear-gradient(180deg,#f1fff8,#ddfff1)] px-3 py-2 text-left text-emerald-700 shadow-[0_18px_30px_rgba(72,187,120,0.16)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <span className="grid h-7 w-7 place-items-center rounded-full bg-emerald-500 text-base text-white shadow-sm">✓</span>
                    <span>
                      <span className="block text-[0.78rem] font-black">完成练习</span>
                      <span className="block text-[10px] text-emerald-600">生成本次练习评分与记录</span>
                    </span>
                  </button>
                </div>

              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (resolvedTaskMode === "shadow") {
    return (
      <>
        {shadowFeedbackOverlay}
        <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(186,230,253,0.85),_rgba(239,246,255,0.98)_45%,_white_100%)]">
          <div className="mx-auto flex min-h-screen max-w-[1600px] flex-col px-4 py-3 md:px-6">
            <div className="overflow-hidden rounded-[1.9rem] bg-[radial-gradient(circle_at_top,_rgba(147,197,253,0.7),_rgba(224,242,254,0.9)_55%,_rgba(240,249,255,0.98)_100%)] shadow-[0_18px_60px_rgba(59,130,246,0.14)]">
              <div className="relative flex h-[min(94vh,1040px)] min-h-[720px] flex-col">
                <div className="absolute inset-0 opacity-60">
                  <div className="absolute -left-10 top-10 h-40 w-40 rounded-full bg-sky-200/40 blur-2xl" />
                  <div className="absolute right-10 top-20 h-56 w-56 rounded-full bg-indigo-200/35 blur-3xl" />
                  <div className="absolute left-1/2 top-1/2 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/35 blur-3xl" />
                </div>

              <div className="relative flex min-h-[340px] flex-1 items-start justify-center px-5 pb-10 pt-6 md:min-h-[420px] md:pb-12 md:pt-4">
                <button
                  type="button"
                  onClick={() => router.back()}
                  className="absolute left-5 top-5 flex h-14 w-14 items-center justify-center rounded-full bg-white/80 text-sky-500 shadow-md transition hover:bg-white"
                  aria-label="返回上一页"
                  title="返回"
                >
                  <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 12H8" />
                    <path d="m12 8-4 4 4 4" />
                  </svg>
                </button>

                <button
                  type="button"
                  className="absolute right-5 top-5 flex h-14 w-14 items-center justify-center rounded-full bg-white/80 text-sky-500 shadow-md transition hover:bg-white"
                  aria-label="放大"
                  title="放大"
                >
                  <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="6.5" />
                    <path d="M20 20 16.4 16.4" />
                    <path d="M11 8.5v5" />
                    <path d="M8.5 11h5" />
                  </svg>
                </button>

                <div className="flex w-full max-w-[917px] items-center justify-center">
                  <div className="aspect-video w-full">
                    {activeShadowView.kind === "single" ? (
                      <ShadowPage
                        url={
                          typeof activeShadowView.pages[0] === "number" && document
                            ? resolvedUrls[document.pageObjectKeys?.[activeShadowView.pages[0]] || ""] || ""
                            : ""
                        }
                        alt={`page-${activeShadowView.pages[0] + 1}`}
                        mode="single"
                      />
                    ) : (
                      <ShadowSpreadPage
                        leftUrl={
                          typeof activeShadowView.pages[0] === "number" && document
                            ? resolvedUrls[document.pageObjectKeys?.[activeShadowView.pages[0]] || ""] || ""
                            : null
                        }
                        rightUrl={
                          typeof activeShadowView.pages[1] === "number" && document
                            ? resolvedUrls[document.pageObjectKeys?.[activeShadowView.pages[1]] || ""] || ""
                            : null
                        }
                        alt={`spread-${typeof activeShadowView.pages[0] === "number" ? activeShadowView.pages[0] + 1 : "blank"}-${
                          typeof activeShadowView.pages[1] === "number" ? activeShadowView.pages[1] + 1 : "blank"
                        }`}
                      />
                    )}
                  </div>
                </div>

                <div className="absolute bottom-5 left-5 rounded-full bg-sky-500/70 px-5 py-2.5 text-base font-bold text-white shadow-lg shadow-sky-400/20 backdrop-blur">
                  {safeShadowViewIndex + 1}/{shadowViews.length}
                </div>

                <button
                  type="button"
                  onClick={() => router.push(`/tasks/${assignmentId}`)}
                  className="absolute bottom-5 right-5 rounded-full bg-sky-600/85 px-7 py-3.5 text-lg font-semibold text-white shadow-lg shadow-sky-500/25 backdrop-blur transition hover:bg-sky-600"
                >
                  完成
                </button>
              </div>

              <div className="relative mt-0 shrink-0 border-t border-white/45 bg-white/62 px-5 pb-4 pt-3 backdrop-blur">

                <div className="grid items-center gap-4 md:grid-cols-[64px_minmax(0,1fr)_64px]">
                  <button
                    type="button"
                    onClick={handleShadowPrev}
                    disabled={!canPrev}
                    className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-sky-500 shadow-md transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label="上一页"
                  >
                    <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m15 18-6-6 6-6" />
                    </svg>
                  </button>

                  <div className="min-w-0">
                    {activeShadowView.kind === "spread" || isSingleDualTextView ? (
                      <div className="grid gap-3 text-left sm:grid-cols-2">
                        {shouldMergeSpreadTextBox ? (
                          <div
                            role={hasShadowAudio ? "button" : undefined}
                            tabIndex={hasShadowAudio ? 0 : -1}
                            onClick={() => {
                              if (hasShadowAudio) {
                                handlePlayShadowAudio();
                              }
                            }}
                            onKeyDown={(event) => {
                              if (!hasShadowAudio) return;
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                handlePlayShadowAudio();
                              }
                            }}
                            className={`sm:col-span-2 rounded-2xl border border-sky-300 bg-white/85 px-5 py-4 text-center transition ${
                              hasShadowAudio ? "cursor-pointer hover:bg-white" : ""
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
                                if (!leftHasPlayableAudio || !currentShadowStep) return;
                                if (spreadFocus !== 0) {
                                  const targetIndex = shadowNavigationSteps.findIndex(
                                    (step) => step.viewIndex === safeShadowViewIndex && step.focus === 0
                                  );
                                  if (targetIndex >= 0) setPageIndex(targetIndex);
                                  return;
                                }
                                handlePlayShadowAudio();
                              }}
                              onKeyDown={(event) => {
                                if (!leftHasPlayableAudio) return;
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  if (spreadFocus !== 0) {
                                    const targetIndex = shadowNavigationSteps.findIndex(
                                      (step) => step.viewIndex === safeShadowViewIndex && step.focus === 0
                                    );
                                    if (targetIndex >= 0) setPageIndex(targetIndex);
                                  } else {
                                    handlePlayShadowAudio();
                                  }
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
                                if (!rightHasPlayableAudio || !currentShadowStep) return;
                                const targetIndex = shadowNavigationSteps.findIndex(
                                  (step) => step.viewIndex === safeShadowViewIndex && step.focus === 1
                                );
                                if (spreadFocus !== 1) {
                                  if (targetIndex >= 0) setPageIndex(targetIndex);
                                  return;
                                }
                                handlePlayShadowAudio();
                              }}
                              onKeyDown={(event) => {
                                if (!rightHasPlayableAudio) return;
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  const targetIndex = shadowNavigationSteps.findIndex(
                                    (step) => step.viewIndex === safeShadowViewIndex && step.focus === 1
                                  );
                                  if (spreadFocus !== 1) {
                                    if (targetIndex >= 0) setPageIndex(targetIndex);
                                  } else {
                                    handlePlayShadowAudio();
                                  }
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
                        role={hasShadowAudio ? "button" : undefined}
                        tabIndex={hasShadowAudio ? 0 : -1}
                        onClick={() => {
                          if (hasShadowAudio) {
                            handlePlayShadowAudio();
                          }
                        }}
                        onKeyDown={(event) => {
                          if (!hasShadowAudio) return;
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            handlePlayShadowAudio();
                          }
                        }}
                        className={`rounded-2xl border px-4 py-3 text-left transition ${
                          hasShadowAudio
                            ? "cursor-pointer border-sky-300 bg-white/85 hover:bg-white"
                            : "border-sky-200 bg-white/75"
                        }`}
                      >
                        <p className="text-center text-xs font-semibold uppercase tracking-[0.16em] text-sky-600">
                          Page Text
                        </p>
                        <p className="mt-1 text-center text-base leading-relaxed text-slate-900">
                          {leftText}
                        </p>
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={handleShadowNext}
                    disabled={!canNext}
                    className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-sky-500 shadow-md transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label="下一页"
                  >
                    <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m9 6 6 6-6 6" />
                    </svg>
                  </button>
                </div>

                <div className="mt-3 grid items-center gap-4 md:grid-cols-[72px_minmax(0,1fr)_150px]">
                  <button
                    type="button"
                    onClick={handlePlayShadowAudio}
                    disabled={!hasShadowAudio}
                    className={`flex h-14 w-14 items-center justify-center rounded-full shadow-md transition ${
                      hasShadowAudio
                        ? isPlayingShadowAudio
                          ? "bg-sky-600 text-white hover:bg-sky-700"
                          : "bg-white/80 text-sky-600 hover:bg-white"
                        : "cursor-not-allowed bg-slate-200 text-slate-400"
                    }`}
                    aria-label="播放当前页音频"
                    title={hasShadowAudio ? "播放当前页音频" : "当前页没有可播放音频"}
                  >
                    <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 10v4h3l4 3V7l-4 3H5Z" />
                      <path d="M16 9.5a4 4 0 0 1 0 5" />
                      <path d="M18.5 7a7 7 0 0 1 0 10" />
                    </svg>
                  </button>

                  <div className="text-center">
                    <p className="text-[1.47rem] font-semibold leading-[1.8] tracking-[0.01em] text-emerald-600 md:text-[1.875rem]">
                      {activeShadowText}
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                      已录 {recordedShadowCount}/{shadowRecordableSteps.length || 0} 句
                    </p>
                  </div>

                  <div className="flex items-end justify-end gap-3">
                    {(shadowAssessment || isSubmittingShadowScore) ? (
                      <div className="flex items-center justify-end gap-2">
                        {isSubmittingShadowScore ? (
                          <div className="rounded-2xl bg-sky-500 px-3 py-2 text-center text-white shadow-md">
                            <p className="text-sm font-semibold leading-none">评分中</p>
                            <p className="mt-1 text-xs font-semibold">整段录音</p>
                          </div>
                        ) : overallShadowScore !== null ? (
                          <div className="rounded-2xl bg-emerald-500 px-3 py-2 text-center text-white shadow-md">
                            <p className="text-2xl font-semibold leading-none">{overallShadowScore}</p>
                            <p className="mt-1 text-xs font-semibold">总评</p>
                          </div>
                        ) : null}

                        {shadowAssessment ? (
                          <button
                            type="button"
                            onClick={() => setIsShadowFeedbackOpen(true)}
                            className="rounded-2xl bg-white/90 px-4 py-2 text-sm font-semibold text-sky-700 shadow-md transition hover:bg-white"
                          >
                            点评
                          </button>
                        ) : null}
                      </div>
                    ) : null}

                    <button
                      type="button"
                      onClick={handleRecordShadowToggle}
                      disabled={!activeShadowText.trim()}
                      className={`flex h-16 w-16 items-center justify-center rounded-[1.8rem] shadow-lg transition ${
                        activeShadowText.trim()
                          ? isRecordingShadow
                            ? "bg-sky-600 text-white hover:bg-sky-700"
                            : "bg-white/85 text-sky-500 hover:bg-white"
                          : "cursor-not-allowed bg-slate-200 text-slate-400"
                      }`}
                      aria-label={isRecordingShadow ? "停止录音" : "开始录音"}
                      title={isRecordingShadow ? "点击停止录音" : "开始录音"}
                    >
                      <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="9" y="3.5" width="6" height="11" rx="3" />
                        <path d="M7 11.5a5 5 0 0 0 10 0" />
                        <path d="M12 16.5V20" />
                        <path d="M9 20h6" />
                      </svg>
                    </button>
                  </div>
                </div>

                {shadowScoreError ? (
                  <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50/80 px-4 py-3 text-sm text-rose-600">
                    {shadowScoreError}
                  </div>
                ) : null}
              </div>
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(186,230,253,0.85),_rgba(239,246,255,0.98)_45%,_white_100%)]">
      <div className="mx-auto flex min-h-screen max-w-[1500px] flex-col px-4 py-3 md:px-6">
        <div
          className={`relative flex flex-1 flex-col overflow-hidden ${
            resolvedTaskMode === "performance"
              ? "rounded-[2rem]"
              : "rounded-[1.6rem] bg-white/72 shadow-[0_18px_60px_rgba(148,163,184,0.16)] backdrop-blur"
          }`}
        >
          {resolvedTaskMode !== "performance" ? (
            <button
              type="button"
              onClick={() => router.back()}
              className="absolute left-3 top-3 z-20 grid h-10 w-10 place-items-center rounded-full bg-white/96 text-xl font-semibold text-slate-500 ring-1 ring-sky-100 transition hover:bg-sky-50"
              aria-label="返回上一页"
              title="返回"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 12H8" />
                <path d="m12 8-4 4 4 4" />
              </svg>
            </button>
          ) : null}

          <div className={resolvedTaskMode === "performance" ? "px-0 py-0" : "bg-white/88 px-4 py-3 md:px-5"}>
            <div className="mx-auto max-w-[1180px]">
              {resolvedTaskMode === "performance" ? (
                <div className="mt-2">
                  <PerformanceTaskPreview
                    document={document}
                    config={
                      document.performanceConfig ||
                      buildDefaultStoryflowPerformanceConfig(document.analysis)
                    }
                    coverImageUrl={coverImageUrl}
                    teacherName={assignment.teacherDisplayName}
                    studentName={assignment.studentDisplayName}
                    variant="student"
                    onExit={() => router.back()}
                  />
                </div>
              ) : (
                <div className="mt-2 rounded-[1.25rem] border border-sky-100 bg-white p-3 shadow-sm">
                  {resolvedTaskMode === "mindmap" ? (
                    <div className="grid gap-3 lg:grid-cols-[0.95fr_1.05fr]">
                      <div className="space-y-3">
                        <div className="rounded-[1.1rem] bg-slate-50 px-4 py-3">
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                            故事概要
                          </p>
                          <p className="mt-2 text-sm leading-7 text-slate-700">
                            {document.analysis.summary || "老师还没有填写故事概要。"}
                          </p>
                        </div>

                        {storyCharacters.length || storySetting || storyKeywords.length ? (
                          <div className="rounded-[1.1rem] bg-slate-50 px-4 py-3">
                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                              复述线索
                            </p>
                            {storyCharacters.length ? (
                              <p className="mt-2 text-sm text-slate-700">
                                人物：{storyCharacters.join(" / ")}
                              </p>
                            ) : null}
                            {storySetting ? (
                              <p className="mt-2 text-sm text-slate-700">
                                场景：{storySetting}
                              </p>
                            ) : null}
                            {storyKeywords.length ? (
                              <div className="mt-3 flex flex-wrap gap-2">
                                {storyKeywords.map((item) => (
                                  <span
                                    key={item}
                                    className="rounded-full bg-sky-50 px-3 py-1.5 text-xs font-bold text-sky-700"
                                  >
                                    {item}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>

                      <div className="grid gap-2.5 md:grid-cols-3">
                        {([
                          ["Beginning", document.analysis.mindMap?.beginning || []],
                          ["Middle", document.analysis.mindMap?.middle || []],
                          ["End", document.analysis.mindMap?.end || []],
                        ] as Array<[string, string[]]>).map(([title, items]) => (
                          <div key={title} className="rounded-[1.1rem] bg-sky-50 px-4 py-3">
                            <p className="text-sm font-semibold uppercase tracking-[0.12em] text-sky-700">
                              {title}
                            </p>
                            <div className="mt-2.5 space-y-2">
                              {items.length ? (
                                items.map((item, index) => (
                                  <div
                                    key={`${title}_${index}`}
                                    className="rounded-2xl bg-white px-3 py-2 text-sm leading-6 text-slate-700 shadow-sm"
                                  >
                                    {item}
                                  </div>
                                ))
                              ) : (
                                <div className="rounded-2xl bg-white px-3 py-2 text-sm leading-6 text-slate-400 shadow-sm">
                                  暂无内容
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {resolvedTaskMode === "assessment" ? (
                    <div className="grid gap-3 md:grid-cols-3">
                      {assessmentCards.map((item) => (
                        <div
                          key={item.label}
                          className="rounded-[1.1rem] border border-sky-100 bg-slate-50 px-4 py-3"
                        >
                          <p className="text-sm font-semibold text-slate-900">{item.label}</p>
                          <p className="mt-2.5 text-sm leading-7 text-slate-700">
                            {item.assessment?.overallComment || "老师还没有填写这部分点评。"}
                          </p>
                          {item.note ? (
                            <div className="mt-3 rounded-xl bg-white px-3 py-3 text-sm leading-6 text-slate-700 shadow-sm">
                              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                                老师补充点评
                              </p>
                              <p className="mt-2 whitespace-pre-line">{item.note}</p>
                            </div>
                          ) : null}
                          {item.assessment?.suggestions?.length ? (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {item.assessment.suggestions.slice(0, 3).map((suggestion, index) => (
                                <span
                                  key={`${item.label}_${index}`}
                                  className="rounded-full bg-white px-3 py-1.5 text-xs font-bold text-sky-700 shadow-sm"
                                >
                                  {suggestion}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

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

  const leftAlignClass = leftUrl ? (rightUrl ? "justify-end" : "justify-center") : "justify-center";
  const rightAlignClass = rightUrl ? (leftUrl ? "justify-start" : "justify-center") : "justify-center";
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

export default StoryflowTaskPlayer;
