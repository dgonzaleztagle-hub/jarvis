const TRUSTED_DOMAIN_HINTS = [
  '.gov',
  '.gob.',
  '.edu',
  '.ac.',
  'who.int',
  'nih.gov',
  'ncbi.nlm.nih.gov',
  'google.com',
  'developers.google.com',
  'cloud.google.com'
];

const WEAK_DOMAIN_HINTS = [
  'blogspot.',
  'medium.com',
  'quora.com',
  'reddit.com',
  'pinterest.',
  'tiktok.',
  'facebook.'
];

function evaluateSource(input = {}) {
  const url = String(input.url || '').toLowerCase();
  const title = String(input.title || '');
  const author = String(input.author || '');
  const publishedAt = input.publishedAt ? new Date(input.publishedAt) : null;
  const domainContext = String(input.domainContext || '').toLowerCase();
  const sensitivity = input.sensitivity || 'normal';

  let score = 0.45;
  const reasons = [];

  if (TRUSTED_DOMAIN_HINTS.some((hint) => url.includes(hint))) {
    score += 0.25;
    reasons.push('trusted_domain');
  }

  if (WEAK_DOMAIN_HINTS.some((hint) => url.includes(hint))) {
    score -= 0.2;
    reasons.push('weak_domain');
  }

  if (author.trim().length > 2) {
    score += 0.08;
    reasons.push('identified_author');
  }

  if (publishedAt && !Number.isNaN(publishedAt.getTime())) {
    const ageDays = (Date.now() - publishedAt.getTime()) / 86400000;
    if (ageDays <= 730) {
      score += 0.08;
      reasons.push('recent_source');
    } else {
      score -= 0.08;
      reasons.push('old_source');
    }
  } else {
    score -= 0.05;
    reasons.push('missing_date');
  }

  if (domainContext && (url.includes(domainContext) || title.toLowerCase().includes(domainContext))) {
    score += 0.08;
    reasons.push('domain_context_match');
  }

  if (['medical', 'legal', 'financial'].includes(sensitivity) && score < 0.75) {
    reasons.push('sensitive_requires_high_confidence');
  }

  score = Math.max(0, Math.min(1, Number(score.toFixed(2))));

  let rating = 'low';
  if (score >= 0.78) rating = 'high';
  else if (score >= 0.55) rating = 'medium';

  const acceptableForMemory = rating === 'high' || (rating === 'medium' && !['medical', 'legal', 'financial'].includes(sensitivity));

  return {
    score,
    rating,
    reasons,
    acceptableForMemory,
    recommendedState: acceptableForMemory ? 'candidate' : 'low_confidence'
  };
}

function createResearchTools() {
  return [
    {
      name: 'research.evaluate_source',
      description: 'Evaluate whether a source is suitable for Jarvis memory ingestion.',
      risk: 'low',
      permissions: ['research:evaluate_source'],
      execute: async (input) => evaluateSource(input)
    }
  ];
}

module.exports = {
  evaluateSource,
  createResearchTools
};
