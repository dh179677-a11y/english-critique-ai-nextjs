"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import type {
  StoryflowDocument,
  StoryflowPerformanceConfig,
  StoryflowPerformanceSectionConfig,
  StoryflowPerformanceSectionKey,
} from "@/lib/storyflowStore";

export const PERFORMANCE_SECTION_ORDER: StoryflowPerformanceSectionKey[] = [
  "imageSorting",
  "keywords",
  "sentenceFrames",
  "storyMap",
  "performanceTask",
  "parentTips",
];

type PerformancePreviewVariant = "student" | "teacher";

type VisiblePerformanceSection = {
  key: StoryflowPerformanceSectionKey;
  config: StoryflowPerformanceSectionConfig;
  step: number;
};

const PERFORMANCE_SECTION_META: Record<
  StoryflowPerformanceSectionKey,
  {
    shortLabel: string;
    accentTextClass: string;
    accentBorderClass: string;
    bubbleClass: string;
    tintClass: string;
    orderClass: string;
  }
> = {
  imageSorting: {
    shortLabel: "图片排序卡",
    accentTextClass: "text-violet-600",
    accentBorderClass: "border-violet-200/90",
    bubbleClass: "bg-violet-100 text-violet-600",
    tintClass: "bg-[linear-gradient(180deg,rgba(250,245,255,0.95),rgba(255,255,255,0.98))]",
    orderClass: "bg-violet-500 text-white",
  },
  keywords: {
    shortLabel: "关键词卡",
    accentTextClass: "text-sky-500",
    accentBorderClass: "border-sky-200/90",
    bubbleClass: "bg-sky-100 text-sky-500",
    tintClass: "bg-[linear-gradient(180deg,rgba(242,249,255,0.95),rgba(255,255,255,0.98))]",
    orderClass: "bg-sky-500 text-white",
  },
  sentenceFrames: {
    shortLabel: "句型支架",
    accentTextClass: "text-amber-500",
    accentBorderClass: "border-amber-200/90",
    bubbleClass: "bg-amber-100 text-amber-500",
    tintClass: "bg-[linear-gradient(180deg,rgba(255,248,240,0.95),rgba(255,255,255,0.98))]",
    orderClass: "bg-amber-500 text-white",
  },
  storyMap: {
    shortLabel: "故事地图",
    accentTextClass: "text-emerald-500",
    accentBorderClass: "border-emerald-200/90",
    bubbleClass: "bg-emerald-100 text-emerald-500",
    tintClass: "bg-[linear-gradient(180deg,rgba(241,255,247,0.95),rgba(255,255,255,0.98))]",
    orderClass: "bg-emerald-500 text-white",
  },
  performanceTask: {
    shortLabel: "脱稿表演任务单",
    accentTextClass: "text-fuchsia-500",
    accentBorderClass: "border-fuchsia-200/90",
    bubbleClass: "bg-fuchsia-100 text-fuchsia-500",
    tintClass: "bg-[linear-gradient(180deg,rgba(253,244,255,0.95),rgba(255,255,255,0.98))]",
    orderClass: "bg-fuchsia-500 text-white",
  },
  parentTips: {
    shortLabel: "家长陪练提示语",
    accentTextClass: "text-rose-500",
    accentBorderClass: "border-rose-200/90",
    bubbleClass: "bg-rose-100 text-rose-500",
    tintClass: "bg-[linear-gradient(180deg,rgba(255,242,246,0.95),rgba(255,255,255,0.98))]",
    orderClass: "bg-rose-500 text-white",
  },
};

const getVisiblePerformanceSections = (config: StoryflowPerformanceConfig): VisiblePerformanceSection[] =>
  PERFORMANCE_SECTION_ORDER.map((key) => ({
    key,
    config: config.sections[key],
  }))
    .filter((item) => item.config.visible)
    .map((item, index) => ({
      ...item,
      step: index + 1,
    }));

const requestElementFullscreen = async (element: HTMLElement | null) => {
  if (!element) return false;

  const target = element as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void> | void;
  };

  try {
    if (target.requestFullscreen) {
      await target.requestFullscreen();
      return true;
    }
    if (target.webkitRequestFullscreen) {
      await target.webkitRequestFullscreen();
      return true;
    }
  } catch {
    return false;
  }

  return false;
};

const summarizeSectionContent = (section: StoryflowPerformanceSectionConfig) => {
  if (section.content.length === 0) return section.description;
  return section.content.slice(0, 3).join(" / ");
};

const PerformanceToolIcon = ({
  kind,
  className = "h-5 w-5",
}: {
  kind: StoryflowPerformanceSectionKey;
  className?: string;
}) => {
  if (kind === "imageSorting") {
    return (
      <svg
        viewBox="0 0 24 24"
        className={className}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
      >
        <rect x="4" y="5" width="16" height="14" rx="2.5" />
        <circle cx="9" cy="10" r="1.5" />
        <path d="m6.8 16 4.1-4 2.7 2.5 3.6-4 1.8 5.5" />
      </svg>
    );
  }
  if (kind === "keywords") {
    return (
      <svg
        viewBox="0 0 24 24"
        className={className}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M7.5 12A4.5 4.5 0 1 1 12 7.5L19 14.5l-2.5 2.5-2-2-2 2-2.5-2.5 2-2Z" />
        <path d="M9.3 7.5h.01" />
      </svg>
    );
  }
  if (kind === "sentenceFrames") {
    return (
      <svg
        viewBox="0 0 24 24"
        className={className}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M7 9.5h10" />
        <path d="M7 13h6" />
        <path d="M8.5 18c-2.9 0-5.5-2-5.5-5s2.6-5 5.5-5h7c3 0 5.5 2 5.5 5 0 2.2-1.4 4.1-3.4 4.8L20 21l-5-2.8H8.5Z" />
      </svg>
    );
  }
  if (kind === "storyMap") {
    return (
      <svg
        viewBox="0 0 24 24"
        className={className}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M5 5.5 9 4v14.5L5 20V5.5Z" />
        <path d="m9 4 6 1.5V20L9 18.5V4Z" />
        <path d="m15 5.5 4-1.5V18.5L15 20V5.5Z" />
      </svg>
    );
  }
  if (kind === "performanceTask") {
    return (
      <svg
        viewBox="0 0 24 24"
        className={className}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="9" y="3.5" width="6" height="10.5" rx="3" />
        <path d="M7 11.5a5 5 0 0 0 10 0" />
        <path d="M12 16.5V20" />
        <path d="M9 20h6" />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="8" r="3.2" />
      <path d="M6 18a6 6 0 0 1 12 0" />
      <path d="M4.5 13.5h4" />
      <path d="M15.5 13.5h4" />
    </svg>
  );
};

const BackArrowIcon = ({ className = "h-7 w-7" }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth="2.4"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M20 12H8" />
    <path d="m12 8-4 4 4 4" />
  </svg>
);

const SectionPlaceholderArt = ({
  kind,
}: {
  kind: StoryflowPerformanceSectionKey;
}) => {
  const meta = PERFORMANCE_SECTION_META[kind];
  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-[1.35rem] border border-white/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(246,250,255,0.92))]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(191,219,254,0.35),transparent_55%)]" />
      <div className={`relative grid h-16 w-16 place-items-center rounded-full ${meta.bubbleClass}`}>
        <PerformanceToolIcon kind={kind} className="h-7 w-7" />
      </div>
    </div>
  );
};

const StudentPerformanceCard = ({
  section,
  onSelect,
}: {
  section: VisiblePerformanceSection;
  onSelect: () => void;
}) => {
  const meta = PERFORMANCE_SECTION_META[section.key];

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`group relative overflow-hidden rounded-[1.7rem] border ${meta.accentBorderClass} ${meta.tintClass} p-4 text-left shadow-[0_14px_28px_rgba(120,149,188,0.1)] transition hover:-translate-y-1 hover:shadow-[0_18px_34px_rgba(120,149,188,0.14)]`}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.78),transparent_55%)]" />
      <div className="relative grid min-h-[160px] grid-cols-[minmax(0,1fr)_92px] gap-3">
        <div className="min-w-0">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <span
                className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-base font-semibold ${meta.orderClass}`}
              >
                {section.step}
              </span>
              <div className="min-w-0 flex-1">
                <p
                  className={`max-w-[12rem] whitespace-normal break-words text-[0.96rem] font-semibold leading-7 tracking-tight ${meta.accentTextClass}`}
                >
                  {section.config.title}
                </p>
              </div>
            </div>
          </div>
          <p className="mt-4 max-w-[15rem] text-[0.94rem] leading-7 text-slate-600">
            {section.config.description}
          </p>
        </div>

        <div className="relative h-[148px] w-[92px] self-center justify-self-end overflow-hidden rounded-[1.15rem] border border-white/85 bg-white/92 shadow-[0_10px_20px_rgba(120,149,188,0.08)]">
          {section.config.image ? (
            <img
              src={section.config.image}
              alt={section.config.title}
              className="h-full w-full object-contain object-center p-1 transition duration-300 group-hover:scale-[1.02]"
            />
          ) : (
            <div className="grid h-full w-full place-items-center bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(246,250,255,0.92))]">
              <div className="text-center">
                <p className="text-sm font-medium text-slate-400">暂无缩略图</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </button>
  );
};

const TeacherPerformanceCard = ({
  section,
}: {
  section: VisiblePerformanceSection;
}) => {
  const meta = PERFORMANCE_SECTION_META[section.key];

  return (
    <div className="rounded-[1.3rem] border border-sky-100/90 bg-white/90 p-3 shadow-[0_10px_24px_rgba(120,149,188,0.1)]">
      <div className="flex items-start gap-3">
        <div className="h-[72px] w-[72px] shrink-0 overflow-hidden rounded-[0.95rem] border border-sky-100 bg-white">
          {section.config.image ? (
            <img
              src={section.config.image}
              alt={section.config.title}
              className="h-full w-full object-cover object-center"
            />
          ) : (
            <SectionPlaceholderArt kind={section.key} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-semibold ${meta.orderClass}`}
              >
                {section.step}
              </span>
              <p className="truncate text-[1rem] font-semibold tracking-tight text-slate-800">
                {section.config.title}
              </p>
            </div>
            <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${meta.bubbleClass}`}>
              <PerformanceToolIcon kind={section.key} className="h-[18px] w-[18px]" />
            </div>
          </div>
          <p className="mt-1 line-clamp-2 text-[0.76rem] leading-5 text-slate-500">
            {section.config.description}
          </p>
          <p className="mt-2 text-[0.75rem] leading-5 text-slate-600">
            {summarizeSectionContent(section.config)}
          </p>
        </div>
      </div>
    </div>
  );
};

const StudentPerformanceExperience = ({
  document,
  coverImageUrl,
  onExit,
  config,
}: {
  document: StoryflowDocument;
  coverImageUrl?: string;
  onExit?: () => void;
  config: StoryflowPerformanceConfig;
}) => {
  const visibleSections = useMemo(() => getVisiblePerformanceSections(config), [config]);
  const [activeSectionKey, setActiveSectionKey] =
    useState<StoryflowPerformanceSectionKey | null>(null);
  const [isFullscreenPreviewOpen, setIsFullscreenPreviewOpen] = useState(false);
  const imagePreviewRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (activeSectionKey && !visibleSections.some((item) => item.key === activeSectionKey)) {
      setActiveSectionKey(null);
    }
  }, [activeSectionKey, visibleSections]);

  useEffect(() => {
    if (!activeSectionKey) {
      setIsFullscreenPreviewOpen(false);
    }
  }, [activeSectionKey]);

  const activeSection =
    activeSectionKey === null
      ? null
      : visibleSections.find((item) => item.key === activeSectionKey) || null;

  if (activeSection) {
    const meta = PERFORMANCE_SECTION_META[activeSection.key];
    const handleOpenImageFullscreen = async () => {
      const opened = await requestElementFullscreen(imagePreviewRef.current);
      if (!opened) {
        setIsFullscreenPreviewOpen(true);
      }
    };

    return (
      <div className="min-h-[calc(100vh-1.5rem)] rounded-[2rem] bg-[radial-gradient(circle_at_top,_rgba(202,231,255,0.92),_rgba(239,247,255,0.98)_38%,_#f7fbff_72%,_#eef6ff_100%)] px-2 py-2 md:px-3">
        <div className="mx-auto max-w-[1580px]">
          <button
            type="button"
            onClick={() => setActiveSectionKey(null)}
            className="mb-3 grid h-14 w-14 place-items-center rounded-full border border-white/85 bg-white/78 text-sky-500 shadow-[0_14px_28px_rgba(120,149,188,0.18)] backdrop-blur transition hover:bg-white"
            aria-label="返回脱稿表演总览"
          >
            <BackArrowIcon />
          </button>

          <div className="rounded-[2rem] border border-sky-100/90 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(244,249,255,0.98))] px-6 py-6 shadow-[0_28px_72px_rgba(120,149,188,0.16)]">
            <div className="flex flex-wrap items-center gap-3">
              <span
                className={`grid h-10 w-10 place-items-center rounded-full text-base font-semibold ${meta.orderClass}`}
              >
                {activeSection.step}
              </span>
              <div className="min-w-0">
                <p className={`text-[1.45rem] font-semibold tracking-tight ${meta.accentTextClass} md:text-[1.8rem]`}>
                  {activeSection.config.title}
                </p>
                <p className="mt-1 text-[0.96rem] text-slate-500">
                  {activeSection.config.description}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => void handleOpenImageFullscreen()}
              className="mt-5 block w-full overflow-hidden rounded-[1.85rem] border border-white/80 bg-white/84 p-4 text-left shadow-[0_18px_44px_rgba(120,149,188,0.12)]"
              aria-label="点击全屏查看图片"
            >
              <div ref={imagePreviewRef}>
                {activeSection.config.image ? (
                  <img
                    src={activeSection.config.image}
                    alt={activeSection.config.title}
                    className="mx-auto max-h-[74vh] w-full rounded-[1.45rem] object-contain"
                  />
                ) : (
                  <div className="grid min-h-[60vh] place-items-center rounded-[1.45rem] bg-[linear-gradient(180deg,rgba(255,255,255,0.94),rgba(245,249,255,0.92))]">
                    <div className="text-center">
                      <div
                        className={`mx-auto grid h-20 w-20 place-items-center rounded-full shadow-[inset_0_2px_10px_rgba(255,255,255,0.6)] ${meta.bubbleClass}`}
                      >
                        <PerformanceToolIcon kind={activeSection.key} className="h-9 w-9" />
                      </div>
                      <p className="mt-4 text-[1.05rem] font-semibold text-slate-700">
                        老师还没有上传这张工具图片
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </button>

            {onExit ? (
              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={onExit}
                  className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-500 shadow-sm transition hover:text-sky-600"
                >
                  退出脱稿表演
                </button>
              </div>
            ) : null}
          </div>

          {isFullscreenPreviewOpen ? (
            <div
              className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/92 p-4"
              role="dialog"
              aria-modal="true"
            >
              <button
                type="button"
                onClick={() => setIsFullscreenPreviewOpen(false)}
                className="absolute right-4 top-4 rounded-full bg-white/12 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/18"
              >
                关闭
              </button>
              {activeSection.config.image ? (
                <img
                  src={activeSection.config.image}
                  alt={activeSection.config.title}
                  className="max-h-[92vh] max-w-[96vw] object-contain"
                />
              ) : (
                <p className="text-lg font-semibold text-white/90">当前没有可放大的图片</p>
              )}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen rounded-[2rem] bg-[radial-gradient(circle_at_top,_rgba(202,231,255,0.92),_rgba(239,247,255,0.98)_38%,_#f7fbff_72%,_#eef6ff_100%)] px-4 py-0">
      <div className="mx-auto max-w-[1640px]">
        <div className="relative mt-0 px-1 py-0">
          <button
            type="button"
            onClick={onExit}
            className="absolute -left-[102px] top-3 z-20 grid h-[76px] w-[76px] place-items-center rounded-full border border-white/85 bg-white/72 text-sky-500 shadow-[0_16px_30px_rgba(120,149,188,0.18)] backdrop-blur transition hover:bg-white"
            aria-label="返回上一页"
          >
            <BackArrowIcon className="h-8 w-8" />
          </button>

          <div className="relative overflow-hidden rounded-[1.95rem] border border-sky-100/85 bg-[linear-gradient(180deg,rgba(255,255,255,0.97),rgba(246,250,255,0.98))] px-10 py-5 shadow-[0_14px_30px_rgba(120,149,188,0.1)]">
            <div className="relative flex items-center gap-7">
              <div className="h-[148px] w-[220px] shrink-0 overflow-hidden rounded-[1.2rem] border border-sky-100 bg-white shadow-[0_12px_24px_rgba(120,149,188,0.11)]">
                {coverImageUrl ? (
                  <img
                    src={coverImageUrl}
                    alt={document.analysis.title || document.sourceName}
                    className="h-full w-full object-cover object-center"
                  />
                ) : (
                  <div className="grid h-full w-full place-items-center text-sm font-semibold text-sky-600">
                    封面
                  </div>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <h1 className="text-[3.35rem] font-semibold leading-none tracking-tight text-slate-900">
                  {document.analysis.title || document.sourceName}
                </h1>
                <p className="mt-5 max-w-4xl text-[1.14rem] leading-8 text-slate-600">
                  6种输出训练工具，帮助孩子完成看图表达与脱稿复述。
                </p>
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-[1.55rem] border border-amber-100/90 bg-[linear-gradient(180deg,rgba(255,253,245,0.98),rgba(255,250,236,0.96))] px-6 py-4 shadow-[0_12px_24px_rgba(120,149,188,0.09)]">
            <div className="flex items-center gap-3 overflow-x-auto whitespace-nowrap">
              <div className="grid h-11 w-11 place-items-center rounded-full bg-amber-100 text-amber-500 shadow-inner">
                <svg
                  viewBox="0 0 24 24"
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M9 18h6" />
                  <path d="M10 22h4" />
                  <path d="M12 2v2.2" />
                  <path d="M5.7 5.7 7.2 7.2" />
                  <path d="M18.3 5.7 16.8 7.2" />
                  <path d="M4 12h2.2" />
                  <path d="M17.8 12H20" />
                  <path d="M12 6a5 5 0 0 0-3 9v1.2a.8.8 0 0 0 .8.8h4.4a.8.8 0 0 0 .8-.8V15A5 5 0 0 0 12 6Z" />
                </svg>
              </div>
              <p className="shrink-0 text-[0.98rem] font-semibold text-slate-700">使用顺序：</p>
              <div className="flex shrink-0 items-center gap-x-3">
                {visibleSections.map((item, index) => {
                  const meta = PERFORMANCE_SECTION_META[item.key];
                  return (
                    <React.Fragment key={item.key}>
                      <button
                        type="button"
                        onClick={() => setActiveSectionKey(item.key)}
                        className="inline-flex items-center gap-2 rounded-full bg-white/88 px-3 py-1.5 text-[0.9rem] font-semibold text-slate-600 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                      >
                        <span
                          className={`grid h-7 w-7 place-items-center rounded-full text-xs font-semibold ${meta.orderClass}`}
                        >
                          {item.step}
                        </span>
                        <span className={meta.accentTextClass}>{item.config.title}</span>
                      </button>
                      {index < visibleSections.length - 1 ? (
                        <svg
                          viewBox="0 0 24 24"
                          className={`h-[18px] w-[18px] ${meta.accentTextClass}`}
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M5 12h14" />
                          <path d="m14 7 5 5-5 5" />
                        </svg>
                      ) : null}
                    </React.Fragment>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            {visibleSections.map((section) => (
              <StudentPerformanceCard
                key={section.key}
                section={section}
                onSelect={() => setActiveSectionKey(section.key)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

const TeacherPerformancePreview = ({
  document,
  config,
  coverImageUrl,
  teacherName,
  studentName,
}: {
  document: StoryflowDocument;
  config: StoryflowPerformanceConfig;
  coverImageUrl?: string;
  teacherName?: string;
  studentName?: string;
}) => {
  const visibleSections = getVisiblePerformanceSections(config);
  const visibleTools = visibleSections.filter((item) => item.key !== "parentTips");
  const parentTipsSection = visibleSections.find((item) => item.key === "parentTips") || null;

  return (
    <div className="rounded-[1.8rem] border border-sky-100/90 bg-[radial-gradient(circle_at_top,_rgba(214,235,255,0.9),_rgba(245,250,255,0.98)_50%,_#f8fbff_100%)] p-4 shadow-[0_18px_48px_rgba(120,149,188,0.14)]">
      <div className="overflow-hidden rounded-[1.7rem] border border-sky-100/90 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(246,250,255,0.98))] px-5 py-5 shadow-[0_14px_32px_rgba(120,149,188,0.1)]">
        <div className="flex items-start gap-4">
          <div className="h-[120px] w-[96px] shrink-0 overflow-hidden rounded-[1.15rem] border border-sky-100 bg-white shadow-sm">
            {coverImageUrl ? (
              <img
                src={coverImageUrl}
                alt={document.analysis.title || document.sourceName}
                className="h-full w-full object-cover object-center"
              />
            ) : (
              <div className="grid h-full w-full place-items-center text-sm font-semibold text-sky-600">
                封面
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[0.8rem] font-semibold uppercase tracking-[0.28em] text-sky-500">
              Storyflow
            </p>
            <h2 className="mt-2 text-[2rem] font-semibold leading-none tracking-tight text-slate-800">
              {document.analysis.title || document.sourceName}
            </h2>
            <p className="mt-3 text-[0.92rem] leading-7 text-slate-600">
              {document.analysis.summary || "让孩子按照六步支架完成完整复述，再进行大胆自然的脱稿表演。"}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3 text-[0.84rem] text-slate-500">
              {teacherName ? <span>老师：{teacherName}</span> : null}
              {teacherName && studentName ? <span className="text-slate-300">•</span> : null}
              {studentName ? <span>学生：{studentName}</span> : null}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-[1.5rem] border border-sky-100/90 bg-white/90 px-4 py-4 shadow-[0_14px_32px_rgba(120,149,188,0.1)]">
        <p className="text-[0.95rem] font-semibold text-slate-800">使用流程</p>
        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          {visibleSections.map((item, index) => {
            const meta = PERFORMANCE_SECTION_META[item.key];
            return (
              <React.Fragment key={item.key}>
                <div className="flex flex-col items-center gap-2">
                  <div className={`grid h-11 w-11 place-items-center rounded-full ${meta.bubbleClass} shadow-inner`}>
                    <PerformanceToolIcon kind={item.key} className="h-5 w-5" />
                  </div>
                  <span className="text-[0.72rem] font-medium text-slate-600">{meta.shortLabel}</span>
                </div>
                {index < visibleSections.length - 1 ? (
                  <svg
                    viewBox="0 0 24 24"
                    className="h-5 w-5 text-slate-300"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M5 12h14" />
                    <path d="m14 7 5 5-5 5" />
                  </svg>
                ) : null}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {visibleTools.length ? (
        <div className="mt-4 grid gap-3 xl:grid-cols-2">
          {visibleTools.map((section) => (
            <TeacherPerformanceCard key={section.key} section={section} />
          ))}
        </div>
      ) : null}

      {parentTipsSection ? (
        <div className="mt-4 rounded-[1.45rem] border border-sky-100/90 bg-[linear-gradient(180deg,rgba(255,255,255,0.94),rgba(238,246,255,0.95))] px-4 py-4 shadow-[0_12px_28px_rgba(120,149,188,0.1)]">
          <div className="flex items-start gap-3">
            <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${PERFORMANCE_SECTION_META.parentTips.bubbleClass}`}>
              <PerformanceToolIcon kind="parentTips" className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-[0.96rem] font-semibold text-slate-800">给家长的小贴士</p>
              <div className="mt-2 space-y-1.5">
                {parentTipsSection.config.content.slice(0, 3).map((item, index) => (
                  <p
                    key={`${item}_${index}`}
                    className="text-[0.8rem] leading-6 text-slate-600"
                  >
                    {item}
                  </p>
                ))}
                {!parentTipsSection.config.content.length ? (
                  <p className="text-[0.8rem] text-slate-500">
                    {parentTipsSection.config.description}
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default function PerformanceTaskPreview({
  document,
  config,
  coverImageUrl,
  teacherName,
  studentName,
  variant = "student",
  onExit,
}: {
  document: StoryflowDocument;
  config: StoryflowPerformanceConfig;
  coverImageUrl?: string;
  teacherName?: string;
  studentName?: string;
  variant?: PerformancePreviewVariant;
  onExit?: () => void;
}) {
  if (variant === "student") {
    return (
      <StudentPerformanceExperience
        document={document}
        coverImageUrl={coverImageUrl}
        config={config}
        onExit={onExit}
      />
    );
  }

  return (
    <TeacherPerformancePreview
      document={document}
      config={config}
      coverImageUrl={coverImageUrl}
      teacherName={teacherName}
      studentName={studentName}
    />
  );
}
