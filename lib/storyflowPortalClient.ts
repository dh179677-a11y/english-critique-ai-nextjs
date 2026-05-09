import type { StoryflowAssignment } from "@/lib/storyflowAssignments";
import type { StoryflowDocument, StoryflowFolder } from "@/lib/storyflowStore";

type StoryflowAction =
  | "bootstrap"
  | "getTeacherLibrary"
  | "getAccessibleDocuments"
  | "getTeacherAssignments"
  | "getStudentAssignments"
  | "getAssignmentById"
  | "saveDocument"
  | "updateDocument"
  | "deleteDocument"
  | "reorderDocuments"
  | "createFolder"
  | "updateFolder"
  | "deleteFolder"
  | "reorderFolders"
  | "publishAssignments"
  | "updateAssignment";

const STORYFLOW_KEY = "ep_storyflow_docs_v1";
const STORYFLOW_FOLDER_KEY = "ep_storyflow_folders_v1";
const STORYFLOW_ASSIGNMENTS_KEY = "ep_storyflow_assignments_v1";
const STORYFLOW_BOOTSTRAP_KEY = "ep_storyflow_server_bootstrapped_v1";

let bootstrapPromise: Promise<void> | null = null;

async function storyflowRequest<T>(
  action: StoryflowAction,
  payload?: Record<string, unknown>
): Promise<T> {
  const response = await fetch("/api/storyflow/store", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, payload }),
  });

  const json = (await response.json()) as {
    ok: boolean;
    data?: T;
    error?: string;
  };

  if (!response.ok || !json.ok) {
    throw new Error(json.error || "Storyflow 请求失败");
  }

  return json.data as T;
}

function readRawJson(key: string) {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clearLegacyStoryflowStorage() {
  if (typeof window === "undefined") return;

  window.localStorage.removeItem(STORYFLOW_KEY);
  window.localStorage.removeItem(STORYFLOW_FOLDER_KEY);
  window.localStorage.removeItem(STORYFLOW_ASSIGNMENTS_KEY);
  window.localStorage.setItem(STORYFLOW_BOOTSTRAP_KEY, "done");
}

export async function ensureStoryflowBootstrap() {
  if (typeof window === "undefined") return;
  if (window.localStorage.getItem(STORYFLOW_BOOTSTRAP_KEY) === "done") return;
  if (bootstrapPromise) return bootstrapPromise;

  bootstrapPromise = (async () => {
    const documents = readRawJson(STORYFLOW_KEY);
    const folders = readRawJson(STORYFLOW_FOLDER_KEY);
    const assignments = readRawJson(STORYFLOW_ASSIGNMENTS_KEY);

    const hasLegacyData =
      (Array.isArray(documents) && documents.length > 0) ||
      (Array.isArray(folders) && folders.length > 0) ||
      (Array.isArray(assignments) && assignments.length > 0);

    if (!hasLegacyData) {
      clearLegacyStoryflowStorage();
      return;
    }

    await storyflowRequest("bootstrap", {
      documents: Array.isArray(documents) ? documents : [],
      folders: Array.isArray(folders) ? folders : [],
      assignments: Array.isArray(assignments) ? assignments : [],
    });

    clearLegacyStoryflowStorage();
  })();

  try {
    await bootstrapPromise;
  } finally {
    bootstrapPromise = null;
  }
}

export async function fetchTeacherStoryflowLibrary(teacherUsername: string) {
  return storyflowRequest<{
    documents: StoryflowDocument[];
    folders: StoryflowFolder[];
  }>("getTeacherLibrary", {
    teacherUsername,
  });
}

export async function fetchAccessibleStoryflowDocuments(teacherUsername: string) {
  return storyflowRequest<StoryflowDocument[]>("getAccessibleDocuments", {
    teacherUsername,
  });
}

export async function fetchTeacherStoryflowAssignments(teacherUsername: string) {
  return storyflowRequest<StoryflowAssignment[]>("getTeacherAssignments", {
    teacherUsername,
  });
}

export async function fetchStudentStoryflowAssignments(studentUsername: string) {
  return storyflowRequest<StoryflowAssignment[]>("getStudentAssignments", {
    studentUsername,
  });
}

export async function fetchStoryflowAssignmentById(assignmentId: string) {
  return storyflowRequest<StoryflowAssignment | null>("getAssignmentById", {
    assignmentId,
  });
}

export async function persistStoryflowDocument(document: StoryflowDocument) {
  return storyflowRequest<StoryflowDocument>("saveDocument", { document });
}

export async function replaceStoryflowDocument(
  teacherUsername: string,
  document: StoryflowDocument
) {
  return storyflowRequest<StoryflowDocument | null>("updateDocument", {
    teacherUsername,
    document,
  });
}

export async function removeStoryflowDocument(teacherUsername: string, documentId: string) {
  return storyflowRequest<boolean>("deleteDocument", {
    teacherUsername,
    documentId,
  });
}

export async function persistStoryflowDocumentOrder(
  teacherUsername: string,
  orderedDocumentIds: string[]
) {
  return storyflowRequest<StoryflowDocument[]>("reorderDocuments", {
    teacherUsername,
    orderedDocumentIds,
  });
}

export async function persistStoryflowFolder(folder: StoryflowFolder) {
  return storyflowRequest<StoryflowFolder>("createFolder", { folder });
}

export async function replaceStoryflowFolder(
  teacherUsername: string,
  folder: StoryflowFolder
) {
  return storyflowRequest<StoryflowFolder | null>("updateFolder", {
    teacherUsername,
    folder,
  });
}

export async function removeStoryflowFolder(teacherUsername: string, folderId: string) {
  return storyflowRequest<boolean>("deleteFolder", {
    teacherUsername,
    folderId,
  });
}

export async function persistStoryflowFolderOrder(
  teacherUsername: string,
  orderedFolderIds: string[]
) {
  return storyflowRequest<StoryflowFolder[]>("reorderFolders", {
    teacherUsername,
    orderedFolderIds,
  });
}

export async function persistPublishedStoryflowAssignments(assignments: StoryflowAssignment[]) {
  return storyflowRequest<StoryflowAssignment[]>("publishAssignments", {
    assignments,
  });
}

export async function replaceStoryflowAssignment(assignment: StoryflowAssignment) {
  return storyflowRequest<StoryflowAssignment | null>("updateAssignment", {
    assignment,
  });
}
