export type StoryflowRtcSpeechMode = "animation" | "intensive" | "shadow" | "speaking" | "assessment";

export const getStoryflowSpeechRecognitionLang = (mode: StoryflowRtcSpeechMode) =>
  mode === "speaking" || mode === "shadow" ? "en-US" : "zh-CN";

export const shouldScheduleStudentSpeechFallback = (
  mode: StoryflowRtcSpeechMode,
  isFinal: boolean
) => isFinal && (mode === "speaking" || mode === "intensive");

export const getCoachAudioClearDelayMs = (
  activeUntil: number,
  now: number,
  graceMs = 160
) => Math.max(0, activeUntil - now) + graceMs;

export const shouldSendLocalSpeechFallback = ({
  capturedAt,
  lastCoachActivityAt,
  isCoachAudioActive,
  transcript,
}: {
  capturedAt: number;
  lastCoachActivityAt: number;
  isCoachAudioActive: boolean;
  transcript: string;
}) =>
  Boolean(transcript.trim()) &&
  !isCoachAudioActive &&
  lastCoachActivityAt < capturedAt;
