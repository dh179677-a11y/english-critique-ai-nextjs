import { NextResponse } from "next/server";
import OpenAI from "openai";
import { toFile } from "openai/uploads";
import { createSignedDownloadUrl } from "@/lib/cos";

export const runtime = "nodejs";

type TrackInput = {
  fileName: string;
  mimeType: string;
  objectKey: string;
  durationSec: number;
};

type RematchRequest = {
  pageTexts?: unknown;
  tracks?: unknown;
};

type TranscriptToken = {
  text: string;
  startSec: number;
  endSec: number;
};

type MatchResult = {
  pageIndex: number;
  trackIndex: number;
  startSec: number;
  endSec: number;
  score: number;
  matchedText?: string;
};

type TrackPageAssignment = {
  trackIndex: number;
  pageIndexes: number[];
};

const MATCH_LEAD_PADDING_SEC = 0.06;
const MATCH_TAIL_PADDING_SEC = 0.34;
const SHORT_MATCH_TAIL_PADDING_SEC = 0.46;

const getRequiredEnv = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not configured on server`);
  }
  return value;
};

const getAiClient = () =>
  new OpenAI({
    apiKey: getRequiredEnv("LLM_API_KEY"),
    baseURL: getRequiredEnv("LLM_BASE_URL"),
  });

const normalizeText = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9'\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokenize = (value: string) =>
  normalizeText(value)
    .split(" ")
    .map((item) => item.trim())
    .filter(Boolean);

const toNumber = (value: unknown, fallback = 0) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const parseTracks = (value: unknown): TrackInput[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => item as Partial<TrackInput>)
    .filter(
      (item): item is TrackInput =>
        typeof item?.objectKey === "string" &&
        item.objectKey.trim().length > 0 &&
        typeof item.fileName === "string" &&
        item.fileName.trim().length > 0 &&
        typeof item.mimeType === "string" &&
        item.mimeType.trim().length > 0
    )
    .map((item) => ({
      fileName: item.fileName,
      mimeType: item.mimeType,
      objectKey: item.objectKey,
      durationSec: toNumber(item.durationSec, 0),
    }));
};

const parsePageRangeHintFromFileName = (fileName: string, pageCount: number) => {
  const lower = fileName.toLowerCase();
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

const parsePageIndexHintFromFileName = (fileName: string, pageCount: number) => {
  const lower = fileName.toLowerCase();
  if (parsePageRangeHintFromFileName(lower, pageCount)) {
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

const buildModelCandidates = () => {
  const envModel = process.env.STORYFLOW_TRANSCRIBE_MODEL?.trim() || "";
  return [envModel, "gpt-4o-mini-transcribe", "whisper-1"].filter(
    (item, index, arr): item is string => Boolean(item) && arr.indexOf(item) === index
  );
};

const expandSentenceTokenTimings = (
  text: string,
  startSec: number,
  endSec: number
): TranscriptToken[] => {
  const words = text
    .trim()
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (!words.length) return [];

  const safeStart = Math.max(0, startSec);
  const safeEnd = Math.max(safeStart + 0.15, endSec);
  const step = (safeEnd - safeStart) / words.length;

  return words.map((word, index) => {
    const tokenStart = safeStart + step * index;
    const tokenEnd = index === words.length - 1 ? safeEnd : safeStart + step * (index + 1);
    return {
      text: word,
      startSec: tokenStart,
      endSec: Math.max(tokenStart + 0.08, tokenEnd),
    };
  });
};

const parseTranscriptTokens = (
  transcription: unknown,
  fallbackDurationSec: number
): TranscriptToken[] => {
  const raw = transcription as {
    text?: unknown;
    segments?: unknown;
    words?: unknown;
  };

  const words = Array.isArray(raw?.words) ? raw.words : [];
  const normalizedWords = words
    .map((item) => item as { word?: unknown; start?: unknown; end?: unknown })
    .filter((item) => typeof item.word === "string")
    .map((item) => ({
      text: String(item.word || "").trim(),
      startSec: Math.max(0, toNumber(item.start, 0)),
      endSec: Math.max(0, toNumber(item.end, 0)),
    }))
    .filter((item) => item.text.length > 0)
    .map((item) => ({
      text: item.text,
      startSec: item.startSec,
      endSec: Math.max(item.startSec + 0.08, item.endSec),
    }));

  if (normalizedWords.length) {
    return normalizedWords;
  }

  const segments = Array.isArray(raw?.segments) ? raw.segments : [];
  const normalizedSegments = segments
    .map((item) => item as { text?: unknown; start?: unknown; end?: unknown })
    .filter((item) => typeof item.text === "string" && item.text.trim().length > 0)
    .flatMap((item) =>
      expandSentenceTokenTimings(
        String(item.text || "").trim(),
        Math.max(0, toNumber(item.start, 0)),
        Math.max(0, toNumber(item.end, 0))
      )
    );

  if (normalizedSegments.length) {
    return normalizedSegments;
  }

  const text = typeof raw?.text === "string" ? raw.text.trim() : "";
  if (!text) return [];

  const safeDuration = fallbackDurationSec > 0 ? fallbackDurationSec : 12;
  return expandSentenceTokenTimings(text, 0, safeDuration);
};

const transcribeTrack = async (
  ai: OpenAI,
  track: TrackInput
): Promise<TranscriptToken[]> => {
  const url = createSignedDownloadUrl(track.objectKey);
  const response = await fetch(url, { method: "GET" });
  if (!response.ok) {
    throw new Error(`下载音频失败: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const file = await toFile(Buffer.from(arrayBuffer), track.fileName, {
    type: track.mimeType || "audio/mpeg",
  });

  const models = buildModelCandidates();
  let lastError: unknown = null;

  for (const model of models) {
    try {
      const transcription = await ai.audio.transcriptions.create({
        model,
        file,
        response_format: "verbose_json",
        timestamp_granularities: ["segment", "word"],
      } as never);
      const parsed = parseTranscriptTokens(transcription, track.durationSec);
      if (parsed.length) return parsed;
    } catch (error) {
      lastError = error;
      try {
        const fallbackTranscription = await ai.audio.transcriptions.create({
          model,
          file,
        } as never);
        const parsed = parseTranscriptTokens(fallbackTranscription, track.durationSec);
        if (parsed.length) return parsed;
      } catch (fallbackError) {
        lastError = fallbackError;
      }
    }
  }

  throw lastError || new Error("音频转写失败");
};

const assignPagesToTracks = (
  pageTexts: string[],
  tracks: TrackInput[]
): TrackPageAssignment[] => {
  const assignments = tracks.map((_, trackIndex) => ({
    trackIndex,
    pageIndexes: [] as number[],
  }));

  const nonEmptyPageIndexes = pageTexts
    .map((text, pageIndex) => ({ pageIndex, text: text.trim() }))
    .filter((item) => item.text.length > 0)
    .map((item) => item.pageIndex);

  if (tracks.length === 1) {
    assignments[0].pageIndexes.push(...nonEmptyPageIndexes);
    return assignments;
  }

  const assignedPages = new Set<number>();
  const unhintedTrackIndexes: number[] = [];

  tracks.forEach((track, trackIndex) => {
    const pageHint = parsePageIndexHintFromFileName(track.fileName, pageTexts.length);
    if (pageHint !== null) {
      if (pageTexts[pageHint]?.trim()) {
        assignments[trackIndex].pageIndexes.push(pageHint);
        assignedPages.add(pageHint);
      }
      return;
    }

    const rangeHint = parsePageRangeHintFromFileName(track.fileName, pageTexts.length);
    if (rangeHint) {
      for (let pageIndex = rangeHint.startPageIndex; pageIndex <= rangeHint.endPageIndex; pageIndex += 1) {
        if (assignedPages.has(pageIndex) || !pageTexts[pageIndex]?.trim()) continue;
        assignments[trackIndex].pageIndexes.push(pageIndex);
        assignedPages.add(pageIndex);
      }
      return;
    }

    unhintedTrackIndexes.push(trackIndex);
  });

  const remainingPages = nonEmptyPageIndexes.filter((pageIndex) => !assignedPages.has(pageIndex));

  if (!remainingPages.length || !unhintedTrackIndexes.length) {
    return assignments;
  }

  const pairCount = Math.min(unhintedTrackIndexes.length, remainingPages.length);
  for (let index = 0; index < pairCount; index += 1) {
    assignments[unhintedTrackIndexes[index]].pageIndexes.push(remainingPages[index]);
  }

  return assignments;
};

const buildTrackWideFallbackMatch = (
  pageIndex: number,
  trackIndex: number,
  targetTokens: string[],
  tokens: TranscriptToken[]
): MatchResult | null => {
  if (!tokens.length) return null;

  const matchedText = tokens
    .map((item) => item.text)
    .join(" ")
    .trim()
    .slice(0, 400);

  const startSec = Math.max(0, tokens[0]?.startSec || 0);
  const endSec = Math.max(startSec + 0.2, tokens[tokens.length - 1]?.endSec || startSec + 0.2);

  return {
    pageIndex,
    trackIndex,
    startSec,
    endSec,
    score: targetTokens.length ? 0.25 : 0.1,
    matchedText,
  };
};

const buildMatchPayload = (
  trackIndex: number,
  pageIndex: number,
  targetTokens: string[],
  matchedTokens: TranscriptToken[]
): MatchResult => {
  const matchedText = matchedTokens.map((item) => item.text).join(" ").trim();
  const leadPadding = Math.min(
    MATCH_LEAD_PADDING_SEC,
    Math.max(0, matchedTokens[0].startSec)
  );
  const tailPadding =
    targetTokens.length <= 3 ? SHORT_MATCH_TAIL_PADDING_SEC : MATCH_TAIL_PADDING_SEC;

  return {
    pageIndex,
    trackIndex,
    startSec: Math.max(0, matchedTokens[0].startSec - leadPadding),
    endSec: Math.max(
      Math.max(0, matchedTokens[0].startSec - leadPadding) + 0.18,
      matchedTokens[matchedTokens.length - 1].endSec + tailPadding
    ),
    score: 1,
    matchedText,
  };
};

const findExactSingleTokenMatch = (
  tokens: TranscriptToken[],
  fromIndex: number,
  targetToken: string
) => {
  const maxStartLookahead = Math.min(24, Math.max(0, tokens.length - fromIndex));

  for (
    let index = fromIndex;
    index < tokens.length && index < fromIndex + maxStartLookahead;
    index += 1
  ) {
    if (normalizeText(tokens[index].text) === targetToken) {
      return {
        startIndex: index,
        endIndex: index,
      };
    }
  }

  return null;
};

const findExactPhraseMatch = (
  tokens: TranscriptToken[],
  fromIndex: number,
  targetTokens: string[]
) => {
  const maxStartLookahead = Math.min(36, Math.max(0, tokens.length - fromIndex));

  for (
    let startIndex = fromIndex;
    startIndex < tokens.length && startIndex < fromIndex + maxStartLookahead;
    startIndex += 1
  ) {
    const candidateWords = tokens
      .slice(startIndex, startIndex + targetTokens.length)
      .map((item) => normalizeText(item.text))
      .filter(Boolean);

    if (candidateWords.length !== targetTokens.length) {
      continue;
    }

    if (candidateWords.join(" ") === targetTokens.join(" ")) {
      return {
        startIndex,
        endIndex: startIndex + targetTokens.length - 1,
      };
    }
  }

  return null;
};

const alignPagesWithinTrack = (
  pageEntries: Array<{ pageIndex: number; text: string }>,
  tokens: TranscriptToken[],
  trackIndex: number
) => {
  const matches: MatchResult[] = [];
  if (pageEntries.length === 1) {
    const targetTokens = tokenize(pageEntries[0].text);
    const fallbackMatch = buildTrackWideFallbackMatch(
      pageEntries[0].pageIndex,
      trackIndex,
      targetTokens,
      tokens
    );
    return fallbackMatch ? [fallbackMatch] : [];
  }

  let cursor = 0;

  pageEntries.forEach((page) => {
    const targetTokens = tokenize(page.text);
    if (!targetTokens.length) {
      return;
    }

    const exactRange =
      targetTokens.length === 1
        ? findExactSingleTokenMatch(tokens, cursor, targetTokens[0])
        : findExactPhraseMatch(tokens, cursor, targetTokens);

    if (!exactRange) {
      return;
    }

    const matchedTokens = tokens.slice(exactRange.startIndex, exactRange.endIndex + 1);
    matches.push(
      buildMatchPayload(trackIndex, page.pageIndex, targetTokens, matchedTokens)
    );
    cursor = exactRange.endIndex + 1;
  });

  return matches;
};

const alignPagesToTracks = (
  pageTexts: string[],
  allTrackTokens: TranscriptToken[][],
  tracks: TrackInput[]
) => {
  const matches: MatchResult[] = [];
  const assignments = assignPagesToTracks(pageTexts, tracks);

  assignments.forEach(({ trackIndex, pageIndexes }) => {
    const tokens = allTrackTokens[trackIndex] || [];
    if (!tokens.length || !pageIndexes.length) return;

    const pageEntries = pageIndexes
      .map((pageIndex) => ({
        pageIndex,
        text: pageTexts[pageIndex]?.trim() || "",
      }))
      .filter((item) => item.text.length > 0);

    if (!pageEntries.length) return;
    matches.push(...alignPagesWithinTrack(pageEntries, tokens, trackIndex));
  });

  return matches.sort((left, right) => left.pageIndex - right.pageIndex);
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RematchRequest;
    const pageTexts = Array.isArray(body.pageTexts)
      ? body.pageTexts.map((item) => (typeof item === "string" ? item.trim() : ""))
      : [];
    const tracks = parseTracks(body.tracks);

    if (!pageTexts.length || !tracks.length) {
      return NextResponse.json(
        { error: "pageTexts and tracks are required" },
        { status: 400 }
      );
    }

    const ai = getAiClient();
    const allTrackTokens: TranscriptToken[][] = [];

    for (let index = 0; index < tracks.length; index += 1) {
      const tokens = await transcribeTrack(ai, tracks[index]);
      allTrackTokens.push(tokens);
    }

    const matches = alignPagesToTracks(pageTexts, allTrackTokens, tracks);
    const diagnostics = {
      tracks: tracks.map((track, trackIndex) => ({
        trackIndex,
        fileName: track.fileName,
        durationSec: track.durationSec,
        segments: (allTrackTokens[trackIndex] || []).map((item) => ({
          startSec: item.startSec,
          endSec: item.endSec,
          text: item.text,
        })),
        transcriptText: (allTrackTokens[trackIndex] || [])
          .map((item) => item.text)
          .join(" ")
          .trim(),
      })),
      pages: pageTexts.map((text, pageIndex) => {
        const match = matches.find((item) => item.pageIndex === pageIndex) || null;
        return {
          pageIndex,
          pageText: text,
          matchedTrackIndex: match?.trackIndex ?? null,
          matchedTrackFileName:
            typeof match?.trackIndex === "number"
              ? tracks[match.trackIndex]?.fileName || ""
              : "",
          startSec: match?.startSec ?? null,
          endSec: match?.endSec ?? null,
          score: match?.score ?? null,
          matchedText: match?.matchedText || "",
          accepted: Boolean(match),
        };
      }),
    };

    return NextResponse.json({
      matches,
      matchedCount: matches.length,
      totalPages: pageTexts.filter((text) => text.trim().length > 0).length,
      diagnostics,
    });
  } catch (error) {
    console.error("Storyflow rematch-audio route error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "音频自动匹配失败" },
      { status: 500 }
    );
  }
}
