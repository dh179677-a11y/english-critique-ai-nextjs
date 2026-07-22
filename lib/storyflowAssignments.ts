import type {
  StoryflowDocument,
  StoryflowSpeakingPracticeRecord,
  StoryflowVoiceSubtitleRecord,
} from "@/lib/storyflowStore";
import { normalizeStoryflowVoiceSubtitles } from "@/lib/storyflowStore";
import {
  ensureStoryflowBootstrap,
  fetchStoryflowAssignmentById,
  fetchStudentStoryflowAssignments,
  fetchTeacherStoryflowAssignments,
  persistPublishedStoryflowAssignments,
  replaceStoryflowAssignment,
} from "@/lib/storyflowPortalClient";
import type { AnalysisResult } from "@/types";

export interface StoryflowShadowSubmission {
  completedAt: number;
  audioDataUrl: string;
  audioMimeType: string;
  audioFileName: string;
  durationSec: number;
  clipCount: number;
  studentAssessment?: AnalysisResult | null;
  teacherAssessment?: AnalysisResult | null;
  teacherNote?: string;
  voiceSubtitles?: StoryflowVoiceSubtitleRecord[];
}

export interface StoryflowSpeakingSubmission {
  completedAt: number;
  latestPracticeRecord?: StoryflowSpeakingPracticeRecord | null;
  studentAssessment?: AnalysisResult | null;
  teacherAssessment?: AnalysisResult | null;
  teacherNote?: string;
}

export const STORYFLOW_ASSIGNMENT_MODULES = [
  "animation",
  "intensive",
  "shadow",
  "speaking",
  "assessment",
] as const;

export type StoryflowAssignmentModule = (typeof STORYFLOW_ASSIGNMENT_MODULES)[number];

export const DEFAULT_STORYFLOW_ASSIGNMENT_MODULES: StoryflowAssignmentModule[] = [
  ...STORYFLOW_ASSIGNMENT_MODULES,
];

const STORYFLOW_ASSIGNMENT_MODULE_SET = new Set<string>(STORYFLOW_ASSIGNMENT_MODULES);

export interface StoryflowAssignment {
  id: string;
  teacherUsername: string;
  teacherDisplayName: string;
  studentUsername: string;
  studentDisplayName: string;
  documentId: string;
  documentTitle: string;
  createdAt: number;
  updatedAt: number;
  enabledModules: StoryflowAssignmentModule[];
  shadowSubmission?: StoryflowShadowSubmission | null;
  speakingSubmission?: StoryflowSpeakingSubmission | null;
}

const STORYFLOW_ASSIGNMENTS_KEY = "ep_storyflow_assignments_v1";
const STORYFLOW_ASSIGNMENTS_CACHE_TTL_MS = 60_000;

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

const normalizeText = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

const normalizeCriteria = (value: unknown) => {
  if (!value || typeof value !== "object") {
    return { score: 0, comment: "" };
  }
  const item = value as { score?: unknown; comment?: unknown };
  return {
    score: toFiniteNumber(item.score, 0),
    comment: normalizeText(item.comment),
  };
};

const normalizeAnalysisResult = (value: unknown): AnalysisResult | null => {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<AnalysisResult>;
  return {
    studentName: normalizeText(item.studentName),
    bookName: normalizeText(item.bookName),
    homeworkType: normalizeText(item.homeworkType),
    tutorName: normalizeText(item.tutorName),
    fluency: normalizeCriteria(item.fluency),
    pronunciation: normalizeCriteria(item.pronunciation),
    intonation: normalizeCriteria(item.intonation),
    vocabulary: normalizeCriteria(item.vocabulary),
    emotion: normalizeCriteria(item.emotion),
    overallComment: normalizeText(item.overallComment),
    simpleComment: normalizeText(item.simpleComment),
    suggestions: Array.isArray(item.suggestions)
      ? item.suggestions.map((suggestion) => normalizeText(suggestion)).filter(Boolean)
      : [],
    grammarSummary: normalizeText(item.grammarSummary),
  };
};

const normalizeShadowSubmission = (value: unknown): StoryflowShadowSubmission | null => {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<StoryflowShadowSubmission>;
  const audioDataUrl = normalizeText(item.audioDataUrl);
  const completedAt = toFiniteNumber(item.completedAt, 0);
  if (!audioDataUrl || !completedAt) return null;
  return {
    completedAt,
    audioDataUrl,
    audioMimeType: normalizeText(item.audioMimeType) || "audio/wav",
    audioFileName: normalizeText(item.audioFileName) || "shadow-reading.wav",
    durationSec: toFiniteNumber(item.durationSec, 0),
    clipCount: toFiniteNumber(item.clipCount, 0),
    studentAssessment: normalizeAnalysisResult(item.studentAssessment),
    teacherAssessment: normalizeAnalysisResult(item.teacherAssessment),
    teacherNote: normalizeText(item.teacherNote),
    voiceSubtitles: normalizeStoryflowVoiceSubtitles(item.voiceSubtitles),
  };
};

const normalizePracticeTextEntries = (
  value: unknown
): StoryflowSpeakingPracticeRecord["promptViewedTexts"] => {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const current = item as { pageIndex?: unknown; text?: unknown };
      const pageIndex = toFiniteNumber(current.pageIndex, -1);
      const text = normalizeText(current.text);
      if (pageIndex < 0 || !text) return null;
      return { pageIndex, text };
    })
    .filter(
      (item): item is StoryflowSpeakingPracticeRecord["promptViewedTexts"][number] =>
        Boolean(item)
    );
};

const normalizeSpeakingPracticeRecord = (
  value: unknown
): StoryflowSpeakingPracticeRecord | null => {
  if (!value || typeof value !== "object") return null;
  const current = value as Partial<StoryflowSpeakingPracticeRecord>;
  const id = normalizeText(current.id);
  if (!id) return null;

  return {
    id,
    createdAt: toFiniteNumber(current.createdAt, Date.now()),
    durationSec: Math.max(0, toFiniteNumber(current.durationSec, 0)),
    promptRevealCount: Math.max(0, toFiniteNumber(current.promptRevealCount, 0)),
    originalRevealCount: Math.max(0, toFiniteNumber(current.originalRevealCount, 0)),
    totalPages: Math.max(0, toFiniteNumber(current.totalPages, 0)),
    practicedPages: Math.max(0, toFiniteNumber(current.practicedPages, 0)),
    score: Math.max(0, Math.min(100, toFiniteNumber(current.score, 0))),
    ratingLabel: normalizeText(current.ratingLabel),
    promptViewedTexts: normalizePracticeTextEntries(current.promptViewedTexts),
    originalViewedTexts: normalizePracticeTextEntries(current.originalViewedTexts),
    voiceSubtitles: normalizeStoryflowVoiceSubtitles(current.voiceSubtitles),
  };
};

const normalizeSpeakingSubmission = (value: unknown): StoryflowSpeakingSubmission | null => {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<StoryflowSpeakingSubmission>;
  const completedAt = toFiniteNumber(item.completedAt, 0);
  if (!completedAt) return null;

  return {
    completedAt,
    latestPracticeRecord: normalizeSpeakingPracticeRecord(item.latestPracticeRecord),
    studentAssessment: normalizeAnalysisResult(item.studentAssessment),
    teacherAssessment: normalizeAnalysisResult(item.teacherAssessment),
    teacherNote: normalizeText(item.teacherNote),
  };
};

const normalizeEnabledModules = (value: unknown): StoryflowAssignmentModule[] => {
  if (!Array.isArray(value)) {
    return DEFAULT_STORYFLOW_ASSIGNMENT_MODULES;
  }

  const modules = value
    .map((item) => normalizeText(item))
    .filter((item): item is StoryflowAssignmentModule =>
      STORYFLOW_ASSIGNMENT_MODULE_SET.has(item)
    )
    .filter((item, index, collection) => collection.indexOf(item) === index);

  return modules.length ? modules : DEFAULT_STORYFLOW_ASSIGNMENT_MODULES;
};

export const normalizeAssignment = (value: unknown): StoryflowAssignment | null => {
  if (!value || typeof value !== "object") return null;

  const item = value as Partial<StoryflowAssignment>;
  const id = normalizeText(item.id);
  const teacherUsername = normalizeText(item.teacherUsername);
  const teacherDisplayName = normalizeText(item.teacherDisplayName);
  const studentUsername = normalizeText(item.studentUsername);
  const studentDisplayName = normalizeText(item.studentDisplayName);
  const documentId = normalizeText(item.documentId);
  const documentTitle = normalizeText(item.documentTitle);
  const createdAt = toFiniteNumber(item.createdAt, Date.now());
  const updatedAt = toFiniteNumber(item.updatedAt, createdAt);
  const shadowSubmission = normalizeShadowSubmission(item.shadowSubmission);
  const speakingSubmission = normalizeSpeakingSubmission(item.speakingSubmission);
  const enabledModules = normalizeEnabledModules(item.enabledModules);

  if (!id || !teacherUsername || !studentUsername || !documentId || !documentTitle) {
    return null;
  }

  return {
    id,
    teacherUsername,
    teacherDisplayName: teacherDisplayName || teacherUsername,
    studentUsername,
    studentDisplayName: studentDisplayName || studentUsername,
    documentId,
    documentTitle,
    createdAt,
    updatedAt,
    enabledModules,
    shadowSubmission,
    speakingSubmission,
  };
};

let cachedAssignments: StoryflowAssignment[] = [];
let persistQueue: Promise<void> = Promise.resolve();
const hydratedStudentAssignmentsAt = new Map<string, number>();
const hydratedAssignmentByIdAt = new Map<string, number>();
const inFlightStudentAssignmentRequests = new Map<
  string,
  Promise<StoryflowAssignment[]>
>();
const inFlightAssignmentByIdRequests = new Map<
  string,
  Promise<StoryflowAssignment | null>
>();

const normalizeAssignments = (assignments: StoryflowAssignment[]) =>
  assignments
    .map((item) => normalizeAssignment(item))
    .filter((item): item is StoryflowAssignment => Boolean(item))
    .sort((left, right) => right.updatedAt - left.updatedAt);

const setAssignmentsCache = (assignments: StoryflowAssignment[]) => {
  cachedAssignments = normalizeAssignments(assignments);
};

const hasFreshStudentAssignments = (studentUsername: string) => {
  const lastHydratedAt = hydratedStudentAssignmentsAt.get(studentUsername) || 0;
  return (
    Date.now() - lastHydratedAt < STORYFLOW_ASSIGNMENTS_CACHE_TTL_MS &&
    cachedAssignments.some((item) => item.studentUsername === studentUsername)
  );
};

const hasFreshAssignmentById = (assignmentId: string) => {
  const lastHydratedAt = hydratedAssignmentByIdAt.get(assignmentId) || 0;
  return (
    Date.now() - lastHydratedAt < STORYFLOW_ASSIGNMENTS_CACHE_TTL_MS &&
    cachedAssignments.some((item) => item.id === assignmentId)
  );
};

const queuePersist = (task: () => Promise<void>) => {
  const run = persistQueue.catch(() => undefined).then(task);
  persistQueue = run.catch((error) => {
    console.error("Failed to persist storyflow assignments:", error);
  });
  return run;
};

export async function hydrateTeacherStoryflowAssignments(teacherUsername: string) {
  const normalized = teacherUsername.trim();
  if (!normalized) return [];

  await ensureStoryflowBootstrap();
  const assignments = await fetchTeacherStoryflowAssignments(normalized);
  setAssignmentsCache([
    ...cachedAssignments.filter((item) => item.teacherUsername !== normalized),
    ...assignments,
  ]);
  return assignments;
}

export async function hydrateStudentStoryflowAssignments(studentUsername: string) {
  const normalized = studentUsername.trim();
  if (!normalized) return [];

  if (hasFreshStudentAssignments(normalized)) {
    return getStudentStoryflowAssignments(normalized);
  }

  const inFlightRequest = inFlightStudentAssignmentRequests.get(normalized);
  if (inFlightRequest) {
    return inFlightRequest;
  }

  const request = ensureStoryflowBootstrap()
    .then(() => fetchStudentStoryflowAssignments(normalized))
    .then((assignments) => {
      setAssignmentsCache([
        ...cachedAssignments.filter((item) => item.studentUsername !== normalized),
        ...assignments,
      ]);
      hydratedStudentAssignmentsAt.set(normalized, Date.now());
      assignments.forEach((item) => {
        hydratedAssignmentByIdAt.set(item.id, Date.now());
      });
      return assignments;
    })
    .finally(() => {
      inFlightStudentAssignmentRequests.delete(normalized);
    });

  inFlightStudentAssignmentRequests.set(normalized, request);
  return request;
}

export async function hydrateStoryflowAssignmentById(assignmentId: string) {
  const normalized = assignmentId.trim();
  if (!normalized) return null;

  if (hasFreshAssignmentById(normalized)) {
    return getStoryflowAssignmentById(normalized);
  }

  const inFlightRequest = inFlightAssignmentByIdRequests.get(normalized);
  if (inFlightRequest) {
    return inFlightRequest;
  }

  const request = ensureStoryflowBootstrap()
    .then(() => fetchStoryflowAssignmentById(normalized))
    .then((assignment) => {
      if (!assignment) {
        hydratedAssignmentByIdAt.set(normalized, Date.now());
        return null;
      }

      setAssignmentsCache([
        assignment,
        ...cachedAssignments.filter((item) => item.id !== assignment.id),
      ]);
      hydratedAssignmentByIdAt.set(normalized, Date.now());
      hydratedStudentAssignmentsAt.set(assignment.studentUsername, Date.now());
      return assignment;
    })
    .finally(() => {
      inFlightAssignmentByIdRequests.delete(normalized);
    });

  inFlightAssignmentByIdRequests.set(normalized, request);
  return request;
}

export const getTeacherStoryflowAssignments = (teacherUsername: string) => {
  const normalized = teacherUsername.trim();
  if (!normalized) return [];
  return cachedAssignments.filter((item) => item.teacherUsername === normalized);
};

export const getStudentStoryflowAssignments = (studentUsername: string) => {
  const normalized = studentUsername.trim();
  if (!normalized) return [];
  return cachedAssignments.filter((item) => item.studentUsername === normalized);
};

export const getStoryflowAssignmentById = (assignmentId: string) => {
  const normalized = assignmentId.trim();
  if (!normalized) return null;
  return cachedAssignments.find((item) => item.id === normalized) || null;
};

export const primeStudentStoryflowAssignments = (
  studentUsername: string,
  assignments: StoryflowAssignment[]
) => {
  const normalized = studentUsername.trim();
  if (!normalized) return [];

  setAssignmentsCache([
    ...cachedAssignments.filter((item) => item.studentUsername !== normalized),
    ...assignments,
  ]);
  hydratedStudentAssignmentsAt.set(normalized, Date.now());
  assignments.forEach((item) => {
    hydratedAssignmentByIdAt.set(item.id, Date.now());
  });
  return getStudentStoryflowAssignments(normalized);
};

export const publishStoryflowAssignments = async (
  teacherUsername: string,
  teacherDisplayName: string,
  document: StoryflowDocument,
  students: Array<{
    username: string;
    displayName: string;
  }>,
  enabledModules: StoryflowAssignmentModule[] = DEFAULT_STORYFLOW_ASSIGNMENT_MODULES
) => {
  const normalizedTeacher = teacherUsername.trim();
  if (!normalizedTeacher || !document?.id || !students.length) {
    return [];
  }

  const timestamp = Date.now();
  const normalizedEnabledModules = normalizeEnabledModules(enabledModules);
  const current = cachedAssignments.filter(
    (item) =>
      !students.some(
        (student) =>
          item.teacherUsername === normalizedTeacher &&
          item.studentUsername === student.username &&
          item.documentId === document.id
      )
  );

  const created = students.map<StoryflowAssignment>((student, index) => ({
    id: `story_task_${timestamp}_${index}_${Math.random().toString(36).slice(2, 8)}`,
    teacherUsername: normalizedTeacher,
    teacherDisplayName: teacherDisplayName.trim() || normalizedTeacher,
    studentUsername: student.username.trim(),
    studentDisplayName: student.displayName.trim() || student.username.trim(),
    documentId: document.id,
    documentTitle: document.analysis.title || document.sourceName || "图文导学任务",
    createdAt: timestamp,
    updatedAt: timestamp,
    enabledModules: normalizedEnabledModules,
  }));

  setAssignmentsCache([...created, ...current]);
  await queuePersist(async () => {
    await persistPublishedStoryflowAssignments(created);
  });
  return created;
};

export const updateStoryflowAssignment = (
  assignmentId: string,
  updater: (assignment: StoryflowAssignment) => StoryflowAssignment
) => {
  const normalized = assignmentId.trim();
  if (!normalized) return null;

  const current = cachedAssignments;
  let updatedAssignment: StoryflowAssignment | null = null;
  const next = current.map((item) => {
    if (item.id !== normalized) return item;
    const updated = updater(item);
    updatedAssignment = {
      ...updated,
      id: item.id,
      teacherUsername: item.teacherUsername,
      studentUsername: item.studentUsername,
      documentId: item.documentId,
      createdAt: item.createdAt,
      updatedAt: Date.now(),
    };
    return updatedAssignment;
  });

  setAssignmentsCache(next);
  if (updatedAssignment) {
    void queuePersist(async () => {
      await replaceStoryflowAssignment(updatedAssignment as StoryflowAssignment);
    });
  }
  return updatedAssignment;
};
