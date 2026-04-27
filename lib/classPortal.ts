"use client";

import type { AnalysisResult } from "@/types";

export type ClassWorkspaceView =
  | "course"
  | "members"
  | "materials"
  | "tasks"
  | "ranking"
  | "activity";

export interface ClassWorkspaceNavItem {
  id: ClassWorkspaceView;
  label: string;
  badge: string;
}

export interface ClassCoverTheme {
  shellClass: string;
  coverClass: string;
  chipClass: string;
  accentClass: string;
  badgeText: string;
}

export interface ClassMaterialCard {
  id: string;
  title: string;
  lessonCount: string;
  stageLabel: string;
  colorClass: string;
}

const coverThemes: ClassCoverTheme[] = [
  {
    shellClass:
      "border-sky-200/90 bg-white shadow-[0_28px_80px_rgba(125,211,252,0.14)]",
    coverClass: "bg-gradient-to-br from-sky-500 via-cyan-400 to-blue-500",
    chipClass: "bg-white/90 text-slate-700",
    accentClass: "text-blue-600",
    badgeText: "阅",
  },
  {
    shellClass:
      "border-cyan-200/90 bg-white shadow-[0_28px_80px_rgba(103,232,249,0.14)]",
    coverClass: "bg-gradient-to-br from-cyan-400 via-sky-300 to-blue-400",
    chipClass: "bg-white/90 text-slate-700",
    accentClass: "text-cyan-600",
    badgeText: "听",
  },
  {
    shellClass:
      "border-indigo-200/90 bg-white shadow-[0_28px_80px_rgba(129,140,248,0.14)]",
    coverClass: "bg-gradient-to-br from-indigo-500 via-blue-400 to-sky-400",
    chipClass: "bg-white/90 text-slate-700",
    accentClass: "text-indigo-600",
    badgeText: "读",
  },
  {
    shellClass:
      "border-amber-200/90 bg-white shadow-[0_28px_80px_rgba(251,191,36,0.14)]",
    coverClass: "bg-gradient-to-br from-amber-400 via-orange-300 to-yellow-300",
    chipClass: "bg-white/90 text-slate-700",
    accentClass: "text-amber-600",
    badgeText: "营",
  },
];

const materialCards: ClassMaterialCard[] = [
  {
    id: "stage-1",
    title: "Stage 1",
    lessonCount: "共24课",
    stageLabel: "STAGE 1",
    colorClass: "from-stone-400 via-stone-300 to-zinc-200",
  },
  {
    id: "stage-1-plus",
    title: "Stage 1+",
    lessonCount: "共36课",
    stageLabel: "STAGE 1+",
    colorClass: "from-violet-400 via-fuchsia-300 to-pink-200",
  },
  {
    id: "stage-2",
    title: "Stage 2",
    lessonCount: "共24课",
    stageLabel: "STAGE 2",
    colorClass: "from-green-500 via-lime-400 to-yellow-200",
  },
  {
    id: "stage-4",
    title: "Stage 4",
    lessonCount: "共24课",
    stageLabel: "STAGE 4",
    colorClass: "from-rose-500 via-orange-400 to-amber-200",
  },
  {
    id: "stage-5",
    title: "Stage 5",
    lessonCount: "共24课",
    stageLabel: "STAGE 5",
    colorClass: "from-amber-500 via-yellow-400 to-lime-200",
  },
  {
    id: "stage-6",
    title: "Stage 6",
    lessonCount: "共18课",
    stageLabel: "STAGE 6",
    colorClass: "from-orange-500 via-amber-400 to-yellow-200",
  },
  {
    id: "stage-7",
    title: "Stage 7",
    lessonCount: "共18课",
    stageLabel: "STAGE 7",
    colorClass: "from-lime-500 via-green-400 to-cyan-200",
  },
  {
    id: "stage-8",
    title: "Stage 8",
    lessonCount: "共12课",
    stageLabel: "STAGE 8",
    colorClass: "from-sky-500 via-blue-400 to-indigo-300",
  },
];

export const classWorkspaceNav: ClassWorkspaceNavItem[] = [
  { id: "course", label: "课程", badge: "课" },
  { id: "members", label: "成员", badge: "员" },
  { id: "materials", label: "教材", badge: "材" },
  { id: "tasks", label: "任务", badge: "任" },
  { id: "ranking", label: "排行榜", badge: "榜" },
  { id: "activity", label: "动态", badge: "动" },
];

export const getClassCoverTheme = (seed: string, index = 0): ClassCoverTheme => {
  const base =
    seed.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0) + index;
  return coverThemes[base % coverThemes.length];
};

export const getClassCapacityLabel = (count: number) => `${count}/200`;

export const getClassMaterials = (): ClassMaterialCard[] => materialCards;

export const getScheduleDays = () => {
  const formatter = new Intl.DateTimeFormat("zh-CN", {
    weekday: "short",
    day: "numeric",
  });

  return Array.from({ length: 7 }).map((_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - 3 + index);

    return {
      id: date.toISOString(),
      label: formatter.format(date).replace("周", "周"),
      courseCount: 0,
      isToday: index === 3,
    };
  });
};

const getMetricScore = (result: AnalysisResult, metric: "star" | "flower" | "medal" | "progress") => {
  const total =
    result.fluency.score +
    result.pronunciation.score +
    result.intonation.score +
    result.vocabulary.score +
    result.emotion.score;

  switch (metric) {
    case "flower":
      return Math.round(total * 2.4);
    case "medal":
      return Math.round(total * 1.6);
    case "progress":
      return Math.round(total / 5);
    default:
      return Math.round(total * 3.1);
  }
};

export const getLeaderboardMetric = (
  results: AnalysisResult[],
  metric: "star" | "flower" | "medal" | "progress"
) =>
  results.reduce((sum, result) => sum + getMetricScore(result, metric), 0);
