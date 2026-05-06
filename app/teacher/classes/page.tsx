"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";
import AuthGate from "@/components/AuthGate";
import TeacherShell from "@/components/teacher/TeacherShell";
import {
  getSessionProfile,
  type AppUser,
  type SessionUser,
  type TeacherClass,
} from "@/lib/clientAuth";
import { getClassCapacityLabel, getClassCoverTheme } from "@/lib/classPortal";
import {
  bootstrapPortalFromLocal,
  createTeacherClass,
  deleteTeacherClass,
  getTeacherClasses,
  getTeacherStudents,
  getUserRecords,
} from "@/lib/portalClient";

type ClassFilter = "all" | "with_students" | "empty";

function TeacherClassesContent() {
  const [session, setSession] = useState<SessionUser | null>(null);
  const [classes, setClasses] = useState<TeacherClass[]>([]);
  const [className, setClassName] = useState("");
  const [keyword, setKeyword] = useState("");
  const [filter, setFilter] = useState<ClassFilter>("all");
  const [showCreate, setShowCreate] = useState(false);
  const [message, setMessage] = useState("");
  const [students, setStudents] = useState<AppUser[]>([]);
  const [recordCountByUsername, setRecordCountByUsername] = useState<
    Record<string, number>
  >({});
  const [loading, setLoading] = useState(true);

  const loadData = async (current: SessionUser) => {
    const [nextClasses, nextStudents] = await Promise.all([
      getTeacherClasses(current.username),
      getTeacherStudents(current.username),
    ]);
    const recordLists = await Promise.all(
      nextStudents.map((student) => getUserRecords(student.username))
    );
    const counts = Object.fromEntries(
      nextStudents.map((student, index) => [
        student.username,
        recordLists[index].length,
      ])
    );

    setClasses(nextClasses);
    setStudents(nextStudents);
    setRecordCountByUsername(counts);
  };

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const current = getSessionProfile();
      if (!current) return;
      setSession(current);

      try {
        await bootstrapPortalFromLocal();
        await loadData(current);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, []);

  const filteredClasses = useMemo(() => {
    const query = keyword.trim().toLowerCase();

    return classes.filter((item) => {
      const memberCount = students.filter((student) => student.classId === item.id).length;
      const matchesKeyword =
        !query || item.name.toLowerCase().includes(query);

      if (!matchesKeyword) return false;
      if (filter === "with_students") return memberCount > 0;
      if (filter === "empty") return memberCount === 0;
      return true;
    });
  }, [classes, filter, keyword, students]);

  if (!session || loading) {
    return null;
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      const result = await createTeacherClass(session.username, className);
      setClassName("");
      setShowCreate(false);
      setMessage(`已创建班级：${result.name}`);
      await loadData(session);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "创建班级失败");
    }
  };

  const handleDelete = async (classId: string) => {
    try {
      await deleteTeacherClass(session.username, classId);
      setMessage("班级已删除");
      await loadData(session);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "删除班级失败");
    }
  };

  return (
    <TeacherShell
      session={session}
      title="所有班级"
      subtitle="查看老师名下的全部班级，进入班级后可继续管理课程、成员、教材、任务和动态。"
      backHref="/teacher"
      actions={
        <>
          <button
            type="button"
            onClick={() => setMessage("班级入口已经接好，支持继续扩展排课、教材和任务。")}
            className="rounded-full bg-white px-5 py-3 text-base font-black text-slate-800 shadow-md transition hover:bg-slate-50"
          >
            ？
          </button>
          <button
            type="button"
            onClick={() => setShowCreate((current) => !current)}
            className="rounded-full bg-white px-6 py-3 text-base font-black text-slate-800 shadow-md transition hover:bg-slate-50"
          >
            创建
          </button>
          <div className="rounded-full bg-white px-4 py-2.5 shadow-md">
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索"
              className="w-28 bg-transparent text-base font-black text-slate-800 outline-none placeholder:text-slate-400 md:w-36"
            />
          </div>
          <div className="rounded-full bg-white px-4 py-2.5 shadow-md">
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as ClassFilter)}
              className="bg-transparent text-base font-black text-slate-800 outline-none"
            >
              <option value="all">筛选</option>
              <option value="with_students">有学员</option>
              <option value="empty">空班级</option>
            </select>
          </div>
        </>
      }
    >
      {message ? (
        <div className="mb-5 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-700">
          {message}
        </div>
      ) : null}

      {showCreate ? (
        <section className="mb-5 rounded-[1.8rem] border border-white/80 bg-white/85 p-5 shadow-[0_24px_70px_rgba(125,211,252,0.14)]">
          <form
            onSubmit={handleCreate}
            className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_140px]"
          >
            <div>
              <h2 className="text-2xl font-black text-slate-900">创建班级</h2>
              <p className="mt-2 text-sm text-slate-500">
                建议使用课程名或营期名，例如“牛津树带读营”“Stage 1 寒假班”。
              </p>
              <input
                value={className}
                onChange={(e) => setClassName(e.target.value)}
                className="mt-4 w-full rounded-[1.4rem] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-blue-400 focus:bg-white"
                placeholder="请输入班级名称"
              />
            </div>
            <div className="grid gap-3 self-end">
              <button
                type="submit"
                className="rounded-[1.3rem] bg-blue-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-blue-700"
              >
                完成创建
              </button>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="rounded-[1.3rem] border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
              >
                取消
              </button>
            </div>
          </form>
        </section>
      ) : null}

      <div className="mb-5 flex items-center gap-6 px-2 text-[2rem] font-black tracking-tight text-slate-900">
        <span className="relative">
          所有班级
          <span className="absolute bottom-0 left-1 h-2 w-14 rounded-full bg-blue-200/75" />
        </span>
        <span className="text-slate-500">我的班级</span>
      </div>

      {filteredClasses.length === 0 ? (
        <div className="rounded-[2rem] border border-dashed border-slate-200 bg-white/80 px-6 py-16 text-center text-slate-500 shadow-[0_24px_70px_rgba(148,163,184,0.1)]">
          还没有匹配的班级。先创建班级，或调整搜索和筛选条件。
        </div>
      ) : (
        <div className="grid gap-5 xl:grid-cols-3 md:grid-cols-2">
          {filteredClasses.map((item, index) => {
            const theme = getClassCoverTheme(item.name, index);
            const classStudents = students.filter((student) => student.classId === item.id);
            const recordCount = classStudents.reduce(
              (sum, student) => sum + (recordCountByUsername[student.username] || 0),
              0
            );

            return (
              <article
                key={item.id}
                className={`overflow-hidden rounded-[2rem] border p-4 ${theme.shellClass}`}
              >
                <Link href={`/teacher/classes/${item.id}`} className="block">
                  <div className={`relative overflow-hidden rounded-[1.55rem] ${theme.coverClass}`}>
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(255,255,255,0.28),_transparent_40%)]" />
                    <div className="flex min-h-[12rem] items-end justify-between px-5 py-5">
                      <div>
                        <div className="inline-flex items-center rounded-full bg-white/18 px-3 py-1 text-xs font-semibold text-white/90 backdrop-blur-sm">
                          班级工作台
                        </div>
                        <p className="mt-4 text-[2.1rem] font-black text-white">
                          {theme.badgeText}
                        </p>
                      </div>
                      <div className={`rounded-full px-3 py-1 text-sm font-semibold ${theme.chipClass}`}>
                        {getClassCapacityLabel(classStudents.length)}
                      </div>
                    </div>
                  </div>
                </Link>

                <div className="px-2 pb-1 pt-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        href={`/teacher/classes/${item.id}`}
                        className="line-clamp-2 text-[2rem] font-black leading-tight text-slate-900 transition hover:text-blue-600"
                      >
                        {item.name}
                      </Link>
                      <div className="mt-3 space-y-1.5 text-sm text-slate-500">
                        <p>老师：{session.displayName}</p>
                        <p className={theme.accentClass}>
                          关联课程 · 已累计 {recordCount} 条测评记录
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDelete(item.id)}
                      className="rounded-full border border-rose-200 px-3 py-1 text-xs font-bold text-rose-600 transition hover:bg-rose-50"
                    >
                      删除
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </TeacherShell>
  );
}

export default function TeacherClassesPage() {
  return (
    <AuthGate allowedRoles={["teacher"]}>
      <TeacherClassesContent />
    </AuthGate>
  );
}
