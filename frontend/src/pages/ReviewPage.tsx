import { QuizPage } from "./QuizPage";
import { JLPTLevel, ReviewItem } from "../types/grammar";

interface ReviewPageProps {
  dueReviews?: ReviewItem[];
  onReviewResult?: (grammarId: string, isCorrect: boolean) => void;
  onMistake?: (grammarId: string, questionId: string, prompt: string, userAnswer: string, correctAnswer: string, explanation: string) => void;
  selectedLevel?: "All" | JLPTLevel;
}

export const ReviewPage = ({ selectedLevel = "All" }: ReviewPageProps) => {
  return <QuizPage selectedLevel={selectedLevel} />;
};
