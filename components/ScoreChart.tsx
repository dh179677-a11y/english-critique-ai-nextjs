import React from 'react';
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Tooltip
} from 'recharts';
import { AnalysisResult } from '../types';

interface ScoreChartProps {
  data: AnalysisResult;
}

const ScoreChart: React.FC<ScoreChartProps> = ({ data }) => {
  const chartData = [
    {
      subject: '流畅度 (Fluency)',
      A: data.fluency.score,
      fullMark: 100,
    },
    {
      subject: '发音 (Pronunc.)',
      A: data.pronunciation.score,
      fullMark: 100,
    },
    {
      subject: '语调 (Intonation)',
      A: data.intonation.score,
      fullMark: 100,
    },
    {
      subject: '单词 (Vocabulary)',
      A: data.vocabulary.score,
      fullMark: 100,
    },
    {
      subject: '情感 (Emotion)',
      A: data.emotion.score,
      fullMark: 100,
    },
  ];

  return (
    <div className="w-full h-[19rem] sm:h-[21rem] bg-white rounded-[1.4rem] shadow-sm border border-gray-100 p-4">
      <h3 className="mb-2 text-base font-semibold text-gray-800 text-center">能力维度分析</h3>
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart cx="50%" cy="50%" outerRadius="70%" data={chartData}>
          <PolarGrid gridType="polygon" />
          <PolarAngleAxis 
            dataKey="subject" 
            tick={{ fill: '#374151', fontSize: 11, fontWeight: 500 }} 
          />
          <PolarRadiusAxis 
            angle={90} 
            domain={[0, 100]} 
            tickCount={6}
            tick={{ fill: '#9CA3AF', fontSize: 9 }}
          />
          <Radar
            name="Score"
            dataKey="A"
            stroke="#2563EB"
            strokeWidth={3}
            fill="#3B82F6"
            fillOpacity={0.4}
            isAnimationActive={true}
          />
        <Tooltip
  formatter={(value) => {
    const v = typeof value === "number" ? value : Number(value);
    const display = Number.isFinite(v) ? `${v}` : "-";
    return [display, "得分"];
  }}
/>
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
};

export default ScoreChart;
