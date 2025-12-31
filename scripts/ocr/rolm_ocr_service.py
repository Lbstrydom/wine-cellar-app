#!/usr/bin/env python3
"""
OCR Service for PDF text extraction.

This script extracts text from PDF files using:
1. PyMuPDF (fitz) for text-based PDFs (fast, no OCR needed)
2. EasyOCR for image-based PDFs (good quality, reasonable memory)

Usage:
    python rolm_ocr_service.py <pdf_path> [--output json|text]
    python rolm_ocr_service.py --check

Output:
    JSON with extracted text and metadata, or plain text.
"""

import argparse
import json
import os
import sys
from pathlib import Path

# Check if required packages are available
HAS_PYMUPDF = False
HAS_EASYOCR = False
HAS_PDF2IMAGE = False

try:
    import fitz  # PyMuPDF
    HAS_PYMUPDF = True
except ImportError:
    pass

try:
    import easyocr
    HAS_EASYOCR = True
except ImportError:
    pass

try:
    import pdf2image
    from PIL import Image
    HAS_PDF2IMAGE = True
except ImportError:
    pass


def check_dependencies():
    """Check if dependencies are installed."""
    if HAS_PYMUPDF:
        return True, None
    if HAS_EASYOCR and HAS_PDF2IMAGE:
        return True, None
    return False, "Neither PyMuPDF nor EasyOCR+pdf2image installed"


def extract_text_with_pymupdf(pdf_path: str) -> dict:
    """Extract text from PDF using PyMuPDF (fast, for text-based PDFs)."""
    print(f"[OCR] Using PyMuPDF for text extraction", file=sys.stderr)

    doc = fitz.open(pdf_path)
    pages = []
    full_text = []

    for i, page in enumerate(doc):
        text = page.get_text()
        pages.append({
            "page_number": i + 1,
            "text": text
        })
        full_text.append(text)
        print(f"[OCR] Page {i + 1}/{len(doc)}: {len(text)} chars", file=sys.stderr)

    doc.close()

    combined_text = "\n\n--- Page Break ---\n\n".join(full_text)

    return {
        "success": True,
        "method": "pymupdf",
        "total_pages": len(pages),
        "pages": pages,
        "full_text": combined_text
    }


def find_poppler_path():
    """Find the poppler binaries path."""
    possible_paths = [
        # Scoop installation
        os.path.expanduser("~/scoop/apps/poppler/current/Library/bin"),
        os.path.expanduser("~/scoop/shims"),
        # Chocolatey installation
        r"C:\ProgramData\chocolatey\bin",
        r"C:\ProgramData\chocolatey\lib\poppler\tools\poppler-25.12.0\Library\bin",
        # Manual installation common paths
        r"C:\Program Files\poppler\bin",
        r"C:\Program Files\poppler-24.07.0\Library\bin",
    ]

    for path in possible_paths:
        pdftoppm = os.path.join(path, "pdftoppm.exe")
        if os.path.exists(pdftoppm):
            print(f"[OCR] Found poppler at: {path}", file=sys.stderr)
            return path

    return None


def pdf_to_images(pdf_path: str, dpi: int = 200) -> list:
    """Convert PDF pages to images."""
    print(f"[OCR] Converting PDF to images (DPI: {dpi})...", file=sys.stderr)

    poppler_path = find_poppler_path()
    if poppler_path:
        images = pdf2image.convert_from_path(pdf_path, dpi=dpi, poppler_path=poppler_path)
    else:
        images = pdf2image.convert_from_path(pdf_path, dpi=dpi)
    print(f"[OCR] Converted {len(images)} pages", file=sys.stderr)
    return images


def extract_text_with_easyocr(pdf_path: str) -> dict:
    """Extract text from PDF using EasyOCR (for image-based PDFs)."""
    import numpy as np

    print(f"[OCR] Using EasyOCR for image-based PDF", file=sys.stderr)

    # Initialize EasyOCR reader (supports multiple languages)
    # Using GPU if available, otherwise CPU
    print(f"[OCR] Initializing EasyOCR reader...", file=sys.stderr)
    reader = easyocr.Reader(['en'], gpu=False)  # Start with CPU for reliability

    images = pdf_to_images(pdf_path)

    pages = []
    full_text = []

    for i, pil_image in enumerate(images):
        print(f"[OCR] Processing page {i + 1}/{len(images)}...", file=sys.stderr)

        # Convert PIL image to numpy array for EasyOCR
        img_array = np.array(pil_image)

        # Run OCR
        results = reader.readtext(img_array, paragraph=True)

        # Extract text from results
        page_text_parts = []
        for (bbox, text, confidence) in results:
            page_text_parts.append(text)

        page_text = "\n".join(page_text_parts)

        pages.append({
            "page_number": i + 1,
            "text": page_text
        })
        full_text.append(page_text)
        print(f"[OCR] Page {i + 1}: {len(page_text)} chars extracted", file=sys.stderr)

    return {
        "success": True,
        "method": "easyocr",
        "total_pages": len(images),
        "pages": pages,
        "full_text": "\n\n--- Page Break ---\n\n".join(full_text)
    }


def extract_text_from_pdf(pdf_path: str, force_ocr: bool = False) -> dict:
    """Extract text from PDF, trying PyMuPDF first."""

    # Try PyMuPDF first (fast, works for text-based PDFs)
    if HAS_PYMUPDF and not force_ocr:
        result = extract_text_with_pymupdf(pdf_path)

        # Check if we got meaningful text
        text_length = len(result.get("full_text", "").strip())
        if text_length > 100:  # Arbitrary threshold for "has text"
            print(f"[OCR] PyMuPDF extracted {text_length} chars successfully", file=sys.stderr)
            return result
        else:
            print(f"[OCR] PyMuPDF found little/no text ({text_length} chars), trying OCR...", file=sys.stderr)

    # Fall back to EasyOCR for image-based PDFs
    if HAS_EASYOCR and HAS_PDF2IMAGE:
        return extract_text_with_easyocr(pdf_path)

    # If we got here with PyMuPDF result, return it even if minimal
    if HAS_PYMUPDF:
        return result

    return {
        "success": False,
        "error": "No PDF text extraction method available"
    }


def main():
    parser = argparse.ArgumentParser(description="PDF text extraction service")
    parser.add_argument("pdf_path", nargs="?", help="Path to PDF file")
    parser.add_argument("--output", choices=["json", "text"], default="json", help="Output format")
    parser.add_argument("--check", action="store_true", help="Check if dependencies are installed")
    parser.add_argument("--force-ocr", action="store_true", help="Force OCR even for text-based PDFs")

    args = parser.parse_args()

    # Check dependencies mode
    if args.check:
        ok, error = check_dependencies()
        result = {"available": ok, "has_pymupdf": HAS_PYMUPDF, "has_easyocr": HAS_EASYOCR, "has_pdf2image": HAS_PDF2IMAGE}
        if error:
            result["error"] = error
        print(json.dumps(result))
        sys.exit(0 if ok else 1)

    # Validate input
    if not args.pdf_path:
        parser.error("pdf_path is required")

    if not os.path.exists(args.pdf_path):
        print(json.dumps({"success": False, "error": f"File not found: {args.pdf_path}"}))
        sys.exit(1)

    # Check dependencies
    ok, error = check_dependencies()
    if not ok:
        print(json.dumps({"success": False, "error": error}))
        sys.exit(1)

    try:
        result = extract_text_from_pdf(args.pdf_path, force_ocr=args.force_ocr)

        if args.output == "json":
            print(json.dumps(result, indent=2))
        else:
            if result.get("success"):
                print(result["full_text"])
            else:
                print(f"Error: {result.get('error', 'Unknown error')}")
                sys.exit(1)

    except Exception as e:
        import traceback
        traceback.print_exc(file=sys.stderr)
        print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
