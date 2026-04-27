"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import React, { useEffect, useState } from "react";
import AuthGate from "@/components/AuthGate";
import TeacherShell from "@/components/teacher/TeacherShell";
import { getSessionProfile, type SessionUser } from "@/lib/clientAuth";
import { getTeacherModule, getTeacherOverview } from "@/lib/teacherPortal";

function TeacherPlaceholderContent() {
  const params = useParams<{ slug: string }>();
  const [session, setSession] = useState<SessionUser | null>(null);

  useEffect(() => {
    setSession(getSessionProfile());
  }, []);

  if (!session) {
    return null;
  }

  const slug = params?.slug;
  if (!slug || Array.isArray(slug)) {
    return null;
  }

  const module = getTeacherModule(slug);
  const overview = getTeacherOverview(session);

  if (!module) {
    return (
      <TeacherShell session={session} title="页面不存在" backHref="/teacher">
        <div className="rounded-[1.8rem] bg-white p-8 text-center text-slate-500">
          未找到对应的老师端页面。
        </div>
      </TeacherShell>
    );
  }

  return (
    <TeacherShell
      session={session}
      title={module.title}
      subtitle={module.subtitle}
      backHref="/teacher"
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section className={`rounded-[1.8rem] bg-gradient-to-br ${module.tone} p-5 shadow-[0_24px_70px_rgba(148,163,184,0.12)]`}>
          <div className="rounded-[1.35rem] bg-white/75 p-5">
            <div className="grid h-12 w-12 place-items-center rounded-[1rem] bg-slate-900 text-2xl font-black text-white">
              {module.badge}
            </div>
            <h2 className="mt-5 text-[2rem] font-black text-slate-900">
              {module.title}
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">
              当前已按老师端结构接入独立入口。这个模块的完整业务逻辑还未展开，
              但页面入口、布局风格和数据联动骨架已经接好，后续可以继续在这个页面上扩展。
            </p>

            {slug === "data" ? (
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <div className="rounded-[1.25rem] bg-slate-50 p-4">
                  <p className="text-sm text-slate-500">总学员数</p>
                  <p className="mt-2 text-[2rem] font-black text-slate-900">
                    {overview.totalStudents}
                  </p>
                </div>
                <div className="rounded-[1.25rem] bg-slate-50 p-4">
                  <p className="text-sm text-slate-500">总班级数</p>
                  <p className="mt-2 text-[2rem] font-black text-slate-900">
                    {overview.totalClasses}
                  </p>
                </div>
                <div className="rounded-[1.25rem] bg-slate-50 p-4">
                  <p className="text-sm text-slate-500">激活学员</p>
                  <p className="mt-2 text-[2rem] font-black text-slate-900">
                    {overview.activeStudents}
                  </p>
                </div>
                <div className="rounded-[1.25rem] bg-slate-50 p-4">
                  <p className="text-sm text-slate-500">未登录学员</p>
                  <p className="mt-2 text-[2rem] font-black text-slate-900">
                    {overview.neverLoggedStudents}
                  </p>
                </div>
              </div>
            ) : (
              <div className="mt-5 rounded-[1.25rem] border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                建议下一步在这个模块里继续补业务表单、列表和统计卡片。
              </div>
            )}
          </div>
        </section>

        <aside className="space-y-4">
          <div className="rounded-[1.8rem] bg-white p-4 shadow-[0_20px_50px_rgba(148,163,184,0.12)]">
            <h3 className="text-xl font-black text-slate-900">快速入口</h3>
            <div className="mt-4 space-y-3">
              <Link
                href="/teacher/students"
                className="block rounded-[1.2rem] bg-slate-50 px-4 py-3.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
              >
                学员管理
              </Link>
              <Link
                href="/teacher/students/new"
                className="block rounded-[1.2rem] bg-slate-50 px-4 py-3.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
              >
                添加学员
              </Link>
              <Link
                href="/teacher/classes"
                className="block rounded-[1.2rem] bg-slate-50 px-4 py-3.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
              >
                班级管理
              </Link>
            </div>
          </div>

          <div className="rounded-[1.8rem] bg-white p-4 shadow-[0_20px_50px_rgba(148,163,184,0.12)]">
            <h3 className="text-xl font-black text-slate-900">当前数据</h3>
            <div className="mt-4 space-y-3 text-sm text-slate-600">
              <p>总学员：{overview.totalStudents}</p>
              <p>激活学员：{overview.activeStudents}</p>
              <p>停用学员：{overview.inactiveStudents}</p>
              <p>累计测评：{overview.totalRecords}</p>
            </div>
          </div>
        </aside>
      </div>
    </TeacherShell>
  );
}

export default function TeacherPlaceholderPage() {
  return (
    <AuthGate allowedRoles={["teacher"]}>
      <TeacherPlaceholderContent />
    </AuthGate>
  );
}
