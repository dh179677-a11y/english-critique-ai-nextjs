export interface LocalUser {
  username: string;
  password: string;
  createdAt: number;
}

const USERS_KEY = "ep_users";
const SESSION_KEY = "ep_current_user";
const DEFAULT_INVITE_CODE = "VIP888";

const isBrowser = () => typeof window !== "undefined";

const readUsers = (): LocalUser[] => {
  if (!isBrowser()) return [];

  try {
    const raw = window.localStorage.getItem(USERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LocalUser[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeUsers = (users: LocalUser[]) => {
  if (!isBrowser()) return;
  window.localStorage.setItem(USERS_KEY, JSON.stringify(users));
};

export const getInviteCode = (): string => {
  return process.env.NEXT_PUBLIC_INVITE_CODE || DEFAULT_INVITE_CODE;
};

export const getSessionUser = (): string | null => {
  if (!isBrowser()) return null;
  return window.localStorage.getItem(SESSION_KEY);
};

export const setSessionUser = (username: string) => {
  if (!isBrowser()) return;
  window.localStorage.setItem(SESSION_KEY, username);
};

export const clearSessionUser = () => {
  if (!isBrowser()) return;
  window.localStorage.removeItem(SESSION_KEY);
};

export const registerUser = (input: {
  username: string;
  password: string;
  inviteCode: string;
}): { ok: true } | { ok: false; message: string } => {
  const username = input.username.trim();
  const password = input.password.trim();
  const inviteCode = input.inviteCode.trim();

  if (!username || !password || !inviteCode) {
    return { ok: false, message: "请完整填写用户名、密码和邀请码" };
  }

  if (inviteCode !== getInviteCode()) {
    return { ok: false, message: "邀请码错误，无法注册" };
  }

  const users = readUsers();
  const exists = users.some((u) => u.username === username);

  if (exists) {
    return { ok: false, message: "用户名已存在，请更换" };
  }

  users.push({
    username,
    password,
    createdAt: Date.now(),
  });
  writeUsers(users);

  return { ok: true };
};

export const loginUser = (input: {
  username: string;
  password: string;
}): { ok: true } | { ok: false; message: string } => {
  const username = input.username.trim();
  const password = input.password.trim();

  if (!username || !password) {
    return { ok: false, message: "请输入用户名和密码" };
  }

  const users = readUsers();
  const user = users.find((u) => u.username === username);

  if (!user || user.password !== password) {
    return { ok: false, message: "用户名或密码错误" };
  }

  setSessionUser(username);
  return { ok: true };
};
