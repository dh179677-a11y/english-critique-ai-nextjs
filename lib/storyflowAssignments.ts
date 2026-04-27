import type { StoryflowDocument } from "@/lib/storyflowStore";
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
}

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
  shadowSubmission?: StoryflowShadowSubmission | null;
}

const STORYFLOW_ASSIGNMENTS_KEY = "ep_storyflow_assignments_v1";

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
  };
};

const normalizeAssignment = (value: unknown): StoryflowAssignment | null => {
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
    shadowSubmission,
  };
};

const readAssignments = (): StoryflowAssignment[] => {
  const raw = readJson<unknown[]>(STORYFLOW_ASSIGNMENTS_KEY, []);
  if (!Array.isArray(raw)) return [];

  return raw
    .map((item) => normalizeAssignment(item))
    .filter((item): item is StoryflowAssignment => Boolean(item))
    .sort((left, right) => right.updatedAt - left.updatedAt);
};

const writeAssignments = (assignments: StoryflowAssignment[]) => {
  writeJson(STORYFLOW_ASSIGNMENTS_KEY, assignments);
};

export const getTeacherStoryflowAssignments = (teacherUsername: string) => {
  const normalized = teacherUsername.trim();
  if (!normalized) return [];
  return readAssignments().filter((item) => item.teacherUsername === normalized);
};

export const getStudentStoryflowAssignments = (studentUsername: string) => {
  const normalized = studentUsername.trim();
  if (!normalized) return [];
  return readAssignments().filter((item) => item.studentUsername === normalized);
};

export const getStoryflowAssignmentById = (assignmentId: string) => {
  const normalized = assignmentId.trim();
  if (!normalized) return null;
  return readAssignments().find((item) => item.id === normalized) || null;
};

export const publishStoryflowAssignments = (
  teacherUsername: string,
  teacherDisplayName: string,
  document: StoryflowDocument,
  students: Array<{
    username: string;
    displayName: string;
  }>
) => {
  const normalizedTeacher = teacherUsername.trim();
  if (!normalizedTeacher || !document?.id || !students.length) {
    return [];
  }

  const timestamp = Date.now();
  const current = readAssignments().filter(
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
  }));

  writeAssignments([...created, ...current]);
  return created;
};

export const updateStoryflowAssignment = (
  assignmentId: string,
  updater: (assignment: StoryflowAssignment) => StoryflowAssignment
) => {
  const normalized = assignmentId.trim();
  if (!normalized) return null;

  const current = readAssignments();
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

  writeAssignments(next);
  return updatedAssignment;
};
