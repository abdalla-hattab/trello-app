const terms = value => new Set(String(value || '').toLowerCase().normalize('NFKC').match(/[\p{L}\p{N}]{2,}/gu) || []);

export function lexicalScore(query, candidate) {
  const left = terms(query);
  const right = terms(candidate);
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const term of left) if (right.has(term)) intersection += 1;
  return intersection / Math.sqrt(left.size * right.size);
}

export function cosineSimilarity(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length || !left.length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }
  return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : 0;
}

export function rankLessons(lessons, { query, embedding, storeId, limit = 12 }) {
  return lessons
    .map(lesson => ({
      ...lesson,
      relevance:
        (lesson.storeId && lesson.storeId === storeId ? 0.35 : 0) +
        lexicalScore(query, lesson.content) * 0.35 +
        cosineSimilarity(embedding, lesson.embedding) * 0.3
    }))
    .sort((left, right) => right.relevance - left.relevance || String(right.updatedAt).localeCompare(String(left.updatedAt)))
    .slice(0, limit);
}
