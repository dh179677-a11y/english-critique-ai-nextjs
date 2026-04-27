"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";
import AuthGate from "@/components/AuthGate";
import TeacherShell from "@/components/teacher/TeacherShell";
import {
  assignStudentClass,
  deleteStudentAccount,
  getSessionProfile,
  getStudentStatusLabel,
  getTeacherClasses,
  getTeacherStudents,
  resetStudentPassword,
  setStudentStatus,
  type AppUser,
  type SessionUser,
  type TeacherClass,
} from "@/lib/clientAuth";

type StatusFilter = "all" | "active" | "inactive" | "expired";

const formatExpiry = (student: AppUser) => {
  if (!student.expiryAt) return "无限期";
  return new Date(student.expiryAt).toLocaleDateString("zh-CN");
};

function TeacherStudentsContent() {
  const [session, setSession] = useState<SessionUser | null>(null);
  const [students, setStudents] = useState<AppUser[]>([]);
  const [classes, setClasses] = useState<TeacherClass[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [keyword, setKeyword] = useState("");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [menuId, setMenuId] = useState<string | null>(null);

  const loadData = (current: SessionUser) => {
    setStudents(getTeacherStudents(current.username));
    setClasses(getTeacherClasses(current.username));
  };

  useEffect(() => {
    const current = getSessionProfile();
    if (!current) return;
    setSession(current);
    loadData(current);
  }, []);

  const filteredStudents = useMemo(() => {
    return students.filter((student) => {
      const query = keyword.trim().toLowerCase();
      const matchesKeyword =
        !query ||
        student.displayName.toLowerCase().includes(query) ||
        student.username.toLowerCase().includes(query) ||
        (student.className || "").toLowerCase().includes(query);

      if (!matchesKeyword) return false;

      if (statusFilter === "all") return true;
      if (statusFilter === "active") return getStudentStatusLabel(student) === "使用中";
      if (statusFilter === "inactive") return getStudentStatusLabel(student) === "已停用";
      return getStudentStatusLabel(student) === "已过期";
    });
  }, [keyword, statusFilter, students]);

  if (!session) {
    return null;
  }

  const activeCount = students.filter(
    (student) => getStudentStatusLabel(student) === "使用中"
  ).length;
  const neverLoggedCount = students.filter((student) => !student.lastLoginAt).length;

  const toggleSelection = (studentId: string) => {
    setSelectedIds((current) =>
      current.includes(studentId)
        ? current.filter((id) => id !== studentId)
        : [...current, studentId]
    );
  };

  const handleInvite = async () => {
    const targets =
      selectedIds.length > 0
        ? students.filter((student) => selectedIds.includes(student.id))
        : filteredStudents;

    if (targets.length === 0) {
      setMessage("没有可邀请的学员账号");
      return;
    }

    const content = targets
      .map(
        (student) =>
          `${student.displayName}\n账号：${student.username}\n密码：${student.password}\n登录地址：http://localhost:3000/login`
      )
      .join("\n\n");

    try {
      await navigator.clipboard.writeText(content);
      setMessage(`已复制 ${targets.length} 个学员的登录信息`);
    } catch {
      setMessage("复制失败，请手动记录学员账号和密码");
    }
  };

  const handleAssignClass = (studentId: string, classId: string) => {
    const result = assignStudentClass(session.username, studentId, classId);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    setMessage(`已更新 ${result.data.displayName} 的班级`);
    loadData(session);
  };

  const handleResetPassword = (studentId: string) => {
    const result = resetStudentPassword(session.username, studentId);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    setMessage(`学员密码已重置，新密码：${result.data.password}`);
    setMenuId(null);
    loadData(session);
  };

  const handleStatusChange = (studentId: string, nextStatus: "active" | "inactive") => {
    const result = setStudentStatus(session.username, studentId, nextStatus);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    setMessage(
      `${result.data.displayName} 已${nextStatus === "active" ? "启用" : "停用"}`
    );
    setMenuId(null);
    loadData(session);
  };

  const handleDelete = (studentId: string) => {
    const result = deleteStudentAccount(session.username, studentId);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    setMessage("学员账号已删除");
    setMenuId(null);
    setSelectedIds((current) => current.filter((id) => id !== studentId));
    loadData(session);
  };

  return (
    <TeacherShell
      session={session}
      title="学员管理"
      subtitle="学生账号只能由老师创建。这里可以搜索、分班、邀请、重置密码和停用账号。"
      backHref="/teacher"
      actions={
        <>
          <button
            type="button"
            onClick={handleInvite}
            className="rounded-full bg-white px-5 py-3 text-base font-black text-slate-800 shadow-md transition hover:bg-slate-50"
          >
            邀请
          </button>
          <Link
            href="/teacher/students/new"
            className="rounded-full bg-white px-5 py-3 text-base font-black text-slate-800 shadow-md transition hover:bg-slate-50"
          >
            添加
          </Link>
          <button
            type="button"
            onClick={() => setSelectionMode((current) => !current)}
            className="rounded-full bg-white px-5 py-3 text-base font-black text-slate-800 shadow-md transition hover:bg-slate-50"
          >
            {selectionMode ? "取消勾选" : "勾选"}
          </button>
          <div className="rounded-full bg-white px-4 py-2.5 shadow-md">
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索"
              className="w-28 bg-transparent text-base font-black text-slate-800 outline-none placeholder:text-slate-400 md:w-36"
            />
          </div>
        </>
      }
    >
      {message ? (
        <div className="mb-5 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-700">
          {message}
        </div>
      ) : null}

      <div className="rounded-[1.8rem] bg-white px-4 py-4 shadow-[0_24px_70px_rgba(148,163,184,0.12)]">
        <div className="grid grid-cols-[1.55fr_0.95fr_0.95fr_1.05fr] gap-4 px-3 py-3 text-lg font-black text-slate-900">
          <div>学员信息</div>
          <div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              className="w-full bg-transparent text-lg font-black outline-none"
            >
              <option value="all">状态</option>
              <option value="active">使用中</option>
              <option value="inactive">已停用</option>
              <option value="expired">已过期</option>
            </select>
          </div>
          <div>班级</div>
          <div>操作</div>
        </div>

        <div className="space-y-4">
          {filteredStudents.map((student, index) => (
            <div
              key={student.id}
              className="grid grid-cols-[1.55fr_0.95fr_0.95fr_1.05fr] gap-4 rounded-[1.5rem] border border-slate-100 px-3 py-4"
            >
              <div className="flex items-center gap-4">
                <div className="text-4xl font-black text-slate-700">
                  {String(filteredStudents.length - index).padStart(3, "0")}
                </div>
                {selectionMode ? (
                  <label className="grid h-7 w-7 place-items-center rounded-md border border-slate-300">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(student.id)}
                      onChange={() => toggleSelection(student.id)}
                      className="h-4 w-4"
                    />
                  </label>
                ) : null}
                <div className="grid h-16 w-16 place-items-center rounded-full bg-slate-100 text-2xl font-black text-slate-500">
                  {student.displayName.slice(0, 1)}
                </div>
                <div>
                  <Link
                    href={`/teacher/students/${student.id}`}
                    className="text-2xl font-black text-slate-900 transition hover:text-blue-600"
                  >
                    {student.displayName}
                  </Link>
                  <p className="mt-1.5 text-base text-slate-400">{student.username}</p>
                  <p className="mt-1.5 text-xs text-slate-400">
                    学号 {student.studentNo || "--"}
                  </p>
                </div>
              </div>

              <div>
                <p className="text-2xl font-black text-blue-600">
                  {getStudentStatusLabel(student)}
                </p>
                <p className="mt-1.5 text-base text-slate-700">
                  截止 {formatExpiry(student)}
                </p>
              </div>

              <div>
                <p className="text-2xl font-black text-blue-600">
                  {student.className || "未分班"}
                </p>
                <select
                  value={student.classId || ""}
                  onChange={(e) => handleAssignClass(student.id, e.target.value)}
                  className="mt-2.5 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 outline-none"
                >
                  <option value="">未分班</option>
                  {classes.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="relative flex items-start justify-between gap-2">
                <Link
                  href={`/teacher/students/${student.id}`}
                  className="rounded-2xl bg-slate-50 px-3.5 py-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                >
                  详情
                </Link>
                <button
                  type="button"
                  onClick={() =>
                    setMessage(`课程管理入口已为 ${student.displayName} 预留`)
                  }
                  className="rounded-2xl bg-slate-50 px-3.5 py-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                >
                  课程
                </button>
                <button
                  type="button"
                  onClick={() => setMenuId(menuId === student.id ? null : student.id)}
                  className="rounded-2xl bg-slate-50 px-3.5 py-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                >
                  更多
                </button>

                {menuId === student.id ? (
                  <div className="absolute right-0 top-12 z-10 w-48 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
                    <button
                      type="button"
                      onClick={() => handleResetPassword(student.id)}
                      className="block w-full rounded-xl px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      重置密码
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleStatusChange(
                          student.id,
                          student.status === "inactive" ? "active" : "inactive"
                        )
                      }
                      className="block w-full rounded-xl px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      {student.status === "inactive" ? "启用账号" : "停用账号"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(student.id)}
                      className="block w-full rounded-xl px-3 py-2 text-left text-sm font-medium text-rose-600 hover:bg-rose-50"
                    >
                      删除账号
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>

        {filteredStudents.length === 0 ? (
          <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50 px-6 py-10 text-center text-slate-500">
            当前没有符合筛选条件的学员。
          </div>
        ) : null}

        <div className="mt-4 text-lg font-black text-slate-500">
          已激活 {activeCount} | 未登录 {neverLoggedCount}
        </div>
      </div>
    </TeacherShell>
  );
}

export default function TeacherStudentsPage() {
  return (
    <AuthGate allowedRoles={["teacher"]}>
      <TeacherStudentsContent />
    </AuthGate>
  );
}
