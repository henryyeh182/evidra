from pptx import Presentation
from pptx.dml.color import RGBColor


SRC = "docs/Fitness-MCP-Product-Vision.pptx"
OUT = "docs/Fitness-MCP-Product-Vision.pptx"

PAPER = "F0EEE6"
SURFACE = "FAF9F5"
SURFACE2 = "E9E3D6"
LINE = "DAD2C3"
INK = "1F1E1D"
MUTED = "68645C"
MINT = "157554"
MINT_SOFT = "DCEDE4"
NAVY = "111B30"
NAVY_CARD = "1E2A40"
NAVY_LINE = "34445E"
LIME = "49D993"
AMBER = "ECAE4D"
RED = "EC7972"


def rgb(value):
    return RGBColor.from_string(value)


def color_of(obj):
    try:
        if obj.type is None:
            return None
        return str(obj.rgb)
    except (AttributeError, ValueError, TypeError):
        return None


def set_color(obj, value):
    try:
        obj.rgb = rgb(value)
    except (AttributeError, ValueError, TypeError):
        pass


def replace_text(slide, replacements):
    for shape in slide.shapes:
        if not hasattr(shape, "text") or not shape.text:
            continue
        text = shape.text
        for old, new in replacements.items():
            text = text.replace(old, new)
        if text != shape.text:
            shape.text = text


def style_text(shape, dark):
    if not getattr(shape, "has_text_frame", False):
        return
    for paragraph in shape.text_frame.paragraphs:
        for run in paragraph.runs:
            run.font.name = "STHeiti"
            old = color_of(run.font.color)
            mapped = {
                "6E7687": MUTED,
                "A8AEBC": "9DA89F",
                "CFD4DF": "C9D0C8",
                "2C313D": INK if not dark else NAVY_LINE,
                "10131A": INK if not dark else PAPER,
                "353A46": INK if not dark else SURFACE,
                "8A93A6": MUTED if not dark else "9FAEBE",
                "3A4050": LINE if not dark else NAVY_LINE,
                "9EEBD8": MINT if not dark else LIME,
                "1FB6A6": MINT if not dark else LIME,
                "F96167": MINT if not dark else LIME,
                "FFE3E4": MINT_SOFT if not dark else "FFE0C4",
                "FFB3B6": MINT if not dark else AMBER,
                "FFFFFF": INK if not dark else SURFACE,
            }.get(old)
            if mapped:
                set_color(run.font.color, mapped)
            elif old is None:
                set_color(run.font.color, SURFACE if dark else INK)


def style_shape(shape, dark):
    try:
        fill_color = color_of(shape.fill.fore_color)
        fill_map = {
            "FFFFFF": NAVY if dark else PAPER,
            "F3F4F7": SURFACE2,
            "10131A": NAVY,
            "1B1F2B": NAVY_CARD,
            "1FB6A6": MINT,
            "F96167": MINT,
            "4A5568": NAVY_LINE,
            "2C3242": NAVY_LINE,
            "8A93A6": MUTED,
        }
        if fill_color in fill_map:
            set_color(shape.fill.fore_color, fill_map[fill_color])
    except (AttributeError, ValueError, TypeError):
        pass
    style_text(shape, dark)


def main():
    prs = Presentation(SRC)
    slide_replacements = {
        1: {
            "讓你熟悉的 AI 根據連續 Evidence 做出可重現的訓練決策 —— 健康歷史仍由你控制。": "把 Evidence 轉成今天可執行、可追溯的訓練變更。健康歷史仍由你控制。",
            "產品終局 · v0.4.2 → v0.5.0 · Phase 0–4": "Public preview · Desktop MCPB · v0.5.0 → local private engine",
        },
        2: {
            "先看產品終局,再看已交付能力,最後用真實情境與 roadmap 驗收。": "先看今天的決策，再看 evidence chain 與 privacy boundary，最後看產品驗證與 roadmap。",
            "我們蓋的不是 App,是一個確定性的訓練決策引擎": "從原定課表到今天要做什麼",
            "目前 6 tools、下一版 10 tools,以及版本化的 Engine 與 Rule Packages": "證據、理由、缺失與信心都可檢查",
            "六個真實問題,以及從 v0.5.0 到 private engine 的交付順序": "AI coach 可替換，健康歷史留在你的控制邊界",
        },
        3: {"身體是連續的,資料卻是被切開的": "一般 AI 知道運動知識，卻不知道連續的你"},
        5: {"我們要蓋的,是中間那一層": "我們要蓋的是 AI coach 與今天決策之間的一層"},
        6: {"使用者要連續的決策能力,不要再交出健康歷史": "Your AI can coach. Pacevera helps it decide."},
        7: {"關鍵設計:資料由使用者控制": "Evidence 留在你的控制邊界"},
        8: {"輸出具體長這樣": "輸出不是分數，是今天的 change"},
        10: {"我們給的是決策,不是建議": "我們給的是決策，不是建議"},
        12: {"決策引擎不是一個模型": "先對齊 Evidence，再用規則做決策"},
        13: {"Planning Engine 是整個產品最大的價值": "從計畫到今天：改動要能執行"},
        17: {"各家指標對齊,廠商算好的分數直接收": "把不同來源對齊成同一套語彙"},
        18: {"Connector 跑在你的環境,不在我們的": "Connector 跑在你的環境"},
        19: {"v0.5.0 規劃的十個 public tools": "v0.5.0：把一個 decision loop 做完整"},
        21: {"三種部署,三句不同的隱私承諾": "同一顆 engine，三種部署形態"},
        22: {"六個使用者真的會問的問題": "六種使用者真的會問的問題"},
        29: {"六題的共通點:先有證據,才談決策": "共通點：先有 Evidence，才談 Decision"},
        30: {"從已發行版本倒推下一階段": "先用產品頁驗證，再進 private engine"},
        31: {"Plaid 之於金融,Stripe 之於支付": "Pacevera 是 personal fitness decision layer"},
    }
    for number, replacements in slide_replacements.items():
        replace_text(prs.slides[number - 1], replacements)

    global_replacements = {
        "Fitness MCP": "Pacevera",
        "Fitness Decision Engine": "Fitness Decision Engine",
        "Pacevera\nFitness Decision Engine": "Pacevera\nFitness Decision Engine",
    }
    for slide in prs.slides:
        replace_text(slide, global_replacements)
        dark = color_of(slide.background.fill.fore_color) in {"10131A", "1B1F2B"}
        set_color(slide.background.fill.fore_color, NAVY if dark else PAPER)
        for shape in slide.shapes:
            style_shape(shape, dark)
    prs.save(OUT)


if __name__ == "__main__":
    main()
