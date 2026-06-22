"""
PinkCurve Intent Extractor — Fine-tuning script
Uses Apple MLX for M2 Mac acceleration (much faster than PyTorch on Apple Silicon)
Base model: microsoft/Phi-3-mini-4k-instruct (3.8B parameters)
Method: LoRA fine-tuning
"""

import json
import os
import subprocess
import sys
from pathlib import Path

# ── Configuration ─────────────────────────────────────────────
BASE_MODEL   = "microsoft/Phi-3-mini-4k-instruct"
DATA_DIR     = "./data"
OUTPUT_DIR   = "./output/pinkcurve-intent-v1"
TRAIN_FILE   = f"{DATA_DIR}/train.jsonl"
EVAL_FILE    = f"{DATA_DIR}/eval.jsonl"

# LoRA hyperparameters
LORA_LAYERS  = 16       # Number of layers to apply LoRA to
LORA_RANK    = 8        # LoRA rank (higher = more params, better quality)
BATCH_SIZE   = 2        # Small batch for M2 memory
LEARNING_RATE = 1e-4    # Learning rate
ITERS        = 200      # Training iterations (increase for better quality)
STEPS_PER_EVAL = 50     # Evaluate every N steps
SAVE_EVERY   = 100      # Save adapter every N steps
MAX_SEQ_LEN  = 512      # Max sequence length

def check_mlx():
    """Verify MLX is installed and M2 is available."""
    try:
        import mlx.core as mx
        print(f"✅ MLX {mx.__version__} ready")
        print(f"✅ Device: {mx.default_device()}")
        return True
    except ImportError:
        print("❌ MLX not found. Install: pip install mlx mlx-lm")
        return False

def check_data():
    """Verify training data exists and is valid."""
    for filepath in [TRAIN_FILE, EVAL_FILE]:
        if not Path(filepath).exists():
            print(f"❌ Missing: {filepath}")
            return False
        with open(filepath) as f:
            lines = f.readlines()
        print(f"✅ {filepath}: {len(lines)} examples")
    return True

def convert_to_mlx_format():
    """Convert chat format JSONL to MLX train format."""
    print("\n📝 Converting data to MLX format...")
    
    for split in ['train', 'eval']:
        input_file = f"{DATA_DIR}/{split}.jsonl"
        mlx_name = 'valid' if split == 'eval' else split
        output_file = f"{DATA_DIR}/{mlx_name}.jsonl"
        
        with open(input_file) as fin, open(output_file, 'w') as fout:
            for line in fin:
                line = line.strip()
                if not line:
                    continue
                example = json.loads(line)
                messages = example['messages']
                
                # Format as conversation text for Phi-3
                text = ""
                for msg in messages:
                    role = msg['role']
                    content = msg['content']
                    if role == 'system':
                        text += f"<|system|>\n{content}<|end|>\n"
                    elif role == 'user':
                        text += f"<|user|>\n{content}<|end|>\n"
                    elif role == 'assistant':
                        text += f"<|assistant|>\n{content}<|end|>\n"
                
                fout.write(json.dumps({"text": text}) + "\n")
        
        print(f"✅ Converted {split} → {output_file}")

def run_fine_tuning():
    """Run MLX LoRA fine-tuning."""
    print(f"\n🚀 Starting fine-tuning with MLX LoRA")
    print(f"   Base model: {BASE_MODEL}")
    print(f"   Training examples: 25")
    print(f"   Iterations: {ITERS}")
    print(f"   LoRA rank: {LORA_RANK}")
    print(f"   Output: {OUTPUT_DIR}")
    print()

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    cmd = [
        sys.executable, "-m", "mlx_lm", "lora",
        "--model", BASE_MODEL,
        "--train",
        "--data", DATA_DIR,
        "--adapter-path", OUTPUT_DIR,
        "--num-layers", str(LORA_LAYERS),
        "--batch-size", str(BATCH_SIZE),
        "--iters", str(ITERS),
        "--learning-rate", str(LEARNING_RATE),
        "--steps-per-eval", str(STEPS_PER_EVAL),
        "--save-every", str(SAVE_EVERY),
        "--max-seq-length", str(MAX_SEQ_LEN),
    ]

    print("Running:", " ".join(cmd))
    print("-" * 60)
    
    result = subprocess.run(cmd, capture_output=False)
    
    if result.returncode == 0:
        print("\n✅ Fine-tuning complete!")
        print(f"   Adapter saved to: {OUTPUT_DIR}")
    else:
        print(f"\n❌ Fine-tuning failed with code {result.returncode}")
        return False
    
    return True

def test_model():
    """Test the fine-tuned model with a sample prompt."""
    print("\n🧪 Testing fine-tuned model...")
    
    test_prompt = """<|system|>
You are a privacy-preserving intent extractor. Given personal device context (emails, notes, browsing), extract anonymous shopping intent keywords. Return only a JSON object with: intent (string), keywords (array), category (string), urgency (low/medium/high), budget_hint (string or null).<|end|>
<|user|>
Email: 'Hey can we get a new couch? The old one is falling apart'. Browsing: best sectional sofa under 1000, IKEA vs Wayfair sofa, pet-friendly couch material<|end|>
<|assistant|>
"""
    
    cmd = [
        sys.executable, "-m", "mlx_lm.generate",
        "--model", BASE_MODEL,
        "--adapter-path", OUTPUT_DIR,
        "--max-tokens", "200",
        "--prompt", test_prompt,
    ]
    
    print("Test prompt: 'Email about getting new couch + browsing sofas'")
    print("Expected: JSON with intent, keywords, category=Home & Garden")
    print("\nModel output:")
    print("-" * 40)
    subprocess.run(cmd)

def fuse_model():
    """Fuse LoRA adapter with base model for deployment."""
    fused_path = "./output/pinkcurve-intent-v1-fused"
    print(f"\n🔗 Fusing adapter with base model...")
    print(f"   Output: {fused_path}")
    
    cmd = [
        sys.executable, "-m", "mlx_lm.fuse",
        "--model", BASE_MODEL,
        "--adapter-path", OUTPUT_DIR,
        "--save-path", fused_path,
    ]
    
    result = subprocess.run(cmd)
    
    if result.returncode == 0:
        print(f"✅ Fused model saved to: {fused_path}")
        print(f"   Ready for CoreML export!")
    else:
        print(f"❌ Fusion failed")

if __name__ == "__main__":
    print("=" * 60)
    print("  PinkCurve Intent Extractor — Fine-tuning Pipeline")
    print("  Apple MLX + M2 Mac")
    print("=" * 60)
    
    # Step 1: Check environment
    if not check_mlx():
        sys.exit(1)
    
    # Step 2: Check data
    if not check_data():
        sys.exit(1)
    
    # Step 3: Convert data format
    convert_to_mlx_format()
    
    # Step 4: Fine-tune
    if not run_fine_tuning():
        sys.exit(1)
    
    # Step 5: Test
    test_model()
    
    # Step 6: Fuse (optional — needed for CoreML export)
    fuse_input = input("\n🔗 Fuse adapter with base model for deployment? (y/n): ")
    if fuse_input.lower() == 'y':
        fuse_model()
    
    print("\n✅ Pipeline complete!")
    print("\nNext steps:")
    print("  1. Run: python export_coreml.py  (convert to iPhone format)")
    print("  2. Add to React Native app")
    print("  3. Run inference on-device")
