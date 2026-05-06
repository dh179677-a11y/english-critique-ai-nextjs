'use client';

import Link from 'next/link';
import React, { useState, useRef, useEffect } from 'react';
import { AppStatus, AnalysisResult } from './types';
import { analyzeStudentVideo, VideoMetadata } from './services/geminiService';
import ScoreChart from './components/ScoreChart';
import FeedbackSection from './components/FeedbackSection';
import { getSessionProfile } from './lib/clientAuth';
import { bootstrapPortalFromLocal, logoutUser, saveUserRecord } from './lib/portalClient';
import { getStudentStoryflowAssignments } from './lib/storyflowAssignments';

type AppProps = {
  mode?: 'dashboard' | 'upload';
};

const App: React.FC<AppProps> = ({ mode = 'dashboard' }) => {
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [currentUser, setCurrentUser] = useState<string>('');
  const [taskCount, setTaskCount] = useState<number>(0);
  const [uploadedObjectKey, setUploadedObjectKey] = useState<string | null>(null);

  const [studentName, setStudentName] = useState<string>('');
  const [bookName, setBookName] = useState<string>('');
  const [homeworkType, setHomeworkType] = useState<string>('绘本跟读');
  const [tutorName, setTutorName] = useState<string>('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void bootstrapPortalFromLocal().catch(() => undefined);

    const user = getSessionProfile();
    if (!user) return;
    setCurrentUser(user.displayName || user.username);
    setTaskCount(getStudentStoryflowAssignments(user.username).length);
  }, []);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('video/')) {
      setErrorMsg('请上传视频文件 (Please upload a video file)');
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    setVideoPreview(previewUrl);
    setUploadedObjectKey(null);
    setErrorMsg('');
    setResult(null);
    setStatus(AppStatus.ANALYZING);

    try {
      const metadata: VideoMetadata = {
        studentName,
        bookName,
        homeworkType,
        tutorName,
      };

      const { result: analysisData, objectKey } = await analyzeStudentVideo(file, metadata);
      const finalResult = {
        ...analysisData,
        ...metadata,
      };

      setResult(finalResult);
      setUploadedObjectKey(objectKey);

      const session = getSessionProfile();
      const recordOwner = session?.username;
      if (recordOwner) {
        await saveUserRecord(recordOwner, finalResult, objectKey);
      }

      setStatus(AppStatus.SUCCESS);
    } catch (error) {
      console.error(error);
      setStatus(AppStatus.ERROR);
      setErrorMsg(
        error instanceof Error && error.message
          ? error.message
          : '分析失败，请重试。'
      );
    }
  };

  const handleReset = () => {
    setStatus(AppStatus.IDLE);
    setResult(null);
    setVideoPreview(null);
    setUploadedObjectKey(null);
    setErrorMsg('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDataUpdate = (newData: AnalysisResult) => {
    setResult(newData);
  };

  const handleLogout = async () => {
    await logoutUser();
    window.location.href = '/login';
  };

  const getMetadata = (): VideoMetadata => ({
    studentName,
    bookName,
    homeworkType,
    tutorName,
  });

  return (
    <div className="min-h-screen bg-gray-50 pb-10">
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-[72rem] items-center justify-between px-4 py-3.5">
          <div className="flex items-center space-x-2">
            <div className="h-10 w-10 overflow-hidden rounded-full shadow-sm">
              <img
                src="/pixel-logo.png"
                alt="EnglishPro logo"
                className="h-full w-full object-cover"
              />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-gray-900">EnglishPro Critique AI</h1>
              <p className="text-xs text-gray-500">智能口语测评助手</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {currentUser ? (
              <span className="hidden rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 md:inline-flex">
                学生端 · {currentUser}
              </span>
            ) : null}
            {mode === 'upload' ? (
              <Link
                href="/"
                className="text-sm font-medium text-gray-600 transition-colors hover:text-blue-600"
              >
                返回首页
              </Link>
            ) : null}
            <Link
              href="/records"
              className="text-sm font-medium text-gray-600 transition-colors hover:text-blue-600"
            >
              我的测评记录
            </Link>
            <button
              onClick={handleLogout}
              className="text-sm font-medium text-gray-600 transition-colors hover:text-blue-600"
            >
              退出登录
            </button>
            {mode === 'upload' && status !== AppStatus.IDLE ? (
              <button
                onClick={handleReset}
                className="text-sm font-medium text-gray-600 transition-colors hover:text-blue-600"
              >
                上传新视频
              </button>
            ) : null}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[72rem] px-4 py-7">
        {mode === 'dashboard' ? (
          <div className="mt-6">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-[1.8rem] border border-blue-100 bg-white p-6 shadow-sm">
                <p className="text-sm font-bold uppercase tracking-[0.28em] text-blue-600">Tasks</p>
                <h2 className="mt-3 text-[2rem] font-black text-slate-900">任务入口</h2>
                <p className="mt-3 text-sm leading-7 text-slate-600">
                  查看老师布置的绘本练习任务，进入全屏练习页面完成看图说话与复述训练。
                </p>
                <div className="mt-6">
                  <Link
                    href="/tasks"
                    className="inline-flex items-center rounded-full bg-blue-600 px-6 py-3 text-sm font-bold text-white transition hover:bg-blue-500"
                  >
                    打开任务列表
                  </Link>
                </div>
              </div>

              <div className="rounded-[1.8rem] border border-blue-100 bg-white p-6 shadow-sm">
                <p className="text-sm font-bold uppercase tracking-[0.28em] text-blue-600">Practice</p>
                <h2 className="mt-3 text-[2rem] font-black text-slate-900">上传口语视频</h2>
                <p className="mt-3 text-sm leading-7 text-slate-600">
                  进入独立上传页面，提交学生口语视频，AI 会自动生成测评报告。
                </p>
                <div className="mt-6">
                  <Link
                    href="/upload"
                    className="inline-flex items-center rounded-full bg-blue-600 px-6 py-3 text-sm font-bold text-white transition hover:bg-blue-500"
                  >
                    进入上传页面
                  </Link>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {mode === 'upload' && status === AppStatus.IDLE ? (
          <div className="mx-auto mt-8 max-w-xl text-center">
            <h3 className="mb-3 text-[2rem] font-bold text-gray-800">上传学生口语视频</h3>
            <p className="mb-6 text-sm text-gray-600">
              AI 将自动分析视频中的发音、流利度和语调，并生成专业的点评报告。
            </p>

            <div className="mb-5 rounded-[1.6rem] border border-gray-100 bg-white p-6 text-left shadow-sm">
              <div className="mb-5 grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label htmlFor="studentName" className="mb-1 block text-sm font-medium text-gray-700">学生姓名</label>
                  <input
                    type="text"
                    id="studentName"
                    value={studentName}
                    onChange={(e) => setStudentName(e.target.value)}
                    placeholder="例如: Kevin"
                    className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm outline-none transition-all focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label htmlFor="tutorName" className="mb-1 block text-sm font-medium text-gray-700">辅导老师</label>
                  <input
                    type="text"
                    id="tutorName"
                    list="tutorNameOptions"
                    value={tutorName}
                    onChange={(e) => setTutorName(e.target.value)}
                    placeholder="例如: Teacher Emma"
                    className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm outline-none transition-all focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                  />
                  <datalist id="tutorNameOptions">
                    <option value="Leo" />
                    <option value="Jackson" />
                  </datalist>
                </div>
                <div>
                  <label htmlFor="bookName" className="mb-1 block text-sm font-medium text-gray-700">绘本名称/内容</label>
                  <input
                    type="text"
                    id="bookName"
                    value={bookName}
                    onChange={(e) => setBookName(e.target.value)}
                    placeholder="例如: 牛津树 Level 2"
                    className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm outline-none transition-all focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label htmlFor="homeworkType" className="mb-1 block text-sm font-medium text-gray-700">作业类型</label>
                  <select
                    id="homeworkType"
                    value={homeworkType}
                    onChange={(e) => setHomeworkType(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm outline-none transition-all focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="绘本跟读">绘本跟读</option>
                    <option value="看图说话">看图说话</option>
                    <option value="脱稿表演">脱稿表演</option>
                  </select>
                </div>
              </div>

              <div className="group relative cursor-pointer rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 p-8 transition-all hover:border-blue-500 hover:bg-blue-50">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/*"
                  onChange={handleFileChange}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                />
                <div className="flex flex-col items-center">
                  <svg xmlns="http://www.w3.org/2000/svg" className="mb-3 h-10 w-10 text-gray-400 transition-colors group-hover:text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  <p className="text-base font-semibold text-gray-700 group-hover:text-blue-600">点击上传视频文件</p>
                  <p className="mt-2 text-sm text-gray-400">支持 MP4, MOV, WEBM</p>
                </div>
              </div>
            </div>

            {errorMsg ? (
              <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">
                {errorMsg}
              </div>
            ) : null}
          </div>
        ) : null}

        {mode === 'upload' && status === AppStatus.ANALYZING ? (
          <div className="mx-auto mt-10 flex max-w-xl flex-col items-center">
            <div className="relative mb-6 aspect-video w-full overflow-hidden rounded-xl bg-black shadow-lg">
              {videoPreview ? (
                <video src={videoPreview} controls className="h-full w-full object-contain" />
              ) : null}
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50 text-white backdrop-blur-sm">
                <div className="mb-4 h-10 w-10 animate-spin rounded-full border-4 border-white border-t-transparent"></div>
                <p className="animate-pulse text-base font-medium">正在为 {studentName || '同学'} 分析口语...</p>
                <p className="mt-2 text-sm text-gray-300">AI Analyzing Fluency & Pronunciation...</p>
              </div>
            </div>
          </div>
        ) : null}

        {mode === 'upload' && status === AppStatus.SUCCESS && result ? (
          <div className="animate-fade-in-up">
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[0.382fr_0.618fr]">
              <div className="space-y-6 lg:col-span-1">
                <div className="aspect-video overflow-hidden rounded-xl bg-black shadow-lg">
                  {videoPreview ? (
                    <video src={videoPreview} controls className="h-full w-full object-contain" />
                  ) : null}
                </div>
                <ScoreChart data={result} />
              </div>

              <div className="lg:col-span-2">
                <FeedbackSection
                  data={result}
                  onDataChange={handleDataUpdate}
                  videoObjectKey={uploadedObjectKey}
                  metadata={getMetadata()}
                />
              </div>
            </div>
          </div>
        ) : null}

        {mode === 'upload' && status === AppStatus.ERROR ? (
          <div className="mx-auto mt-10 max-w-lg rounded-xl border border-red-100 bg-white p-6 text-center shadow-sm">
            <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h3 className="mb-2 text-lg font-bold text-gray-800">出错了</h3>
            <p className="mb-6 text-gray-600">{errorMsg}</p>
            <button
              onClick={handleReset}
              className="rounded-lg bg-blue-600 px-6 py-2 font-medium text-white transition-colors hover:bg-blue-700"
            >
              重试 (Try Again)
            </button>
          </div>
        ) : null}
      </main>
    </div>
  );
};

export default App;
