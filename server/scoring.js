export function normalizeAnswer(optionIds = []) {
  return [...new Set(optionIds.map(String))].sort();
}

export function isCorrectAnswer(selectedOptionIds, correctOptionIds) {
  const selected = normalizeAnswer(selectedOptionIds);
  const correct = normalizeAnswer(correctOptionIds);
  if (selected.length !== correct.length) return false;
  return selected.every((id, index) => id === correct[index]);
}

export function calculatePoints({ selectedOptionIds, correctOptionIds, deadline, answeredAt, basePoints = 1000 }) {
  const correct = isCorrectAnswer(selectedOptionIds, correctOptionIds);
  if (!correct) {
    return { correct: false, points: 0, speedBonus: 0 };
  }

  const remainingMs = Math.max(0, Number(deadline) - Number(answeredAt));
  const speedBonus = Math.floor(remainingMs / 1000) * 10;
  return { correct: true, points: basePoints + speedBonus, speedBonus };
}
