import { NextRequest, NextResponse } from "next/server";

import type {
  AppUser,
  CreateStudentInput,
  ExpiryPreset,
  StudentStatus,
  TeacherClass,
} from "@/lib/clientAuth";
import type { UserAnalysisRecord } from "@/lib/clientRecords";
import { readPortalStore, updatePortalStore } from "@/lib/portalStore";
import { hashPassword, verifyPassword } from "@/lib/passwordSecurity";
import { setSessionCookie } from "@/lib/sessionCookie";
import type { AnalysisResult } from "@/types";

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

interface PortalRequestBody {
  action: PortalAction;
  payload?: Record<string, unknown>;
}

interface TeacherOverview {
  totalStudents: number;
  activeStudents: number;
  inactiveStudents: number;
  neverLoggedStudents: number;
  totalClasses: number;
  totalRecords: number;
}

type Result<T> = { ok: true; data: T } | { ok: false; error: string };
type StudentUpdateInput = Partial<CreateStudentInput> & {
  status?: StudentStatus;
  password?: string;
};

function ok<T>(data: T) {
  return NextResponse.json({ ok: true, data });
}

function fail(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function sanitizeUser(user: AppUser, password = ""): AppUser {
  const { passwordHash, passwordSalt, ...rest } = user;
  return {
    ...rest,
    password,
  };
}

function sanitizeUsers(users: AppUser[]) {
  return users.map((user) => sanitizeUser(user));
}

function normalizeText(value: string) {
  return value.trim();
}

function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

function createId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function buildInitialPassword(username: string) {
  const digits = username.replace(/\D/g, "");
  if (digits.length >= 6) {
    return digits.slice(-6);
  }
  return "123456";
}

function getExpiryDurationMs(preset: ExpiryPreset): number | null {
  switch (preset) {
    case "week":
      return 7 * 24 * 60 * 60 * 1000;
    case "month":
      return 30 * 24 * 60 * 60 * 1000;
    case "quarter":
      return 90 * 24 * 60 * 60 * 1000;
    case "half_year":
      return 180 * 24 * 60 * 60 * 1000;
    case "year":
      return 365 * 24 * 60 * 60 * 1000;
    default:
      return null;
  }
}

function resolveExpiryAt(
  preset: ExpiryPreset,
  customExpiryDate?: string
): number | null {
  if (preset === "unlimited") {
    return null;
  }

  if (preset === "custom") {
    if (!customExpiryDate) {
      return null;
    }

    const ts = new Date(customExpiryDate).getTime();
    return Number.isNaN(ts) ? null : ts;
  }

  const duration = getExpiryDurationMs(preset);
  return duration ? Date.now() + duration : null;
}

function isStudentExpired(user: AppUser) {
  if (user.role !== "student") return false;
  if (!user.expiryAt) return false;
  return Date.now() > user.expiryAt;
}

function getTeacherStudentsFromUsers(users: AppUser[], teacherUsername: string) {
  return users
    .filter(
      (user) =>
        user.role === "student" && user.teacherUsername === teacherUsername
    )
    .sort((left, right) => right.createdAt - left.createdAt);
}

function getTeacherClassesFromStore(
  classes: TeacherClass[],
  teacherUsername: string
) {
  return classes
    .filter((item) => item.teacherUsername === teacherUsername)
    .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
}

function formatClassName(
  teacherUsername: string,
  classes: TeacherClass[],
  classId?: string,
  className?: string
) {
  if (className) return className;
  if (!classId) return "";
  const found = classes.find(
    (item) => item.id === classId && item.teacherUsername === teacherUsername
  );
  return found?.name || "";
}

function mergeByIdOrKey<T extends { id?: string }>(
  current: T[],
  incoming: T[],
  getKey: (item: T) => string
) {
  const map = new Map<string, T>();

  for (const item of current) {
    map.set(getKey(item), item);
  }

  for (const item of incoming) {
    const key = getKey(item);
    if (!map.has(key)) {
      map.set(key, item);
    }
  }

  return Array.from(map.values());
}

async function bootstrapPortal(payload: Record<string, unknown> | undefined) {
  const users = Array.isArray(payload?.users) ? (payload.users as AppUser[]) : [];
  const classes = Array.isArray(payload?.classes)
    ? (payload.classes as TeacherClass[])
    : [];
  const records = Array.isArray(payload?.records)
    ? (payload.records as UserAnalysisRecord[])
    : [];

  await updatePortalStore((current) => ({
    users: mergeByIdOrKey(current.users, users, (item) =>
      item.id || `${item.role}:${normalizeUsername(item.username)}`
    ),
    classes: mergeByIdOrKey(current.classes, classes, (item) =>
      item.id || `${item.teacherUsername}:${item.name}`
    ),
    records: mergeByIdOrKey(current.records, records, (item) => item.id),
  }));

  return { migrated: true };
}

async function hasTeacherAccount() {
  const store = await readPortalStore();
  return store.users.some((user) => user.role === "teacher");
}

async function loginUser(
  payload: Record<string, unknown> | undefined
): Promise<Result<AppUser>> {
  const username = normalizeText(String(payload?.username ?? ""));
  const password = String(payload?.password ?? "");

  if (!username || !password) {
    return { ok: false, error: "请输入账号和密码" };
  }

  let loggedInUser: AppUser | null = null;

  await updatePortalStore((current) => {
    const target = current.users.find(
      (user) => normalizeUsername(user.username) === normalizeUsername(username)
    );

    if (!target || !verifyPassword(password, target.passwordHash, target.passwordSalt)) {
      return current;
    }

    if (target.role === "student") {
      if (target.status === "inactive") {
        return current;
      }
      if (isStudentExpired(target)) {
        return current;
      }
    }

    const users = current.users.map((item) => {
      if (item.id !== target.id) return item;
      loggedInUser = {
        ...item,
        lastLoginAt: Date.now(),
        updatedAt: Date.now(),
      };
      return loggedInUser;
    });

    return {
      ...current,
      users,
    };
  });

  if (!loggedInUser) {
    const store = await readPortalStore();
    const target = store.users.find(
      (user) => normalizeUsername(user.username) === normalizeUsername(username)
    );

    if (!target || !verifyPassword(password, target.passwordHash, target.passwordSalt)) {
      return { ok: false, error: "账号或密码错误" };
    }
    if (target.role === "student" && target.status === "inactive") {
      return { ok: false, error: "该学员账号已停用，请联系老师" };
    }
    if (isStudentExpired(target)) {
      return { ok: false, error: "该学员账号已过期，请联系老师续期" };
    }

    loggedInUser = {
      ...target,
      lastLoginAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  return { ok: true, data: sanitizeUser(loggedInUser) };
}

async function registerTeacher(
  payload: Record<string, unknown> | undefined
): Promise<Result<AppUser>> {
  const username = normalizeText(String(payload?.username ?? ""));
  const password = normalizeText(String(payload?.password ?? ""));
  const displayName = normalizeText(String(payload?.displayName ?? ""));
  const inviteCode = normalizeText(String(payload?.inviteCode ?? ""));

  if (!username || !password || !displayName || !inviteCode) {
    return { ok: false, error: "请完整填写账号、密码、姓名和邀请码" };
  }

  const expectedInviteCode = process.env.NEXT_PUBLIC_INVITE_CODE || "VIP888";
  if (inviteCode !== expectedInviteCode) {
    return { ok: false, error: "邀请码错误，无法注册老师账号" };
  }

  const store = await readPortalStore();
  if (
    store.users.some(
      (user) => normalizeUsername(user.username) === normalizeUsername(username)
    )
  ) {
    return { ok: false, error: "该账号已存在，请更换" };
  }

  const teacher: AppUser = {
    id: createId("teacher"),
    username,
    password: "",
    ...hashPassword(password),
    role: "teacher",
    displayName,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  await updatePortalStore((current) => ({
    ...current,
    users: [...current.users, teacher],
  }));

  return { ok: true, data: sanitizeUser(teacher) };
}

async function getTeacherClasses(teacherUsername: string) {
  const store = await readPortalStore();
  return getTeacherClassesFromStore(store.classes, teacherUsername);
}

async function getTeacherClassById(teacherUsername: string, classId: string) {
  const store = await readPortalStore();
  return (
    store.classes.find(
      (item) => item.teacherUsername === teacherUsername && item.id === classId
    ) || null
  );
}

async function getTeacherStudents(teacherUsername: string) {
  const store = await readPortalStore();
  return sanitizeUsers(getTeacherStudentsFromUsers(store.users, teacherUsername));
}

async function getStudentById(teacherUsername: string, studentId: string) {
  const store = await readPortalStore();
  const user =
    store.users.find(
      (user) =>
        user.role === "student" &&
        user.teacherUsername === teacherUsername &&
        user.id === studentId
    ) || null;

  return user ? sanitizeUser(user) : null;
}

async function createTeacherClass(
  teacherUsername: string,
  className: string
): Promise<Result<TeacherClass>> {
  const normalized = normalizeText(className);

  if (!normalized) {
    return { ok: false, error: "请输入班级名称" };
  }

  const store = await readPortalStore();
  const exists = store.classes.some(
    (item) =>
      item.teacherUsername === teacherUsername && item.name === normalized
  );

  if (exists) {
    return { ok: false, error: "班级名称已存在" };
  }

  const created: TeacherClass = {
    id: createId("class"),
    teacherUsername,
    name: normalized,
    createdAt: Date.now(),
  };

  await updatePortalStore((current) => ({
    ...current,
    classes: [created, ...current.classes],
  }));

  return { ok: true, data: created };
}

async function deleteTeacherClass(
  teacherUsername: string,
  classId: string
): Promise<Result<{ deleted: true }>> {
  const store = await readPortalStore();
  const classInUse = store.users.some(
    (user) =>
      user.role === "student" &&
      user.teacherUsername === teacherUsername &&
      user.classId === classId
  );

  if (classInUse) {
    return { ok: false, error: "该班级下还有学员，请先调整学员分班" };
  }

  await updatePortalStore((current) => ({
    ...current,
    classes: current.classes.filter(
      (item) =>
        !(item.teacherUsername === teacherUsername && item.id === classId)
    ),
  }));

  return { ok: true, data: { deleted: true } };
}

async function createStudentAccount(
  teacherUsername: string,
  input: CreateStudentInput
): Promise<Result<AppUser>> {
  const username = normalizeText(input.username);
  const displayName = normalizeText(input.displayName);

  if (!username || !displayName) {
    return { ok: false, error: "学员账号和学员昵称不能为空" };
  }

  const store = await readPortalStore();
  const duplicateUser = store.users.find(
    (user) => normalizeUsername(user.username) === normalizeUsername(username)
  );

  if (duplicateUser) {
    if (duplicateUser.role !== "student") {
      return { ok: false, error: "该账号已被老师账号占用" };
    }

    if (
      duplicateUser.teacherUsername &&
      duplicateUser.teacherUsername !== teacherUsername
    ) {
      return { ok: false, error: "该学员账号已被其他老师使用" };
    }

    if (duplicateUser.teacherUsername === teacherUsername) {
      return { ok: false, error: "该学员账号已存在于当前老师名下" };
    }

    const className = formatClassName(
      teacherUsername,
      store.classes,
      input.classId,
      input.className
    );
    const initialPassword = buildInitialPassword(username);
    const adoptedStudent: AppUser = {
      ...duplicateUser,
      password: "",
      ...hashPassword(initialPassword),
      displayName,
      updatedAt: Date.now(),
      teacherUsername,
      status: "active",
      classId: input.classId || "",
      className,
      remarkName: normalizeText(input.remarkName || ""),
      noteInfo: normalizeText(input.noteInfo || ""),
      gender: input.gender,
      grade: normalizeText(input.grade || ""),
      birthday: normalizeText(input.birthday || ""),
      school: normalizeText(input.school || ""),
      address: normalizeText(input.address || ""),
      expiryPreset: input.expiryPreset,
      expiryAt: resolveExpiryAt(input.expiryPreset, input.customExpiryDate),
      studentNo:
        duplicateUser.studentNo ||
        String(
          getTeacherStudentsFromUsers(store.users, teacherUsername).length + 1
        ).padStart(3, "0"),
    };

    await updatePortalStore((current) => ({
      ...current,
      users: current.users.map((user) =>
        user.id === duplicateUser.id ? adoptedStudent : user
      ),
    }));

    return {
      ok: true,
      data: sanitizeUser(adoptedStudent, initialPassword),
    };
  }

  const className = formatClassName(
    teacherUsername,
    store.classes,
    input.classId,
    input.className
  );

  const created: AppUser = {
    id: createId("student"),
    username,
    password: "",
    ...hashPassword(buildInitialPassword(username)),
    role: "student",
    displayName,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    teacherUsername,
    status: "active",
    classId: input.classId || "",
    className,
    remarkName: normalizeText(input.remarkName || ""),
    noteInfo: normalizeText(input.noteInfo || ""),
    gender: input.gender,
    grade: normalizeText(input.grade || ""),
    birthday: normalizeText(input.birthday || ""),
    school: normalizeText(input.school || ""),
    address: normalizeText(input.address || ""),
    expiryPreset: input.expiryPreset,
    expiryAt: resolveExpiryAt(input.expiryPreset, input.customExpiryDate),
    lastLoginAt: null,
    studentNo: String(
      getTeacherStudentsFromUsers(store.users, teacherUsername).length + 1
    ).padStart(3, "0"),
  };

  await updatePortalStore((current) => ({
    ...current,
    users: [created, ...current.users],
  }));

  return {
    ok: true,
    data: sanitizeUser(created, buildInitialPassword(username)),
  };
}

async function updateStudentAccount(
  teacherUsername: string,
  studentId: string,
  input: StudentUpdateInput
): Promise<Result<AppUser>> {
  const store = await readPortalStore();
  const target = store.users.find(
    (user) =>
      user.role === "student" &&
      user.teacherUsername === teacherUsername &&
      user.id === studentId
  );

  if (!target) {
    return { ok: false, error: "未找到该学员账号" };
  }

  const nextExpiryPreset =
    input.expiryPreset || target.expiryPreset || "unlimited";
  const nextClassId =
    input.classId === undefined ? target.classId || "" : input.classId || "";
  const nextClassName = formatClassName(
    teacherUsername,
    store.classes,
    nextClassId,
    input.className || target.className
  );
  const resolvedExpiryAt =
    nextExpiryPreset === "custom" && !input.customExpiryDate
      ? target.expiryAt ?? null
      : resolveExpiryAt(nextExpiryPreset, input.customExpiryDate);

  const updatedTarget: AppUser = {
    ...target,
    displayName:
      input.displayName !== undefined
        ? normalizeText(input.displayName)
        : target.displayName,
    remarkName:
      input.remarkName !== undefined
        ? normalizeText(input.remarkName)
        : target.remarkName,
    noteInfo:
      input.noteInfo !== undefined
        ? normalizeText(input.noteInfo)
        : target.noteInfo,
    gender: input.gender || target.gender || "unknown",
    grade:
      input.grade !== undefined ? normalizeText(input.grade) : target.grade,
    birthday:
      input.birthday !== undefined
        ? normalizeText(input.birthday)
        : target.birthday,
    school:
      input.school !== undefined ? normalizeText(input.school) : target.school,
    address:
      input.address !== undefined
        ? normalizeText(input.address)
        : target.address,
    classId: nextClassId,
    className: nextClassName,
    expiryPreset: nextExpiryPreset,
    expiryAt:
      nextExpiryPreset === "unlimited"
        ? null
        : resolvedExpiryAt ?? target.expiryAt ?? null,
    status: input.status || target.status,
    ...(input.password ? hashPassword(input.password) : {}),
    password: "",
    updatedAt: Date.now(),
  };

  await updatePortalStore((current) => ({
    ...current,
    users: current.users.map((user) =>
      user.id === target.id ? updatedTarget : user
    ),
  }));

  return { ok: true, data: sanitizeUser(updatedTarget) };
}

async function assignStudentClass(
  teacherUsername: string,
  studentId: string,
  classId: string
) {
  return updateStudentAccount(teacherUsername, studentId, { classId });
}

async function setStudentStatus(
  teacherUsername: string,
  studentId: string,
  status: StudentStatus
) {
  return updateStudentAccount(teacherUsername, studentId, { status });
}

async function resetStudentPassword(
  teacherUsername: string,
  studentId: string
): Promise<Result<{ password: string }>> {
  const student = await getStudentById(teacherUsername, studentId);

  if (!student) {
    return { ok: false, error: "未找到该学员账号" };
  }

  const password = buildInitialPassword(student.username);
  const result = await updateStudentAccount(teacherUsername, studentId, {
    password,
  });

  if (!result.ok) {
    return result;
  }

  return { ok: true, data: { password } };
}

async function deleteStudentAccount(
  teacherUsername: string,
  studentId: string
): Promise<Result<{ deleted: true }>> {
  const target = await getStudentById(teacherUsername, studentId);

  if (!target) {
    return { ok: false, error: "未找到该学员账号" };
  }

  await updatePortalStore((current) => ({
    users: current.users.filter(
      (user) =>
        !(
          user.role === "student" &&
          user.teacherUsername === teacherUsername &&
          user.id === studentId
        )
    ),
    classes: current.classes,
    records: current.records.filter(
      (record) => record.username !== target.username
    ),
  }));

  return { ok: true, data: { deleted: true } };
}

async function getUserRecords(username: string) {
  const store = await readPortalStore();
  return store.records
    .filter((record) => record.username === username)
    .sort((a, b) => b.createdAt - a.createdAt);
}

async function getUserRecordById(username: string, recordId: string) {
  const store = await readPortalStore();
  return (
    store.records.find(
      (record) => record.username === username && record.id === recordId
    ) || null
  );
}

async function saveUserRecord(
  username: string,
  result: AnalysisResult,
  videoObjectKey?: string | null
) {
  const newRecord: UserAnalysisRecord = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    username: normalizeText(username),
    createdAt: Date.now(),
    result,
    videoObjectKey: videoObjectKey || null,
  };

  await updatePortalStore((current) => ({
    ...current,
    records: [newRecord, ...current.records],
  }));

  return newRecord;
}

async function updateUserRecord(
  username: string,
  recordId: string,
  result: AnalysisResult
): Promise<Result<UserAnalysisRecord>> {
  const target = await getUserRecordById(username, recordId);

  if (!target) {
    return { ok: false, error: "记录不存在或无权限修改" };
  }

  const updated: UserAnalysisRecord = {
    ...target,
    result,
  };

  await updatePortalStore((current) => ({
    ...current,
    records: current.records.map((record) =>
      record.id === target.id ? updated : record
    ),
  }));

  return { ok: true, data: updated };
}

async function deleteUserRecords(username: string) {
  await updatePortalStore((current) => ({
    ...current,
    records: current.records.filter((record) => record.username !== username),
  }));

  return { deleted: true };
}

async function getTeacherOverview(
  teacherUsername: string
): Promise<TeacherOverview> {
  const store = await readPortalStore();
  const students = getTeacherStudentsFromUsers(store.users, teacherUsername);
  const classes = getTeacherClassesFromStore(store.classes, teacherUsername);
  const usernames = new Set(students.map((student) => student.username));
  const totalRecords = store.records.filter((record) =>
    usernames.has(record.username)
  ).length;

  return {
    totalStudents: students.length,
    activeStudents: students.filter(
      (student) => student.status !== "inactive" && !isStudentExpired(student)
    ).length,
    inactiveStudents: students.filter((student) => student.status === "inactive")
      .length,
    neverLoggedStudents: students.filter((student) => !student.lastLoginAt)
      .length,
    totalClasses: classes.length,
    totalRecords,
  };
}

function handleResult<T>(result: Result<T>) {
  if (!result.ok) {
    return fail(result.error);
  }
  return ok(result.data);
}

export async function POST(request: NextRequest) {
  let body: PortalRequestBody;

  try {
    body = (await request.json()) as PortalRequestBody;
  } catch {
    return fail("请求格式不正确");
  }

  const payload = body.payload;

  try {
    switch (body.action) {
      case "bootstrap":
        return ok(await bootstrapPortal(payload));
      case "hasTeacherAccount":
        return ok(await hasTeacherAccount());
      case "loginUser": {
        const result = await loginUser(payload);
        if (!result.ok) {
          return fail(result.error);
        }
        const response = ok(result.data);
        setSessionCookie(response, result.data);
        return response;
      }
      case "registerTeacher": {
        const result = await registerTeacher(payload);
        if (!result.ok) {
          return fail(result.error);
        }
        const response = ok(result.data);
        setSessionCookie(response, result.data);
        return response;
      }
      case "getTeacherClasses":
        return ok(await getTeacherClasses(String(payload?.teacherUsername ?? "")));
      case "getTeacherClassById":
        return ok(
          await getTeacherClassById(
            String(payload?.teacherUsername ?? ""),
            String(payload?.classId ?? "")
          )
        );
      case "getTeacherStudents":
        return ok(await getTeacherStudents(String(payload?.teacherUsername ?? "")));
      case "getStudentById":
        return ok(
          await getStudentById(
            String(payload?.teacherUsername ?? ""),
            String(payload?.studentId ?? "")
          )
        );
      case "createTeacherClass":
        return handleResult(
          await createTeacherClass(
            String(payload?.teacherUsername ?? ""),
            String(payload?.className ?? "")
          )
        );
      case "deleteTeacherClass":
        return handleResult(
          await deleteTeacherClass(
            String(payload?.teacherUsername ?? ""),
            String(payload?.classId ?? "")
          )
        );
      case "createStudentAccount":
        return handleResult(
          await createStudentAccount(
            String(payload?.teacherUsername ?? ""),
            (payload?.input as CreateStudentInput) || {
              username: "",
              displayName: "",
              expiryPreset: "unlimited",
              gender: "unknown",
            }
          )
        );
      case "updateStudentAccount":
        return handleResult(
          await updateStudentAccount(
            String(payload?.teacherUsername ?? ""),
            String(payload?.studentId ?? ""),
            ((payload?.input || payload?.updates) as StudentUpdateInput) || {}
          )
        );
      case "assignStudentClass":
        return handleResult(
          await assignStudentClass(
            String(payload?.teacherUsername ?? ""),
            String(payload?.studentId ?? ""),
            String(payload?.classId ?? "")
          )
        );
      case "setStudentStatus":
        return handleResult(
          await setStudentStatus(
            String(payload?.teacherUsername ?? ""),
            String(payload?.studentId ?? ""),
            String(payload?.status ?? "inactive") as StudentStatus
          )
        );
      case "resetStudentPassword":
        return handleResult(
          await resetStudentPassword(
            String(payload?.teacherUsername ?? ""),
            String(payload?.studentId ?? "")
          )
        );
      case "deleteStudentAccount":
        return handleResult(
          await deleteStudentAccount(
            String(payload?.teacherUsername ?? ""),
            String(payload?.studentId ?? "")
          )
        );
      case "getUserRecords":
        return ok(await getUserRecords(String(payload?.username ?? "")));
      case "getUserRecordById":
        return ok(
          await getUserRecordById(
            String(payload?.username ?? ""),
            String(payload?.recordId ?? payload?.id ?? "")
          )
        );
      case "saveUserRecord":
        return ok(
          await saveUserRecord(
            String(payload?.username ?? ""),
            payload?.result as AnalysisResult,
            (payload?.videoObjectKey as string | null | undefined) || null
          )
        );
      case "updateUserRecord":
        return handleResult(
          await updateUserRecord(
            String(payload?.username ?? ""),
            String(payload?.recordId ?? payload?.id ?? ""),
            payload?.result as AnalysisResult
          )
        );
      case "deleteUserRecords":
        return ok(await deleteUserRecords(String(payload?.username ?? "")));
      case "getTeacherOverview":
        return ok(await getTeacherOverview(String(payload?.teacherUsername ?? "")));
      default:
        return fail("不支持的操作");
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "服务端处理失败，请稍后重试";
    return fail(message, 500);
  }
}
