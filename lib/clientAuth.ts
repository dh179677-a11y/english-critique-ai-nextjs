import { deleteUserRecords } from "@/lib/clientRecords";

export type UserRole = "teacher" | "student";
export type StudentStatus = "active" | "inactive";
export type StudentGender = "male" | "female" | "unknown";
export type ExpiryPreset =
  | "unlimited"
  | "week"
  | "month"
  | "quarter"
  | "half_year"
  | "year"
  | "custom";

export interface AppUser {
  id: string;
  username: string;
  password: string;
  passwordHash?: string;
  passwordSalt?: string;
  role: UserRole;
  displayName: string;
  createdAt: number;
  updatedAt: number;
  teacherUsername?: string;
  status?: StudentStatus;
  classId?: string;
  className?: string;
  remarkName?: string;
  noteInfo?: string;
  gender?: StudentGender;
  grade?: string;
  birthday?: string;
  school?: string;
  address?: string;
  expiryPreset?: ExpiryPreset;
  expiryAt?: number | null;
  studentNo?: string;
  lastLoginAt?: number | null;
}

export interface TeacherClass {
  id: string;
  teacherUsername: string;
  name: string;
  createdAt: number;
}

export interface SessionUser {
  username: string;
  role: UserRole;
  displayName: string;
  teacherUsername?: string;
}

export interface CreateStudentInput {
  username: string;
  displayName: string;
  remarkName?: string;
  classId?: string;
  className?: string;
  expiryPreset: ExpiryPreset;
  customExpiryDate?: string;
  gender: StudentGender;
  grade?: string;
  birthday?: string;
  school?: string;
  address?: string;
  noteInfo?: string;
}

type Result<T = void> = { ok: true; data: T } | { ok: false; message: string };

interface LegacyUser {
  username: string;
  password: string;
  createdAt: number;
}

const USERS_KEY = "ep_users_v2";
const SESSION_KEY = "ep_session_v2";
const CLASSES_KEY = "ep_teacher_classes_v1";
const LEGACY_USERS_KEY = "ep_users";
const DEFAULT_INVITE_CODE = "VIP888";

const isBrowser = () => typeof window !== "undefined";

const createId = (prefix: string) =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const normalizeText = (value: string) => value.trim();

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

const migrateLegacyUsers = () => {
  if (!isBrowser()) return;

  const existing = readJson<AppUser[] | null>(USERS_KEY, null);
  if (existing && Array.isArray(existing) && existing.length > 0) {
    return;
  }

  const legacyUsers = readJson<LegacyUser[]>(LEGACY_USERS_KEY, []);
  if (!Array.isArray(legacyUsers) || legacyUsers.length === 0) {
    return;
  }

  const migrated: AppUser[] = legacyUsers.map((user) => ({
    id: createId("student"),
    username: user.username,
    password: user.password,
    role: "student",
    displayName: user.username,
    createdAt: user.createdAt || Date.now(),
    updatedAt: user.createdAt || Date.now(),
    status: "active",
    expiryPreset: "unlimited",
    expiryAt: null,
    lastLoginAt: null,
  }));

  writeJson(USERS_KEY, migrated);
};

const readUsers = (): AppUser[] => {
  migrateLegacyUsers();
  const users = readJson<AppUser[]>(USERS_KEY, []);
  return Array.isArray(users) ? users : [];
};

const writeUsers = (users: AppUser[]) => {
  writeJson(USERS_KEY, users);
};

const readClasses = (): TeacherClass[] => {
  const classes = readJson<TeacherClass[]>(CLASSES_KEY, []);
  return Array.isArray(classes) ? classes : [];
};

const writeClasses = (classes: TeacherClass[]) => {
  writeJson(CLASSES_KEY, classes);
};

const getExpiryDurationMs = (preset: ExpiryPreset): number | null => {
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
};

const resolveExpiryAt = (
  preset: ExpiryPreset,
  customExpiryDate?: string
): number | null => {
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
};

const buildInitialPassword = (username: string) => {
  const digits = username.replace(/\D/g, "");
  if (digits.length >= 6) {
    return digits.slice(-6);
  }
  return "123456";
};

const formatClassName = (
  teacherUsername: string,
  classId?: string,
  className?: string
) => {
  if (className) return className;
  if (!classId) return "";
  const found = readClasses().find(
    (item) => item.id === classId && item.teacherUsername === teacherUsername
  );
  return found?.name || "";
};

export const getInviteCode = (): string =>
  process.env.NEXT_PUBLIC_INVITE_CODE || DEFAULT_INVITE_CODE;

export const getSessionProfile = (): SessionUser | null => {
  if (!isBrowser()) return null;
  const session = readJson<SessionUser | null>(SESSION_KEY, null);
  if (!session?.username || !session.role) return null;
  return session;
};

export const getSessionUser = (): string | null => {
  return getSessionProfile()?.username || null;
};

export const getHomePathForRole = (role: UserRole): string =>
  role === "teacher" ? "/teacher" : "/";

export const setSessionUser = (user: AppUser | SessionUser) => {
  writeJson(SESSION_KEY, {
    username: user.username,
    role: user.role,
    displayName: user.displayName,
    teacherUsername: "teacherUsername" in user ? user.teacherUsername : undefined,
  });
};

export const clearSessionUser = () => {
  if (!isBrowser()) return;
  window.localStorage.removeItem(SESSION_KEY);
};

export const hasTeacherAccount = (): boolean =>
  readUsers().some((user) => user.role === "teacher");

export const getTeacherUsers = (): AppUser[] =>
  readUsers()
    .filter((user) => user.role === "teacher")
    .sort((left, right) => right.createdAt - left.createdAt);

export const getTeacherClasses = (teacherUsername: string): TeacherClass[] =>
  readClasses()
    .filter((item) => item.teacherUsername === teacherUsername)
    .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));

export const getTeacherClassById = (
  teacherUsername: string,
  classId: string
): TeacherClass | null =>
  readClasses().find(
    (item) => item.teacherUsername === teacherUsername && item.id === classId
  ) || null;

export const getTeacherStudents = (teacherUsername: string): AppUser[] =>
  readUsers()
    .filter(
      (user) => user.role === "student" && user.teacherUsername === teacherUsername
    )
    .sort((left, right) => right.createdAt - left.createdAt);

export const getStudentById = (
  teacherUsername: string,
  studentId: string
): AppUser | null => {
  const found = readUsers().find(
    (user) =>
      user.role === "student" &&
      user.teacherUsername === teacherUsername &&
      user.id === studentId
  );

  return found || null;
};

export const getUserByUsername = (username: string): AppUser | null => {
  const normalized = normalizeText(username);
  if (!normalized) return null;
  return readUsers().find((user) => user.username === normalized) || null;
};

export const isStudentExpired = (user: AppUser): boolean => {
  if (user.role !== "student") return false;
  if (!user.expiryAt) return false;
  return Date.now() > user.expiryAt;
};

export const getStudentStatusLabel = (user: AppUser): string => {
  if (user.role !== "student") return "";
  if (user.status === "inactive") return "已停用";
  if (isStudentExpired(user)) return "已过期";
  return "使用中";
};

export const registerTeacher = (input: {
  username: string;
  password: string;
  displayName: string;
  inviteCode: string;
}): Result<AppUser> => {
  const username = normalizeText(input.username);
  const password = normalizeText(input.password);
  const displayName = normalizeText(input.displayName);
  const inviteCode = normalizeText(input.inviteCode);

  if (!username || !password || !displayName || !inviteCode) {
    return { ok: false, message: "请完整填写账号、密码、姓名和邀请码" };
  }

  if (inviteCode !== getInviteCode()) {
    return { ok: false, message: "邀请码错误，无法注册老师账号" };
  }

  const users = readUsers();
  if (users.some((user) => user.username === username)) {
    return { ok: false, message: "该账号已存在，请更换" };
  }

  const teacher: AppUser = {
    id: createId("teacher"),
    username,
    password,
    role: "teacher",
    displayName,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  users.push(teacher);
  writeUsers(users);

  return { ok: true, data: teacher };
};

export const loginUser = (input: {
  username: string;
  password: string;
}): Result<{ user: AppUser; redirectTo: string }> => {
  const username = normalizeText(input.username);
  const password = normalizeText(input.password);

  if (!username || !password) {
    return { ok: false, message: "请输入账号和密码" };
  }

  const users = readUsers();
  const user = users.find((item) => item.username === username);

  if (!user || user.password !== password) {
    return { ok: false, message: "账号或密码错误" };
  }

  if (user.role === "student") {
    if (user.status === "inactive") {
      return { ok: false, message: "该学员账号已停用，请联系老师" };
    }
    if (isStudentExpired(user)) {
      return { ok: false, message: "该学员账号已过期，请联系老师续期" };
    }
  }

  const nextUsers = users.map((item) =>
    item.id === user.id
      ? { ...item, lastLoginAt: Date.now(), updatedAt: Date.now() }
      : item
  );
  writeUsers(nextUsers);

  const latestUser = nextUsers.find((item) => item.id === user.id) || user;
  setSessionUser(latestUser);

  return {
    ok: true,
    data: {
      user: latestUser,
      redirectTo: getHomePathForRole(latestUser.role),
    },
  };
};

export const createTeacherClass = (
  teacherUsername: string,
  name: string
): Result<TeacherClass> => {
  const normalized = normalizeText(name);
  if (!normalized) {
    return { ok: false, message: "请输入班级名称" };
  }

  const classes = readClasses();
  const exists = classes.some(
    (item) => item.teacherUsername === teacherUsername && item.name === normalized
  );

  if (exists) {
    return { ok: false, message: "班级名称已存在" };
  }

  const created: TeacherClass = {
    id: createId("class"),
    teacherUsername,
    name: normalized,
    createdAt: Date.now(),
  };

  writeClasses([created, ...classes]);
  return { ok: true, data: created };
};

export const deleteTeacherClass = (
  teacherUsername: string,
  classId: string
): Result => {
  const students = getTeacherStudents(teacherUsername);
  const classInUse = students.some((student) => student.classId === classId);

  if (classInUse) {
    return { ok: false, message: "该班级下还有学员，请先调整学员分班" };
  }

  const classes = readClasses().filter(
    (item) => !(item.teacherUsername === teacherUsername && item.id === classId)
  );
  writeClasses(classes);
  return { ok: true, data: undefined };
};

export const createStudentAccount = (
  teacherUsername: string,
  input: CreateStudentInput
): Result<AppUser> => {
  const username = normalizeText(input.username);
  const displayName = normalizeText(input.displayName);

  if (!username || !displayName) {
    return { ok: false, message: "学员账号和学员昵称不能为空" };
  }

  const users = readUsers();
  if (users.some((user) => user.username === username)) {
    return { ok: false, message: "该学员账号已存在" };
  }

  const className = formatClassName(
    teacherUsername,
    input.classId,
    input.className
  );

  const created: AppUser = {
    id: createId("student"),
    username,
    password: buildInitialPassword(username),
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
    studentNo: String(getTeacherStudents(teacherUsername).length + 1).padStart(3, "0"),
  };

  writeUsers([created, ...users]);
  return { ok: true, data: created };
};

export const updateStudentAccount = (
  teacherUsername: string,
  studentId: string,
  input: Partial<CreateStudentInput>
): Result<AppUser> => {
  const users = readUsers();
  const target = users.find(
    (user) =>
      user.role === "student" &&
      user.teacherUsername === teacherUsername &&
      user.id === studentId
  );

  if (!target) {
    return { ok: false, message: "未找到该学员账号" };
  }

  const nextExpiryPreset = input.expiryPreset || target.expiryPreset || "unlimited";
  const nextClassId =
    input.classId === undefined ? target.classId || "" : input.classId || "";
  const nextClassName = formatClassName(
    teacherUsername,
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
      nextExpiryPreset === "unlimited" ? null : resolvedExpiryAt ?? target.expiryAt ?? null,
    updatedAt: Date.now(),
  };

  writeUsers(users.map((user) => (user.id === target.id ? updatedTarget : user)));
  return { ok: true, data: updatedTarget };
};

export const assignStudentClass = (
  teacherUsername: string,
  studentId: string,
  classId: string
): Result<AppUser> => {
  const className = formatClassName(teacherUsername, classId);
  return updateStudentAccount(teacherUsername, studentId, { classId, className });
};

export const setStudentStatus = (
  teacherUsername: string,
  studentId: string,
  status: StudentStatus
): Result<AppUser> => {
  const users = readUsers();
  const target = users.find(
    (user) =>
      user.role === "student" &&
      user.teacherUsername === teacherUsername &&
      user.id === studentId
  );

  if (!target) {
    return { ok: false, message: "未找到该学员账号" };
  }

  const updated = {
    ...target,
    status,
    updatedAt: Date.now(),
  };

  writeUsers(users.map((user) => (user.id === target.id ? updated : user)));
  return { ok: true, data: updated };
};

export const resetStudentPassword = (
  teacherUsername: string,
  studentId: string
): Result<{ password: string }> => {
  const users = readUsers();
  const target = users.find(
    (user) =>
      user.role === "student" &&
      user.teacherUsername === teacherUsername &&
      user.id === studentId
  );

  if (!target) {
    return { ok: false, message: "未找到该学员账号" };
  }

  const password = buildInitialPassword(target.username);
  const updated = {
    ...target,
    password,
    updatedAt: Date.now(),
  };

  writeUsers(users.map((user) => (user.id === target.id ? updated : user)));
  return { ok: true, data: { password } };
};

export const deleteStudentAccount = (
  teacherUsername: string,
  studentId: string
): Result => {
  const target = readUsers().find(
    (user) =>
      user.role === "student" &&
      user.teacherUsername === teacherUsername &&
      user.id === studentId
  );

  if (!target) {
    return { ok: false, message: "未找到该学员账号" };
  }

  const users = readUsers();
  const next = users.filter(
    (user) =>
      !(
        user.role === "student" &&
        user.teacherUsername === teacherUsername &&
        user.id === studentId
      )
  );

  writeUsers(next);
  deleteUserRecords(target.username);
  return { ok: true, data: undefined };
};
