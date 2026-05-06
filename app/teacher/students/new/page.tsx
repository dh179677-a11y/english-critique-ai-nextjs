"use client";

import { useRouter } from "next/navigation";
import React, { useEffect, useState } from "react";
import AuthGate from "@/components/AuthGate";
import TeacherShell from "@/components/teacher/TeacherShell";
import {
  getSessionProfile,
  type CreateStudentInput,
  type ExpiryPreset,
  type SessionUser,
  type StudentGender,
  type TeacherClass,
} from "@/lib/clientAuth";
import {
  bootstrapPortalFromLocal,
  createStudentAccount,
  getTeacherClasses,
} from "@/lib/portalClient";

const expiryOptions: Array<{ value: ExpiryPreset; label: string }> = [
  { value: "unlimited", label: "无限期" },
  { value: "week", label: "一周" },
  { value: "month", label: "一个月" },
  { value: "quarter", label: "三个月" },
  { value: "half_year", label: "半年" },
  { value: "year", label: "一年" },
  { value: "custom", label: "自定义" },
];

const genderOptions: Array<{ value: StudentGender; label: string }> = [
  { value: "male", label: "男" },
  { value: "female", label: "女" },
  { value: "unknown", label: "未知" },
];

const getExpiryLabel = (preset: ExpiryPreset, customDate: string) => {
  if (preset === "custom") {
    return customDate || "自定义";
  }
  return expiryOptions.find((item) => item.value === preset)?.label || "无限期";
};

const initialForm: CreateStudentInput = {
  username: "",
  displayName: "",
  remarkName: "",
  classId: "",
  className: "",
  expiryPreset: "unlimited",
  customExpiryDate: "",
  gender: "unknown",
  grade: "",
  birthday: "",
  school: "",
  address: "",
  noteInfo: "",
};

function AddStudentContent() {
  const router = useRouter();
  const [session, setSession] = useState<SessionUser | null>(null);
  const [classes, setClasses] = useState<TeacherClass[]>([]);
  const [form, setForm] = useState<CreateStudentInput>(initialForm);
  const [message, setMessage] = useState("");
  const [submitMode, setSubmitMode] = useState<"done" | "continue">("done");
  const [showExpiryModal, setShowExpiryModal] = useState(false);
  const [tempExpiryPreset, setTempExpiryPreset] = useState<ExpiryPreset>("unlimited");
  const [tempCustomExpiryDate, setTempCustomExpiryDate] = useState("");
  const [createdAccount, setCreatedAccount] = useState<{
    displayName: string;
    username: string;
    password: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const current = getSessionProfile();
      if (!current) return;
      setSession(current);

      try {
        await bootstrapPortalFromLocal();
        const nextClasses = await getTeacherClasses(current.username);
        if (!cancelled) {
          setClasses(nextClasses);
        }
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

  if (!session || loading) {
    return null;
  }

  const handleInputChange = <K extends keyof CreateStudentInput>(
    key: K,
    value: CreateStudentInput[K]
  ) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const resetForm = () => {
    setForm(initialForm);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage("");

    try {
      const result = await createStudentAccount(session.username, form);

      setCreatedAccount({
        displayName: result.displayName,
        username: result.username,
        password: result.password,
      });

      if (submitMode === "continue") {
        setMessage(`已创建学员 ${result.displayName}，可继续添加下一位`);
        resetForm();
        return;
      }

      setMessage("学员账号已创建");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "创建学员失败");
    }
  };

  const openExpiryModal = () => {
    setTempExpiryPreset(form.expiryPreset);
    setTempCustomExpiryDate(form.customExpiryDate || "");
    setShowExpiryModal(true);
  };

  const confirmExpiry = () => {
    setForm((current) => ({
      ...current,
      expiryPreset: tempExpiryPreset,
      customExpiryDate: tempExpiryPreset === "custom" ? tempCustomExpiryDate : "",
    }));
    setShowExpiryModal(false);
  };

  return (
    <TeacherShell
      session={session}
      title="添加学员"
      subtitle="学生账号由老师创建，默认密码会根据账号自动生成。"
      backHref="/teacher/students"
      actions={
        <>
          <button
            type="submit"
            form="add-student-form"
            onClick={() => setSubmitMode("continue")}
            className="rounded-full border-2 border-slate-800 bg-white px-6 py-3 text-base font-black text-slate-800 transition hover:bg-slate-50"
          >
            完成并添加下一个
          </button>
          <button
            type="submit"
            form="add-student-form"
            onClick={() => setSubmitMode("done")}
            className="rounded-full bg-white px-6 py-3 text-base font-black text-slate-800 shadow-md transition hover:bg-slate-50"
          >
            完成
          </button>
        </>
      }
    >
      {message ? (
        <div className="mb-5 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-700">
          {message}
        </div>
      ) : null}

      <form
        id="add-student-form"
        onSubmit={handleSubmit}
        className="rounded-[1.8rem] bg-white p-5 shadow-[0_24px_70px_rgba(148,163,184,0.12)] md:p-6"
      >
        <section>
          <h2 className="text-2xl font-black text-slate-900">基础信息</h2>
          <div className="mt-6 grid gap-5 md:grid-cols-2">
            <label className="block">
              <span className="mb-2.5 block text-[1.35rem] font-black text-slate-900">
                学员账号 *
              </span>
              <input
                value={form.username}
                onChange={(e) => handleInputChange("username", e.target.value)}
                className="w-full rounded-[1.35rem] bg-slate-50 px-5 py-4 text-base text-slate-800 outline-none ring-1 ring-slate-100 transition focus:bg-white focus:ring-blue-300"
                placeholder="建议使用手机号作为学员账号"
              />
            </label>

            <label className="block">
              <span className="mb-2.5 block text-[1.35rem] font-black text-slate-900">
                学员昵称 *
              </span>
              <input
                value={form.displayName}
                onChange={(e) => handleInputChange("displayName", e.target.value)}
                className="w-full rounded-[1.35rem] bg-slate-50 px-5 py-4 text-base text-slate-800 outline-none ring-1 ring-slate-100 transition focus:bg-white focus:ring-blue-300"
                placeholder="请输入学员姓名"
              />
            </label>

            <label className="block">
              <span className="mb-2.5 block text-[1.35rem] font-black text-slate-900">
                备注昵称
              </span>
              <input
                value={form.remarkName}
                onChange={(e) => handleInputChange("remarkName", e.target.value)}
                className="w-full rounded-[1.35rem] bg-slate-50 px-5 py-4 text-base text-slate-800 outline-none ring-1 ring-slate-100 transition focus:bg-white focus:ring-blue-300"
                placeholder="请输入备注昵称（限 50 字）"
              />
            </label>

            <label className="block">
              <span className="mb-2.5 block text-[1.35rem] font-black text-slate-900">
                选择班级
              </span>
              <select
                value={form.classId}
                onChange={(e) => handleInputChange("classId", e.target.value)}
                className="w-full rounded-[1.35rem] bg-slate-50 px-5 py-4 text-base text-slate-800 outline-none ring-1 ring-slate-100 transition focus:bg-white focus:ring-blue-300"
              >
                <option value="">请选择班级</option>
                {classes.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              onClick={openExpiryModal}
              className="flex items-center justify-between rounded-[1.35rem] bg-slate-50 px-5 py-4 text-left text-base text-slate-800 ring-1 ring-slate-100 transition hover:bg-white"
            >
              <span>
                <span className="mb-2.5 block text-[1.35rem] font-black text-slate-900">
                  截止日期
                </span>
                {getExpiryLabel(form.expiryPreset, form.customExpiryDate || "")}
              </span>
              <span className="text-3xl text-slate-400">›</span>
            </button>
          </div>
        </section>

        <section className="mt-8 border-t border-slate-100 pt-7">
          <h2 className="text-2xl font-black text-slate-900">详细信息</h2>
          <div className="mt-6 grid gap-5 md:grid-cols-2">
            <div>
              <span className="mb-2.5 block text-[1.35rem] font-black text-slate-900">
                选择性别
              </span>
              <div className="flex flex-wrap gap-3">
                {genderOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => handleInputChange("gender", option.value)}
                    className={`rounded-full px-5 py-2.5 text-base font-bold transition ${
                      form.gender === option.value
                        ? "bg-orange-100 text-orange-600 ring-2 ring-orange-200"
                        : "bg-slate-50 text-slate-400"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <label className="block">
              <span className="mb-2.5 block text-[1.35rem] font-black text-slate-900">
                设置生日
              </span>
              <input
                type="date"
                value={form.birthday}
                onChange={(e) => handleInputChange("birthday", e.target.value)}
                className="w-full rounded-[1.35rem] bg-slate-50 px-5 py-4 text-base text-slate-800 outline-none ring-1 ring-slate-100 transition focus:bg-white focus:ring-blue-300"
              />
            </label>

            <label className="block">
              <span className="mb-2.5 block text-[1.35rem] font-black text-slate-900">
                设置年级
              </span>
              <input
                value={form.grade}
                onChange={(e) => handleInputChange("grade", e.target.value)}
                className="w-full rounded-[1.35rem] bg-slate-50 px-5 py-4 text-base text-slate-800 outline-none ring-1 ring-slate-100 transition focus:bg-white focus:ring-blue-300"
                placeholder="请选择年级"
              />
            </label>

            <label className="block">
              <span className="mb-2.5 block text-[1.35rem] font-black text-slate-900">
                就读学校
              </span>
              <input
                value={form.school}
                onChange={(e) => handleInputChange("school", e.target.value)}
                className="w-full rounded-[1.35rem] bg-slate-50 px-5 py-4 text-base text-slate-800 outline-none ring-1 ring-slate-100 transition focus:bg-white focus:ring-blue-300"
                placeholder="请填写就读学校"
              />
            </label>

            <label className="block">
              <span className="mb-2.5 block text-[1.35rem] font-black text-slate-900">
                家庭住址
              </span>
              <input
                value={form.address}
                onChange={(e) => handleInputChange("address", e.target.value)}
                className="w-full rounded-[1.35rem] bg-slate-50 px-5 py-4 text-base text-slate-800 outline-none ring-1 ring-slate-100 transition focus:bg-white focus:ring-blue-300"
                placeholder="请填写家庭住址"
              />
            </label>

            <label className="block">
              <span className="mb-2.5 block text-[1.35rem] font-black text-slate-900">
                备注信息
              </span>
              <textarea
                value={form.noteInfo}
                onChange={(e) => handleInputChange("noteInfo", e.target.value)}
                className="min-h-[140px] w-full rounded-[1.35rem] bg-slate-50 px-5 py-4 text-base text-slate-800 outline-none ring-1 ring-slate-100 transition focus:bg-white focus:ring-blue-300"
                placeholder="请填写备注信息，老师和管理者可见"
              />
            </label>
          </div>
        </section>
      </form>

      {showExpiryModal ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/35 px-4">
          <div className="w-full max-w-4xl rounded-[2rem] bg-white p-8 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-4xl font-black text-slate-900">设置截止日期</h3>
              <button
                type="button"
                onClick={() => setShowExpiryModal(false)}
                className="text-5xl font-light text-slate-500"
              >
                ×
              </button>
            </div>

            <div className="mt-8 grid gap-5 md:grid-cols-3">
              {expiryOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setTempExpiryPreset(option.value)}
                  className={`rounded-[1.6rem] border px-6 py-5 text-left text-3xl font-black transition ${
                    tempExpiryPreset === option.value
                      ? "border-blue-500 bg-blue-50 text-blue-600"
                      : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            {tempExpiryPreset === "custom" ? (
              <div className="mt-6">
                <label className="mb-3 block text-2xl font-black text-slate-900">
                  自定义日期
                </label>
                <input
                  type="date"
                  value={tempCustomExpiryDate}
                  onChange={(e) => setTempCustomExpiryDate(e.target.value)}
                  className="w-full rounded-[1.6rem] bg-slate-50 px-6 py-5 text-xl text-slate-800 outline-none ring-1 ring-slate-100 transition focus:bg-white focus:ring-blue-300"
                />
              </div>
            ) : null}

            <div className="mt-8 flex justify-end gap-4">
              <button
                type="button"
                onClick={() => setShowExpiryModal(false)}
                className="rounded-[1.4rem] bg-slate-100 px-12 py-4 text-2xl font-black text-slate-600"
              >
                取消
              </button>
              <button
                type="button"
                onClick={confirmExpiry}
                className="rounded-[1.4rem] bg-blue-600 px-12 py-4 text-2xl font-black text-white"
              >
                确定
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {createdAccount ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/35 px-4">
          <div className="w-full max-w-3xl rounded-[2rem] bg-white p-8 shadow-2xl">
            <h3 className="text-4xl font-black text-slate-900">学员账号创建成功</h3>
            <p className="mt-3 text-lg text-slate-500">
              请把下面的账号和密码发给家长或学生端使用。
            </p>

            <div className="mt-6 rounded-[1.5rem] bg-slate-50 p-6 text-xl leading-10 text-slate-700">
              <p>
                学员昵称：<span className="font-black text-slate-900">{createdAccount.displayName}</span>
              </p>
              <p>
                登录账号：<span className="font-black text-slate-900">{createdAccount.username}</span>
              </p>
              <p>
                初始密码：<span className="font-black text-slate-900">{createdAccount.password}</span>
              </p>
            </div>

            <div className="mt-8 flex flex-wrap justify-end gap-4">
              <button
                type="button"
                onClick={() => {
                  setCreatedAccount(null);
                  resetForm();
                }}
                className="rounded-[1.4rem] bg-slate-100 px-8 py-4 text-xl font-black text-slate-700"
              >
                继续添加
              </button>
              <button
                type="button"
                onClick={() => router.replace("/teacher/students")}
                className="rounded-[1.4rem] bg-blue-600 px-8 py-4 text-xl font-black text-white"
              >
                返回列表
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </TeacherShell>
  );
}

export default function AddStudentPage() {
  return (
    <AuthGate allowedRoles={["teacher"]}>
      <AddStudentContent />
    </AuthGate>
  );
}
