"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { SessionUser } from "@/lib/clientAuth";
import {
  getTeacherStoryflowDocuments,
  hydrateAccessibleTeacherStoryflowDocuments,
  type StoryflowAnalysis,
  type StoryflowAiAnimation,
  type StoryflowCustomView,
  type StoryflowPageAudioSegmentSlot,
  type StoryflowSpeakingPracticeRecord,
  type StoryflowVoiceSubtitleRecord,
  updateTeacherStoryflowDocument,
} from "@/lib/storyflowStore";
import {
  getStoryflowAssignmentById,
  hydrateStoryflowAssignmentById,
  type StoryflowAssignment,
  updateStoryflowAssignment,
} from "@/lib/storyflowAssignments";
import {
  agentLessonFlowPrompt,
  formatAgentLessonStatePrompt,
  type AgentLessonStep,
  type AgentLessonState,
} from "@/lib/agentLessonFlow";
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

type TaskMode = "animation" | "intensive" | "shadow" | "speaking" | "assessment";

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

type AiCoachMessage = {
  id: string;
  role: "student" | "coach";
  text: string;
  createdAt?: number;
};

type RtcAgentSession = {
  appId: string;
  roomId: string;
  userId: string;
  agentUserId: string;
  taskId: string;
  token: string;
};

type LocalStudentSpeechRecognitionResult = {
  isFinal: boolean;
  0?: {
    transcript?: string;
  };
};

type LocalStudentSpeechRecognitionEvent = {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: LocalStudentSpeechRecognitionResult;
  };
};

type LocalStudentSpeechRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: LocalStudentSpeechRecognitionEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort?: () => void;
};

type LocalStudentSpeechRecognitionConstructor = new () => LocalStudentSpeechRecognition;

type CoachRtcEngine = {
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  joinRoom: (
    token: string,
    roomId: string,
    userInfo: { userId: string },
    roomConfig?: Record<string, unknown>
  ) => Promise<void>;
  startAudioCapture: () => Promise<unknown>;
  stopAudioCapture?: () => Promise<void>;
  publishStream: (mediaType: number) => Promise<void>;
  unpublishStream?: (mediaType: number) => Promise<void>;
  setVideoSourceType?: (index: number, videoSourceType: number) => Promise<void>;
  setExternalVideoTrack?: (index: number, track: MediaStreamTrack) => Promise<void>;
  subscribeStream: (userId: string, mediaType: number) => Promise<void>;
  play: (userId?: string, mediaType?: number) => Promise<void>;
  startSubtitle?: (config: { mode: number }) => Promise<void>;
  stopSubtitle?: () => Promise<void> | void;
  leaveRoom?: () => Promise<void>;
  destroy?: () => Promise<void> | void;
};

type CoachPanelPosition = {
  x: number;
  y: number;
};

const COACH_PANEL_MARGIN = 16;
const COACH_PANEL_MAX_WIDTH = 390;
const COACH_OPEN_PANEL_HEIGHT_ESTIMATE = 620;
const COACH_CLOSED_PANEL_HEIGHT_ESTIMATE = 72;

const getCoachPanelMetrics = (isOpen: boolean) => {
  if (typeof window === "undefined") {
    return {
      width: COACH_PANEL_MAX_WIDTH,
      height: isOpen ? COACH_OPEN_PANEL_HEIGHT_ESTIMATE : COACH_CLOSED_PANEL_HEIGHT_ESTIMATE,
    };
  }

  return {
    width: Math.min(COACH_PANEL_MAX_WIDTH, Math.max(260, window.innerWidth - COACH_PANEL_MARGIN * 2)),
    height: Math.min(
      isOpen ? COACH_OPEN_PANEL_HEIGHT_ESTIMATE : COACH_CLOSED_PANEL_HEIGHT_ESTIMATE,
      Math.max(COACH_CLOSED_PANEL_HEIGHT_ESTIMATE, window.innerHeight - COACH_PANEL_MARGIN * 2)
    ),
  };
};

const clampCoachPanelPosition = (position: CoachPanelPosition, isOpen: boolean): CoachPanelPosition => {
  if (typeof window === "undefined") return position;

  const { width, height } = getCoachPanelMetrics(isOpen);
  const maxX = Math.max(COACH_PANEL_MARGIN, window.innerWidth - width - COACH_PANEL_MARGIN);
  const maxY = Math.max(COACH_PANEL_MARGIN, window.innerHeight - height - COACH_PANEL_MARGIN);

  return {
    x: Math.max(COACH_PANEL_MARGIN, Math.min(maxX, position.x)),
    y: Math.max(COACH_PANEL_MARGIN, Math.min(maxY, position.y)),
  };
};

const getRightMiddleCoachPanelPosition = (isOpen: boolean): CoachPanelPosition => {
  if (typeof window === "undefined") return { x: 20, y: 160 };

  const { height } = getCoachPanelMetrics(isOpen);
  return clampCoachPanelPosition(
    {
      x: 20,
      y: Math.round((window.innerHeight - height) / 2),
    },
    isOpen
  );
};

type AiTeachingContext = {
  currentPageText: string;
  previousPageText: string;
  nextPageText: string;
  allPageTexts: Array<{
    pageLabel: string;
    text: string;
  }>;
  visibleToStudent: "image_only" | "hint" | "original";
  instruction: string;
};

type AiCoachHistoryItem = {
  role: "student" | "coach";
  text: string;
};

type AiCoachUiAction =
  | "show_hint"
  | "show_original"
  | "finish_practice";

type AiCoachPendingAction = {
  action: "show_original" | "finish_practice";
  label: string;
  createdAt: number;
};

const SHADOW_RTC_WELCOME_MESSAGES = [
  "跟着原音一句一句读，模仿发音、语调和节奏。",
  "我们来做影子跟读：先听原音，再一句一句跟读，尽量模仿它的发音和节奏。",
  "影子跟读开始啦。你跟着原音读，我会帮你看发音、流畅度和读错的地方。",
];

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

const normalizeAiContextText = (value: string, maxLength = 900) => {
  const normalized = normalizeStoryText(value || "");
  return normalized.length > maxLength ? normalized.slice(0, maxLength).trim() : normalized;
};

const splitShadowReadingSentences = (value: string) => {
  const normalized = normalizeStoryText(value);
  if (!normalized) return [];
  const sentenceMatches = normalized.match(/[^.!?。！？]+[.!?。！？]+(?:["'”’])?/gu);
  if (!sentenceMatches?.length) return [normalized];
  const sentences = sentenceMatches.map((item) => item.trim()).filter(Boolean);
  const matchedLength = sentenceMatches.join("").length;
  const remainder = normalized.slice(matchedLength).trim();
  return remainder ? [...sentences, remainder] : sentences;
};

const normalizeCoachRtcTranscriptComparisonText = (value: string) =>
  normalizeAiContextText(value, 1200)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");

const INCOMPLETE_STUDENT_TRANSCRIPT_ENDINGS = new Set([
  "because",
  "of",
  "that",
  "and",
  "but",
  "so",
  "to",
  "for",
  "with",
  "in",
  "on",
  "at",
  "by",
  "from",
  "as",
  "is",
  "are",
  "was",
  "were",
  "has",
  "have",
  "had",
]);

function findCoachRtcTranscriptWordOverlap(leftWords: string[], rightWords: string[]) {
  const maxOverlap = Math.min(10, leftWords.length, rightWords.length);
  for (let size = maxOverlap; size > 0; size -= 1) {
    const leftTail = normalizeCoachRtcTranscriptComparisonText(leftWords.slice(-size).join(" "));
    const rightHead = normalizeCoachRtcTranscriptComparisonText(rightWords.slice(0, size).join(" "));
    if (leftTail && leftTail === rightHead) return size;
  }
  return 0;
}

function isSimilarCoachRtcTranscriptToken(leftToken: string, rightToken: string) {
  const left = normalizeCoachRtcTranscriptComparisonText(leftToken);
  const right = normalizeCoachRtcTranscriptComparisonText(rightToken);
  if (!left || !right) return false;
  if (left === right) return true;
  const lengthDiff = Math.abs(left.length - right.length);
  return lengthDiff <= 2 && (left.startsWith(right) || right.startsWith(left));
}

function isLikelyCoachRtcTranscriptRewrite(leftWords: string[], rightWords: string[]) {
  const leftTokens = leftWords.filter(Boolean);
  const rightTokens = rightWords.filter(Boolean);
  const shorterLength = Math.min(leftTokens.length, rightTokens.length);
  const longerLength = Math.max(leftTokens.length, rightTokens.length);
  if (shorterLength < 3 || longerLength / shorterLength > 1.35) return false;

  const unmatchedRightTokens = [...rightTokens];
  let matchedTokenCount = 0;
  leftTokens.forEach((leftToken) => {
    const matchIndex = unmatchedRightTokens.findIndex((rightToken) =>
      isSimilarCoachRtcTranscriptToken(leftToken, rightToken)
    );
    if (matchIndex < 0) return;
    matchedTokenCount += 1;
    unmatchedRightTokens.splice(matchIndex, 1);
  });

  const coverage = matchedTokenCount / shorterLength;
  return coverage >= 0.72;
}

function mergeCoachRtcTranscriptText(currentText: string, nextText: string) {
  const current = normalizeAiContextText(currentText, 1200);
  const next = normalizeAiContextText(nextText, 1200);
  if (!current) return next;
  if (!next) return current;

  const currentCompare = normalizeCoachRtcTranscriptComparisonText(current);
  const nextCompare = normalizeCoachRtcTranscriptComparisonText(next);
  if (!currentCompare || !nextCompare || currentCompare === nextCompare) return current;
  if (nextCompare.includes(currentCompare)) return next;
  if (currentCompare.includes(nextCompare)) return current;

  const currentWords = current.split(/\s+/).filter(Boolean);
  const nextWords = next.split(/\s+/).filter(Boolean);
  const directOverlap = findCoachRtcTranscriptWordOverlap(currentWords, nextWords);
  if (directOverlap > 0) {
    return normalizeStoryText([current, nextWords.slice(directOverlap).join(" ")].filter(Boolean).join(" "));
  }

  if (isLikelyCoachRtcTranscriptRewrite(currentWords, nextWords)) {
    return next.length >= current.length ? next : current;
  }

  if (isLikelyTranscriptContinuation(current, next)) {
    return normalizeStoryText([current, next].filter(Boolean).join(" "));
  }

  if (currentWords.length >= 3 && nextWords.length >= 2) {
    return normalizeStoryText([current, next].filter(Boolean).join(" "));
  }

  return next.length >= current.length ? next : current;
}

function isIncompleteStudentTranscriptEnding(words: string[], currentText: string) {
  if (/[.!?。！？]$/.test(currentText.trim())) return false;
  const lastWord = words.at(-1)?.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "") || "";
  const previousWord = words.at(-2)?.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "") || "";
  return (
    INCOMPLETE_STUDENT_TRANSCRIPT_ENDINGS.has(lastWord) ||
    (previousWord === "because" && lastWord === "of")
  );
}

function isLikelyTranscriptContinuation(currentText: string, nextText: string) {
  const currentWords = normalizeStoryText(currentText).split(/\s+/).filter(Boolean);
  const nextWords = normalizeStoryText(nextText).split(/\s+/).filter(Boolean);
  if (currentWords.length < 2 || nextWords.length < 2) return false;

  const maxOverlap = Math.min(8, currentWords.length, nextWords.length);
  for (let size = maxOverlap; size > 0; size -= 1) {
    const currentTail = normalizeCoachRtcTranscriptComparisonText(currentWords.slice(-size).join(" "));
    const nextHead = normalizeCoachRtcTranscriptComparisonText(nextWords.slice(0, size).join(" "));
    if (currentTail && currentTail === nextHead) return true;
  }

  if (isIncompleteStudentTranscriptEnding(currentWords, currentText)) return true;

  const nextOpening = nextWords[0]?.toLowerCase() || "";
  const continuationOpenings = new Set([
    "and",
    "then",
    "but",
    "so",
    "because",
    "he",
    "she",
    "it",
    "they",
    "there",
    "this",
    "that",
    "his",
    "her",
    "the",
    "a",
    "an",
  ]);

  return /[.!?。！？,，]$/.test(currentText.trim()) && continuationOpenings.has(nextOpening);
}

const isVoiceSubtitleMessage = (message: AiCoachMessage) =>
  message.id.startsWith("rtc_subtitle_") || message.id.startsWith("rts_subtitle_");

const normalizeCoachIntentText = (value: string) =>
  value
    .replace(/[。！？!?,，.\s]/g, "")
    .trim()
    .toLowerCase();

const isCoachAskingForNextPage = (value: string) =>
  /下一页|下页|翻页|往后|接着看|继续看|next\s*page|move\s*on/i.test(value);

const isStudentAgreeingToNextPage = (value: string) => {
  const normalized = normalizeCoachIntentText(value);
  if (!normalized) return false;
  return [
    "好",
    "好的",
    "可以",
    "行",
    "嗯",
    "恩",
    "对",
    "是",
    "ok",
    "okay",
    "yes",
    "yeah",
    "sure",
    "next",
    "下一页",
    "翻页",
  ].includes(normalized);
};

const isStudentConfirmingCoachAction = (value: string) => {
  const normalized = normalizeCoachIntentText(value);
  if (!normalized) return false;
  return [
    "好",
    "好的",
    "可以",
    "行",
    "嗯",
    "恩",
    "对",
    "是",
    "要",
    "看",
    "打开",
    "显示",
    "看答案",
    "显示原文",
    "打开原文",
    "ok",
    "okay",
    "yes",
    "yeah",
    "sure",
  ].includes(normalized);
};

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

const splitShadowPageTextByMode = (value: string, isPairMode: boolean) => {
  const normalized = value.replace(/\r\n?/g, "\n").trim();
  if (!isPairMode) {
    return {
      leftText: normalized,
      rightText: "",
    };
  }

  const markerMatch = normalized.match(/\[RIGHT_PAGE\]/i);
  if (markerMatch && typeof markerMatch.index === "number") {
    return {
      leftText: normalized.slice(0, markerMatch.index).trim(),
      rightText: normalized.slice(markerMatch.index + markerMatch[0].length).trim(),
    };
  }

  const slashIndex = normalized.search(/[／/]/);
  if (slashIndex >= 0) {
    return {
      leftText: normalized.slice(0, slashIndex).trim(),
      rightText: normalized.slice(slashIndex + 1).trim(),
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
    leftText: normalized,
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

const formatIntensivePageSegments = (page?: StudentPracticePage | null) => {
  const text = page?.visibleText || "";
  if (!text.trim()) return "";
  const { leftText, rightText } = splitDualPageText(text);
  if (leftText && rightText) {
    return [`左页：${leftText}`, `右页：${rightText}`].join("\n");
  }
  return `单页：${text.trim()}`;
};

const getShadowStepText = (rawText: string, focus: 0 | 1, isPairMode = false) => {
  const { leftText, rightText } = splitShadowPageTextByMode(rawText, isPairMode);
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
  return Array.from({ length: totalPages }, (_, pageIndex) => ({
    kind: "single" as const,
    pages: [pageIndex] as [number],
  }));
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

const getStoryflowAnimationList = (document: {
  aiAnimations?: StoryflowAiAnimation[];
  aiAnimation?: StoryflowAiAnimation | null;
}) =>
  (document.aiAnimations?.length
    ? document.aiAnimations
    : document.aiAnimation
      ? [document.aiAnimation]
      : []
  ).slice(0, 2);

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
  const validObjectKeys = objectKeys.filter(
    (item) => typeof item === "string" && item.trim().length > 0
  );

  if (!validObjectKeys.length) {
    return {};
  }

  const response = await fetch("/api/storyflow/urls", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ objectKeys: validObjectKeys }),
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

const getStoryflowFileProxyUrl = (objectKey?: string | null) =>
  objectKey ? `/api/storyflow/file?key=${encodeURIComponent(objectKey)}` : "";

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
    key: "animation",
    label: "动画伴读",
    title: "动画伴读",
    description: "观看老师上传的绘本动画片，先整体感受故事。",
  },
  {
    key: "intensive",
    label: "绘本精讲",
    title: "绘本精讲",
    description: "AI 老师看着老师上传的绘本资料，逐页讲解、提问和巩固。",
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
    | "animation"
    | "intensive"
    | "mindmap"
    | "shadow"
    | "speaking"
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
  if (kind === "animation") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3.5" y="5" width="17" height="14" rx="3" />
        <path d="m10 9 5 3-5 3V9Z" fill="currentColor" stroke="none" />
        <path d="M7 3.5v3" />
        <path d="M17 3.5v3" />
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
  if (kind === "intensive") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 4.5h6.5a3 3 0 0 1 3 3v12a3 3 0 0 0-3-3H5V4.5Z" />
        <path d="M19 4.5h-4.5v12H19V4.5Z" />
        <path d="M8 8h3" />
        <path d="M8 11h3" />
        <path d="M16 8h1" />
        <path d="M16 11h1" />
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
  const [taskMode, setTaskMode] = useState<TaskMode>("animation");
  const [isPlayingShadowAudio, setIsPlayingShadowAudio] = useState(false);
  const [isRecordingShadow, setIsRecordingShadow] = useState(false);
  const [recordedShadowClips, setRecordedShadowClips] = useState<Record<string, ShadowRecordingClip>>({});
  const [shadowAssessment, setShadowAssessment] = useState<AnalysisResult | null>(null);
  const [isSubmittingShadowScore, setIsSubmittingShadowScore] = useState(false);
  const [shadowScoreError, setShadowScoreError] = useState<string | null>(null);
  const [isShadowFeedbackOpen, setIsShadowFeedbackOpen] = useState(false);
  const [practiceStatus, setPracticeStatus] = useState<"idle" | "active">("idle");
  const [practiceDraft, setPracticeDraft] = useState<SpeakingPracticeDraft | null>(null);
  const [speakingPracticeRecords, setSpeakingPracticeRecords] = useState<StoryflowSpeakingPracticeRecord[]>([]);
  const [isGeneratingSpeakingAssessment, setIsGeneratingSpeakingAssessment] = useState(false);
  const [speakingAssessmentError, setSpeakingAssessmentError] = useState<string | null>(null);
  const [isCoachOpen, setIsCoachOpen] = useState(false);
  const [isCoachSessionActive, setIsCoachSessionActive] = useState(false);
  const [isCoachListening, setIsCoachListening] = useState(false);
  const [isCoachThinking, setIsCoachThinking] = useState(false);
  const [isCoachSpeaking, setIsCoachSpeaking] = useState(false);
  const isCoachScreenShared = true;
  const [coachInputText, setCoachInputText] = useState("");
  const [coachInterimText, setCoachInterimText] = useState("");
  const [coachError, setCoachError] = useState<string | null>(null);
  const [coachPanelPosition, setCoachPanelPosition] = useState<CoachPanelPosition>({ x: 20, y: 160 });
  const [pendingCoachAction, setPendingCoachAction] = useState<AiCoachPendingAction | null>(null);
  const [intensiveLessonStep, setIntensiveLessonStep] = useState<AgentLessonStep>("intro");
  const [coachMessages, setCoachMessages] = useState<AiCoachMessage[]>([
    {
      id: "coach_welcome",
      role: "coach",
      text: "我会看着当前绘本页陪你练习。点一次语音按钮后，可以连续和我说话；我会自动按中英文混合来听。",
    },
  ]);
  const coachMessagesRef = useRef<AiCoachMessage[]>(coachMessages);
  const shadowAudioRef = useRef<HTMLAudioElement | null>(null);
  const shadowAudioCleanupRef = useRef<(() => void) | null>(null);
  const shadowAudioTokenRef = useRef(0);
  const lastShadowAutoPlayKeyRef = useRef<string | null>(null);
  const lastSubmittedShadowSignatureRef = useRef<string | null>(null);
  const lastCoachRtcTaskModeRef = useRef<TaskMode | null>(null);
  const hasIntroducedShadowRtcRulesRef = useRef(false);
  const hasIntroducedIntensiveRtcRulesRef = useRef(false);
  const intensiveLessonStepRef = useRef<AgentLessonStep>("intro");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordingStartMsRef = useRef<number>(0);
  const coachCaptureRef = useRef<HTMLDivElement | null>(null);
  const coachSessionActiveRef = useRef(false);
  const coachManualStopRef = useRef(false);
  const coachRtcLifecycleTokenRef = useRef(0);
  const coachRtcPageChangeTokenRef = useRef(0);
  const coachRequestInFlightRef = useRef(false);
  const coachLatestRequestPayloadRef = useRef<Record<string, unknown> | null>(null);
  const coachConversationScrollRef = useRef<HTMLDivElement | null>(null);
  const coachRtcEngineRef = useRef<CoachRtcEngine | null>(null);
  const coachRtcAgentSessionRef = useRef<RtcAgentSession | null>(null);
  const coachRtcStartedRef = useRef(false);
  const coachRtcStartInFlightRef = useRef(false);
  const coachRtcVisualCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const coachRtcVisualStreamRef = useRef<MediaStream | null>(null);
  const coachRtcTranscriptIdsRef = useRef<Set<string>>(new Set());
  const coachRtcLiveTranscriptIdsRef = useRef<Record<string, { id: string; text: string; at: number }>>({});
  const coachRtcRecentTranscriptRef = useRef<Record<string, { id: string; text: string; at: number }>>({});
  const coachRtcShadowAudioMutedRef = useRef(false);
  const coachRemoteAudioActiveUntilRef = useRef(0);
  const coachRemoteAudioClearTimerRef = useRef<number | null>(null);
  const coachExpectedSpeechRef = useRef("");
  const coachRecentSpeechEchoTextsRef = useRef<string[]>([]);
  const localStudentSpeechRecognitionRef = useRef<LocalStudentSpeechRecognition | null>(null);
  const localStudentSpeechRestartTimerRef = useRef<number | null>(null);
  const localStudentSpeechShouldRunRef = useRef(false);
  const localStudentSpeechLangRef = useRef("");
  const localStudentSpeechSequenceRef = useRef(0);
  const coachShadowPromptTimerRef = useRef<number | null>(null);
  const coachShadowPromptKeyRef = useRef("");
  const animationVideoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const coachLatestNavigationRef = useRef<{
    canNext: boolean;
    mode: TaskMode;
    pagesLength: number;
    shadowStepsLength: number;
  }>({
    canNext: false,
    mode: "speaking",
    pagesLength: 0,
    shadowStepsLength: 0,
  });
  const coachDragRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

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
    setTaskMode(forcedTaskMode || "animation");
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
    setPracticeDraft(null);
    setSpeakingAssessmentError(null);
  }, [assignmentId, assignment?.shadowSubmission, document?.assessments?.shadow, forcedTaskMode]);

  useEffect(() => {
    if (!document) return;
    const objectKeys = Array.from(
      new Set(
        [
          ...(document.pageObjectKeys || []),
          ...((document.shadowAudio?.tracks || []).map((item) => item.objectKey)),
          ...getStoryflowAnimationList(document).map((animation) => animation.objectKey),
        ].filter((item) => typeof item === "string" && item.trim().length > 0)
      )
    );

    if (!objectKeys.length) {
      setResolvedUrls({});
      return;
    }

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
      stopCoachSession();
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
  const shadowPairEditorModeByPage = useMemo(() => {
    const persisted = new Set(document?.pairEditorModePages || []);
    return Array.from({ length: shadowTotalPages }, (_, pageIdx) => pageIdx).reduce<Record<number, boolean>>(
      (result, pageIdx) => {
        if (persisted.has(pageIdx)) {
          result[pageIdx] = true;
        }
        return result;
      },
      {}
    );
  }, [document?.pairEditorModePages, shadowTotalPages]);
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
              const isPairMode = Boolean(shadowPairEditorModeByPage[pageIndex]);
              const { leftText, rightText } = splitShadowPageTextByMode(pageText, isPairMode);
              if (isPairMode) {
                const steps = [
                  leftText.trim() ? { viewIndex: index, focus: 0 as const, pageIndex } : null,
                  rightText.trim() ? { viewIndex: index, focus: 1 as const, pageIndex } : null,
                ].filter((step): step is ShadowNavigationStep => Boolean(step));
                if (steps.length) return steps;
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
    [document, shadowPairEditorModeByPage, shadowTexts, shadowViews]
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
  const singlePageIsPairMode =
    activeShadowView.kind === "single" &&
    typeof activeShadowView.pages[0] === "number" &&
    Boolean(shadowPairEditorModeByPage[activeShadowView.pages[0]]);
  const singlePageTextParts = splitShadowPageTextByMode(singlePageText, singlePageIsPairMode);
  const isSingleDualTextView =
    activeShadowView.kind === "single" &&
    singlePageIsPairMode &&
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
        step.focus,
        Boolean(shadowPairEditorModeByPage[step.pageIndex])
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
        getStoryflowFileProxyUrl(document.pageObjectKeys?.[page.pageIndex])
      : "";
  const getDocumentPageImageUrl = (pageIndex?: number | null) => {
    if (!document || typeof pageIndex !== "number") return "";
    const localImage = document.images?.[pageIndex];
    if (isDisplayUrl(localImage)) return localImage || "";
    return getStoryflowFileProxyUrl(document.pageObjectKeys?.[pageIndex]);
  };
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
  const currentSpeakingSubmission = assignment?.speakingSubmission || null;
  const storySetting = [document?.analysis.setting?.time, document?.analysis.setting?.place]
    .filter(Boolean)
    .join(" · ");
  const coverImageUrl =
    (isDisplayUrl(document?.images?.[0]) ? document?.images?.[0] || "" : "") ||
    getStoryflowFileProxyUrl(document?.pageObjectKeys?.[0] || document?.thumbnailObjectKey);
  const animationVideos = document
    ? getStoryflowAnimationList(document).map((animation) => ({
        animation,
        url: resolvedUrls[animation.objectKey] || "",
      }))
    : [];
  const openAnimationFullscreen = async (objectKey: string) => {
    const video = animationVideoRefs.current[objectKey] as
      | (HTMLVideoElement & {
          webkitEnterFullscreen?: () => void;
          webkitRequestFullscreen?: () => Promise<void> | void;
        })
      | null;
    if (!video) return;

    try {
      if (video.requestFullscreen) {
        await video.requestFullscreen();
      } else if (video.webkitRequestFullscreen) {
        await video.webkitRequestFullscreen();
      } else if (video.webkitEnterFullscreen) {
        video.webkitEnterFullscreen();
      }
      await video.play().catch(() => undefined);
    } catch {
      await video.play().catch(() => undefined);
    }
  };
  const practiceRecords = speakingPracticeRecords;
  const formatAssessmentTime = (timestamp?: number) => {
    if (!timestamp) return "暂无";
    const value = new Date(timestamp);
    return `${value.getMonth() + 1}/${value.getDate()} ${value
      .getHours()
      .toString()
      .padStart(2, "0")}:${value.getMinutes().toString().padStart(2, "0")}`;
  };
  const getAssessmentAverageScore = (assessment?: AnalysisResult | null) =>
    assessment
      ? Math.round(
          (assessment.fluency.score +
            assessment.pronunciation.score +
            assessment.intonation.score +
            assessment.vocabulary.score +
            assessment.emotion.score) /
            5
        )
      : null;
  const buildProblemRecords = (
    assessment: AnalysisResult | null | undefined,
    voiceSubtitles: StoryflowVoiceSubtitleRecord[] = []
  ) => {
    const problemTexts = [
      assessment?.pronunciation.comment,
      assessment?.fluency.comment,
      assessment?.intonation.comment,
      assessment?.grammarSummary,
      ...(assessment?.suggestions || []),
      ...voiceSubtitles
        .filter((item) => item.role === "coach")
        .map((item) => item.text)
        .filter((text) => /错|问题|注意|发音|流畅|重音|再读|不准|漏|提示|建议/.test(text)),
    ]
      .map((item) => normalizeAiContextText(item || "", 180))
      .filter(Boolean);
    return Array.from(new Set(problemTexts)).slice(0, 6);
  };
  const latestSpeakingRecord =
    currentSpeakingSubmission?.latestPracticeRecord || practiceRecords[0] || null;
  const shadowVoiceSubtitles = currentShadowSubmission?.voiceSubtitles || [];
  const speakingVoiceSubtitles = latestSpeakingRecord?.voiceSubtitles || [];
  const assessmentCards = [
    {
      label: "影子跟读",
      assessment:
        currentShadowSubmission?.teacherAssessment ||
        currentShadowSubmission?.studentAssessment ||
        document?.assessments?.shadow,
      note: currentShadowSubmission?.teacherNote || "",
      status: currentShadowSubmission ? "已完成" : "未完成",
      summary: currentShadowSubmission
        ? `录音 ${currentShadowSubmission.clipCount || 0} 段 · 用时 ${Math.round(currentShadowSubmission.durationSec || 0)} 秒`
        : "完成影子跟读后，这里会自动显示录音评分、字幕和问题记录。",
      completedAt: currentShadowSubmission?.completedAt,
      practiceCount: currentShadowSubmission ? 1 : 0,
      voiceSubtitles: shadowVoiceSubtitles,
      problemRecords: buildProblemRecords(
        currentShadowSubmission?.teacherAssessment ||
          currentShadowSubmission?.studentAssessment ||
          document?.assessments?.shadow,
        shadowVoiceSubtitles
      ),
      problemLabel: "问题记录",
    },
    {
      label: "看图说话",
      assessment:
        currentSpeakingSubmission?.teacherAssessment ||
        currentSpeakingSubmission?.studentAssessment ||
        document?.assessments?.speaking,
      note: currentSpeakingSubmission?.teacherNote || "",
      status: latestSpeakingRecord ? "已完成" : "未完成",
      summary: latestSpeakingRecord
        ? `练习 ${latestSpeakingRecord.practicedPages}/${latestSpeakingRecord.totalPages} 页 · 提示 ${latestSpeakingRecord.promptRevealCount} 次 · 原文 ${latestSpeakingRecord.originalRevealCount} 次`
        : "完成看图说话后，这里会自动显示 AI 点评、提示使用情况、字幕和问题记录。",
      completedAt: currentSpeakingSubmission?.completedAt || latestSpeakingRecord?.createdAt,
      practiceCount: practiceRecords.length,
      voiceSubtitles: speakingVoiceSubtitles,
      problemRecords: buildProblemRecords(
        currentSpeakingSubmission?.teacherAssessment ||
          currentSpeakingSubmission?.studentAssessment ||
          document?.assessments?.speaking,
        speakingVoiceSubtitles
      ),
      problemLabel: "问题记录",
    },
  ];
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
            const segmentFocus: 0 | 1 = segment.slot === "right" ? 1 : 0;
            const sourceText = getDisplayPageText(
              document.analysis.title,
              sourcePageIndex,
              document.analysis.shadowPageTexts?.[sourcePageIndex] || practicePage.visibleText
            );
            return {
              pageIndex: sourcePageIndex,
              slot: segment.slot,
              text: normalizeStoryText(
                getShadowStepText(
                  sourceText,
                  segmentFocus,
                  Boolean(shadowPairEditorModeByPage[sourcePageIndex])
                )
              ),
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
  const displayPromptText = showOriginalText ? page?.visibleText || "" : speakingPromptText;
  const displayPromptParts = splitDualPageText(displayPromptText);
  const hasDualDisplayPrompt = Boolean(
    displayPromptParts.leftText.trim() && displayPromptParts.rightText.trim()
  );
  const speakingStoryTitle =
    document?.analysis.title?.trim() || assignment?.documentTitle || activeTaskMeta.label;
  const speakingStatusLabel = isPracticeActive ? "自动记录中" : "准备记录";
  const speakingPromptTitle = showOriginalText ? "原文" : "提示";
  const practiceSummaryText = "默认只看图片，自己回忆并复述这一页的绘本原文。";
  const visitedProgressCount = practiceDraft?.visitedPageIndexes.length || 0;
  const aiCoachMode =
    resolvedTaskMode === "shadow" ? "shadow" : resolvedTaskMode === "intensive" ? "intensive" : "speaking";
  const aiCoachPageText =
    resolvedTaskMode === "shadow" ? activeShadowText : page?.visibleText || "";
  const aiCoachVisiblePrompt =
    resolvedTaskMode === "shadow" ? activeShadowText : displayPromptText;
  const aiCoachPageLabel =
    resolvedTaskMode === "shadow"
      ? `${safeShadowViewIndex + 1}/${shadowViews.length}${
          isSingleDualTextView || activeShadowView.kind === "spread"
            ? spreadFocus === 0
              ? " Left Page"
              : " Right Page"
            : ""
        }`
      : `第 ${safeIndex + 1} 页 / ${pages.length}`;
  const aiCoachNextPageText =
    resolvedTaskMode === "speaking" && safeIndex < pages.length - 1
      ? pages[safeIndex + 1]?.visibleText || ""
      : resolvedTaskMode === "shadow" && safeShadowStepIndex < shadowNavigationSteps.length - 1
        ? (() => {
            const nextStep = shadowNavigationSteps[safeShadowStepIndex + 1];
            return nextStep
              ? getShadowStepText(
                  getDisplayPageText(
                    document?.analysis.title || "",
                    nextStep.pageIndex,
                    shadowTexts[nextStep.pageIndex] || ""
                  ),
                  nextStep.focus,
                  Boolean(shadowPairEditorModeByPage[nextStep.pageIndex])
                )
              : "";
          })()
        : "";
  const aiCoachNextPageLabel =
    resolvedTaskMode === "speaking"
      ? `第 ${Math.min(safeIndex + 2, pages.length)} 页 / ${pages.length}`
      : `${Math.min(safeShadowViewIndex + 2, shadowViews.length)}/${shadowViews.length}`;
  const aiTeachingContext: AiTeachingContext = (() => {
    const visibleToStudent =
      resolvedTaskMode === "speaking"
        ? hintStage >= 2
          ? "original"
          : hintStage >= 1
            ? "hint"
            : "image_only"
        : "original";
    const allPageTexts =
      resolvedTaskMode === "speaking"
        ? pages
            .map((item, index) => ({
              pageLabel: `第 ${index + 1} 页`,
              text: normalizeAiContextText(item.visibleText || "", 180),
            }))
            .filter((item) => item.text)
        : shadowRecordableSteps
            .map((step, index) => ({
              pageLabel: `${index + 1}/${shadowRecordableSteps.length}`,
              text: normalizeAiContextText(
                getShadowStepText(
                  getDisplayPageText(
                    document?.analysis.title || "",
                    step.pageIndex,
                    shadowTexts[step.pageIndex] || ""
                  ),
                  step.focus,
                  Boolean(shadowPairEditorModeByPage[step.pageIndex])
                ),
                180
              ),
            }))
            .filter((item) => item.text);

    return {
      currentPageText: normalizeAiContextText(aiCoachPageText, 1200),
      previousPageText:
        resolvedTaskMode === "speaking" && safeIndex > 0
          ? normalizeAiContextText(pages[safeIndex - 1]?.visibleText || "", 500)
          : "",
      nextPageText:
        resolvedTaskMode === "speaking" && safeIndex < pages.length - 1
          ? normalizeAiContextText(pages[safeIndex + 1]?.visibleText || "", 500)
          : "",
      allPageTexts,
      visibleToStudent,
      instruction:
        "这些原文是 AI 教师后台上下文，学生不一定看得到。请用它们引导孩子回忆和复述原文，但不要直接泄露完整答案；只有学生已点击显示原文或明确要答案时才可完整说出原文。",
    };
  })();
  const lastCoachMessage =
    [...coachMessages].reverse().find((message) => message.role === "coach") || null;
  const lastCoachAskedNextPage = Boolean(
    lastCoachMessage?.text && isCoachAskingForNextPage(lastCoachMessage.text)
  );
  const coachHistoryForRequest: AiCoachHistoryItem[] = coachMessages
    .filter((message) => message.id !== "coach_welcome")
    .slice(-8)
    .map((message) => ({
      role: message.role,
      text: normalizeAiContextText(message.text, 220),
    }))
    .filter((message) => message.text);
  const coachHistoryForAssessment: AiCoachHistoryItem[] = coachMessages
    .filter((message) => message.id !== "coach_welcome")
    .slice(-24)
    .map((message) => ({
      role: message.role,
      text: normalizeAiContextText(message.text, 300),
    }))
    .filter((message) => message.text);

  const buildIntensiveLessonState = (
    step: AgentLessonStep = intensiveLessonStepRef.current || intensiveLessonStep
  ): AgentLessonState => ({
    step,
    round: step.startsWith("round2") || step === "summary" ? 2 : 1,
    pageIndex: safeIndex,
    pageCount: pages.length,
    pageLabel: aiCoachPageLabel,
  });

  const updateIntensiveLessonStep = (step: AgentLessonStep) => {
    intensiveLessonStepRef.current = step;
    setIntensiveLessonStep(step);
  };

  const advanceIntensiveLessonStepFromSubtitle = (role: AiCoachMessage["role"], text: string) => {
    if (resolvedTaskMode !== "intensive" || !text.trim()) return;
    const current = intensiveLessonStepRef.current;
    if (role === "student") {
      if (current === "round1_picture") updateIntensiveLessonStep("round1_read");
      else if (current === "round2_student_read") updateIntensiveLessonStep("round2_feedback");
      else if (current === "round2_question") updateIntensiveLessonStep("round2_student_read");
      return;
    }
    if (current === "intro") updateIntensiveLessonStep("round1_picture");
    else if (current === "round1_read") updateIntensiveLessonStep("round1_explain");
    else if (current === "round1_explain") updateIntensiveLessonStep("round1_next_page");
    else if (current === "round2_feedback") updateIntensiveLessonStep("round2_question");
  };

  const buildCoachRequestPayload = (
    message: string,
    screenshotDataUrl = ""
  ) => ({
    mode: aiCoachMode,
    message,
    studentMessage: message,
    bookTitle: document?.analysis.title || assignment?.documentTitle || "",
    pageLabel: aiCoachPageLabel,
    pageText: aiCoachPageText,
    visiblePrompt: aiCoachVisiblePrompt,
    aiTeachingContext,
    coachHistory: coachHistoryForRequest,
    navigationContext: {
      canGoNext: canNext,
      nextPageLabel: aiCoachNextPageLabel,
      nextPageText: normalizeAiContextText(aiCoachNextPageText, 500),
      lastAssistantAskedNext: lastCoachAskedNextPage,
      frontendWillAutoAdvanceOnAgreement: true,
    },
    uiControlContext: {
      practiceStatus,
      hintStage: resolvedTaskMode === "speaking" ? hintStage : 2,
      pendingAction: pendingCoachAction?.action || "",
      allowedAutoActions:
        resolvedTaskMode === "speaking"
          ? [
              isPracticeActive && hintStage < 1 ? "show_hint" : "",
            ].filter(Boolean)
          : [],
      requiresConfirmationActions:
        resolvedTaskMode === "speaking" && isPracticeActive && hintStage < 2
          ? ["show_original"]
          : [],
    },
    hintStage: resolvedTaskMode === "speaking" ? hintStage : 2,
    screenshotDataUrl,
  });

  useEffect(() => {
    coachLatestRequestPayloadRef.current = buildCoachRequestPayload("");
    coachLatestNavigationRef.current = {
      canNext,
      mode: resolvedTaskMode,
      pagesLength: pages.length,
      shadowStepsLength: shadowNavigationSteps.length,
    };
  });

  const appendCoachMessage = (message: Omit<AiCoachMessage, "id">) => {
    setCoachMessages((current) => {
      const nextMessages = [
        ...current.slice(-79),
        {
          ...message,
          id: `coach_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          createdAt: message.createdAt || Date.now(),
        },
      ];
      coachMessagesRef.current = nextMessages;
      return nextMessages;
    });
  };

  const runSpeakingPracticeUiAction = (action: AiCoachUiAction) => {
    if (resolvedTaskMode !== "speaking") return false;

    if (action === "show_hint") {
      if (!isPracticeActive) return false;
      if (hintStage === 1) {
        setHintStage(0);
        return true;
      }
      if (hintStage < 1) {
        recordPracticeReveal("prompt");
      }
      setHintStage(1);
      return true;
    }

    if (action === "show_original") {
      if (!isPracticeActive) return false;
      if (hintStage >= 2) {
        setHintStage(0);
        return true;
      }
      recordPracticeReveal("original");
      setHintStage(2);
      return true;
    }

    if (action === "finish_practice") {
      if (!isPracticeActive) return false;
      handleFinishPractice();
      return true;
    }

    return false;
  };

  const inferCoachUiAction = (replyText: string): AiCoachUiAction | "confirm_show_original" | null => {
    if (resolvedTaskMode !== "speaking") return null;
    const normalized = replyText.replace(/\s+/g, "");
    const lower = replyText.toLowerCase();
    const isNegativeOriginalPrompt =
      /不要.{0,8}(看答案|显示原文|看原文)|别.{0,8}(看答案|显示原文|看原文)|先不.{0,8}(看答案|显示原文|看原文)/.test(
        normalized
      );

    if (
      isPracticeActive &&
      hintStage < 1 &&
      (/(我帮你|现在给你|给你).{0,8}(打开提示|给点提示|一点提示|关键词提示|填空提示)/.test(
        normalized
      ) ||
        lower.includes("i'll give you a hint") ||
        lower.includes("let me give you a hint"))
    ) {
      return "show_hint";
    }

    if (
      isPracticeActive &&
      hintStage < 2 &&
      !isNegativeOriginalPrompt &&
      /(要不要|需要不需要|想不想).{0,8}(显示原文|看原文|看答案|打开原文)/.test(normalized)
    ) {
      return "confirm_show_original";
    }

    return null;
  };

  const applyCoachUiActionFromReply = (replyText: string) => {
    const action = inferCoachUiAction(replyText);
    if (!action) return;

    if (action === "confirm_show_original") {
      setPendingCoachAction({
        action: "show_original",
        label: "显示原文",
        createdAt: Date.now(),
      });
      return;
    }

    const applied = runSpeakingPracticeUiAction(action);
    if (applied) {
      setPendingCoachAction(null);
      setCoachInterimText(
        action === "show_hint"
          ? "AI 已帮你打开提示。"
          : action === "finish_practice"
            ? "AI 已帮你完成练习。"
            : ""
      );
    }
  };

  const consumePendingCoachActionIfConfirmed = (studentText: string, options?: { replyLocally?: boolean }) => {
    if (!pendingCoachAction || !isStudentConfirmingCoachAction(studentText)) return false;
    const applied = runSpeakingPracticeUiAction(pendingCoachAction.action);
    if (!applied) {
      setPendingCoachAction(null);
      return false;
    }

    const label = pendingCoachAction.label;
    setPendingCoachAction(null);
    setCoachInterimText(`AI 已帮你${label}。`);
    if (options?.replyLocally) {
      appendCoachMessage({
        role: "coach",
        text:
          pendingCoachAction.action === "show_original"
            ? "好的，原文已经打开了。我们可以对照原文，再试着读一遍。"
            : "好的，已经帮你处理了，我们继续练习。",
      });
    }
    return true;
  };

  const stopCoachSession = () => {
    coachRtcLifecycleTokenRef.current += 1;
    coachSessionActiveRef.current = false;
    coachManualStopRef.current = true;
    coachRequestInFlightRef.current = false;
    clearCoachRtcShadowPromptTimer();
    void interruptCoachRtcOutput();
    stopShadowAudioPlayback({ resumeRtcMic: false });
    stopShadowRecording();
    setIsCoachSessionActive(false);
    setIsCoachListening(false);
    clearCoachRemoteAudioActive();
    coachExpectedSpeechRef.current = "";
    setIsCoachThinking(false);
    setCoachInterimText("");
    void stopCoachRtcAgentSession();
  };

  const beginCoachSession = async () => {
    if (coachSessionActiveRef.current || coachRtcStartInFlightRef.current) return;
    coachRtcLifecycleTokenRef.current += 1;
    coachManualStopRef.current = false;
    coachRtcStartInFlightRef.current = true;
    setCoachError(null);
    try {
      await beginCoachRtcSession();
    } catch (rtcError) {
      await stopCoachRtcAgentSession();
      coachSessionActiveRef.current = false;
      coachManualStopRef.current = true;
      setIsCoachSessionActive(false);
      setIsCoachListening(false);
      clearCoachRemoteAudioActive();
      setCoachError(
        rtcError instanceof Error
          ? `${rtcError.message}，请检查 RTC 智能体配置后重试。`
          : "RTC 智能体启动失败，请检查配置后重试。"
      );
      setCoachInterimText("");
    } finally {
      coachRtcStartInFlightRef.current = false;
    }
  };

  const toggleCoachSession = () => {
    if (coachSessionActiveRef.current || coachRtcStartInFlightRef.current) {
      stopCoachSession();
      return;
    }
    void beginCoachSession();
  };

  const handleCoachDragStart = (event: React.MouseEvent<HTMLDivElement>) => {
    coachDragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: coachPanelPosition.x,
      originY: coachPanelPosition.y,
    };
  };

  const handleCoachDragMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!coachDragRef.current) return;
    const nextX = coachDragRef.current.originX - (event.clientX - coachDragRef.current.startX);
    const nextY = coachDragRef.current.originY - (event.clientY - coachDragRef.current.startY);
    setCoachPanelPosition(clampCoachPanelPosition({ x: nextX, y: nextY }, isCoachOpen));
  };

  const handleCoachDragEnd = () => {
    coachDragRef.current = null;
  };

  const captureCoachScreen = async () => {
    if (!isCoachScreenShared || !coachCaptureRef.current) return "";
    try {
      const html2canvas = (await import("html2canvas")).default;
      const canvas = await html2canvas(coachCaptureRef.current, {
        backgroundColor: "#f6fbff",
        logging: false,
        scale: Math.min(1.4, window.devicePixelRatio || 1),
        useCORS: true,
      });
      return canvas.toDataURL("image/jpeg", 0.72);
    } catch {
      return "";
    }
  };

  const buildCoachRtcWelcomeMessage = () => {
    if (resolvedTaskMode === "intensive") {
      if (
        hasIntroducedIntensiveRtcRulesRef.current ||
        intensiveLessonStepRef.current !== "intro" ||
        safeIndex > 0 ||
        coachMessages.some(isVoiceSubtitleMessage)
      ) {
        return "我们继续刚才的学习。";
      }
      return "我们开始绘本精讲。今天分两遍学习：第一遍我带你看图、读原文、讲重点；第二遍你来朗读，我帮你看发音和理解。现在先看当前页，你看到了什么？";
    }

    if (resolvedTaskMode === "speaking") {
      return "我们开始看图说话练习。请看图片，按顺序说出这一页的原文句子。";
    }

    if (resolvedTaskMode === "shadow") {
      if (hasIntroducedShadowRtcRulesRef.current) {
        return "我们继续刚才的学习。";
      }
      const messageIndex = Math.floor(Math.random() * SHADOW_RTC_WELCOME_MESSAGES.length);
      return SHADOW_RTC_WELCOME_MESSAGES[messageIndex] || SHADOW_RTC_WELCOME_MESSAGES[0];
    }

    return "我们继续刚才的学习。";
  };

  const buildCoachRtcLessonStatePrompt = () => {
    const visibleState =
      resolvedTaskMode === "intensive"
        ? "学生正在绘本精讲页面，可以看到老师上传的当前页资料"
        : resolvedTaskMode === "speaking"
        ? hintStage >= 2
          ? "学生已打开原文"
          : hintStage >= 1
            ? "学生只打开了提示"
            : "学生只能看到图片，没有打开原文"
        : "学生正在影子跟读页面";
    const trustedText = normalizeAiContextText(aiCoachPageText, 1200);
    const visiblePrompt = normalizeAiContextText(aiCoachVisiblePrompt, 900);
    const intensiveStructuredText =
      resolvedTaskMode === "intensive" ? formatIntensivePageSegments(page) : "";
    const shadowAllowedSentences = splitShadowReadingSentences(aiCoachPageText)
      .map((sentence, index) => `${index + 1}. ${normalizeAiContextText(sentence, 220)}`)
      .join("\n");

    const modeRules =
      resolvedTaskMode === "intensive"
        ? [
            formatAgentLessonStatePrompt(buildIntensiveLessonState()),
            agentLessonFlowPrompt,
            "绘本精讲规则：上传资料已经由老师完成，你要基于当前屏幕画面和当前页可信原文逐页陪学。",
            "课堂逻辑必须和 Agent 陪学一致：第一轮 AI 带读讲解，第二轮学生自主朗读并接受发音和理解反馈。",
            "第一轮每页流程：先引导观察图片，再完整朗读当前页/当前侧页原文，随后解释重点句子和重点单词，最后用明确问题或明确指令让学生参与。",
            "第二轮每页流程：先让学生朗读当前页，再按发音准确度、流畅度、语调和完整度反馈；每次只聚焦一两个关键问题，再问一个本页理解问题。",
            "每次进入新页，先观察当前页，再按左到右、由图到文的顺序讲解。双页时必须先讲左页，再讲右页，中间要有一次学生互动。",
            "原文为主：需要完整覆盖当前页可信原文，不能漏句、不能提前讲下一页、不能用绘本记忆补当前页没有的内容。",
            "节奏要像老师一对一精讲：先读/讲一小段，再解释关键词或句型，再问孩子一个具体问题，等待孩子回应。",
            "如果学生没有回复，也没有翻页，就停在当前小步，不要自动编后续剧情。",
          ]
        : resolvedTaskMode === "speaking"
        ? [
            "看图说话规则：只提示孩子说出当前页原文句子，按照原文顺序一小句一小句推进。不要提和原文无关的问题，不要让孩子自由编故事，不要问开放式剧情预测。",
            "孩子可以用中文、英文或中英混合回答；必须先按孩子真实语义理解，再用中文主导反馈。若字幕出现与上下文明显无关的英文乱码，不要把它当作孩子真实回答。",
            "不要一开始直接朗读或泄露完整原文；如果孩子想不起来，只给与原文相关的关键词、首字母、人物动作或很短的片段提示。",
            "看图说话不是拼读课：禁止用中文谐音标注英文发音，不要把英文单词拆成中文近似音；不要让孩子一个字母一个字母拼读，只能给自然提示，例如“标题里有一个表示斑点的词，你再看看”。",
            "注意 ASR 常见混淆：如果当前页可信原文或标题是 Spots，而字幕识别成 Sports，要按 Spots 理解，不要反复说孩子错；最多自然示范一次 Spots 的清楚读法。",
            "如果学生已经说出当前目标词或目标句，包括 Spots、Biff、Kipper、Floppy 这类被 ASR 混淆但已能对应当前可信原文的内容，不要说“没关系”、不要说“再试试”、不要要求重读；直接认可并推进到当前页下一小步或下一句。",
            "如果当前页没有可信原文，只能根据当前屏幕画面做非常保守的观察引导，不得引用旧页、封面、上一页、历史对话或书名记忆里的内容；不要说 Kipper 正在镜子前，不要指定孩子读旧页标题或旧页句子，只能问“这页你看到了什么？”或提示查看原文。",
            "只有学生已经点击查看原文，或者明确要求看答案/读原文时，才可以完整朗读当前页可信原文。",
            "只能围绕当前页画面和当前页可信原文互动，目标是帮助孩子说回原文句子。不要讲未翻到页面，不要用下一页文本、旧页面、绘本记忆或角色资料补内容。",
            "如果学生同意翻页，可以提示前端翻页；不要自己讲下一页。",
          ]
        : [
            "影子跟读规则：只针对孩子朗读句子和单词的发音、流畅度、准确度以及读错的地方进行指导，不讲剧情，不扩展知识点，不问和原文无关的问题。",
            `当前影子跟读允许句子：\n${shadowAllowedSentences || "无。当前页没有可朗读原文时，只能请学生等待或翻页。"} `,
            "只允许要求学生朗读“当前影子跟读允许句子”里的原句；如果想让学生重读，必须逐字引用允许句子里的其中一句，不能改写、不能替换角色名、不能使用上一页或历史对话里的句子。",
            "禁止要求学生读任何不在允许句子清单里的句子；如果历史对话、ASR 字幕或你刚才的回复出现了清单外句子，立刻忽略它，只回到当前允许句子。",
            "如果 ASR 或历史里出现清单外词，不能围绕这个清单外词纠音；例如当前允许句子没有 children，就绝对不要分析 children 的 ch、音节或发音，只能说“我没有听清，我们只读当前句”。",
            "同一次回复只能给一个稳定判断，禁止反复自我否定，禁止出现“对、不对、哦不对、重新判断”这类来回摇摆的话。",
            "先听孩子读当前句或当前单词，再反馈。不要替孩子重新讲故事，也不要把当前页当成看图说话来引导。",
            "发音判断标准默认宽松：孩子读出约 80% 的目标句、关键词和意思基本正确就可通过；轻微口音、轻微音调不标准、单个不影响理解的音素问题，只轻轻提醒，不要求重读。只纠正 1 个最影响理解的问题，不要因为口音、轻微音调或不影响理解的小错反复判错。",
            "纠错最多连续 3 次；如果同一句或同一个单词还有问题，先鼓励孩子一下，然后继续往后，不要反复卡在同一处。",
            "纠音要具体：先具体指出读错的单词，再说明是哪个音节或哪个单个音的问题；用孩子听得懂的话讲口型、舌位、长短音、清浊音，并说明重音位置和对应发音规则。",
            "学生读错时，必须先再读一遍正确读法，读得自然、清楚、不要读标点符号；再解释发音规则；最后请孩子重读这个词或这句。解释发音规则最多 1 遍；同一个词或同一个发音点再次犯错时，只示范正确发音，不再重复解释规则。",
            "反馈要短：优先指出 1 个最影响理解的发音或流畅度问题，不要只给整个单词读法；给一个可模仿的拆分读法，再请孩子重读这一词或继续读下一句。",
            "注意角色名常见 ASR 混淆：Biff 可能被转写成 beef，Kipper 可能被转写成 keeper，Floppy 可能被转写成 Lopi 或 Lucky；如果当前页可信原文是这些角色名，不要因为字幕显示为 beef/keeper/Lopi/Lucky 就反复判错。最多提醒一次：Biff 是短音 /bɪf/，不是 beef 的长音 /biːf/；Kipper 是 /ˈkɪpə/，Floppy 是 /ˈflɒpi/，然后继续往后。",
            "只能依据当前页可信原文判断孩子读得是否准确；不要讲未翻到页面，不要用下一页文本、旧页面、绘本记忆或角色资料补内容。",
          ];

    return [
      resolvedTaskMode === "intensive" ? "【绘本精讲RTC练习】" : "【看图说话RTC练习】",
      `任务模式：${
        resolvedTaskMode === "intensive" ? "绘本精讲" : resolvedTaskMode === "speaking" ? "看图说话" : "影子跟读"
      }`,
      `绘本/资料：${document?.analysis.title || assignment?.documentTitle || ""}`,
      `当前页：${aiCoachPageLabel}`,
      `当前学生可见状态：${visibleState}`,
      resolvedTaskMode === "intensive" && intensiveStructuredText
        ? `当前页分栏原文（必须作为唯一原文依据，双页先左后右）：${intensiveStructuredText}`
        : `当前页可信原文：${trustedText || "当前页没有可用后台原文，只能根据画面引导。"} `,
      visiblePrompt ? `当前屏幕可见提示/原文：${visiblePrompt}` : "当前屏幕没有显示提示或原文。",
      ...modeRules,
    ].join("\n");
  };

  const correctCoachRtcTranscriptAgainstCurrentText = (text: string) => {
    let corrected = text;
    if (/\bBiff\b/i.test(aiCoachPageText)) {
      corrected = corrected.replace(/\bbeef\b/gi, "Biff");
    }
    if (/\bKipper\b/i.test(aiCoachPageText)) {
      corrected = corrected.replace(/\bkeeper\b/gi, "Kipper");
    }
    if (/\bFloppy\b/i.test(aiCoachPageText)) {
      corrected = corrected.replace(/\b(?:lopi|loppy|lucky)\b/gi, "Floppy");
    }
    if (/\bSpots\b/i.test(aiCoachPageText)) {
      corrected = corrected.replace(/\bSports\b/gi, "Spots");
    }
    return corrected;
  };

  const stopCoachRtcVisualTrack = () => {
    coachRtcVisualStreamRef.current?.getTracks().forEach((track) => track.stop());
    coachRtcVisualStreamRef.current = null;
    const canvas = coachRtcVisualCanvasRef.current;
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
    coachRtcVisualCanvasRef.current = null;
  };

  const safeDestroyCoachRtcEngine = async (engine?: CoachRtcEngine | null) => {
    if (!engine) return;
    try {
      await Promise.resolve(engine.stopSubtitle?.());
    } catch {
      // ignore RTC SDK cleanup errors
    }
    // Volc RTC Web SDK can surface a "disconnect" runtime error from destroy()
    // after leaveRoom during shadow/speaking teardown. Leaving the room and
    // clearing refs is enough for this client-side handoff.
  };

  const loadCoachRtcImageElement = (source: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("当前页图片加载失败"));
      image.src = source;
    });

  const drawCoachRtcVisualFrame = async (canvas: HTMLCanvasElement) => {
    const source = pageImageUrl || getDocumentPageImageUrl(page?.pageIndex);
    if (!source) return false;
    const image = await loadCoachRtcImageElement(source);
    const sourceWidth = image.naturalWidth || image.width || 1;
    const sourceHeight = image.naturalHeight || image.height || 1;
    const scale = Math.min(1, 1280 / sourceWidth, 900 / sourceHeight);
    const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
    const targetHeight = Math.max(1, Math.round(sourceHeight * scale));

    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }
    const context = canvas.getContext("2d");
    if (!context) return false;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return true;
  };

  const startCoachRtcVisualTrack = async (
    engine: CoachRtcEngine,
    streamIndex: { STREAM_INDEX_MAIN: number },
    videoSourceType: { VIDEO_SOURCE_TYPE_EXTERNAL: number }
  ) => {
    if (!engine.setVideoSourceType || !engine.setExternalVideoTrack) return false;
    stopCoachRtcVisualTrack();

    const canvas = window.document.createElement("canvas");
    coachRtcVisualCanvasRef.current = canvas;
    const hasFrame = await drawCoachRtcVisualFrame(canvas);
    if (!hasFrame) {
      stopCoachRtcVisualTrack();
      return false;
    }

    const stream = canvas.captureStream(2);
    const track = stream.getVideoTracks()[0];
    if (!track) {
      stopCoachRtcVisualTrack();
      return false;
    }

    coachRtcVisualStreamRef.current = stream;
    await engine.setVideoSourceType(
      streamIndex.STREAM_INDEX_MAIN,
      videoSourceType.VIDEO_SOURCE_TYPE_EXTERNAL
    );
    await engine.setExternalVideoTrack(streamIndex.STREAM_INDEX_MAIN, track);
    return true;
  };

  const upsertCoachRtcTranscriptMessage = ({
    id,
    role,
    text,
    definite,
  }: {
    id: string;
    role: AiCoachMessage["role"];
    text: string;
    definite?: boolean;
  }) => {
    const normalized = normalizeAiContextText(text, 1200);
    if (!normalized) return;
    if (role === "coach") {
      const recentCoachEchoTexts = coachRecentSpeechEchoTextsRef.current;
      if (recentCoachEchoTexts.at(-1) !== normalized) {
        coachRecentSpeechEchoTextsRef.current = [...recentCoachEchoTexts.slice(-11), normalized];
      }
    }

    setCoachMessages((current) => {
      const existingIndex = current.findIndex((message) => message.id === id);
      const nextMessages =
        existingIndex >= 0
          ? current.map((message, index) => {
              if (index !== existingIndex) return message;
              const nextText =
                message.role === "student"
                  ? mergeCoachRtcTranscriptText(message.text, normalized)
                  : message.role === "coach"
                    ? mergeCoachRtcTranscriptText(message.text, normalized)
                    : normalized.length >= message.text.length
                      ? normalized
                      : message.text;
              return nextText === message.text ? message : { ...message, text: nextText };
            })
          : [
              ...current.slice(-79),
              {
                id,
                role,
                text: normalized,
                createdAt: Date.now(),
              },
            ];

      if (definite || existingIndex < 0) {
        coachRtcTranscriptIdsRef.current.add(id);
      }
      coachMessagesRef.current = nextMessages;
      return nextMessages;
    });
  };

  const getStableCoachRtcTranscriptId = ({
    source,
    role,
    text,
    sequence,
    definite,
  }: {
    source: string;
    role: AiCoachMessage["role"];
    text: string;
    sequence: string | number;
    definite?: boolean;
  }) => {
    const normalized = normalizeAiContextText(text, 1200);
    const canonicalSource = role === "student" ? "student_voice" : "coach_voice";
    const streamKey = `${canonicalSource}_${role}`;
    const active = coachRtcLiveTranscriptIdsRef.current[streamKey];
    const recent = coachRtcRecentTranscriptRef.current[streamKey];
    const now = Date.now();
    const normalizedForCompare = normalizeCoachRtcTranscriptComparisonText(normalized);
    const activeForCompare = active
      ? normalizeCoachRtcTranscriptComparisonText(active.text)
      : "";
    const recentForCompare = recent
      ? normalizeCoachRtcTranscriptComparisonText(recent.text)
      : "";
    const isSameLiveUtterance =
      active &&
      now - active.at < 8000 &&
      (normalizedForCompare === activeForCompare ||
        normalizedForCompare.startsWith(activeForCompare) ||
        activeForCompare.startsWith(normalizedForCompare));
    const isSameActiveStudentRewrite =
      role === "student" &&
      active &&
      now - active.at < 4500 &&
      normalizedForCompare.length >= 2 &&
      activeForCompare.length >= 2;
    const isSameActiveCoachContinuation =
      role === "coach" &&
      active &&
      now - active.at < 6500 &&
      normalizedForCompare.length >= 2 &&
      activeForCompare.length >= 2 &&
      isLikelyTranscriptContinuation(active.text, normalized);
    const isSameGrowingUtterance =
      recent &&
      now - recent.at < 8000 &&
      (normalizedForCompare === recentForCompare ||
        normalizedForCompare.startsWith(recentForCompare) ||
        recentForCompare.startsWith(normalizedForCompare));
    const isSameStudentRewrite =
      role === "student" &&
      recent &&
      now - recent.at < 4500 &&
      normalizedForCompare.length >= 2 &&
      recentForCompare.length >= 2;
    const isSameCoachContinuation =
      role === "coach" &&
      recent &&
      now - recent.at < 6500 &&
      normalizedForCompare.length >= 2 &&
      recentForCompare.length >= 2 &&
      isLikelyTranscriptContinuation(recent.text, normalized);

    if (
      active &&
      (definite || isSameLiveUtterance || isSameActiveStudentRewrite || isSameActiveCoachContinuation)
    ) {
      const activeMergedText = mergeCoachRtcTranscriptText(active.text, normalized);
      if (definite) {
        delete coachRtcLiveTranscriptIdsRef.current[streamKey];
        coachRtcRecentTranscriptRef.current[streamKey] = {
          id: active.id,
          text: activeMergedText,
          at: now,
        };
      } else {
        coachRtcLiveTranscriptIdsRef.current[streamKey] = {
          id: active.id,
          text: activeMergedText,
          at: now,
        };
      }
      return active.id;
    }

    if (active && !isSameLiveUtterance) {
      delete coachRtcLiveTranscriptIdsRef.current[streamKey];
      coachRtcRecentTranscriptRef.current[streamKey] = {
        id: active.id,
        text: active.text,
        at: active.at,
      };
    }

    if (isSameGrowingUtterance || isSameStudentRewrite || isSameCoachContinuation) {
      const recentMergedText = mergeCoachRtcTranscriptText(recent.text, normalized);
      coachRtcRecentTranscriptRef.current[streamKey] = {
        id: recent.id,
        text: recentMergedText,
        at: now,
      };
      return recent.id;
    }

    const id = `rtc_subtitle_${streamKey}_${now}_${String(sequence)}`;
    if (definite) {
      coachRtcRecentTranscriptRef.current[streamKey] = { id, text: normalized, at: now };
    } else {
      coachRtcLiveTranscriptIdsRef.current[streamKey] = { id, text: normalized, at: now };
    }
    return id;
  };

  const extractCoachRtcMessageText = (value: unknown): string => {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return "";
      try {
        return extractCoachRtcMessageText(JSON.parse(trimmed));
      } catch {
        return trimmed;
      }
    }
    if (!value || typeof value !== "object") return "";
    const record = value as Record<string, unknown>;
    for (const key of [
      "text",
      "content",
      "message",
      "sentence",
      "utterance",
      "asrText",
      "asr_text",
      "asrResult",
      "asr_result",
      "recognitionText",
      "recognition_text",
      "recognizedText",
      "recognized_text",
      "transcriptText",
      "transcript_text",
      "transcription",
      "displayText",
      "display_text",
      "sourceText",
      "source_text",
      "targetText",
      "target_text",
      "translation",
      "llmText",
      "llm_text",
      "subtitle",
    ]) {
      const candidate = record[key];
      if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    }
    for (const key of ["data", "payload", "result", "body", "detail", "extra"]) {
      const nested = extractCoachRtcMessageText(record[key]);
      if (nested) return nested;
    }
    return "";
  };

  const getLocalStudentSpeechRecognitionConstructor = (): LocalStudentSpeechRecognitionConstructor | null => {
    if (typeof window === "undefined") return null;
    const candidates = window as Window &
      typeof globalThis & {
        SpeechRecognition?: LocalStudentSpeechRecognitionConstructor;
        webkitSpeechRecognition?: LocalStudentSpeechRecognitionConstructor;
      };
    return candidates.SpeechRecognition || candidates.webkitSpeechRecognition || null;
  };

  const getLocalStudentSpeechRecognitionLang = () => {
    if (resolvedTaskMode === "intensive") {
      const step = intensiveLessonStepRef.current || intensiveLessonStep;
      return step.startsWith("round2") ? "en-US" : "zh-CN";
    }
    if (resolvedTaskMode === "speaking") {
      return "zh-CN";
    }
    return "en-US";
  };

  const stopLocalStudentSpeechSubtitles = () => {
    localStudentSpeechShouldRunRef.current = false;
    if (localStudentSpeechRestartTimerRef.current) {
      window.clearTimeout(localStudentSpeechRestartTimerRef.current);
      localStudentSpeechRestartTimerRef.current = null;
    }
    const recognition = localStudentSpeechRecognitionRef.current;
    localStudentSpeechRecognitionRef.current = null;
    if (!recognition) return;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    try {
      recognition.stop();
    } catch {
      recognition.abort?.();
    }
  };

  const isCoachRemoteAudioActive = () => Date.now() < coachRemoteAudioActiveUntilRef.current;

  const markCoachRemoteAudioActive = (durationMs = 4200) => {
    if (typeof window === "undefined") return;
    const activeUntil = Date.now() + durationMs;
    coachRemoteAudioActiveUntilRef.current = Math.max(
      coachRemoteAudioActiveUntilRef.current,
      activeUntil
    );
    setIsCoachSpeaking(true);
    if (coachRemoteAudioClearTimerRef.current) {
      window.clearTimeout(coachRemoteAudioClearTimerRef.current);
    }
    coachRemoteAudioClearTimerRef.current = window.setTimeout(() => {
      coachRemoteAudioClearTimerRef.current = null;
      if (!isCoachRemoteAudioActive()) {
        setIsCoachSpeaking(false);
      }
    }, durationMs + 160);
  };

  const clearCoachRemoteAudioActive = () => {
    coachRemoteAudioActiveUntilRef.current = 0;
    if (typeof window !== "undefined" && coachRemoteAudioClearTimerRef.current) {
      window.clearTimeout(coachRemoteAudioClearTimerRef.current);
      coachRemoteAudioClearTimerRef.current = null;
    }
    setIsCoachSpeaking(false);
  };

  const getLocalTranscriptSimilarity = (left: string, right: string, forcedChunkSize?: number) => {
    if (!left || !right) return 0;
    const shorter = left.length <= right.length ? left : right;
    const longer = left.length > right.length ? left : right;
    const hasCjkShorter = /\p{Script=Han}/u.test(shorter);
    if (shorter.length < (hasCjkShorter ? 6 : 8)) return 0;
    if (longer.includes(shorter)) return 1;

    const chunkSize = forcedChunkSize || (shorter.length >= 18 ? 3 : 2);
    const chunks = new Set<string>();
    for (let index = 0; index <= shorter.length - chunkSize; index += 1) {
      chunks.add(shorter.slice(index, index + chunkSize));
    }
    if (!chunks.size) return 0;

    let matched = 0;
    chunks.forEach((chunk) => {
      if (longer.includes(chunk)) matched += 1;
    });
    return matched / chunks.size;
  };

  const isLikelyCoachEchoLocalStudentTranscript = (text: string) => {
    const normalized = normalizeCoachRtcTranscriptComparisonText(text);
    const hasCjkLocalTranscriptEcho = /\p{Script=Han}/u.test(normalized);
    const recentCoachTexts = [
      coachExpectedSpeechRef.current,
      ...coachRecentSpeechEchoTextsRef.current,
      ...coachMessagesRef.current
        .filter((message) => message.role === "coach")
        .slice(-8)
        .map((message) => message.text),
    ]
      .map((message) => normalizeCoachRtcTranscriptComparisonText(message))
      .filter((message) => (/\p{Script=Han}/u.test(message) ? message.length >= 4 : message.length >= 10));

    if (
      resolvedTaskMode === "speaking" &&
      isCoachRemoteAudioActive() &&
      hasCjkLocalTranscriptEcho &&
      normalized.length <= 2
    ) {
      return true;
    }

    if (
      resolvedTaskMode === "speaking" &&
      isCoachRemoteAudioActive() &&
      hasCjkLocalTranscriptEcho &&
      normalized.length <= 80 &&
      /^(没关系|不对|你看|想一想|我们慢|我们一个|连起来|标题是)/u.test(normalized)
    ) {
      return true;
    }

    if (
      isCoachRemoteAudioActive() &&
      hasCjkLocalTranscriptEcho &&
      normalized.length === 1 &&
      recentCoachTexts.some((coachText) => coachText.startsWith(normalized))
    ) {
      return true;
    }

    if (
      hasCjkLocalTranscriptEcho &&
      normalized.length >= 2 &&
      recentCoachTexts.some((coachText) => coachText.startsWith(normalized) || normalized.startsWith(coachText))
    ) {
      return true;
    }

    if (
      hasCjkLocalTranscriptEcho &&
      normalized.length >= 3 &&
      recentCoachTexts.some((coachText) => coachText.includes(normalized))
    ) {
      return true;
    }

    if (normalized.length < (hasCjkLocalTranscriptEcho ? 6 : 10)) return false;

    if (
      isCoachRemoteAudioActive() &&
      hasCjkLocalTranscriptEcho &&
      normalized.length >= 8 &&
      recentCoachTexts.some((coachText) => getLocalTranscriptSimilarity(normalized, coachText, 2) >= 0.62)
    ) {
      return true;
    }

    return recentCoachTexts.some((coachText) => {
      return getLocalTranscriptSimilarity(normalized, coachText) >= (hasCjkLocalTranscriptEcho ? 0.56 : 0.62);
    });
  };

  const startLocalStudentSpeechSubtitles = () => {
    if (typeof window === "undefined" || localStudentSpeechRecognitionRef.current) return;
    const SpeechRecognitionCtor = getLocalStudentSpeechRecognitionConstructor();
    if (!SpeechRecognitionCtor) return;

    localStudentSpeechShouldRunRef.current = true;
    const recognition = new SpeechRecognitionCtor();
    recognition.lang = getLocalStudentSpeechRecognitionLang();
    localStudentSpeechLangRef.current = recognition.lang;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const text = normalizeAiContextText(result?.[0]?.transcript || "", 1200);
        if (!text) continue;
        if (isCoachRemoteAudioActive()) continue;
        if (isLikelyCoachEchoLocalStudentTranscript(text)) continue;
        localStudentSpeechSequenceRef.current += 1;
        const transcriptId = getStableCoachRtcTranscriptId({
          source: "local_student_speech",
          role: "student",
          text,
          sequence: `local_${localStudentSpeechSequenceRef.current}`,
          definite: Boolean(result.isFinal),
        });
        upsertCoachRtcTranscriptMessage({
          id: transcriptId,
          role: "student",
          text: correctCoachRtcTranscriptAgainstCurrentText(text),
          definite: Boolean(result.isFinal),
        });
      }
    };
    recognition.onerror = () => {
      // Local recognition is only a subtitle mirror. RTC voice remains the source of truth.
    };
    recognition.onend = () => {
      localStudentSpeechRecognitionRef.current = null;
      if (!localStudentSpeechShouldRunRef.current || !coachRtcStartedRef.current || coachManualStopRef.current) {
        return;
      }
      localStudentSpeechRestartTimerRef.current = window.setTimeout(() => {
        localStudentSpeechRestartTimerRef.current = null;
        startLocalStudentSpeechSubtitles();
      }, 500);
    };

    try {
      recognition.start();
      localStudentSpeechRecognitionRef.current = recognition;
    } catch {
      localStudentSpeechRecognitionRef.current = null;
    }
  };

  useEffect(() => {
    if (!coachRtcStartedRef.current || coachManualStopRef.current) return;
    const nextLang = getLocalStudentSpeechRecognitionLang();
    if (!localStudentSpeechRecognitionRef.current || localStudentSpeechLangRef.current === nextLang) return;
    stopLocalStudentSpeechSubtitles();
    window.setTimeout(() => {
      if (!coachRtcStartedRef.current || coachManualStopRef.current) return;
      startLocalStudentSpeechSubtitles();
    }, 0);
  }, [resolvedTaskMode, intensiveLessonStep]);

  const normalizeCoachRtcSubtitleItems = (values: unknown[]): Array<Record<string, unknown>> => {
    const stack = values.map((value) => ({ value, inherited: {} as Record<string, unknown> }));
    const items: Array<Record<string, unknown>> = [];
    while (stack.length) {
      const entry = stack.shift();
      if (!entry) continue;
      const { value, inherited } = entry;
      if (!value) continue;
      if (Array.isArray(value)) {
        stack.push(...value.map((item) => ({ value: item, inherited })));
        continue;
      }
      if (typeof value !== "object") continue;
      const record = value as Record<string, unknown>;
      const nextInherited = {
        ...inherited,
        ...Object.fromEntries(
          [
            "userId",
            "uid",
            "user_id",
            "UserId",
            "UserID",
            "participantId",
            "participant_id",
            "sourceUserId",
            "source_user_id",
            "targetUserId",
            "target_user_id",
            "role",
            "speaker",
            "userType",
            "user_type",
          ]
            .filter((key) => record[key] !== undefined && record[key] !== null && record[key] !== "")
            .map((key) => [key, record[key]])
        ),
      };
      const nested =
        record.subtitles ||
        record.subtitleList ||
        record.subtitle_list ||
        record.messages ||
        record.messageList ||
        record.message_list ||
        record.data ||
        record.payload ||
        record.result;
      if (Array.isArray(nested)) {
        stack.push(...nested.map((item) => ({ value: item, inherited: nextInherited })));
        continue;
      }
      items.push({
        ...nextInherited,
        ...record,
      });
    }
    return items;
  };

  const parseCoachRtcJsonValue = (value: unknown): unknown => {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    if (!trimmed) return "";

    const queue = [trimmed];
    const starts = Array.from(new Set([0, ...Array.from(trimmed.matchAll(/[{[]/g)).map((match) => match.index || 0)]));
    starts.forEach((index) => {
      if (index > 0) queue.push(trimmed.slice(index));
    });

    for (const candidate of queue) {
      try {
        return JSON.parse(candidate);
      } catch {
        // Try the next possible JSON start. RTC subtitle packets can contain a protocol prefix.
      }
    }
    return trimmed;
  };

  const decodeCoachRtcBinaryMessage = (value: unknown): unknown => {
    if (typeof value === "string") return value;
    if (value instanceof ArrayBuffer) {
      return new TextDecoder("utf-8").decode(value);
    }
    if (ArrayBuffer.isView(value)) {
      return new TextDecoder("utf-8").decode(value);
    }
    return value;
  };

  const getCoachRtcUserId = (record: Record<string, unknown>) =>
    typeof record.userId === "string"
      ? record.userId
      : typeof record.uid === "string"
        ? record.uid
        : typeof record.user_id === "string"
          ? record.user_id
          : typeof record.UserId === "string"
            ? record.UserId
            : typeof record.UserID === "string"
              ? record.UserID
              : typeof record.participantId === "string"
                ? record.participantId
                : typeof record.participant_id === "string"
                  ? record.participant_id
                  : typeof record.sourceUserId === "string"
                    ? record.sourceUserId
                    : typeof record.source_user_id === "string"
                      ? record.source_user_id
                      : typeof record.targetUserId === "string"
                        ? record.targetUserId
                        : typeof record.target_user_id === "string"
                          ? record.target_user_id
                          : "";

  const inferCoachVoiceSubtitleRole = (
    record: Record<string, unknown>,
    sessionPayload: RtcAgentSession,
    fallbackRole: AiCoachMessage["role"]
  ): AiCoachMessage["role"] => {
    const userId = getCoachRtcUserId(record);
    if (userId === sessionPayload.userId) return "student";
    if (userId === sessionPayload.agentUserId) return "coach";
    if (record.isMe === true || record.isLocal === true || record.local === true) return "student";

    const roleText = String(
      record.role ||
        record.speaker ||
        record.userType ||
        record.user_type ||
        record.speechType ||
        record.speech_type ||
        record.textType ||
        record.text_type ||
        record.messageType ||
        record.message_type ||
        record.direction ||
        record.source ||
        record.type ||
        record.event ||
        ""
    ).toLowerCase();
    if (/(student|human|user|asr|input|question)/.test(roleText)) return "student";
    if (/(agent|assistant|bot|coach|llm|tts|answer|response)/.test(roleText)) return "coach";
    return fallbackRole;
  };

  const isInternalCoachRtcControlText = (text: string) =>
    (text.includes("学生已经翻到") && text.includes("请按照当前学习流程自动继续这一页")) ||
    (text.includes("学生点击了问题：") && text.includes("请直接回答学生这个问题"));

  const collectCoachRtsSubtitleItems = (
    value: unknown,
    sessionPayload: RtcAgentSession,
    fallbackRole: AiCoachMessage["role"],
    depth = 0
  ): Array<{ role: AiCoachMessage["role"]; text: string; sequence: string; definite: boolean }> => {
    if (depth > 6) return [];
    const parsed = parseCoachRtcJsonValue(value);
    if (!parsed) return [];

    if (Array.isArray(parsed)) {
      return parsed.flatMap((item) =>
        collectCoachRtsSubtitleItems(item, sessionPayload, fallbackRole, depth + 1)
      );
    }

    if (typeof parsed === "string") {
      if (/\bsubv\b|"\s*type\s*"\s*:\s*"\s*subtitle\s*"|"\s*data\s*:/.test(parsed)) {
        return [];
      }
      const text = normalizeAiContextText(parsed, 1200);
      if (isInternalCoachRtcControlText(text)) return [];
      return text
        ? [{ role: fallbackRole, text, sequence: `${Date.now()}_${depth}`, definite: false }]
        : [];
    }

    if (typeof parsed !== "object") return [];
    const record = parsed as Record<string, unknown>;
    const recordType = String(record.type || record.event || "").toLowerCase();
    const keys = Object.keys(record);
    const hasVoiceKey = keys.some((key) =>
      /(subtitle|caption|asr|recognition|recognized|transcript|transcription|translation|sourceText|targetText|sentence|utterance|speech|llm|tts|delta|content|message|text)/i.test(
        key
      )
    );
    const text = extractCoachRtcMessageText(record);
    const items: Array<{
      role: AiCoachMessage["role"];
      text: string;
      sequence: string;
      definite: boolean;
    }> = [];

    if (recordType === "subtitle" && Array.isArray(record.data)) {
      const latestByStream = new Map<
        string,
        {
          role: AiCoachMessage["role"];
          text: string;
          sequence: string;
          definite: boolean;
          sequenceNumber: number;
        }
      >();
      record.data.forEach((item, index) => {
        if (!item || typeof item !== "object") return;
        const subtitle = item as Record<string, unknown>;
        const subtitleText = extractCoachRtcMessageText(subtitle);
        if (!subtitleText || isInternalCoachRtcControlText(subtitleText)) return;
        const sequenceValue =
          subtitle.sequence ??
          subtitle.seq ??
          subtitle.index ??
          subtitle.messageId ??
          subtitle.message_id ??
          index;
        const roundValue = subtitle.roundId ?? subtitle.round_id ?? "round";
        const modeValue = subtitle.mode ?? "mode";
        const subtitleUserId = getCoachRtcUserId(subtitle) || getCoachRtcUserId(record);
        const role = inferCoachVoiceSubtitleRole(
          { ...record, ...subtitle, type: recordType },
          sessionPayload,
          fallbackRole
        );
        const definite =
          typeof subtitle.definite === "boolean"
            ? subtitle.definite
            : typeof subtitle.isFinal === "boolean"
              ? subtitle.isFinal
              : typeof subtitle.final === "boolean"
                ? subtitle.final
                : false;
        const sequenceText = `${subtitleUserId || "unknown"}_${roundValue}_${modeValue}_${String(sequenceValue)}`;
        const sequenceNumber =
          typeof sequenceValue === "number" ? sequenceValue : Number.parseInt(String(sequenceValue), 10);
        const streamKey = `${role}_${subtitleUserId || "unknown"}_${roundValue}_${modeValue}`;
        const previous = latestByStream.get(streamKey);
        if (
          previous &&
          Number.isFinite(previous.sequenceNumber) &&
          Number.isFinite(sequenceNumber) &&
          previous.sequenceNumber > sequenceNumber
        ) {
          return;
        }
        if (
          previous &&
          (!Number.isFinite(sequenceNumber) || previous.sequenceNumber === sequenceNumber) &&
          previous.text.length > subtitleText.length
        ) {
          return;
        }
        latestByStream.set(streamKey, {
          role,
          text: subtitleText,
          sequence: sequenceText,
          definite,
          sequenceNumber: Number.isFinite(sequenceNumber) ? sequenceNumber : index,
        });
      });
      items.push(
        ...Array.from(latestByStream.values()).map(({ sequenceNumber: _sequenceNumber, ...item }) => item)
      );
    } else if (hasVoiceKey && text) {
      if (isInternalCoachRtcControlText(text)) return items;
      const sequenceValue =
        record.sequence ?? record.seq ?? record.index ?? record.messageId ?? record.message_id;
      const userId = getCoachRtcUserId(record) || "unknown";
      const roundValue = record.roundId ?? record.round_id ?? "round";
      const modeValue = record.mode ?? "mode";
      const definite =
        typeof record.definite === "boolean"
          ? record.definite
          : typeof record.isFinal === "boolean"
            ? record.isFinal
            : typeof record.final === "boolean"
              ? record.final
              : false;
      items.push({
        role: inferCoachVoiceSubtitleRole(record, sessionPayload, fallbackRole),
        text,
        sequence: `${userId}_${roundValue}_${modeValue}_${String(sequenceValue ?? `${Date.now()}_${items.length}`)}`,
        definite,
      });
    }

    for (const key of ["data", "payload", "result", "body", "detail", "extra", "message", "content", "subtitles", "messages"]) {
      if (record[key] && typeof record[key] !== "string") {
        items.push(...collectCoachRtsSubtitleItems(record[key], sessionPayload, fallbackRole, depth + 1));
      }
    }

    return items;
  };

  const sendCoachRtcAgentControlMessage = async (message: string) => {
    const session = coachRtcAgentSessionRef.current;
    if (!session || !coachRtcStartedRef.current) return false;

    const response = await fetch("/api/agent-rtc/external-text-to-llm", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        appId: session.appId,
        roomId: session.roomId,
        taskId: session.taskId,
        message,
      }),
    });
    if (response.ok) return true;

    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error || "RTC 智能体文本触发失败");
  };

  const sendCoachRtcAgentContextPrompt = async (message: string) => {
    const session = coachRtcAgentSessionRef.current;
    if (!session || !coachRtcStartedRef.current) return false;

    const response = await fetch("/api/agent-rtc/external-prompts-for-llm", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        appId: session.appId,
        roomId: session.roomId,
        taskId: session.taskId,
        message,
      }),
    });
    if (response.ok) return true;

    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error || "RTC 智能体上下文同步失败");
  };

  const clearCoachRtcShadowPromptTimer = () => {
    if (coachShadowPromptTimerRef.current) {
      window.clearTimeout(coachShadowPromptTimerRef.current);
      coachShadowPromptTimerRef.current = null;
    }
  };

  const sendCoachRtcShadowCurrentSentencePrompt = async () => {
    if (resolvedTaskMode !== "shadow" || !coachRtcStartedRef.current) return;
    const currentSentence = normalizeAiContextText(aiCoachPageText, 500);
    if (!currentSentence) return;

    const sent = await sendCoachRtcAgentContextPrompt(
      [
        `影子跟读当前句已切换到${aiCoachPageLabel}。`,
        buildCoachRtcLessonStatePrompt(),
        `当前唯一允许跟读句：${currentSentence}`,
        "这是静默上下文同步，不要因为这条上下文主动说话。",
        "下一次学生开口后，只能依据当前句反馈。",
        "如果学生 ASR 或历史里出现当前句没有的词，不能纠这个清单外词，只能请学生回到当前句。",
        "同一次反馈只能给一个稳定判断，不能反复说对、不对、哦不对。",
        "不能使用旧句子、上一页句子或历史对话里的句子。",
      ].join("\n")
    );
    if (sent) {
      setCoachInterimText(`Mia 已同步当前句：${currentSentence}`);
    }
  };

  const scheduleCoachRtcShadowCurrentSentencePrompt = (delayMs = 260) => {
    clearCoachRtcShadowPromptTimer();
    const promptKey = `${safeShadowStepIndex}:${aiCoachPageLabel}:${normalizeAiContextText(aiCoachPageText, 500)}`;
    coachShadowPromptKeyRef.current = promptKey;
    coachShadowPromptTimerRef.current = window.setTimeout(() => {
      coachShadowPromptTimerRef.current = null;
      if (coachShadowPromptKeyRef.current !== promptKey) return;
      void sendCoachRtcShadowCurrentSentencePrompt().catch((error) => {
        setCoachError(error instanceof Error ? error.message : "影子跟读当前句同步失败。");
      });
    }, delayMs);
  };

  const interruptCoachRtcOutput = async () => {
    const session = coachRtcAgentSessionRef.current;
    if (!session || !coachRtcStartedRef.current) return;

    await fetch("/api/agent-rtc/interrupt", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        appId: session.appId,
        roomId: session.roomId,
        taskId: session.taskId,
      }),
    }).catch(() => undefined);
  };

  const pauseCoachRtcMicrophoneForShadowAudio = async () => {
    const engine = coachRtcEngineRef.current;
    if (resolvedTaskMode !== "shadow" || !engine || !coachRtcStartedRef.current) return;
    if (coachRtcShadowAudioMutedRef.current) return;

    coachRtcShadowAudioMutedRef.current = true;
    await engine.stopAudioCapture?.().catch(() => undefined);
  };

  const resumeCoachRtcMicrophoneAfterShadowAudio = async () => {
    const engine = coachRtcEngineRef.current;
    if (!coachRtcShadowAudioMutedRef.current) return;
    coachRtcShadowAudioMutedRef.current = false;
    if (!engine || !coachRtcStartedRef.current || coachManualStopRef.current) return;

    await engine.startAudioCapture().catch(() => undefined);
  };

  const stopCoachRtcAgentSession = async () => {
    const session = coachRtcAgentSessionRef.current;
    const engine = coachRtcEngineRef.current;
    coachRtcAgentSessionRef.current = null;
    coachRtcStartedRef.current = false;
    coachRtcEngineRef.current = null;
    coachRtcShadowAudioMutedRef.current = false;
    clearCoachRemoteAudioActive();
    stopLocalStudentSpeechSubtitles();
    stopCoachRtcVisualTrack();

    if (session) {
      await fetch("/api/agent-rtc/stop", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          appId: session.appId,
          roomId: session.roomId,
          taskId: session.taskId,
        }),
      }).catch(() => undefined);
    }

    if (engine) {
      await engine.unpublishStream?.(3).catch(() => undefined);
      await engine.stopAudioCapture?.().catch(() => undefined);
      await engine.leaveRoom?.().catch(() => undefined);
      await safeDestroyCoachRtcEngine(engine);
    }
  };

  const notifyCoachRtcPageChanged = async () => {
    if (!coachRtcAgentSessionRef.current || !coachRtcStartedRef.current) return;

    const pageChangeToken = ++coachRtcPageChangeTokenRef.current;
    const isStalePageChange = () =>
      pageChangeToken !== coachRtcPageChangeTokenRef.current ||
      !coachRtcAgentSessionRef.current ||
      !coachRtcStartedRef.current ||
      coachManualStopRef.current;

    await interruptCoachRtcOutput();
    if (isStalePageChange()) return;

    const canvas = coachRtcVisualCanvasRef.current;
    if (canvas) {
      await drawCoachRtcVisualFrame(canvas).catch(() => false);
      const track = coachRtcVisualStreamRef.current?.getVideoTracks()[0] as
        | (MediaStreamTrack & { requestFrame?: () => void })
        | undefined;
      track?.requestFrame?.();
    }
    if (isStalePageChange()) return;

    if (resolvedTaskMode === "shadow") {
      scheduleCoachRtcShadowCurrentSentencePrompt();
      setCoachInterimText("Mia 已看到当前句，正在同步跟读句子。");
      return;
    }

    let intensivePageTurnLessonState = "";
    if (resolvedTaskMode === "intensive") {
      updateIntensiveLessonStep("round1_picture");
      intensivePageTurnLessonState = formatAgentLessonStatePrompt(buildIntensiveLessonState("round1_picture"));
    }

    const pageChangeContextPrompt = [
      "【翻页后的最新页面上下文】",
      `当前唯一有效页：${aiCoachPageLabel}`,
      buildCoachRtcLessonStatePrompt(),
      "这是静默上下文同步：只更新 RTC 智能体当前页状态，不要因为这条消息主动说话。",
      "旧页、封面、上一页、历史对话里的标题和目标词全部无效；下一次回答只能依据当前唯一有效页、当前屏幕画面和当前页可信原文。",
      resolvedTaskMode === "speaking"
        ? "看图说话翻页后：清空上一页目标词、上一页标题和封面提示；如果当前页可信原文没有 Spots，就不要继续讲封面 Spots，也不要让学生继续读 Spots。"
        : "",
    ].filter(Boolean).join("\n");

    const message = [
      `学生已经切换到${aiCoachPageLabel}。`,
      "现在只允许使用这次翻页后的最新页面上下文，忽略旧页、封面、上一页和历史对话中的旧目标词。",
      buildCoachRtcLessonStatePrompt(),
      resolvedTaskMode === "intensive"
        ? [
            intensivePageTurnLessonState,
            "请按照 Agent 陪学流程继续绘本精讲：第一轮先观察图片、完整朗读当前页/当前侧页原文、解释重点词句，再提出一次学生互动。不要等待学生再次提醒。",
            "如果是双页，必须先讲左页，等学生回应后再讲右页；不要把左右页放在一个长回答里。",
            "提出互动问题、要求学生朗读或提示翻页后，必须等待学生语音回复或真实翻页事件；如果没有学生语音回复，也没有翻页，就停止说话。",
          ].filter(Boolean).join("\n")
        : "请继续看图说话练习：只围绕当前唯一有效页，先引导学生观察和自己表达，不要直接给完整原文。清空上一页目标词和封面标题，不要继续讲封面或上一页。不要等待学生再次提醒。",
    ].join("\n");
    try {
      await sendCoachRtcAgentContextPrompt(pageChangeContextPrompt).catch(() => false);
      if (isStalePageChange()) return;
      const sent = await sendCoachRtcAgentControlMessage(message);
      setCoachInterimText(sent ? `已切换到${aiCoachPageLabel}，Mia 会看这一页。` : "");
    } catch (error) {
      setCoachError(error instanceof Error ? error.message : "RTC 翻页通知没有发送成功。");
    }
  };

  const beginCoachRtcSession = async () => {
    if (!pages.length) {
      throw new Error("请先打开练习资料，再开启实时语音。");
    }

    const lifecycleToken = coachRtcLifecycleTokenRef.current;
    const isStaleCoachRtcStart = () =>
      lifecycleToken !== coachRtcLifecycleTokenRef.current || coachManualStopRef.current;

    setCoachInterimText("正在创建 RTC 房间...");
    const sessionResponse = await fetch("/api/agent-rtc/session", {
      method: "POST",
    });
    const sessionPayload = (await sessionResponse.json().catch(() => ({}))) as
      | RtcAgentSession
      | { error?: string; code?: string };
    if (!sessionResponse.ok || !("token" in sessionPayload)) {
      const message =
        "error" in sessionPayload ? sessionPayload.error || "RTC 会话创建失败" : "RTC 会话创建失败";
      const error = new Error(message);
      error.name = "RtcSessionConfigError";
      throw error;
    }
    if (isStaleCoachRtcStart()) return;

    const rtcModule = await import("@volcengine/rtc");
    const VERTC = rtcModule.default;
    const MediaType = rtcModule.MediaType;
    const RoomProfileType = rtcModule.RoomProfileType;
    const StreamIndex = rtcModule.StreamIndex;
    const VideoSourceType = rtcModule.VideoSourceType;
    const engine = VERTC.createEngine(sessionPayload.appId) as CoachRtcEngine;

    coachRtcEngineRef.current = engine;
    coachRtcAgentSessionRef.current = sessionPayload;
    coachRtcStartedRef.current = false;
    coachRtcTranscriptIdsRef.current.clear();
    coachRtcLiveTranscriptIdsRef.current = {};
    coachRtcRecentTranscriptRef.current = {};
    coachRecentSpeechEchoTextsRef.current = [];

    const playRemoteAudio = (userId?: string) => {
      if (!userId || userId === sessionPayload.userId) return;
      void engine.subscribeStream(userId, MediaType.AUDIO).catch(() => undefined);
      void engine.play(userId, MediaType.AUDIO).catch(() => undefined);
    };

    engine.on(VERTC.events.onUserPublishStream, (rawEvent: unknown) => {
      const event = rawEvent as { userId?: string; mediaType?: number };
      if (typeof event.mediaType === "number" && !(event.mediaType & MediaType.AUDIO)) return;
      if (resolvedTaskMode === "shadow") {
        stopShadowAudioPlayback();
      }
      markCoachRemoteAudioActive(5200);
      setCoachInterimText("Mia 已进入语音房间，正在播放回复...");
      playRemoteAudio(event.userId);
    });

    engine.on(VERTC.events.onRemoteAudioFirstFrame, (rawEvent: unknown) => {
      const event = rawEvent as { userId?: string };
      if (event.userId && event.userId !== sessionPayload.userId) {
        if (resolvedTaskMode === "shadow") {
          stopShadowAudioPlayback();
        }
        markCoachRemoteAudioActive(5200);
        setCoachInterimText("正在播放 Mia 的声音...");
      }
    });

    engine.on(VERTC.events.onSubtitleMessageReceived, (...rawEvents: unknown[]) => {
      const subtitles = normalizeCoachRtcSubtitleItems(rawEvents);
      subtitles.forEach((subtitle) => {
        const userId = getCoachRtcUserId(subtitle);
        const text = extractCoachRtcMessageText(subtitle);
        if (!text) return;
        const role: AiCoachMessage["role"] = inferCoachVoiceSubtitleRole(
          subtitle,
          sessionPayload,
          userId === sessionPayload.userId ? "student" : "coach"
        );
        const correctedText =
          role === "student" ? correctCoachRtcTranscriptAgainstCurrentText(text) : text;
        if (role === "student" && isLikelyCoachEchoLocalStudentTranscript(correctedText)) return;
        const sequence =
          typeof subtitle.sequence === "number"
            ? subtitle.sequence
            : typeof subtitle.seq === "number"
              ? subtitle.seq
              : Date.now();
        const definite =
          typeof subtitle.definite === "boolean"
            ? subtitle.definite
            : typeof subtitle.isFinal === "boolean"
              ? subtitle.isFinal
              : typeof subtitle.final === "boolean"
                ? subtitle.final
                : false;
        const transcriptId = getStableCoachRtcTranscriptId({
          source: `sdk_${userId || role}`,
          role,
          text: correctedText,
          sequence,
          definite,
        });
        upsertCoachRtcTranscriptMessage({
          id: transcriptId,
          role,
          text: correctedText,
          definite,
        });
        if (role === "student") {
          consumePendingCoachActionIfConfirmed(correctedText);
          setCoachInterimText("Mia 正在听...");
        } else {
          markCoachRemoteAudioActive(definite ? 1800 : 3600);
          if (definite) applyCoachUiActionFromReply(text);
          setCoachInterimText("正在播放 Mia 的声音...");
        }
        if (definite) advanceIntensiveLessonStepFromSubtitle(role, correctedText);
      });
    });

    const handleCoachRtsSubtitleMessage = (rawEvent: unknown, fallbackRole: AiCoachMessage["role"]) => {
      const event = rawEvent as { userId?: string; message?: unknown };
      const items = collectCoachRtsSubtitleItems(
        event.message ?? rawEvent,
        sessionPayload,
        event.userId === sessionPayload.userId ? "student" : fallbackRole
      );
      items.forEach((item, index) => {
        const correctedText =
          item.role === "student" ? correctCoachRtcTranscriptAgainstCurrentText(item.text) : item.text;
        if (item.role === "student" && isLikelyCoachEchoLocalStudentTranscript(correctedText)) return;
        const transcriptId = getStableCoachRtcTranscriptId({
          source: `rts_${event.userId || "room"}`,
          role: item.role,
          text: correctedText,
          sequence: `${item.sequence}_${index}`,
          definite: item.definite,
        });
        upsertCoachRtcTranscriptMessage({
          id: transcriptId,
          role: item.role,
          text: correctedText,
          definite: item.definite,
        });
        if (item.role === "student") {
          consumePendingCoachActionIfConfirmed(correctedText);
        } else {
          markCoachRemoteAudioActive(item.definite ? 1800 : 3600);
          if (item.definite) applyCoachUiActionFromReply(correctedText);
        }
        if (item.definite) advanceIntensiveLessonStepFromSubtitle(item.role, correctedText);
      });
      if (items.length) {
        setCoachInterimText(
          items.some((item) => item.role === "coach") ? "正在播放 Mia 的声音..." : "Mia 正在听..."
        );
      } else {
        setCoachInterimText("已收到语音消息，正在整理字幕。");
        console.info("[storyflow-rtc] unparsed RTS message", rawEvent);
      }
    };

    engine.on(VERTC.events.onRoomMessageReceived, (rawEvent: unknown) => {
      handleCoachRtsSubtitleMessage(rawEvent, "coach");
    });

    engine.on(VERTC.events.onUserMessageReceived, (rawEvent: unknown) => {
      handleCoachRtsSubtitleMessage(rawEvent, "coach");
    });

    engine.on(VERTC.events.onRoomBinaryMessageReceived, (rawEvent: unknown) => {
      const event = rawEvent as { userId?: string; message?: unknown };
      handleCoachRtsSubtitleMessage(
        {
          ...event,
          message: decodeCoachRtcBinaryMessage(event.message),
        },
        "coach"
      );
    });

    engine.on(VERTC.events.onUserBinaryMessageReceived, (rawEvent: unknown) => {
      const event = rawEvent as { userId?: string; message?: unknown };
      handleCoachRtsSubtitleMessage(
        {
          ...event,
          message: decodeCoachRtcBinaryMessage(event.message),
        },
        "coach"
      );
    });

    engine.on(VERTC.events.onSubtitleStateChanged, (rawEvent: unknown) => {
      const event = rawEvent as { errorMessage?: string; errorCode?: string };
      if (event.errorMessage || event.errorCode) {
        setCoachInterimText(`字幕同步暂不可用：${event.errorMessage || event.errorCode}`);
      }
    });

    engine.on(VERTC.events.onAutoplayFailed, (rawEvent: unknown) => {
      const event = rawEvent as { resume?: () => Promise<void> };
      void event.resume?.().catch(() => {
        setCoachError("浏览器阻止了自动播放，请再点击一次实时语音按钮或页面任意位置后重试。");
      });
    });

    setCoachInterimText("正在加入 RTC 房间...");
    let hasVisualTrack = false;
    try {
      setCoachInterimText("正在准备当前页面视觉流...");
      hasVisualTrack = await startCoachRtcVisualTrack(engine, StreamIndex, VideoSourceType);
    } catch {
      hasVisualTrack = false;
    }
    if (isStaleCoachRtcStart()) {
      await stopCoachRtcAgentSession();
      return;
    }

    await engine.joinRoom(
      sessionPayload.token,
      sessionPayload.roomId,
      {
        userId: sessionPayload.userId,
      },
      {
        isAutoPublish: false,
        isAutoSubscribeAudio: true,
        isAutoSubscribeVideo: false,
        roomProfileType: RoomProfileType.chatRoom,
      }
    );

    setCoachInterimText("正在打开麦克风...");
    await engine.startAudioCapture();
    await engine.publishStream(hasVisualTrack ? MediaType.AUDIO_AND_VIDEO : MediaType.AUDIO);
    await engine.startSubtitle?.({ mode: 0 }).catch((error: unknown) => {
      setCoachInterimText(
        error instanceof Error
          ? `字幕同步暂不可用：${error.message}`
          : "字幕同步暂不可用，请检查 RTC 字幕服务配置。"
      );
    });
    if (isStaleCoachRtcStart()) {
      await stopCoachRtcAgentSession();
      return;
    }

    setCoachInterimText("正在邀请 Mia 进入 RTC 房间...");
    if (resolvedTaskMode === "shadow") {
      stopShadowAudioPlayback();
    }
    const welcomeMessage = buildCoachRtcWelcomeMessage();
    coachExpectedSpeechRef.current = welcomeMessage;
    const shouldMarkShadowRulesIntroduced =
      resolvedTaskMode === "shadow" && !hasIntroducedShadowRtcRulesRef.current;
    const shouldMarkIntensiveRulesIntroduced =
      resolvedTaskMode === "intensive" && !hasIntroducedIntensiveRtcRulesRef.current;
    const startResponse = await fetch("/api/agent-rtc/start", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...sessionPayload,
        lessonState: buildCoachRtcLessonStatePrompt(),
        welcomeMessage,
      }),
    });
    const startPayload = (await startResponse.json().catch(() => ({}))) as { error?: string };
    if (!startResponse.ok) {
      throw new Error(startPayload.error || "StartVoiceChat failed");
    }
    if (isStaleCoachRtcStart()) {
      await stopCoachRtcAgentSession();
      return;
    }
    if (shouldMarkShadowRulesIntroduced) {
      hasIntroducedShadowRtcRulesRef.current = true;
    }
    if (shouldMarkIntensiveRulesIntroduced) {
      hasIntroducedIntensiveRtcRulesRef.current = true;
    }

    coachRtcStartedRef.current = true;
    coachSessionActiveRef.current = true;
    coachManualStopRef.current = false;
    setIsCoachSessionActive(true);
    setIsCoachOpen(true);
    startLocalStudentSpeechSubtitles();
    setCoachPanelPosition(getRightMiddleCoachPanelPosition(true));
    setCoachInterimText(
      hasVisualTrack
        ? "RTC 智能体语音已开启，Mia 正在接收当前页面画面。"
        : "RTC 智能体语音已开启，但当前页面视觉流未发布。"
    );
  };

  const askAiCoach = async (rawMessage: string) => {
    const message = rawMessage.replace(/\s+/g, " ").trim();
    if (!message || coachRequestInFlightRef.current) return;

    setCoachError(null);
    setCoachInputText("");
    setCoachInterimText("");
    upsertCoachRtcTranscriptMessage({
      id: `rtc_subtitle_student_text_${Date.now()}`,
      role: "student",
      text: message,
      definite: true,
    });

    if (!coachRtcStartedRef.current) {
      setCoachError("请先开启实时语音，再让 Mia 用 RTC 回答。");
      return;
    }

    if (
      pendingCoachAction &&
      isStudentConfirmingCoachAction(message) &&
      normalizeCoachIntentText(message).length <= 24
    ) {
      consumePendingCoachActionIfConfirmed(message);
      return;
    }

    coachRequestInFlightRef.current = true;
    setIsCoachThinking(true);
    setCoachInterimText("已发送给 Mia，等待 RTC 回复...");

    try {
      const sent = await sendCoachRtcAgentControlMessage(
        [
          `学生刚刚在${aiCoachPageLabel}问：${message}`,
          buildCoachRtcLessonStatePrompt(),
          "请只用当前 RTC 智能体语音回答。不要启动额外语音，不要跳到其他练习板块，不要编当前页之外的内容。",
        ].join("\n")
      );
      setCoachInterimText(sent ? "Mia 正在看当前页回答..." : "");
      if (!sent) {
        setCoachError("RTC 智能体尚未准备好，请重新开启实时语音。");
      }
    } catch (coachRequestError) {
      setCoachError(
        coachRequestError instanceof Error ? coachRequestError.message : "RTC 智能体消息发送失败。"
      );
      setCoachInterimText("");
    } finally {
      coachRequestInFlightRef.current = false;
      setIsCoachThinking(false);
    }
  };

  const coachFriendlyError = coachError
    ? coachError.includes("没有返回结果") || coachError.includes("请再说一次")
      ? "我刚才没听清，可以再说一次。"
      : coachError
    : "";
  const coachQuestionSuggestions =
    resolvedTaskMode === "shadow"
      ? [
          "我哪里读错了？",
          "发音准不准？",
          "流畅度怎么样？",
          "继续下一句",
        ]
      : [
          "第一句原文怎么说？",
          "给我一点原文提示",
          "下一句原文怎么说？",
          "帮我按顺序回忆原文",
        ];
  const coachSubtitleMessages = coachMessages.filter(isVoiceSubtitleMessage).slice(-12);
  const getCoachVoiceSubtitleRecords = (): StoryflowVoiceSubtitleRecord[] => {
    const seen = new Set<string>();
    return coachMessages
      .filter(isVoiceSubtitleMessage)
      .map((message) => ({
        id: message.id,
        role: message.role,
        text: normalizeAiContextText(message.text, 1200),
        createdAt: message.createdAt || Date.now(),
      }))
      .filter((message) => {
        if (!message.text || seen.has(message.id)) return false;
        seen.add(message.id);
        return true;
      })
      .slice(-80);
  };

  useEffect(() => {
    const node = coachConversationScrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [coachSubtitleMessages.length, coachInterimText]);

  const aiCoachPanel =
    resolvedTaskMode === "shadow" || resolvedTaskMode === "speaking" || resolvedTaskMode === "intensive" ? (
      <div
        className="fixed z-[95] w-[min(390px,calc(100vw-2rem))]"
        style={{ right: coachPanelPosition.x, bottom: coachPanelPosition.y }}
        onMouseMove={handleCoachDragMove}
        onMouseUp={handleCoachDragEnd}
        onMouseLeave={handleCoachDragEnd}
      >
        {isCoachOpen ? (
          <div className="flex max-h-[calc(100vh-2rem)] flex-col overflow-hidden rounded-[1.6rem] border border-sky-100 bg-white/94 shadow-[0_24px_70px_rgba(14,116,144,0.2)] backdrop-blur-xl">
            <div
              onMouseDown={handleCoachDragStart}
              className="flex cursor-move select-none items-center justify-between gap-3 bg-gradient-to-r from-sky-500 to-blue-600 px-4 py-3 text-white"
            >
              <div>
                <p className="text-[0.7rem] font-black uppercase tracking-[0.2em] text-white/75">
                  Reading Buddy
                </p>
                <p className="text-base font-black">
                  语音伴读 · Mia老师 · {isCoachSessionActive ? "连续对话中" : "待开始"}
                </p>
              </div>
              <button
                type="button"
                onMouseDown={(event) => event.stopPropagation()}
                onClick={() => {
                  stopCoachSession();
                  setIsCoachOpen(false);
                }}
                className="grid h-8 w-8 place-items-center rounded-full bg-white/18 text-lg font-black transition hover:bg-white/25"
                aria-label="关闭语音伴读 Mia老师"
              >
                ×
              </button>
            </div>

            <div
              ref={coachConversationScrollRef}
              className="min-h-0 max-h-[260px] space-y-4 overflow-y-auto rounded-b-[1rem] bg-sky-50/70 px-4 py-3"
            >
              {coachSubtitleMessages.length ? null : (
                <div className="flex min-h-[120px] items-center justify-center text-center text-sm font-bold leading-6 text-slate-400">
                  实时语音字幕会显示在这里。等待 RTC 语音字幕返回中。
                </div>
              )}
              {coachSubtitleMessages.map((message) => {
                const isStudent = message.role === "student";
                return (
                  <div
                    key={message.id}
                    className={`flex gap-2 ${isStudent ? "justify-end" : "justify-start"}`}
                  >
                    {!isStudent ? (
                      <div className="mt-0.5 h-7 w-7 shrink-0 rounded-full bg-[linear-gradient(135deg,#f8c6ff,#c7e7ff)]" />
                    ) : null}
                    <div className={`max-w-[82%] ${isStudent ? "text-right" : "text-left"}`}>
                      <div className="mb-1 text-xs font-bold text-slate-500">
                        {isStudent ? "我" : "Mia"}
                      </div>
                      <div
                        className={`rounded-[1rem] px-3.5 py-2.5 text-sm font-semibold leading-6 shadow-sm ${
                          isStudent
                            ? "bg-white text-slate-700"
                            : "border border-blue-100 bg-white/95 text-slate-800"
                        }`}
                      >
                        {message.text}
                      </div>
                    </div>
                    {isStudent ? (
                      <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-slate-200 text-xs font-black text-slate-500">
                        我
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>

            <div className="border-t border-sky-50 px-4 py-3">
              {coachFriendlyError ? (
                <div className="mb-2 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs font-semibold leading-5 text-amber-700">
                  {coachFriendlyError}
                </div>
              ) : null}

              <div className="mb-3 rounded-2xl bg-[linear-gradient(135deg,rgba(239,246,255,0.95),rgba(224,242,254,0.9))] px-3 py-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-xs font-black text-slate-600">你可以这样问 AI</p>
                  <span className="text-[11px] font-semibold text-slate-400">{aiCoachPageLabel}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {coachQuestionSuggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => void askAiCoach(suggestion)}
                      disabled={isCoachThinking}
                      className="rounded-full border border-sky-100 bg-white/85 px-3 py-1.5 text-left text-[11px] font-bold text-sky-700 shadow-sm transition hover:-translate-y-0.5 hover:border-sky-200 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={toggleCoachSession}
                  className={`grid h-12 w-12 shrink-0 place-items-center rounded-full text-xl text-white shadow-lg transition ${
                    isCoachSessionActive
                      ? "bg-emerald-500 shadow-emerald-200"
                      : "bg-blue-600 shadow-blue-200 hover:bg-blue-700"
                  }`}
                  aria-label={
                    isCoachSpeaking ? "打断 AI 并开始说话" : isCoachSessionActive ? "停止连续语音对话" : "开始连续语音对话"
                  }
                >
                  {isCoachSpeaking ? "↯" : isCoachSessionActive ? "●" : "🎙"}
                </button>
                <div className="hidden min-w-[4.6rem] items-center text-xs font-black text-slate-500 sm:flex">
                  {isCoachSpeaking
                    ? "可打断"
                    : isCoachThinking
                    ? "AI 回复中"
                    : isCoachListening
                      ? "正在听"
                      : isCoachSessionActive
                        ? "等待说话"
                        : "未开始"}
                </div>
                <input
                  value={coachInputText}
                  onChange={(event) => setCoachInputText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void askAiCoach(coachInputText);
                    }
                  }}
                  placeholder="也可以打字问 AI..."
                  className="min-w-0 flex-1 rounded-full border border-sky-100 bg-sky-50/60 px-4 py-2 text-sm font-semibold text-slate-700 outline-none transition focus:border-sky-300 focus:bg-white"
                />
                <button
                  type="button"
                  onClick={() => void askAiCoach(coachInputText)}
                  disabled={isCoachThinking || !coachInputText.trim()}
                  className="rounded-full bg-sky-600 px-4 text-sm font-black text-white shadow-lg shadow-sky-200 transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  发送
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setCoachPanelPosition(getRightMiddleCoachPanelPosition(true));
              setIsCoachOpen(true);
            }}
            className="ml-auto flex items-center gap-2 rounded-full bg-gradient-to-r from-sky-500 to-blue-600 px-5 py-3 text-base font-black text-white shadow-[0_18px_42px_rgba(14,116,144,0.28)] transition hover:-translate-y-0.5 hover:shadow-[0_22px_50px_rgba(14,116,144,0.34)]"
          >
            <span className="grid h-8 w-8 place-items-center rounded-full bg-white/18">AI</span>
            语音伴读 · Mia老师
          </button>
        )}
      </div>
    ) : null;

  const stopShadowAudioPlayback = (options: { resumeRtcMic?: boolean } = {}) => {
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
    if (options.resumeRtcMic !== false) {
      void resumeCoachRtcMicrophoneAfterShadowAudio();
    }
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
      void resumeCoachRtcMicrophoneAfterShadowAudio();
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

  const prepareCoachRtcForShadowSourceAudio = async () => {
    if (!coachRtcStartedRef.current) return;
    await interruptCoachRtcOutput();
    await pauseCoachRtcMicrophoneForShadowAudio();
  };

  const handlePlayShadowAudio = () => {
    if (isPlayingShadowAudio) {
      stopShadowAudioPlayback();
      return;
    }
    if (!currentShadowAudioUnits.length) return;
    void (async () => {
      stopShadowAudioPlayback();
      await prepareCoachRtcForShadowSourceAudio();
      setIsPlayingShadowAudio(true);
      playShadowAudioSequence(currentShadowAudioUnits, 0, shadowAudioTokenRef.current);
    })();
  };

  const startCurrentShadowAudioPlayback = async () => {
    if (!currentShadowAudioUnits.length) return false;
    stopShadowAudioPlayback();
    await prepareCoachRtcForShadowSourceAudio();
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

    const voiceSubtitles = getCoachVoiceSubtitleRecords();
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
            step.focus,
            Boolean(shadowPairEditorModeByPage[step.pageIndex])
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
          voiceSubtitles,
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
            voiceSubtitles,
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

  const startSpeakingPractice = () => {
    if (!page) return;
    setHintStage(0);
    setPracticeDraft({
      startedAt: Date.now(),
      promptRevealCount: 0,
      originalRevealCount: 0,
      visitedPageIndexes: [page.pageIndex],
      promptViewedTexts: [],
      originalViewedTexts: [],
    });
    setPracticeStatus("active");
  };

  const generateAndSaveSpeakingAssessment = async (
    record: StoryflowSpeakingPracticeRecord
  ) => {
    if (!document || !assignment) return;

    setIsGeneratingSpeakingAssessment(true);
    setSpeakingAssessmentError(null);
    try {
      const response = await fetch("/api/storyflow/score-speaking-practice", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          studentName: session.displayName || session.username,
          bookName: document.analysis.title || document.sourceName || "",
          tutorName: assignment.teacherDisplayName || assignment.teacherUsername,
          storySummary: document.analysis.summary || "",
          fullText: document.analysis.fullText || "",
          keywords: document.analysis.keywords || [],
          characters: document.analysis.characters || [],
          pageTexts: pages.map((item, index) => ({
            pageIndex: index,
            text: item.visibleText || "",
          })),
          coachHistory: coachHistoryForAssessment,
          practiceRecord: record,
        }),
      });
      const payload = (await response.json()) as {
        result?: AnalysisResult;
        error?: string;
      };
      if (!response.ok || !payload.result) {
        throw new Error(payload.error || "看图说话点评生成失败");
      }

      const updatedAssignment = updateStoryflowAssignment(assignment.id, (current) => ({
        ...current,
        speakingSubmission: {
          completedAt: Date.now(),
          latestPracticeRecord: record,
          studentAssessment: payload.result || null,
          teacherAssessment: current.speakingSubmission?.teacherAssessment || null,
          teacherNote: current.speakingSubmission?.teacherNote || "",
        },
      }));
      if (updatedAssignment) {
        setAssignment(updatedAssignment);
      }
      appendCoachMessage({
        role: "coach",
        text: "我已经根据刚才的看图说话练习生成了点评和等级，可以在得分点评里查看。",
      });
    } catch (error) {
      setSpeakingAssessmentError(
        error instanceof Error ? error.message : "看图说话点评生成失败"
      );
      const updatedAssignment = updateStoryflowAssignment(assignment.id, (current) => ({
        ...current,
        speakingSubmission: {
          completedAt: Date.now(),
          latestPracticeRecord: record,
          studentAssessment: current.speakingSubmission?.studentAssessment || null,
          teacherAssessment: current.speakingSubmission?.teacherAssessment || null,
          teacherNote: current.speakingSubmission?.teacherNote || "",
        },
      }));
      if (updatedAssignment) {
        setAssignment(updatedAssignment);
      }
      appendCoachMessage({
        role: "coach",
        text: "这次练习记录已经保存了，但 AI 点评暂时生成失败。可以稍后再试，或请老师查看记录。",
      });
    } finally {
      setIsGeneratingSpeakingAssessment(false);
    }
  };

  const handleFinishPractice = () => {
    if (
      practiceStatus !== "active" ||
      !practiceDraft ||
      !page ||
      !document ||
      !assignment ||
      isGeneratingSpeakingAssessment
    ) {
      return;
    }

    const durationSec = Math.max(1, Math.round((Date.now() - practiceDraft.startedAt) / 1000));
    const practicedPages = practiceDraft.visitedPageIndexes.length;
    const { score, ratingLabel } = scoreSpeakingPractice({
      durationSec,
      promptRevealCount: practiceDraft.promptRevealCount,
      originalRevealCount: practiceDraft.originalRevealCount,
      totalPages: pages.length,
      practicedPages,
    });
    const voiceSubtitles = getCoachVoiceSubtitleRecords();

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
      voiceSubtitles,
    };

    const nextRecords = [record, ...practiceRecords].slice(0, 30);
    setSpeakingPracticeRecords(nextRecords);
    setPracticeStatus("idle");
    setHintStage(0);
    setPracticeDraft(null);

    updateTeacherStoryflowDocument(assignment.teacherUsername, document.id, (current) => ({
      ...current,
      speakingPracticeRecords: nextRecords,
    }));

    appendCoachMessage({
      role: "coach",
      text: "收到，我会根据刚才的看图说话练习，自动生成本次评分和点评。",
    });
    void generateAndSaveSpeakingAssessment(record);
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

    void startCurrentShadowAudioPlayback().then((started) => {
      if (started) {
        lastShadowAutoPlayKeyRef.current = shadowAutoPlayKey;
      }
    });
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
    hasIntroducedShadowRtcRulesRef.current = false;
  }, [assignmentId]);

  useEffect(() => {
    if (view === "overview") {
      stopShadowAudioPlayback();
      stopShadowRecording();
      if (
        coachSessionActiveRef.current ||
        coachRtcStartedRef.current ||
        coachRtcStartInFlightRef.current
      ) {
        stopCoachSession();
      }
      lastCoachRtcTaskModeRef.current = null;
    }
  }, [view]);

  useEffect(() => {
    const previousMode = lastCoachRtcTaskModeRef.current;
    const isCoachRtcMode =
      resolvedTaskMode === "speaking" || resolvedTaskMode === "shadow" || resolvedTaskMode === "intensive";
    const wasCoachRtcMode = previousMode === "speaking" || previousMode === "shadow" || previousMode === "intensive";

    if (previousMode && previousMode !== resolvedTaskMode && wasCoachRtcMode) {
      stopCoachSession();
    } else if (!isCoachRtcMode && (coachSessionActiveRef.current || coachRtcStartInFlightRef.current)) {
      stopCoachSession();
    }

    lastCoachRtcTaskModeRef.current = resolvedTaskMode;
  }, [resolvedTaskMode]);

  useEffect(() => {
    if (
      (resolvedTaskMode !== "speaking" && resolvedTaskMode !== "shadow" && resolvedTaskMode !== "intensive") ||
      !coachRtcStartedRef.current
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      void notifyCoachRtcPageChanged();
    }, 180);
    return () => window.clearTimeout(timer);
  }, [
    resolvedTaskMode,
    safeIndex,
    safeShadowStepIndex,
    hintStage,
    aiCoachPageLabel,
    aiCoachPageText,
    aiCoachVisiblePrompt,
  ]);

  useEffect(() => {
    if (
      resolvedTaskMode !== "speaking" ||
      !page ||
      !document ||
      !assignment ||
      practiceStatus === "active" ||
      practiceDraft ||
      isGeneratingSpeakingAssessment
    ) {
      return;
    }

    startSpeakingPractice();
  }, [
    assignment,
    document,
    isGeneratingSpeakingAssessment,
    page,
    practiceDraft,
    practiceStatus,
    resolvedTaskMode,
  ]);

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
    const coreVocabulary = storyKeywords.slice(0, 8);
    const overviewTaskCardMeta: Record<
      TaskMode,
      {
        icon: Parameters<typeof OverviewIcon>[0]["kind"];
        badgeClass: string;
        dotClass: string;
        ringClass: string;
      }
    > = {
      animation: {
        icon: "animation",
        badgeClass: "bg-[linear-gradient(180deg,#61b9ff_0%,#2f6df2_100%)] text-white",
        dotClass: "bg-[#5b87e8]",
        ringClass: "shadow-[0_18px_34px_rgba(47,109,242,0.28)]",
      },
      intensive: {
        icon: "intensive",
        badgeClass: "bg-[linear-gradient(180deg,#7dd3fc_0%,#0ea5e9_100%)] text-white",
        dotClass: "bg-[#0ea5e9]",
        ringClass: "shadow-[0_18px_34px_rgba(14,165,233,0.24)]",
      },
      shadow: {
        icon: "shadow",
        badgeClass: "bg-[linear-gradient(180deg,#ffa65f_0%,#ff6f38_100%)] text-white",
        dotClass: "bg-[#ff8a32]",
        ringClass: "shadow-[0_18px_34px_rgba(255,111,56,0.25)]",
      },
      speaking: {
        icon: "speaking",
        badgeClass: "bg-[linear-gradient(180deg,#88e98d_0%,#28bd46_100%)] text-white",
        dotClass: "bg-[#58c964]",
        ringClass: "shadow-[0_18px_34px_rgba(40,189,70,0.24)]",
      },
      assessment: {
        icon: "assessment",
        badgeClass: "bg-[linear-gradient(180deg,#ffd764_0%,#ffb11f_100%)] text-white",
        dotClass: "bg-[#f6b42b]",
        ringClass: "shadow-[0_18px_34px_rgba(255,177,31,0.24)]",
      },
    };

    return (
      <div className="relative h-[100dvh] overflow-hidden bg-[linear-gradient(135deg,#eaf6ff_0%,#f8fbff_34%,#e8f4ff_66%,#d5eaff_100%)]">
        <div className="pointer-events-none absolute -right-[11rem] -top-[13rem] h-[31rem] w-[31rem] rounded-full bg-[#9fcbff]/28 blur-2xl" />
        <div className="pointer-events-none absolute -left-[10rem] bottom-[12rem] h-[24rem] w-[24rem] rounded-full bg-white/58 blur-2xl" />
        <button
          type="button"
          onClick={() => router.push("/tasks")}
          className="absolute left-5 top-5 z-20 flex h-10 w-10 items-center justify-center rounded-full border border-white/85 bg-white/78 text-blue-500 shadow-[0_14px_26px_rgba(105,138,182,0.16)] backdrop-blur-xl transition hover:-translate-x-0.5 hover:bg-white md:left-8 md:top-7 lg:left-12"
          aria-label="返回任务列表"
          title="返回任务列表"
        >
          <OverviewIcon kind="back" className="h-5 w-5" />
        </button>

        <div className="mx-auto flex h-full max-w-[1720px] flex-col justify-center gap-[clamp(0.8rem,2vh,1.5rem)] px-5 py-[clamp(1rem,3vh,2rem)] md:px-9 lg:px-12">

          <div className="relative h-[clamp(20rem,51vh,29.5rem)] shrink-0 overflow-hidden rounded-[2.35rem] border border-white/78 bg-white/54 px-[clamp(1.5rem,3vw,3.5rem)] py-[clamp(1.4rem,3vh,2.5rem)] shadow-[0_30px_90px_rgba(117,151,196,0.2)] backdrop-blur-2xl">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_90%_16%,rgba(255,255,255,0.9),transparent_32%),radial-gradient(circle_at_100%_100%,rgba(211,235,255,0.72),transparent_30%)]" />
            <div className="relative flex h-full flex-col gap-6 lg:flex-row lg:items-center lg:gap-[clamp(2rem,4vw,4rem)]">
              <div className="mx-auto aspect-square h-full max-h-[23rem] shrink-0 overflow-hidden rounded-[1.85rem] bg-white shadow-[0_24px_54px_rgba(102,135,183,0.22)] lg:mx-0">
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

              <div className="min-w-0 flex-1">
                <p className="text-[1rem] font-black uppercase tracking-[0.42em] text-blue-500">
                  STORYFLOW
                </p>
                <h1 className="mt-[clamp(1rem,2.2vh,1.5rem)] text-[clamp(2.7rem,5.4vw,5.15rem)] font-black leading-[0.95] tracking-normal text-[#080d34]">
                  {assignment.documentTitle}
                </h1>
                <p className="mt-[clamp(1rem,2.5vh,2rem)] line-clamp-2 max-w-4xl text-[clamp(1rem,1.55vw,1.42rem)] font-semibold leading-[1.55] text-slate-600">
                  {document.analysis.summary || "老师已为你准备好整本绘本任务，可以从下面选择不同练习。"}
                </p>

                <div className="mt-[clamp(1rem,2.4vh,1.9rem)] flex flex-wrap items-center gap-3">
                  <span className="rounded-full border border-blue-200/80 bg-blue-50/50 px-5 py-2 text-[1rem] font-black text-blue-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.82)]">
                    核心词汇
                  </span>
                  {coreVocabulary.length ? (
                    coreVocabulary.slice(0, 4).map((item) => (
                      <span
                        key={item}
                        className="rounded-full border border-slate-200/80 bg-white/54 px-5 py-2 text-[1rem] font-bold text-slate-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.86)]"
                      >
                        {item}
                      </span>
                    ))
                  ) : (
                    <span className="rounded-full border border-slate-200/80 bg-white/54 px-5 py-2 text-[1rem] font-bold text-slate-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.86)]">
                      暂无
                    </span>
                  )}
                </div>

                <div className="mt-[clamp(1rem,2.4vh,1.9rem)] flex flex-wrap items-center gap-5 text-[1.08rem] font-bold text-slate-600">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full border border-white/86 bg-white/58 text-blue-500 shadow-[0_15px_30px_rgba(105,138,182,0.16)]">
                    <OverviewIcon kind="teacher" className="h-6 w-6" />
                  </div>
                  <span>老师：{assignment.teacherDisplayName}</span>
                  <span className="text-slate-400">•</span>
                  <span>学生：{assignment.studentDisplayName}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="relative shrink-0">
            <div className="grid grid-cols-5 gap-[clamp(0.45rem,1.2vw,1.25rem)]">
              {TASK_MODE_META.map((item) => {
                const modeMeta = overviewTaskCardMeta[item.key];
                return (
                  <Link
                    key={item.key}
                    href={`/tasks/${assignmentId}/${item.key}`}
                    className="group relative h-[clamp(12rem,27vh,17rem)] overflow-hidden rounded-[1.75rem] border border-white/82 bg-white/54 px-[clamp(0.65rem,1.45vw,1.5rem)] py-[clamp(1.35rem,3vh,2rem)] text-center shadow-[0_22px_56px_rgba(117,151,196,0.16)] backdrop-blur-2xl transition hover:-translate-y-1 hover:bg-white/66 hover:shadow-[0_28px_68px_rgba(99,132,181,0.22)]"
                  >
                    <span
                      className={`absolute right-6 top-6 h-3 w-3 rounded-full ${modeMeta.dotClass} shadow-[0_0_0_4px_rgba(255,255,255,0.52)]`}
                    />
                    <div
                      className={`mx-auto flex h-[clamp(4.2rem,8vh,5rem)] w-[clamp(4.2rem,8vh,5rem)] items-center justify-center rounded-full ${modeMeta.badgeClass} ${modeMeta.ringClass}`}
                    >
                      <OverviewIcon kind={modeMeta.icon} className="h-[clamp(2.1rem,4vh,2.5rem)] w-[clamp(2.1rem,4vh,2.5rem)]" />
                    </div>
                    <div className="mt-[clamp(1rem,2.4vh,1.5rem)]">
                      <p className="text-[clamp(1.15rem,1.55vw,1.4rem)] font-black tracking-normal text-[#0b1438]">
                        {item.label}
                      </p>
                      <p className="mx-auto mt-[clamp(0.45rem,1.5vh,1rem)] line-clamp-2 max-w-[13rem] text-[clamp(0.78rem,1vw,0.96rem)] font-semibold leading-6 text-slate-500">
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

  if (resolvedTaskMode === "speaking" || resolvedTaskMode === "intensive") {
    const isIntensiveMode = resolvedTaskMode === "intensive";
    const speakingCoachPrompts = isIntensiveMode
      ? [
          "请精讲这一页",
          "带我读原文",
          "问我一个问题",
        ]
      : [
          "第一句原文怎么说？",
          "给我一点原文提示",
          "下一句原文怎么说？",
        ];

    return (
      <div className="box-border h-[100dvh] overflow-hidden bg-[linear-gradient(180deg,#edf7ff,#f7fbff)] px-3 py-2">
        <div
          ref={coachCaptureRef}
          className="mx-auto flex h-full max-w-[1540px] flex-col overflow-hidden rounded-[1.35rem] border border-sky-100 bg-white/94 shadow-[0_24px_70px_rgba(120,149,188,0.18)]"
        >
          <header className="grid h-[52px] shrink-0 grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-2 border-b border-sky-100/80 px-4 py-1">
            <button
              type="button"
              onClick={() => router.back()}
              className="flex h-9 w-9 items-center justify-center rounded-2xl bg-white/90 text-sky-500 shadow-[0_10px_24px_rgba(120,149,188,0.16)] transition hover:-translate-y-0.5 hover:bg-white"
              aria-label="返回上一页"
              title="返回"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 12H8" />
                <path d="m12 8-4 4 4 4" />
              </svg>
            </button>
            <div className="flex min-w-0 items-center gap-2 rounded-full border border-sky-100 bg-white/76 px-3 py-1.5 shadow-[0_10px_26px_rgba(120,149,188,0.09)]">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-blue-50 text-blue-500">
                <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 20a8 8 0 1 0-8-8" />
                  <path d="M12 12 18 6" />
                  <path d="M15 6h3v3" />
                </svg>
              </span>
              <p className="shrink-0 text-sm font-black text-blue-600">
                {isIntensiveMode ? "精讲目标" : "练习目标"}
              </p>
              <p className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-600">
                {isIntensiveMode
                  ? "老师上传资料后，AI 老师先分析当前页，再陪孩子提问、讲解和巩固。"
                  : `${practiceSummaryText} 想不起来时，再按顺序领取提示，不要一开始就看答案。`}
              </p>
              <span className="shrink-0 rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-black text-blue-500">
                {isIntensiveMode ? "自动陪学中" : speakingStatusLabel}
              </span>
              <span className="shrink-0 text-xs font-black text-blue-600">
                {isIntensiveMode ? `${safeIndex + 1}/${pages.length}` : `${visitedProgressCount}/${pages.length}`} 页
              </span>
            </div>
            <button
              type="button"
              className="flex h-9 w-9 items-center justify-center justify-self-end rounded-2xl bg-white/90 text-sky-500 shadow-[0_10px_24px_rgba(120,149,188,0.16)] transition hover:-translate-y-0.5 hover:bg-white"
              aria-label="放大"
              title="放大"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="6.5" />
                <path d="M20 20 16.4 16.4" />
                <path d="M11 8.5v5" />
                <path d="M8.5 11h5" />
              </svg>
            </button>
          </header>

          <main className="grid min-h-0 flex-1 gap-2 px-3 py-2 lg:grid-cols-[minmax(0,1fr)_370px] 2xl:grid-cols-[minmax(0,1fr)_400px]">
            <section className="flex min-h-0 min-w-0 flex-col overflow-hidden">
              <div className="relative min-h-0 flex-1 overflow-hidden rounded-[1.35rem] shadow-[0_18px_48px_rgba(120,149,188,0.12)]">
                <div className="relative h-full min-h-[260px] overflow-hidden rounded-[1.35rem]">
                  {pageImageUrl ? (
                    <img
                      src={pageImageUrl}
                      alt={page.pageTitle}
                      className={`h-full w-full ${isIntensiveMode ? "object-contain bg-white" : "object-cover object-center"}`}
                    />
                  ) : (
                    <div className="grid h-full min-h-[260px] place-items-center text-slate-400">
                      正在加载页面图片...
                    </div>
                  )}

                  {showTeacherHints && !isIntensiveMode ? (
                    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center px-6">
                      <div className="max-w-[82%] text-center">
                        <p className="mb-2 text-sm font-semibold uppercase tracking-[0.22em] text-white/90 drop-shadow-[0_2px_6px_rgba(0,0,0,0.28)]">
                          {speakingPromptTitle}
                        </p>
                        {hasDualDisplayPrompt ? (
                          <div className="grid gap-3 text-left md:grid-cols-2">
                            <div className="rounded-[1.2rem] border border-sky-200/30 bg-[rgba(0,0,0,0.42)] px-4 py-3 shadow-[0_12px_32px_rgba(15,23,42,0.26)]">
                              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-100">
                                Left Page
                              </p>
                              <p className="mt-2 text-[1.32rem] font-semibold leading-[1.8] text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.38)]">
                                {displayPromptParts.leftText}
                              </p>
                            </div>
                            <div className="rounded-[1.2rem] border border-violet-200/30 bg-[rgba(0,0,0,0.42)] px-4 py-3 shadow-[0_12px_32px_rgba(15,23,42,0.26)]">
                              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-violet-100">
                                Right Page
                              </p>
                              <p className="mt-2 text-[1.32rem] font-semibold leading-[1.8] text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.38)]">
                                {displayPromptParts.rightText}
                              </p>
                            </div>
                          </div>
                        ) : (
                          <div className="rounded-[1.2rem] border border-white/10 bg-[rgba(0,0,0,0.42)] px-5 py-4 shadow-[0_12px_32px_rgba(15,23,42,0.26)]">
                            <p className="text-[1.5rem] font-semibold leading-[1.8] text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.38)]">
                              {displayPromptText || "暂无提示内容"}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : null}

                  <div className="absolute bottom-3 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-full bg-slate-950/50 px-2.5 py-1.5 text-white shadow-[0_12px_28px_rgba(15,23,42,0.2)] backdrop-blur">
                    <button
                      type="button"
                      disabled={!canPrev}
                      onClick={() => {
                        setHintStage(0);
                        setPageIndex(safeIndex - 1);
                      }}
                      className="grid h-8 w-8 place-items-center rounded-full bg-white/20 text-white transition hover:bg-white/30 disabled:cursor-not-allowed disabled:opacity-35"
                      aria-label="上一页"
                    >
                      <svg viewBox="0 0 24 24" className="h-[1.125rem] w-[1.125rem]" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="m15 18-6-6 6-6" />
                      </svg>
                    </button>
                    <span className="min-w-[3.8rem] text-center text-base font-black">
                      {safeIndex + 1} / {pages.length}
                    </span>
                    <button
                      type="button"
                      disabled={!canNext}
                      onClick={() => {
                        setHintStage(0);
                        setPageIndex(safeIndex + 1);
                      }}
                      className="grid h-8 w-8 place-items-center rounded-full bg-white text-sky-600 transition hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-35"
                      aria-label="下一页"
                    >
                      <svg viewBox="0 0 24 24" className="h-[1.125rem] w-[1.125rem]" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="m9 6 6 6-6 6" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>

              {isIntensiveMode ? (
                <div className="mt-2 rounded-[1.05rem] border border-sky-100 bg-white px-4 py-3 text-center shadow-[0_12px_28px_rgba(120,149,188,0.1)]">
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-500">Page Text</p>
                  <p className="mt-2 text-base font-semibold leading-7 text-slate-800">
                    {page?.visibleText || "当前页暂无后台原文，Mia 会优先根据屏幕画面讲解。"}
                  </p>
                </div>
              ) : (
                <div className="mt-2 grid shrink-0 gap-2 md:grid-cols-3">
                  <button
                    type="button"
                    onClick={() => runSpeakingPracticeUiAction("show_hint")}
                    disabled={!isPracticeActive}
                    className="flex h-[4.5rem] items-center justify-center gap-3 rounded-[1.05rem] border border-sky-100 bg-white text-slate-900 shadow-[0_12px_28px_rgba(120,149,188,0.1)] transition hover:-translate-y-0.5 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <span className="text-2xl text-amber-400">☼</span>
                    <span className="text-base font-black">{hintStage === 1 ? "隐藏提示" : "给点提示"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => runSpeakingPracticeUiAction("show_original")}
                    disabled={!isPracticeActive}
                    className="flex h-[4.5rem] items-center justify-center gap-3 rounded-[1.05rem] border border-sky-100 bg-white text-slate-900 shadow-[0_12px_28px_rgba(120,149,188,0.1)] transition hover:-translate-y-0.5 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <svg viewBox="0 0 24 24" className="h-7 w-7 text-blue-500" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4.5 5.5A3.5 3.5 0 0 1 8 2h11v17H8a3.5 3.5 0 0 0-3.5 3.5v-17Z" />
                      <path d="M8 2v17" />
                      <path d="M12 6h4" />
                    </svg>
                    <span className="text-base font-black">{hintStage >= 2 ? "隐藏原文" : "查看原文"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => runSpeakingPracticeUiAction("finish_practice")}
                    disabled={!isPracticeActive || isGeneratingSpeakingAssessment}
                    className="flex h-[4.5rem] items-center justify-center gap-3 rounded-[1.05rem] bg-emerald-500 px-4 text-white shadow-[0_12px_24px_rgba(16,185,129,0.18)] transition hover:-translate-y-0.5 hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <span className="grid h-7 w-7 place-items-center rounded-full bg-white/20 text-base font-black">✓</span>
                    <span className="text-base font-black">
                      {isGeneratingSpeakingAssessment ? "生成点评中" : "完成练习"}
                    </span>
                  </button>
                </div>
              )}
            </section>

            <aside className="flex min-h-0 flex-col overflow-hidden rounded-[1.35rem] border border-sky-100 bg-[linear-gradient(180deg,#ffffff,#f7fbff)] p-4 shadow-[0_18px_48px_rgba(120,149,188,0.12)]">
              <div className="flex items-center gap-3">
                <div className="grid h-12 w-12 place-items-center rounded-full bg-[linear-gradient(135deg,#fff7ed,#dbeafe)] text-sm font-black text-slate-700 shadow-inner">
                  Mia
                </div>
                <h2 className="text-lg font-black text-slate-950">{isIntensiveMode ? "Mia 精讲" : "Mia 陪读"}</h2>
              </div>

              <div className="mt-4 flex min-h-[180px] flex-1 flex-col overflow-hidden rounded-[1.1rem] border border-sky-100 bg-sky-50/80">
                <div className="flex items-center justify-between border-b border-sky-100/80 px-4 py-2">
                  <span className="text-xs font-black text-slate-500">实时字幕</span>
                  <svg viewBox="0 0 24 24" className="h-5 w-5 text-blue-500" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M5 10v4h3l4 3V7l-4 3H5Z" />
                    <path d="M16 9.5a4 4 0 0 1 0 5" />
                    <path d="M18.5 7a7 7 0 0 1 0 10" />
                  </svg>
                </div>
                <div
                  ref={coachConversationScrollRef}
                  className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3"
                >
                  {coachSubtitleMessages.length ? null : (
                    <div className="flex h-full min-h-[160px] items-center justify-center text-center text-sm font-bold leading-6 text-slate-400">
                      实时语音字幕会显示在这里。等待 RTC 语音字幕返回中。
                    </div>
                  )}
                  {coachSubtitleMessages.map((message) => {
                    const isStudent = message.role === "student";
                    return (
                      <div
                        key={message.id}
                        className={`flex gap-2 ${isStudent ? "justify-end" : "justify-start"}`}
                      >
                        {!isStudent ? (
                          <div className="mt-0.5 h-7 w-7 shrink-0 rounded-full bg-[linear-gradient(135deg,#f8c6ff,#c7e7ff)]" />
                        ) : null}
                        <div className={`max-w-[82%] ${isStudent ? "text-right" : "text-left"}`}>
                          <div className="mb-1 text-xs font-bold text-slate-500">
                            {isStudent ? "我" : "Mia"}
                          </div>
                          <div
                            className={`rounded-[1rem] px-3.5 py-2.5 text-sm font-semibold leading-6 shadow-sm ${
                              isStudent
                                ? "bg-white text-slate-700"
                                : "border border-blue-100 bg-white/95 text-slate-800"
                            }`}
                          >
                            {message.text}
                          </div>
                        </div>
                        {isStudent ? (
                          <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-slate-200 text-xs font-black text-slate-500">
                            我
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>

              {coachFriendlyError ? (
                <div className="mt-2 rounded-2xl border border-amber-100 bg-amber-50 px-4 py-2.5 text-sm font-bold text-amber-700">
                  {coachFriendlyError}
                </div>
              ) : null}

              <div className="mt-auto pt-5">
                <p className="mb-2 text-sm font-black text-slate-800">你可以这样问我</p>
                <div className="space-y-2">
                  {speakingCoachPrompts.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => void askAiCoach(suggestion)}
                      disabled={isCoachThinking}
                      className="flex w-full items-center justify-between rounded-full border border-sky-100 bg-sky-50/70 px-4 py-2.5 text-left text-sm font-black text-blue-700 transition hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span>{suggestion}</span>
                      <span className="text-xl leading-none text-slate-500">›</span>
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={toggleCoachSession}
                  className={`mt-5 inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-black text-white shadow-[0_12px_28px_rgba(37,99,235,0.18)] transition hover:-translate-y-0.5 ${
                    isCoachSessionActive ? "bg-emerald-500" : "bg-blue-600"
                  }`}
                >
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-white/20">
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="9" y="3.5" width="6" height="11" rx="3" />
                      <path d="M7 11.5a5 5 0 0 0 10 0" />
                      <path d="M12 16.5V20" />
                    </svg>
                  </span>
                  {isCoachSpeaking ? "可打断" : isCoachListening ? "正在听" : isCoachSessionActive ? "实时语音中" : "实时语音"}
                </button>
              </div>
            </aside>
          </main>

        </div>
      </div>
    );
  }

  if (resolvedTaskMode === "shadow") {
    const shadowCoachSuggestions = coachQuestionSuggestions.slice(0, 3);

    return (
      <>
        {shadowFeedbackOverlay}
        <div className="box-border h-[100dvh] overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(219,234,254,0.96),_rgba(241,248,255,0.98)_52%,_#f8fbff_100%)] px-3 py-2 text-slate-900">
          <div
            ref={coachCaptureRef}
            className="mx-auto flex h-full max-w-[1600px] flex-col overflow-hidden rounded-[1.45rem] border border-white/70 bg-white/74 shadow-[0_22px_72px_rgba(93,128,170,0.16)] backdrop-blur-xl"
          >
            <header className="grid h-[52px] shrink-0 grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-2 border-b border-sky-100/80 px-4 py-1">
              <button
                type="button"
                onClick={() => router.back()}
                className="flex h-9 w-9 items-center justify-center rounded-2xl bg-white/90 text-sky-500 shadow-[0_10px_24px_rgba(120,149,188,0.16)] transition hover:-translate-y-0.5 hover:bg-white"
                aria-label="返回上一页"
                title="返回"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 12H8" />
                  <path d="m12 8-4 4 4 4" />
                </svg>
              </button>
              <div className="flex min-w-0 items-center gap-2 rounded-full border border-sky-100 bg-white/76 px-3 py-1.5 shadow-[0_10px_26px_rgba(120,149,188,0.09)]">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-blue-50 text-blue-500">
                  <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="8" />
                      <circle cx="12" cy="12" r="3" />
                      <path d="M12 2v4" />
                      <path d="M22 12h-4" />
                  </svg>
                </span>
                <p className="shrink-0 text-sm font-black text-blue-600">练习目标</p>
                <p className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-600">
                  跟着原音一句一句读，模仿发音、语调和节奏。刚开始可以看着文字跟读，熟悉以后试着不看文字，只听声音跟读。
                </p>
                <span className="shrink-0 rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-black text-blue-500">自动记录中</span>
                <span className="shrink-0 text-xs font-black text-blue-600">
                  {safeShadowViewIndex + 1}/{shadowViews.length} 页
                </span>
              </div>
              <button
                type="button"
                className="flex h-9 w-9 items-center justify-center justify-self-end rounded-2xl bg-white/90 text-sky-500 shadow-[0_10px_24px_rgba(120,149,188,0.16)] transition hover:-translate-y-0.5 hover:bg-white"
                aria-label="放大"
                title="放大"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="6.5" />
                  <path d="M20 20 16.4 16.4" />
                  <path d="M11 8.5v5" />
                  <path d="M8.5 11h5" />
                </svg>
              </button>
            </header>

            <main className="grid min-h-0 flex-1 gap-2 px-3 py-2 xl:grid-cols-[minmax(0,1fr)_370px] 2xl:grid-cols-[minmax(0,1fr)_400px]">
              <section className="flex min-h-0 min-w-0 flex-col overflow-hidden">
                <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-[1.35rem] shadow-[0_18px_54px_rgba(120,149,188,0.14)]">
                  <div className="relative h-full w-full overflow-hidden rounded-[1.35rem]">
                    {activeShadowView.kind === "single" ? (
                      <ShadowPage
                        url={
                          typeof activeShadowView.pages[0] === "number" && document
                            ? getDocumentPageImageUrl(activeShadowView.pages[0])
                            : ""
                        }
                        alt={`page-${typeof activeShadowView.pages[0] === "number" ? (activeShadowView.pages[0] as number) + 1 : "blank"}`}
                        mode="single"
                      />
                    ) : (
                      <ShadowSpreadPage
                        leftUrl={
                          typeof activeShadowView.pages[0] === "number" && document
                            ? getDocumentPageImageUrl(activeShadowView.pages[0])
                            : null
                        }
                        rightUrl={
                          typeof activeShadowView.pages[1] === "number" && document
                            ? getDocumentPageImageUrl(activeShadowView.pages[1])
                            : null
                        }
                        alt={`spread-${typeof activeShadowView.pages[0] === "number" ? (activeShadowView.pages[0] as number) + 1 : "blank"}-${
                          typeof activeShadowView.pages[1] === "number" ? (activeShadowView.pages[1] as number) + 1 : "blank"
                        }`}
                      />
                    )}
                  </div>

                  <div className="absolute bottom-5 left-1/2 z-20 flex -translate-x-1/2 items-center gap-4 rounded-full bg-slate-950/50 px-3 py-2 text-white shadow-[0_16px_34px_rgba(15,23,42,0.22)] backdrop-blur">
                    <button
                      type="button"
                      onClick={handleShadowPrev}
                      disabled={!canPrev}
                      className="grid h-9 w-9 place-items-center rounded-full bg-white/18 text-white transition hover:bg-white/28 disabled:cursor-not-allowed disabled:opacity-35"
                      aria-label="上一页"
                    >
                      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="m15 18-6-6 6-6" />
                      </svg>
                    </button>
                    <span className="min-w-[4.2rem] text-center text-lg font-black">
                      {safeShadowViewIndex + 1} / {shadowViews.length}
                    </span>
                    <button
                      type="button"
                      onClick={handleShadowNext}
                      disabled={!canNext}
                      className="grid h-9 w-9 place-items-center rounded-full bg-white text-sky-600 transition hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-35"
                      aria-label="下一页"
                    >
                      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="m9 6 6 6-6 6" />
                      </svg>
                    </button>
                  </div>
                </div>

                <div className="mt-2 shrink-0">
                  {activeShadowView.kind === "spread" || isSingleDualTextView ? (
                    <div className="grid gap-2 text-left sm:grid-cols-2">
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
                          className={`sm:col-span-2 rounded-[0.95rem] border border-sky-200 bg-white/90 px-4 py-2 text-center shadow-[0_10px_24px_rgba(120,149,188,0.08)] transition ${
                            hasShadowAudio ? "cursor-pointer hover:bg-white" : ""
                          }`}
                        >
                          <p className="text-[0.68rem] font-black uppercase tracking-[0.18em] text-sky-500">
                            Page Text
                          </p>
                          <p className="mt-0.5 truncate text-sm font-semibold text-indigo-950">
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
                            className={`rounded-[0.95rem] border bg-white/88 px-4 py-2 shadow-[0_10px_24px_rgba(120,149,188,0.08)] transition ${
                              spreadFocus === 0
                                ? "border-sky-400 shadow-[0_0_0_2px_rgba(14,165,233,0.16)]"
                                : "border-sky-200"
                            } ${leftHasPlayableAudio ? "cursor-pointer hover:bg-white" : ""}`}
                          >
                            <p className="text-[0.68rem] font-black uppercase tracking-[0.18em] text-sky-500">
                              Left Page
                            </p>
                            <p className="mt-0.5 truncate text-sm font-semibold text-indigo-950">
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
                            className={`rounded-[0.95rem] border bg-white/88 px-4 py-2 shadow-[0_10px_24px_rgba(120,149,188,0.08)] transition ${
                              spreadFocus === 1
                                ? "border-indigo-400 shadow-[0_0_0_2px_rgba(99,102,241,0.16)]"
                                : "border-indigo-200"
                            } ${rightHasPlayableAudio ? "cursor-pointer hover:bg-white" : ""}`}
                          >
                            <p className="text-[0.68rem] font-black uppercase tracking-[0.18em] text-indigo-500">
                              Right Page
                            </p>
                            <p className="mt-0.5 truncate text-sm font-semibold text-indigo-950">
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
                      className={`rounded-[0.95rem] border px-4 py-2 text-left shadow-[0_10px_24px_rgba(120,149,188,0.08)] transition ${
                        hasShadowAudio
                          ? "cursor-pointer border-sky-200 bg-white/90 hover:bg-white"
                          : "border-sky-100 bg-white/78"
                      }`}
                    >
                      <p className="text-center text-[0.68rem] font-black uppercase tracking-[0.18em] text-sky-500">
                        Page Text
                      </p>
                      <p className="mt-0.5 truncate text-center text-sm font-semibold text-indigo-950">
                        {leftText}
                      </p>
                    </div>
                  )}
                </div>

                <div className="mt-2 grid shrink-0 items-center gap-4 rounded-[1rem] border border-sky-100 bg-white/78 px-4 py-2 shadow-[0_14px_38px_rgba(120,149,188,0.1)] md:grid-cols-[56px_minmax(0,1fr)_56px]">
                  <button
                    type="button"
                    onClick={handlePlayShadowAudio}
                    disabled={!hasShadowAudio}
                    className={`flex h-11 w-11 items-center justify-center rounded-full shadow-md transition ${
                      hasShadowAudio
                        ? isPlayingShadowAudio
                          ? "bg-sky-600 text-white hover:bg-sky-700"
                          : "bg-white/80 text-sky-600 hover:bg-white"
                        : "cursor-not-allowed bg-slate-200 text-slate-400"
                    }`}
                    aria-label="播放当前页音频"
                    title={hasShadowAudio ? "播放当前页音频" : "当前页没有可播放音频"}
                  >
                    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 10v4h3l4 3V7l-4 3H5Z" />
                      <path d="M16 9.5a4 4 0 0 1 0 5" />
                      <path d="M18.5 7a7 7 0 0 1 0 10" />
                    </svg>
                  </button>

                  <div className="min-w-0 text-center">
                    <p className="truncate text-[1.55rem] font-black leading-tight tracking-[0.01em] text-emerald-600 md:text-[1.95rem]">
                      {activeShadowText}
                    </p>
                    <p className="mt-0.5 text-xs font-semibold text-emerald-700/80">
                      已录 {recordedShadowCount}/{shadowRecordableSteps.length || 0} 句
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={handleRecordShadowToggle}
                    disabled={!activeShadowText.trim()}
                    className={`flex h-11 w-11 items-center justify-center rounded-full shadow-md transition ${
                      activeShadowText.trim()
                        ? isRecordingShadow
                          ? "bg-sky-600 text-white hover:bg-sky-700"
                          : "bg-white/85 text-sky-500 hover:bg-white"
                        : "cursor-not-allowed bg-slate-200 text-slate-400"
                    }`}
                    aria-label={isRecordingShadow ? "停止录音" : "开始录音"}
                    title={isRecordingShadow ? "点击停止录音" : "开始录音"}
                  >
                    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="9" y="3.5" width="6" height="11" rx="3" />
                      <path d="M7 11.5a5 5 0 0 0 10 0" />
                      <path d="M12 16.5V20" />
                      <path d="M9 20h6" />
                    </svg>
                  </button>
                </div>

                {shadowScoreError ? (
                  <div className="mt-2 rounded-2xl border border-rose-200 bg-rose-50/80 px-4 py-2.5 text-sm text-rose-600">
                    {shadowScoreError}
                  </div>
                ) : null}
              </section>

              <aside className="flex min-h-0 flex-col overflow-hidden rounded-[1.35rem] border border-sky-100 bg-[linear-gradient(180deg,#ffffff,#f7fbff)] p-4 shadow-[0_18px_48px_rgba(120,149,188,0.12)]">
                <div className="flex items-center gap-3">
                  <div className="grid h-12 w-12 place-items-center rounded-full bg-[linear-gradient(135deg,#fff7ed,#dbeafe)] text-sm font-black text-slate-700 shadow-inner">
                    Mia
                  </div>
                  <h2 className="text-lg font-black text-slate-950">Mia 陪读</h2>
                </div>

                <div className="mt-4 flex min-h-[180px] flex-1 flex-col overflow-hidden rounded-[1.1rem] border border-sky-100 bg-sky-50/80">
                  <div className="flex items-center justify-between border-b border-sky-100/80 px-4 py-2">
                    <span className="text-xs font-black text-slate-500">实时字幕</span>
                    <svg viewBox="0 0 24 24" className="h-5 w-5 text-blue-500" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M5 10v4h3l4 3V7l-4 3H5Z" />
                      <path d="M16 9.5a4 4 0 0 1 0 5" />
                      <path d="M18.5 7a7 7 0 0 1 0 10" />
                    </svg>
                  </div>
                  <div
                    ref={coachConversationScrollRef}
                    className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3"
                  >
                    {coachSubtitleMessages.length ? null : (
                      <div className="flex h-full min-h-[160px] items-center justify-center text-center text-sm font-bold leading-6 text-slate-400">
                        实时语音字幕会显示在这里。等待 RTC 语音字幕返回中。
                      </div>
                    )}
                    {coachSubtitleMessages.map((message) => {
                      const isStudent = message.role === "student";
                      return (
                        <div
                          key={message.id}
                          className={`flex gap-2 ${isStudent ? "justify-end" : "justify-start"}`}
                        >
                          {!isStudent ? (
                            <div className="mt-0.5 h-7 w-7 shrink-0 rounded-full bg-[linear-gradient(135deg,#f8c6ff,#c7e7ff)]" />
                          ) : null}
                          <div className={`max-w-[82%] ${isStudent ? "text-right" : "text-left"}`}>
                            <div className="mb-1 text-xs font-bold text-slate-500">
                              {isStudent ? "我" : "Mia"}
                            </div>
                            <div
                              className={`rounded-[1rem] px-3.5 py-2.5 text-sm font-semibold leading-6 shadow-sm ${
                                isStudent
                                  ? "bg-white text-slate-700"
                                  : "border border-blue-100 bg-white/95 text-slate-800"
                              }`}
                            >
                              {message.text}
                            </div>
                          </div>
                          {isStudent ? (
                            <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-slate-200 text-xs font-black text-slate-500">
                              我
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {coachFriendlyError ? (
                  <div className="mt-2 rounded-2xl border border-amber-100 bg-amber-50 px-4 py-2.5 text-sm font-bold text-amber-700">
                    {coachFriendlyError}
                  </div>
                ) : null}

                <div className="mt-auto pt-5">
                  <p className="mb-2 text-sm font-black text-slate-800">你可以这样问我</p>
                  <div className="space-y-2">
                    {shadowCoachSuggestions.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => void askAiCoach(suggestion)}
                        disabled={isCoachThinking}
                        className="flex w-full items-center justify-between rounded-full border border-sky-100 bg-sky-50/70 px-4 py-2.5 text-left text-sm font-black text-blue-700 transition hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <span>{suggestion}</span>
                        <span className="text-xl leading-none text-slate-500">›</span>
                      </button>
                    ))}
                  </div>

                  {(shadowAssessment || isSubmittingShadowScore) ? (
                    <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-sky-100 bg-sky-50/70 px-4 py-2.5">
                      {isSubmittingShadowScore ? (
                        <div>
                          <p className="text-sm font-black text-sky-700">评分中</p>
                          <p className="mt-0.5 text-xs font-semibold text-sky-500">整段录音</p>
                        </div>
                      ) : overallShadowScore !== null ? (
                        <div>
                          <p className="text-sm font-black text-emerald-700">总评 {overallShadowScore}</p>
                          <p className="mt-0.5 text-xs font-semibold text-emerald-600">已生成跟读点评</p>
                        </div>
                      ) : null}

                      {shadowAssessment ? (
                        <button
                          type="button"
                          onClick={() => setIsShadowFeedbackOpen(true)}
                          className="rounded-full bg-white px-4 py-2 text-sm font-black text-sky-700 shadow-sm transition hover:bg-sky-50"
                        >
                          点评
                        </button>
                      ) : null}
                    </div>
                  ) : null}

                  <button
                    type="button"
                    onClick={toggleCoachSession}
                    className={`mt-5 inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-black text-white shadow-[0_12px_28px_rgba(37,99,235,0.18)] transition hover:-translate-y-0.5 ${
                      isCoachSessionActive ? "bg-emerald-500" : "bg-blue-600"
                    }`}
                    aria-label={
                      isCoachSpeaking ? "打断 AI 并开始说话" : isCoachSessionActive ? "停止连续语音对话" : "开始连续语音对话"
                    }
                  >
                    <span className="grid h-7 w-7 place-items-center rounded-full bg-white/20">
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="9" y="3.5" width="6" height="11" rx="3" />
                        <path d="M7 11.5a5 5 0 0 0 10 0" />
                        <path d="M12 16.5V20" />
                      </svg>
                    </span>
                    {isCoachSpeaking ? "可打断" : isCoachListening ? "正在听" : isCoachSessionActive ? "实时语音中" : "实时语音"}
                  </button>
                </div>
              </aside>
            </main>

          </div>
        </div>
      </>
    );

    return (
      <>
        {shadowFeedbackOverlay}
        {aiCoachPanel}
        <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(186,230,253,0.85),_rgba(239,246,255,0.98)_45%,_white_100%)]">
          <div className="mx-auto flex min-h-screen max-w-[1600px] flex-col px-4 py-3 md:px-6">
            <div className="overflow-hidden rounded-[1.9rem] bg-[radial-gradient(circle_at_top,_rgba(147,197,253,0.7),_rgba(224,242,254,0.9)_55%,_rgba(240,249,255,0.98)_100%)] shadow-[0_18px_60px_rgba(59,130,246,0.14)]">
              <div
                ref={coachCaptureRef}
                className="relative flex h-[min(94vh,1040px)] min-h-[720px] flex-col"
              >
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
                            ? getDocumentPageImageUrl(activeShadowView.pages[0])
                            : ""
                        }
                        alt={`page-${typeof activeShadowView.pages[0] === "number" ? (activeShadowView.pages[0] as number) + 1 : "blank"}`}
                        mode="single"
                      />
                    ) : (
                      <ShadowSpreadPage
                        leftUrl={
                          typeof activeShadowView.pages[0] === "number" && document
                            ? getDocumentPageImageUrl(activeShadowView.pages[0])
                            : null
                        }
                        rightUrl={
                          typeof activeShadowView.pages[1] === "number" && document
                            ? getDocumentPageImageUrl(activeShadowView.pages[1])
                            : null
                        }
                        alt={`spread-${typeof activeShadowView.pages[0] === "number" ? (activeShadowView.pages[0] as number) + 1 : "blank"}-${
                          typeof activeShadowView.pages[1] === "number" ? (activeShadowView.pages[1] as number) + 1 : "blank"
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
          className="relative flex flex-1 flex-col overflow-hidden rounded-[1.6rem] bg-white/72 shadow-[0_18px_60px_rgba(148,163,184,0.16)] backdrop-blur"
        >
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

          <div className="bg-white/88 px-4 py-3 md:px-5">
            <div className="mx-auto max-w-[1180px]">
              <div className="mt-2 rounded-[1.25rem] border border-sky-100 bg-white p-3 shadow-sm">
                  {resolvedTaskMode === "animation" ? (
                    <div>
                      {animationVideos.length ? (
                        <div className="grid gap-4 lg:grid-cols-2">
                          {animationVideos.map(({ animation, url }, index) => (
                            <article
                              key={animation.objectKey}
                              className="group overflow-hidden rounded-[1.45rem] bg-slate-950 shadow-[0_24px_70px_rgba(15,23,42,0.22)]"
                            >
                              <div className="relative">
                                {url ? (
                                  <video
                                    ref={(element) => {
                                      animationVideoRefs.current[animation.objectKey] = element;
                                    }}
                                    src={url}
                                    controls
                                    playsInline
                                    preload="metadata"
                                    poster={coverImageUrl || undefined}
                                    className="aspect-video w-full bg-black object-contain"
                                  />
                                ) : (
                                  <div className="grid aspect-video place-items-center px-6 text-center text-sm font-bold text-sky-100">
                                    视频地址加载中...
                                  </div>
                                )}
                                {url ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void openAnimationFullscreen(animation.objectKey);
                                    }}
                                    className="absolute right-4 top-4 rounded-full bg-white/92 px-4 py-2 text-sm font-black text-slate-900 shadow-lg ring-1 ring-white/60 transition hover:bg-white"
                                  >
                                    全屏观看
                                  </button>
                                ) : null}
                              </div>
                              <div className="flex items-center justify-between gap-3 bg-white px-4 py-3">
                                <div className="min-w-0">
                                  <p className="truncate text-base font-black text-slate-900">
                                    动画伴读 {index + 1}
                                  </p>
                                  <p className="mt-1 truncate text-xs font-bold text-slate-400">
                                    {animation.fileName}
                                  </p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => {
                                    void openAnimationFullscreen(animation.objectKey);
                                  }}
                                  disabled={!url}
                                  className="shrink-0 rounded-full bg-sky-600 px-4 py-2 text-sm font-black text-white shadow-[0_12px_24px_rgba(14,165,233,0.2)] transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                                >
                                  打开
                                </button>
                              </div>
                            </article>
                          ))}
                        </div>
                      ) : (
                        <div className="grid aspect-video place-items-center rounded-[1.45rem] bg-[radial-gradient(circle_at_top,rgba(14,165,233,0.24),rgba(15,23,42,1)_58%)] px-6 text-center shadow-[0_24px_70px_rgba(15,23,42,0.22)]">
                          <div>
                            <div className="mx-auto grid h-16 w-16 place-items-center rounded-[1.4rem] bg-white/10 text-3xl text-white">
                              ▶
                            </div>
                            <p className="mt-4 text-xl font-black text-white">老师还没有上传动画伴读</p>
                            <p className="mt-2 text-sm leading-6 text-sky-100/80">
                              上传后，你可以在这里直接观看绘本动画片。
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : null}

                  {resolvedTaskMode === "assessment" ? (
                    <div className="space-y-4">
                      <div className="rounded-[1.25rem] bg-sky-50 px-5 py-4">
                        <p className="text-xs font-black uppercase tracking-[0.22em] text-sky-500">
                          Learning Report
                        </p>
                        <h2 className="mt-2 text-2xl font-black text-slate-950">得分点评</h2>
                        <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">
                          完成影子跟读和看图说话后，这里会汇总学生表现记录、字幕记录、问题记录和训练建议。
                        </p>
                      </div>

                      <div className="grid gap-4 lg:grid-cols-2">
                        {assessmentCards.map((item) => {
                          const averageScore = getAssessmentAverageScore(item.assessment);
                          return (
                            <section
                              key={item.label}
                              className="rounded-[1.25rem] border border-sky-100 bg-slate-50 px-4 py-4"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">
                                    {item.status}
                                  </p>
                                  <h3 className="mt-1 text-xl font-black text-slate-950">{item.label}</h3>
                                  <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">
                                    {item.summary}
                                  </p>
                                </div>
                                <div className="rounded-[1rem] bg-slate-900 px-4 py-3 text-center text-white">
                                  <p className="text-[10px] font-black uppercase tracking-[0.16em] text-white/60">
                                    Score
                                  </p>
                                  <p className="mt-1 text-2xl font-black">{averageScore ?? "--"}</p>
                                </div>
                              </div>

                              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                                <div className="rounded-xl bg-white px-3 py-2 shadow-sm">
                                  <p className="text-[11px] font-bold text-slate-400">最近完成</p>
                                  <p className="mt-1 text-sm font-black text-slate-800">
                                    {formatAssessmentTime(item.completedAt)}
                                  </p>
                                </div>
                                <div className="rounded-xl bg-white px-3 py-2 shadow-sm">
                                  <p className="text-[11px] font-bold text-slate-400">练习记录</p>
                                  <p className="mt-1 text-sm font-black text-slate-800">
                                    {item.practiceCount} 次
                                  </p>
                                </div>
                                <div className="rounded-xl bg-white px-3 py-2 shadow-sm">
                                  <p className="text-[11px] font-bold text-slate-400">字幕记录</p>
                                  <p className="mt-1 text-sm font-black text-slate-800">
                                    {item.voiceSubtitles.length} 条
                                  </p>
                                </div>
                              </div>

                              {item.label === "看图说话" && isGeneratingSpeakingAssessment ? (
                                <div className="mt-3 rounded-xl bg-sky-100 px-3 py-2 text-xs font-bold text-sky-700">
                                  AI 正在生成本次看图说话点评...
                                </div>
                              ) : null}
                              {item.label === "看图说话" && speakingAssessmentError ? (
                                <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">
                                  {speakingAssessmentError}
                                </div>
                              ) : null}

                              <div className="mt-3 rounded-xl bg-white px-4 py-3 shadow-sm">
                                <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">
                                  整体表现
                                </p>
                                <p className="mt-2 whitespace-pre-line text-sm font-semibold leading-6 text-slate-700">
                                  {item.assessment?.overallComment || "学生完成练习并生成点评后，会在这里显示整体表现。"}
                                </p>
                              </div>

                              <div className="mt-3 rounded-xl bg-white px-4 py-3 shadow-sm">
                                <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">
                                  {item.problemLabel}
                                </p>
                                {item.problemRecords.length ? (
                                  <div className="mt-2 space-y-2">
                                    {item.problemRecords.map((problem, index) => (
                                      <div
                                        key={`${item.label}_problem_${index}`}
                                        className="rounded-lg bg-slate-50 px-3 py-2 text-sm font-semibold leading-6 text-slate-700"
                                      >
                                        {problem}
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="mt-2 text-sm font-semibold leading-6 text-slate-500">
                                    暂无明确问题记录。完成练习后，系统会从 AI 点评和字幕中提取发音、流畅度、漏读和提示依赖等问题。
                                  </p>
                                )}
                              </div>

                              {item.voiceSubtitles.length ? (
                                <div className="mt-3 rounded-xl bg-white px-4 py-3 shadow-sm">
                                  <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">
                                    字幕摘要
                                  </p>
                                  <div className="mt-2 space-y-1.5">
                                    {item.voiceSubtitles.slice(-5).map((subtitle) => (
                                      <p
                                        key={subtitle.id}
                                        className="line-clamp-2 text-sm font-semibold leading-6 text-slate-600"
                                      >
                                        {subtitle.role === "student" ? "学生：" : "Mia："}
                                        {subtitle.text}
                                      </p>
                                    ))}
                                  </div>
                                </div>
                              ) : null}

                              {item.note ? (
                                <div className="mt-3 rounded-xl bg-white px-4 py-3 text-sm leading-6 text-slate-700 shadow-sm">
                                  <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">
                                    老师补充点评
                                  </p>
                                  <p className="mt-2 whitespace-pre-line">{item.note}</p>
                                </div>
                              ) : null}
                            </section>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
              </div>
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
    <div className="flex h-full min-h-0 w-full items-center justify-center rounded-[1.35rem]">
      <img
        src={url}
        alt={alt}
        className={`h-full min-h-0 w-full rounded-[1.35rem] ${
          mode === "single" ? "object-cover" : "object-contain"
        }`}
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
    <div className="flex h-full min-h-0 w-full items-center justify-center rounded-[1.35rem]">
      <div
        role="img"
        aria-label={alt}
        className="h-full min-h-0 w-full overflow-hidden rounded-[1.35rem]"
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
