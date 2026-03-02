export interface AssessmentCriteria {
  score: number;
  comment: string;
}

export interface AnalysisResult {
  studentName?: string;
  bookName?: string;
  homeworkType?: string;
  tutorName?: string;
  fluency: AssessmentCriteria;
  pronunciation: AssessmentCriteria;
  intonation: AssessmentCriteria;
  vocabulary: AssessmentCriteria;
  emotion: AssessmentCriteria;
  overallComment: string;
  suggestions: string[];
  grammarSummary?: string;
}

export enum AppStatus {
  IDLE = 'IDLE',
  ANALYZING = 'ANALYZING',
  SUCCESS = 'SUCCESS',
  ERROR = 'ERROR'
}