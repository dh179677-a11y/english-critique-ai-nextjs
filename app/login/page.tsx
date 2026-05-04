"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useEffect, useState } from "react";
import {
  getHomePathForRole,
  getSessionProfile,
  hasTeacherAccount,
  loginUser,
} from "@/lib/clientAuth";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [teacherReady, setTeacherReady] = useState(false);

  useEffect(() => {
    const session = getSessionProfile();
    if (session) {
      router.replace(getHomePathForRole(session.role));
      return;
    }

    setTeacherReady(hasTeacherAccount());
  }, [router]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const result = loginUser({ username, password });

    if (!result.ok) {
      setError(result.message);
      return;
    }

    router.replace(result.data.redirectTo);
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_#d7f1ff,_#eff6ff_45%,_#ffffff_80%)] px-4 py-8 md:py-10">
      <div className="page-shell max-w-5xl">
        <div className="grid gap-6 lg:grid-cols-[0.618fr_0.382fr] lg:items-center">
          <section className="rounded-[1.8rem] border border-white/70 bg-white/75 p-6 shadow-[0_30px_70px_rgba(88,136,255,0.1)] backdrop-blur md:p-7">
            <div className="inline-flex items-center gap-3 rounded-full bg-sky-100 px-4 py-2 text-sm font-semibold text-sky-700">
              <span className="h-2.5 w-2.5 rounded-full bg-sky-500" />
              Teacher + Student Portal
            </div>
            <div className="mt-6 flex items-center gap-4">
              <div className="h-16 w-16 overflow-hidden rounded-[1.4rem] shadow-lg">
                <img
                  src="/pixel-logo.png"
                  alt="EnglishPro logo"
                  width={64}
                  height={64}
                  className="h-full w-full object-cover"
                />
              </div>
              <div>
                <h1 className="text-3xl font-black tracking-tight text-slate-900 md:text-4xl">
                  EnglishPro
                </h1>
                <p className="mt-1.5 text-base text-slate-600 md:text-lg">
                  学生端测评 + 老师端管理
                </p>
              </div>
            </div>

            <div className="mt-8 grid gap-4 md:grid-cols-2">
              <div className="rounded-[1.4rem] bg-gradient-to-br from-sky-500 to-cyan-400 p-5 text-white shadow-lg">
                <p className="text-xs uppercase tracking-[0.24em] text-white/80">
                  Student
                </p>
                <h2 className="mt-2.5 text-xl font-black">学生端</h2>
                <p className="mt-2.5 text-sm leading-6 text-white/90">
                  登录后上传口语视频，查看自己的 AI 测评记录与报告详情。
                </p>
              </div>
              <div className="rounded-[1.4rem] bg-gradient-to-br from-indigo-600 to-blue-500 p-5 text-white shadow-lg">
                <p className="text-xs uppercase tracking-[0.24em] text-white/80">
                  Teacher
                </p>
                <h2 className="mt-2.5 text-xl font-black">老师端</h2>
                <p className="mt-2.5 text-sm leading-6 text-white/90">
                  老师可管理学员、班级与账号状态，学生不能自行注册。
                </p>
              </div>
            </div>
          </section>

          <section className="rounded-[1.8rem] border border-slate-200 bg-white p-6 shadow-[0_24px_60px_rgba(15,23,42,0.06)] md:p-7">
            <div className="mb-6">
              <p className="text-sm font-semibold uppercase tracking-[0.28em] text-blue-600">
                Sign in
              </p>
              <h2 className="mt-2.5 text-2xl font-black text-slate-900">账号登录</h2>
              <p className="mt-3 text-sm leading-6 text-slate-500">
                学生账号需要由老师端创建后才能登录。老师账号可通过邀请码注册。
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">
                  账号
                </label>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-blue-400 focus:bg-white"
                  placeholder="老师账号或学生账号"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">
                  密码
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-blue-400 focus:bg-white"
                  placeholder="请输入密码"
                />
              </div>

              {error ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
                  {error}
                </div>
              ) : null}

              <button
                type="submit"
                className="w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                进入系统
              </button>
            </form>

            <div className="mt-6 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
              {teacherReady ? (
                <p>
                  需要新增老师账号？
                  <Link
                    href="/register"
                    className="ml-1 font-semibold text-blue-600 hover:text-blue-700"
                  >
                    前往老师注册
                  </Link>
                </p>
              ) : (
                <p>
                  当前还没有老师账号。
                  <Link
                    href="/register"
                    className="ml-1 font-semibold text-blue-600 hover:text-blue-700"
                  >
                    先创建首个老师账号
                  </Link>
                </p>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
