import { useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { QuizQuestion } from "../types/grammar";

interface QuizCardProps {
  question: QuizQuestion;
  onAnswer?: (isCorrect: boolean, userAnswer: string) => void;
}

export const QuizCard = ({ question, onAnswer }: QuizCardProps) => {
  const [answer, setAnswer] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const promptText = question.prompt ?? question.question;
  const correctText =
    question.type === "input"
      ? question.answers[0] ?? ""
      : question.type === "choice" && typeof question.answer === "number"
        ? question.options[question.answer] ?? ""
        : String(question.answer);
  const isCorrect =
    question.type === "boolean" || question.type === "truefalse"
      ? answer === String(question.answer)
      : question.type === "input"
        ? question.answers.some((item) => answer.trim().toLowerCase() === item.toLowerCase())
      : answer.trim().toLowerCase() === correctText.toLowerCase();

  const submit = () => {
    if (!answer) return;
    setSubmitted(true);
    onAnswer?.(isCorrect, answer);
  };

  return (
    <div className="rounded-2xl border border-white/18 bg-white/8 p-5 shadow-[0_8px_24px_rgba(0,0,0,0.12),inset_0_1px_0_rgba(255,255,255,0.15)]">
      <p className="text-sm font-semibold text-[#81D8CF]">Quiz</p>
      <h3 className="jp mt-2 text-lg font-semibold text-white drop-shadow-lg">
        {promptText}
      </h3>
      <div className="mt-4 space-y-3">
        {question.type === "choice" &&
          question.options?.map((option) => (
            <button
              key={option}
              className={`focus-ring block w-full rounded-xl border px-4 py-3 text-left text-sm transition-all shadow-[0_4px_12px_rgba(0,0,0,0.08),inset_0_1px_0_rgba(255,255,255,0.12)] ${
                answer === option
                  ? "border-[#81D8CF]/50 bg-[#81D8CF]/25 text-white shadow-[0_6px_20px_rgba(129,216,207,0.3),inset_0_1px_0_rgba(255,255,255,0.2)]"
                  : "border-white/15 bg-white/6 text-white/85 hover:bg-[#81D8CF]/15 hover:border-white/25"
              }`}
              onClick={() => setAnswer(option)}
            >
              {option}
            </button>
          ))}
        {(question.type === "boolean" || question.type === "truefalse") && (
          <div className="grid grid-cols-2 gap-3">
            {["true", "false"].map((value) => (
              <button
                key={value}
                className={`focus-ring rounded-xl border px-4 py-3 text-sm transition-all shadow-[0_4px_12px_rgba(0,0,0,0.08),inset_0_1px_0_rgba(255,255,255,0.12)] ${
                  answer === value
                    ? "border-[#81D8CF]/50 bg-[#81D8CF]/25 text-white shadow-[0_6px_20px_rgba(129,216,207,0.3),inset_0_1px_0_rgba(255,255,255,0.2)]"
                    : "border-white/15 bg-white/6 text-white/85 hover:bg-[#81D8CF]/15 hover:border-white/25"
                }`}
                onClick={() => setAnswer(value)}
              >
                {value === "true" ? "正确" : "错误"}
              </button>
            ))}
          </div>
        )}
        {question.type === "input" && (
          <input
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            className="focus-ring control-cyan soft-text-outline w-full rounded-xl border px-4 py-3 font-semibold"
            placeholder="输入答案"
          />
        )}
        {!submitted && (
          <button
            className="focus-ring rounded-xl bg-[#81D8CF] px-4 py-2 text-sm font-semibold text-[#343838] hover:bg-[#81D8CF]/85 transition shadow-[0_6px_20px_rgba(129,216,207,0.4),inset_0_1px_0_rgba(255,255,255,0.3)] hover:shadow-[0_8px_24px_rgba(129,216,207,0.5)] hover:-translate-y-0.5"
            onClick={submit}
          >
            Submit
          </button>
        )}
      </div>
      {submitted && (
        <div
          className={`mt-4 rounded-xl p-4 text-sm shadow-[0_4px_16px_rgba(0,0,0,0.15),inset_0_1px_0_rgba(255,255,255,0.1)] ${
            isCorrect
              ? "bg-[#81D8CF]/20 text-[#81D8CF] border border-[#81D8CF]/40"
              : "bg-[#81D8CF]/20 text-[#81D8CF] border border-[#81D8CF]/40"
          }`}
        >
          <div className="mb-2 flex items-center gap-2 font-semibold">
            {isCorrect ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
            {isCorrect ? "答对了" : `正确答案：${correctText}`}
          </div>
          {question.explanation}
        </div>
      )}
    </div>
  );
};
