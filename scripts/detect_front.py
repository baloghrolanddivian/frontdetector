import argparse
import json


def parse_known_size(value):
    if not value:
        return None
    parts = value.lower().split("x")
    if len(parts) != 2:
        return None
    try:
        return float(parts[0]), float(parts[1])
    except ValueError:
        return None


def choose_orientation(rect_w, rect_h, known_w, known_h):
    rect_ratio = rect_w / rect_h if rect_h else 0
    option_a = known_w / known_h if known_h else 0
    option_b = known_h / known_w if known_w else 0
    if abs(rect_ratio - option_a) <= abs(rect_ratio - option_b):
        return known_w, known_h
    return known_h, known_w


def detect_with_opencv(image_path, output_path, known_size):
    try:
        import cv2
        import numpy as np
    except ImportError:
        return {"found": False, "error": "opencv_not_available", "boxes": []}

    image = cv2.imread(image_path)
    if image is None:
        return {"found": False, "error": "image_read_failed", "boxes": []}

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blur, 60, 180)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    edges = cv2.dilate(edges, kernel, iterations=1)
    edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel, iterations=1)

    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    boxes = []
    img_h, img_w = image.shape[:2]
    img_area = float(img_w * img_h)
    min_area = max(600.0, img_area * 0.005)
    ratio_target = None
    if known_size:
        ratio_target = known_size[0] / known_size[1] if known_size[1] else None

    for contour in contours:
        area = cv2.contourArea(contour)
        if area < min_area:
            continue
        peri = cv2.arcLength(contour, True)
        approx = cv2.approxPolyDP(contour, 0.02 * peri, True)
        if len(approx) < 4 or len(approx) > 6:
            continue
        if not cv2.isContourConvex(approx):
            continue

        rect = cv2.minAreaRect(contour)
        (cx, cy), (rect_w, rect_h), angle = rect
        if rect_w <= 1 or rect_h <= 1:
            continue
        rect_area = rect_w * rect_h
        fill_ratio = area / rect_area if rect_area else 0
        if fill_ratio < 0.75:
            continue

        rect_ratio = rect_w / rect_h if rect_h else 0
        if rect_ratio <= 0:
            continue
        if ratio_target:
            ratio_diff = min(abs(rect_ratio - ratio_target), abs((1 / rect_ratio) - ratio_target))
            if ratio_diff > 0.25:
                continue
        points = cv2.boxPoints(rect)
        points = np.intp(points)
        x, y, w, h = cv2.boundingRect(points)
        boxes.append(
            {
                "x": int(x),
                "y": int(y),
                "w": int(w),
                "h": int(h),
                "rw": float(rect_w),
                "rh": float(rect_h),
                "points": [[int(pt[0]), int(pt[1])] for pt in points],
                "area": float(area),
                "fill": float(fill_ratio),
            }
        )

    if not boxes and contours:
        contour = max(contours, key=cv2.contourArea)
        rect = cv2.minAreaRect(contour)
        (cx, cy), (rect_w, rect_h), angle = rect
        points = cv2.boxPoints(rect)
        points = np.intp(points)
        x, y, w, h = cv2.boundingRect(points)
        boxes.append(
            {
                "x": int(x),
                "y": int(y),
                "w": int(w),
                "h": int(h),
                "rw": float(rect_w),
                "rh": float(rect_h),
                "points": [[int(pt[0]), int(pt[1])] for pt in points],
                "area": float(cv2.contourArea(contour)),
            }
        )

    selected_boxes = []
    if boxes:
        center_x = img_w / 2.0
        center_y = img_h / 2.0
        max_center_dx = img_w * 0.25
        max_center_dy = img_h * 0.25

        def center_distance_sq(box):
            cx = box["x"] + box["w"] / 2
            cy = box["y"] + box["h"] / 2
            dx = cx - center_x
            dy = cy - center_y
            return dx * dx + dy * dy

        centered = []
        for box in boxes:
            cx = box["x"] + box["w"] / 2
            cy = box["y"] + box["h"] / 2
            if abs(cx - center_x) <= max_center_dx and abs(cy - center_y) <= max_center_dy:
                centered.append(box)

        candidates = centered if centered else boxes
        def ratio_score(box):
            if not ratio_target:
                return 0.0
            rect_ratio = box["rw"] / box["rh"] if box["rh"] else 0
            if rect_ratio <= 0:
                return 1e9
            return min(abs(rect_ratio - ratio_target), abs((1 / rect_ratio) - ratio_target))

        best = min(
            candidates,
            key=lambda box: (
                center_distance_sq(box),
                ratio_score(box),
                -box.get("area", 0),
            ),
        )
        selected_boxes = [best]

    annotated = image.copy()
    for box in selected_boxes:
        pts = np.array(box["points"], dtype=int).reshape((-1, 1, 2))
        cv2.polylines(annotated, [pts], True, (0, 255, 0), 2)
    cv2.imwrite(output_path, annotated)

    result = {"found": len(selected_boxes) > 0, "boxes": selected_boxes}

    if selected_boxes and known_size:
        chosen = selected_boxes[0]
        rect_w = max(chosen.get("rw", 0.0), 1.0)
        rect_h = max(chosen.get("rh", 0.0), 1.0)
        known_w, known_h = choose_orientation(rect_w, rect_h, known_size[0], known_size[1])
        scale_w = known_w / rect_w
        scale_h = known_h / rect_h
        scale = (scale_w + scale_h) / 2 if scale_w and scale_h else 0
        result["scale_mm_per_px"] = scale

    return result


def detect_with_pillow(image_path, output_path):
    try:
        from PIL import Image
    except ImportError:
        return {"found": False, "error": "pillow_not_available", "boxes": []}

    image = Image.open(image_path).convert("RGB")
    image.save(output_path)
    return {"found": False, "error": "no_detection_available", "boxes": []}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--known", default="")
    args = parser.parse_args()

    known = parse_known_size(args.known)

    result = detect_with_opencv(args.input, args.output, known)
    if not result.get("found") and result.get("error") in (
        "opencv_not_available",
        "image_read_failed",
    ):
        result = detect_with_pillow(args.input, args.output)

    print(json.dumps(result))


if __name__ == "__main__":
    main()

