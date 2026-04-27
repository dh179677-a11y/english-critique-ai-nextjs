"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useEffect, useState } from "react";
import {
  getHomePathForRole,
  getSessionProfile,
  registerTeacher,
  setSessionUser,
} from "@/lib/clientAuth";

export default function RegisterPage() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const session = getSessionProfile();
    if (session) {
      router.replace(getHomePathForRole(session.role));
    }
  }, [router]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const result = registerTeacher({
      displayName,
      username,
      password,
      inviteCode,
    });

    if (!result.ok) {
      setError(result.message);
      return;
    }

    setSessionUser(result.data);
    router.replace("/teacher");
  };

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,_#e0f2fe,_#f8fbff_42%,_#ffffff)] px-4 py-8">
      <div className="mx-auto max-w-lg rounded-[1.8rem] border border-white/80 bg-white/90 p-6 shadow-[0_24px_70px_rgba(59,130,246,0.1)] backdrop-blur md:p-7">
        <div className="mb-6">
          <p className="text-sm font-semibold uppercase tracking-[0.28em] text-blue-600">
            Teacher Register
          </p>
          <h1 className="mt-2.5 text-2xl font-black text-slate-900">创建老师账号</h1>
          <p className="mt-3 text-sm leading-6 text-slate-500">
            这里只用于老师端注册。学生账号必须由老师进入管理后台后手动创建。
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">
              老师姓名
            </label>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-blue-400 focus:bg-white"
              placeholder="例如：英爸 / 校长"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">
              登录账号
            </label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-blue-400 focus:bg-white"
              placeholder="请输入老师账号"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">
              登录密码
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-blue-400 focus:bg-white"
              placeholder="请输入密码"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">
              邀请码
            </label>
            <input
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-blue-400 focus:bg-white"
              placeholder="请输入老师邀请码"
            />
          </div>

          {error ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            className="w-full rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700"
          >
            完成老师注册
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-600">
          已有账号？
          <Link href="/login" className="ml-1 font-semibold text-blue-600 hover:text-blue-700">
            返回登录
          </Link>
        </p>
      </div>
    </div>
  );
}
