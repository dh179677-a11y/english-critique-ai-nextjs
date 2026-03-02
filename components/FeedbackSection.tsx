import React, { useState, useEffect } from 'react';
import { AnalysisResult } from '../types';
import { regenerateFeedbackSection, VideoMetadata } from '../services/geminiService';
import html2canvas from 'html2canvas';

interface FeedbackSectionProps {
  data: AnalysisResult;
  onDataChange: (newData: AnalysisResult) => void;
  videoFile: File | null;
  metadata: VideoMetadata;
}

type LayoutMode = 'default' | 'mobile-1' | 'mobile-2';

const FeedbackCard: React.FC<{ 
    title: string; 
    score: number; 
    comment: string; 
    colorClass: string;
    onScoreChange: (newScore: number) => void;
    onCommentChange: (newComment: string) => void;
}> = ({ title, score, comment, colorClass, onScoreChange, onCommentChange }) => {
  
  const handleScoreInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = parseInt(e.target.value, 10);
    if (isNaN(val)) val = 0;
    if (val > 100) val = 100;
    if (val < 0) val = 0;
    onScoreChange(val);
  };

  return (
    <div className={`p-4 rounded-xl border ${colorClass} bg-opacity-50 flex flex-col h-full group hover:bg-opacity-80 transition-all`}>
      <div className="flex justify-between items-center mb-2">
        <h4 className="font-semibold text-gray-800 text-sm md:text-base">{title}</h4>
        <div className="flex items-center space-x-1">
          <input 
            type="number" 
            value={score} 
            onChange={handleScoreInput}
            min={0}
            max={100}
            className={`w-12 text-lg font-bold text-right bg-transparent border-b border-dashed border-gray-400 focus:border-blue-600 focus:outline-none focus:ring-0 p-0 ${score >= 80 ? 'text-green-600' : score >= 60 ? 'text-yellow-600' : 'text-red-600'}`}
          />
          <span className="text-xs font-normal text-gray-500">/100</span>
        </div>
      </div>
      <textarea
        value={comment}
        onChange={(e) => onCommentChange(e.target.value)}
        className="text-gray-600 text-xs md:text-sm leading-relaxed flex-grow w-full bg-transparent border-none resize-none focus:ring-1 focus:ring-blue-300 rounded p-1"
        rows={4}
      />
    </div>
  );
};

// Helper to parse sections from text
const parseSections = (text: string): string[][] => {
  if (!text) return [];
  const lines = text.split('\n');
  const sections: string[][] = [];
  let currentSection: string[] = [];

  lines.forEach((line) => {
    // We keep whitespace lines in the current section until a new header is found
    const trimmed = line.trim();
    // Detect start of a new section
    const isHeader = /^(?:(?:#{1,6}|(?:\*\*|__))?\s*(?:\[.*?\]|\d+\.|总结|Summary|Overview|Overall|整体))/.test(trimmed);

    if (isHeader) {
      if (currentSection.length > 0) {
        sections.push(currentSection);
      }
      currentSection = [line];
    } else {
      currentSection.push(line);
    }
  });
  
  if (currentSection.length > 0) {
    sections.push(currentSection);
  }
  
  return sections;
};

const FeedbackSection: React.FC<FeedbackSectionProps> = ({ data, onDataChange, videoFile, metadata }) => {
  const [isExporting, setIsExporting] = useState(false);
  const [isEditingReport, setIsEditingReport] = useState(false);
  const [regeneratingSection, setRegeneratingSection] = useState<string | null>(null);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('default');
  
  // Custom Logo State
  const [customLogo, setCustomLogo] = useState<string | null>(null);
  const [logoError, setLogoError] = useState(false);

  // Load logo from local storage on mount
  useEffect(() => {
    const savedLogo = localStorage.getItem('englishProLogo');
    if (savedLogo) {
      setCustomLogo(savedLogo);
    }
  }, []);

  // Handle Logo Upload and Persistence
  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result as string;
        setCustomLogo(base64String);
        // Persist to local storage
        try {
          localStorage.setItem('englishProLogo', base64String);
        } catch (error) {
          console.warn("Logo too large to save to local storage");
        }
        setLogoError(false);
      };
      reader.readAsDataURL(file);
    }
  };

  // Helper to update specific sub-fields (fluency, etc)
  const updateCategory = (category: keyof AnalysisResult, field: 'score' | 'comment', value: number | string) => {
    const categoryData = data[category] as any;
    const newData = {
        ...data,
        [category]: {
            ...categoryData,
            [field]: value
        }
    };
    onDataChange(newData);
  };
  
  // Function to generate and download text report
  const handleDownloadTxt = () => {
    const studentName = data.studentName || '同学';
    const dateStr = new Date().toLocaleDateString();
    
    let report = `EnglishPro 口语评测报告\n`;
    report += `===========================\n`;
    report += `学生姓名: ${studentName}\n`;
    if (data.tutorName) report += `辅导老师: ${data.tutorName}\n`;
    if (data.bookName) report += `绘本名称: ${data.bookName}\n`;
    if (data.homeworkType) report += `作业类型: ${data.homeworkType}\n`;
    report += `评测日期: ${dateStr}\n`;
    report += `===========================\n\n`;

    report += `【能力维度评分】\n`;
    report += `流畅度: ${data.fluency.score}/100 - ${data.fluency.comment}\n`;
    report += `发音  : ${data.pronunciation.score}/100 - ${data.pronunciation.comment}\n`;
    report += `语调  : ${data.intonation.score}/100 - ${data.intonation.comment}\n`;
    report += `词汇  : ${data.vocabulary.score}/100 - ${data.vocabulary.comment}\n`;
    report += `情感  : ${data.emotion.score}/100 - ${data.emotion.comment}\n\n`;

    report += `【详细点评】\n`;
    report += `${data.overallComment}\n\n`;

    if (data.grammarSummary) {
      report += `【重点语法讲解】\n`;
      report += `${data.grammarSummary}\n\n`;
    }

    // Create blob and download link
    const blob = new Blob([report], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${studentName}_口语评测_文本.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Function to export as JPG Image
  const handleExportJPG = async () => {
    if (isEditingReport) {
        alert("请先完成编辑（点击保存）再导出图片。");
        return;
    }
    const element = document.getElementById('feedback-report-container');
    if (!element) return;
    
    setIsExporting(true);
    const studentName = data.studentName || 'Student';

    try {
      // Use html2canvas to capture the DOM
      const canvas = await html2canvas(element, {
        scale: 2, // Higher scale for retina/better quality
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff', // Ensure white background
        ignoreElements: (el) => el.hasAttribute('data-html2canvas-ignore'), // Skip buttons
        // Ensure the full height is captured, adding a bit of extra height logic if needed
        windowWidth: element.scrollWidth,
        windowHeight: element.scrollHeight + 50 // Add buffer
      });

      // Convert canvas to JPEG Data URL
      const imgData = canvas.toDataURL('image/jpeg', 0.9);
      
      // Create download link
      const link = document.createElement('a');
      link.href = imgData;
      link.download = `${studentName}_EnglishPro_Report.jpg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

    } catch (error) {
      console.error('JPG Export failed:', error);
      alert('图片导出失败，请重试');
    } finally {
      setIsExporting(false);
    }
  };

  // Helper to parse **bold** inside a string
  const formatBold = (text: string) => {
    const parts = text.split(/(\*\*.*?\*\*)/g);
    return parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
            return <strong key={i} className="font-semibold text-gray-900">{part.slice(2, -2)}</strong>;
        }
        return part;
    });
  };

  // Helper to format line content with colon detection and bolding
  const formatLineContent = (text: string) => {
    // 1. Handle "Label: Content" pattern
    // Catches "Label：" or "Label:" at the start
    const labelMatch = text.match(/^([^：:]+[：:])(.*)/);
    
    if (labelMatch) {
        return (
            <span>
                <span className="font-semibold text-gray-900">{labelMatch[1]}</span>
                {formatBold(labelMatch[2])}
            </span>
        );
    } else {
        return <span>{formatBold(text)}</span>;
    }
  };

  const handleRegenerate = async (sectionType: 'highlights' | 'pronunciation' | 'grammar') => {
    if (!videoFile) {
        alert("找不到视频文件，无法重新分析。(Video file missing)");
        return;
    }
    setRegeneratingSection(sectionType);

    try {
        const newContent = await regenerateFeedbackSection(videoFile, sectionType, metadata);
        
        // Replace content in existing overallComment
        // Logic: Find start of this section and start of next section
        
        let currentComment = data.overallComment;
        
        // Headers we look for
        const header1 = "1. 作业亮点";
        const header2 = "2. 发音评测";
        const header3 = "3. 语法评测";
        const header4 = "4. 整体评价";
        
        // Simple regex-based replacement might fail if headers vary slightly.
        // Let's try to locate indices.
        
        const idx1 = currentComment.indexOf(header1);
        const idx2 = currentComment.indexOf(header2);
        const idx3 = currentComment.indexOf(header3);
        const idx4 = currentComment.indexOf(header4);

        let start = -1;
        let end = -1;

        if (sectionType === 'highlights') {
            start = idx1;
            end = idx2;
        } else if (sectionType === 'pronunciation') {
            start = idx2;
            end = idx3;
        } else if (sectionType === 'grammar') {
            start = idx3;
            end = idx4;
        }

        if (start === -1 || (end === -1 && sectionType !== 'grammar')) { // grammar is 2nd to last, 4 is last
             // Fallback if structure is broken
             console.warn("Could not find section boundaries perfectly, appending to end or alerting.");
             alert("无法精确定位段落，请手动编辑。");
        } else {
             // If end is -1 (e.g. idx4 not found), go to end of string? No, section 3 should end before section 4.
             // If section 3 and section 4 exists
             if (sectionType === 'grammar' && end === -1) {
                 // Try to find end of string or just assume until end if section 4 missing
                 end = currentComment.length;
             }
             
             const before = currentComment.substring(0, start);
             const after = currentComment.substring(end);
             
             // Ensure newContent has spacing
             const updatedComment = before + newContent.trim() + "\n\n" + after.trim();
             onDataChange({ ...data, overallComment: updatedComment });
        }

    } catch (e) {
        console.error(e);
        alert("重新生成失败，请重试");
    } finally {
        setRegeneratingSection(null);
    }
  };

  const handleDeleteSection = (indexToDelete: number) => {
    if (!window.confirm("确定要删除这个板块吗？(Delete this section?)")) return;
    const sections = parseSections(data.overallComment);
    const newSections = sections.filter((_, idx) => idx !== indexToDelete);
    // Join lines within section, then join sections with double newline
    const newText = newSections.map(sec => sec.join('\n')).join('\n');
    onDataChange({ ...data, overallComment: newText });
  };

  const handleDeleteGrammar = () => {
    if (!window.confirm("确定要删除语法讲解板块吗？(Delete Grammar Section?)")) return;
    onDataChange({ ...data, grammarSummary: undefined });
  };

  // Render the segmented critique
  const renderSegmentedCritique = () => {
    if (!data.overallComment) return [];
    
    // We use the helper to get raw lines for all sections first
    const sections = parseSections(data.overallComment);

    return sections.map((sectionLines, index) => {
      // Clean up section lines:
      // 1. Separate header if possible
      // Clean up potential markdown formatting from header for display logic checks
      const originalHeaderLine = sectionLines[0];
      let displayHeader = originalHeaderLine.replace(/^(\*\*|__|#{1,6})/, '').replace(/(\*\*|__|#{1,6})$/, '').trim();

      // Exclude Section 0 (Basic Info) as it is already shown in the top bar
      if (displayHeader.includes('0.') || displayHeader.includes('视频信息')) {
        return null;
      }

      let bodyLines = sectionLines.slice(1);
      
      // If header line has content after colon (e.g. "1. Pronunciation: Good job"), split it
      const colonIndex = displayHeader.indexOf('：');
      const colonIndexEn = displayHeader.indexOf(':');
      let splitIndex = -1;
      
      if (colonIndex > -1 && colonIndexEn > -1) splitIndex = Math.min(colonIndex, colonIndexEn);
      else if (colonIndex > -1) splitIndex = colonIndex;
      else if (colonIndexEn > -1) splitIndex = colonIndexEn;

      if (splitIndex > -1 && (displayHeader.trim().startsWith('[') || /^\d+\./.test(displayHeader.trim()))) {
          const titlePart = displayHeader.substring(0, splitIndex).trim();
          const contentPart = displayHeader.substring(splitIndex + 1).trim();
          
          if (contentPart.length > 0) {
              displayHeader = titlePart;
              bodyLines.unshift(contentPart);
          }
      }

      // Remove leading/trailing empty lines from body to avoid weird gaps at top/bottom of card
      while (bodyLines.length > 0 && !bodyLines[0].trim()) {
         bodyLines.shift();
      }
      while (bodyLines.length > 0 && !bodyLines[bodyLines.length - 1].trim()) {
         bodyLines.pop();
      }

      // Determine style based on content
      let containerStyle = "bg-white border-gray-100";
      let headerColor = "text-gray-800";
      let icon = null;
      let sectionType: 'highlights' | 'pronunciation' | 'grammar' | null = null;
      
      if (displayHeader.includes('亮点') || displayHeader.includes('Highlights') || displayHeader.includes('1.')) {
        containerStyle = "bg-green-50 border-green-100";
        headerColor = "text-green-700";
        sectionType = 'highlights';
        icon = (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5" />
            </svg>
        );
      } else if (displayHeader.includes('发音') || displayHeader.includes('语音') || displayHeader.includes('2.')) {
        containerStyle = "bg-red-50 border-red-100";
        headerColor = "text-red-700";
        sectionType = 'pronunciation';
        icon = (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
            </svg>
        );
      } else if (displayHeader.includes('语法') || displayHeader.includes('3.')) {
         containerStyle = "bg-yellow-50 border-yellow-100";
         headerColor = "text-yellow-700";
         sectionType = 'grammar';
         icon = (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
         );
      } else if (displayHeader.includes('整体') || displayHeader.includes('4.') || displayHeader.includes('家长')) {
         containerStyle = "bg-blue-50 border-blue-100";
         headerColor = "text-blue-700";
         icon = (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
         );
      } else if (displayHeader.includes('信息') || displayHeader.includes('0.')) {
         containerStyle = "bg-gray-50 border-gray-200";
         headerColor = "text-gray-700";
         icon = (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
         );
      }

      return (
        <div key={index} className={`mb-4 p-5 rounded-xl border ${containerStyle} shadow-sm transition-all hover:shadow-md group relative`}>
          {/* Header Line with Actions */}
          <div className={`flex items-start sm:items-center justify-between text-lg font-bold mb-3 ${headerColor} border-b border-black/5 pb-2`}>
            <div className="flex items-center">
                <span className="flex-shrink-0 flex items-center justify-center mr-2 mt-0.5">
                    {icon}
                </span>
                <span>{displayHeader}</span>
            </div>
            
            <div className="flex items-center space-x-2" data-html2canvas-ignore="true">
                {sectionType && (
                    <button 
                    onClick={() => handleRegenerate(sectionType!)}
                    disabled={regeneratingSection === sectionType}
                    className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center space-x-1 text-xs px-2 py-1 bg-white border border-gray-200 rounded-md shadow-sm hover:bg-gray-50 text-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="重新分析此板块"
                    >
                        {regeneratingSection === sectionType ? (
                        <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        )}
                        <span className="hidden sm:inline">重新点评</span>
                    </button>
                )}
                
                <button 
                  onClick={() => handleDeleteSection(index)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity p-1 bg-white border border-gray-200 rounded-md shadow-sm hover:bg-red-50 text-gray-400 hover:text-red-500"
                  title="删除此板块"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                </button>
            </div>
          </div>
          
          {/* Body Lines with Enhanced Formatting */}
          <div className="">
            {bodyLines.map((line, lineIdx) => {
               const trimmedLine = line.trim();
               
               // Render Empty lines as Spacers
               if (!trimmedLine) {
                 return <div key={lineIdx} className="h-4"></div>;
               }
               
               // Check for sub-headers (starts with > or * from legacy/hallucination)
               const isSubHeader = trimmedLine.startsWith('>') || (trimmedLine.startsWith('*') && !trimmedLine.startsWith('**'));
               // Check for list items (starts with -)
               const isListItem = trimmedLine.startsWith('-');
               
               // Formatting logic
               let className = "text-gray-700 text-sm sm:text-base leading-relaxed";
               let displayContent = trimmedLine;
               
               if (isSubHeader) {
                   className += " font-semibold text-gray-900 mt-3 mb-2 bg-white/50 p-2 rounded-lg -mx-2";
                   displayContent = displayContent.replace(/^[>*]\s?/, '').trim(); // Remove marker
               } else if (isListItem) {
                   className += " pl-4 relative mb-2";
                   displayContent = displayContent.substring(1).trim(); // Remove -
               } else {
                   // Regular paragraph
                   className += " mb-4 text-justify";
               }
               
               return (
                 <div key={lineIdx} className={className}>
                    {isListItem && <span className="absolute left-0 top-2.5 w-1.5 h-1.5 rounded-full bg-gray-400"></span>}
                    {formatLineContent(displayContent)}
                 </div>
               );
            })}
          </div>
        </div>
      );
    });
  };

  const getLayoutStyles = () => {
    switch (layoutMode) {
      case 'mobile-1':
        return {
          container: 'max-w-md mx-auto',
          grid: 'grid-cols-1 gap-3',
        };
      case 'mobile-2':
        return {
          container: 'max-w-2xl mx-auto',
          grid: 'grid-cols-2 gap-3',
        };
      default:
        return {
          container: 'w-full',
          grid: 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3',
        };
    }
  };

  const layoutStyles = getLayoutStyles();
  const renderedSections = isEditingReport ? [] : renderSegmentedCritique();
  const hasContent = renderedSections.some(s => s !== null);

  const isMobileLayout = layoutMode === 'mobile-1' || layoutMode === 'mobile-2';

  return (
    <div className="">
       {/* Layout Controls - Ignored by HTML2Canvas */}
       <div className="flex justify-end items-center space-x-2 mb-4" data-html2canvas-ignore="true">
          <span className="text-xs font-medium text-gray-500">版式调整 (Layout):</span>
          <div className="flex bg-gray-100 p-1 rounded-lg">
              <button 
                  onClick={() => setLayoutMode('default')}
                  className={`px-3 py-1 text-xs rounded-md transition-all ${layoutMode === 'default' ? 'bg-white shadow-sm text-blue-600 font-medium' : 'text-gray-500 hover:text-gray-700'}`}
              >
                  原版
              </button>
              <button 
                  onClick={() => setLayoutMode('mobile-1')}
                  className={`px-3 py-1 text-xs rounded-md transition-all ${layoutMode === 'mobile-1' ? 'bg-white shadow-sm text-blue-600 font-medium' : 'text-gray-500 hover:text-gray-700'}`}
              >
                  手机单列
              </button>
              <button 
                  onClick={() => setLayoutMode('mobile-2')}
                  className={`px-3 py-1 text-xs rounded-md transition-all ${layoutMode === 'mobile-2' ? 'bg-white shadow-sm text-blue-600 font-medium' : 'text-gray-500 hover:text-gray-700'}`}
              >
                  手机双列
              </button>
          </div>
       </div>

    {/* MAIN REPORT CONTAINER for EXPORT */}
    {/* Added bg-white and padding to the container itself so the background applies to the export correctly */}
    <div className={`space-y-6 ${layoutStyles.container} bg-white p-4 sm:p-8 rounded-2xl pb-16`} id="feedback-report-container">
        
        {/* UPDATED HEADER with Banner Background and Improved Alignment */}
        <div className="relative overflow-hidden rounded-xl bg-gradient-to-r from-blue-50 via-indigo-50 to-purple-50 p-6 mb-4">
            
            {/* Decorative soft circles */}
            <div className="absolute top-0 right-0 -mr-12 -mt-12 w-48 h-48 rounded-full bg-blue-100 opacity-60 blur-3xl"></div>
            <div className="absolute bottom-0 left-0 -ml-12 -mb-12 w-48 h-48 rounded-full bg-purple-100 opacity-60 blur-3xl"></div>

            <div className="relative z-10 flex items-center space-x-4">
                {/* REMOVED border-4 border-white */}
                <div className="w-[72px] h-[72px] rounded-full overflow-hidden shadow-md shrink-0 relative group bg-white">
                    {!logoError ? (
                        <img 
                            src={customLogo || "logo.png"} 
                            alt="Logo" 
                            className="w-full h-full object-cover"
                            onError={() => setLogoError(true)}
                        />
                    ) : (
                        <div className="w-full h-full bg-gray-100 flex items-center justify-center text-[10px] text-gray-500 font-bold cursor-pointer">
                            Logo
                        </div>
                    )}
                    
                    {/* Hidden input to allow user to upload their own logo by clicking */}
                    <label className="absolute inset-0 bg-black/0 hover:bg-black/10 cursor-pointer flex items-center justify-center transition-colors" title="点击更换Logo (Click to change)">
                        <input 
                            type="file" 
                            accept="image/*" 
                            className="hidden" 
                            onChange={handleLogoUpload}
                        />
                    </label>
                </div>
                <div>
                    <h2 className="text-3xl font-extrabold text-gray-800 tracking-wide leading-tight">英爸阅读营</h2>
                </div>
            </div>
        </div>

        {/* Basic Info Bar - Placed at the top for Export Visibility */}
        <div className={`bg-white rounded-xl shadow-sm border border-gray-200 p-4 ${isMobileLayout ? 'grid grid-cols-2 gap-4' : 'flex flex-wrap items-center justify-between gap-4'}`}>
               <div className={`flex items-center space-x-3 ${!isMobileLayout ? 'min-w-[120px]' : ''}`}>
                 <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center flex-shrink-0">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                 </div>
                 <div className="min-w-0">
                    <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">学生姓名</p>
                    <p className="font-bold text-gray-900 text-base break-words">{data.studentName || '同学'}</p>
                 </div>
               </div>

               {!isMobileLayout && <div className="w-px h-10 bg-gray-100 hidden sm:block"></div>}

               <div className={`flex items-center space-x-3 ${!isMobileLayout ? 'min-w-[120px]' : ''}`}>
                 <div className="w-10 h-10 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center flex-shrink-0">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                 </div>
                 <div className="min-w-0">
                    <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">辅导老师</p>
                    <p className="font-bold text-gray-900 text-base break-words">{data.tutorName || 'Teacher'}</p>
                 </div>
               </div>

               {!isMobileLayout && <div className="w-px h-10 bg-gray-100 hidden sm:block"></div>}

               <div className={`flex items-center space-x-3 ${!isMobileLayout ? 'min-w-[140px] flex-grow' : ''}`}>
                 <div className="w-10 h-10 rounded-full bg-purple-50 text-purple-600 flex items-center justify-center flex-shrink-0">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                    </svg>
                 </div>
                 <div className="min-w-0">
                    <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">绘本内容</p>
                    <p className="font-bold text-gray-900 text-base break-words" title={data.bookName}>{data.bookName || '未指定'}</p>
                 </div>
               </div>

               {!isMobileLayout && <div className="w-px h-10 bg-gray-100 hidden md:block"></div>}

               <div className={`flex items-center space-x-3 ${!isMobileLayout ? 'min-w-[120px]' : ''}`}>
                 <div className="w-10 h-10 rounded-full bg-teal-50 text-teal-600 flex items-center justify-center flex-shrink-0">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
                    </svg>
                 </div>
                 <div className="min-w-0">
                    <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">作业类型</p>
                    <p className="font-bold text-gray-900 text-base break-words">
                        {data.homeworkType || '口语练习'}
                    </p>
                 </div>
               </div>
        </div>

      <div className={`grid ${layoutStyles.grid}`}>
        <FeedbackCard 
          title="流畅度 (Fluency)" 
          score={data.fluency.score} 
          comment={data.fluency.comment}
          colorClass="bg-blue-50 border-blue-100"
          onScoreChange={(val) => updateCategory('fluency', 'score', val)}
          onCommentChange={(val) => updateCategory('fluency', 'comment', val)}
        />
        <FeedbackCard 
          title="发音 (Pronunc.)" 
          score={data.pronunciation.score} 
          comment={data.pronunciation.comment}
          colorClass="bg-indigo-50 border-indigo-100"
          onScoreChange={(val) => updateCategory('pronunciation', 'score', val)}
          onCommentChange={(val) => updateCategory('pronunciation', 'comment', val)}
        />
        <FeedbackCard 
          title="语调 (Intonation)" 
          score={data.intonation.score} 
          comment={data.intonation.comment}
          colorClass="bg-purple-50 border-purple-100"
          onScoreChange={(val) => updateCategory('intonation', 'score', val)}
          onCommentChange={(val) => updateCategory('intonation', 'comment', val)}
        />
        <FeedbackCard 
          title="单词 (Vocab)" 
          score={data.vocabulary.score} 
          comment={data.vocabulary.comment}
          colorClass="bg-teal-50 border-teal-100"
          onScoreChange={(val) => updateCategory('vocabulary', 'score', val)}
          onCommentChange={(val) => updateCategory('vocabulary', 'comment', val)}
        />
        <FeedbackCard 
          title="情感 (Emotion)" 
          score={data.emotion.score} 
          comment={data.emotion.comment}
          colorClass="bg-orange-50 border-orange-100"
          onScoreChange={(val) => updateCategory('emotion', 'score', val)}
          onCommentChange={(val) => updateCategory('emotion', 'comment', val)}
        />
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {/* ADDED data-html2canvas-ignore="true" to the title BAR container buttons only */}
        <div className="bg-gray-50 px-6 py-4 border-b border-gray-100 flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
            <div className="flex items-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 mr-3 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                <h3 className="text-lg font-bold text-gray-800">老师详细点评 (Teacher Critique)</h3>
            </div>
            
            {/* Added data-html2canvas-ignore to the BUTTONS container only */}
            <div className="flex space-x-2" data-html2canvas-ignore="true">
                 <button 
                    onClick={() => setIsEditingReport(!isEditingReport)}
                    className={`flex items-center space-x-1 px-3 py-1.5 rounded-lg text-xs md:text-sm font-medium transition-colors border ${isEditingReport ? 'bg-indigo-600 text-white border-transparent' : 'bg-white text-indigo-600 border-indigo-200 hover:bg-indigo-50'}`}
                >
                    {isEditingReport ? (
                        <>
                           <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            <span>完成编辑 (Save)</span>
                        </>
                    ) : (
                        <>
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                            <span>修改点评 (Edit)</span>
                        </>
                    )}
                </button>
                <button 
                    onClick={handleDownloadTxt}
                    className="flex items-center space-x-1 px-3 py-1.5 bg-gray-50 text-gray-600 rounded-lg text-xs md:text-sm font-medium hover:bg-gray-100 transition-colors border border-gray-200"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <span>下载文本</span>
                </button>
                <button 
                    onClick={handleExportJPG}
                    disabled={isExporting}
                    className={`flex items-center space-x-1 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs md:text-sm font-medium hover:bg-blue-700 transition-colors border border-transparent shadow-sm ${isExporting ? 'opacity-70 cursor-wait' : ''}`}
                >
                    {isExporting ? (
                         <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                    ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                    )}
                    <span>{isExporting ? '生成中...' : '生成长图'}</span>
                </button>
            </div>
        </div>
        <div className="p-6 bg-white min-h-[300px]">
             {isEditingReport ? (
                 <div className="space-y-2">
                     <p className="text-sm text-amber-600 bg-amber-50 p-2 rounded">
                        💡 提示：保持段落标题（如“1. 发音评测”）格式不变，以确保退出编辑后能正确排版。支持使用 **加粗**。
                     </p>
                     <textarea 
                        value={data.overallComment}
                        onChange={(e) => onDataChange({ ...data, overallComment: e.target.value })}
                        className="w-full h-96 p-4 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm leading-relaxed"
                     />
                 </div>
             ) : (
                 hasContent ? renderedSections : (
                    <div className="whitespace-pre-wrap text-gray-700 leading-relaxed">
                        {data.overallComment}
                    </div>
                 )
             )}
        </div>
      </div>

      {/* Grammar Summary Section - Only show if defined (not deleted) */}
      {data.grammarSummary !== undefined && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden mt-6 group">
          <div className="bg-indigo-50 px-6 py-4 border-b border-indigo-100 flex items-center justify-between">
              <div className="flex items-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 mr-3 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
                <h3 className="text-lg font-bold text-indigo-900">重点语法讲解 (Key Grammar Points)</h3>
              </div>
              <button 
                  onClick={handleDeleteGrammar}
                  className="opacity-0 group-hover:opacity-100 transition-opacity p-1 bg-white border border-indigo-200 rounded-md shadow-sm hover:bg-red-50 text-indigo-300 hover:text-red-500"
                  title="删除语法板块"
                  data-html2canvas-ignore="true"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
              </button>
          </div>
          <div className="p-6">
              {isEditingReport ? (
                  <textarea 
                      value={data.grammarSummary || ''}
                      onChange={(e) => onDataChange({ ...data, grammarSummary: e.target.value })}
                      className="w-full h-48 p-4 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm leading-relaxed"
                      placeholder="AI 将在此生成重点语法讲解..."
                  />
              ) : (
                  <div className="text-gray-700 leading-relaxed whitespace-pre-wrap">
                      {data.grammarSummary || '暂无语法重点讲解。'}
                  </div>
              )}
          </div>
        </div>
      )}

      {/* FOOTER - Increased Padding for Export */}
      <div className="flex justify-center items-center py-6 mt-6 border-t border-dashed border-gray-200">
             <p className="text-base text-gray-600 font-medium text-center">
                小红书/抖音搜索 <span className="font-bold text-gray-800 text-lg mx-1">英爸</span> 获取3-12岁英语规划与课程
             </p>
      </div>

    </div>
    </div>
  );
};

export default FeedbackSection;