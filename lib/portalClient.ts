"use client";

import type {
  AppUser,
  CreateStudentInput,
  SessionUser,
  StudentStatus,
  TeacherClass,
} from "@/lib/clientAuth";
import type { UserAnalysisRecord } from "@/lib/clientRecords";
import type { AnalysisResult } from "@/types";

export interface TeacherOverview {
  totalStudents: number;
  activeStudents: number;
  inactiveStudents: number;
  neverLoggedStudents: number;
  totalClasses: number;
  totalRecords: number;
}

type PortalAction =
  | "bootstrap"
  | "hasTeacherAccount"
  | "loginUser"
  | "registerTeacher"
  | "getTeacherClasses"
  | "getTeacherClassById"
  | "getTeacherStudents"
  | "getStudentById"
  | "createTeacherClass"
  | "deleteTeacherClass"
  | "createStudentAccount"
  | "updateStudentAccount"
  | "assignStudentClass"
  | "setStudentStatus"
  | "resetStudentPassword"
  | "deleteStudentAccount"
  | "getUserRecords"
  | "getUserRecordById"
  | "saveUserRecord"
  | "updateUserRecord"
  | "deleteUserRecords"
  | "getTeacherOverview";

const USERS_KEY = "ep_users_v2";
const CLASSES_KEY = "ep_teacher_classes_v1";
const RECORDS_KEY = "ep_analysis_records";
const BOOTSTRAP_KEY = "ep_portal_bootstrapped_v1";
const SESSION_CACHE_TTL_MS = 10_000;

let cachedSession: SessionUser | null = null;
let cachedSessionExpiresAt = 0;
let sessionPromise: Promise<SessionUser | null> | null = null;

async function portalRequest<T>(
  action: PortalAction,
  payload?: Record<string, unknown>
): Promise<T> {
  const response = await fetch("/api/portal", {
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
    throw new Error(json.error || "请求失败");
  }

  return json.data as T;
}

async function sessionRequest<T>(method: "GET" | "DELETE") {
  const response = await fetch("/api/session", {
    method,
    headers: { "Content-Type": "application/json" },
  });

  const json = (await response.json()) as {
    ok: boolean;
    data?: T;
    error?: string;
  };

  if (!response.ok || !json.ok) {
    throw new Error(json.error || "会话请求失败");
  }

  return json.data as T;
}

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function removeJson(key: string) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(key);
}

function mergeLocalUsers(
  users: AppUser[],
  primaryUser?: AppUser
): AppUser[] {
  const existing = readJson<AppUser[]>(USERS_KEY, []);
  const map = new Map<string, AppUser>();

  for (const item of existing) {
    map.set(item.id || `${item.role}:${item.username}`, item);
  }
  for (const item of users) {
    map.set(item.id || `${item.role}:${item.username}`, item);
  }
  if (primaryUser) {
    map.set(
      primaryUser.id || `${primaryUser.role}:${primaryUser.username}`,
      primaryUser
    );
  }

  return Array.from(map.values());
}

export async function bootstrapPortalFromLocal() {
  if (typeof window === "undefined") return;
  if (window.localStorage.getItem(BOOTSTRAP_KEY) === "done") return;

  const users = readJson<AppUser[]>(USERS_KEY, []);
  const classes = readJson<TeacherClass[]>(CLASSES_KEY, []);
  const records = readJson<UserAnalysisRecord[]>(RECORDS_KEY, []);

  if (users.length === 0 && classes.length === 0 && records.length === 0) {
    window.localStorage.setItem(BOOTSTRAP_KEY, "done");
    return;
  }

  await portalRequest("bootstrap", {
    users,
    classes,
    records,
  });

  window.localStorage.setItem(BOOTSTRAP_KEY, "done");
}

export async function syncTeacherPortalCache(
  teacherUsername: string,
  teacherUser?: AppUser
) {
  const [classes, students] = await Promise.all([
    getTeacherClasses(teacherUsername),
    getTeacherStudents(teacherUsername),
  ]);

  writeJson(CLASSES_KEY, classes);
  writeJson(USERS_KEY, mergeLocalUsers(students, teacherUser));
}

export async function syncStudentPortalCache(user: AppUser) {
  const records = await getUserRecords(user.username);
  writeJson(RECORDS_KEY, records);
  writeJson(USERS_KEY, mergeLocalUsers([user]));
}

export async function hasTeacherAccount() {
  return portalRequest<boolean>("hasTeacherAccount");
}

export async function getServerSession() {
  if (sessionPromise) {
    return sessionPromise;
  }

  if (Date.now() < cachedSessionExpiresAt) {
    return cachedSession;
  }

  sessionPromise = sessionRequest<SessionUser | null>("GET")
    .then((session) => {
      cachedSession = session;
      cachedSessionExpiresAt = Date.now() + SESSION_CACHE_TTL_MS;
      return session;
    })
    .finally(() => {
      sessionPromise = null;
    });

  return sessionPromise;
}

export async function logoutUser() {
  try {
    await sessionRequest("DELETE");
  } finally {
    cachedSession = null;
    cachedSessionExpiresAt = 0;
    sessionPromise = null;
    removeJson(USERS_KEY);
    removeJson(CLASSES_KEY);
    removeJson(RECORDS_KEY);
    removeJson("ep_session_v2");
  }
}

export async function loginUser(input: {
  username: string;
  password: string;
}) {
  const user = await portalRequest<AppUser>("loginUser", input);
  cachedSession = {
    username: user.username,
    role: user.role,
    displayName: user.displayName,
    teacherUsername: user.teacherUsername,
  };
  cachedSessionExpiresAt = Date.now() + SESSION_CACHE_TTL_MS;
  return user;
}

export async function registerTeacher(input: {
  username: string;
  password: string;
  displayName: string;
  inviteCode: string;
}) {
  const user = await portalRequest<AppUser>("registerTeacher", input);
  cachedSession = {
    username: user.username,
    role: user.role,
    displayName: user.displayName,
    teacherUsername: user.teacherUsername,
  };
  cachedSessionExpiresAt = Date.now() + SESSION_CACHE_TTL_MS;
  return user;
}

export async function getTeacherClasses(teacherUsername: string) {
  return portalRequest<TeacherClass[]>("getTeacherClasses", { teacherUsername });
}

export async function getTeacherClassById(
  teacherUsername: string,
  classId: string
) {
  return portalRequest<TeacherClass | null>("getTeacherClassById", {
    teacherUsername,
    classId,
  });
}

export async function getTeacherStudents(teacherUsername: string) {
  return portalRequest<AppUser[]>("getTeacherStudents", { teacherUsername });
}

export async function getStudentById(
  teacherUsername: string,
  studentId: string
) {
  return portalRequest<AppUser | null>("getStudentById", {
    teacherUsername,
    studentId,
  });
}

export async function createTeacherClass(
  teacherUsername: string,
  className: string
) {
  const created = await portalRequest<TeacherClass>("createTeacherClass", {
    teacherUsername,
    className,
  });
  await syncTeacherPortalCache(teacherUsername);
  return created;
}

export async function deleteTeacherClass(
  teacherUsername: string,
  classId: string
) {
  await portalRequest<{ deleted: true }>("deleteTeacherClass", {
    teacherUsername,
    classId,
  });
  await syncTeacherPortalCache(teacherUsername);
}

export async function createStudentAccount(
  teacherUsername: string,
  input: CreateStudentInput
) {
  const created = await portalRequest<AppUser>("createStudentAccount", {
    teacherUsername,
    input,
  });
  await syncTeacherPortalCache(teacherUsername);
  return created;
}

export async function assignStudentClass(
  teacherUsername: string,
  studentId: string,
  classId: string
) {
  const updated = await portalRequest<AppUser>("assignStudentClass", {
    teacherUsername,
    studentId,
    classId,
  });
  await syncTeacherPortalCache(teacherUsername);
  return updated;
}

export async function setStudentStatus(
  teacherUsername: string,
  studentId: string,
  status: StudentStatus
) {
  const updated = await portalRequest<AppUser>("setStudentStatus", {
    teacherUsername,
    studentId,
    status,
  });
  await syncTeacherPortalCache(teacherUsername);
  return updated;
}

export async function resetStudentPassword(
  teacherUsername: string,
  studentId: string
) {
  const result = await portalRequest<{ password: string }>("resetStudentPassword", {
    teacherUsername,
    studentId,
  });
  await syncTeacherPortalCache(teacherUsername);
  return result;
}

export async function deleteStudentAccount(
  teacherUsername: string,
  studentId: string
) {
  await portalRequest<{ deleted: true }>("deleteStudentAccount", {
    teacherUsername,
    studentId,
  });
  await syncTeacherPortalCache(teacherUsername);
}

export async function getTeacherOverview(teacherUsername: string) {
  return portalRequest<TeacherOverview>("getTeacherOverview", {
    teacherUsername,
  });
}

export async function getUserRecords(username: string) {
  return portalRequest<UserAnalysisRecord[]>("getUserRecords", { username });
}

export async function getUserRecordById(username: string, recordId: string) {
  return portalRequest<UserAnalysisRecord | null>("getUserRecordById", {
    username,
    recordId,
  });
}

export async function updateUserRecord(
  username: string,
  recordId: string,
  result: AnalysisResult
) {
  const updated = await portalRequest<UserAnalysisRecord>("updateUserRecord", {
    username,
    recordId,
    result,
  });

  const records = readJson<UserAnalysisRecord[]>(RECORDS_KEY, []);
  writeJson(
    RECORDS_KEY,
    records.map((record) => (record.id === updated.id ? updated : record))
  );

  return updated;
}

export async function saveUserRecord(
  username: string,
  result: AnalysisResult,
  videoObjectKey?: string | null
) {
  const saved = await portalRequest<UserAnalysisRecord>("saveUserRecord", {
    username,
    result,
    videoObjectKey: videoObjectKey || null,
  });

  const records = readJson<UserAnalysisRecord[]>(RECORDS_KEY, []);
  writeJson(RECORDS_KEY, [saved, ...records]);

  return saved;
}

export async function hydrateSessionCache(session: SessionUser, user?: AppUser) {
  if (session.role === "teacher") {
    await syncTeacherPortalCache(session.username, user);
    return;
  }

  if (user) {
    await syncStudentPortalCache(user);
  }
}
