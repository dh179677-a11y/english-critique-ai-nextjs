import type { StoryflowAssignment } from "../../lib/storyflowAssignments";
import type { StoryflowDocument } from "../../lib/storyflowStore";

export interface StudentTaskListItem {
  id: string;
  teacherUsername: string;
  teacherDisplayName: string;
  documentTitle: string;
  createdAt: number;
  folderId: string | null;
  documentSortOrder: number;
  lastStudiedAt: number;
  coverObjectKey: string;
  coverImageUrl: string;
}

const isRemoteDisplayUrl = (value?: string | null) =>
  typeof value === "string" &&
  (value.startsWith("http://") || value.startsWith("https://"));

const getStoryflowFileProxyUrl = (objectKey?: string | null) =>
  objectKey ? `/api/storyflow/file?key=${encodeURIComponent(objectKey)}` : "";

const getLastStudiedAt = (task: StoryflowAssignment) =>
  Math.max(
    task.shadowSubmission?.completedAt || 0,
    task.speakingSubmission?.completedAt || 0
  );

const getDocumentSortValue = (document?: StoryflowDocument) =>
  typeof document?.sortOrder === "number" && Number.isFinite(document.sortOrder)
    ? document.sortOrder
    : document?.updatedAt || document?.createdAt || 0;

const getCover = (document?: StoryflowDocument) => {
  const objectKey =
    document?.pageObjectKeys?.[0] || document?.thumbnailObjectKey || "";

  if (objectKey) {
    return {
      coverObjectKey: objectKey,
      coverImageUrl: getStoryflowFileProxyUrl(objectKey),
    };
  }

  const remoteUrl = isRemoteDisplayUrl(document?.thumbnail)
    ? document?.thumbnail || ""
    : isRemoteDisplayUrl(document?.images?.[0])
      ? document?.images?.[0] || ""
      : "";

  return { coverObjectKey: "", coverImageUrl: remoteUrl };
};

export function buildStudentTaskListItems(
  assignments: StoryflowAssignment[],
  documents: StoryflowDocument[]
): StudentTaskListItem[] {
  const documentsByKey = new Map(
    documents.map((document) => [
      `${document.teacherUsername}:${document.id}`,
      document,
    ])
  );

  return assignments.map((task) => {
    const document = documentsByKey.get(
      `${task.teacherUsername}:${task.documentId}`
    );

    return {
      id: task.id,
      teacherUsername: task.teacherUsername,
      teacherDisplayName: task.teacherDisplayName,
      documentTitle: task.documentTitle,
      createdAt: task.createdAt,
      folderId: document?.folderId || null,
      documentSortOrder: getDocumentSortValue(document),
      lastStudiedAt: getLastStudiedAt(task),
      ...getCover(document),
    };
  });
}
