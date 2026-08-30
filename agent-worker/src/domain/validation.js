import { AppError } from '../lib/errors.js';
import { stableHash } from '../lib/ids.js';
import { RULE_SKILL_SCOPES } from './rule-skills.js';

const text = (value, field, { min = 1, max = 1000, optional = false } = {}) => {
  if ((value === undefined || value === null) && optional) return '';
  if (typeof value !== 'string') throw new AppError(`${field} must be text.`, { code: 'VALIDATION_ERROR', status: 400 });
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max) {
    throw new AppError(`${field} must contain between ${min} and ${max} characters.`, { code: 'VALIDATION_ERROR', status: 400 });
  }
  return normalized;
};

function stableRuleIds(rules) {
  const occurrences = new Map();
  return rules.map(rule => {
    const base = `rule-${stableHash(rule).slice(0, 16)}`;
    const count = (occurrences.get(base) || 0) + 1;
    occurrences.set(base, count);
    return count === 1 ? base : `${base}-${count}`;
  });
}

export function parseCheckRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AppError('A JSON request body is required.', { code: 'VALIDATION_ERROR', status: 400 });
  const requestId = text(input.requestId, 'requestId', { max: 128 });
  const storeId = text(input.storeId || input.website, 'storeId', { max: 256 });
  const storeName = text(input.storeName || storeId, 'storeName', { max: 300 });
  const website = text(input.website, 'website', { max: 2048 });
  const agentDescription = text(input.agentDescription, 'agentDescription', { max: 6000, optional: true });
  if (!Array.isArray(input.agentRules) || input.agentRules.length < 1 || input.agentRules.length > 50) {
    throw new AppError('agentRules must contain between 1 and 50 rules.', { code: 'VALIDATION_ERROR', status: 400 });
  }
  const agentRules = input.agentRules.map((rule, index) => text(rule, `agentRules[${index}]`, { max: 1000 }));
  if (input.ruleIds !== undefined && !Array.isArray(input.ruleIds)) {
    throw new AppError('ruleIds must be an array when supplied.', { code: 'VALIDATION_ERROR', status: 400 });
  }
  const ruleIds = input.ruleIds === undefined
    ? stableRuleIds(agentRules)
    : input.ruleIds.map((id, index) => text(id, `ruleIds[${index}]`, { max: 128 }));
  if (ruleIds.length !== agentRules.length || new Set(ruleIds).size !== ruleIds.length) {
    throw new AppError('ruleIds must be unique and match agentRules one-for-one.', { code: 'VALIDATION_ERROR', status: 400 });
  }
  let parsed;
  try { parsed = new URL(website); } catch { throw new AppError('website must be a valid URL.', { code: 'VALIDATION_ERROR', status: 400 }); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new AppError('website must use HTTP or HTTPS and cannot contain embedded credentials.', { code: 'VALIDATION_ERROR', status: 400 });
  }
  parsed.hash = '';
  const normalizedWebsite = parsed.toString();
  const rules = ruleIds.map((ruleId, index) => ({ ruleId, text: agentRules[index] }));
  return Object.freeze({
    requestId, storeId, storeName, website: normalizedWebsite, agentDescription,
    agentRules, ruleIds, rules,
    rubricHash: stableHash(rules)
  });
}

export function parseLessonRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AppError('A JSON request body is required.', { code: 'VALIDATION_ERROR', status: 400 });
  return {
    storeId: text(input.storeId, 'storeId', { max: 256, optional: true }) || null,
    ruleId: text(input.ruleId, 'ruleId', { max: 128, optional: true }) || null,
    content: text(input.content, 'content', { min: 3, max: 4000 })
  };
}

export function parseFeedbackRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AppError('A JSON request body is required.', { code: 'VALIDATION_ERROR', status: 400 });
  const action = text(input.action, 'action', { max: 20 });
  if (!['confirm', 'correct', 'reject'].includes(action)) throw new AppError('action must be confirm, correct, or reject.', { code: 'VALIDATION_ERROR', status: 400 });
  const correctedScore = input.correctedScore === undefined || input.correctedScore === null
    ? null
    : typeof input.correctedScore === 'number' ? input.correctedScore : Number.NaN;
  if (correctedScore !== null && (!Number.isFinite(correctedScore) || correctedScore < 0 || correctedScore > 100)) {
    throw new AppError('correctedScore must be between 0 and 100.', { code: 'VALIDATION_ERROR', status: 400 });
  }
  return {
    ruleId: text(input.ruleId, 'ruleId', { max: 128 }),
    action,
    correctedScore,
    lesson: text(input.lesson, 'lesson', { max: 4000, optional: action !== 'correct' }),
    note: text(input.note, 'note', { max: 2000, optional: true })
  };
}

export function parseDiscussionRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AppError('A JSON request body is required.', { code: 'VALIDATION_ERROR', status: 400 });
  const history = input.history === undefined ? [] : input.history;
  if (!Array.isArray(history) || history.length > 20) throw new AppError('history must contain at most 20 messages.', { code: 'VALIDATION_ERROR', status: 400 });
  return {
    requestId: text(input.requestId, 'requestId', { max: 128 }),
    ruleId: text(input.ruleId, 'ruleId', { max: 128 }),
    message: text(input.message, 'message', { max: 4000 }),
    history: history.map((item, index) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new AppError(`history[${index}] is invalid.`, { code: 'VALIDATION_ERROR', status: 400 });
      const role = text(item.role, `history[${index}].role`, { max: 20 });
      if (!['user', 'assistant'].includes(role)) throw new AppError(`history[${index}].role must be user or assistant.`, { code: 'VALIDATION_ERROR', status: 400 });
      return { role, text: text(item.text, `history[${index}].text`, { max: 4000 }) };
    })
  };
}

export function parseRuleSkillRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AppError('A JSON request body is required.', { code: 'VALIDATION_ERROR', status: 400 });
  const scopeMode = text(input.scopeMode || 'sample', 'scopeMode', { max: 40 });
  if (!RULE_SKILL_SCOPES.has(scopeMode)) throw new AppError('scopeMode is invalid.', { code: 'VALIDATION_ERROR', status: 400 });
  const maximumPages = input.maximumPages === undefined || input.maximumPages === null
    ? null
    : Number(input.maximumPages);
  if (maximumPages !== null && (!Number.isInteger(maximumPages) || maximumPages < 1 || maximumPages > 250)) {
    throw new AppError('maximumPages must be a whole number between 1 and 250.', { code: 'VALIDATION_ERROR', status: 400 });
  }
  return {
    storeId: text(input.storeId, 'storeId', { max: 256 }),
    ruleId: text(input.ruleId, 'ruleId', { max: 128 }),
    name: text(input.name, 'name', { max: 300 }),
    instructions: text(input.instructions, 'instructions', { min: 3, max: 4000 }),
    scopeMode,
    maximumPages
  };
}

export function validateDiscussionResult(value) {
  if (!value || typeof value !== 'object') throw new AppError('The model returned an invalid discussion response.', { code: 'MODEL_RESULT_INVALID', retryable: true });
  let proposedSkill = null;
  if (value.proposedSkill !== null && value.proposedSkill !== undefined) {
    proposedSkill = parseRuleSkillRequest({
      storeId: 'discussion', ruleId: 'discussion',
      ...value.proposedSkill
    });
    delete proposedSkill.storeId;
    delete proposedSkill.ruleId;
  }
  return {
    reply: text(value.reply, 'reply', { max: 8000 }),
    proposedSkill
  };
}

export function validateAuditResults(value, expectedRules) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.results)) throw new AppError('The model returned an invalid result document.', { code: 'MODEL_RESULT_INVALID', retryable: true });
  if (value.results.length !== expectedRules.length) throw new AppError('The model did not return one result per rule.', { code: 'MODEL_RESULT_INVALID', retryable: true });
  const expected = new Map(expectedRules.map(rule => [rule.ruleId, rule]));
  const seen = new Set();
  const results = value.results.map(item => {
    if (!item || typeof item !== 'object' || !expected.has(item.ruleId) || seen.has(item.ruleId)) throw new AppError('The model returned missing, duplicate, or unknown rule IDs.', { code: 'MODEL_RESULT_INVALID', retryable: true });
    seen.add(item.ruleId);
    const score = item.score === null ? null : Number(item.score);
    if (score !== null && (!Number.isFinite(score) || score < 0 || score > 100)) throw new AppError('The model returned a score outside 0-100.', { code: 'MODEL_RESULT_INVALID', retryable: true });
    const evidence = Array.isArray(item.evidence) ? item.evidence.slice(0, 12).map((entry, index) => text(entry, `evidence[${index}]`, { max: 1000 })) : [];
    return {
      ruleId: item.ruleId,
      ruleText: expected.get(item.ruleId).text,
      score,
      explanation: text(item.explanation, 'explanation', { max: 4000 }),
      recommendation: item.recommendation === null || item.recommendation === undefined || item.recommendation === ''
        ? null
        : text(item.recommendation, 'recommendation', { max: 4000 }),
      evidence
    };
  });
  const scored = results.filter(result => result.score !== null);
  const overallScore = scored.length === results.length
    ? Math.round((scored.reduce((sum, result) => sum + result.score, 0) / scored.length) * 100) / 100
    : null;
  return { results, overallScore, summary: typeof value.summary === 'string' ? value.summary.trim().slice(0, 4000) : '' };
}
