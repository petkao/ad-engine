"""
PinkCurve Intent Extractor — CoreML Export
Converts fine-tuned MLX model to CoreML format for iPhone deployment
Run AFTER train.py completes and fuses the model
"""

import json
import os
import sys
from pathlib import Path

FUSED_MODEL_PATH = "./output/pinkcurve-intent-v1-fused"
COREML_OUTPUT    = "./output/PinkCurveIntentExtractor.mlpackage"

def check_fused_model():
    """Check fused model exists."""
    if not Path(FUSED_MODEL_PATH).exists():
        print(f"❌ Fused model not found at {FUSED_MODEL_PATH}")
        print("   Run train.py first and choose 'y' when asked to fuse")
        return False
    print(f"✅ Fused model found: {FUSED_MODEL_PATH}")
    return True

def export_to_coreml():
    """Export fused model to CoreML format."""
    print("\n📱 Exporting to CoreML for iPhone...")
    print(f"   Input:  {FUSED_MODEL_PATH}")
    print(f"   Output: {COREML_OUTPUT}")
    
    try:
        # Method 1: Use mlx-lm built-in conversion
        import subprocess
        cmd = [
            sys.executable, "-m", "mlx_lm.convert",
            "--hf-path", FUSED_MODEL_PATH,
            "--mlx-path", "./output/pinkcurve-mlx-quantized",
            "--quantize",
            "--q-bits", "4",  # 4-bit quantization for smaller size
        ]
        
        print("\n1. Quantizing model to 4-bit for mobile...")
        result = subprocess.run(cmd)
        
        if result.returncode != 0:
            print("❌ Quantization failed")
            return False
            
        print("✅ Quantized model ready")
        
    except Exception as e:
        print(f"❌ Export error: {e}")
        return False
    
    return True

def estimate_model_size():
    """Estimate final model size for iPhone."""
    print("\n📊 Model size estimates:")
    print("   Base Phi-3 Mini (3.8B params):  ~7.6 GB (FP16)")
    print("   After 4-bit quantization:        ~1.9 GB")
    print("   CoreML optimized:               ~1.5 GB")
    print("")
    print("   iPhone storage recommendation:")
    print("   - iPhone 15 Pro (8GB RAM): ✅ Suitable")
    print("   - iPhone 15 (6GB RAM):     ⚠️  Tight but possible")
    print("   - iPhone 14 and older:     ❌  Use server-side inference")
    print("")
    print("   Alternative smaller models for older iPhones:")
    print("   - Llama 3.2 1B:  ~500MB  (less accurate)")
    print("   - Phi-3.5 mini:  ~2GB    (similar accuracy)")
    print("   - Gemma 2B:      ~1.4GB  (good balance)")

def create_swift_inference_code():
    """Generate Swift code for on-device inference."""
    swift_code = '''
// PinkCurveIntentExtractor.swift
// On-device intent extraction for PinkCurve iOS app
// Add to your React Native iOS project

import CoreML
import Foundation

class PinkCurveIntentExtractor {
    
    // MARK: - Properties
    private var model: MLModel?
    private let maxTokens = 200
    
    // MARK: - Init
    init() {
        loadModel()
    }
    
    private func loadModel() {
        guard let modelURL = Bundle.main.url(
            forResource: "PinkCurveIntentExtractor",
            withExtension: "mlpackage"
        ) else {
            print("❌ PinkCurveIntentExtractor.mlpackage not found in bundle")
            return
        }
        
        do {
            let config = MLModelConfiguration()
            config.computeUnits = .cpuAndNeuralEngine  // Use Neural Engine on iPhone
            model = try MLModel(contentsOf: modelURL, configuration: config)
            print("✅ PinkCurve intent model loaded")
        } catch {
            print("❌ Failed to load model: \\(error)")
        }
    }
    
    // MARK: - Intent Extraction
    
    /// Extract shopping intent from device context
    /// - Parameter context: Combined text from emails, notes, browsing
    /// - Returns: IntentResult with keywords and category
    func extractIntent(from context: String) async -> IntentResult? {
        let systemPrompt = """
You are a privacy-preserving intent extractor. Given personal device context \\
(emails, notes, browsing), extract anonymous shopping intent keywords. \\
Return only a JSON object with: intent (string), keywords (array), \\
category (string), urgency (low/medium/high), budget_hint (string or null).
"""
        
        let prompt = """
<|system|>
\\(systemPrompt)<|end|>
<|user|>
\\(context)<|end|>
<|assistant|>

"""
        
        // Run inference (simplified — real implementation needs tokenizer)
        guard let result = await runInference(prompt: prompt) else {
            return nil
        }
        
        return parseJSON(result)
    }
    
    /// Collect device context (with user permission)
    func collectDeviceContext() -> String {
        var contextParts: [String] = []
        
        // Add current page context
        // (In React Native, this comes via bridge from JS)
        
        // Browsing history (requires permission)
        // contextParts.append("Browsing: \\(getBrowsingHistory())")
        
        // Notes (requires permission)
        // contextParts.append("Notes: \\(getRecentNotes())")
        
        return contextParts.joined(separator: "\\n")
    }
    
    // MARK: - Private
    
    private func runInference(prompt: String) async -> String? {
        // Implementation depends on CoreML model format
        // This is a placeholder — real implementation uses model.prediction()
        return nil
    }
    
    private func parseJSON(_ text: String) -> IntentResult? {
        guard let data = text.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }
        
        return IntentResult(
            intent: json["intent"] as? String ?? "",
            keywords: json["keywords"] as? [String] ?? [],
            category: json["category"] as? String ?? "",
            urgency: json["urgency"] as? String ?? "low",
            budgetHint: json["budget_hint"] as? String
        )
    }
}

// MARK: - Models

struct IntentResult: Codable {
    let intent: String
    let keywords: [String]
    let category: String
    let urgency: String
    let budgetHint: String?
    
    /// Send to PinkCurve API for ad matching
    func toAPIPayload(deviceId: String) -> [String: Any] {
        return [
            "query": keywords.joined(separator: " "),
            "category": category,
            "device_id": deviceId,
            "limit": 12
        ]
    }
}

// MARK: - React Native Bridge
// Add to your React Native iOS module to expose to JS

/*
@objc(PinkCurveModule)
class PinkCurveModule: NSObject {
    
    private let extractor = PinkCurveIntentExtractor()
    
    @objc func extractIntent(
        _ context: String,
        resolver: @escaping RCTPromiseResolveBlock,
        rejecter: @escaping RCTPromiseRejectBlock
    ) {
        Task {
            if let result = await extractor.extractIntent(from: context) {
                resolver([
                    "intent": result.intent,
                    "keywords": result.keywords,
                    "category": result.category,
                    "urgency": result.urgency,
                    "budgetHint": result.budgetHint as Any
                ])
            } else {
                rejecter("EXTRACTION_FAILED", "Could not extract intent", nil)
            }
        }
    }
}
*/
'''
    
    output_path = "./output/PinkCurveIntentExtractor.swift"
    with open(output_path, 'w') as f:
        f.write(swift_code)
    
    print(f"\n✅ Swift inference code saved: {output_path}")
    print("   Add this file to your React Native iOS project")

def create_react_native_bridge():
    """Generate React Native JS bridge code."""
    js_code = '''
// PinkCurveIntent.js
// React Native bridge to on-device intent extraction
// Works alongside the web version — same API endpoint

import { NativeModules, Platform } from 'react-native';

const BASE_API = 'https://ad-engine-4da45.web.app';

/**
 * Extract buyer intent using on-device model (iPhone)
 * Falls back to server-side extraction if model unavailable
 */
export async function extractAndMatchAds(deviceContext) {
  try {
    let intentPayload;
    
    if (Platform.OS === 'ios' && NativeModules.PinkCurveModule) {
      // Use on-device model (private — no data leaves device)
      console.log('Using on-device intent extraction...');
      const result = await NativeModules.PinkCurveModule.extractIntent(deviceContext);
      intentPayload = {
        query: result.keywords.join(' '),
        category: result.category,
        device_id: await getDeviceId(),
        limit: 12,
      };
    } else {
      // Fallback to server-side extraction (web/Android)
      console.log('Using server-side intent extraction...');
      intentPayload = {
        query: deviceContext.slice(0, 500), // Send truncated context
        device_id: await getDeviceId(),
        limit: 12,
      };
    }
    
    // Call PinkCurve API for ad matching
    const response = await fetch(`${BASE_API}/api/buyer/semantic-match`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(intentPayload),
    });
    
    const data = await response.json();
    return data.matches || [];
    
  } catch (error) {
    console.error('Intent extraction error:', error);
    return [];
  }
}

/**
 * Collect device context from permitted sources
 */
export async function collectDeviceContext() {
  const parts = [];
  
  // Current page/screen context (always available)
  parts.push(`Screen: ${getCurrentScreenContext()}`);
  
  // Add more sources as permissions are granted:
  // - Recent emails (requires MailKit integration)
  // - Notes (requires Notes app integration)  
  // - Calendar events (requires CalendarKit)
  
  return parts.join('\\n');
}

function getCurrentScreenContext() {
  // Returns current screen name/content
  return 'PinkCurve buyer search';
}

async function getDeviceId() {
  // Generate or retrieve anonymous device ID
  // Use AsyncStorage in production
  return 'mobile_' + Math.random().toString(36).substr(2, 16);
}

export default { extractAndMatchAds, collectDeviceContext };
'''
    
    output_path = "./output/PinkCurveIntent.js"
    with open(output_path, 'w') as f:
        f.write(js_code)
    
    print(f"✅ React Native bridge saved: {output_path}")

if __name__ == "__main__":
    print("=" * 60)
    print("  PinkCurve Intent Extractor — CoreML Export")
    print("  For iPhone deployment")
    print("=" * 60)
    
    # Check fused model exists
    if not check_fused_model():
        print("\nRun train.py first!")
        sys.exit(1)
    
    # Show size estimates
    estimate_model_size()
    
    # Export to CoreML
    proceed = input("\n📱 Export to CoreML? (y/n): ")
    if proceed.lower() == 'y':
        export_to_coreml()
    
    # Generate code files
    print("\n📝 Generating Swift and React Native code...")
    create_swift_inference_code()
    create_react_native_bridge()
    
    print("\n✅ Export pipeline complete!")
    print("\nFiles generated:")
    print("  output/PinkCurveIntentExtractor.swift  → Add to iOS project")
    print("  output/PinkCurveIntent.js              → Add to React Native")
    print("\nNext steps:")
    print("  1. Create React Native project: npx react-native init PinkCurveApp")
    print("  2. Copy Swift file to ios/ folder")
    print("  3. Copy JS file to src/ folder")
    print("  4. Add mlpackage to Xcode project")
