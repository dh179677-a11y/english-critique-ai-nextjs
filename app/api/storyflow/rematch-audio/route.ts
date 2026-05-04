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

type AudioSegmentSlot = "single" | "left" | "right";

type PageEntryInput = {
  pageIndex: number;
  slot: AudioSegmentSlot;
  text: string;
};

type RematchRequest = {
  pageTexts?: unknown;
  pageEntries?: unknown;
  tracks?: unknown;
};

type TranscriptToken = {
  text: string;
  startSec: number;
  endSec: number;
};

type MatchResult = {
  pageIndex: number;
  slot: AudioSegmentSlot;
  trackIndex: number;
  startSec: number;
  endSec: number;
  score: number;
  matchedText?: string;
};

type TrackPageAssignment = {
  trackIndex: number;
  entries: PageEntryInput[];
};

const MATCH_LEAD_PADDING_SEC = 0;
const MATCH_TAIL_PADDING_SEC = 0.34;
const SHORT_MATCH_TAIL_PADDING_SEC = 0.46;
const AUDIO_SLOT_ORDER: Record<AudioSegmentSlot, number> = {
  single: 0,
  left: 1,
  right: 2,
};

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

const normalizeAudioSegmentSlot = (value: unknown): AudioSegmentSlot =>
  value === "left" || value === "right" || value === "single" ? value : "single";

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

const parsePageEntries = (value: unknown): PageEntryInput[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => item as Partial<PageEntryInput>)
    .filter(
      (item): item is PageEntryInput =>
        typeof item?.pageIndex === "number" &&
        Number.isFinite(item.pageIndex) &&
        item.pageIndex >= 0 &&
        typeof item?.text === "string"
    )
    .map((item) => ({
      pageIndex: item.pageIndex,
      slot: normalizeAudioSegmentSlot(item.slot),
      text: item.text.trim(),
    }))
    .filter((item) => item.text.length > 0)
    .sort((left, right) =>
      left.pageIndex === right.pageIndex
        ? AUDIO_SLOT_ORDER[left.slot] - AUDIO_SLOT_ORDER[right.slot]
        : left.pageIndex - right.pageIndex
    );
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
  pageEntries: PageEntryInput[],
  tracks: TrackInput[]
): TrackPageAssignment[] => {
  const pageCount = pageEntries.reduce((max, item) => Math.max(max, item.pageIndex + 1), 0);
  const assignments = tracks.map((_, trackIndex) => ({
    trackIndex,
    entries: [] as PageEntryInput[],
  }));

  if (tracks.length === 1) {
    assignments[0].entries.push(...pageEntries);
    return assignments;
  }

  const entriesByPage = new Map<number, PageEntryInput[]>();
  pageEntries.forEach((entry) => {
    const group = entriesByPage.get(entry.pageIndex) || [];
    group.push(entry);
    entriesByPage.set(entry.pageIndex, group);
  });

  const assignedEntryKeys = new Set<string>();
  const unhintedTrackIndexes: number[] = [];

  tracks.forEach((track, trackIndex) => {
    const pageHint = parsePageIndexHintFromFileName(track.fileName, pageCount);
    if (pageHint !== null) {
      const entries = entriesByPage.get(pageHint) || [];
      if (entries.length) {
        assignments[trackIndex].entries.push(...entries);
        entries.forEach((entry) => assignedEntryKeys.add(`${entry.pageIndex}:${entry.slot}`));
      }
      return;
    }

    const rangeHint = parsePageRangeHintFromFileName(track.fileName, pageCount);
    if (rangeHint) {
      for (let pageIndex = rangeHint.startPageIndex; pageIndex <= rangeHint.endPageIndex; pageIndex += 1) {
        const entries = entriesByPage.get(pageIndex) || [];
        entries.forEach((entry) => {
          const entryKey = `${entry.pageIndex}:${entry.slot}`;
          if (assignedEntryKeys.has(entryKey)) return;
          assignments[trackIndex].entries.push(entry);
          assignedEntryKeys.add(entryKey);
        });
      }
      return;
    }

    unhintedTrackIndexes.push(trackIndex);
  });

  const remainingEntries = pageEntries.filter(
    (entry) => !assignedEntryKeys.has(`${entry.pageIndex}:${entry.slot}`)
  );

  if (!remainingEntries.length || !unhintedTrackIndexes.length) {
    return assignments;
  }

  const pairCount = Math.min(unhintedTrackIndexes.length, remainingEntries.length);
  for (let index = 0; index < pairCount; index += 1) {
    assignments[unhintedTrackIndexes[index]].entries.push(remainingEntries[index]);
  }

  return assignments;
};

const buildTrackWideFallbackMatch = (
  pageIndex: number,
  slot: AudioSegmentSlot,
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
    slot,
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
  slot: AudioSegmentSlot,
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
    slot,
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

const findFuzzyPhraseMatch = (
  tokens: TranscriptToken[],
  fromIndex: number,
  targetTokens: string[]
) => {
  if (!targetTokens.length) return null;

  const maxStartLookahead = Math.min(72, Math.max(0, tokens.length - fromIndex));
  let best:
    | {
        startIndex: number;
        endIndex: number;
        score: number;
      }
    | null = null;

  for (
    let startIndex = fromIndex;
    startIndex < tokens.length && startIndex < fromIndex + maxStartLookahead;
    startIndex += 1
  ) {
    const maxWindowLength = Math.min(
      Math.max(targetTokens.length + 6, targetTokens.length * 2),
      tokens.length - startIndex
    );

    for (let windowLength = Math.max(1, targetTokens.length - 1); windowLength <= maxWindowLength; windowLength += 1) {
      const candidateTokens = tokens
        .slice(startIndex, startIndex + windowLength)
        .map((item) => normalizeText(item.text))
        .filter(Boolean);

      if (!candidateTokens.length) continue;

      let targetCursor = 0;
      let matchedInOrder = 0;
      candidateTokens.forEach((token) => {
        while (targetCursor < targetTokens.length) {
          if (targetTokens[targetCursor] === token) {
            matchedInOrder += 1;
            targetCursor += 1;
            break;
          }
          targetCursor += 1;
        }
      });

      const overlapSet = new Set(candidateTokens);
      const overlapCount = targetTokens.filter((token) => overlapSet.has(token)).length;
      const orderScore = matchedInOrder / targetTokens.length;
      const overlapScore = overlapCount / targetTokens.length;
      const lengthPenalty =
        Math.abs(candidateTokens.length - targetTokens.length) /
        Math.max(targetTokens.length, candidateTokens.length, 1);
      const candidateScore = orderScore * 0.72 + overlapScore * 0.38 - lengthPenalty * 0.18;

      if (candidateScore < 0.58) continue;

      if (
        !best ||
        candidateScore > best.score ||
        (Math.abs(candidateScore - best.score) < 0.001 && startIndex < best.startIndex)
      ) {
        best = {
          startIndex,
          endIndex: startIndex + candidateTokens.length - 1,
          score: candidateScore,
        };
      }
    }
  }

  return best;
};

const alignPagesWithinTrack = (
  pageEntries: PageEntryInput[],
  tokens: TranscriptToken[],
  trackIndex: number
) => {
  const matches: MatchResult[] = [];
  if (pageEntries.length === 1) {
    const targetTokens = tokenize(pageEntries[0].text);
    const fallbackMatch = buildTrackWideFallbackMatch(
      pageEntries[0].pageIndex,
      pageEntries[0].slot,
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
      const fuzzyRange = findFuzzyPhraseMatch(tokens, cursor, targetTokens);
      if (!fuzzyRange) {
        return;
      }
      const matchedTokens = tokens.slice(fuzzyRange.startIndex, fuzzyRange.endIndex + 1);
      matches.push(
        buildMatchPayload(trackIndex, page.pageIndex, page.slot, targetTokens, matchedTokens)
      );
      cursor = fuzzyRange.endIndex + 1;
      return;
    }

    const matchedTokens = tokens.slice(exactRange.startIndex, exactRange.endIndex + 1);
    matches.push(
      buildMatchPayload(trackIndex, page.pageIndex, page.slot, targetTokens, matchedTokens)
    );
    cursor = exactRange.endIndex + 1;
  });

  return matches;
};

const alignPagesToTracks = (
  pageEntries: PageEntryInput[],
  allTrackTokens: TranscriptToken[][],
  tracks: TrackInput[]
) => {
  const matches: MatchResult[] = [];
  const assignments = assignPagesToTracks(pageEntries, tracks);

  assignments.forEach(({ trackIndex, entries }) => {
    const tokens = allTrackTokens[trackIndex] || [];
    if (!tokens.length || !entries.length) return;
    matches.push(...alignPagesWithinTrack(entries, tokens, trackIndex));
  });

  return matches.sort((left, right) =>
    left.pageIndex === right.pageIndex
      ? AUDIO_SLOT_ORDER[left.slot] - AUDIO_SLOT_ORDER[right.slot]
      : left.pageIndex - right.pageIndex
  );
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RematchRequest;
    const pageTexts = Array.isArray(body.pageTexts)
      ? body.pageTexts.map((item) => (typeof item === "string" ? item.trim() : ""))
      : [];
    const pageEntries =
      parsePageEntries(body.pageEntries) ||
      [];
    const tracks = parseTracks(body.tracks);

    const effectivePageEntries = pageEntries.length
      ? pageEntries
      : pageTexts
          .map((text, pageIndex) => ({
            pageIndex,
            slot: "single" as const,
            text: text.trim(),
          }))
          .filter((item) => item.text.length > 0);

    if (!effectivePageEntries.length || !tracks.length) {
      return NextResponse.json(
        { error: "pageEntries/pageTexts and tracks are required" },
        { status: 400 }
      );
    }

    const ai = getAiClient();
    const allTrackTokens: TranscriptToken[][] = [];

    for (let index = 0; index < tracks.length; index += 1) {
      const tokens = await transcribeTrack(ai, tracks[index]);
      allTrackTokens.push(tokens);
    }

    const matches = alignPagesToTracks(effectivePageEntries, allTrackTokens, tracks);
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
      pages: effectivePageEntries.map((entry) => {
        const match =
          matches.find(
            (item) => item.pageIndex === entry.pageIndex && item.slot === entry.slot
          ) || null;
        return {
          pageIndex: entry.pageIndex,
          slot: entry.slot,
          pageText: entry.text,
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
      totalPages: effectivePageEntries.length,
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
