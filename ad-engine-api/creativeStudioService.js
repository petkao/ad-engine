// Creative Studio Service
// LLM generation logic for product analysis, campaigns, scripts, and storyboards
//
// This service uses only the generic LLM provider interface.
// No provider-specific clients are constructed here.

const {
  createProvider,
  createValidatedProvider,
  getDefaultProvider,
  validateProvider,
  sanitizeForLog,
} = require('./llmProvider');

const {
  ProductAnalysisSchema,
  CampaignConceptsSchema,
  ScriptContentSchema,
  StoryboardContentSchema,
  EvaluationScoresSchema,
  RenderSpecSchema,
  safeParse,
} = require('./creativeStudioSchemas');

// ─── PROVIDER MANAGEMENT ─────────────────────────────────────
// Lazy initialization with validation

let _provider = null;
let _providerValidated = false;

/**
 * Get the configured LLM provider (lazy initialization with validation)
 * @returns {import('./llmProvider').LLMProvider}
 */
function getProvider() {
  if (!_provider) {
    _provider = getDefaultProvider();
    console.log(`[CreativeStudio] Initializing LLM provider: ${_provider.getName()}`);
  }

  // Validate on first use
  if (!_providerValidated) {
    validateProvider(_provider);
    _providerValidated = true;
  }

  return _provider;
}

/**
 * Configure a custom LLM provider for Creative Studio
 * @param {Object} config - Provider configuration
 * @param {boolean} [skipValidation=false] - Skip validation (for testing)
 */
function configureProvider(config, skipValidation = false) {
  if (skipValidation) {
    _provider = createProvider(config);
  } else {
    _provider = createValidatedProvider(config);
  }
  _providerValidated = !skipValidation;
  console.log(`[CreativeStudio] Provider configured: ${_provider.getName()}`);
}

/**
 * Validate provider at startup (call during server initialization)
 * @throws {Error} if provider is not properly configured
 */
function validateProviderAtStartup() {
  const provider = getProvider();
  validateProvider(provider);
  console.log(`[CreativeStudio] Provider validated at startup: ${provider.getName()}`);
}

// ─── LOGGING UTILITIES ───────────────────────────────────────
// Never log full prompts, API keys, or sensitive seller data

function logStep(step, details = {}) {
  const safeDetails = {};
  for (const [key, value] of Object.entries(details)) {
    // Skip sensitive fields
    if (['prompt', 'content', 'description', 'analysis', 'product', 'seller'].includes(key)) {
      continue;
    }
    safeDetails[key] = sanitizeForLog(value, 50);
  }
  console.log(`[CreativeStudio] ${step}`, Object.keys(safeDetails).length ? safeDetails : '');
}

// ─── PROMPT TEMPLATES ─────────────────────────────────────────

const SYSTEM_PROMPT = 'You are a creative AI assistant that returns only valid JSON. Never include markdown formatting, code blocks, or explanations outside the JSON structure.';

const PRODUCT_ANALYSIS_PROMPT = `You are a creative strategist analyzing a product for video advertisement development.

Analyze the following product and return a structured JSON analysis:

Product Information:
- Name: {{productName}}
- Category: {{category}}
- Price: {{price}} {{currency}}
- Description: {{description}}
- Product URL: {{productUrl}}

Seller Information:
- Seller Name: {{sellerName}}
- Industry: {{industry}}

Return a JSON object with this exact structure:
{
  "productName": "string",
  "category": "string",
  "pricePoint": "budget" | "mid-range" | "premium" | "luxury",
  "primaryBenefit": "string (max 150 chars)",
  "secondaryBenefits": ["string", ...] (max 5 items),
  "targetAudience": {
    "demographics": "string",
    "psychographics": "string",
    "painPoints": ["string", ...] (max 5 items)
  },
  "uniqueSellingPoints": ["string", ...] (max 5 items),
  "competitivePosition": "string (max 300 chars)",
  "emotionalTriggers": ["string", ...] (max 5 items),
  "visualStyle": {
    "suggestedTone": "professional" | "playful" | "luxurious" | "energetic" | "calm" | "bold",
    "colorPalette": ["string", ...] (max 5 colors),
    "imageryStyle": "string"
  }
}

Focus on insights that would help create compelling video advertisements.
Return ONLY valid JSON, no markdown or explanation.`;

const CAMPAIGN_GENERATION_PROMPT = `You are a creative director developing campaign concepts for a video advertisement.

Product Analysis:
{{productAnalysis}}

Create exactly 3 distinct campaign concepts. Each should take a different creative approach:
1. One emotionally-driven concept
2. One benefit-focused concept
3. One unique/unexpected angle

Return a JSON array with exactly 3 campaign objects:
[
  {
    "conceptName": "string (max 60 chars)",
    "tagline": "string (max 120 chars)",
    "targetAudience": "string (max 150 chars)",
    "emotionalHook": "string (max 200 chars)",
    "callToAction": "string (max 60 chars)",
    "keyMessage": "string (max 250 chars)",
    "tone": "inspirational" | "humorous" | "urgent" | "educational" | "emotional" | "aspirational",
    "visualDirection": "string (max 250 chars)",
    "differentiator": "string (max 200 chars)"
  },
  ...
]

Each concept should be distinctly different and suitable for short-form video ads.
Return ONLY valid JSON array, no markdown or explanation.`;

const SCRIPT_GENERATION_PROMPT = `You are a video ad scriptwriter creating a {{duration}}-second script for {{platform}}.

Product Analysis:
{{productAnalysis}}

Selected Campaign:
{{campaignConcept}}

Create a script with timed segments. The total duration must be exactly {{duration}} seconds.
The first 3 seconds are critical for the hook - it must grab attention immediately.

Return a JSON object:
{
  "title": "string (max 120 chars)",
  "totalDuration": {{duration}},
  "platform": "{{platform}}",
  "hook": "string - the attention-grabbing opening (max 250 chars)",
  "segments": [
    {
      "segmentNumber": 1,
      "startTime": 0,
      "endTime": 3,
      "voiceOver": "string (max 500 chars)",
      "onScreenText": "string or null (max 120 chars)",
      "visualDescription": "string (max 250 chars)",
      "audioDirection": "string or null (max 150 chars)"
    },
    ...
  ],
  "closingCTA": "string (max 120 chars)"
}

Guidelines for {{platform}}:
{{platformGuidelines}}

Ensure segments are sequential and cover the full {{duration}} seconds.
Return ONLY valid JSON, no markdown or explanation.`;

const PLATFORM_GUIDELINES = {
  tiktok: `- Fast-paced, energetic editing
- Hook in first 1-2 seconds is critical
- Native, authentic feel preferred over polished
- Trending audio/sounds work well
- Vertical 9:16 format
- Keep text minimal and bold`,

  instagram: `- Polished, visually appealing aesthetic
- Strong visual hook in first second
- Can be slightly more refined than TikTok
- Both Reels (9:16) and Feed (1:1, 4:5) formats
- Captions important for sound-off viewing
- Clear branding moments`,

  youtube: `- Can be more detailed/longer form
- Strong hook but can build more slowly
- Higher production value expected
- 16:9 horizontal format common
- Clear subscribe/action CTAs
- Annotations and end screens possible`,

  generic: `- Focus on universal best practices
- Strong hook within 3 seconds
- Clear, concise messaging
- Works across multiple platforms
- Adaptable to different aspect ratios
- Accessible with captions`,
};

const STORYBOARD_GENERATION_PROMPT = `You are a storyboard artist creating a scene-by-scene visual plan for a video ad.

Script:
{{scriptContent}}

Create a detailed storyboard with one scene per script segment.
Aspect ratio: {{aspectRatio}}

Return a JSON object:
{
  "title": "string (max 120 chars)",
  "totalDuration": number,
  "aspectRatio": "{{aspectRatio}}",
  "scenes": [
    {
      "sceneNumber": 1,
      "startTime": 0,
      "endTime": 3,
      "duration": 3,
      "visual": {
        "description": "string - detailed visual description (max 350 chars)",
        "shotType": "wide" | "medium" | "close-up" | "extreme-close-up" | "overhead" | "pov",
        "cameraMovement": "static" | "pan" | "tilt" | "zoom-in" | "zoom-out" | "tracking" | "handheld" | null,
        "transition": "cut" | "fade" | "dissolve" | "wipe" | "none" | null
      },
      "audio": {
        "voiceOver": "string or null",
        "music": "string describing music mood or null",
        "soundEffects": ["string", ...] or null
      },
      "textOverlays": [
        {
          "text": "string",
          "position": "top" | "center" | "bottom",
          "style": "title" | "subtitle" | "caption" | "cta"
        }
      ] or null,
      "assetRequirements": [
        {
          "type": "product-shot" | "lifestyle" | "b-roll" | "logo" | "text-graphic" | "animation",
          "description": "string",
          "required": boolean
        }
      ] or null
    },
    ...
  ],
  "globalAssets": [
    {
      "type": "logo" | "product-image" | "brand-colors" | "font" | "music-track",
      "description": "string",
      "required": boolean
    }
  ] or null
}

Ensure each scene aligns with the corresponding script segment timing.
Return ONLY valid JSON, no markdown or explanation.`;

const EVALUATION_PROMPT = `You are a creative director evaluating a {{artifactType}} for video advertisement.

{{artifactType}} to evaluate:
{{artifactContent}}

Original Brief Context:
{{briefContext}}

Score the {{artifactType}} on these criteria (0-100 scale):
- Overall quality
- Clarity of message
- Engagement potential
- Brand alignment
- Call-to-action strength

Return a JSON object:
{
  "overall": number (0-100),
  "clarity": number (0-100),
  "engagement": number (0-100),
  "brandAlignment": number (0-100),
  "callToActionStrength": number (0-100),
  "feedback": "string - brief constructive feedback (max 500 chars)",
  "suggestions": ["string", ...] - improvement suggestions (max 5 items)
}

Be constructive but honest in your evaluation.
Return ONLY valid JSON, no markdown or explanation.`;

// ─── HELPER FUNCTIONS ─────────────────────────────────────────

function fillTemplate(template, variables) {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    const placeholder = new RegExp(`{{${key}}}`, 'g');
    result = result.replace(placeholder, value || '');
  }
  return result;
}

/**
 * Call LLM with retry logic using provider's configuration
 */
async function callLLM(prompt, schema, options = {}) {
  const provider = getProvider();
  const maxRetries = options.maxRetries ?? provider.maxRetries;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await provider.generateJSON(SYSTEM_PROMPT, prompt, options);

      const content = response.content;
      if (!content) {
        throw new Error('Empty response from LLM');
      }

      // Parse JSON
      let parsed;
      try {
        parsed = JSON.parse(content);
      } catch (parseErr) {
        logStep('JSON parse error', { attempt: attempt + 1, error: parseErr.message });
        if (attempt < maxRetries) continue;
        throw new Error('Failed to parse LLM response as JSON');
      }

      // Validate against schema
      const validation = safeParse(schema, parsed);
      if (!validation.success) {
        logStep('Schema validation failed', { attempt: attempt + 1 });
        if (attempt < maxRetries) continue;
        throw new Error(`Schema validation failed: ${JSON.stringify(validation.error)}`);
      }

      return validation.data;
    } catch (err) {
      logStep('LLM call failed', { attempt: attempt + 1, error: err.message });
      if (attempt >= maxRetries) {
        throw err;
      }
      // Wait before retry with exponential backoff
      await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
    }
  }
}

/**
 * Call LLM for array responses (campaigns) with retry logic
 */
async function callLLMForArray(prompt, schema, options = {}) {
  const provider = getProvider();
  const maxRetries = options.maxRetries ?? provider.maxRetries;
  const arraySystemPrompt = 'You are a creative AI assistant that returns only valid JSON. Return a JSON object with a "campaigns" array containing exactly 3 campaign objects.';

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await provider.generateJSON(
        arraySystemPrompt,
        prompt + '\n\nWrap your response in {"campaigns": [...]}',
        options
      );

      const content = response.content;
      if (!content) {
        throw new Error('Empty response from LLM');
      }

      let parsed;
      try {
        parsed = JSON.parse(content);
      } catch (parseErr) {
        logStep('JSON parse error', { attempt: attempt + 1, error: parseErr.message });
        if (attempt < maxRetries) continue;
        throw new Error('Failed to parse LLM response as JSON');
      }

      // Extract array from wrapper object
      const campaigns = parsed.campaigns || parsed;
      if (!Array.isArray(campaigns)) {
        throw new Error('Expected array of campaigns');
      }

      // Validate against schema
      const validation = safeParse(schema, campaigns);
      if (!validation.success) {
        logStep('Schema validation failed', { attempt: attempt + 1 });
        if (attempt < maxRetries) continue;
        throw new Error(`Schema validation failed: ${JSON.stringify(validation.error)}`);
      }

      return validation.data;
    } catch (err) {
      logStep('LLM array call failed', { attempt: attempt + 1, error: err.message });
      if (attempt >= maxRetries) {
        throw err;
      }
      await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
    }
  }
}

// ─── MAIN SERVICE FUNCTIONS ───────────────────────────────────

/**
 * Analyze a product and generate structured insights
 * @param {Object} product - Product data from database
 * @param {Object} seller - Seller data from database
 * @returns {Object} ProductAnalysis structure
 */
async function analyzeProduct(product, seller) {
  logStep('Analyzing product', { productId: product.id, category: product.category });

  const prompt = fillTemplate(PRODUCT_ANALYSIS_PROMPT, {
    productName: product.title,
    category: product.category || 'General',
    price: product.price || 'N/A',
    currency: product.currency || 'USD',
    description: product.description || '',
    productUrl: product.product_url || '',
    sellerName: seller.name || 'Seller',
    industry: seller.industry || 'General',
  });

  const analysis = await callLLM(prompt, ProductAnalysisSchema);
  logStep('Product analysis complete', { productId: product.id });
  return analysis;
}

/**
 * Generate 3 campaign concepts from product analysis
 * @param {Object} productAnalysis - Output from analyzeProduct
 * @returns {Array} Array of 3 CampaignConcept objects
 */
async function generateCampaigns(productAnalysis) {
  logStep('Generating campaigns', { productName: sanitizeForLog(productAnalysis.productName, 30) });

  const prompt = fillTemplate(CAMPAIGN_GENERATION_PROMPT, {
    productAnalysis: JSON.stringify(productAnalysis, null, 2),
  });

  const campaigns = await callLLMForArray(prompt, CampaignConceptsSchema);
  logStep('Campaigns generated', { count: campaigns.length });
  return campaigns;
}

/**
 * Generate a script from selected campaign
 * @param {Object} productAnalysis - Product analysis
 * @param {Object} campaignConcept - Selected campaign concept
 * @param {string} platform - Target platform
 * @param {number} durationSeconds - Script duration
 * @returns {Object} ScriptContent structure
 */
async function generateScript(productAnalysis, campaignConcept, platform = 'generic', durationSeconds = 15) {
  logStep('Generating script', { platform, duration: durationSeconds });

  const prompt = fillTemplate(SCRIPT_GENERATION_PROMPT, {
    productAnalysis: JSON.stringify(productAnalysis, null, 2),
    campaignConcept: JSON.stringify(campaignConcept, null, 2),
    platform,
    duration: durationSeconds.toString(),
    platformGuidelines: PLATFORM_GUIDELINES[platform] || PLATFORM_GUIDELINES.generic,
  });

  const script = await callLLM(prompt, ScriptContentSchema);
  logStep('Script generated', { platform, segments: script.segments?.length });
  return script;
}

/**
 * Generate a storyboard from script
 * @param {Object} scriptContent - Script content
 * @param {string} aspectRatio - Video aspect ratio
 * @returns {Object} StoryboardContent structure
 */
async function generateStoryboard(scriptContent, aspectRatio = '9:16') {
  logStep('Generating storyboard', { aspectRatio, duration: scriptContent.totalDuration });

  const prompt = fillTemplate(STORYBOARD_GENERATION_PROMPT, {
    scriptContent: JSON.stringify(scriptContent, null, 2),
    aspectRatio,
  });

  const storyboard = await callLLM(prompt, StoryboardContentSchema);
  logStep('Storyboard generated', { scenes: storyboard.scenes?.length });
  return storyboard;
}

/**
 * Evaluate a creative artifact
 * @param {string} artifactType - 'campaign', 'script', or 'storyboard'
 * @param {Object} artifactContent - The artifact to evaluate
 * @param {Object} briefContext - Product analysis for context
 * @returns {Object} EvaluationScores structure
 */
async function evaluateArtifact(artifactType, artifactContent, briefContext) {
  logStep('Evaluating artifact', { type: artifactType });

  const prompt = fillTemplate(EVALUATION_PROMPT, {
    artifactType,
    artifactContent: JSON.stringify(artifactContent, null, 2),
    briefContext: JSON.stringify(briefContext, null, 2),
  });

  const scores = await callLLM(prompt, EvaluationScoresSchema);
  logStep('Evaluation complete', { type: artifactType, overall: scores.overall });
  return scores;
}

/**
 * Generate render-ready specification from approved storyboard
 * @param {Object} storyboard - Approved storyboard
 * @param {Object} options - Render options
 * @returns {Object} RenderSpec structure
 */
function generateRenderSpec(storyboard, options = {}) {
  const {
    format = 'mp4',
    resolution = { width: 1080, height: 1920 },
    frameRate = 30,
  } = options;

  const renderSpec = {
    version: '1.0',
    format,
    resolution,
    frameRate,
    aspectRatio: storyboard.aspectRatio,
    duration: storyboard.totalDuration,
    scenes: storyboard.scenes.map(scene => ({
      sceneNumber: scene.sceneNumber,
      startTime: scene.startTime,
      endTime: scene.endTime,
      visual: {
        type: 'image',
        source: null,
        description: scene.visual.description,
        effects: scene.visual.cameraMovement ? [scene.visual.cameraMovement] : null,
      },
      audio: {
        voiceOver: scene.audio.voiceOver ? {
          text: scene.audio.voiceOver,
          voice: null,
        } : null,
        backgroundMusic: scene.audio.music ? {
          source: null,
          volume: 0.3,
        } : null,
        soundEffects: scene.audio.soundEffects?.map((sf, i) => ({
          name: sf,
          timestamp: scene.startTime + (i * 0.5),
        })) || null,
      },
      textOverlays: scene.textOverlays?.map(overlay => ({
        text: overlay.text,
        position: {
          x: 0.5,
          y: overlay.position === 'top' ? 0.15 : overlay.position === 'bottom' ? 0.85 : 0.5,
        },
        style: {
          fontSize: overlay.style === 'title' ? 48 : overlay.style === 'cta' ? 36 : 24,
          fontFamily: 'Inter',
          color: '#FFFFFF',
          animation: overlay.style === 'cta' ? 'pulse' : 'fade-in',
        },
        startTime: scene.startTime,
        endTime: scene.endTime,
      })) || null,
      transition: scene.visual.transition ? {
        type: scene.visual.transition,
        duration: 0.3,
      } : null,
    })),
  };

  // Validate render spec
  const validation = safeParse(RenderSpecSchema, renderSpec);
  if (!validation.success) {
    logStep('Render spec validation failed');
  }

  return renderSpec;
}

/**
 * Aggregate asset requirements from storyboard
 * @param {Object} storyboard - Storyboard content
 * @returns {Object} Aggregated asset requirements
 */
function aggregateAssetRequirements(storyboard) {
  const requirements = {
    required: [],
    optional: [],
  };

  // Collect global assets
  if (storyboard.globalAssets) {
    for (const asset of storyboard.globalAssets) {
      const target = asset.required ? requirements.required : requirements.optional;
      target.push({
        type: asset.type,
        description: asset.description,
        source: 'global',
      });
    }
  }

  // Collect scene-specific assets
  for (const scene of storyboard.scenes) {
    if (scene.assetRequirements) {
      for (const asset of scene.assetRequirements) {
        const target = asset.required ? requirements.required : requirements.optional;
        target.push({
          type: asset.type,
          description: asset.description,
          source: `scene-${scene.sceneNumber}`,
        });
      }
    }
  }

  // Deduplicate by type + description
  const dedupe = (arr) => {
    const seen = new Set();
    return arr.filter(item => {
      const key = `${item.type}:${item.description}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  return {
    required: dedupe(requirements.required),
    optional: dedupe(requirements.optional),
    totalCount: requirements.required.length + requirements.optional.length,
  };
}

// ─── EXPORTS ──────────────────────────────────────────────────

module.exports = {
  // Provider management (generic interface only)
  configureProvider,
  getProvider,
  validateProviderAtStartup,

  // Main service functions
  analyzeProduct,
  generateCampaigns,
  generateScript,
  generateStoryboard,
  evaluateArtifact,
  generateRenderSpec,
  aggregateAssetRequirements,
};
