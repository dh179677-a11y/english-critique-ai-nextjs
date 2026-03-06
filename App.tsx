'use client';

import React, { useState, useRef } from 'react';
import { AppStatus, AnalysisResult } from './types';
import { analyzeStudentVideo, VideoMetadata } from './services/geminiService';
import ScoreChart from './components/ScoreChart';
import FeedbackSection from './components/FeedbackSection';

const App: React.FC = () => {
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>('');
  
  // Store the actual file for regeneration features
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  
  // Input States
  const [studentName, setStudentName] = useState<string>('');
  const [bookName, setBookName] = useState<string>('');
  const [homeworkType, setHomeworkType] = useState<string>('绘本跟读');
  const [tutorName, setTutorName] = useState<string>('');
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate video type roughly
    if (!file.type.startsWith('video/')) {
      setErrorMsg('请上传视频文件 (Please upload a video file)');
      return;
    }

    // Create local preview
    const previewUrl = URL.createObjectURL(file);
    setVideoPreview(previewUrl);
    setSelectedFile(file); // Save file
    setErrorMsg('');
    setResult(null);
    setStatus(AppStatus.ANALYZING);

    try {
      const metadata: VideoMetadata = {
        studentName,
        bookName,
        homeworkType,
        tutorName
      };
      
      const analysisData = await analyzeStudentVideo(file, metadata);
      
      // Merge input metadata back into result to ensure consistency even if AI misses it slightly
      setResult({
        ...analysisData,
        ...metadata
      });
      
      setStatus(AppStatus.SUCCESS);
    } catch (error) {
      console.error(error);
      setStatus(AppStatus.ERROR);
      setErrorMsg('分析失败，请重试。可能是视频过大或网络问题。 (Analysis failed. Try a smaller video.)');
    }
  };

  const handleReset = () => {
    setStatus(AppStatus.IDLE);
    setResult(null);
    setVideoPreview(null);
    setSelectedFile(null);
    setErrorMsg('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Generic function to handle any updates to the analysis result (scores, comments, suggestions)
  const handleDataUpdate = (newData: AnalysisResult) => {
    setResult(newData);
  };

  const getMetadata = (): VideoMetadata => ({
    studentName,
    bookName,
    homeworkType,
    tutorName
  });

  return (
    <div className="min-h-screen bg-gray-50 pb-12">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center space-x-2">
            <div className="bg-blue-600 text-white p-2 rounded-lg">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900 tracking-tight">EnglishPro Critique AI</h1>
              <p className="text-xs text-gray-500">智能口语测评助手</p>
            </div>
          </div>
          {status !== AppStatus.IDLE && (
            <button 
              onClick={handleReset}
              className="text-sm text-gray-600 hover:text-blue-600 font-medium transition-colors"
            >
              上传新视频
            </button>
          )}
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        
        {/* Intro / Upload Section */}
        {status === AppStatus.IDLE && (
          <div className="max-w-2xl mx-auto text-center mt-8">
            <h2 className="text-3xl font-bold text-gray-800 mb-4">上传学生口语视频</h2>
            <p className="text-gray-600 mb-8">AI 将自动分析视频中的发音、流利度和语调，并生成专业的点评报告。</p>
            
            <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100 mb-6 text-left">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                    <div>
                        <label htmlFor="studentName" className="block text-sm font-medium text-gray-700 mb-1">学生姓名</label>
                        <input 
                            type="text" 
                            id="studentName"
                            list="studentNameOptions"
                            value={studentName}
                            onChange={(e) => setStudentName(e.target.value)}
                            placeholder="例如: Kevin"
                            className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                        />
                        <datalist id="studentNameOptions">
                            <option value="核桃" />
                            <option value="Sunny" />
                            <option value="Adien" />
                            <option value="思语" />
                        </datalist>
                    </div>
                    <div>
                        <label htmlFor="tutorName" className="block text-sm font-medium text-gray-700 mb-1">辅导老师</label>
                        <input 
                            type="text" 
                            id="tutorName"
                            list="tutorNameOptions"
                            value={tutorName}
                            onChange={(e) => setTutorName(e.target.value)}
                            placeholder="例如: Teacher Emma"
                            className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                        />
                         <datalist id="tutorNameOptions">
                            <option value="Leo" />
                            <option value="Jackson" />
                        </datalist>
                    </div>
                    <div>
                         <label htmlFor="bookName" className="block text-sm font-medium text-gray-700 mb-1">绘本名称/内容</label>
                         <input 
                            type="text" 
                            id="bookName"
                            value={bookName}
                            onChange={(e) => setBookName(e.target.value)}
                            placeholder="例如: 牛津树 Level 2"
                            className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                        />
                    </div>
                    <div>
                         <label htmlFor="homeworkType" className="block text-sm font-medium text-gray-700 mb-1">作业类型</label>
                         <select 
                            id="homeworkType"
                            value={homeworkType}
                            onChange={(e) => setHomeworkType(e.target.value)}
                            className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all bg-white"
                        >
                            <option value="绘本跟读">绘本跟读</option>
                            <option value="看图说话">看图说话</option>
                            <option value="脱稿表演">脱稿表演</option>
                        </select>
                    </div>
                </div>

                <div className="relative border-2 border-dashed border-gray-300 rounded-xl p-10 bg-gray-50 hover:border-blue-500 hover:bg-blue-50 transition-all cursor-pointer group">
                <input 
                    ref={fileInputRef}
                    type="file" 
                    accept="video/*" 
                    onChange={handleFileChange}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <div className="flex flex-col items-center">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-gray-400 group-hover:text-blue-500 mb-3 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    <p className="font-semibold text-lg text-gray-700 group-hover:text-blue-600">点击上传视频文件</p>
                    <p className="text-sm text-gray-400 mt-2">支持 MP4, MOV, WEBM</p>
                </div>
                </div>
            </div>
            
            {errorMsg && (
              <div className="mt-4 p-3 bg-red-50 text-red-600 rounded-lg text-sm">
                {errorMsg}
              </div>
            )}
          </div>
        )}

        {/* Loading State */}
        {status === AppStatus.ANALYZING && (
          <div className="max-w-2xl mx-auto mt-12 flex flex-col items-center">
            <div className="w-full aspect-video bg-black rounded-xl overflow-hidden mb-6 shadow-lg relative">
                 {videoPreview && (
                   <video src={videoPreview} controls className="w-full h-full object-contain" />
                 )}
                 <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center text-white backdrop-blur-sm">
                    <div className="animate-spin rounded-full h-12 w-12 border-4 border-white border-t-transparent mb-4"></div>
                    <p className="text-lg font-medium animate-pulse">正在为 {studentName || '同学'} 分析口语...</p>
                    <p className="text-sm text-gray-300 mt-2">AI Analyzing Fluency & Pronunciation...</p>
                 </div>
            </div>
          </div>
        )}

        {/* Result State */}
        {status === AppStatus.SUCCESS && result && (
          <div className="animate-fade-in-up">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Left Column: Video & Chart */}
              <div className="lg:col-span-1 space-y-6">
                <div className="bg-black rounded-xl overflow-hidden shadow-lg aspect-video">
                   {videoPreview && (
                     <video src={videoPreview} controls className="w-full h-full object-contain" />
                   )}
                </div>
                <ScoreChart data={result} />
              </div>

              {/* Right Column: Detailed Feedback */}
              <div className="lg:col-span-2">
                <FeedbackSection 
                  data={result} 
                  onDataChange={handleDataUpdate}
                  videoFile={selectedFile}
                  metadata={getMetadata()}
                />
              </div>
            </div>
          </div>
        )}

        {/* Error State with Retry */}
        {status === AppStatus.ERROR && (
           <div className="max-w-xl mx-auto mt-12 text-center bg-white p-8 rounded-xl shadow-sm border border-red-100">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-100 mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-gray-800 mb-2">出错了</h3>
              <p className="text-gray-600 mb-6">{errorMsg}</p>
              <button 
                onClick={handleReset}
                className="px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
              >
                重试 (Try Again)
              </button>
           </div>
        )}

      </main>
    </div>
  );
};

export default App;
