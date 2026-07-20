// Creative Studio Schemas
// Zod schemas for validating structured LLM outputs and API inputs

const { z } = require('zod');

// ─── PRODUCT ANALYSIS ─────────────────────────────────────────
// Structured analysis of a seller's product for creative development

const ProductAnalysisSchema = z.object({
  productName: z.string().min(1).max(200),
  category: z.string().min(1).max(100),
  pricePoint: z.enum(['budget', 'mid-range', 'premium', 'luxury']),
  primaryBenefit: z.string().min(1).max(150),
  secondaryBenefits: z.array(z.string().max(150)).max(5),
  targetAudience: z.object({
    demographics: z.string().min(1).max(200),
    psychographics: z.string().min(1).max(200),
    painPoints: z.array(z.string().max(150)).max(5),
  }),
  uniqueSellingPoints: z.array(z.string().max(150)).max(5),
  competitivePosition: z.string().max(300),
  emotionalTriggers: z.array(z.string().max(100)).max(5),
  visualStyle: z.object({
    suggestedTone: z.enum(['professional', 'playful', 'luxurious', 'energetic', 'calm', 'bold']),
    colorPalette: z.array(z.string().max(50)).max(5),
    imageryStyle: z.string().max(200),
  }),
});

// ─── CAMPAIGN CONCEPT ─────────────────────────────────────────
// A single campaign concept (3 are generated per brief)

const CampaignConceptSchema = z.object({
  conceptName: z.string().min(1).max(60),
  tagline: z.string().min(1).max(120),
  targetAudience: z.string().min(1).max(150),
  emotionalHook: z.string().min(1).max(200),
  callToAction: z.string().min(1).max(60),
  keyMessage: z.string().min(1).max(250),
  tone: z.enum(['inspirational', 'humorous', 'urgent', 'educational', 'emotional', 'aspirational']),
  visualDirection: z.string().min(1).max(250),
  differentiator: z.string().min(1).max(200),
});

// Array of exactly 3 campaign concepts
const CampaignConceptsSchema = z.array(CampaignConceptSchema).length(3);

// ─── SCRIPT ───────────────────────────────────────────────────
// Time-segmented script for video ad

const ScriptSegmentSchema = z.object({
  segmentNumber: z.number().int().positive(),
  startTime: z.number().nonnegative(),       // seconds
  endTime: z.number().positive(),             // seconds
  voiceOver: z.string().max(500),
  onScreenText: z.string().max(120).optional().nullable(),
  visualDescription: z.string().min(1).max(250),
  audioDirection: z.string().max(150).optional().nullable(),
});

const ScriptContentSchema = z.object({
  title: z.string().min(1).max(120),
  totalDuration: z.number().positive(),
  platform: z.enum(['tiktok', 'instagram', 'youtube', 'generic']),
  hook: z.string().min(1).max(250),
  segments: z.array(ScriptSegmentSchema).min(1).max(12),
  closingCTA: z.string().min(1).max(120),
});

// ─── STORYBOARD ───────────────────────────────────────────────
// Scene-by-scene visual breakdown

const StoryboardSceneSchema = z.object({
  sceneNumber: z.number().int().positive(),
  startTime: z.number().nonnegative(),
  endTime: z.number().positive(),
  duration: z.number().positive(),

  // Visual specification
  visual: z.object({
    description: z.string().min(1).max(350),
    shotType: z.enum(['wide', 'medium', 'close-up', 'extreme-close-up', 'overhead', 'pov']),
    cameraMovement: z.enum(['static', 'pan', 'tilt', 'zoom-in', 'zoom-out', 'tracking', 'handheld']).optional().nullable(),
    transition: z.enum(['cut', 'fade', 'dissolve', 'wipe', 'none']).optional().nullable(),
  }),

  // Audio specification
  audio: z.object({
    voiceOver: z.string().max(500).optional().nullable(),
    music: z.string().max(120).optional().nullable(),
    soundEffects: z.array(z.string().max(60)).max(3).optional().nullable(),
  }),

  // Text overlays
  textOverlays: z.array(z.object({
    text: z.string().min(1).max(120),
    position: z.enum(['top', 'center', 'bottom']),
    style: z.enum(['title', 'subtitle', 'caption', 'cta']),
  })).max(3).optional().nullable(),

  // Asset requirements for this scene
  assetRequirements: z.array(z.object({
    type: z.enum(['product-shot', 'lifestyle', 'b-roll', 'logo', 'text-graphic', 'animation']),
    description: z.string().min(1).max(250),
    required: z.boolean(),
  })).max(5).optional().nullable(),
});

const StoryboardContentSchema = z.object({
  title: z.string().min(1).max(120),
  totalDuration: z.number().positive(),
  aspectRatio: z.enum(['9:16', '16:9', '1:1', '4:5']),
  scenes: z.array(StoryboardSceneSchema).min(1).max(20),

  // Global asset requirements
  globalAssets: z.array(z.object({
    type: z.enum(['logo', 'product-image', 'brand-colors', 'font', 'music-track']),
    description: z.string().min(1).max(250),
    required: z.boolean(),
  })).max(10).optional().nullable(),
});

// ─── RENDER SPECIFICATION ─────────────────────────────────────
// Provider-agnostic render specification for future video generation

const RenderSpecSchema = z.object({
  version: z.literal('1.0'),
  format: z.enum(['mp4', 'mov', 'webm']),
  resolution: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  frameRate: z.number().int().positive(),
  aspectRatio: z.enum(['9:16', '16:9', '1:1', '4:5']),
  duration: z.number().positive(),

  // Scene-level render instructions
  scenes: z.array(z.object({
    sceneNumber: z.number().int().positive(),
    startTime: z.number().nonnegative(),
    endTime: z.number().positive(),

    // Visual layer
    visual: z.object({
      type: z.enum(['image', 'video', 'animation', 'solid-color']),
      source: z.string().optional().nullable(),  // URL or asset ID
      description: z.string(),                    // For AI generation
      effects: z.array(z.string()).optional().nullable(),
    }),

    // Audio layer
    audio: z.object({
      voiceOver: z.object({
        text: z.string(),
        voice: z.string().optional().nullable(),  // Voice ID or description
      }).optional().nullable(),
      backgroundMusic: z.object({
        source: z.string().optional().nullable(),
        volume: z.number().min(0).max(1).optional(),
      }).optional().nullable(),
      soundEffects: z.array(z.object({
        name: z.string(),
        timestamp: z.number(),
      })).optional().nullable(),
    }).optional().nullable(),

    // Text overlay layer
    textOverlays: z.array(z.object({
      text: z.string(),
      position: z.object({
        x: z.number(),  // 0-1 normalized
        y: z.number(),  // 0-1 normalized
      }),
      style: z.object({
        fontSize: z.number().optional(),
        fontFamily: z.string().optional(),
        color: z.string().optional(),
        animation: z.string().optional(),
      }).optional().nullable(),
      startTime: z.number(),
      endTime: z.number(),
    })).optional().nullable(),

    // Transition to next scene
    transition: z.object({
      type: z.enum(['cut', 'fade', 'dissolve', 'wipe', 'none']),
      duration: z.number().optional(),
    }).optional().nullable(),
  })),
});

// ─── EVALUATION SCORES ────────────────────────────────────────
// Quality evaluation for generated artifacts

const EvaluationScoresSchema = z.object({
  overall: z.number().min(0).max(100),
  clarity: z.number().min(0).max(100),
  engagement: z.number().min(0).max(100),
  brandAlignment: z.number().min(0).max(100),
  callToActionStrength: z.number().min(0).max(100),
  feedback: z.string().max(500).optional().nullable(),
  suggestions: z.array(z.string().max(200)).max(5).optional().nullable(),
});

// ─── API INPUT SCHEMAS ────────────────────────────────────────
// Validation for API request bodies

const CreateBriefInputSchema = z.object({
  product_id: z.string().uuid(),
});

const SelectCampaignInputSchema = z.object({
  campaign_index: z.number().int().min(0).max(2),
});

const GenerateScriptInputSchema = z.object({
  platform: z.enum(['tiktok', 'instagram', 'youtube', 'generic']).default('generic'),
  duration_seconds: z.number().int().positive().default(15),
});

const GenerateStoryboardInputSchema = z.object({
  aspect_ratio: z.enum(['9:16', '16:9', '1:1', '4:5']).default('9:16'),
});

// ─── EXPORTS ──────────────────────────────────────────────────

module.exports = {
  // Core artifact schemas
  ProductAnalysisSchema,
  CampaignConceptSchema,
  CampaignConceptsSchema,
  ScriptSegmentSchema,
  ScriptContentSchema,
  StoryboardSceneSchema,
  StoryboardContentSchema,
  RenderSpecSchema,
  EvaluationScoresSchema,

  // API input schemas
  CreateBriefInputSchema,
  SelectCampaignInputSchema,
  GenerateScriptInputSchema,
  GenerateStoryboardInputSchema,

  // Helper for safe parsing with error details
  safeParse: (schema, data) => {
    const result = schema.safeParse(data);
    if (!result.success) {
      return {
        success: false,
        error: result.error.errors.map(e => ({
          path: e.path.join('.'),
          message: e.message,
        })),
      };
    }
    return { success: true, data: result.data };
  },
};
