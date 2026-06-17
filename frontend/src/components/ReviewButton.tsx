import { BookOpenCheck, Repeat } from "lucide-react";

interface ReviewButtonProps {
  learned?: boolean;
  onLearned: () => void;
  onReview: () => void;
}

export const ReviewButton = ({ learned, onLearned, onReview }: ReviewButtonProps) => (
  <div className="flex flex-wrap gap-3">
    <button
      className="focus-ring inline-flex items-center gap-2 rounded-2xl bg-[#81D8CF] px-4 py-2 text-sm font-semibold text-[#343838] hover:bg-[#81D8CF]"
      onClick={onLearned}
    >
      <BookOpenCheck size={16} />
      {learned ? "已学过" : "Mark as learned"}
    </button>
    <button
      className="focus-ring inline-flex items-center gap-2 rounded-2xl border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-800 hover:bg-[#81D8CF] dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-900"
      onClick={onReview}
    >
      <Repeat size={16} />
      Add to review
    </button>
  </div>
);
