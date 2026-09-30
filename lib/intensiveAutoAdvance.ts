export const INTENSIVE_AUTO_ADVANCE_CUE = "这一页讲完了，我们自动进入下一页。";

const normalizeCueText = (value: string) =>
  value.replace(/[\s，,。.!！?？]/g, "");

type IntensiveAutoAdvanceInput = {
  mode: string;
  role: "student" | "coach";
  definite: boolean;
  text: string;
  canNext: boolean;
};

export const shouldAutoAdvanceIntensivePage = ({
  mode,
  role,
  definite,
  text,
  canNext,
}: IntensiveAutoAdvanceInput) =>
  mode === "intensive" &&
  role === "coach" &&
  definite &&
  canNext &&
  normalizeCueText(text).includes(normalizeCueText(INTENSIVE_AUTO_ADVANCE_CUE));
