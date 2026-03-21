"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import React, { useEffect, useState } from "react";
import { getSessionUser, loginUser } from "@/lib/clientAuth";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (getSessionUser()) {
      router.replace("/");
    }
  }, [router]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const result = loginUser({ username, password });

    if (!result.ok) {
      setError(result.message);
      return;
    }

    router.replace("/");
  };

  return (
    <div className="min-h-screen bg-gray-100 px-4 py-10 md:py-12 overflow-x-hidden">
      <div className="max-w-5xl mx-auto origin-top scale-[0.7]">
        <div className="flex flex-col items-center text-center mb-8 md:mb-10">
          <div className="h-[115px] w-[115px] mb-5">
            <Image
              src="/pixel-logo.png"
              alt="EnglishPro logo"
              width={115}
              height={115}
              className="h-full w-full object-cover rounded-full shadow-lg"
              priority
            />
          </div>
          <h1 className="text-4xl md:text-6xl font-bold text-slate-900 tracking-tight">EnglishPro Critique AI</h1>
          <p className="text-2xl md:text-3xl mt-2 text-slate-600 font-medium">智能口语测评助手登录</p>
          <p className="text-[20px] mt-3 text-slate-600">
            为学生提供精准的口语发音、流利度及语调分析，让进步清晰可见。
          </p>
        </div>

        <div className="max-w-[38.64rem] mx-auto bg-white rounded-2xl shadow-sm border border-gray-200 p-8 md:p-10">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-xl font-semibold text-slate-700 mb-2">用户名 (Username)</label>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-gray-300 text-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder=""
              />
            </div>

            <div>
              <label className="block text-xl font-semibold text-slate-700 mb-2">密码 (Password)</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-gray-300 text-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder=""
              />
            </div>

            {error ? (
              <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {error}
              </div>
            ) : null}

            <button
              type="submit"
              className="w-full py-3 rounded-xl bg-blue-600 text-white text-xl font-semibold hover:bg-blue-700 transition-colors"
            >
              登录 (Sign in)
            </button>
          </form>

          <div className="my-7 flex items-center gap-4 text-gray-500">
            <div className="h-px bg-gray-300 flex-1" />
            <span className="text-xl font-medium">没有账号?</span>
            <div className="h-px bg-gray-300 flex-1" />
          </div>

          <Link
            href="/register"
            className="w-full block text-center py-3 rounded-xl border border-gray-300 text-slate-700 text-xl font-semibold hover:bg-gray-50 transition-colors"
          >
            去注册 (Go to Register)
          </Link>
        </div>
      </div>
    </div>
  );
}
