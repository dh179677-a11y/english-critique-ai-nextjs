"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useRef, useState } from "react";

import {
  getStudentStoryflowAssignments,
  hydrateStudentStoryflowAssignments,
} from "@/lib/storyflowAssignments";
import {
  getTeacherStoryflowDocuments,
  hydrateAccessibleStoryflowDocumentsForTeachers,
  type StoryflowDocument,
} from "@/lib/storyflowStore";
import {
  formatStoryCharacterProfileForPrompt,
  oxfordReadingTreeCharacterProfile,
} from "@/lib/storyCharacterProfiles";
import {
  agentLessonFlowPrompt,
  agentLessonStepLabels,
  formatAgentLessonStatePrompt,
  type AgentLessonState,
  type AgentLessonStep,
} from "@/lib/agentLessonFlow";
import { useSessionProfile } from "@/lib/useSessionProfile";

type AgentMaterialPage = {
  id: string;
  title: string;
  fileName: string;
  kind: "image" | "pdf" | "word";
  previewUrl: string;
  text: string;
  originalPageLabel?: string;
  originalPageSegments?: Array<{
    label?: string;
    text: string;
  }>;
  imageWidth?: number;
  imageHeight?: number;
  pdfSecondPreviewUrl?: string;
  pdfPageNumber?: number;
  pdfSpreadEnd?: number;
  pdfPageCount?: number;
};

type AgentOcrImagePart = {
  label: "left" | "right" | "page";
  image: string;
};

type AgentMessage = {
  id: string;
  role: "student" | "coach";
  text: string;
};

type AgentStudyRecord = {
  id: string;
  title: string;
  fileType: AgentMaterialPage["kind"];
  createdAt: number;
  updatedAt: number;
  currentPageIndex: number;
  pages: AgentMaterialPage[];
  messages: AgentMessage[];
};

type RtcAgentSession = {
  appId: string;
  roomId: string;
  userId: string;
  agentUserId: string;
  taskId: string;
  token: string;
};

type AgentRtcEngine = {
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
  unsubscribeStream?: (userId: string, mediaType: number) => Promise<void>;
  play: (userId?: string, mediaType?: number) => Promise<void>;
  stop?: (userId?: string, mediaType?: number) => void;
  startSubtitle?: (config: { mode: number }) => Promise<void>;
  stopSubtitle?: () => Promise<void> | void;
  leaveRoom?: () => Promise<void>;
  destroy?: () => Promise<void> | void;
};

type PdfJsModule = Awaited<typeof import("pdfjs-dist/legacy/build/pdf.mjs")>;
type PdfJsDocumentInit = Parameters<PdfJsModule["getDocument"]>[0];

const acceptedTypes = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png",
].join(",");

const materialInputId = "agent-material-upload";
const agentRecordsStorageKey = "englishpro_agent_study_records";
const PDFJS_VERSION = "5.6.205";
const PDFJS_CDN_CANDIDATES = [
  `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/legacy/build/pdf.mjs`,
  `https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/legacy/build/pdf.mjs?module`,
];
const PDFJS_WORKER_CDN_CANDIDATES = [
  `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/legacy/build/pdf.worker.min.mjs`,
  `https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/legacy/build/pdf.worker.min.mjs?module`,
];
const voiceStreamSilenceEndMs = 1200;
const voiceStreamTurnTimeoutMs = 22000;

let pdfJsModulePromise: Promise<PdfJsModule> | null = null;

const normalizeText = (value: string, maxLength = 1200) => {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength).trim()}...`
    : normalized;
};

const isVoiceSubtitleMessage = (message: AgentMessage) =>
  message.id.startsWith("rtc_subtitle_") || message.id.startsWith("rts_subtitle_");

const matchStopWords = new Set([
  "pdf",
  "doc",
  "docx",
  "jpg",
  "jpeg",
  "png",
  "the",
  "and",
  "book",
  "page",
  "pages",
  "scan",
  "image",
  "story",
  "english",
  "reading",
]);

const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error || new Error("文件读取失败"));
    reader.readAsDataURL(file);
  });

const readImageMetadata = (dataUrl: string) =>
  new Promise<{ width: number; height: number }>((resolve) => {
    const image = new Image();
    image.onload = () => {
      resolve({
        width: image.naturalWidth || image.width || 0,
        height: image.naturalHeight || image.height || 0,
      });
    };
    image.onerror = () => resolve({ width: 0, height: 0 });
    image.src = dataUrl;
  });

const loadImageElement = (source: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片加载失败"));
    image.src = source;
  });

const renderImagesToDataUrl = async (
  imageSources: string[],
  options: {
    maxWidth: number;
    maxHeight: number;
    quality: number;
    gap?: number;
  }
) => {
  const images = await Promise.all(imageSources.filter(Boolean).map(loadImageElement));
  if (!images.length) return "";

  const gap = options.gap || 0;
  const naturalSizes = images.map((image) => ({
    width: image.naturalWidth || image.width || 1,
    height: image.naturalHeight || image.height || 1,
  }));
  const targetHeight = Math.max(...naturalSizes.map((size) => size.height));
  const scaledWidths = naturalSizes.map((size) => (size.width * targetHeight) / size.height);
  const naturalWidth = scaledWidths.reduce((total, width) => total + width, 0) + gap * (images.length - 1);
  const scale = Math.min(1, options.maxWidth / naturalWidth, options.maxHeight / targetHeight);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(targetHeight * scale));
  const context = canvas.getContext("2d");

  if (!context) {
    canvas.width = 0;
    canvas.height = 0;
    return "";
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);

  let offsetX = 0;
  images.forEach((image, index) => {
    const size = naturalSizes[index];
    const drawWidth = scaledWidths[index] * scale;
    const drawHeight = targetHeight * scale;
    context.drawImage(image, offsetX, 0, drawWidth, drawHeight);
    offsetX += drawWidth + gap * scale;
  });

  const dataUrl = canvas.toDataURL("image/jpeg", options.quality);
  canvas.width = 0;
  canvas.height = 0;
  return dataUrl;
};

const renderImageCropToDataUrl = async (
  source: string,
  crop: {
    x: number;
    y: number;
    width: number;
    height: number;
  },
  options: {
    maxWidth: number;
    maxHeight: number;
    quality: number;
  }
) => {
  const image = await loadImageElement(source);
  const sourceWidth = image.naturalWidth || image.width || 1;
  const sourceHeight = image.naturalHeight || image.height || 1;
  const cropX = Math.max(0, Math.min(sourceWidth - 1, crop.x));
  const cropY = Math.max(0, Math.min(sourceHeight - 1, crop.y));
  const cropWidth = Math.max(1, Math.min(sourceWidth - cropX, crop.width));
  const cropHeight = Math.max(1, Math.min(sourceHeight - cropY, crop.height));
  const scale = Math.min(1, options.maxWidth / cropWidth, options.maxHeight / cropHeight);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(cropWidth * scale));
  canvas.height = Math.max(1, Math.round(cropHeight * scale));
  const context = canvas.getContext("2d");

  if (!context) {
    canvas.width = 0;
    canvas.height = 0;
    return "";
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(
    image,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
    0,
    0,
    canvas.width,
    canvas.height
  );
  const dataUrl = canvas.toDataURL("image/jpeg", options.quality);
  canvas.width = 0;
  canvas.height = 0;
  return dataUrl;
};

const createAgentAnalysisImage = async (page: AgentMaterialPage) => {
  const sources = [page.previewUrl, page.pdfSecondPreviewUrl || ""].filter((source) =>
    source.startsWith("data:image/")
  );
  if (!sources.length) return "";

  return renderImagesToDataUrl(sources, {
    maxWidth: sources.length > 1 ? 2600 : 2000,
    maxHeight: sources.length > 1 ? 1900 : 2200,
    quality: page.kind === "pdf" ? 0.86 : 0.84,
  });
};

const createAgentTextFocusImage = async (page?: AgentMaterialPage) => {
  if (!page) return "";
  const sources = [page.previewUrl, page.pdfSecondPreviewUrl || ""].filter((source) =>
    source.startsWith("data:image/")
  );
  if (!sources.length) return "";

  try {
    const images = await Promise.all(sources.map(loadImageElement));
    const cropRects = images.map((image) => {
      const width = image.naturalWidth || image.width || 1;
      const height = image.naturalHeight || image.height || 1;
      return {
        width,
        height,
        cropY: 0,
        cropHeight: height,
      };
    });
    const targetHeight = Math.max(...cropRects.map((rect) => rect.cropHeight));
    const scaledWidths = cropRects.map((rect) => (rect.width * targetHeight) / rect.cropHeight);
    const naturalWidth = scaledWidths.reduce((total, width) => total + width, 0);
    const scale = Math.min(1, 2800 / naturalWidth, 1800 / targetHeight);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(targetHeight * scale));
    const context = canvas.getContext("2d");

    if (!context) {
      canvas.width = 0;
      canvas.height = 0;
      return "";
    }

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);

    let offsetX = 0;
    images.forEach((image, index) => {
      const rect = cropRects[index];
      const drawWidth = scaledWidths[index] * scale;
      const drawHeight = targetHeight * scale;
      context.drawImage(
        image,
        0,
        rect.cropY,
        rect.width,
        rect.cropHeight,
        offsetX,
        0,
        drawWidth,
        drawHeight
      );
      offsetX += drawWidth;
    });

    const dataUrl = canvas.toDataURL("image/jpeg", page.kind === "pdf" ? 0.88 : 0.84);
    canvas.width = 0;
    canvas.height = 0;
    return dataUrl.length <= 2_800_000 ? dataUrl : "";
  } catch {
    return "";
  }
};

const createAgentOcrImageParts = async (page?: AgentMaterialPage): Promise<AgentOcrImagePart[]> => {
  if (!page) return [];
  const sources = [page.previewUrl, page.pdfSecondPreviewUrl || ""].filter((source) =>
    source.startsWith("data:image/")
  );
  if (!sources.length) return [];

  try {
    if (sources.length >= 2) {
      const parts = await Promise.all(
        sources.slice(0, 2).map(async (source, index) => {
          const metadata = await readImageMetadata(source);
          const width = metadata.width || 1;
          const height = metadata.height || 1;
          const textCropY = Math.round(height * 0.48);
          const image = await renderImageCropToDataUrl(
            source,
            {
              x: 0,
              y: textCropY,
              width,
              height: height - textCropY,
            },
            {
              maxWidth: 1600,
              maxHeight: 1100,
              quality: page.kind === "pdf" ? 0.9 : 0.86,
            }
          );
          return {
            label: index === 0 ? "left" : "right",
            image,
          } satisfies AgentOcrImagePart;
        })
      );
      return parts.filter((part) => part.image);
    }

    const source = sources[0];
    const metadata = await readImageMetadata(source);
    const width = metadata.width || 1;
    const height = metadata.height || 1;
    const isSpread = width > height * 1.12;
    if (isSpread) {
      const gutter = Math.max(0, Math.round(width * 0.018));
      const midpoint = width / 2;
      const textCropY = Math.round(height * 0.48);
      const textCropHeight = height - textCropY;
      const [leftImage, rightImage] = await Promise.all([
        renderImageCropToDataUrl(
          source,
          {
            x: 0,
            y: textCropY,
            width: midpoint - gutter / 2,
            height: textCropHeight,
          },
          {
            maxWidth: 1600,
            maxHeight: 1100,
            quality: page.kind === "pdf" ? 0.9 : 0.86,
          }
        ),
        renderImageCropToDataUrl(
          source,
          {
            x: midpoint + gutter / 2,
            y: textCropY,
            width: width - midpoint - gutter / 2,
            height: textCropHeight,
          },
          {
            maxWidth: 1600,
            maxHeight: 1100,
            quality: page.kind === "pdf" ? 0.9 : 0.86,
          }
        ),
      ]);
      const spreadParts: AgentOcrImagePart[] = [
        { label: "left", image: leftImage },
        { label: "right", image: rightImage },
      ];
      return spreadParts.filter((part) => part.image);
    }

    const focusedImage = await createAgentTextFocusImage(page);
    return focusedImage ? [{ label: "page", image: focusedImage }] : [];
  } catch {
    const focusedImage = await createAgentTextFocusImage(page);
    return focusedImage ? [{ label: "page", image: focusedImage }] : [];
  }
};

const createCoachScreenshotDataUrl = async (page?: AgentMaterialPage) => {
  if (!page) return "";
  try {
    const dataUrl = await renderImagesToDataUrl(
      [page.previewUrl, page.pdfSecondPreviewUrl || ""].filter((source) =>
        source.startsWith("data:image/")
      ),
      {
        maxWidth: page.pdfSecondPreviewUrl ? 1300 : 1100,
        maxHeight: 900,
        quality: page.kind === "pdf" ? 0.62 : 0.72,
      }
    );
    return dataUrl.length <= 1_100_000 ? dataUrl : "";
  } catch {
    return "";
  }
};

const importPdfJsFromUrl = (url: string) =>
  import(/* webpackIgnore: true */ url) as Promise<PdfJsModule>;

const configurePdfJs = (module: PdfJsModule, preferredWorkerUrl?: string) => {
  if ("GlobalWorkerOptions" in module && module.GlobalWorkerOptions) {
    module.GlobalWorkerOptions.workerSrc = preferredWorkerUrl || PDFJS_WORKER_CDN_CANDIDATES[0];
  }
  return module;
};

const loadPdfJs = async () => {
  if (!pdfJsModulePromise) {
    pdfJsModulePromise = (async () => {
      let lastError: unknown = null;

      for (let index = 0; index < PDFJS_CDN_CANDIDATES.length; index += 1) {
        try {
          const module = await importPdfJsFromUrl(PDFJS_CDN_CANDIDATES[index]);
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

const getRealtimeCoachWebSocketUrl = () => {
  const port = process.env.NEXT_PUBLIC_REALTIME_COACH_PORT || "3001";
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.hostname}:${port}/storyflow/doubao-stream`;
};

const downsampleToPcm16Bytes = (input: Float32Array, inputSampleRate: number) => {
  const outputSampleRate = 16000;
  const ratio = inputSampleRate / outputSampleRate;
  const outputLength = Math.max(1, Math.floor(input.length / ratio));
  const output = new Uint8Array(outputLength * 2);
  const view = new DataView(output.buffer);

  for (let index = 0; index < outputLength; index += 1) {
    const sampleIndex = Math.min(input.length - 1, Math.floor(index * ratio));
    const sample = Math.max(-1, Math.min(1, input[sampleIndex]));
    view.setInt16(index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }

  return output;
};

const pcm16BytesToFloat32 = (input: ArrayBuffer) => {
  const view = new DataView(input);
  const output = new Float32Array(Math.floor(input.byteLength / 2));
  for (let index = 0; index < output.length; index += 1) {
    output[index] = view.getInt16(index * 2, true) / 0x8000;
  }
  return output;
};

const mergeBytes = (left: Uint8Array, right: Uint8Array) => {
  if (!left.length) return right;
  const merged = new Uint8Array(left.length + right.length);
  merged.set(left, 0);
  merged.set(right, left.length);
  return merged;
};

const formatRecordTime = (timestamp: number) => {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  return `${date.getMonth() + 1}/${date.getDate()} ${date
    .getHours()
    .toString()
    .padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
};

const xmlToPlainText = (value: string) =>
  value
    .replace(/<w:p[\s\S]*?>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const inflateRaw = async (bytes: Uint8Array) => {
  if (typeof DecompressionStream === "undefined") return null;

  try {
    const stream = new Blob([bytes]).stream().pipeThrough(
      new DecompressionStream("deflate-raw" as CompressionFormat)
    );
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
};

const readZipFileEntry = async (buffer: ArrayBuffer, targetName: string) => {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let eocdOffset = -1;

  for (let offset = bytes.length - 22; offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      eocdOffset = offset;
      break;
    }
  }

  if (eocdOffset < 0) return null;

  const centralDirectorySize = view.getUint32(eocdOffset + 12, true);
  const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true);
  const decoder = new TextDecoder();
  let offset = centralDirectoryOffset;
  const end = centralDirectoryOffset + centralDirectorySize;

  while (offset < end && view.getUint32(offset, true) === 0x02014b50) {
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const fileNameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const fileName = decoder.decode(
      bytes.slice(offset + 46, offset + 46 + fileNameLength)
    );

    if (fileName === targetName) {
      const localNameLength = view.getUint16(localHeaderOffset + 26, true);
      const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
      const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;
      const compressed = bytes.slice(dataOffset, dataOffset + compressedSize);

      if (method === 0) return compressed;
      if (method === 8) return inflateRaw(compressed);
      return null;
    }

    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return null;
};

const extractDocxText = async (file: File) => {
  if (!file.name.toLowerCase().endsWith(".docx")) return "";
  const documentXml = await readZipFileEntry(await file.arrayBuffer(), "word/document.xml");
  if (!documentXml) return "";
  return xmlToPlainText(new TextDecoder().decode(documentXml));
};

type PdfPositionedTextItem = {
  str: string;
  x: number;
  y: number;
};

const groupPdfTextLines = (items: PdfPositionedTextItem[]) => {
  const lineTolerance = 7;
  const lines: Array<{ y: number; items: PdfPositionedTextItem[] }> = [];

  items
    .slice()
    .sort((left, right) => {
      if (Math.abs(right.y - left.y) > lineTolerance) return right.y - left.y;
      return left.x - right.x;
    })
    .forEach((item) => {
      const line = lines.find((candidate) => Math.abs(candidate.y - item.y) <= lineTolerance);
      if (line) {
        line.items.push(item);
        line.y = (line.y + item.y) / 2;
      } else {
        lines.push({ y: item.y, items: [item] });
      }
    });

  return lines
    .sort((left, right) => right.y - left.y)
    .map((line) => ({
      y: line.y,
      items: line.items.slice().sort((left, right) => left.x - right.x),
      text: line.items
        .slice()
        .sort((left, right) => left.x - right.x)
        .map((item) => item.str)
        .join(" "),
    }));
};

const mergePdfTextItems = (items: PdfPositionedTextItem[]) => {
  return groupPdfTextLines(items)
    .map((line) => line.text)
    .join(" ");
};

const getPdfBodyTextItems = (items: PdfPositionedTextItem[], pageHeight: number) => {
  const fallbackItems = items.filter((item) => item.y >= pageHeight * 0.04 && item.y <= pageHeight * 0.92);
  const lines = groupPdfTextLines(items)
    .filter((line) => /[A-Za-z]/.test(line.text))
    .filter((line) => !/^\d{1,3}$/.test(line.text.replace(/\s+/g, "")))
    .filter((line) => line.y >= pageHeight * 0.04 && line.y <= pageHeight * 0.92);

  if (!lines.length) return fallbackItems;

  const text = normalizeText(lines.map((line) => line.text).join(" "), 1600);
  if ((text.match(/[A-Za-z]/g)?.length || 0) < 8 || text.split(/\s+/).length < 4) {
    return fallbackItems;
  }

  return lines.flatMap((line) => line.items);
		};

const formatOriginalPageSegments = (
  segments: Array<{
    label?: string;
    text: string;
  }>
) =>
  segments
    .filter((segment) => getUsefulPageText(segment.text))
    .map((segment, index, filteredSegments) => {
      const sideLabel =
        filteredSegments.length >= 2
          ? index === 0
            ? "左页"
            : index === 1
              ? "右页"
              : `第 ${index + 1} 段`
          : "";
      const pageLabel = segment.label ? `绘本页 ${segment.label}` : "";
      const label = [sideLabel, pageLabel].filter(Boolean).join(" ");
      return label
        ? `${label}全文: ${normalizeText(segment.text, 900)}`
        : normalizeText(segment.text, 900);
    })
    .join(" ");

const formatOriginalPageSegmentsForReading = (
  segments: Array<{
    label?: string;
    text: string;
  }>
) =>
  normalizeText(
    segments
      .map((segment) => getUsefulPageText(segment.text, 900))
      .filter(Boolean)
      .join(" "),
    1800
  );

const getPrintedPageNumber = (
  items: Array<{
    str: string;
    x: number;
    y: number;
  }>,
  side: "left" | "right",
  pageWidth: number,
  pageHeight: number
) => {
  const midpoint = pageWidth / 2;
  const candidates = items
    .filter((item) => /^\d{1,3}$/.test(item.str))
    .filter((item) => item.y <= pageHeight * 0.24)
    .filter((item) => (side === "left" ? item.x < midpoint : item.x >= midpoint))
    .sort((left, right) => {
      const edgeX = side === "left" ? 0 : pageWidth;
      return (
        left.y - right.y ||
        Math.abs(left.x - edgeX) - Math.abs(right.x - edgeX)
      );
    });
  return candidates[0]?.str || "";
};

const getSpreadPrintedPageLabel = (
  items: Array<{
    str: string;
    x: number;
    y: number;
  }>,
  pageWidth: number,
  pageHeight: number
) => {
  const leftLabel = getPrintedPageNumber(items, "left", pageWidth, pageHeight);
  const rightLabel = getPrintedPageNumber(items, "right", pageWidth, pageHeight);

  if (leftLabel && rightLabel && leftLabel !== rightLabel) return `${leftLabel}-${rightLabel}`;
  return leftLabel || rightLabel;
};

const extractPdfStoryText = (
  textItems: Array<{ str?: string; transform?: number[] }>,
  pageWidth: number,
  pageHeight: number
) => {
  const allPositionedItems = textItems
    .map((item) => ({
      str: typeof item.str === "string" ? item.str.trim() : "",
      x: Array.isArray(item.transform) ? Number(item.transform[4] || 0) : 0,
      y: Array.isArray(item.transform) ? Number(item.transform[5] || 0) : 0,
    }))
    .filter((item) => item.str);
  const positionedItems = allPositionedItems
    .filter((item) => item.str && /[A-Za-z]/.test(item.str));
  const bodyItems = getPdfBodyTextItems(positionedItems, pageHeight);
  const midpoint = pageWidth / 2;
  const isSpreadPage = pageWidth > pageHeight * 1.08;
  const printedPageLabel = isSpreadPage
    ? getSpreadPrintedPageLabel(allPositionedItems, pageWidth, pageHeight)
    : getPrintedPageNumber(allPositionedItems, "left", pageWidth, pageHeight);

  if (isSpreadPage) {
    const leftBodyItems = getPdfBodyTextItems(
      positionedItems.filter((item) => item.x < midpoint),
      pageHeight
    );
    const rightBodyItems = getPdfBodyTextItems(
      positionedItems.filter((item) => item.x >= midpoint),
      pageHeight
    );
    const leftText = normalizeText(mergePdfTextItems(leftBodyItems), 1400);
    const rightText = normalizeText(mergePdfTextItems(rightBodyItems), 1400);
    const segments = [
      {
        label: getPrintedPageNumber(allPositionedItems, "left", pageWidth, pageHeight),
        text: leftText,
      },
      {
        label: getPrintedPageNumber(allPositionedItems, "right", pageWidth, pageHeight),
        text: rightText,
      },
    ].filter((segment) => getUsefulPageText(segment.text));

    if (segments.length >= 2) {
      return {
        text: formatOriginalPageSegmentsForReading(segments),
        originalPageLabel:
          segments.map((segment) => segment.label).filter(Boolean).join("-") ||
          printedPageLabel,
        originalPageSegments: segments,
      };
    }
  }

  const bodyText = normalizeText(mergePdfTextItems(bodyItems), 1600);

  if (bodyText.match(/[A-Za-z]/g)?.length && bodyText.split(/\s+/).length >= 4) {
    return {
      text: bodyText,
      originalPageLabel: printedPageLabel,
      originalPageSegments: [],
    };
  }

  return {
    text: normalizeText(mergePdfTextItems(positionedItems), 1600),
    originalPageLabel: printedPageLabel,
    originalPageSegments: [],
  };
};

const createPdfPages = async (file: File): Promise<AgentMaterialPage[]> => {
  const pdfjsLib = await loadPdfJs();
  const pdf = await pdfjsLib.getDocument({
    data: await file.arrayBuffer(),
    disableWorker: true,
  } as PdfJsDocumentInit).promise;
  const pageCount = pdf.numPages;
  const renderedPages: Array<{
    pageNumber: number;
    previewUrl: string;
    text: string;
    originalPageLabel?: string;
    originalPageSegments?: Array<{
      label?: string;
      text: string;
    }>;
    width: number;
    height: number;
  }> = [];

  const renderPdfPage = async (pageNumber: number) => {
    const page = await pdf.getPage(pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = Math.min(2, Math.max(1, 1500 / Math.max(baseViewport.width, baseViewport.height)));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);

    if (!context) {
      page.cleanup();
      throw new Error(`第 ${pageNumber} 页渲染失败`);
    }

    try {
      await page.render({
        canvas,
        canvasContext: context,
        viewport,
      }).promise;

      const textContent = await page.getTextContent();
      const storyText = extractPdfStoryText(
        textContent.items as Array<{ str?: string; transform?: number[] }>,
        baseViewport.width,
        baseViewport.height
      );

      return {
        pageNumber,
        previewUrl: canvas.toDataURL("image/jpeg", 0.86),
        text: storyText.text,
        originalPageLabel: storyText.originalPageLabel,
        originalPageSegments: storyText.originalPageSegments,
        width: canvas.width,
        height: canvas.height,
      };
    } finally {
      canvas.width = 0;
      canvas.height = 0;
      page.cleanup();
    }
  };

  const batchSize = 3;
  for (let start = 1; start <= pageCount; start += batchSize) {
    const batch = Array.from(
      { length: Math.min(batchSize, pageCount - start + 1) },
      (_, offset) => start + offset
    );
    // eslint-disable-next-line no-await-in-loop
    renderedPages.push(...(await Promise.all(batch.map((pageNumber) => renderPdfPage(pageNumber)))));
  }

  return renderedPages
    .sort((left, right) => left.pageNumber - right.pageNumber)
    .map((renderedPage) => ({
      id: `${file.name}_${file.lastModified}_pdf_${renderedPage.pageNumber}`,
      title: `${file.name} 第 ${renderedPage.pageNumber} 页`,
      fileName: file.name,
      kind: "pdf",
      previewUrl: renderedPage.previewUrl,
      text: renderedPage.text,
      originalPageLabel: renderedPage.originalPageLabel,
      originalPageSegments: renderedPage.originalPageSegments,
      imageWidth: renderedPage.width,
      imageHeight: renderedPage.height,
      pdfSecondPreviewUrl: "",
      pdfPageNumber: renderedPage.pageNumber,
      pdfSpreadEnd: renderedPage.pageNumber,
      pdfPageCount: pageCount,
    } satisfies AgentMaterialPage));
};

const getPageCounterLabel = (
  page: AgentMaterialPage | undefined,
  fallbackIndex: number,
  allPages: AgentMaterialPage[]
) => {
  if (!allPages.length) return "等待上传";
  if (page?.kind === "pdf") {
    const total = page.pdfPageCount || allPages.length;
    const pdfPageNumber = page.pdfPageNumber || fallbackIndex + 1;

    if (pdfPageNumber <= 1) return "封面";
    if (pdfPageNumber >= total) return "封底";

    if (pdfPageNumber === 2) return "绘本页 1";

    const inferredStart = (pdfPageNumber - 2) * 2;
    const inferredEnd = inferredStart + 1;
    if (page.originalPageLabel) {
      const originalLabel = page.originalPageLabel
        .trim()
        .replace(/\s*[\/／]\s*/g, "-")
        .replace(/\s*-\s*/g, "-");
      const singlePrintedNumber = Number(originalLabel);
      if (
        Number.isFinite(singlePrintedNumber) &&
        `${singlePrintedNumber}` === originalLabel
      ) {
        if (singlePrintedNumber >= inferredStart && singlePrintedNumber <= inferredEnd) {
          return `绘本页 ${inferredStart}-${inferredEnd}`;
        }
        return `绘本页 ${singlePrintedNumber}-${singlePrintedNumber + 1}`;
      }
      return `绘本页 ${originalLabel}`;
    }

    return `绘本页 ${inferredStart}-${inferredEnd}`;
  }
  if (page?.originalPageLabel) {
    return `绘本页 ${page.originalPageLabel}`;
  }
  return allPages.length ? `${fallbackIndex + 1}/${allPages.length} 页` : "0/0 页";
};

const getAgentPageLabel = (
  page: AgentMaterialPage | undefined,
  fallbackIndex: number,
  allPages: AgentMaterialPage[]
) => getPageCounterLabel(page, fallbackIndex, allPages);

const getAgentPageTextIndex = (pages: AgentMaterialPage[]) =>
  pages.slice(0, 12).flatMap((item, index) => {
    const segments = item.originalPageSegments?.filter((segment) =>
      getUsefulPageText(segment.text)
    );
    if (segments?.length) {
      return segments.map((segment) => ({
        pageLabel: segment.label ? `绘本页 ${segment.label}` : getAgentPageLabel(item, index, pages),
        text: getUsefulPageText(segment.text),
      }));
    }

    return [
      {
        pageLabel: getAgentPageLabel(item, index, pages),
        text: getMaterialPageText(item),
      },
    ];
  }).filter((item) => item.text);

const buildInitialAnalysis = (pages: AgentMaterialPage[]) => {
  const firstPage = pages[0];
  if (firstPage?.kind === "word") {
    return "资料已经上传好了。我先看一看内容，等一下会像老师一样带你一页一页学。";
  }
  return "资料已经上传好了。我先看一看第一页，等一下会先陪你看图，再一起读句子。";
};

const buildAgentTeacherStart = (pages: AgentMaterialPage[]) => {
  const firstPage = pages[0];
  if (firstPage?.kind === "word") {
    return "你好，我是今天陪你读这份资料的 Mia 老师。我们不用着急，我会一段一段陪你读。每一段我们会先看内容，再读句子，最后聊一聊意思。读错没关系，我会帮你找到最值得练的地方。你想先听老师读一遍，还是你先试着读第一段？";
  }
  return "你好，我是今天陪你读这本书的 Mia 老师。我们不用着急，我会一页一页陪你读。每一页我们会先看图，再读句子，最后聊一聊故事。读错没关系，我会帮你找到最值得练的地方。你想先听老师读一遍，还是你先试着读第一页？";
};

const cleanPronunciationTarget = (value: string) => {
  const cleaned = value
    .replace(/[，。！？、；：:,.!?;]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!/[A-Za-z]/.test(cleaned)) return "";
  if (/^(Mia|Agent|AI|OK)$/i.test(cleaned)) return "";
  return cleaned.length > 80 ? cleaned.slice(0, 80).trim() : cleaned;
};

const extractPronunciationTarget = (history: AgentMessage[]) => {
  const coachTurns = history
    .filter((message) => message.role === "coach")
    .slice(-5)
    .reverse();

  for (const message of coachTurns) {
    const text = message.text.replace(/\s+/g, " ");
    if (!/(跟我读|读一下|读一遍|再读|重读|朗读|发音|这个单词|单词|say|repeat)/i.test(text)) {
      continue;
    }

    const quoted =
      text.match(/[“"']([A-Za-z][A-Za-z'’ -]{0,80})[”"']/)?.[1] ||
      text.match(/[‘']([A-Za-z][A-Za-z'’ -]{0,80})[’']/)?.[1];
    if (quoted) {
      const target = cleanPronunciationTarget(quoted);
      if (target) return target;
    }

    const afterRead = text.match(
      /(?:跟我读|读一下|读一遍|再读|重读|朗读|say|repeat)\s*(?:[:：])?\s*([A-Za-z][A-Za-z'’-]*(?:\s+[A-Za-z][A-Za-z'’-]*){0,5})/i
    )?.[1];
    if (afterRead) {
      const target = cleanPronunciationTarget(afterRead);
      if (target) return target;
    }

    const beforeWord = text.match(
      /([A-Za-z][A-Za-z'’-]*(?:\s+[A-Za-z][A-Za-z'’-]*){0,4})\s*(?:这个单词|这个词|的发音|读音)/i
    )?.[1];
    if (beforeWord) {
      const target = cleanPronunciationTarget(beforeWord);
      if (target) return target;
    }
  }

  return "";
};

const getUsefulPageText = (value?: string, maxLength = 260) => {
  const text = normalizeText(value || "", maxLength);
  if (!text) return "";
  if (/^\d{1,4}$/.test(text.replace(/\s+/g, ""))) return "";
  return text;
};

const isReadOriginalRequest = (value: string) =>
  /读|朗读|读一遍|读一下|读一读|句子|原文|正文|内容|这一页|当前页|图片下面|下面的文字|讲|解释|总结|重点|看图|画面|图片/.test(
    value
  );

const normalizeMatchText = (value: string) =>
  value
    .toLowerCase()
    .replace(/\.(pdf|docx?|jpe?g|png|webp)\b/gi, " ")
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokenizeMatchText = (value: string) =>
  normalizeMatchText(value)
    .split(" ")
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);

const getSignificantMatchTokens = (value: string) =>
  tokenizeMatchText(value).filter(
    (token) => token.length >= 3 && !matchStopWords.has(token)
  );

const isFileReferenceText = (text: string, sourceName = "") => {
  const normalized = normalizeText(text, 420);
  if (!normalized) return false;
  if (/\.(pdf|docx?|jpe?g|png|webp)\b/i.test(normalized)) return true;

  const textKey = normalizeMatchText(normalized);
  const sourceKeys = sourceName
    .split("|")
    .map((item) => normalizeMatchText(item))
    .filter(Boolean);
  return Boolean(textKey && sourceKeys.some((sourceKey) => textKey === sourceKey));
};

const getMaterialPageText = (page?: AgentMaterialPage, maxLength = 260) => {
  const text = getUsefulPageText(page?.text, maxLength);
  if (!text) return "";
  if (isFileReferenceText(text, [page?.fileName, page?.title].filter(Boolean).join("|"))) {
    return "";
  }
  return text;
};

const getMaterialPageSegments = (page?: AgentMaterialPage, maxLength = 900) =>
  (page?.originalPageSegments || [])
    .map((segment) => {
      const text = getUsefulPageText(segment.text, maxLength);
      return {
        label: segment.label,
        text: isFileReferenceText(text, [page?.fileName, page?.title].filter(Boolean).join("|"))
          ? ""
          : text,
      };
    })
    .filter((segment) => segment.text);

const getOcrPartSegmentLabel = (page: AgentMaterialPage | undefined, part: AgentOcrImagePart) => {
  const labels = (page?.originalPageLabel || "")
    .split("-")
    .map((item) => item.trim())
    .filter(Boolean);
  if (part.label === "left") return labels[0] || "";
  if (part.label === "right") return labels[1] || "";
  return page?.originalPageLabel || "";
};

const isImageDescriptionRequest = (value: string) =>
  /封面|画面|图片|图里|看图|看到|有什么|描述|讲讲.*图|介绍.*图|人物|发生/.test(value);

const shouldUseStoryflowTextForAgentPage = (existingText: string, storyflowText: string) => {
  const existing = getUsefulPageText(existingText, 1800);
  const storyflow = getUsefulPageText(storyflowText, 1800);
  if (!storyflow) return false;
  if (!existing) return true;

  const existingNormalized = normalizeMatchText(existing);
  const storyflowNormalized = normalizeMatchText(storyflow);
  if (!storyflowNormalized) return false;
  if (!existingNormalized) return true;
  if (existingNormalized.includes(storyflowNormalized)) return false;
  if (storyflowNormalized.includes(existingNormalized)) return storyflow.length >= existing.length;

  const existingTokens = new Set(getSignificantMatchTokens(existing));
  const storyflowTokens = getSignificantMatchTokens(storyflow);
  if (!storyflowTokens.length) return false;
  const storyflowTokenSet = new Set(storyflowTokens);
  const existingTokenList = getSignificantMatchTokens(existing);
  const overlapRatio =
    storyflowTokens.filter((token) => existingTokens.has(token)).length / storyflowTokens.length;
  const existingCoveredRatio = existingTokenList.length
    ? existingTokenList.filter((token) => storyflowTokenSet.has(token)).length / existingTokenList.length
    : 0;
  const addedTokenCount = storyflowTokens.filter((token) => !existingTokens.has(token)).length;

  if (
    storyflow.length > existing.length + 12 &&
    existingCoveredRatio >= 0.55 &&
    addedTokenCount >= 3
  ) {
    return true;
  }

  return storyflow.length > existing.length * 1.35 && overlapRatio >= 0.72;
};

const chooseAgentPageText = (existingText: string, storyflowText: string) =>
  shouldUseStoryflowTextForAgentPage(existingText, storyflowText)
    ? getUsefulPageText(storyflowText, 1800)
    : existingText;

const readFocusedPageText = async (page?: AgentMaterialPage) => {
  if (!page || page.kind === "word") return "";
  const parts = await createAgentOcrImageParts(page);
  const images =
    parts.length > 0
      ? parts.map((part) => part.image)
      : [(await createAgentTextFocusImage(page)) || (await createAgentAnalysisImage(page))].filter(Boolean);
  if (!images.length) return "";

  const response = await fetch("/api/storyflow/ocr", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ images }),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    texts?: unknown;
  };

  if (!response.ok || !Array.isArray(payload.texts)) return "";
  const texts = payload.texts.map((item) => (typeof item === "string" ? item : ""));
  if (parts.length >= 2) {
    const segments = parts
      .map((part, index) => ({
        label: getOcrPartSegmentLabel(page, part),
        text: normalizeText(texts[index] || "", 900),
      }))
      .filter((segment) => getUsefulPageText(segment.text));
    if (segments.length >= 2) return formatOriginalPageSegmentsForReading(segments);
  }
  return normalizeText(texts[0] || "", 1600);
};

const resolveExactReadingText = async (page: AgentMaterialPage | undefined, currentText: string) => {
  const sourceName = [page?.fileName, page?.title].filter(Boolean).join("|");
  const orderedSegments = getMaterialPageSegments(page, 1600);
  const orderedSegmentText =
    orderedSegments.length >= 2 ? formatOriginalPageSegmentsForReading(orderedSegments) : "";
  const existingText =
    orderedSegmentText ||
    (isFileReferenceText(currentText, sourceName)
      ? ""
      : getUsefulPageText(currentText, 1600)) || getMaterialPageText(page, 1600);
  try {
    const focusedText = await readFocusedPageText(page);
    const mergedText = chooseAgentPageText(existingText, focusedText);
    if (isFileReferenceText(mergedText, sourceName)) return existingText;
    return getUsefulPageText(mergedText, 1600) || existingText;
  } catch {
    return existingText;
  }
};

const hasStoryflowDocumentTextEvidence = (
  document: StoryflowDocument,
  sourceName: string,
  pages: AgentMaterialPage[]
) => {
  const title = normalizeMatchText(
    [document.sourceName, document.analysis.title].filter(Boolean).join(" ")
  );
  const fullText = normalizeMatchText(document.analysis.fullText || "");
  const source = normalizeMatchText(sourceName);
  const sourceTokens = getSignificantMatchTokens(sourceName);
  const uploadedTextTokens = getSignificantMatchTokens(
    pages.map((page) => page.text).filter(Boolean).join(" ")
  );

  if (title && source && (title.includes(source) || source.includes(title))) {
    return true;
  }

  const hasFileNameEvidence = sourceTokens.some(
    (token) => title.includes(token) || fullText.includes(token)
  );
  if (hasFileNameEvidence) return true;

  return uploadedTextTokens.some(
    (token) => title.includes(token) || fullText.includes(token)
  );
};

const getStoryflowPageText = (document: StoryflowDocument, pageIndex: number) => {
  const shadowText = document.analysis.shadowPageTexts?.[pageIndex] || "";
  if (getUsefulPageText(shadowText)) return shadowText;
  const page = document.analysis.pages?.find((item) => item.pageIndex === pageIndex);
  return page?.visibleText || page?.storyBeat || "";
};

const mergeStoryflowTextsForAgentPage = (
  document: StoryflowDocument,
  page: AgentMaterialPage,
  fallbackIndex: number
) => {
  const startIndex =
    page.kind === "pdf" && page.pdfPageNumber
      ? Math.max(0, page.pdfPageNumber - 1)
      : fallbackIndex;
  const endIndex =
    page.kind === "pdf" && page.pdfSpreadEnd
      ? Math.max(startIndex, page.pdfSpreadEnd - 1)
      : startIndex;

  const texts = Array.from({ length: endIndex - startIndex + 1 }, (_, offset) =>
    getStoryflowPageText(document, startIndex + offset)
  )
    .map((item) => getUsefulPageText(item))
    .filter(Boolean);

  return texts.join(" [RIGHT_PAGE] ");
};

const scoreStoryflowDocumentMatch = (
  document: StoryflowDocument,
  pages: AgentMaterialPage[],
  sourceName: string
) => {
  const title = normalizeMatchText(
    [document.sourceName, document.analysis.title].filter(Boolean).join(" ")
  );
  const source = normalizeMatchText(sourceName);
  const fullText = normalizeMatchText(document.analysis.fullText || "");
  const sourceTokens = tokenizeMatchText(sourceName);
  const titleTokens = new Set(tokenizeMatchText(title));
  let score = 0;

  if (title && source) {
    if (title === source) score += 80;
    if (source.includes(title) || title.includes(source)) score += 45;
  }

  sourceTokens.forEach((token) => {
    if (titleTokens.has(token)) score += 10;
    if (fullText.includes(token)) score += 3;
  });

  const pdfPageCount = pages.find((page) => page.pdfPageCount)?.pdfPageCount || 0;
  const documentPageCount =
    document.pageCount ||
    document.analysis.shadowPageTexts?.length ||
    document.analysis.pages?.length ||
    0;
  if (pdfPageCount && documentPageCount) {
    if (pdfPageCount === documentPageCount) score += 28;
    if (Math.abs(pdfPageCount - documentPageCount) <= 1) score += 12;
  }

  const availableTextCount = Array.from(
    { length: documentPageCount },
    (_, index) => getUsefulPageText(getStoryflowPageText(document, index))
  ).filter(Boolean).length;
  score += Math.min(20, availableTextCount * 2);

  return score;
};

const applyStoryflowDocumentTexts = (
  pages: AgentMaterialPage[],
  document: StoryflowDocument
) => {
  const nextPages = pages.map((page, index) => {
    const storyflowText = mergeStoryflowTextsForAgentPage(document, page, index);
    return {
      ...page,
      text: chooseAgentPageText(page.text, storyflowText),
    };
  });
  const matchedCount = nextPages.filter((page) => getUsefulPageText(page.text)).length;
  return {
    pages: nextPages,
    matchedCount,
  };
};

const buildLocalAgentReply = (question: string, page?: AgentMaterialPage) => {
  const normalizedQuestion = question.replace(/\s+/g, " ").trim();
  const pageText = getMaterialPageText(page);
  const pronunciationTarget = cleanPronunciationTarget(
    normalizedQuestion.match(/^朗读练习[:：]\s*(.+)$/)?.[1] || ""
  );
  if (pronunciationTarget) {
    return `我听到你在练 ${pronunciationTarget}。先把这个词的主要音节读清楚就很好；再来一遍，注意开头音和结尾音，不用急。`;
  }
  if (/我先.*读|我来.*读|我.*试着读|自己.*读|先试着读/.test(normalizedQuestion)) {
    return "好，那你先试着读这一页，我来认真听。读错没关系，我只帮你找一个最值得练的地方。";
  }
  if (isImageDescriptionRequest(normalizedQuestion)) {
    return pageText
      ? `我先陪你看当前画面。能读到的文字是：${pageText}。我们再观察封面或图片里的主角、地点和最显眼的物品，猜一猜故事会围绕什么展开。你先说说你看到了什么？`
      : page?.kind === "pdf" && getPageCounterLabel(page, 0, [page]) === "封面"
        ? "我先陪你看封面：我们可以先找书名、主图里最显眼的人物或物品，再猜一猜这个故事会围绕什么展开。你先说说封面上你看到了什么？"
        : "我先陪你看画面：先找人物、地点和最明显的动作或物品，再用一句话说发生了什么。你先说说图里最吸引你注意的是什么？";
  }
  if (pageText && /老师先读|先听.*读|示范读|带我读/.test(normalizedQuestion)) {
    return `好，我先示范读一遍，你只要跟着感觉节奏就可以：${pageText}`;
  }
  if (pageText && /读|朗读|读一遍|句子|原文|正文/.test(normalizedQuestion)) {
    return `这一页的句子是：${pageText} 我先带你读一遍：${pageText}`;
  }
  if (pageText && /三个问题|提问|问我/.test(normalizedQuestion)) {
    return `可以，我根据这一页问你三个问题：1. 这一页主要讲了什么？2. 你能找出一个关键词吗？3. 你能用自己的话复述这页内容吗？`;
  }
  if (pageText && /难点|不会|不懂/.test(normalizedQuestion)) {
    return `这一页的难点是先看懂核心信息：${pageText}。我们可以先拆成两步：第一，找关键词；第二，用一句话说出它在讲什么。`;
  }
  if (pageText && /单词|英文|词汇|意思/.test(normalizedQuestion)) {
    return `这一页可以先关注这些内容里的关键词：${pageText}。你把不会的英文词发给我，我会告诉你意思、读音和一个简单例句。`;
  }
  if (pageText && /讲|解释|老师|总结|重点|主要/.test(normalizedQuestion)) {
    return `我像老师一样讲这一页：这页的核心内容是“${pageText}”。你先不用背下来，先理解它在讲什么；然后试着用自己的话说一句。`;
  }
  if (pageText) {
    return `我根据当前页回答：${pageText}。你可以继续问我这页的重点、难点，或者让我给你出几个问题。`;
  }
  if (normalizedQuestion.includes("单词")) {
    return "我现在还没有读到图片下面的正文和单词。你可以把不会的单词打出来，我会马上讲意思、读音和用法。";
  }
  if (normalizedQuestion.includes("重点")) {
    return "我现在还没有读到图片下面的正文。你可以把这页文字发给我，我会马上帮你总结重点。";
  }
  if (/正文|原文|图片下面|下面的文字|读一下|朗读|读一读|老师|讲|解释|总结|难点|这一页/.test(normalizedQuestion)) {
    return "我现在还没有读到图片下面的正文。你可以把这页文字发给我，我会马上像老师一样讲给你听。";
  }
  return "我现在还没有读到这页的文字。你可以把想问的文字发给我，我会马上帮你讲。";
};

const fetchCoachJson = async (
  url: string,
  body: Record<string, unknown>,
  timeoutMs: number
) => {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => ({}))) as {
      reply?: string;
      asrText?: string;
      audioDataUrl?: string;
      error?: string;
      doubaoError?: string;
      fallbackError?: string;
      visionError?: string;
    };
    if (!response.ok) {
      throw new Error(
        payload.error ||
          payload.visionError ||
          payload.fallbackError ||
          payload.doubaoError ||
          "AI老师暂时没有回应"
      );
    }
    return payload;
  } finally {
    window.clearTimeout(timeout);
  }
};

const analyzeAgentMaterialPages = async (sourceName: string, pages: AgentMaterialPage[]) => {
  const analyzablePages = pages.filter((page) => page.kind !== "word");
  if (!analyzablePages.length) return { pages, warnings: [] as string[] };

  const images = await Promise.all(
    pages.map((page) => (page.kind === "word" ? Promise.resolve("") : createAgentAnalysisImage(page)))
  );
  const validImages = images.filter(Boolean);
  if (!validImages.length) return { pages, warnings: [] as string[] };

  const response = await fetch("/api/storyflow/analyze", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sourceName,
      images,
      providedShadowPageTexts: pages.map((page) => getMaterialPageText(page)),
    }),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    shadowPageTexts?: unknown;
    pages?: Array<{ visibleText?: unknown; storyBeat?: unknown }>;
    analysisWarnings?: unknown;
    error?: string;
  };

  if (!response.ok) {
    throw new Error(payload.error || "资料分析失败");
  }
  const warnings = Array.isArray(payload.analysisWarnings)
    ? payload.analysisWarnings.filter(
        (item): item is string => typeof item === "string" && item.trim().length > 0
      )
    : [];

  const shadowTexts = Array.isArray(payload.shadowPageTexts)
    ? payload.shadowPageTexts.map((item) => (typeof item === "string" ? item : ""))
    : [];
  const pageTexts = Array.isArray(payload.pages)
    ? payload.pages.map((item) => {
        if (typeof item?.visibleText === "string") return item.visibleText;
        if (typeof item?.storyBeat === "string") return item.storyBeat;
        return "";
      })
    : [];

  const nextPages = pages.map((page, index) => {
    const rawAnalyzedText = shadowTexts[index] || pageTexts[index] || "";
    const analyzedText = isFileReferenceText(rawAnalyzedText, page.fileName)
      ? ""
      : getUsefulPageText(rawAnalyzedText);
    const existingText = getMaterialPageText(page);
		    return {
		      ...page,
		      text: existingText || analyzedText || "",
		    };
	  });
  return { pages: nextPages, warnings };
	};

const ocrAgentMaterialPages = async (pages: AgentMaterialPage[]) => {
  const missingPages = pages
    .map((page, index) => ({ page, index }))
    .filter((item) => item.page.kind !== "word" && !getMaterialPageText(item.page));

  if (!missingPages.length) return pages;

  const ocrEntries = (
    await Promise.all(
      missingPages.map(async ({ page, index }) => {
        const parts = await createAgentOcrImageParts(page);
        if (parts.length) {
          return parts.map((part) => ({
            page,
            pageIndex: index,
            part,
            image: part.image,
          }));
        }
        const focused = await createAgentTextFocusImage(page);
        const image = focused || (await createAgentAnalysisImage(page));
        return image
          ? [
              {
                page,
                pageIndex: index,
                part: { label: "page", image } satisfies AgentOcrImagePart,
                image,
              },
            ]
          : [];
      })
    )
  ).flat();

  if (!ocrEntries.some((entry) => entry.image)) return pages;

  const response = await fetch("/api/storyflow/ocr", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ images: ocrEntries.map((entry) => entry.image) }),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    texts?: unknown;
    error?: string;
  };

  if (!response.ok) {
    throw new Error(payload.error || "OCR 识别失败");
  }

  const texts = Array.isArray(payload.texts)
    ? payload.texts.map((item) => (typeof item === "string" ? item : ""))
    : [];

  const nextPages = [...pages];
  const grouped = new Map<
    number,
    Array<{
      page: AgentMaterialPage;
      part: AgentOcrImagePart;
      text: string;
    }>
  >();
  ocrEntries.forEach((entry, resultIndex) => {
    const text = normalizeText(texts[resultIndex] || "", 1600);
    if (!getUsefulPageText(text) || isFileReferenceText(text, entry.page.fileName)) return;
    const current = grouped.get(entry.pageIndex) || [];
    current.push({
      page: entry.page,
      part: entry.part,
      text,
    });
    grouped.set(entry.pageIndex, current);
  });

  grouped.forEach((entries, pageIndex) => {
    const page = pages[pageIndex];
    const splitEntries = entries.filter((entry) => entry.part.label === "left" || entry.part.label === "right");
    if (splitEntries.length >= 2) {
      const segments = splitEntries
        .sort((left, right) => {
          if (left.part.label === right.part.label) return 0;
          return left.part.label === "left" ? -1 : 1;
        })
        .map((entry) => ({
          label: getOcrPartSegmentLabel(page, entry.part),
          text: entry.text,
        }));
      nextPages[pageIndex] = {
        ...page,
        text: formatOriginalPageSegmentsForReading(segments),
        originalPageSegments: page.originalPageSegments?.length ? page.originalPageSegments : segments,
      };
      return;
    }

    const text = normalizeText(entries.map((entry) => entry.text).join(" "), 1600);
    if (getUsefulPageText(text)) {
      nextPages[pageIndex] = {
        ...page,
        text,
      };
    }
  });

  return nextPages;
};

const buildPageSuggestions = (_page?: AgentMaterialPage) => [
  "这个词怎么用？",
  "这句话为什么这样说？",
  "还能举个例子吗？",
];

export default function AgentStudyClient() {
  const session = useSessionProfile();
  const [view, setView] = useState<"study" | "history">("study");
  const [records, setRecords] = useState<AgentStudyRecord[]>([]);
  const [activeRecordId, setActiveRecordId] = useState<string | null>(null);
  const [pages, setPages] = useState<AgentMaterialPage[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [messages, setMessages] = useState<AgentMessage[]>([
    {
      id: "welcome",
      role: "coach",
      text: "上传 PDF、Word 或图片资料后，我会先分析内容，再陪你一页一页学。哪里不会，就问哪里。",
    },
  ]);
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [isVoiceSessionActive, setIsVoiceSessionActive] = useState(false);
  const [isVoiceListening, setIsVoiceListening] = useState(false);
  const [, setVoiceStatus] = useState("");
  const [error, setError] = useState("");
  const [lessonStep, setLessonStep] = useState<AgentLessonStep>("intro");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const agentCaptureRef = useRef<HTMLDivElement | null>(null);
  const conversationScrollRef = useRef<HTMLDivElement | null>(null);
  const voiceSessionActiveRef = useRef(false);
  const voiceManualStopRef = useRef(false);
  const voiceRequestInFlightRef = useRef(false);
  const voiceStreamWsRef = useRef<WebSocket | null>(null);
  const voiceStreamReadyRef = useRef(false);
  const voiceStreamCaptureContextRef = useRef<AudioContext | null>(null);
  const voiceStreamSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const voiceStreamProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const voiceStreamSpeechActiveRef = useRef(false);
  const voiceStreamSpeechEndedRef = useRef(true);
  const voiceStreamLastVoiceMsRef = useRef(0);
  const voiceStreamAwaitingReplyRef = useRef(false);
  const voiceStreamTurnTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceStreamPlaybackReleaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceStreamPcmRemainderRef = useRef<Uint8Array>(new Uint8Array());
  const voiceStreamReplyRef = useRef("");
  const voiceStreamAsrRef = useRef("");
  const voicePcmAudioContextRef = useRef<AudioContext | null>(null);
  const voicePcmNextPlayTimeRef = useRef(0);
  const voicePcmSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const voicePcmPlaybackChainRef = useRef<Promise<void>>(Promise.resolve());
  const voicePcmPlaybackTokenRef = useRef(0);
  const voiceLatestRequestPayloadRef = useRef<Record<string, unknown> | null>(null);
  const voiceStreamRef = useRef<MediaStream | null>(null);
  const voiceAudioRef = useRef<HTMLAudioElement | null>(null);
  const rtcEngineRef = useRef<AgentRtcEngine | null>(null);
  const rtcAgentSessionRef = useRef<RtcAgentSession | null>(null);
  const rtcAgentStartedRef = useRef(false);
  const rtcAudioMediaTypeRef = useRef<number>(1);
  const rtcVisualCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rtcVisualStreamRef = useRef<MediaStream | null>(null);
  const rtcAgentEverStartedRef = useRef(false);
  const rtcTranscriptIdsRef = useRef<Set<string>>(new Set());
  const rtcLiveTranscriptIdsRef = useRef<Record<string, string>>({});
  const rtcRecentTranscriptRef = useRef<Record<string, { id: string; text: string; at: number }>>({});
  const rtcCoachResponseSerialRef = useRef(0);
  const agentStudyStateRef = useRef<{
    pages: AgentMaterialPage[];
    pageIndex: number;
    messages: AgentMessage[];
    lessonStep: AgentLessonStep;
  }>({
    pages: [],
    pageIndex: 0,
    messages: [],
    lessonStep: "intro",
  });

  const activePage = pages[pageIndex];
  const suggestions = useMemo(() => buildPageSuggestions(activePage), [activePage]);
  const latestStudentText =
    [...messages].reverse().find((message) => message.role === "student")?.text || "";
  const latestCoachText =
    [...messages].reverse().find((message) => message.role === "coach")?.text ||
    "我在看当前页，你可以问我任何不懂的地方。";
  const subtitleMessages = messages.filter(isVoiceSubtitleMessage);
  const latestRecord = records[0];

  const buildLessonState = (
    step = agentStudyStateRef.current.lessonStep || lessonStep
  ): AgentLessonState => {
    const state = agentStudyStateRef.current;
    const safePageIndex = Math.max(0, Math.min(state.pageIndex, state.pages.length - 1));
    return {
      step,
      round: step.startsWith("round2") || step === "summary" ? 2 : 1,
      pageIndex: safePageIndex,
      pageCount: state.pages.length,
      pageLabel: getAgentPageLabel(state.pages[safePageIndex], safePageIndex, state.pages),
    };
  };

  const buildRtcAgentResumeWelcomeMessage = () => {
    const state = agentStudyStateRef.current;
    const currentLessonState = buildLessonState();
    const hasExistingProgress =
      rtcAgentEverStartedRef.current ||
      currentLessonState.step !== "intro" ||
      currentLessonState.pageIndex > 0 ||
      state.messages.some((message) => isVoiceSubtitleMessage(message));

    if (!hasExistingProgress) return undefined;

    return "我们继续刚才的学习。";
  };

  const buildRtcAgentSessionLessonStatePrompt = () => {
    const state = agentStudyStateRef.current;
    const safePageIndex = Math.max(0, Math.min(state.pageIndex, state.pages.length - 1));
    const page = state.pages[safePageIndex];
    const structuredPageText = page?.originalPageSegments?.length
      ? formatOriginalPageSegments(page.originalPageSegments)
      : "";
    const pageText = page ? getMaterialPageText(page, 900) : "";

    return [
      formatAgentLessonStatePrompt(buildLessonState()),
      "【当前页可信原文】",
      structuredPageText
        ? `当前页分栏原文（RTC启动或恢复时必须以此为唯一原文依据）：${structuredPageText}`
        : pageText
          ? `当前页后台原文（RTC启动或恢复时必须以此为唯一原文依据）：${pageText}`
          : "当前页后台原文为空；只能描述屏幕清晰可见内容，看不清就说看不清。",
      "所有英文原文、剧情、人物动作和页码推进，只能来自当前屏幕清晰可见内容和上方当前页可信原文；禁止使用绘本记忆、书名常识、角色资料、旧对话或旧页面补充。",
      "如果学生指出你讲错了或说你编造了，先承认并纠正：刚才那句在当前页没有看到；然后回到当前页可信原文继续。",
    ].join("\n");
  };

  const updateLessonStep = (step: AgentLessonStep) => {
    setLessonStep(step);
    agentStudyStateRef.current = {
      ...agentStudyStateRef.current,
      lessonStep: step,
    };
  };

  const advanceLessonStepFromSubtitle = (role: AgentMessage["role"], text: string) => {
    const current = agentStudyStateRef.current.lessonStep;
    if (!text.trim()) return;
    if (role === "student") {
      if (current === "round1_picture") updateLessonStep("round1_read");
      else if (current === "round2_student_read") updateLessonStep("round2_feedback");
      else if (current === "round2_question") updateLessonStep("round2_student_read");
      return;
    }
    if (role === "coach") {
      if (current === "intro") updateLessonStep("round1_picture");
      else if (current === "round1_read") updateLessonStep("round1_explain");
      else if (current === "round1_explain") updateLessonStep("round1_next_page");
      else if (current === "round2_feedback") updateLessonStep("round2_question");
    }
  };

  useEffect(() => {
    const node = conversationScrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [subtitleMessages.length, latestCoachText, latestStudentText]);

  const captureAgentScreen = async () => {
    if (!agentCaptureRef.current) return "";
    try {
      const html2canvas = (await import("html2canvas")).default;
      const canvas = await html2canvas(agentCaptureRef.current, {
        backgroundColor: "#f6fbff",
        logging: false,
        scale: Math.min(1.35, Math.max(1, window.devicePixelRatio || 1)),
        useCORS: true,
      });
      let dataUrl = canvas.toDataURL("image/jpeg", 0.78);
      if (dataUrl.length > 3_200_000) {
        dataUrl = canvas.toDataURL("image/jpeg", 0.58);
      }
      canvas.width = 0;
      canvas.height = 0;
      return dataUrl.length <= 3_600_000 ? dataUrl : "";
    } catch {
      return "";
    }
  };

  const stopRtcVisualTrack = () => {
    rtcVisualStreamRef.current?.getTracks().forEach((track) => track.stop());
    rtcVisualStreamRef.current = null;
    const canvas = rtcVisualCanvasRef.current;
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
    rtcVisualCanvasRef.current = null;
  };

  const safeDestroyRtcEngine = async (engine?: AgentRtcEngine | null) => {
    if (!engine) return;
    try {
      await Promise.resolve(engine.stopSubtitle?.());
    } catch {
      // ignore RTC SDK cleanup errors
    }
    try {
      await Promise.resolve(engine.destroy?.());
    } catch {
      // ignore RTC SDK disconnect errors during teardown
    }
  };

  const drawRtcVisualFrame = async (canvas: HTMLCanvasElement) => {
    const state = agentStudyStateRef.current;
    const page = state.pages[state.pageIndex];
    if (!page) return false;

    const imageDataUrl = await createAgentAnalysisImage(page);
    const source = imageDataUrl || page.previewUrl;
    if (!source.startsWith("data:image/")) return false;

    const image = await loadImageElement(source);
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

  const startRtcVisualTrack = async (
    engine: AgentRtcEngine,
    streamIndex: { STREAM_INDEX_MAIN: number },
    videoSourceType: { VIDEO_SOURCE_TYPE_EXTERNAL: number }
  ) => {
    if (!engine.setVideoSourceType || !engine.setExternalVideoTrack) return false;
    stopRtcVisualTrack();

    const canvas = document.createElement("canvas");
    rtcVisualCanvasRef.current = canvas;
    const hasFrame = await drawRtcVisualFrame(canvas);
    if (!hasFrame) {
      stopRtcVisualTrack();
      return false;
    }

    const stream = canvas.captureStream(2);
    const track = stream.getVideoTracks()[0];
    if (!track) {
      stopRtcVisualTrack();
      return false;
    }

    rtcVisualStreamRef.current = stream;
    await engine.setVideoSourceType(
      streamIndex.STREAM_INDEX_MAIN,
      videoSourceType.VIDEO_SOURCE_TYPE_EXTERNAL
    );
    await engine.setExternalVideoTrack(streamIndex.STREAM_INDEX_MAIN, track);
    return true;
  };

  const upsertRtcTranscriptMessage = ({
    id,
    role,
    text,
    definite,
  }: {
    id: string;
    role: AgentMessage["role"];
    text: string;
    definite?: boolean;
  }) => {
    const normalized = normalizeText(text, 1200);
    if (!normalized) return;

    setMessages((current) => {
      const existingIndex = current.findIndex((message) => message.id === id);
      const nextMessages =
        existingIndex >= 0
          ? current.map((message, index) =>
              index === existingIndex && normalized.length >= message.text.length
                ? { ...message, text: normalized }
                : message
            )
          : [
              ...current,
              {
                id,
                role,
                text: normalized,
              },
            ];

      if (definite || existingIndex < 0) {
        rtcTranscriptIdsRef.current.add(id);
      }
      agentStudyStateRef.current = {
        ...agentStudyStateRef.current,
        messages: nextMessages,
      };
      return nextMessages;
    });
  };

  const getStableRtcTranscriptId = ({
    source,
    role,
    text,
    sequence,
    definite,
  }: {
    source: string;
    role: AgentMessage["role"];
    text: string;
    sequence: string | number;
    definite?: boolean;
  }) => {
    const normalized = normalizeText(text, 1200);
    const streamKey = `${source}_${role}`;
    const activeId = rtcLiveTranscriptIdsRef.current[streamKey];
    const recent = rtcRecentTranscriptRef.current[streamKey];
    const now = Date.now();
    const isSameGrowingUtterance =
      recent &&
      now - recent.at < 8000 &&
      (normalized === recent.text ||
        normalized.startsWith(recent.text) ||
        recent.text.startsWith(normalized));

    if (activeId) {
      if (definite) {
        delete rtcLiveTranscriptIdsRef.current[streamKey];
        rtcRecentTranscriptRef.current[streamKey] = {
          id: activeId,
          text: normalized,
          at: now,
        };
      }
      return activeId;
    }

    if (isSameGrowingUtterance) {
      rtcRecentTranscriptRef.current[streamKey] = {
        id: recent.id,
        text: normalized.length >= recent.text.length ? normalized : recent.text,
        at: now,
      };
      return recent.id;
    }

    const id = `rtc_subtitle_${streamKey}_${now}_${String(sequence)}`;
    if (definite) {
      rtcRecentTranscriptRef.current[streamKey] = { id, text: normalized, at: now };
    } else {
      rtcLiveTranscriptIdsRef.current[streamKey] = id;
    }
    return id;
  };

  const extractRtcMessageText = (value: unknown): string => {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return "";
      try {
        return extractRtcMessageText(JSON.parse(trimmed));
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
      "llmText",
      "llm_text",
      "subtitle",
    ]) {
      const candidate = record[key];
      if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    }
    for (const key of ["data", "payload", "result"]) {
      const nested = extractRtcMessageText(record[key]);
      if (nested) return nested;
    }
    return "";
  };

  const normalizeRtcSubtitleItems = (values: unknown[]): Array<Record<string, unknown>> => {
    const stack = [...values];
    const items: Array<Record<string, unknown>> = [];
    while (stack.length) {
      const value = stack.shift();
      if (!value) continue;
      if (Array.isArray(value)) {
        stack.push(...value);
        continue;
      }
      if (typeof value !== "object") continue;
      const record = value as Record<string, unknown>;
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
        stack.push(...nested);
        continue;
      }
      items.push(record);
    }
    return items;
  };

  const parseJsonValue = (value: unknown): unknown => {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    if (!trimmed) return "";

    const jsonEnd = trimmed.lastIndexOf("}");
    const candidateStarts = [
      trimmed.indexOf('{"data"'),
      trimmed.indexOf('{ "data"'),
      trimmed.indexOf('{"type"'),
      trimmed.indexOf('{ "type"'),
      trimmed.indexOf("{"),
    ].filter((index) => index >= 0);
    for (const jsonStart of candidateStarts) {
      if (jsonEnd <= jsonStart) continue;
      const jsonPayload = trimmed.slice(jsonStart, jsonEnd + 1);
      try {
        return JSON.parse(jsonPayload);
      } catch {
        // Try the next possible JSON start. RTC subtitle packets can contain a protocol prefix.
      }
    }
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  };

  const decodeRtcBinaryMessage = (value: unknown): unknown => {
    if (value instanceof ArrayBuffer) {
      return new TextDecoder("utf-8").decode(value);
    }
    if (ArrayBuffer.isView(value)) {
      return new TextDecoder("utf-8").decode(value);
    }
    return value;
  };

  const inferVoiceSubtitleRole = (
    record: Record<string, unknown>,
    sessionPayload: RtcAgentSession,
    fallbackRole: AgentMessage["role"]
  ): AgentMessage["role"] => {
    const userId =
      typeof record.userId === "string"
        ? record.userId
        : typeof record.uid === "string"
          ? record.uid
          : typeof record.user_id === "string"
            ? record.user_id
            : typeof record.UserId === "string"
              ? record.UserId
              : "";
    if (userId === sessionPayload.userId) return "student";
    if (userId === sessionPayload.agentUserId) return "coach";

    const roleText = String(
      record.role ||
        record.speaker ||
        record.userType ||
        record.user_type ||
        record.type ||
        record.event ||
        ""
    ).toLowerCase();
    if (/(student|human|user|asr|input|question)/.test(roleText)) return "student";
    if (/(agent|assistant|bot|coach|llm|tts|answer|response)/.test(roleText)) return "coach";
    return fallbackRole;
  };

  const isInternalRtcControlText = (text: string) =>
    (text.includes("学生已经翻到") &&
      text.includes("请按照当前学习流程自动继续这一页")) ||
    (text.includes("学生点击了问题：") && text.includes("请直接回答学生这个问题"));

  const collectRtsSubtitleItems = (
    value: unknown,
    sessionPayload: RtcAgentSession,
    fallbackRole: AgentMessage["role"],
    depth = 0
  ): Array<{ role: AgentMessage["role"]; text: string; sequence: string; definite: boolean }> => {
    if (depth > 6) return [];
    const parsed = parseJsonValue(value);
    if (!parsed) return [];

    if (Array.isArray(parsed)) {
      return parsed.flatMap((item) =>
        collectRtsSubtitleItems(item, sessionPayload, fallbackRole, depth + 1)
      );
    }

    if (typeof parsed === "string") {
      if (/\bsubv\b|"\s*type\s*"\s*:\s*"\s*subtitle\s*"|"\s*data\s*"\s*:/.test(parsed)) {
        return [];
      }
      const text = normalizeText(parsed, 1200);
      if (isInternalRtcControlText(text)) return [];
      return text
        ? [{ role: fallbackRole, text, sequence: `${Date.now()}_${depth}`, definite: false }]
        : [];
    }

    if (typeof parsed !== "object") return [];
    const record = parsed as Record<string, unknown>;
    const recordType = String(record.type || record.event || "").toLowerCase();
    const keys = Object.keys(record);
    const hasVoiceKey = keys.some((key) =>
      /(subtitle|caption|asr|transcript|sentence|utterance|speech|llm|tts|delta|content|message|text)/i.test(
        key
      )
    );
    const text = extractRtcMessageText(record);
    const items: Array<{
      role: AgentMessage["role"];
      text: string;
      sequence: string;
      definite: boolean;
    }> = [];

    if (recordType === "subtitle" && Array.isArray(record.data)) {
      const latestByStream = new Map<
        string,
        {
          role: AgentMessage["role"];
          text: string;
          sequence: string;
          definite: boolean;
          sequenceNumber: number;
        }
      >();
      record.data.forEach((item, index) => {
        if (!item || typeof item !== "object") return;
        const subtitle = item as Record<string, unknown>;
        const subtitleText = extractRtcMessageText(subtitle);
        if (!subtitleText) return;
        if (isInternalRtcControlText(subtitleText)) return;
        const sequenceValue =
          subtitle.sequence ??
          subtitle.seq ??
          subtitle.index ??
          subtitle.messageId ??
          subtitle.message_id ??
          index;
        const roundValue = subtitle.roundId ?? subtitle.round_id ?? "round";
        const modeValue = subtitle.mode ?? "mode";
        const subtitleUserId =
          typeof subtitle.userId === "string"
            ? subtitle.userId
            : typeof subtitle.uid === "string"
              ? subtitle.uid
              : typeof subtitle.user_id === "string"
                ? subtitle.user_id
              : typeof subtitle.UserId === "string"
                  ? subtitle.UserId
                  : "";
        const role = inferVoiceSubtitleRole(
          {
            ...subtitle,
            type: recordType,
          },
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
        const sequenceText = `${subtitleUserId || "unknown"}_${roundValue}_${modeValue}_${sequenceValue}`;
        const sequenceNumber =
          typeof sequenceValue === "number"
            ? sequenceValue
            : Number.parseInt(String(sequenceValue), 10);
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
      if (isInternalRtcControlText(text)) return items;
      const sequenceValue =
        record.sequence ?? record.seq ?? record.index ?? record.messageId ?? record.message_id;
      const userId =
        typeof record.userId === "string"
          ? record.userId
          : typeof record.uid === "string"
            ? record.uid
            : typeof record.user_id === "string"
              ? record.user_id
              : "unknown";
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
        role: inferVoiceSubtitleRole(record, sessionPayload, fallbackRole),
        text,
        sequence: `${userId}_${roundValue}_${modeValue}_${String(
          sequenceValue ?? `${Date.now()}_${items.length}`
        )}`,
        definite,
      });
    }

    for (const key of ["data", "payload", "result", "message", "content", "subtitles", "messages"]) {
      if (record[key] && typeof record[key] !== "string") {
        items.push(
          ...collectRtsSubtitleItems(record[key], sessionPayload, fallbackRole, depth + 1)
        );
      }
    }

    return items;
  };

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(agentRecordsStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as AgentStudyRecord[];
      if (Array.isArray(parsed)) {
        setRecords(
          parsed
            .filter((item) => item && typeof item.id === "string")
            .sort((left, right) => right.updatedAt - left.updatedAt)
        );
      }
    } catch {
      setRecords([]);
    }
  }, []);

  useEffect(
    () => () => {
      voiceSessionActiveRef.current = false;
      voiceManualStopRef.current = true;
      if (voiceStreamTurnTimeoutRef.current) {
        clearTimeout(voiceStreamTurnTimeoutRef.current);
      }
      if (voiceStreamPlaybackReleaseTimerRef.current) {
        clearTimeout(voiceStreamPlaybackReleaseTimerRef.current);
      }
      if (voiceStreamWsRef.current) {
        voiceStreamWsRef.current.close();
      }
      if (voiceStreamProcessorRef.current) {
        voiceStreamProcessorRef.current.disconnect();
      }
      voiceStreamSourceRef.current?.disconnect();
      if (voiceStreamCaptureContextRef.current) {
        void voiceStreamCaptureContextRef.current.close().catch(() => undefined);
      }
      voicePcmSourcesRef.current.forEach((source) => {
        try {
          source.stop();
        } catch {
          // ignore already-stopped streaming audio nodes
        }
      });
      if (voicePcmAudioContextRef.current) {
        void voicePcmAudioContextRef.current.close().catch(() => undefined);
      }
      voiceStreamRef.current?.getTracks().forEach((track) => track.stop());
      if (voiceAudioRef.current) {
        voiceAudioRef.current.pause();
      }
      const rtcSession = rtcAgentSessionRef.current;
      const rtcEngine = rtcEngineRef.current;
      rtcAgentSessionRef.current = null;
      rtcAgentStartedRef.current = false;
      rtcEngineRef.current = null;
      stopRtcVisualTrack();
      if (rtcSession) {
        void fetch("/api/agent-rtc/stop", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            appId: rtcSession.appId,
            roomId: rtcSession.roomId,
            taskId: rtcSession.taskId,
          }),
        }).catch(() => undefined);
      }
      void rtcEngine?.unpublishStream?.(3).catch(() => undefined);
      void rtcEngine?.stopAudioCapture?.().catch(() => undefined);
      void rtcEngine?.leaveRoom?.().catch(() => undefined);
      void safeDestroyRtcEngine(rtcEngine);
    },
    []
  );

  useEffect(() => {
    agentStudyStateRef.current = {
      pages,
      pageIndex,
      messages,
      lessonStep,
    };
  }, [lessonStep, messages, pageIndex, pages]);

  const persistRecords = (nextRecords: AgentStudyRecord[]) => {
    const sorted = nextRecords
      .slice()
      .sort((left, right) => right.updatedAt - left.updatedAt);
    setRecords(sorted);
    try {
      window.localStorage.setItem(agentRecordsStorageKey, JSON.stringify(sorted));
    } catch {
      setError("浏览器本地空间不足，资料没有保存成功。");
    }
  };

  const matchStoryflowLibraryTexts = async (
    sourceName: string,
    currentPages: AgentMaterialPage[]
  ) => {
    if (!session?.username) return null;

    try {
      const assignments = await hydrateStudentStoryflowAssignments(session.username);
      const teacherUsernames = Array.from(
        new Set(
          [
            session.teacherUsername || "",
            ...assignments.map((assignment) => assignment.teacherUsername),
          ]
            .map((item) => item.trim())
            .filter(Boolean)
        )
      );

      if (!teacherUsernames.length) return null;

      await hydrateAccessibleStoryflowDocumentsForTeachers(teacherUsernames);
      const documents = teacherUsernames.flatMap((teacherUsername) =>
        getTeacherStoryflowDocuments(teacherUsername)
      );
      const candidates = documents
        .filter((document) =>
          hasStoryflowDocumentTextEvidence(document, sourceName, currentPages)
        )
        .map((document) => ({
          document,
          score: scoreStoryflowDocumentMatch(document, currentPages, sourceName),
        }))
        .sort((left, right) => right.score - left.score);
      const best = candidates[0];

      if (!best || best.score < 35) return null;

      const applied = applyStoryflowDocumentTexts(currentPages, best.document);
      if (!applied.matchedCount) return null;

      return {
        ...applied,
        document: best.document,
        score: best.score,
      };
    } catch (matchError) {
      console.warn("Agent storyflow text matching failed:", matchError);
      return null;
    }
  };

  const saveCurrentRecord = () => {
    if (!pages.length) {
      setError("请先上传资料，再保存。");
      return;
    }

    const now = Date.now();
    const existingId = activeRecordId || `agent_record_${now}`;
    const title = pages[0]?.fileName || "未命名学习资料";
    const record: AgentStudyRecord = {
      id: existingId,
      title,
      fileType: pages[0]?.kind || "image",
      createdAt:
        records.find((item) => item.id === existingId)?.createdAt || now,
      updatedAt: now,
      currentPageIndex: pageIndex,
      pages,
      messages,
    };

    persistRecords([
      record,
      ...records.filter((item) => item.id !== existingId),
    ]);
    setActiveRecordId(existingId);
    setError("已保存资料，下次可以从历史记录继续学习。");
  };

  const openRecord = (record: AgentStudyRecord) => {
    const safePageIndex = Math.min(record.currentPageIndex, Math.max(0, record.pages.length - 1));
    const recordMessages = record.messages.length ? record.messages : [
      {
        id: `record_${Date.now()}`,
        role: "coach" as const,
        text: "我已经打开这份历史资料，我们可以继续学习。",
      },
    ];
    setActiveRecordId(record.id);
    setPages(record.pages);
    setPageIndex(safePageIndex);
    setMessages(recordMessages);
    agentStudyStateRef.current = {
      pages: record.pages,
      pageIndex: safePageIndex,
      messages: recordMessages,
      lessonStep: "intro",
    };
    setLessonStep("intro");
    setError("");
    setView("study");
  };

  const deleteRecord = (recordId: string) => {
    persistRecords(records.filter((item) => item.id !== recordId));
    if (activeRecordId === recordId) {
      setActiveRecordId(null);
    }
  };

  const handleFiles = async (fileList: FileList | null) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;

    setIsProcessingFile(true);
    setError("");

    try {
      let nextPages: AgentMaterialPage[] = [];

      for (const file of files) {
        if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
          nextPages.push(...(await createPdfPages(file)));
          continue;
        }

        if (file.type.startsWith("image/")) {
          const previewUrl = await readFileAsDataUrl(file);
          const imageMetadata = await readImageMetadata(previewUrl);
          nextPages.push({
            id: `${file.name}_${file.lastModified}`,
            title: file.name,
            fileName: file.name,
            kind: "image",
            previewUrl,
            text: "",
            imageWidth: imageMetadata.width,
            imageHeight: imageMetadata.height,
          });
          continue;
        }

        if (/\.(docx?|DOCX?)$/.test(file.name)) {
          const text = normalizeText(await extractDocxText(file), 2000);
          nextPages.push({
            id: `${file.name}_${file.lastModified}`,
            title: file.name,
            fileName: file.name,
            kind: "word",
            previewUrl: "",
            text,
          });
        }
      }

      if (!nextPages.length) {
        setError("请上传 PDF、Word、JPG 或 PNG 文件。");
        return;
      }

      const sourceName = nextPages[0]?.fileName || "Agent自学资料";
      setPages(nextPages);
      setPageIndex(0);
      setActiveRecordId(null);
      const initialMessages: AgentMessage[] = [
        {
          id: `analysis_${Date.now()}`,
          role: "coach",
          text: buildInitialAnalysis(nextPages),
        },
      ];
      setMessages(initialMessages);
      agentStudyStateRef.current = {
        pages: nextPages,
        pageIndex: 0,
        messages: initialMessages,
        lessonStep: "intro",
      };
      setLessonStep("intro");

      void (async () => {
        setIsThinking(true);
        let enrichedPages = nextPages;
        let matchedMessage = "";
        const analysisMessages: string[] = [];

        try {
          const matchedStoryflow = await matchStoryflowLibraryTexts(sourceName, enrichedPages);
          if (matchedStoryflow) {
            enrichedPages = matchedStoryflow.pages;
            matchedMessage = `我已经匹配到老师任务库里的《${matchedStoryflow.document.analysis.title || matchedStoryflow.document.sourceName}》，会按已经分析好的每页原文陪你学习。`;
          } else {
            try {
              enrichedPages = await ocrAgentMaterialPages(enrichedPages);
            } catch (ocrError) {
              console.warn("Agent OCR failed:", ocrError);
              analysisMessages.push(
                ocrError instanceof Error ? `OCR失败：${ocrError.message}` : "OCR失败"
              );
            }
            try {
              const analyzed = await analyzeAgentMaterialPages(sourceName, enrichedPages);
              enrichedPages = analyzed.pages;
              analysisMessages.push(...analyzed.warnings);
            } catch (analysisError) {
              console.warn("Agent material analysis failed:", analysisError);
              analysisMessages.push(
                analysisError instanceof Error
                  ? `视觉分析失败：${analysisError.message}`
                  : "视觉分析失败"
              );
            }
          }

          setPages(enrichedPages);
          agentStudyStateRef.current = {
            ...agentStudyStateRef.current,
            pages: enrichedPages,
          };
          setMessages((current) => {
            const nextMessages = [
              ...current,
              ...(matchedMessage
                ? [
                    {
                      id: `matched_${Date.now()}`,
                      role: "coach" as const,
                      text: matchedMessage,
                    },
                  ]
                : []),
              {
                id: `coach_initial_${Date.now()}`,
                role: "coach" as const,
                text: buildAgentTeacherStart(enrichedPages),
              },
            ];
            agentStudyStateRef.current = {
              ...agentStudyStateRef.current,
              pages: enrichedPages,
              messages: nextMessages,
              lessonStep,
            };
            return nextMessages;
          });
          if (analysisMessages.length) {
            setError(analysisMessages.join("；"));
          }
        } catch {
          // Keep the local first-look analysis when background enrichment is unavailable.
        } finally {
          setIsThinking(false);
        }
      })();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "资料处理失败，请换一个文件试试。");
    } finally {
      setIsProcessingFile(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const buildAgentCoachRequestPayload = (
    message: string,
    screenshotDataUrl = "",
    audioPcmBase64 = "",
    visualContext: {
      textFocusImageDataUrl?: string;
      pageTextOverride?: string;
      screenShareSource?: string;
      visualDescription?: string;
      visualOnly?: boolean;
    } = {}
  ) => {
    const latestStudyState = agentStudyStateRef.current;
    const latestPages = latestStudyState.pages;
    const latestPageIndex = Math.max(
      0,
      Math.min(latestStudyState.pageIndex, latestPages.length - 1)
    );
    const page = latestPages[latestPageIndex];
    const usefulPageText = visualContext.visualOnly
      ? ""
      : visualContext.pageTextOverride || getMaterialPageText(page, 1600);
    const pronunciationTarget = extractPronunciationTarget(latestStudyState.messages);
    const lessonState = buildLessonState(latestStudyState.lessonStep || lessonStep);

    return {
      mode: "speaking",
      message,
      studentMessage: message,
      audioPcmBase64,
      pronunciationTarget,
      bookTitle: page?.fileName || "Agent自学资料",
      pageLabel: getAgentPageLabel(page, latestPageIndex, latestPages),
      pageText: usefulPageText,
      visiblePrompt: "",
      hintStage: 0,
      screenshotDataUrl,
      textFocusImageDataUrl: visualContext.textFocusImageDataUrl || "",
      screenShare: {
        capturedAt: Date.now(),
        source:
          visualContext.screenShareSource ||
          (screenshotDataUrl ? "visible_agent_screen" : "agent_stream_context"),
        includesVisibleUi: Boolean(screenshotDataUrl),
      },
      aiTeachingContext: {
        currentPageText: usefulPageText,
        previousPageText: "",
        nextPageText: "",
        allPageTexts: [],
        currentPageSegments: visualContext.visualOnly ? [] : getMaterialPageSegments(page),
        visualDescription: visualContext.visualDescription || "",
        characterProfile: formatStoryCharacterProfileForPrompt(oxfordReadingTreeCharacterProfile),
        lessonState: formatAgentLessonStatePrompt(lessonState),
        pronunciationTarget,
        visibleToStudent: "image_only",
        instruction:
          visualContext.visualOnly
            ? "这是视觉事实问答模式。必须只根据本轮传入的当前屏幕截图和当前资料页图片回答；不要使用后台正文、旧视觉摘要、旧对话或书名常识补全画面。只能描述图片里明确可见的元素；看不清或不能确定就说看不清/不能确定。严禁编造宝箱打开、金光、宝物、人物动作等图片里没有明确出现的内容。"
            : [
                "这是学生自己上传的学习资料，不是固定绘本任务。前端已经把当前屏幕截图和当前资料页完整图片作为视觉上下文传入；必须优先按当前屏幕/当前页图片判断页码、左右页和阅读顺序。",
                "只允许使用当前上传资料页、OCR/Word/PDF解析出的当前页文本；当前页标签会使用封面、绘本页码、封底，必须优先按这个标签理解“第几页”，不要按 PDF 文件页序号理解。",
                "双页展开时，阅读顺序必须是先读完左页全部正文，再读右页全部正文，严禁按图片横向扫描把左页第一行和右页第一行拼在一起。",
                "如果当前页标签是页码范围，例如“绘本页 8-9”，必须一轮只讲一侧：先讲第8页/左页，围绕左页原文做一次学生互动；学生回应后，再继续第9页/右页。不要把左右两页放在一个长回答里讲完。",
                "若孩子要求读原文/正文/句子，必须完整朗读当前页后台原文，从第一句开始，不能只读后半句或你认为的重点句；如果有分段原文，要按分段顺序逐段朗读。",
                "原文为主，每一侧页都要有一次学生互动：可以让孩子跟读一句、找一个关键词、回答一句原文的意思，或说说图中对应动作。",
                "讲当前侧页时，必须先完整朗读当前侧页的全部原文句子，不能只挑一句；读完全部原文后，才解释一两个重点并互动。",
                "提出互动问题、要求学生朗读或提示翻页后，必须等待学生语音回复或真实翻页事件；如果没有学生语音回复，也没有翻页，就停止说话，不要继续讲后面页面。",
                "只允许讲当前可见页和当前页原文。不要提前讲未翻到页面的后续剧情，不要把上一页线索编成当前页已经发生；例如当前页没有画出或写出“踩到红油漆”时，不能说 Kipper 踩到红油漆。",
                "严禁沿用任何之前绘本或旧资料内容。不要要求学生点击提示或查看原文。",
                agentLessonFlowPrompt,
              ].join("\n"),
      },
      coachHistory: visualContext.visualOnly
        ? []
        : latestStudyState.messages.slice(-8).map((item) => ({
            role: item.role,
            text: normalizeText(item.text, 220),
          })),
      navigationContext: {
        canGoNext: latestPageIndex < latestPages.length - 1,
        nextPageLabel: getAgentPageLabel(
          latestPages[latestPageIndex + 1],
          latestPageIndex + 1,
          latestPages
        ),
        nextPageText: "",
        lastAssistantAskedNext: false,
        frontendWillAutoAdvanceOnAgreement: false,
      },
      uiControlContext: {
        practiceStatus: latestPages.length ? "active" : "waiting_upload",
        hintStage: 0,
        pendingAction: "",
        allowedAutoActions: [],
        requiresConfirmationActions: [],
      },
    };
  };

  const requestAgentVisualDescription = async (basePayload: Record<string, unknown>) => {
    const screenshot = typeof basePayload.screenshotDataUrl === "string" ? basePayload.screenshotDataUrl : "";
    const textFocusImage =
      typeof basePayload.textFocusImageDataUrl === "string" ? basePayload.textFocusImageDataUrl : "";
    if (!screenshot.startsWith("data:image/") && !textFocusImage.startsWith("data:image/")) {
      return "";
    }

    try {
      const payload = await fetchCoachJson(
        "/api/storyflow/doubao-coach",
        {
          ...basePayload,
          pageText: "",
          visiblePrompt: "",
          aiTeachingContext: {
            currentPageText: "",
            previousPageText: "",
            nextPageText: "",
            allPageTexts: [],
            currentPageSegments: [],
            visibleToStudent: "image_only",
            instruction: "这是内部视觉分析任务。必须只看截图和资料页图片，不要使用后台原文，也不要补全文字。",
            pronunciationTarget: "",
            visualDescription: "",
            characterProfile: formatStoryCharacterProfileForPrompt(oxfordReadingTreeCharacterProfile),
          },
          message:
            "【系统视觉分析任务】请只根据当前屏幕截图和当前资料页完整高清图，给实时语音老师生成一段内部视觉摘要。必须包括：1. 当前页/左右页的阅读顺序；2. 绘本画面里的人物、动作、地点和关键物品；3. 图片中能看到的英文正文或标题；双页展开时必须先完整读取左页正文，再读取右页正文，不要按整张图片从左到右横扫而把两页第一行拼接；4. 如果看不清文字，请明确说看不清，不要编造。请不要和孩子对话，只输出摘要。",
          studentMessage:
            "【系统视觉分析任务】请分析当前 Agent 页面截图和当前资料页完整图，输出给实时语音老师使用的视觉摘要。",
          coachHistory: [],
        },
        16_000
      );
      return normalizeText(payload.reply || "", 900);
    } catch {
      return "";
    }
  };

  const buildAgentCoachRequestPayloadAsync = async (
    message: string,
    options: {
      screenshotDataUrl?: string;
      audioPcmBase64?: string;
      forceExactText?: boolean;
    } = {}
  ) => {
    const latestStudyState = agentStudyStateRef.current;
    const latestPages = latestStudyState.pages;
    const latestPageIndex = Math.max(
      0,
      Math.min(latestStudyState.pageIndex, latestPages.length - 1)
    );
    const page = latestPages[latestPageIndex];
    const rawPageText = getMaterialPageText(page, 1600);
    const wantsVisualFacts = isImageDescriptionRequest(message);
    const shouldResolveExactText =
      !wantsVisualFacts && (options.forceExactText || isReadOriginalRequest(message));

    const needsImageContext = wantsVisualFacts;
    const [visibleScreenshot, pageImageDataUrl, textFocusImageDataUrl, resolvedPageText] =
      await Promise.all([
        needsImageContext
          ? Promise.resolve("")
          : typeof options.screenshotDataUrl === "string"
            ? Promise.resolve(options.screenshotDataUrl)
            : Promise.resolve(""),
        needsImageContext && page ? createAgentAnalysisImage(page) : Promise.resolve(""),
        needsImageContext && page ? createAgentTextFocusImage(page) : Promise.resolve(""),
        shouldResolveExactText
          ? resolveExactReadingText(page, rawPageText)
          : Promise.resolve(rawPageText),
      ]);

    const screenshotDataUrl = wantsVisualFacts
      ? pageImageDataUrl || textFocusImageDataUrl || visibleScreenshot || ""
      : visibleScreenshot || pageImageDataUrl || "";
    const supplementalImageDataUrl =
      textFocusImageDataUrl && textFocusImageDataUrl !== screenshotDataUrl
        ? textFocusImageDataUrl
        : wantsVisualFacts
          ? ""
          : pageImageDataUrl && pageImageDataUrl !== screenshotDataUrl
            ? pageImageDataUrl
            : "";
    const basePayload = buildAgentCoachRequestPayload(
      message,
      screenshotDataUrl,
      options.audioPcmBase64 || "",
      {
        textFocusImageDataUrl: supplementalImageDataUrl,
        pageTextOverride: resolvedPageText || rawPageText,
        visualOnly: wantsVisualFacts,
        screenShareSource: visibleScreenshot
          ? "visible_agent_screen"
          : pageImageDataUrl
            ? "current_page_image"
            : "agent_stream_context",
      }
    );
    if (wantsVisualFacts) return basePayload;
    return basePayload;
  };

  const sendRtcAgentTextQuestion = async (question: string) => {
    const session = rtcAgentSessionRef.current;
    if (!session || !rtcAgentStartedRef.current) return false;

    const latestStudyState = agentStudyStateRef.current;
    const latestPages = latestStudyState.pages;
    const latestPageIndex = Math.max(
      0,
      Math.min(latestStudyState.pageIndex, latestPages.length - 1)
    );
    const page = latestPages[latestPageIndex];
    const pageLabel = getAgentPageLabel(page, latestPageIndex, latestPages);
    const pageText = getMaterialPageText(page, 700);
    const lessonState = formatAgentLessonStatePrompt(buildLessonState());
    const message = [
      `学生点击了问题：${question}`,
      `当前页：${pageLabel}`,
      lessonState,
      pageText ? `当前页原文：${pageText}` : "",
      "请直接回答学生这个问题，回答要短一点、适合孩子听，并继续保持当前学习流程。",
    ]
      .filter(Boolean)
      .join("\n");

    try {
      voiceLatestRequestPayloadRef.current = await buildAgentCoachRequestPayloadAsync(question, {
        forceExactText: true,
      });
    } catch {
      voiceLatestRequestPayloadRef.current = buildAgentCoachRequestPayload(question);
    }

    try {
      const sent = await sendRtcAgentControlMessage(message);
      if (!sent) return false;
      setVoiceStatus("已发送给 Mia，正在等待回复...");
      return true;
    } catch {
      return false;
    }
  };

  useEffect(() => {
    voiceLatestRequestPayloadRef.current = buildAgentCoachRequestPayload("");
    let cancelled = false;
    void buildAgentCoachRequestPayloadAsync("", { forceExactText: true }).then((payload) => {
      if (!cancelled) {
        voiceLatestRequestPayloadRef.current = payload;
      }
    });
    return () => {
      cancelled = true;
    };
  }, [pages, pageIndex]);

  const askCoach = async (question: string) => {
    const safeQuestion = question.trim();
    if (!safeQuestion || isThinking) return;
    if (/先看图|看图聊/.test(safeQuestion)) updateLessonStep("round1_picture");
    else if (/老师先读|先读一遍|带读|朗读/.test(safeQuestion)) updateLessonStep("round1_read");
    else if (/我先试|我来读|我先读|试着读/.test(safeQuestion)) updateLessonStep("round2_student_read");

    const userMessage: AgentMessage = {
      id: rtcAgentStartedRef.current
        ? `rtc_subtitle_student_click_${Date.now()}`
        : `student_${Date.now()}`,
      role: "student",
      text: safeQuestion,
    };
    const latestStudyState = agentStudyStateRef.current;
    const latestPages = latestStudyState.pages;
    const latestPageIndex = Math.max(
      0,
      Math.min(latestStudyState.pageIndex, latestPages.length - 1)
    );
    const latestActivePage = latestPages[latestPageIndex];
    const nextHistory = [...latestStudyState.messages, userMessage];
    agentStudyStateRef.current = {
      ...latestStudyState,
      pages: latestPages,
      pageIndex: latestPageIndex,
      messages: nextHistory,
    };
    setMessages((current) => {
      const nextMessages = [...current, userMessage];
      agentStudyStateRef.current = {
        ...agentStudyStateRef.current,
        messages: nextMessages,
      };
      return nextMessages;
    });
    setIsThinking(true);
    setError("");

    try {
      if (rtcAgentStartedRef.current) {
        const sent = await sendRtcAgentTextQuestion(safeQuestion);
        if (!sent) {
          throw new Error("问题没有发送到 RTC 智能体，请检查实时语音连接。");
        }
        return;
      }

      const requestPayload = await buildAgentCoachRequestPayloadAsync(safeQuestion);
      let payload: {
        reply?: string;
        audioDataUrl?: string;
        error?: string;
        doubaoError?: string;
        fallbackError?: string;
        visionError?: string;
      };
      const isVisualQuestion = isImageDescriptionRequest(safeQuestion);
      const primaryEndpoint = isVisualQuestion
        ? "/api/storyflow/doubao-coach"
        : "/api/storyflow/doubao-realtime-turn";
      const fallbackEndpoint = primaryEndpoint === "/api/storyflow/doubao-coach"
        ? "/api/storyflow/doubao-realtime-turn"
        : "/api/storyflow/doubao-coach";
      let response = await fetch(primaryEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestPayload),
      });
      payload = (await response.json().catch(() => ({}))) as typeof payload;
      if (!isVisualQuestion && (!response.ok || !payload.reply)) {
        response = await fetch(fallbackEndpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestPayload),
        });
        payload = (await response.json().catch(() => ({}))) as typeof payload;
      }
      if (!response.ok || !payload.reply) {
        throw new Error(
          payload.error ||
            payload.visionError ||
            payload.fallbackError ||
            payload.doubaoError ||
            "AI老师暂时没有回应"
        );
      }
      if (payload.visionError) {
        setError(`当前视觉识别没有接上：${payload.visionError}`);
      }
      const replyText = payload.reply.trim();
      const coachMessage: AgentMessage = {
        id: `coach_${Date.now()}`,
        role: "coach",
        text: replyText,
      };
      setMessages((current) => {
        const nextMessages = [...current, coachMessage];
        agentStudyStateRef.current = {
          ...agentStudyStateRef.current,
          messages: nextMessages,
        };
        return nextMessages;
      });
    } catch (coachError) {
      const fallbackReply = buildLocalAgentReply(safeQuestion, latestActivePage);
      const fallbackMessage: AgentMessage = {
        id: `coach_fallback_${Date.now()}`,
        role: "coach",
        text: fallbackReply,
      };
      setMessages((current) => {
        const nextMessages = [...current, fallbackMessage];
        agentStudyStateRef.current = {
          ...agentStudyStateRef.current,
          messages: nextMessages,
        };
        return nextMessages;
      });
      setError(
        coachError instanceof Error
          ? `AI实时接口暂时不稳定，Mia 已先用本地教学方式回答：${coachError.message}`
          : "AI实时接口暂时不稳定，Mia 已先用本地教学方式回答。"
      );
    } finally {
      setIsThinking(false);
    }
  };

  const stopVoiceAudioReply = () => {
    voicePcmPlaybackTokenRef.current += 1;
    voicePcmPlaybackChainRef.current = Promise.resolve();
    voiceStreamAwaitingReplyRef.current = false;
    voicePcmSourcesRef.current.forEach((source) => {
      try {
        source.stop();
      } catch {
        // ignore stopped streaming audio nodes
      }
    });
    voicePcmSourcesRef.current = [];
    voicePcmNextPlayTimeRef.current = 0;
    if (voiceAudioRef.current) {
      voiceAudioRef.current.pause();
      voiceAudioRef.current.src = "";
      voiceAudioRef.current = null;
    }
  };

  const clearVoiceStreamTurnTimeout = () => {
    if (voiceStreamTurnTimeoutRef.current) {
      clearTimeout(voiceStreamTurnTimeoutRef.current);
      voiceStreamTurnTimeoutRef.current = null;
    }
  };

  const clearVoiceStreamPlaybackReleaseTimer = () => {
    if (voiceStreamPlaybackReleaseTimerRef.current) {
      clearTimeout(voiceStreamPlaybackReleaseTimerRef.current);
      voiceStreamPlaybackReleaseTimerRef.current = null;
    }
  };

  const resetVoiceStreamTurnState = () => {
    clearVoiceStreamTurnTimeout();
    clearVoiceStreamPlaybackReleaseTimer();
    voiceStreamAwaitingReplyRef.current = false;
    voiceStreamSpeechActiveRef.current = false;
    voiceStreamSpeechEndedRef.current = true;
    voiceStreamPcmRemainderRef.current = new Uint8Array();
    setIsVoiceListening(false);
    setIsThinking(false);
    voiceRequestInFlightRef.current = false;
  };

  const stopVoiceStreamingCapture = () => {
    if (voiceStreamProcessorRef.current) {
      voiceStreamProcessorRef.current.disconnect();
      voiceStreamProcessorRef.current.onaudioprocess = null;
      voiceStreamProcessorRef.current = null;
    }
    voiceStreamSourceRef.current?.disconnect();
    voiceStreamSourceRef.current = null;
    if (voiceStreamCaptureContextRef.current) {
      void voiceStreamCaptureContextRef.current.close().catch(() => undefined);
      voiceStreamCaptureContextRef.current = null;
    }
    voiceStreamSpeechActiveRef.current = false;
    voiceStreamSpeechEndedRef.current = true;
    voiceStreamPcmRemainderRef.current = new Uint8Array();
    setIsVoiceListening(false);
  };

  const stopVoiceStreamingSession = () => {
    stopVoiceStreamingCapture();
    resetVoiceStreamTurnState();
    voiceStreamReadyRef.current = false;
    if (voiceStreamWsRef.current) {
      voiceStreamWsRef.current.close();
      voiceStreamWsRef.current = null;
    }
  };

  const sendVoiceStreamJson = (payload: Record<string, unknown>) => {
    const socket = voiceStreamWsRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(payload));
    return true;
  };

  const sendVoicePcmBytes = (bytes: Uint8Array) => {
    const socket = voiceStreamWsRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || !voiceStreamReadyRef.current) return;
    const merged = mergeBytes(voiceStreamPcmRemainderRef.current, bytes);
    const frameSize = 640;
    let offset = 0;

    while (offset + frameSize <= merged.length) {
      const frame = merged.slice(offset, offset + frameSize);
      socket.send(frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength));
      offset += frameSize;
    }

    voiceStreamPcmRemainderRef.current = merged.slice(offset);
  };

  const flushVoicePcmRemainder = () => {
    const socket = voiceStreamWsRef.current;
    const remainder = voiceStreamPcmRemainderRef.current;
    if (socket && socket.readyState === WebSocket.OPEN && remainder.length) {
      socket.send(remainder.buffer.slice(remainder.byteOffset, remainder.byteOffset + remainder.byteLength));
    }
    voiceStreamPcmRemainderRef.current = new Uint8Array();
  };

  const scheduleVoicePcmChunk = async (chunk: ArrayBuffer, playbackToken: number) => {
    if (!chunk.byteLength) return;
    if (playbackToken !== voicePcmPlaybackTokenRef.current) return;
    const AudioContextCtor =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;

    const audioContext =
      voicePcmAudioContextRef.current ||
      new AudioContextCtor({
        sampleRate: 24000,
      });
    voicePcmAudioContextRef.current = audioContext;
    await audioContext.resume().catch(() => undefined);
    if (playbackToken !== voicePcmPlaybackTokenRef.current) return;

    const samples = pcm16BytesToFloat32(chunk);
    const audioBuffer = audioContext.createBuffer(1, samples.length, 24000);
    audioBuffer.copyToChannel(samples, 0);

    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContext.destination);
    const startAt = Math.max(
      audioContext.currentTime + 0.12,
      voicePcmNextPlayTimeRef.current || audioContext.currentTime + 0.12
    );
    voicePcmNextPlayTimeRef.current = startAt + audioBuffer.duration;
    voicePcmSourcesRef.current.push(source);
    source.onended = () => {
      voicePcmSourcesRef.current = voicePcmSourcesRef.current.filter((item) => item !== source);
    };
    source.start(startAt);
  };

  const playVoicePcmChunk = async (chunk: ArrayBuffer) => {
    const playbackToken = voicePcmPlaybackTokenRef.current;
    const nextPlayback = voicePcmPlaybackChainRef.current.then(() =>
      scheduleVoicePcmChunk(chunk, playbackToken)
    );
    voicePcmPlaybackChainRef.current = nextPlayback.catch(() => undefined);
    await nextPlayback;
  };

  const prepareVoicePlaybackContext = async () => {
    const AudioContextCtor =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;
    const audioContext =
      voicePcmAudioContextRef.current ||
      new AudioContextCtor({
        sampleRate: 24000,
      });
    voicePcmAudioContextRef.current = audioContext;
    await audioContext.resume().catch(() => undefined);
  };

  const restartVoiceStreamingAfterStall = () => {
    resetVoiceStreamTurnState();
    setError("这轮实时语音没有听清或没有返回结果，请直接再说一次。");
    setVoiceStatus(voiceSessionActiveRef.current ? "可以继续直接说话" : "");
  };

  const startVoiceStreamTurnTimeout = () => {
    clearVoiceStreamTurnTimeout();
    voiceStreamTurnTimeoutRef.current = setTimeout(() => {
      if (!voiceStreamAwaitingReplyRef.current) return;
      restartVoiceStreamingAfterStall();
    }, voiceStreamTurnTimeoutMs);
  };

  const handleVoiceStreamTurnEnd = async (payload: { reply?: string; asrText?: string }) => {
    clearVoiceStreamTurnTimeout();
    clearVoiceStreamPlaybackReleaseTimer();
    voiceStreamSpeechActiveRef.current = false;
    voiceStreamSpeechEndedRef.current = true;
    voiceStreamPcmRemainderRef.current = new Uint8Array();
    setIsVoiceListening(false);
    setIsThinking(false);

    const recognizedText = (payload.asrText || voiceStreamAsrRef.current).trim();
    const replyText = (payload.reply || voiceStreamReplyRef.current).trim();
    setMessages((current) => {
      const nextMessages = [
        ...current,
        ...(recognizedText
          ? [
              {
                id: `voice_student_${Date.now()}`,
                role: "student" as const,
                text: `我听到：${recognizedText}`,
              },
            ]
          : []),
        ...(replyText
          ? [
              {
                id: `voice_coach_${Date.now()}`,
                role: "coach" as const,
                text: replyText,
              },
            ]
          : []),
      ];
      agentStudyStateRef.current = {
        ...agentStudyStateRef.current,
        messages: nextMessages,
      };
      return nextMessages;
    });

    voiceStreamReplyRef.current = "";
    voiceStreamAsrRef.current = "";
    await voicePcmPlaybackChainRef.current.catch(() => undefined);

    const playbackContext = voicePcmAudioContextRef.current;
    const queuedPlaybackMs = playbackContext
      ? (voicePcmNextPlayTimeRef.current - playbackContext.currentTime) * 1000
      : 0;
    const releaseDelayMs = Math.max(250, queuedPlaybackMs + 260);
    voiceStreamAwaitingReplyRef.current = true;
    voiceStreamPlaybackReleaseTimerRef.current = setTimeout(() => {
      voiceStreamPlaybackReleaseTimerRef.current = null;
      voiceStreamAwaitingReplyRef.current = false;
      voiceStreamPcmRemainderRef.current = new Uint8Array();
      setVoiceStatus(voiceSessionActiveRef.current ? "可以继续直接说话" : "");
    }, releaseDelayMs);
  };

  const handleVoiceVisualQuestion = async (recognizedText: string) => {
    const safeQuestion = recognizedText.trim();
    if (!safeQuestion) return;

    clearVoiceStreamTurnTimeout();
    clearVoiceStreamPlaybackReleaseTimer();
    stopVoiceAudioReply();
    voiceStreamReplyRef.current = "";
    voiceStreamAsrRef.current = "";
    voiceStreamSpeechActiveRef.current = false;
    voiceStreamSpeechEndedRef.current = true;
    voiceStreamPcmRemainderRef.current = new Uint8Array();
    voiceStreamAwaitingReplyRef.current = true;
    setIsVoiceListening(false);
    setIsThinking(true);
    setVoiceStatus("正在看当前画面...");
    setError("");

    setMessages((current) => {
      const nextMessages = [
        ...current,
        {
          id: `voice_visual_student_${Date.now()}`,
          role: "student" as const,
          text: `我听到：${safeQuestion}`,
        },
      ];
      agentStudyStateRef.current = {
        ...agentStudyStateRef.current,
        messages: nextMessages,
      };
      return nextMessages;
    });

    try {
      const requestPayload = await buildAgentCoachRequestPayloadAsync(safeQuestion);
      const payload = await fetchCoachJson("/api/storyflow/doubao-coach", requestPayload, 18_000);
      if (payload.visionError) {
        setError(`当前视觉识别没有接上：${payload.visionError}`);
      }
      const replyText = normalizeText(
        payload.reply || "我现在不能可靠描述画面，先请你说一个你看到的东西。",
        900
      );

      setMessages((current) => {
        const nextMessages = [
          ...current,
          {
            id: `voice_visual_coach_${Date.now()}`,
            role: "coach" as const,
            text: replyText,
          },
        ];
        agentStudyStateRef.current = {
          ...agentStudyStateRef.current,
          messages: nextMessages,
        };
        return nextMessages;
      });

    } catch (visualError) {
      setError(
        visualError instanceof Error
          ? `当前画面识别失败：${visualError.message}`
          : "当前画面识别失败，请再试一次。"
      );
    } finally {
      setIsThinking(false);
      voiceStreamAwaitingReplyRef.current = false;
      setVoiceStatus(voiceSessionActiveRef.current ? "可以继续直接说话" : "");
    }
  };

  const handleVoiceStreamMessage = async (event: MessageEvent) => {
    if (typeof event.data !== "string") {
      const buffer =
        event.data instanceof Blob ? await event.data.arrayBuffer() : (event.data as ArrayBuffer);
      await playVoicePcmChunk(buffer);
      return;
    }

    const payload = JSON.parse(event.data) as {
      type?: string;
      text?: string;
      reply?: string;
      asrText?: string;
      error?: string;
    };

    if (payload.type === "ready") {
      voiceStreamReadyRef.current = true;
      setVoiceStatus("实时语音已开启，可以直接说话。");
      startVoiceStreamingCapture();
      return;
    }

    if (payload.type === "asr" && payload.text) {
      voiceStreamAsrRef.current = payload.text;
      return;
    }

    if (payload.type === "reply_delta" && payload.text) {
      voiceStreamReplyRef.current += payload.text;
      setIsThinking(false);
      return;
    }

    if (payload.type === "turn_end") {
      void handleVoiceStreamTurnEnd(payload);
      return;
    }

    if (payload.type === "visual_question") {
      void handleVoiceVisualQuestion(payload.text || payload.asrText || "");
      return;
    }

    if (payload.type === "error") {
      resetVoiceStreamTurnState();
      setError(payload.error || "实时语音连接异常");
    }
  };

  const startVoiceStreamingCapture = () => {
    const stream = voiceStreamRef.current;
    if (!stream?.active || voiceStreamProcessorRef.current) return;
    const AudioContextCtor =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) {
      throw new Error("当前浏览器不支持实时音频处理");
    }

    const audioContext = new AudioContextCtor();
    const source = audioContext.createMediaStreamSource(stream);
    const processor = audioContext.createScriptProcessor(1024, 1, 1);
    voiceStreamCaptureContextRef.current = audioContext;
    voiceStreamSourceRef.current = source;
    voiceStreamProcessorRef.current = processor;

    processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      const output = event.outputBuffer.getChannelData(0);
      output.fill(0);
      if (voiceStreamAwaitingReplyRef.current) return;

      let sum = 0;
      for (let index = 0; index < input.length; index += 1) {
        sum += input[index] * input[index];
      }
      const rms = Math.sqrt(sum / input.length);
      const now = Date.now();
      const voiceDetected = rms > 0.026;

      if (voiceDetected) {
        if (!voiceStreamSpeechActiveRef.current) {
          voiceStreamSpeechActiveRef.current = true;
          voiceStreamSpeechEndedRef.current = false;
          voiceStreamReplyRef.current = "";
          voiceStreamAsrRef.current = "";
          setIsVoiceListening(true);
          setVoiceStatus("正在听你说...");
          sendVoiceStreamJson({
            type: "context",
            payload: voiceLatestRequestPayloadRef.current || buildAgentCoachRequestPayload(""),
          });
          stopVoiceAudioReply();
          sendVoiceStreamJson({ type: "interrupt" });
        }
        voiceStreamLastVoiceMsRef.current = now;
      }

      if (!voiceStreamSpeechActiveRef.current) return;
      sendVoicePcmBytes(downsampleToPcm16Bytes(input, audioContext.sampleRate));

      if (
        !voiceDetected &&
        !voiceStreamSpeechEndedRef.current &&
        now - voiceStreamLastVoiceMsRef.current > voiceStreamSilenceEndMs
      ) {
        voiceStreamSpeechEndedRef.current = true;
        voiceStreamSpeechActiveRef.current = false;
        flushVoicePcmRemainder();
        sendVoiceStreamJson({ type: "end_asr" });
        voiceStreamAwaitingReplyRef.current = true;
        voiceRequestInFlightRef.current = true;
        startVoiceStreamTurnTimeout();
        setIsVoiceListening(false);
        setIsThinking(true);
        setVoiceStatus("");
      }
    };

    source.connect(processor);
    processor.connect(audioContext.destination);
    void audioContext.resume().catch(() => undefined);
  };

  const startVoiceStreamingSession = async () => {
    const startPayload =
      voiceLatestRequestPayloadRef.current ||
      (await buildAgentCoachRequestPayloadAsync("", { forceExactText: true }));
    voiceLatestRequestPayloadRef.current = startPayload;

    return new Promise<void>((resolve, reject) => {
      if (typeof window === "undefined") {
        reject(new Error("浏览器环境不可用"));
        return;
      }
      const socket = new WebSocket(getRealtimeCoachWebSocketUrl());
      socket.binaryType = "arraybuffer";
      voiceStreamWsRef.current = socket;

      const timeout = window.setTimeout(() => {
        reject(new Error("实时语音代理连接超时"));
        socket.close();
      }, 4500);

      socket.onopen = () => {
        socket.send(
          JSON.stringify({
            type: "start",
            payload: startPayload,
          })
        );
      };

      socket.onmessage = (event) => {
        if (typeof event.data === "string") {
          try {
            const payload = JSON.parse(event.data) as { type?: string; error?: string };
            if (payload.type === "ready") {
              window.clearTimeout(timeout);
              voiceStreamReadyRef.current = true;
              setVoiceStatus("实时语音已开启，可以直接说话。");
              startVoiceStreamingCapture();
              resolve();
              return;
            }
            if (payload.type === "error") {
              window.clearTimeout(timeout);
              if (!voiceStreamReadyRef.current) {
                reject(new Error(payload.error || "实时语音代理连接失败"));
                return;
              }
              void handleVoiceStreamMessage(event);
              return;
            }
          } catch {
            // Let the shared handler surface parsing problems.
          }
        }
        void handleVoiceStreamMessage(event);
      };

      socket.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error("实时语音代理连接失败"));
      };

      socket.onclose = () => {
        voiceStreamReadyRef.current = false;
        resetVoiceStreamTurnState();
        voiceRequestInFlightRef.current = false;
        if (voiceSessionActiveRef.current && !voiceManualStopRef.current) {
          setError((current) => current || "实时语音连接已断开，请重新点击实时语音。");
          voiceSessionActiveRef.current = false;
          setIsVoiceSessionActive(false);
          setVoiceStatus("");
        }
      };
    });
  };

  const stopRtcAgentSession = async () => {
    const session = rtcAgentSessionRef.current;
    const engine = rtcEngineRef.current;
    rtcAgentSessionRef.current = null;
    rtcAgentStartedRef.current = false;
    rtcEngineRef.current = null;
    stopRtcVisualTrack();

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
      await safeDestroyRtcEngine(engine);
    }
  };

  const sendRtcAgentControlMessage = async (message: string) => {
    const session = rtcAgentSessionRef.current;
    if (!session || !rtcAgentStartedRef.current) return false;

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

  const markRtcCoachResponseReceived = (text: string, definite?: boolean) => {
    void text;
    void definite;
    rtcCoachResponseSerialRef.current += 1;
  };

  const notifyRtcAgentPageChanged = async (
    safeIndex: number,
    page: AgentMaterialPage,
    nextLessonStep: AgentLessonStep
  ) => {
    const session = rtcAgentSessionRef.current;
    if (!session || !rtcAgentStartedRef.current) return;

    const pageLabel = getAgentPageLabel(page, safeIndex, pages);
    const structuredPageText = page.originalPageSegments?.length
      ? formatOriginalPageSegments(page.originalPageSegments)
      : "";
    const pageText = getMaterialPageText(page, 900);
    const lessonState = formatAgentLessonStatePrompt(buildLessonState(nextLessonStep));
    const message = [
      `学生已经翻到${pageLabel}。`,
      "请按照当前学习流程自动继续这一页，不要等待学生再提醒。",
      "只允许讲当前可见页和当前页原文；不要提前讲未翻到页面的后续剧情。",
      "不要把上一页的油漆未干、之前对话或故事常识编成当前页已经发生的事；如果当前页没有画出或写出踩到红油漆，就不能说 Kipper 踩到红油漆。",
      "当前页讲解顺序：必须先看页码标签；例如“绘本页 8-9”，必须一轮只讲一侧，先讲第8页/左页，并围绕左页原文提出一个互动问题；学生回应后，再继续第9页/右页。不要把左右两页合在一个长回答里讲完。",
      "如果是第一轮：先用一句话引导学生观察当前侧页图片，再按下方原文顺序完整朗读当前侧页，不要漏掉句子，然后讲一两个重点词句。",
      "讲当前侧页时，必须先完整朗读当前侧页的全部原文句子，不能只挑一句；读完全部原文后，才解释一两个重点并互动。",
      "提出互动问题、要求学生朗读或提示翻页后，必须等待学生语音回复或真实翻页事件；如果没有学生语音回复，也没有翻页，就停止说话，不要继续讲后面页面。",
      "如果是第二轮：请让学生朗读当前页，然后给发音和理解反馈。",
      "原文为主，每一侧页都要有一次学生互动：可以让孩子跟读一句、找一个关键词、回答一句原文的意思，或说说图中对应动作。",
      lessonState,
      structuredPageText
        ? `当前页分栏原文（每个分栏的全文都必须逐句完整朗读；当前轮只讲当前侧页，不要漏句）：${structuredPageText}`
        : pageText
          ? `当前页后台原文（必须完整讲解和朗读，不要漏句）：${pageText}`
          : "当前页后台原文为空，请根据画面先引导观察，不要编造看不清的内容。",
    ].join("\n");

    try {
      voiceLatestRequestPayloadRef.current = await buildAgentCoachRequestPayloadAsync("", {
        forceExactText: true,
      });
    } catch {
      voiceLatestRequestPayloadRef.current = buildAgentCoachRequestPayload("");
    }

    try {
      const sent = await sendRtcAgentControlMessage(message);
      setVoiceStatus(
        sent
          ? `已翻到${pageLabel}，已让 Mia 讲这一页。`
          : `已翻到${pageLabel}，但 RTC 翻页通知没有发送成功。`
      );
    } catch (error) {
      setVoiceStatus(`已翻到${pageLabel}，但 RTC 翻页通知没有发送成功。`);
      setError(error instanceof Error ? error.message : "RTC 翻页通知没有发送成功。");
    }
  };

  const refreshRtcPageAfterTurn = async (
    safeIndex: number,
    page: AgentMaterialPage,
    nextLessonStep: AgentLessonStep
  ) => {
    stopVoiceAudioReply();

    const session = rtcAgentSessionRef.current;
    if (session && rtcAgentStartedRef.current) {
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
    }

    const canvas = rtcVisualCanvasRef.current;
    if (canvas) {
      await drawRtcVisualFrame(canvas).catch(() => false);
      const track = rtcVisualStreamRef.current?.getVideoTracks()[0] as
        | (MediaStreamTrack & { requestFrame?: () => void })
        | undefined;
      track?.requestFrame?.();
    }

    await notifyRtcAgentPageChanged(safeIndex, page, nextLessonStep);
  };

  const beginRtcAgentSession = async () => {
    if (!pages.length) {
      throw new Error("请先上传资料，再开启实时语音。");
    }

    stopVoiceStreamingSession();
    stopVoiceAudioReply();

    setVoiceStatus("正在创建 RTC 房间...");
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

    const rtcModule = await import("@volcengine/rtc");
    const VERTC = rtcModule.default;
    const MediaType = rtcModule.MediaType;
    const RoomProfileType = rtcModule.RoomProfileType;
    const StreamIndex = rtcModule.StreamIndex;
    const VideoSourceType = rtcModule.VideoSourceType;
    const engine = VERTC.createEngine(sessionPayload.appId) as AgentRtcEngine;
    rtcAudioMediaTypeRef.current = MediaType.AUDIO;

    rtcEngineRef.current = engine;
    rtcAgentSessionRef.current = sessionPayload;
    rtcAgentStartedRef.current = false;
    rtcTranscriptIdsRef.current.clear();
    rtcLiveTranscriptIdsRef.current = {};
    rtcRecentTranscriptRef.current = {};

    const playRemoteAudio = (userId?: string) => {
      if (!userId || userId === sessionPayload.userId) return;
      void engine.subscribeStream(userId, MediaType.AUDIO).catch(() => undefined);
      void engine.play(userId, MediaType.AUDIO).catch(() => undefined);
    };

    engine.on(VERTC.events.onUserPublishStream, (rawEvent: unknown) => {
      const event = rawEvent as { userId?: string; mediaType?: number };
      if (typeof event.mediaType === "number" && !(event.mediaType & MediaType.AUDIO)) return;
      setVoiceStatus("Mia 已进入语音房间，正在播放回复...");
      playRemoteAudio(event.userId);
    });

    engine.on(VERTC.events.onRemoteAudioFirstFrame, (rawEvent: unknown) => {
      const event = rawEvent as { userId?: string };
      if (event.userId && event.userId !== sessionPayload.userId) {
        setVoiceStatus("正在播放 Mia 的声音...");
      }
    });

    engine.on(VERTC.events.onSubtitleMessageReceived, (...rawEvents: unknown[]) => {
      const subtitles = normalizeRtcSubtitleItems(rawEvents);
      subtitles.forEach((subtitle) => {
        const userId =
          typeof subtitle.userId === "string"
            ? subtitle.userId
            : typeof subtitle.uid === "string"
              ? subtitle.uid
              : typeof subtitle.user_id === "string"
                ? subtitle.user_id
                : "";
        const text = extractRtcMessageText(subtitle);
        if (!userId || !text) return;
        const role = userId === sessionPayload.userId ? "student" : "coach";
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
        const transcriptId = getStableRtcTranscriptId({
          source: `sdk_${userId}`,
          role,
          text,
          sequence,
          definite,
        });
        upsertRtcTranscriptMessage({
          id: transcriptId,
          role,
          text,
          definite,
        });
        if (role === "coach") markRtcCoachResponseReceived(text, definite);
        if (definite) advanceLessonStepFromSubtitle(role, text);
        setVoiceStatus(role === "student" ? "Mia 正在听..." : "Mia 正在回复...");
      });
    });

    const handleRtsSubtitleMessage = (rawEvent: unknown, fallbackRole: AgentMessage["role"]) => {
      const event = rawEvent as { userId?: string; message?: unknown };
      const items = collectRtsSubtitleItems(
        event.message ?? rawEvent,
        sessionPayload,
        event.userId === sessionPayload.userId ? "student" : fallbackRole
      );
      items.forEach((item, index) => {
        const transcriptId = getStableRtcTranscriptId({
          source: `rts_${event.userId || "room"}`,
          role: item.role,
          text: item.text,
          sequence: `${item.sequence}_${index}`,
          definite: item.definite,
        });
        upsertRtcTranscriptMessage({
          id: transcriptId,
          role: item.role,
          text: item.text,
          definite: item.definite,
        });
        if (item.role === "coach") markRtcCoachResponseReceived(item.text, item.definite);
        if (item.definite) advanceLessonStepFromSubtitle(item.role, item.text);
      });
      if (items.length) {
        setVoiceStatus(
          items.some((item) => item.role === "coach") ? "正在播放 Mia 的声音..." : "Mia 正在听..."
        );
      } else {
        setVoiceStatus("已收到智能体消息，但还没解析出字幕文本。");
        console.info("[agent-rtc] unparsed RTS message", rawEvent);
      }
    };

    engine.on(VERTC.events.onRoomMessageReceived, (rawEvent: unknown) => {
      handleRtsSubtitleMessage(rawEvent, "coach");
    });

    engine.on(VERTC.events.onUserMessageReceived, (rawEvent: unknown) => {
      handleRtsSubtitleMessage(rawEvent, "coach");
    });

    engine.on(VERTC.events.onRoomBinaryMessageReceived, (rawEvent: unknown) => {
      const event = rawEvent as { userId?: string; message?: unknown };
      handleRtsSubtitleMessage(
        {
          ...event,
          message: decodeRtcBinaryMessage(event.message),
        },
        "coach"
      );
    });

    engine.on(VERTC.events.onUserBinaryMessageReceived, (rawEvent: unknown) => {
      const event = rawEvent as { userId?: string; message?: unknown };
      handleRtsSubtitleMessage(
        {
          ...event,
          message: decodeRtcBinaryMessage(event.message),
        },
        "coach"
      );
    });

    engine.on(VERTC.events.onSubtitleStateChanged, (rawEvent: unknown) => {
      const event = rawEvent as { errorMessage?: string; errorCode?: string };
      if (event.errorMessage || event.errorCode) {
        setVoiceStatus(`字幕同步暂不可用：${event.errorMessage || event.errorCode}`);
      }
    });

    engine.on(VERTC.events.onAutoplayFailed, (rawEvent: unknown) => {
      const event = rawEvent as { resume?: () => Promise<void> };
      void event.resume?.().catch(() => {
        setError("浏览器阻止了自动播放，请再点击一次实时语音按钮或页面任意位置后重试。");
      });
    });

    setVoiceStatus("正在加入 RTC 房间...");
    let hasVisualTrack = false;
    try {
      setVoiceStatus("正在准备当前页面视觉流...");
      hasVisualTrack = await startRtcVisualTrack(engine, StreamIndex, VideoSourceType);
    } catch {
      hasVisualTrack = false;
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

    setVoiceStatus("正在打开麦克风...");
    await engine.startAudioCapture();
    await engine.publishStream(hasVisualTrack ? MediaType.AUDIO_AND_VIDEO : MediaType.AUDIO);

    setVoiceStatus("正在邀请 Mia 进入房间...");
    const startResponse = await fetch("/api/agent-rtc/start", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...sessionPayload,
        lessonState: buildRtcAgentSessionLessonStatePrompt(),
        welcomeMessage: buildRtcAgentResumeWelcomeMessage(),
      }),
    });
    const startPayload = (await startResponse.json().catch(() => ({}))) as { error?: string };
    if (!startResponse.ok) {
      throw new Error(startPayload.error || "StartVoiceChat failed");
    }

    rtcAgentStartedRef.current = true;
    rtcAgentEverStartedRef.current = true;
    voiceSessionActiveRef.current = true;
    voiceManualStopRef.current = false;
    setIsVoiceSessionActive(true);
    setVoiceStatus(
      hasVisualTrack
        ? "RTC 智能体语音已开启，Mia 正在接收当前页面画面。"
        : "RTC 智能体语音已开启，但当前页面视觉流未发布。"
    );
  };

  const beginVoiceStreamSession = async () => {
    if (voiceSessionActiveRef.current) return;
    if (!pages.length) {
      setError("请先上传资料，再开启实时语音。");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("当前浏览器无法打开麦克风，请检查浏览器权限或使用 Chrome。你仍然可以在下方输入文字提问。");
      return;
    }

    setError("");
    setVoiceStatus("正在请求麦克风权限...");
    try {
      if (!voiceStreamRef.current?.active) {
        voiceStreamRef.current = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      }
    } catch {
      setError("没有获得麦克风权限。请在浏览器地址栏允许麦克风，然后重新点击语音按钮。");
      setVoiceStatus("");
      return;
    }

    voiceSessionActiveRef.current = true;
    voiceManualStopRef.current = false;
    setIsVoiceSessionActive(true);
    await prepareVoicePlaybackContext();
    setVoiceStatus("正在读取当前屏幕...");
    try {
      voiceLatestRequestPayloadRef.current = await buildAgentCoachRequestPayloadAsync("", {
        forceExactText: true,
      });
      setVoiceStatus("正在连接实时语音...");
      await startVoiceStreamingSession();
    } catch (streamError) {
      setError(
        streamError instanceof Error
          ? `${streamError.message}，请检查实时语音服务后重试。`
          : "实时语音连接失败，请检查实时语音服务后重试。"
      );
      voiceSessionActiveRef.current = false;
      setIsVoiceSessionActive(false);
      setVoiceStatus("");
    }
  };

  const beginVoiceSession = async () => {
    if (voiceSessionActiveRef.current) return;
    setError("");
    try {
      await beginRtcAgentSession();
    } catch (rtcError) {
      await stopRtcAgentSession();
      const message = rtcError instanceof Error ? rtcError.message : "RTC 智能体启动失败";
      if (rtcError instanceof Error && rtcError.name === "RtcSessionConfigError") {
        setError(`RTC智能体配置不完整，已切回旧实时语音：${message}`);
        await beginVoiceStreamSession();
        return;
      }
      setError(`RTC智能体连接失败：${message}`);
      setVoiceStatus("");
    }
  };

  const stopVoiceSession = () => {
    voiceSessionActiveRef.current = false;
    voiceManualStopRef.current = true;
    setIsVoiceSessionActive(false);
    setVoiceStatus("");
    void stopRtcAgentSession();
    stopVoiceStreamingSession();
    stopVoiceAudioReply();
    if (voiceAudioRef.current) {
      voiceAudioRef.current.pause();
      voiceAudioRef.current.src = "";
      voiceAudioRef.current = null;
    }
    voicePcmSourcesRef.current.forEach((source) => {
      try {
        source.stop();
      } catch {
        // ignore already-stopped streaming audio nodes
      }
    });
    voicePcmSourcesRef.current = [];
    if (voicePcmAudioContextRef.current) {
      void voicePcmAudioContextRef.current.close().catch(() => undefined);
      voicePcmAudioContextRef.current = null;
    }
    voiceStreamRef.current?.getTracks().forEach((track) => track.stop());
    voiceStreamRef.current = null;
  };

  const playVoiceReply = (audioDataUrl: string) =>
    new Promise<void>((resolve) => {
      if (!audioDataUrl) {
        resolve();
        return;
      }
      const playWithAudioContext = async () => {
        const AudioContextCtor =
          window.AudioContext ||
          (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioContextCtor) throw new Error("AudioContext unavailable");
        const audioContext =
          voicePcmAudioContextRef.current ||
          new AudioContextCtor({
            sampleRate: 24000,
          });
        voicePcmAudioContextRef.current = audioContext;
        await audioContext.resume();
        const audioBuffer = await fetch(audioDataUrl).then((response) => response.arrayBuffer());
        const decoded = await audioContext.decodeAudioData(audioBuffer.slice(0));
        const source = audioContext.createBufferSource();
        source.buffer = decoded;
        source.connect(audioContext.destination);
        voicePcmSourcesRef.current.push(source);
        source.onended = () => {
          voicePcmSourcesRef.current = voicePcmSourcesRef.current.filter((item) => item !== source);
          resolve();
        };
        source.start(0);
      };
      void playWithAudioContext().catch(() => {
        const audio = new Audio(audioDataUrl);
        voiceAudioRef.current = audio;
        const finish = () => {
          if (voiceAudioRef.current === audio) voiceAudioRef.current = null;
          resolve();
        };
        audio.onended = finish;
        audio.onerror = finish;
        void audio.play().catch(finish);
      });
    });

  const toggleVoiceSession = () => {
    if (voicePcmSourcesRef.current.length || voiceAudioRef.current) {
      stopVoiceAudioReply();
      if (!voiceSessionActiveRef.current) {
        voiceSessionActiveRef.current = true;
        voiceManualStopRef.current = false;
        setIsVoiceSessionActive(true);
      }
      if (!voiceStreamReadyRef.current) {
        void startVoiceStreamingSession().catch((streamError) => {
          setError(
            streamError instanceof Error
              ? `${streamError.message}，请检查实时语音服务后重试。`
              : "实时语音连接失败，请检查实时语音服务后重试。"
          );
          voiceSessionActiveRef.current = false;
          setIsVoiceSessionActive(false);
          setVoiceStatus("");
        });
      }
      return;
    }
    if (voiceSessionActiveRef.current) {
      stopVoiceSession();
      return;
    }
    void beginVoiceSession();
  };

  const goToPage = (nextIndex: number) => {
    const safeIndex = Math.max(0, Math.min(pages.length - 1, nextIndex));
    setPageIndex(safeIndex);
    const page = pages[safeIndex];
    if (!page) return;
    const previousLessonStep = agentStudyStateRef.current.lessonStep;
    const nextLessonStep: AgentLessonStep =
      previousLessonStep.startsWith("round2") || previousLessonStep === "summary"
        ? "round2_student_read"
        : "round1_picture";
    const pageLabel = getAgentPageLabel(page, safeIndex, pages);
    const pageText = getMaterialPageText(page, 160);
    const pageMessage: AgentMessage = {
      id: `page_${safeIndex}_${Date.now()}`,
      role: "coach",
      text: pageText
        ? `我们翻到${pageLabel}了。我先看一下：${pageText} 你可以问我这一页哪里不懂。`
        : `我们翻到${pageLabel}了。先观察这页内容，你可以问我重点、单词或怎么理解。`,
    };
    agentStudyStateRef.current = {
      ...agentStudyStateRef.current,
      pages,
      pageIndex: safeIndex,
      lessonStep: nextLessonStep,
      messages: [...agentStudyStateRef.current.messages, pageMessage],
    };
    setLessonStep(nextLessonStep);
    setMessages((current) => {
      const nextMessages = [...current, pageMessage];
      agentStudyStateRef.current = {
        ...agentStudyStateRef.current,
        pages,
        pageIndex: safeIndex,
        lessonStep: nextLessonStep,
        messages: nextMessages,
      };
      return nextMessages;
    });
    void refreshRtcPageAfterTurn(safeIndex, page, nextLessonStep);
  };

  if (view === "history") {
    return (
      <div className="min-h-screen bg-[linear-gradient(180deg,#edf7ff,#f7fbff)] px-4 py-5">
        <div className="mx-auto max-w-[1180px]">
          <header className="flex items-center justify-between gap-4">
            <button
              type="button"
              onClick={() => setView("study")}
              className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-sky-500 shadow-[0_10px_24px_rgba(120,149,188,0.16)] transition hover:-translate-x-0.5"
              aria-label="返回学习页"
            >
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 12H8" />
                <path d="m12 8-4 4 4 4" />
              </svg>
            </button>
            <div className="min-w-0 flex-1 rounded-full border border-sky-100 bg-white/78 px-5 py-3 shadow-[0_10px_26px_rgba(120,149,188,0.09)]">
              <h1 className="text-xl font-black text-slate-900">Agent学习记录库</h1>
              <p className="mt-1 truncate text-sm font-semibold text-slate-500">
                小朋友上传资料后，Mia 会陪着一页一页学。
              </p>
            </div>
            <label
              htmlFor={materialInputId}
              onClick={() => setView("study")}
              className="inline-flex h-12 items-center rounded-full bg-blue-600 px-6 text-sm font-black text-white shadow-[0_12px_28px_rgba(37,99,235,0.2)] transition hover:bg-blue-500"
            >
              上传资料
            </label>
          </header>

          <input
            id={materialInputId}
            ref={fileInputRef}
            type="file"
            multiple
            accept={acceptedTypes}
            onChange={(event) => void handleFiles(event.target.files)}
            className="sr-only"
          />

          <section className="mt-7 grid gap-5 lg:grid-cols-2">
            <article className="rounded-[1.75rem] border border-sky-100 bg-white/86 p-6 shadow-[0_18px_48px_rgba(120,149,188,0.12)]">
              <p className="text-sm font-black uppercase tracking-[0.24em] text-blue-500">
                Continue
              </p>
              <h2 className="mt-3 text-3xl font-black text-slate-900">继续学习</h2>
              {latestRecord ? (
                <div className="mt-5 flex gap-4">
                  <div className="grid h-28 w-24 shrink-0 place-items-center overflow-hidden rounded-[1rem] bg-sky-50">
                    {latestRecord.pages[0]?.previewUrl && latestRecord.pages[0].kind !== "pdf" ? (
                      <img src={latestRecord.pages[0].previewUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-sm font-black text-blue-500">
                        {latestRecord.fileType.toUpperCase()}
                      </span>
                    )}
                  </div>
	                  <div className="min-w-0 flex-1">
	                    <h3 className="truncate text-xl font-black text-slate-900">{latestRecord.title}</h3>
	                    <p className="mt-2 text-sm font-semibold text-slate-500">
	                      已学习到 {getPageCounterLabel(
	                        latestRecord.pages[latestRecord.currentPageIndex],
	                        latestRecord.currentPageIndex,
	                        latestRecord.pages
	                      )}
	                    </p>
                    <p className="mt-1 text-sm font-semibold text-slate-400">
                      上次学习：{formatRecordTime(latestRecord.updatedAt)}
                    </p>
                    <button
                      type="button"
                      onClick={() => openRecord(latestRecord)}
                      className="mt-4 rounded-full bg-blue-600 px-5 py-2.5 text-sm font-black text-white transition hover:bg-blue-500"
                    >
                      继续学习
                    </button>
                  </div>
                </div>
              ) : (
                <p className="mt-5 text-sm font-semibold leading-7 text-slate-500">
                  还没有保存的 Agent 学习记录。上传资料并点击“保存资料”后，会出现在这里。
                </p>
              )}
            </article>

            <article className="rounded-[1.75rem] border border-sky-100 bg-white/86 p-6 shadow-[0_18px_48px_rgba(120,149,188,0.12)]">
              <p className="text-sm font-black uppercase tracking-[0.24em] text-blue-500">
                New
              </p>
              <h2 className="mt-3 text-3xl font-black text-slate-900">新建学习</h2>
              <p className="mt-4 text-sm font-semibold leading-7 text-slate-500">
                支持 PDF、Word、JPG、PNG，AI老师先分析内容，再陪孩子互动学习。
              </p>
              <label
                htmlFor={materialInputId}
                onClick={() => setView("study")}
                className="mt-6 inline-flex rounded-full bg-blue-600 px-6 py-3 text-sm font-black text-white transition hover:bg-blue-500"
              >
                上传资料
              </label>
            </article>
          </section>

          <section className="mt-7">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-2xl font-black text-slate-900">历史学习记录</h2>
              <div className="hidden rounded-full border border-sky-100 bg-white px-5 py-2.5 text-sm font-semibold text-slate-400 md:block">
                搜索资料
              </div>
            </div>

            {records.length ? (
              <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {records.map((record) => (
                  <article
                    key={record.id}
                    className="rounded-[1.35rem] border border-sky-100 bg-white p-4 shadow-[0_14px_34px_rgba(120,149,188,0.1)]"
                  >
                    <div className="flex gap-3">
                      <div className="grid h-20 w-16 shrink-0 place-items-center overflow-hidden rounded-[0.8rem] bg-sky-50">
                        {record.pages[0]?.previewUrl && record.pages[0].kind !== "pdf" ? (
                          <img src={record.pages[0].previewUrl} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <span className="text-xs font-black text-blue-500">
                            {record.fileType.toUpperCase()}
                          </span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-base font-black text-slate-900">{record.title}</h3>
                        <p className="mt-1 text-xs font-bold text-blue-500">{record.fileType.toUpperCase()}</p>
                        <div className="mt-3 h-2 overflow-hidden rounded-full bg-sky-50">
                          <div
                            className="h-full rounded-full bg-emerald-500"
                            style={{
                              width: `${Math.round(((record.currentPageIndex + 1) / Math.max(1, record.pages.length)) * 100)}%`,
                            }}
                          />
	                        </div>
	                        <p className="mt-2 text-xs font-semibold text-slate-400">
	                          {getPageCounterLabel(
	                            record.pages[record.currentPageIndex],
	                            record.currentPageIndex,
	                            record.pages
	                          )} · {formatRecordTime(record.updatedAt)}
	                        </p>
                      </div>
                    </div>
                    <div className="mt-4 flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => openRecord(record)}
                        className="rounded-full bg-blue-600 px-4 py-2 text-sm font-black text-white transition hover:bg-blue-500"
                      >
                        继续
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteRecord(record.id)}
                        className="rounded-full bg-slate-50 px-4 py-2 text-sm font-black text-slate-400 transition hover:bg-rose-50 hover:text-rose-500"
                      >
                        删除
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="mt-4 rounded-[1.35rem] border border-dashed border-sky-200 bg-white/70 p-8 text-center text-sm font-semibold text-slate-500">
                暂无历史学习记录。
              </div>
            )}
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="box-border h-[100dvh] overflow-hidden bg-[linear-gradient(180deg,#edf7ff,#f7fbff)] px-3 py-2">
      <div
        ref={agentCaptureRef}
        className="mx-auto flex h-full max-w-[1540px] flex-col overflow-hidden rounded-[1.35rem] border border-sky-100 bg-white/94 shadow-[0_24px_70px_rgba(120,149,188,0.18)]"
      >
        <header className="grid h-[52px] shrink-0 grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-2 border-b border-sky-100/80 px-4 py-1">
          <Link
            href="/"
            className="flex h-9 w-9 items-center justify-center rounded-2xl bg-white/90 text-sky-500 shadow-[0_10px_24px_rgba(120,149,188,0.16)] transition hover:-translate-y-0.5 hover:bg-white"
            aria-label="返回首页"
            title="返回首页"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 12H8" />
              <path d="m12 8-4 4 4 4" />
            </svg>
          </Link>
          <div className="flex min-w-0 items-center gap-2 rounded-full border border-sky-100 bg-white/76 px-3 py-1.5 shadow-[0_10px_26px_rgba(120,149,188,0.09)]">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-blue-50 text-blue-500">
              <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20a8 8 0 1 0-8-8" />
                <path d="M12 12 18 6" />
                <path d="M15 6h3v3" />
              </svg>
            </span>
            <p className="shrink-0 text-sm font-black text-blue-600">Agent学习目标</p>
            <p className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-600">
              上传资料后，AI老师先分析当前页，再陪孩子提问、讲解和巩固。
            </p>
            <span className="shrink-0 rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-black text-blue-500">
              {isProcessingFile ? "分析资料中" : pages.length ? "自动陪学中" : "等待上传"}
            </span>
            <span className="shrink-0 text-xs font-black text-blue-600">
              {getPageCounterLabel(activePage, pageIndex, pages)}
            </span>
          </div>
          <label
            htmlFor={materialInputId}
            className="flex h-9 w-9 items-center justify-center justify-self-end rounded-2xl bg-white/90 text-sky-500 shadow-[0_10px_24px_rgba(120,149,188,0.16)] transition hover:-translate-y-0.5 hover:bg-white"
            aria-label="上传资料"
            title="上传资料"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 16V4" />
              <path d="m7 9 5-5 5 5" />
              <path d="M5 20h14" />
            </svg>
          </label>
        </header>

        <input
          id={materialInputId}
          ref={fileInputRef}
          type="file"
          multiple
          accept={acceptedTypes}
          onChange={(event) => void handleFiles(event.target.files)}
          className="sr-only"
        />

        <main className="grid min-h-0 flex-1 gap-2 px-3 py-2 lg:grid-cols-[minmax(0,1fr)_370px] 2xl:grid-cols-[minmax(0,1fr)_400px]">
          <section className="flex min-h-0 min-w-0 flex-col overflow-hidden">
            <div className="relative min-h-0 flex-1 overflow-hidden rounded-[1.35rem] bg-white shadow-[0_18px_48px_rgba(120,149,188,0.12)]">
              <div className="relative flex h-full min-h-[260px] items-center justify-center overflow-hidden rounded-[1.35rem] bg-white">
                {!pages.length ? (
                  <label
                    htmlFor={materialInputId}
                    className="flex h-full w-full flex-col items-center justify-center bg-[radial-gradient(circle_at_top,#eff8ff,#ffffff_62%)] px-8 text-center transition hover:bg-sky-50"
                  >
                    <span className="grid h-20 w-20 place-items-center rounded-[1.6rem] bg-blue-600 text-white shadow-[0_18px_38px_rgba(37,99,235,0.22)]">
                      <svg viewBox="0 0 24 24" className="h-10 w-10" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 16V4" />
                        <path d="m7 9 5-5 5 5" />
                        <path d="M5 20h14" />
                      </svg>
                    </span>
                    <h1 className="mt-6 text-3xl font-black text-slate-900">上传学习资料</h1>
                    <p className="mt-3 max-w-xl text-sm font-semibold leading-7 text-slate-500">
                      支持 PDF、Word、JPG、PNG。上传后可以翻页，AI老师会先分析内容，再陪孩子一起学。
                    </p>
                  </label>
                ) : activePage?.kind === "word" ? (
                  <div className="h-full w-full overflow-auto bg-[linear-gradient(180deg,#ffffff,#f8fbff)] p-8">
                    <div className="mx-auto max-w-3xl rounded-[1.4rem] border border-sky-100 bg-white p-8 shadow-sm">
                      <p className="text-sm font-black uppercase tracking-[0.24em] text-blue-500">Word</p>
                      <h1 className="mt-3 text-3xl font-black text-slate-900">{activePage.fileName}</h1>
                      <p className="mt-5 whitespace-pre-wrap text-base font-semibold leading-8 text-slate-600">
                        {activePage.text || "Word 文件已上传。当前文件没有解析出可预览正文，建议改传 PDF 或图片以获得完整页面预览。"}
                      </p>
                    </div>
                  </div>
                ) : activePage?.kind === "pdf" ? (
                  <div className="flex h-full w-full items-center justify-center overflow-hidden bg-white">
                    <div className="flex h-full max-h-full max-w-full items-center justify-center overflow-hidden bg-white">
                      {[activePage.previewUrl, activePage.pdfSecondPreviewUrl]
                        .filter(Boolean)
                        .map((previewUrl, pdfPageOffset) => {
                          const pdfPageNumber = (activePage.pdfPageNumber || 1) + pdfPageOffset;
                          return (
                            <img
                              key={pdfPageNumber}
                              src={previewUrl}
                              alt={`${activePage.fileName} 第 ${pdfPageNumber} 页`}
                              className="block h-full max-h-full w-auto max-w-none shrink-0 object-contain object-center"
                            />
                          );
                        })}
                    </div>
                  </div>
                ) : (
                  <img
                    src={activePage?.previewUrl}
                    alt={activePage?.title || "学习资料"}
                    className="block h-full max-h-full w-auto max-w-full object-contain object-center"
                  />
                )}

                {pages.length ? (
                  <div className="absolute bottom-3 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-full bg-slate-950/50 px-2.5 py-1.5 text-white shadow-[0_12px_28px_rgba(15,23,42,0.2)] backdrop-blur">
                    <button
                      type="button"
                      disabled={pageIndex <= 0}
                      onClick={() => goToPage(pageIndex - 1)}
                      className="grid h-8 w-8 place-items-center rounded-full bg-white/20 text-white transition hover:bg-white/30 disabled:cursor-not-allowed disabled:opacity-35"
                      aria-label="上一页"
                    >
                      <svg viewBox="0 0 24 24" className="h-[1.125rem] w-[1.125rem]" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="m15 18-6-6 6-6" />
                      </svg>
                    </button>
                    <span className="min-w-[5.5rem] text-center text-sm font-black">
                      {getPageCounterLabel(activePage, pageIndex, pages)}
	                    </span>
                    <button
                      type="button"
                      disabled={pageIndex >= pages.length - 1}
                      onClick={() => goToPage(pageIndex + 1)}
                      className="grid h-8 w-8 place-items-center rounded-full bg-white text-sky-600 transition hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-35"
                      aria-label="下一页"
                    >
                      <svg viewBox="0 0 24 24" className="h-[1.125rem] w-[1.125rem]" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="m9 6 6 6-6 6" />
                      </svg>
                    </button>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="mt-2 grid shrink-0 gap-2 md:grid-cols-3">
              <label
                htmlFor={materialInputId}
                className="flex h-[4.5rem] items-center justify-center gap-3 rounded-[1.05rem] border border-sky-100 bg-white text-slate-900 shadow-[0_12px_28px_rgba(120,149,188,0.1)] transition hover:-translate-y-0.5 hover:bg-sky-50"
              >
                <span className="text-2xl text-blue-500">＋</span>
                <span className="text-base font-black">{pages.length ? "更换资料" : "上传资料"}</span>
              </label>
              <button
                type="button"
                onClick={() => setView("history")}
                className="flex h-[4.5rem] items-center justify-center gap-3 rounded-[1.05rem] border border-sky-100 bg-white text-slate-900 shadow-[0_12px_28px_rgba(120,149,188,0.1)] transition hover:-translate-y-0.5 hover:bg-sky-50"
              >
                <span className="text-2xl text-blue-500">◎</span>
                <span className="text-base font-black">历史记录</span>
              </button>
              <button
                type="button"
                onClick={saveCurrentRecord}
                className="flex h-[4.5rem] items-center justify-center gap-3 rounded-[1.05rem] bg-emerald-500 px-4 text-white shadow-[0_12px_24px_rgba(16,185,129,0.18)] transition hover:-translate-y-0.5 hover:bg-emerald-600"
              >
                <span className="grid h-7 w-7 place-items-center rounded-full bg-white/20 text-base font-black">✓</span>
                <span className="text-base font-black">保存资料</span>
              </button>
            </div>
          </section>

          <aside className="flex min-h-0 flex-col overflow-hidden rounded-[1.35rem] border border-sky-100 bg-[linear-gradient(180deg,#ffffff,#f7fbff)] p-3 shadow-[0_18px_48px_rgba(120,149,188,0.12)]">
            <div className="flex shrink-0 items-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-full bg-[linear-gradient(135deg,#fff7ed,#dbeafe)] text-sm font-black text-slate-700 shadow-inner">
                Mia
              </div>
              <h2 className="text-lg font-black text-slate-950">Mia 陪学</h2>
            </div>

            <div
              ref={conversationScrollRef}
              className="mt-2 min-h-[112px] flex-1 space-y-4 overflow-y-auto rounded-[1.1rem] border border-sky-100 bg-sky-50/80 px-4 py-3"
            >
              {subtitleMessages.length ? null : (
                <div className="flex h-full min-h-[160px] items-center justify-center text-center text-sm font-bold leading-6 text-slate-400">
                  实时语音字幕会显示在这里。等待 RTC / RTS 语音字幕返回中。
                </div>
              )}
              {subtitleMessages.map((message) => {
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

            {isThinking ? (
              <div className="mt-2 shrink-0 rounded-2xl bg-sky-50 px-4 py-2.5 text-sm font-bold text-sky-600">
                Mia 正在分析当前页...
              </div>
            ) : null}
            {error ? (
              <div className="mt-2 shrink-0 rounded-2xl border border-amber-100 bg-amber-50 px-4 py-2.5 text-sm font-bold text-amber-700">
                {error}
              </div>
            ) : null}

            <div className="shrink-0 pt-3">
              <p className="mb-2 text-sm font-black text-slate-800">有不懂的，随时问我</p>
              <div className="space-y-2">
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => {
                      void askCoach(suggestion);
                    }}
                    disabled={!pages.length || isThinking}
                    className="flex w-full items-center justify-between rounded-full border border-sky-100 bg-sky-50/70 px-4 py-2.5 text-left text-sm font-black text-blue-700 transition hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span>{suggestion}</span>
                    <span className="text-xl leading-none text-slate-500">›</span>
                  </button>
                ))}
              </div>

              <div className="mt-3 flex items-center gap-3">
                <button
                  type="button"
                  onClick={toggleVoiceSession}
                  disabled={!pages.length}
                  className={`inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-black text-white shadow-[0_12px_28px_rgba(37,99,235,0.18)] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-45 ${
                    isVoiceSessionActive ? "bg-emerald-500" : "bg-blue-600 hover:bg-blue-500"
                  }`}
                >
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-white/20">
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="9" y="3.5" width="6" height="11" rx="3" />
                      <path d="M7 11.5a5 5 0 0 0 10 0" />
                      <path d="M12 16.5V20" />
                      <path d="M9 20h6" />
                    </svg>
                  </span>
                  {isVoiceSessionActive ? "停止语音" : "实时语音"}
                </button>
                <span className="min-w-0 flex-1 truncate text-xs font-black text-slate-400">
                  {isThinking
                    ? "Mia 回复中"
                    : isVoiceListening
                      ? "正在听"
                      : pages.length
                        ? "点击后连续和 Mia 说话"
                        : "先上传资料"}
                </span>
              </div>
            </div>
          </aside>
        </main>
      </div>
    </div>
  );
}
