"use client";

import Link from "next/link";
import React, { useEffect, useState } from "react";
import AuthGate from "@/components/AuthGate";
import TeacherShell from "@/components/teacher/TeacherShell";
import { getSessionProfile, type SessionUser } from "@/lib/clientAuth";
import {
  bootstrapPortalFromLocal,
  getTeacherOverview,
  syncTeacherPortalCache,
  type TeacherOverview,
} from "@/lib/portalClient";
import {
  primaryTeacherModules,
  sideTeacherModules,
  utilityTeacherModules,
} from "@/lib/teacherPortal";

function TeacherDashboardContent() {
  const [session, setSession] = useState<SessionUser | null>(null);
  const [overview, setOverview] = useState<TeacherOverview | null>(null);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const current = getSessionProfile();
      if (!current) return;

      setSession(current);

      try {
        await bootstrapPortalFromLocal();
        await syncTeacherPortalCache(current.username);
        const nextOverview = await getTeacherOverview(current.username);
        if (!cancelled) {
          setOverview(nextOverview);
        }
      } catch {
        if (!cancelled) {
          setOverview({
            totalStudents: 0,
            activeStudents: 0,
            inactiveStudents: 0,
            neverLoggedStudents: 0,
            totalClasses: 0,
            totalRecords: 0,
          });
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, []);

  if (!session || !overview) {
    return null;
  }

  return (
    <TeacherShell
      session={session}
      title="个人中心"
      subtitle="老师端负责创建学生账号、管理班级与查看教学经营数据。"
    >
      <div className="grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
        <div className="space-y-6">
          <section className="rounded-[1.8rem] bg-white p-5 shadow-[0_20px_60px_rgba(148,163,184,0.14)]">
            <div className="mx-auto mb-4 flex w-fit items-center gap-2 rounded-full bg-gradient-to-r from-sky-500 to-indigo-500 px-4 py-2 text-base font-bold text-white">
              个人中心
            </div>
            <div className="flex items-center gap-4">
              <div className="h-20 w-20 overflow-hidden rounded-full border-4 border-sky-100">
                <img
                  src="/pixel-logo.png"
                  alt="teacher avatar"
                  className="h-full w-full object-cover"
                />
              </div>
              <div>
                <h2 className="text-3xl font-black text-slate-900">
                  {session.displayName}
                </h2>
                <p className="mt-1.5 text-sm text-slate-500">{session.username}</p>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-3 gap-3 border-t border-dashed border-slate-200 pt-4 text-center">
              <div className="rounded-2xl bg-slate-50 px-3 py-3.5">
                <p className="text-2xl font-black text-slate-900">
                  {overview.totalStudents}
                </p>
                <p className="mt-1 text-xs text-slate-500">学员</p>
              </div>
              <div className="rounded-2xl bg-slate-50 px-3 py-3.5">
                <p className="text-2xl font-black text-slate-900">
                  {overview.totalClasses}
                </p>
                <p className="mt-1 text-xs text-slate-500">班级</p>
              </div>
              <div className="rounded-2xl bg-slate-50 px-3 py-3.5">
                <p className="text-2xl font-black text-slate-900">
                  {overview.totalRecords}
                </p>
                <p className="mt-1 text-xs text-slate-500">测评</p>
              </div>
            </div>
          </section>

          <section className="rounded-[1.8rem] bg-white p-4 shadow-[0_20px_60px_rgba(148,163,184,0.14)]">
            <div className="grid grid-cols-2 gap-3">
              {utilityTeacherModules.map((module) => (
                <Link
                  key={module.slug}
                  href={`/teacher/${module.slug}`}
                  className={`rounded-[1.55rem] bg-gradient-to-br ${module.tone} p-4 transition hover:-translate-y-0.5 ${module.cardClass || "shadow-lg"}`}
                >
                  <div className="grid h-11 w-11 place-items-center rounded-2xl bg-blue-600 text-xl font-black text-white shadow-sm">
                    {module.badge}
                  </div>
                  <h3 className={`mt-4 text-xl font-black ${module.titleClass || "text-white"}`}>{module.title}</h3>
                  <p className={`mt-1.5 text-sm ${module.subtitleClass || "text-white/90"}`}>{module.subtitle}</p>
                </Link>
              ))}
            </div>
          </section>
        </div>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_310px]">
          <section className="rounded-[1.8rem] bg-white/65 p-3.5 shadow-[0_24px_70px_rgba(125,211,252,0.14)] backdrop-blur">
            <div className="grid gap-4 md:grid-cols-2">
              {primaryTeacherModules.map((module) => (
                <Link
                  key={module.slug}
                  href={`/teacher/${module.slug}`}
                  className={`overflow-hidden rounded-[1.6rem] border border-white/70 bg-gradient-to-br ${module.tone} p-4 transition hover:-translate-y-1 hover:shadow-xl ${module.cardClass || ""}`}
                >
                  <div className={`flex h-44 flex-col justify-between rounded-[1.35rem] p-4 ${module.innerClass || "bg-white/45"}`}>
                    <div className="flex items-center gap-3">
                      <div className="grid h-12 w-12 place-items-center rounded-[1rem] bg-blue-600 text-2xl font-black text-white shadow-md">
                        {module.badge}
                      </div>
                    </div>
                    <div>
                      <h3 className={`mt-2.5 text-[2rem] font-black tracking-tight ${module.titleClass || "text-slate-900"}`}>
                        {module.title}
                      </h3>
                      <p className={`mt-2 text-sm leading-6 ${module.subtitleClass || "text-slate-600"}`}>
                        {module.subtitle}
                      </p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>

          <section className="space-y-4">
            {sideTeacherModules.map((module) => (
              <Link
                key={module.slug}
                href={`/teacher/${module.slug}`}
                className="block rounded-[1.7rem] border border-sky-300/80 bg-sky-100/45 p-4 shadow-[0_20px_55px_rgba(125,211,252,0.14)] backdrop-blur-sm transition hover:-translate-y-0.5"
              >
                <div className="flex items-center gap-4">
                  <div className="grid h-12 w-12 place-items-center rounded-[1rem] bg-white text-lg font-black text-slate-900 shadow-sm">
                    {module.badge}
                  </div>
                  <div className="min-w-0 flex-1 rounded-[1.15rem] bg-white/55 px-4 py-3 ring-1 ring-white/60">
                    <h3 className="text-xl font-black text-slate-900">{module.title}</h3>
                    <p className="mt-1 text-[13px] text-slate-600">{module.subtitle}</p>
                  </div>
                </div>
              </Link>
            ))}
          </section>
        </div>
      </div>

      <div className="mt-7 grid gap-3 rounded-[1.8rem] bg-white/80 p-3 shadow-[0_20px_60px_rgba(148,163,184,0.12)] md:grid-cols-3">
        <Link
          href="/"
          className="rounded-[1.4rem] bg-slate-50 px-5 py-4 text-center text-xl font-black text-slate-400 transition hover:bg-slate-100"
        >
          教学
        </Link>
        <div className="rounded-[1.4rem] bg-white px-5 py-4 text-center text-xl font-black text-slate-900 shadow-md">
          管理
        </div>
        <Link
          href="/teacher/events"
          className="rounded-[1.4rem] bg-slate-50 px-5 py-4 text-center text-xl font-black text-slate-400 transition hover:bg-slate-100"
        >
          拓展
        </Link>
      </div>
    </TeacherShell>
  );
}

export default function TeacherDashboardPage() {
  return (
    <AuthGate allowedRoles={["teacher"]}>
      <TeacherDashboardContent />
    </AuthGate>
  );
}
