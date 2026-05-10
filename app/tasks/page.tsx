import StudentTasksClient, {
  type StudentTaskCard,
} from "@/components/student/StudentTasksClient";
import { requireServerSession } from "@/lib/serverSession";
import { readStoryflowStore } from "@/lib/storyflowServerStore";
import type { StoryflowDocument } from "@/lib/storyflowStore";

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
      coverObjectKey:
        document?.pageObjectKeys?.[0] || document?.thumbnailObjectKey || "",
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
    />
  );
}
