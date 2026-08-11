"use client";

type RatingBarProps = {
  visible: boolean;
  ratingLabels: readonly string[];
  ratingDescriptions: readonly string[];
  ratingIntervalLabels: readonly string[];
  onRate: (rating: number) => void;
};

/** 评分按钮栏：忘记/模糊/认识/熟练 */
export default function RatingBar({
  visible,
  ratingLabels,
  ratingDescriptions,
  ratingIntervalLabels,
  onRate,
}: RatingBarProps) {
  return (
    <div
      className={visible ? "rating-bar visible" : "rating-bar"}
      inert={!visible}
      aria-hidden={!visible}
    >
      {ratingLabels.map((label, index) => (
        <button key={label} onClick={() => onRate(index)}>
          <span>{index + 1}</span>
          <strong>{label}</strong>
          <small>{ratingDescriptions[index]}。预计 {ratingIntervalLabels[index]} 后复习</small>
        </button>
      ))}
    </div>
  );
}
