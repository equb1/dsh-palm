#!/usr/bin/env python3
"""P0 1.1 acceptance: create / read back / edit docx, xlsx, pptx on the phone."""
import os
import time

from docx import Document
from openpyxl import Workbook, load_workbook
from pptx import Presentation
from pptx.chart.data import CategoryChartData
from pptx.enum.chart import XL_CHART_TYPE
from pptx.util import Inches, Pt

OUT = "/root/work/office-smoke"
os.makedirs(OUT, exist_ok=True)


def ms(t0: float) -> int:
    return round((time.perf_counter() - t0) * 1000)


def size(path: str) -> int:
    return os.path.getsize(path)


results = []

# ---------------- DOCX ----------------
p = os.path.join(OUT, "报告.docx")
t0 = time.perf_counter()
doc = Document()
doc.add_heading("季度报告", level=0)
doc.add_paragraph("一、概述", style="Heading 1")
para = doc.add_paragraph("本季度营收同比增长 18%。")
doc.add_paragraph("二、明细", style="Heading 1")
table = doc.add_table(rows=2, cols=2)
table.cell(0, 0).text = "指标"
table.cell(0, 1).text = "数值"
table.cell(1, 0).text = "营收"
table.cell(1, 1).text = "1200 万"
doc.save(p)
create_ms = ms(t0)

t0 = time.perf_counter()
doc2 = Document(p)
texts = [para.text for para in doc2.paragraphs]
table_text = doc2.tables[0].cell(1, 0).text
assert texts[0] == "季度报告", texts
assert table_text == "指标" or table_text == "营收", table_text
read_ms = ms(t0)

t0 = time.perf_counter()
doc2.paragraphs[2].text = "本季度营收同比增长 21%（已修订）。"
doc2.save(os.path.join(OUT, "报告-修订.docx"))
edit_ms = ms(t0)
results.append(("docx", size(p), create_ms, read_ms, edit_ms, texts[2]))

# ---------------- XLSX ----------------
p = os.path.join(OUT, "报表.xlsx")
t0 = time.perf_counter()
wb = Workbook()
ws = wb.active
ws.title = "营收"
for row in [("季度", "营收", "成本"), ("Q1", 120, 80), ("Q2", 180, 95), ("合计", "=SUM(B2:B3)", "=SUM(C2:C3)")]:
    ws.append(row)
from openpyxl.styles import Font

for cell in ws[1]:
    cell.font = Font(bold=True)
ws.column_dimensions["A"].width = 12
wb.save(p)
create_ms = ms(t0)

t0 = time.perf_counter()
wb2 = load_workbook(p, data_only=False)
assert wb2["营收"]["B4"].value == "=SUM(B2:B3)"
assert wb2["营收"]["A3"].value == "Q2"
read_ms = ms(t0)

t0 = time.perf_counter()
wb2["营收"]["B3"] = 190
wb2.save(os.path.join(OUT, "报表-修订.xlsx"))
edit_ms = ms(t0)
results.append(("xlsx", size(p), create_ms, read_ms, edit_ms, wb2["营收"]["B4"].value))

# ---------------- PPTX ----------------
p = os.path.join(OUT, "汇报.pptx")
t0 = time.perf_counter()
prs = Presentation()
prs.slide_width = Inches(13.333)
prs.slide_height = Inches(7.5)
slide = prs.slides.add_slide(prs.slide_layouts[6])
title = slide.shapes.add_textbox(Inches(0.6), Inches(0.4), Inches(12), Inches(0.8))
run = title.text_frame.paragraphs[0].add_run()
run.text = "季度汇报"
run.font.size = Pt(30)
data = CategoryChartData()
data.categories = ["Q1", "Q2"]
data.add_series("营收", [120, 190])
slide.shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED, Inches(0.8), Inches(1.6), Inches(11.5), Inches(4.8), data)
prs.save(p)
create_ms = ms(t0)

t0 = time.perf_counter()
prs2 = Presentation(p)
assert len(prs2.slides) == 1
shape_texts = [s.text for s in prs2.slides[0].shapes if s.has_text_frame]
assert "季度汇报" in shape_texts, shape_texts
read_ms = ms(t0)

t0 = time.perf_counter()
for shape in prs2.slides[0].shapes:
    if shape.has_text_frame and shape.text == "季度汇报":
        shape.text_frame.paragraphs[0].runs[0].text = "季度汇报（修订）"
prs2.save(os.path.join(OUT, "汇报-修订.pptx"))
edit_ms = ms(t0)
results.append(("pptx", size(p), create_ms, read_ms, edit_ms, shape_texts))

print("format size_bytes create_ms read_ms edit_ms detail")
for r in results:
    print(*r)
print("DONE")
