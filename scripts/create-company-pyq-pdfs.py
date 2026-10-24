from pathlib import Path
from xml.sax.saxutils import escape
import json
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, KeepTogether, PageBreak, Image
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors
root=Path(__file__).resolve().parents[1]
rows=json.loads((root/'scripts/company-pyq-mock-content.json').read_text())
styles=getSampleStyleSheet()
styles.add(ParagraphStyle(name='CompanyTitle',fontName='Helvetica-Bold',fontSize=24,leading=30,textColor=colors.HexColor('#173657'),spaceAfter=8))
styles.add(ParagraphStyle(name='QuestionCopy',fontSize=11,leading=17,textColor=colors.HexColor('#263d56'),spaceAfter=10))
styles.add(ParagraphStyle(name='AnswerCopy',fontSize=10,leading=15,textColor=colors.HexColor('#4d6277'),spaceAfter=15))
styles.add(ParagraphStyle(name='SampleNote',fontSize=9,leading=14,textColor=colors.HexColor('#64748b'),spaceAfter=14))
for row in rows:
 name=row['companyName']
 story=[Image(str(root/f"apps/api/assets/company-logos/{row['slug']}.png"),width=58,height=58,hAlign='LEFT'),Spacer(1,12),Paragraph(escape(name),styles['CompanyTitle']),Paragraph('Mock model question paper',styles['Heading2']),Paragraph('Original sample material for demonstration and self-practice. Not an official company paper, an authentic previous-year paper or a statement of the company\'s hiring process.',styles['SampleNote']),Paragraph('Suggested time: 25 minutes | 5 questions | Self-practice',styles['SampleNote']),Spacer(1,10)]
 for i,q in enumerate(row['practiceQuestions'],1):
  story.append(KeepTogether([Paragraph(f"{i:02}. {escape(q['question'])}",styles['QuestionCopy']),Spacer(1,24)]))
 story += [PageBreak(),Paragraph(f"{escape(name)} - Answer guide",styles['CompanyTitle']),Paragraph('MOCK MATERIAL / Suggested answers for self-review',styles['SampleNote'])]
 for i,q in enumerate(row['practiceQuestions'],1):
  story.append(KeepTogether([Paragraph(f"{i:02}. {escape(q['question'])}",styles['QuestionCopy']),Paragraph(escape(q['answer']),styles['AnswerCopy'])]))
 def footer(c,d):
  c.setStrokeColor(colors.HexColor('#315e91'));c.line(42,40,553,40);c.setFont('Helvetica',8);c.setFillColor(colors.HexColor('#64748b'));c.drawString(42,26,'OTP SLATE / MOCK MATERIAL - Not an official company paper');c.drawRightString(553,26,str(d.page))
 path=root/f"apps/api/assets/pyq/{row['slug']}-model-paper.pdf"
 SimpleDocTemplate(str(path),pagesize=(595,842),leftMargin=42,rightMargin=42,topMargin=36,bottomMargin=55,title=f'{name} - Mock model paper',author='OTP Slate').build(story,onFirstPage=footer,onLaterPages=footer)
print('Created 14 mock model papers with answer guides.')
