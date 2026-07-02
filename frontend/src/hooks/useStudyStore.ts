import { useEffect, useMemo, useState } from "react";
import { MasteryStatus, MistakeItem, ReviewItem } from "../types/grammar";

const REVIEW_KEY = "jp-grammar-review";
const MISTAKE_KEY = "jp-grammar-mistakes";
const LEARNED_KEY = "jp-grammar-learned";

const intervals: Record<MasteryStatus, number> = {
  new: 0,
  learning: 1,
  familiar: 3,
  mastered: 7
};

const readJson = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};

const writeJson = <T,>(key: string, value: T) => {
  localStorage.setItem(key, JSON.stringify(value));
};

const nextStatus = (status: MasteryStatus): MasteryStatus => {
  if (status === "new") return "learning";
  if (status === "learning") return "familiar";
  return "mastered";
};

const previousStatus = (status: MasteryStatus): MasteryStatus => {
  if (status === "mastered") return "familiar";
  if (status === "familiar") return "learning";
  return "new";
};

export const useStudyStore = () => {
  const [reviews, setReviews] = useState<ReviewItem[]>(() => readJson(REVIEW_KEY, []));
  const [mistakes, setMistakes] = useState<MistakeItem[]>(() => readJson(MISTAKE_KEY, []));
  const [learned, setLearned] = useState<string[]>(() => readJson(LEARNED_KEY, []));

  useEffect(() => writeJson(REVIEW_KEY, reviews), [reviews]);
  useEffect(() => writeJson(MISTAKE_KEY, mistakes), [mistakes]);
  useEffect(() => writeJson(LEARNED_KEY, learned), [learned]);

  const reviewMap = useMemo(
    () => new Map(reviews.map((item) => [item.grammarId, item])),
    [reviews]
  );

  const getMastery = (grammarId: string): MasteryStatus => {
    const review = reviewMap.get(grammarId);
    if (review) return review.status;
    return learned.includes(grammarId) ? "familiar" : "new";
  };

  const markLearned = (grammarId: string) => {
    setLearned((current) => (current.includes(grammarId) ? current : [...current, grammarId]));
    setReviews((current) => {
      const existing = current.find((item) => item.grammarId === grammarId);
      if (existing) {
        return current.map((item) =>
          item.grammarId === grammarId ? { ...item, status: "familiar", streak: Math.max(item.streak, 1) } : item
        );
      }
      return [
        ...current,
        { grammarId, status: "familiar", streak: 1, dueAt: new Date().toISOString() }
      ];
    });
  };

  const addToReview = (grammarId: string) => {
    setReviews((current) => {
      if (current.some((item) => item.grammarId === grammarId)) return current;
      return [
        ...current,
        { grammarId, status: "new", streak: 0, dueAt: new Date().toISOString() }
      ];
    });
  };

  const recordReview = (grammarId: string, isCorrect: boolean) => {
    setReviews((current) => {
      const existing = current.find((item) => item.grammarId === grammarId) ?? {
        grammarId,
        status: "new" as MasteryStatus,
        streak: 0,
        dueAt: new Date().toISOString()
      };
      const status = isCorrect ? nextStatus(existing.status) : previousStatus(existing.status);
      const dueAt = new Date();
      dueAt.setDate(dueAt.getDate() + intervals[status]);
      const updated = {
        ...existing,
        status,
        streak: isCorrect ? existing.streak + 1 : 0,
        dueAt: dueAt.toISOString()
      };
      const without = current.filter((item) => item.grammarId !== grammarId);
      return [...without, updated];
    });
    if (isCorrect) {
      setLearned((current) => (current.includes(grammarId) ? current : [...current, grammarId]));
    }
  };

  const addMistake = (mistake: Omit<MistakeItem, "id" | "createdAt">) => {
    setMistakes((current) => [
      {
        ...mistake,
        id: `${mistake.questionId}-${Date.now()}`,
        createdAt: new Date().toISOString()
      },
      ...current
    ]);
  };

  const removeMistake = (id: string) => {
    setMistakes((current) => current.filter((item) => item.id !== id));
  };

  const dueReviews = useMemo(() => {
    const now = Date.now();
    return reviews.filter((item) => new Date(item.dueAt).getTime() <= now);
  }, [reviews]);

  return {
    reviews,
    dueReviews,
    mistakes,
    learned,
    getMastery,
    markLearned,
    addToReview,
    recordReview,
    addMistake,
    removeMistake
  };
};
