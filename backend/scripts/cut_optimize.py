#!/usr/bin/env python3
"""Petit optimiseur de coupe 1D / 2D — stdin JSON → stdout JSON."""
from __future__ import annotations

import json
import sys
import time
from typing import Any


def uid(prefix: str) -> str:
    return f"{prefix}_{int(time.time() * 1000)}_{id(object()) % 10000}"


COLORS = [
    "#D97706", "#2563EB", "#059669", "#7C3AED", "#DC2626",
    "#0891B2", "#CA8A04", "#DB2777", "#4F46E5", "#16A34A",
]


def color_for(i: int) -> str:
    return COLORS[i % len(COLORS)]


def pack_1d(parts: list[dict], board_len: float, kerf: float) -> list[dict]:
    items: list[dict] = []
    for i, p in enumerate(parts or []):
        qty = max(0, int(p.get("qty") or 0))
        length = float(p.get("length") or 0)
        if length <= 0 or qty <= 0:
            continue
        for _ in range(qty):
            items.append({
                "id": uid("seg"),
                "partId": p.get("id"),
                "label": p.get("label") or f'{length}"',
                "length": length,
                "color": p.get("color") or color_for(i),
            })
    items.sort(key=lambda x: -x["length"])

    boards: list[dict] = []

    def used(board: dict) -> float:
        segs = board["segments"]
        if not segs:
            return 0.0
        return sum(s["length"] for s in segs) + max(0, len(segs) - 1) * kerf

    for item in items:
        placed = False
        for board in boards:
            need = item["length"] + (kerf if board["segments"] else 0)
            if used(board) + need <= board_len + 1e-6:
                board["segments"].append(dict(item))
                placed = True
                break
        if not placed:
            boards.append({
                "id": uid("board"),
                "label": f"Planche {len(boards) + 1}",
                "length": board_len,
                "material": "2×4",
                "segments": [dict(item)],
            })
    if not boards:
        boards.append({
            "id": uid("board"),
            "label": "Planche 1",
            "length": board_len,
            "material": "2×4",
            "segments": [],
        })
    return boards


def pack_2d(parts: list[dict], sheet_w: float, sheet_h: float, kerf: float) -> list[dict]:
    items: list[dict] = []
    for i, p in enumerate(parts or []):
        qty = max(0, int(p.get("qty") or 0))
        w = float(p.get("w") or 0)
        h = float(p.get("h") or 0)
        if w <= 0 or h <= 0 or qty <= 0:
            continue
        for _ in range(qty):
            items.append({
                "id": uid("rect"),
                "partId": p.get("id"),
                "label": p.get("label") or f"{w}×{h}",
                "w": w,
                "h": h,
                "color": p.get("color") or color_for(i),
            })
    items.sort(key=lambda x: -(x["w"] * x["h"]))

    sheets: list[dict] = []

    def new_sheet() -> dict:
        s = {
            "id": uid("sheet"),
            "label": f"Panneau {len(sheets) + 1}",
            "width": sheet_w,
            "height": sheet_h,
            "material": "contreplaqué",
            "rects": [],
            "_shelves": [],
        }
        sheets.append(s)
        return s

    for item in items:
        orients = []
        for w, h in ((item["w"], item["h"]), (item["h"], item["w"])):
            if w <= sheet_w and h <= sheet_h:
                orients.append((w, h))
        if not orients:
            orients = [(item["w"], item["h"])]

        placed = False
        for sheet in sheets:
            for w, h in orients:
                for shelf in sheet["_shelves"]:
                    if h <= shelf["height"] + 1e-6 and shelf["x"] + w <= sheet_w + 1e-6:
                        sheet["rects"].append({
                            **item,
                            "id": uid("rect"),
                            "w": w,
                            "h": h,
                            "x": shelf["x"],
                            "y": shelf["y"],
                        })
                        shelf["x"] += w + kerf
                        placed = True
                        break
                if placed:
                    break
                y = 0.0
                for shelf in sheet["_shelves"]:
                    y = max(y, shelf["y"] + shelf["height"] + kerf)
                if y + h <= sheet_h + 1e-6 and w <= sheet_w + 1e-6:
                    sheet["_shelves"].append({"y": y, "height": h, "x": w + kerf})
                    sheet["rects"].append({
                        **item,
                        "id": uid("rect"),
                        "w": w,
                        "h": h,
                        "x": 0,
                        "y": y,
                    })
                    placed = True
                    break
            if placed:
                break

        if not placed:
            sheet = new_sheet()
            w, h = orients[0]
            sheet["_shelves"].append({"y": 0, "height": h, "x": w + kerf})
            sheet["rects"].append({
                **item,
                "id": uid("rect"),
                "w": w,
                "h": h,
                "x": 0,
                "y": 0,
            })

    for s in sheets:
        s.pop("_shelves", None)
    if not sheets:
        sheets.append({
            "id": uid("sheet"),
            "label": "Panneau 1",
            "width": sheet_w,
            "height": sheet_h,
            "material": "contreplaqué",
            "rects": [],
        })
    return sheets


def main() -> None:
    raw = sys.stdin.read() or "{}"
    data: dict[str, Any] = json.loads(raw)
    mode = data.get("mode") or "1d"
    kerf = float(data.get("kerf") or 0.125)
    board_len = float(data.get("board_length_in") or 96)
    sheet_w = float(data.get("sheet_w_in") or 96)
    sheet_h = float(data.get("sheet_h_in") or 48)

    out: dict[str, Any] = {"engine": "python", "mode": mode}
    if mode == "2d":
        out["sheets"] = pack_2d(data.get("panel_parts") or [], sheet_w, sheet_h, kerf)
        out["boards"] = []
    else:
        out["boards"] = pack_1d(data.get("linear_parts") or [], board_len, kerf)
        out["sheets"] = []
    json.dump(out, sys.stdout)


if __name__ == "__main__":
    main()
