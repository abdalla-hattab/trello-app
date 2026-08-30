const PREFIX = 'AGENT_RULE_SKILL_V1:';

export const RULE_SKILL_SCOPES = new Set(['sample', 'all_product_pages', 'all_discovered_pages']);

export function encodeRuleSkill(skill) {
  return `${PREFIX}${JSON.stringify({
    name: skill.name,
    instructions: skill.instructions,
    scopeMode: skill.scopeMode,
    maximumPages: skill.maximumPages
  })}`;
}

export function decodeRuleSkill(lesson) {
  if (!lesson || lesson.source !== 'rule_skill' || typeof lesson.content !== 'string' || !lesson.content.startsWith(PREFIX)) return null;
  try {
    const value = JSON.parse(lesson.content.slice(PREFIX.length));
    if (!value || typeof value.name !== 'string' || typeof value.instructions !== 'string' || !RULE_SKILL_SCOPES.has(value.scopeMode)) return null;
    const maximumPages = value.maximumPages === null ? null : Number(value.maximumPages);
    if (maximumPages !== null && (!Number.isInteger(maximumPages) || maximumPages < 1)) return null;
    return {
      id: lesson.id,
      storeId: lesson.storeId,
      ruleId: lesson.ruleId,
      name: value.name,
      instructions: value.instructions,
      scopeMode: value.scopeMode,
      maximumPages,
      status: lesson.status,
      createdAt: lesson.createdAt,
      updatedAt: lesson.updatedAt
    };
  } catch { return null; }
}

export function humanReadableSkill(skill) {
  const coverage = skill.scopeMode === 'all_product_pages'
    ? `Inspect every product page that can be discovered, up to ${skill.maximumPages || 'the configured safety limit'} pages.`
    : skill.scopeMode === 'all_discovered_pages'
      ? `Inspect every internal page that can be discovered, up to ${skill.maximumPages || 'the configured safety limit'} pages.`
      : 'Use the normal representative page sample.';
  return `${skill.instructions}\nCoverage: ${coverage}`;
}
