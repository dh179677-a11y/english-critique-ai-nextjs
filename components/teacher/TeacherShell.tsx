"use client";

import Link from "next/link";
import React from "react";
import { clearSessionUser, type SessionUser } from "@/lib/clientAuth";

interface TeacherShellProps {
  session: SessionUser;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  backHref?: string;
  actions?: React.ReactNode;
}

const TeacherShell: React.FC<TeacherShellProps> = ({
  session,
  title,
  subtitle,
  children,
  backHref,
  actions,
}) => {
  const handleLogout = () => {
    clearSessionUser();
    window.location.href = "/login";
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#8edbff,_#e3f3ff_50%,_#f6fbff_100%)] px-4 py-5 md:px-5 md:py-6">
      <div className="page-shell">
        <header className="rounded-[1.75rem] border border-white/70 bg-white/35 p-3.5 shadow-[0_24px_80px_rgba(56,189,248,0.12)] backdrop-blur md:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex items-center gap-3 rounded-full bg-sky-500/75 px-3 py-2 text-white shadow-lg shadow-sky-400/15">
                <div className="h-12 w-12 overflow-hidden rounded-full border-2 border-white/70 bg-white/30">
                  <img
                    src="/pixel-logo.png"
                    alt="EnglishPro logo"
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="pr-2">
                  <p className="text-xs text-white/80">牛津树带读 | 英语</p>
                  <p className="text-lg font-black tracking-tight">{session.displayName}</p>
                </div>
              </div>
              <div className="inline-flex items-center gap-2 rounded-full bg-sky-400/65 px-4 py-3 text-base font-bold text-white shadow-lg shadow-sky-300/15">
                校长
                <span className="rounded-full bg-white/20 px-2 py-1 text-xs font-semibold">
                  老师端
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Link
                href="/teacher/messages"
                className="inline-flex items-center gap-3 rounded-full bg-white/55 px-4 py-3 text-base font-bold text-slate-800 transition hover:bg-white/75"
              >
                <span className="grid h-9 w-9 place-items-center rounded-full bg-green-400 text-sm text-white">
                  消
                </span>
                消息
              </Link>
              <Link
                href="/teacher/settings"
                className="inline-flex items-center gap-3 rounded-full bg-white/55 px-4 py-3 text-base font-bold text-slate-800 transition hover:bg-white/75"
              >
                <span className="grid h-9 w-9 place-items-center rounded-full bg-indigo-500 text-sm text-white">
                  设
                </span>
                设置
              </Link>
              <button
                type="button"
                onClick={handleLogout}
                className="rounded-full bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                退出登录
              </button>
            </div>
          </div>
        </header>

        <div className="mt-5 rounded-[1.85rem] border border-white/70 bg-white/55 p-4 shadow-[0_24px_80px_rgba(148,163,184,0.12)] backdrop-blur md:p-6">
          <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-4">
              {backHref ? (
                <Link
                  href={backHref}
                  className="grid h-10 w-10 place-items-center rounded-xl bg-white text-xl font-black text-slate-700 shadow-md transition hover:-translate-x-0.5"
                >
                  ←
                </Link>
              ) : null}
              <div>
                <h1 className="text-[2rem] font-black tracking-tight text-slate-900 md:text-[2.6rem]">
                  {title}
                </h1>
                {subtitle ? (
                  <p className="mt-2 max-w-3xl text-sm text-slate-600">{subtitle}</p>
                ) : null}
              </div>
            </div>
            {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
          </div>

          {children}
        </div>
      </div>
    </div>
  );
};

export default TeacherShell;
