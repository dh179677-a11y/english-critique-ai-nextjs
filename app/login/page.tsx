"use client";

import { useRouter } from "next/navigation";
import React, { useEffect, useState } from "react";
import {
  clearSessionUser,
  getHomePathForRole,
  setSessionUser,
} from "@/lib/clientAuth";
import {
  bootstrapPortalFromLocal,
  getServerSession,
  hydrateSessionCache,
  loginUser,
} from "@/lib/portalClient";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        const session = await getServerSession();
        if (session) {
          setSessionUser(session);
          router.replace(getHomePathForRole(session.role));
          return;
        }

        clearSessionUser();
        await bootstrapPortalFromLocal();
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "初始化登录数据失败");
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      await bootstrapPortalFromLocal();
      const user = await loginUser({ username, password });
      setSessionUser(user);
      await hydrateSessionCache(
        {
          username: user.username,
          role: user.role,
          displayName: user.displayName,
          teacherUsername: user.teacherUsername,
        },
        user
      );
      router.replace(getHomePathForRole(user.role));
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-[radial-gradient(circle_at_top_left,_#d7f1ff,_#eff6ff_45%,_#ffffff_80%)] px-4">
      <main className="flex flex-1 items-center justify-center py-8 md:py-10">
        <section className="w-full max-w-[322px] rounded-[1.8rem] border border-slate-200 bg-white p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)] md:p-8">
          <div className="mb-7 text-center">
            <div className="mx-auto h-16 w-16 overflow-hidden rounded-[1.4rem] shadow-lg">
              <img
                src="/pixel-logo.png"
                alt="EnglishPro logo"
                width={64}
                height={64}
                className="h-full w-full object-cover"
              />
            </div>
            <h1 className="mt-4 text-3xl font-black tracking-tight text-slate-900">
              EnglishPro
            </h1>
            <h2 className="mt-2 text-2xl font-black text-slate-900">账号登录</h2>
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
                placeholder="请输入账号"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">
                密码
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 pr-16 text-sm text-slate-900 outline-none transition focus:border-blue-400 focus:bg-white"
                  placeholder="请输入密码"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full px-2 py-1 text-xs font-bold text-blue-600 transition hover:bg-blue-50"
                  aria-label={showPassword ? "隐藏密码" : "显示密码"}
                >
                  {showPassword ? "隐藏" : "显示"}
                </button>
              </div>
            </div>

            {error ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
                {error}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              {submitting ? "登录中..." : "进入系统"}
            </button>
          </form>
        </section>
      </main>
      <footer className="pb-5 text-center text-xs font-medium text-slate-400">
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
          <a
            href="https://beian.miit.gov.cn/"
            target="_blank"
            rel="noreferrer"
            className="transition hover:text-blue-600"
          >
            鲁ICP备2026012101号-1
          </a>
          <span>日常咨询：小红书 @英爸</span>
          <a
            href="mailto:sakurasa1984@hotmail.com"
            className="transition hover:text-blue-600"
          >
            联系我们：sakurasa1984@hotmail.com
          </a>
        </div>
      </footer>
    </div>
  );
}
