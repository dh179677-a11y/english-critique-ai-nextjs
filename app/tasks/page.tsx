import StudentTasksClient, {
  type StudentTaskCard,
} from "@/components/student/StudentTasksClient";
import { requireServerSession } from "@/lib/serverSession";
import { readStoryflowStore } from "@/lib/storyflowServerStore";
import type { StoryflowFolder, StoryflowStudentTaskDisplayMode } from "@/lib/storyflowStore";
import { buildStudentTaskListItems } from "./taskListData";

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

  const initialTaskCards = buildStudentTaskListItems(assignments, store.documents);

  return (
    <StudentTasksClient
      initialTaskCards={initialTaskCards}
      initialFoldersByTeacher={getAccessibleFoldersByTeacher(
        store.folders,
        initialTaskCards
      )}
      initialDisplayMode={getInitialDisplayMode(store.settings, initialTaskCards)}
    />
  );
}
