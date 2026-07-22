import { NextRequest, NextResponse } from "next/server";

import { readPortalStore } from "@/lib/portalStore";
import {
  readStoryflowStore,
  updateStoryflowStore,
} from "@/lib/storyflowServerStore";
import { getSessionFromRequest } from "@/lib/sessionCookie";
import {
  normalizeAssignment,
  type StoryflowAssignment,
} from "@/lib/storyflowAssignments";
import {
  normalizeStoryflowDocument,
  normalizeStoryflowFolder,
  normalizeStoryflowTeacherSettings,
  type StoryflowDocument,
  type StoryflowFolder,
  type StoryflowTeacherSettings,
} from "@/lib/storyflowStore";

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
  | "updateTeacherSettings"
  | "publishAssignments"
  | "updateAssignment";

interface StoryflowRequestBody {
  action: StoryflowAction;
  payload?: Record<string, unknown>;
}

function ok<T>(data: T) {
  return NextResponse.json({ ok: true, data });
}

function fail(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function ensureTeacherSession(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session) {
    return { error: fail("未登录", 401) };
  }
  if (session.role !== "teacher") {
    return { error: fail("无权执行该操作", 403) };
  }
  return { session };
}

function ensureStudentSession(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session) {
    return { error: fail("未登录", 401) };
  }
  if (session.role !== "student") {
    return { error: fail("无权执行该操作", 403) };
  }
  return { session };
}

function getDocSortValue(item: StoryflowDocument) {
  return typeof item.sortOrder === "number" && Number.isFinite(item.sortOrder)
    ? item.sortOrder
    : item.updatedAt || item.createdAt;
}

function getFolderSortValue(item: StoryflowFolder) {
  return typeof item.sortOrder === "number" && Number.isFinite(item.sortOrder)
    ? item.sortOrder
    : item.createdAt;
}

function getTeacherDocuments(store: Awaited<ReturnType<typeof readStoryflowStore>>, teacherUsername: string) {
  return store.documents
    .filter((item) => item.teacherUsername === teacherUsername)
    .sort((left, right) => {
      const diff = getDocSortValue(right) - getDocSortValue(left);
      return diff !== 0 ? diff : right.createdAt - left.createdAt;
    });
}

function getTeacherFolders(store: Awaited<ReturnType<typeof readStoryflowStore>>, teacherUsername: string) {
  return store.folders
    .filter((item) => item.teacherUsername === teacherUsername)
    .sort((left, right) => {
      const diff = getFolderSortValue(right) - getFolderSortValue(left);
      if (diff !== 0) return diff;
      return left.name.localeCompare(right.name, undefined, {
        sensitivity: "base",
        numeric: true,
      });
    });
}

function getTeacherSettings(
  store: Awaited<ReturnType<typeof readStoryflowStore>>,
  teacherUsername: string
): StoryflowTeacherSettings {
  return (
    store.settings.find((item) => item.teacherUsername === teacherUsername) ||
    ({
      teacherUsername,
      studentTaskDisplayMode: "folderPreview",
      updatedAt: Date.now(),
    } satisfies StoryflowTeacherSettings)
  );
}

function mergeByIdPreferNewer<T extends { id: string; updatedAt?: number; createdAt: number }>(
  current: T[],
  incoming: T[]
) {
  const map = new Map(current.map((item) => [item.id, item]));

  for (const item of incoming) {
    const existing = map.get(item.id);
    if (!existing) {
      map.set(item.id, item);
      continue;
    }

    const incomingStamp = item.updatedAt || item.createdAt;
    const existingStamp = existing.updatedAt || existing.createdAt;
    if (incomingStamp >= existingStamp) {
      map.set(item.id, item);
    }
  }

  return Array.from(map.values());
}

function mergeFoldersPreferIncoming(current: StoryflowFolder[], incoming: StoryflowFolder[]) {
  const map = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) {
    map.set(item.id, item);
  }
  return Array.from(map.values());
}

async function bootstrapStoryflow(
  request: NextRequest,
  payload: Record<string, unknown> | undefined
) {
  const session = getSessionFromRequest(request);
  if (!session) {
    return fail("未登录", 401);
  }

  const rawDocuments = Array.isArray(payload?.documents) ? payload.documents : [];
  const rawFolders = Array.isArray(payload?.folders) ? payload.folders : [];
  const rawAssignments = Array.isArray(payload?.assignments) ? payload.assignments : [];

  const documents = rawDocuments
    .map((item, index) => normalizeStoryflowDocument(item, rawDocuments.length - index))
    .filter((item): item is StoryflowDocument => Boolean(item));
  const folders = rawFolders
    .map((item, index) => normalizeStoryflowFolder(item, rawFolders.length - index))
    .filter((item): item is StoryflowFolder => Boolean(item));
  const assignments = rawAssignments
    .map((item) => normalizeAssignment(item))
    .filter((item): item is StoryflowAssignment => Boolean(item));

  const allowedDocuments =
    session.role === "teacher"
      ? documents.filter((item) => item.teacherUsername === session.username)
      : [];
  const allowedFolders =
    session.role === "teacher"
      ? folders.filter((item) => item.teacherUsername === session.username)
      : [];
  const allowedAssignments =
    session.role === "teacher"
      ? assignments.filter((item) => item.teacherUsername === session.username)
      : assignments.filter((item) => item.studentUsername === session.username);

  await updateStoryflowStore((current) => ({
    documents: mergeByIdPreferNewer(current.documents, allowedDocuments),
    folders: mergeFoldersPreferIncoming(current.folders, allowedFolders),
    settings: current.settings,
    assignments: mergeByIdPreferNewer(current.assignments, allowedAssignments),
  }));

  return ok({ migrated: true });
}

async function getTeacherLibrary(request: NextRequest, payload: Record<string, unknown> | undefined) {
  const auth = ensureTeacherSession(request);
  if (auth.error) return auth.error;

  const teacherUsername = normalizeText(payload?.teacherUsername) || auth.session.username;
  if (teacherUsername !== auth.session.username) {
    return fail("无权访问该老师资料库", 403);
  }

  const store = await readStoryflowStore();
  return ok({
    documents: getTeacherDocuments(store, teacherUsername),
    folders: getTeacherFolders(store, teacherUsername),
    settings: getTeacherSettings(store, teacherUsername),
  });
}

async function getAccessibleDocumentsAction(
  request: NextRequest,
  payload: Record<string, unknown> | undefined
) {
  const session = getSessionFromRequest(request);
  if (!session) {
    return fail("未登录", 401);
  }

  const teacherUsername = normalizeText(payload?.teacherUsername);
  if (!teacherUsername) {
    return fail("老师账号不能为空");
  }

  const store = await readStoryflowStore();

  if (session.role === "teacher") {
    if (teacherUsername !== session.username) {
      return fail("无权访问该老师资料", 403);
    }
    return ok(getTeacherDocuments(store, teacherUsername));
  }

  const assignedDocumentIds = new Set(
    store.assignments
      .filter(
        (item) =>
          item.studentUsername === session.username &&
          item.teacherUsername === teacherUsername
      )
      .map((item) => item.documentId)
  );

  return ok(
    getTeacherDocuments(store, teacherUsername).filter((item) =>
      assignedDocumentIds.has(item.id)
    )
  );
}

async function getTeacherAssignmentsAction(
  request: NextRequest,
  payload: Record<string, unknown> | undefined
) {
  const auth = ensureTeacherSession(request);
  if (auth.error) return auth.error;

  const teacherUsername = normalizeText(payload?.teacherUsername) || auth.session.username;
  if (teacherUsername !== auth.session.username) {
    return fail("无权访问该老师任务", 403);
  }

  const store = await readStoryflowStore();
  return ok(
    store.assignments.filter((item) => item.teacherUsername === teacherUsername)
  );
}

async function getStudentAssignmentsAction(
  request: NextRequest,
  payload: Record<string, unknown> | undefined
) {
  const auth = ensureStudentSession(request);
  if (auth.error) return auth.error;

  const studentUsername = normalizeText(payload?.studentUsername) || auth.session.username;
  if (studentUsername !== auth.session.username) {
    return fail("无权访问该学生任务", 403);
  }

  const store = await readStoryflowStore();
  return ok(
    store.assignments.filter((item) => item.studentUsername === studentUsername)
  );
}

async function getAssignmentByIdAction(
  request: NextRequest,
  payload: Record<string, unknown> | undefined
) {
  const session = getSessionFromRequest(request);
  if (!session) {
    return fail("未登录", 401);
  }

  const assignmentId = normalizeText(payload?.assignmentId);
  if (!assignmentId) {
    return fail("任务编号不能为空");
  }

  const store = await readStoryflowStore();
  const assignment = store.assignments.find((item) => item.id === assignmentId) || null;
  if (!assignment) {
    return ok(null);
  }

  const allowed =
    (session.role === "teacher" && assignment.teacherUsername === session.username) ||
    (session.role === "student" && assignment.studentUsername === session.username);
  if (!allowed) {
    return fail("无权查看该任务", 403);
  }

  return ok(assignment);
}

async function saveDocumentAction(
  request: NextRequest,
  payload: Record<string, unknown> | undefined
) {
  const auth = ensureTeacherSession(request);
  if (auth.error) return auth.error;

  const document = normalizeStoryflowDocument(payload?.document);
  if (!document || document.teacherUsername !== auth.session.username) {
    return fail("资料数据无效");
  }

  await updateStoryflowStore((current) => ({
    ...current,
    documents: [document, ...current.documents.filter((item) => item.id !== document.id)],
  }));

  return ok(document);
}

async function updateDocumentAction(
  request: NextRequest,
  payload: Record<string, unknown> | undefined
) {
  const auth = ensureTeacherSession(request);
  if (auth.error) return auth.error;

  const teacherUsername = normalizeText(payload?.teacherUsername) || auth.session.username;
  const document = normalizeStoryflowDocument(payload?.document);
  if (!document || teacherUsername !== auth.session.username || document.teacherUsername !== teacherUsername) {
    return fail("资料数据无效");
  }

  let updatedDocument: StoryflowDocument | null = null;
  await updateStoryflowStore((current) => ({
    ...current,
    documents: current.documents.map((item) => {
      if (item.teacherUsername !== teacherUsername || item.id !== document.id) {
        return item;
      }
      updatedDocument = document;
      return document;
    }),
  }));

  return ok(updatedDocument);
}

async function deleteDocumentAction(
  request: NextRequest,
  payload: Record<string, unknown> | undefined
) {
  const auth = ensureTeacherSession(request);
  if (auth.error) return auth.error;

  const teacherUsername = normalizeText(payload?.teacherUsername) || auth.session.username;
  const documentId = normalizeText(payload?.documentId);
  if (!documentId || teacherUsername !== auth.session.username) {
    return fail("资料编号不能为空");
  }

  await updateStoryflowStore((current) => ({
    ...current,
    documents: current.documents.filter(
      (item) => !(item.teacherUsername === teacherUsername && item.id === documentId)
    ),
  }));

  return ok(true);
}

async function reorderDocumentsAction(
  request: NextRequest,
  payload: Record<string, unknown> | undefined
) {
  const auth = ensureTeacherSession(request);
  if (auth.error) return auth.error;

  const teacherUsername = normalizeText(payload?.teacherUsername) || auth.session.username;
  const orderedDocumentIds = Array.isArray(payload?.orderedDocumentIds)
    ? payload.orderedDocumentIds.map((item) => normalizeText(item)).filter(Boolean)
    : [];
  if (teacherUsername !== auth.session.username) {
    return fail("无权修改该老师资料顺序", 403);
  }

  const next = await updateStoryflowStore((current) => {
    const teacherDocs = getTeacherDocuments(current, teacherUsername);
    const teacherDocIds = new Set(teacherDocs.map((item) => item.id));
    const preferredOrder = orderedDocumentIds.filter((id) => teacherDocIds.has(id));
    const remainingIds = teacherDocs
      .map((item) => item.id)
      .filter((id) => !preferredOrder.includes(id));
    const nextOrder = [...preferredOrder, ...remainingIds];
    const baseSortOrder = Date.now() + nextOrder.length;
    const sortOrderById = new Map(
      nextOrder.map((id, index) => [id, baseSortOrder - index] as const)
    );

    return {
      ...current,
      documents: current.documents.map((item) =>
        item.teacherUsername === teacherUsername && sortOrderById.has(item.id)
          ? {
              ...item,
              sortOrder: sortOrderById.get(item.id),
              updatedAt: item.updatedAt || item.createdAt,
            }
          : item
      ),
    };
  });

  return ok(getTeacherDocuments(next, teacherUsername));
}

async function createFolderAction(
  request: NextRequest,
  payload: Record<string, unknown> | undefined
) {
  const auth = ensureTeacherSession(request);
  if (auth.error) return auth.error;

  const folder = normalizeStoryflowFolder(payload?.folder);
  if (!folder || folder.teacherUsername !== auth.session.username) {
    return fail("文件夹数据无效");
  }

  await updateStoryflowStore((current) => ({
    ...current,
    folders: [folder, ...current.folders.filter((item) => item.id !== folder.id)],
  }));

  return ok(folder);
}

async function updateFolderAction(
  request: NextRequest,
  payload: Record<string, unknown> | undefined
) {
  const auth = ensureTeacherSession(request);
  if (auth.error) return auth.error;

  const teacherUsername = normalizeText(payload?.teacherUsername) || auth.session.username;
  const folder = normalizeStoryflowFolder(payload?.folder);
  if (!folder || teacherUsername !== auth.session.username || folder.teacherUsername !== teacherUsername) {
    return fail("文件夹数据无效");
  }

  let updatedFolder: StoryflowFolder | null = null;
  await updateStoryflowStore((current) => ({
    ...current,
    folders: current.folders.map((item) => {
      if (item.teacherUsername !== teacherUsername || item.id !== folder.id) {
        return item;
      }
      updatedFolder = folder;
      return folder;
    }),
  }));

  return ok(updatedFolder);
}

async function deleteFolderAction(
  request: NextRequest,
  payload: Record<string, unknown> | undefined
) {
  const auth = ensureTeacherSession(request);
  if (auth.error) return auth.error;

  const teacherUsername = normalizeText(payload?.teacherUsername) || auth.session.username;
  const folderId = normalizeText(payload?.folderId);
  if (!folderId || teacherUsername !== auth.session.username) {
    return fail("文件夹编号不能为空");
  }

  await updateStoryflowStore((current) => ({
    ...current,
    folders: current.folders.filter(
      (item) => !(item.teacherUsername === teacherUsername && item.id === folderId)
    ),
    documents: current.documents.map((item) =>
      item.teacherUsername === teacherUsername && item.folderId === folderId
        ? { ...item, folderId: null, updatedAt: Date.now() }
        : item
    ),
  }));

  return ok(true);
}

async function reorderFoldersAction(
  request: NextRequest,
  payload: Record<string, unknown> | undefined
) {
  const auth = ensureTeacherSession(request);
  if (auth.error) return auth.error;

  const teacherUsername = normalizeText(payload?.teacherUsername) || auth.session.username;
  const orderedFolderIds = Array.isArray(payload?.orderedFolderIds)
    ? payload.orderedFolderIds.map((item) => normalizeText(item)).filter(Boolean)
    : [];
  if (teacherUsername !== auth.session.username) {
    return fail("无权修改该老师文件夹顺序", 403);
  }

  const next = await updateStoryflowStore((current) => {
    const folders = getTeacherFolders(current, teacherUsername);
    const folderIds = new Set(folders.map((item) => item.id));
    const preferredOrder = orderedFolderIds.filter((id) => folderIds.has(id));
    const remainingIds = folders
      .map((item) => item.id)
      .filter((id) => !preferredOrder.includes(id));
    const nextOrder = [...preferredOrder, ...remainingIds];
    const baseSortOrder = Date.now() + nextOrder.length;
    const sortOrderById = new Map(
      nextOrder.map((id, index) => [id, baseSortOrder - index] as const)
    );

    return {
      ...current,
      folders: current.folders.map((item) =>
        item.teacherUsername === teacherUsername && sortOrderById.has(item.id)
          ? { ...item, sortOrder: sortOrderById.get(item.id) }
          : item
      ),
    };
  });

  return ok(getTeacherFolders(next, teacherUsername));
}

async function updateTeacherSettingsAction(
  request: NextRequest,
  payload: Record<string, unknown> | undefined
) {
  const auth = ensureTeacherSession(request);
  if (auth.error) return auth.error;

  const settings = normalizeStoryflowTeacherSettings(payload?.settings, auth.session.username);
  if (!settings || settings.teacherUsername !== auth.session.username) {
    return fail("设置数据无效");
  }

  await updateStoryflowStore((current) => ({
    ...current,
    settings: [
      settings,
      ...current.settings.filter(
        (item) => item.teacherUsername !== settings.teacherUsername
      ),
    ],
  }));

  return ok(settings);
}

async function publishAssignmentsAction(
  request: NextRequest,
  payload: Record<string, unknown> | undefined
) {
  const auth = ensureTeacherSession(request);
  if (auth.error) return auth.error;

  const incomingAssignments = Array.isArray(payload?.assignments)
    ? payload.assignments
        .map((item) => normalizeAssignment(item))
        .filter((item): item is StoryflowAssignment => Boolean(item))
        .filter((item) => item.teacherUsername === auth.session.username)
    : [];

  if (!incomingAssignments.length) {
    return ok([]);
  }

  const portal = await readPortalStore();
  const validStudentUsernames = new Set(
    portal.users
      .filter(
        (user) =>
          user.role === "student" && user.teacherUsername === auth.session.username
      )
      .map((user) => user.username)
  );
  const allowedAssignments = incomingAssignments.filter((item) =>
    validStudentUsernames.has(item.studentUsername)
  );

  await updateStoryflowStore((current) => {
    const duplicateKeys = new Set(
      allowedAssignments.map((item) => `${item.teacherUsername}:${item.studentUsername}:${item.documentId}`)
    );

    return {
      ...current,
      assignments: [
        ...allowedAssignments,
        ...current.assignments.filter(
          (item) =>
            !duplicateKeys.has(
              `${item.teacherUsername}:${item.studentUsername}:${item.documentId}`
            )
        ),
      ],
    };
  });

  return ok(allowedAssignments);
}

async function updateAssignmentAction(
  request: NextRequest,
  payload: Record<string, unknown> | undefined
) {
  const session = getSessionFromRequest(request);
  if (!session) {
    return fail("未登录", 401);
  }

  const assignment = normalizeAssignment(payload?.assignment);
  if (!assignment) {
    return fail("任务数据无效");
  }

  const allowed =
    (session.role === "teacher" && assignment.teacherUsername === session.username) ||
    (session.role === "student" && assignment.studentUsername === session.username);
  if (!allowed) {
    return fail("无权更新该任务", 403);
  }

  let updatedAssignment: StoryflowAssignment | null = null;
  await updateStoryflowStore((current) => ({
    ...current,
    assignments: current.assignments.map((item) => {
      if (item.id !== assignment.id) return item;
      updatedAssignment = assignment;
      return assignment;
    }),
  }));

  return ok(updatedAssignment);
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as StoryflowRequestBody | null;
  if (!body?.action) {
    return fail("缺少 action 参数");
  }

  switch (body.action) {
    case "bootstrap":
      return bootstrapStoryflow(request, body.payload);
    case "getTeacherLibrary":
      return getTeacherLibrary(request, body.payload);
    case "getAccessibleDocuments":
      return getAccessibleDocumentsAction(request, body.payload);
    case "getTeacherAssignments":
      return getTeacherAssignmentsAction(request, body.payload);
    case "getStudentAssignments":
      return getStudentAssignmentsAction(request, body.payload);
    case "getAssignmentById":
      return getAssignmentByIdAction(request, body.payload);
    case "saveDocument":
      return saveDocumentAction(request, body.payload);
    case "updateDocument":
      return updateDocumentAction(request, body.payload);
    case "deleteDocument":
      return deleteDocumentAction(request, body.payload);
    case "reorderDocuments":
      return reorderDocumentsAction(request, body.payload);
    case "createFolder":
      return createFolderAction(request, body.payload);
    case "updateFolder":
      return updateFolderAction(request, body.payload);
    case "deleteFolder":
      return deleteFolderAction(request, body.payload);
    case "reorderFolders":
      return reorderFoldersAction(request, body.payload);
    case "updateTeacherSettings":
      return updateTeacherSettingsAction(request, body.payload);
    case "publishAssignments":
      return publishAssignmentsAction(request, body.payload);
    case "updateAssignment":
      return updateAssignmentAction(request, body.payload);
    default:
      return fail("不支持的 action");
  }
}
