import argparse
import contextlib
import json
import sys
from pathlib import Path


SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".pdf"}


def write_json(payload, status_code=0):
    sys.__stdout__.write(json.dumps(payload, ensure_ascii=False))
    sys.__stdout__.write("\n")
    raise SystemExit(status_code)


def fail(message, code="OCR_ERROR", status_code=1, details=None):
    write_json(
        {
            "success": False,
            "error": {
                "code": code,
                "message": message,
                "details": details or {},
            },
        },
        status_code,
    )


def parse_args():
    parser = argparse.ArgumentParser(description="Run PaddleOCR for an invoice file.")
    parser.add_argument("--file", required=True, help="Path to JPG, PNG, or PDF file.")
    parser.add_argument("--lang", default="en", help="PaddleOCR language code.")
    parser.add_argument("--use-gpu", action="store_true", help="Enable GPU inference.")
    parser.add_argument("--page-limit", type=int, default=5, help="Maximum PDF pages to process. Use 0 for all pages.")
    return parser.parse_args()


def is_ocr_line(value):
    return (
        isinstance(value, (list, tuple))
        and len(value) >= 2
        and isinstance(value[1], (list, tuple))
        and len(value[1]) >= 2
        and isinstance(value[1][0], str)
    )


def coerce_box(box):
    if box is None:
        return None

    try:
        return [
            {"x": float(point[0]), "y": float(point[1])}
            for point in box
            if isinstance(point, (list, tuple)) and len(point) >= 2
        ]
    except (TypeError, ValueError):
        return None


def normalize_classic_result(result):
    blocks = []

    if result is None:
        return blocks

    pages = [result] if result and is_ocr_line(result[0]) else result

    for page_index, page in enumerate(pages, start=1):
        if not page:
            continue

        lines = page if not is_ocr_line(page) else [page]

        for block_index, line in enumerate(lines):
            if not is_ocr_line(line):
                continue

            text = line[1][0]
            confidence = line[1][1]
            blocks.append(
                {
                    "page": page_index,
                    "blockIndex": block_index,
                    "text": text,
                    "confidence": float(confidence) if confidence is not None else None,
                    "boundingBox": coerce_box(line[0]),
                }
            )

    return blocks


def normalize_dict_result(result):
    if hasattr(result, "json"):
        result = result.json

    if callable(result):
        result = result()

    if not isinstance(result, dict):
        return []

    texts = result.get("rec_texts") or result.get("texts") or []
    scores = result.get("rec_scores") or result.get("scores") or []
    boxes = result.get("dt_polys") or result.get("rec_polys") or result.get("boxes") or []

    blocks = []
    for index, text in enumerate(texts):
        blocks.append(
            {
                "page": int(result.get("page_index", 0)) + 1,
                "blockIndex": index,
                "text": text,
                "confidence": float(scores[index]) if index < len(scores) and scores[index] is not None else None,
                "boundingBox": coerce_box(boxes[index]) if index < len(boxes) else None,
            }
        )

    return blocks


def normalize_result(result):
    if isinstance(result, dict) or hasattr(result, "json"):
        return normalize_dict_result(result)

    if isinstance(result, list) and result and (isinstance(result[0], dict) or hasattr(result[0], "json")):
        blocks = []
        for page in result:
            blocks.extend(normalize_dict_result(page))
        return blocks

    return normalize_classic_result(result)


def main():
    args = parse_args()
    input_path = Path(args.file).resolve()
    extension = input_path.suffix.lower()

    if not input_path.exists():
        fail("OCR input file does not exist", "OCR_FILE_NOT_FOUND", details={"file": str(input_path)})

    if extension not in SUPPORTED_EXTENSIONS:
        fail(
            "Unsupported OCR file type",
            "OCR_UNSUPPORTED_FILE_TYPE",
            details={"extension": extension, "supportedExtensions": sorted(SUPPORTED_EXTENSIONS)},
        )

    try:
        from paddleocr import PaddleOCR
    except ImportError as error:
        fail(
            "PaddleOCR is not installed in the configured Python environment",
            "PADDLEOCR_NOT_INSTALLED",
            details={"install": "pip install -r requirements-ocr.txt", "importError": str(error)},
        )

    try:
        ocr_kwargs = {
            "use_angle_cls": True,
            "lang": args.lang,
            "use_gpu": args.use_gpu,
            "show_log": False,
        }

        if extension == ".pdf" and args.page_limit >= 0:
            ocr_kwargs["page_num"] = args.page_limit

        with contextlib.redirect_stdout(sys.stderr):
            ocr = PaddleOCR(**ocr_kwargs)
            result = ocr.ocr(str(input_path), cls=True)

        text_blocks = normalize_result(result)
        confidence_scores = [
            block["confidence"]
            for block in text_blocks
            if isinstance(block.get("confidence"), (int, float))
        ]
        average_confidence = (
            sum(confidence_scores) / len(confidence_scores)
            if confidence_scores
            else None
        )
        raw_text = "\n".join(block["text"] for block in text_blocks if block.get("text"))

        write_json(
            {
                "success": True,
                "data": {
                    "provider": "paddleocr",
                    "rawText": raw_text,
                    "textBlocks": text_blocks,
                    "confidenceScores": confidence_scores,
                    "confidence": average_confidence,
                    "pages": sorted({block["page"] for block in text_blocks}),
                    "metadata": {
                        "file": str(input_path),
                        "extension": extension,
                        "lang": args.lang,
                        "useGpu": args.use_gpu,
                        "pageLimit": args.page_limit,
                    },
                },
            }
        )
    except Exception as error:
        fail(
            "PaddleOCR failed to process the invoice",
            "PADDLEOCR_PROCESSING_FAILED",
            details={"reason": str(error), "file": str(input_path)},
        )


if __name__ == "__main__":
    main()
