type IntensiveAutoAdvanceInput = {
  mode: string;
  role: "student" | "coach";
  definite: boolean;
  text: string;
  canNext: boolean;
  studentAnswered: boolean;
};

export const shouldAutoAdvanceIntensivePage = ({
  mode,
  role,
  definite,
  canNext,
  studentAnswered,
}: IntensiveAutoAdvanceInput) =>
  mode === "intensive" &&
  role === "coach" &&
  definite &&
  canNext &&
  studentAnswered;
