#!/usr/bin/env python3
"""
RolmOCR Service for PDF text extraction.

This script extracts text from PDF files using RolmOCR (based on Qwen2.5-VL-7B).
It can be called from Node.js via subprocess.

Usage:
    python rolm_ocr_service.py <pdf_path> [--output json|text]
    python rolm_ocr_service.py --base64 <base64_string> [--output json|text]

Output:
    JSON with extracted text and metadata, or plain text.
"""

import argparse
import base64
import json
import os
import sys
import tempfile
from pathlib import Path

# Check if required packages are available
try:
    import torch
    from PIL import Image
    import pdf2image
    HAS_DEPS = True
except ImportError as e:
    HAS_DEPS = False
    MISSING_DEP = str(e)


def check_dependencies():
    """Check if all required dependencies are installed."""
    if not HAS_DEPS:
        return False, f"Missing dependency: {MISSING_DEP}"

    try:
        from transformers import Qwen2VLForConditionalGeneration, AutoProcessor
        return True, None
    except ImportError as e:
        return False, f"Missing transformers or model support: {e}"


def load_model():
    """Load the RolmOCR model (Qwen2.5-VL based)."""
    from transformers import Qwen2VLForConditionalGeneration, AutoProcessor

    model_name = "reducto/RolmOCR"

    # Check for GPU availability
    device = "cuda" if torch.cuda.is_available() else "cpu"

    print(f"[OCR] Loading RolmOCR model on {device}...", file=sys.stderr)

    # Load with appropriate precision
    if device == "cuda":
        model = Qwen2VLForConditionalGeneration.from_pretrained(
            model_name,
            torch_dtype=torch.float16,
            device_map="auto"
        )
    else:
        model = Qwen2VLForConditionalGeneration.from_pretrained(
            model_name,
            torch_dtype=torch.float32
        )
        model = model.to(device)

    processor = AutoProcessor.from_pretrained(model_name)

    return model, processor, device


def pdf_to_images(pdf_path: str, dpi: int = 200) -> list:
    """Convert PDF pages to images."""
    print(f"[OCR] Converting PDF to images (DPI: {dpi})...", file=sys.stderr)
    images = pdf2image.convert_from_path(pdf_path, dpi=dpi)
    print(f"[OCR] Converted {len(images)} pages", file=sys.stderr)
    return images


def extract_text_from_image(model, processor, device, image: Image.Image) -> str:
    """Extract text from a single image using RolmOCR."""
    # Prepare the prompt for OCR
    messages = [
        {
            "role": "user",
            "content": [
                {"type": "image", "image": image},
                {"type": "text", "text": "Extract all text from this image. Preserve the layout and structure. Return only the extracted text, no commentary."}
            ]
        }
    ]

    # Process the input
    text_prompt = processor.apply_chat_template(messages, add_generation_prompt=True)
    inputs = processor(
        text=[text_prompt],
        images=[image],
        padding=True,
        return_tensors="pt"
    )
    inputs = inputs.to(device)

    # Generate
    with torch.no_grad():
        output_ids = model.generate(
            **inputs,
            max_new_tokens=4096,
            do_sample=False
        )

    # Decode
    generated_ids = output_ids[:, inputs.input_ids.shape[1]:]
    output_text = processor.batch_decode(
        generated_ids,
        skip_special_tokens=True,
        clean_up_tokenization_spaces=True
    )[0]

    return output_text


def extract_text_from_pdf(pdf_path: str) -> dict:
    """Extract text from all pages of a PDF."""
    # Load model
    model, processor, device = load_model()

    # Convert PDF to images
    images = pdf_to_images(pdf_path)

    # Extract text from each page
    pages = []
    full_text = []

    for i, image in enumerate(images):
        print(f"[OCR] Processing page {i + 1}/{len(images)}...", file=sys.stderr)
        text = extract_text_from_image(model, processor, device, image)
        pages.append({
            "page_number": i + 1,
            "text": text
        })
        full_text.append(text)

    return {
        "success": True,
        "total_pages": len(images),
        "pages": pages,
        "full_text": "\n\n--- Page Break ---\n\n".join(full_text)
    }


def main():
    parser = argparse.ArgumentParser(description="RolmOCR PDF text extraction service")
    parser.add_argument("pdf_path", nargs="?", help="Path to PDF file")
    parser.add_argument("--base64", dest="base64_input", help="Base64 encoded PDF content")
    parser.add_argument("--output", choices=["json", "text"], default="json", help="Output format")
    parser.add_argument("--check", action="store_true", help="Check if dependencies are installed")

    args = parser.parse_args()

    # Check dependencies mode
    if args.check:
        ok, error = check_dependencies()
        result = {"available": ok}
        if error:
            result["error"] = error
        print(json.dumps(result))
        sys.exit(0 if ok else 1)

    # Validate input
    if not args.pdf_path and not args.base64_input:
        parser.error("Either pdf_path or --base64 is required")

    # Check dependencies
    ok, error = check_dependencies()
    if not ok:
        print(json.dumps({"success": False, "error": error}))
        sys.exit(1)

    try:
        # Handle base64 input
        if args.base64_input:
            pdf_data = base64.b64decode(args.base64_input)
            with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
                f.write(pdf_data)
                pdf_path = f.name
            cleanup_temp = True
        else:
            pdf_path = args.pdf_path
            cleanup_temp = False

            if not os.path.exists(pdf_path):
                print(json.dumps({"success": False, "error": f"File not found: {pdf_path}"}))
                sys.exit(1)

        # Extract text
        result = extract_text_from_pdf(pdf_path)

        # Cleanup temp file if needed
        if cleanup_temp:
            os.unlink(pdf_path)

        # Output
        if args.output == "json":
            print(json.dumps(result, indent=2))
        else:
            print(result["full_text"])

    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
