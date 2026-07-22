import StudentTasksClient, {
  type StudentTaskCard,
} from "@/components/student/StudentTasksClient";
import type { StoryflowAssignment } from "@/lib/storyflowAssignments";
import { requireServerSession } from "@/lib/serverSession";
import { readStoryflowStore } from "@/lib/storyflowServerStore";
import type {
  StoryflowDocument,
  StoryflowFolder,
  StoryflowStudentTaskDisplayMode,
} from "@/lib/storyflowStore";

const isDisplayUrl = (value?: string | null) =>
  typeof value === "string" &&
  (value.startsWith("data:") ||
    value.startsWith("blob:") ||
    value.startsWith("http://") ||
    value.startsWith("https://"));

const getStoryflowFileProxyUrl = (objectKey?: string | null) =>
  objectKey ? `/api/storyflow/file?key=${encodeURIComponent(objectKey)}` : "";

const getDocumentCoverImageUrl = (document?: StoryflowDocument | null) => {
  if (!document) return "";

  const localImage = document.images?.[0];
  if (isDisplayUrl(localImage)) return localImage || "";
  if (isDisplayUrl(document.thumbnail)) return document.thumbnail || "";

  return getStoryflowFileProxyUrl(
    document.pageObjectKeys?.[0] || document.thumbnailObjectKey || ""
  );
};

const getAssignmentLastStudiedAt = (task: StoryflowAssignment) =>
  Math.max(
    task.shadowSubmission?.completedAt || 0,
    task.speakingSubmission?.completedAt || 0
  );

const getDocumentSortValue = (document?: StoryflowDocument | null) =>
  typeof document?.sortOrder === "number" && Number.isFinite(document.sortOrder)
    ? document.sortOrder
    : document?.updatedAt || document?.createdAt || 0;

function getAccessibleDocumentsByTeacher(
  documents: StoryflowDocument[],
  taskCards: StudentTaskCard[]
) {
  const documentIdsByTeacher = new Map<string, Set<string>>();

  taskCards.forEach((task) => {
    const current = documentIdsByTeacher.get(task.teacherUsername) || new Set<string>();
    current.add(task.documentId);
    documentIdsByTeacher.set(task.teacherUsername, current);
  });

  return Array.from(documentIdsByTeacher.entries()).reduce<Record<string, StoryflowDocument[]>>(
    (result, [teacherUsername, documentIds]) => {
      result[teacherUsername] = documents.filter(
        (item) => item.teacherUsername === teacherUsername && documentIds.has(item.id)
      );
      return result;
    },
    {}
  );
}

function getAccessibleFoldersByTeacher(
  folders: StoryflowFolder[],
  taskCards: StudentTaskCard[]
) {
  const folderIdsByTeacher = new Map<string, Set<string>>();

  taskCards.forEach((task) => {
    if (!task.folderId) return;
    const current = folderIdsByTeacher.get(task.teacherUsername) || new Set<string>();
    current.add(task.folderId);
    folderIdsByTeacher.set(task.teacherUsername, current);
  });

  return Array.from(folderIdsByTeacher.entries()).reduce<Record<string, StoryflowFolder[]>>(
    (result, [teacherUsername, folderIds]) => {
      result[teacherUsername] = folders.filter(
        (item) => item.teacherUsername === teacherUsername && folderIds.has(item.id)
      );
      return result;
    },
    {}
  );
}

function getInitialDisplayMode(
  settings: Array<{
    teacherUsername: string;
    studentTaskDisplayMode: StoryflowStudentTaskDisplayMode;
  }>,
  taskCards: StudentTaskCard[]
): StoryflowStudentTaskDisplayMode {
  const teacherUsername = taskCards[0]?.teacherUsername || "";
  return (
    settings.find((item) => item.teacherUsername === teacherUsername)
      ?.studentTaskDisplayMode || "folderPreview"
  );
}

export default async function StudentTasksPage() {
  const session = await requireServerSession(["student"]);
  const store = await readStoryflowStore();

  const assignments = store.assignments.filter(
    (item) => item.studentUsername === session.username
  );

  const initialTaskCards = assignments.map((task) => {
    const document = store.documents.find(
      (item) =>
        item.teacherUsername === task.teacherUsername && item.id === task.documentId
    );

    return {
      ...task,
      folderId: document?.folderId || null,
      documentSortOrder: getDocumentSortValue(document),
      lastStudiedAt: getAssignmentLastStudiedAt(task),
      coverObjectKey:
        document?.pageObjectKeys?.[0] || document?.thumbnailObjectKey || "",
      coverImageUrl: getDocumentCoverImageUrl(document),
    } satisfies StudentTaskCard;
  });

  return (
    <StudentTasksClient
      session={session}
      initialTaskCards={initialTaskCards}
      initialDocumentsByTeacher={getAccessibleDocumentsByTeacher(
        store.documents,
        initialTaskCards
      )}
      initialFoldersByTeacher={getAccessibleFoldersByTeacher(
        store.folders,
        initialTaskCards
      )}
      initialDisplayMode={getInitialDisplayMode(store.settings, initialTaskCards)}
    />
  );
}
