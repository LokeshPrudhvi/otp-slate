from pathlib import Path
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, KeepTogether
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
import json
root=Path(__file__).resolve().parents[1]
assets=root/'apps/api/assets/pyq'
specs=[
('northstar-tech','Northstar Tech','#315e91','NT',[
('A team completes 3 modules every 2 days. How many modules can it complete in 10 days?','15 modules. Ten days contain five two-day periods; 5 x 3 = 15.'),
('Find the next number: 2, 6, 12, 20, 30, ...','42. Consecutive terms are n(n+1), so the next term is 6 x 7.'),
('What data structure detects repeated values in a list efficiently?','A hash set. Insert each value and check whether it is already present. Expected O(n) time.'),
('What is the difference between an INNER JOIN and a LEFT JOIN?','An INNER JOIN returns matching rows only. A LEFT JOIN also retains unmatched rows from the left table.'),
('Describe a project decision you would change after receiving feedback.','Use a specific situation, your original decision, the feedback, the change and a measurable outcome.')]),
('apex-digital','Apex Digital','#7651a4','AD',[
('An item costs INR 800 and is discounted by 15%. What is the sale price?','INR 680. The discount is 800 x 0.15 = 120.'),
('All APIs are interfaces. Some interfaces are public. Must all APIs be public?','No. The premises do not establish that all APIs belong to the public subset.'),
('Explain the difference between HTTP GET and POST.','GET retrieves a representation and should be safe. POST submits data for processing and may change server state.'),
('How would you make a web form accessible?','Use associated labels, keyboard access, clear error messages, visible focus indicators and appropriate input types.'),
('How would you handle a disagreement during a team project?','Explain how you would clarify the goal, hear both views, compare evidence and agree on an action.')]),
('meridian-systems','Meridian Systems','#287864','MS',[
('The ratio of frontend to backend developers is 3:2. There are 25 developers. How many work on backend?','10. There are 5 ratio units, each worth 5 developers. Backend has 2 units.'),
('A train travels 150 km in 2.5 hours. What is its average speed?','60 km/h. Average speed = distance / time = 150 / 2.5.'),
('Explain why a database transaction is useful when transferring money.','The debit and credit must both succeed or both roll back, preventing a partially completed transfer.'),
('What is the time complexity of binary search on a sorted array?','O(log n), because each comparison halves the remaining search interval.'),
('What would you do if a production incident occurred during your shift?','Assess impact, communicate, follow the incident process, mitigate safely and preserve evidence for a review.')]),
('vertex-labs','Vertex Labs','#af6034','VL',[
('A value increases from 40 to 50. What is the percentage increase?','25%. The increase is 10; 10 / 40 x 100 = 25.'),
('A bag has 3 red and 2 blue balls. What is the probability of drawing blue?','2/5. Two of the five equally likely balls are blue.'),
('Why should a machine-learning dataset be split into training and test sets?','To evaluate generalization on data the model did not use for fitting.'),
('What does a unit test check?','A small unit of behavior in isolation, using controlled inputs and explicit expected outcomes.'),
('How would you explain a technical result to a non-technical teammate?','State the business question, the result in plain language, its limitations and the next decision.')])]
styles=getSampleStyleSheet()
styles.add(ParagraphStyle(name='BrandTitle',fontName='Helvetica-Bold',fontSize=26,leading=32,textColor=colors.HexColor('#173657'),spaceAfter=12))
styles.add(ParagraphStyle(name='QuestionText',fontSize=11,leading=17,spaceAfter=8,textColor=colors.HexColor('#263d56')))
styles.add(ParagraphStyle(name='MutedText',fontSize=10,leading=15,textColor=colors.HexColor('#5c6f82'),spaceAfter=14))
rows=[]
for slug,name,color,initials,questions in specs:
 svg=f'''<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160"><rect width="160" height="160" rx="32" fill="{color}"/><path d="M112 0h48v160h-48l25-80z" fill="#ffffff" opacity=".09"/><circle cx="26" cy="28" r="9" fill="#ffffff" opacity=".25"/><text x="80" y="97" text-anchor="middle" font-family="Arial,sans-serif" font-size="49" font-weight="700" fill="#ffffff">{initials}</text></svg>'''
 (assets/f'{slug}.svg').write_text(svg)
 story=[Paragraph('OTP SLATE / MOCK COMPANY PREPARATION',styles['MutedText']),Paragraph(name,styles['BrandTitle']),Paragraph('Sample model question paper',styles['Heading2']),Paragraph('Fictional company. Original mock questions for demonstration only. This is not an authentic previous-year paper or a real company hiring guide.',styles['MutedText']),Paragraph('Suggested time: 25 minutes | 5 questions | Self-practice',styles['MutedText']),Spacer(1,10)]
 for i,(q,a) in enumerate(questions,1):story += [KeepTogether([Paragraph(f'{i:02}. {q}',styles['QuestionText']),Spacer(1,30)])]
 def footer(c,d):
  c.setStrokeColor(colors.HexColor(color));c.line(42,40,553,40);c.setFont('Helvetica',8);c.setFillColor(colors.HexColor('#5c6f82'));c.drawString(42,26,'MOCK MATERIAL - For demonstration and self-practice');c.drawRightString(553,26,f'{d.page}')
 SimpleDocTemplate(str(assets/f'{slug}-model-paper.pdf'),pagesize=(595,842),leftMargin=42,rightMargin=42,topMargin=40,bottomMargin=55).build(story,onFirstPage=footer,onLaterPages=footer)
 rows.append(dict(kind='company',title=name,provider=name,description='Mock company guide: explore a sample hiring process, model paper and guided practice. Fictional company; demonstration content.',logoUrl=f'/api/v1/placement-samples/{slug}.svg',url='',hiringProcedure='MOCK HIRING PROCEDURE - Fictional company; demonstration only.\n\n01. Aptitude screening\nPractise numerical reasoning, logical thinking and clear communication.\n\n02. Technical discussion\nReview core concepts and explain a solution step by step.\n\n03. Project conversation\nDiscuss your contribution, trade-offs and lessons learned.\n\n04. Behavioural interview\nUse specific examples to explain collaboration and decision-making.',papers=[dict(title=f'{name} - Sample model paper',url=f'/api/v1/placement-samples/{slug}-model-paper.pdf')],practiceQuestions=[dict(question=q,answer=a) for q,a in questions],status='published'))
(root/'scripts/pyq-mock-data.json').write_text(json.dumps(rows,indent=2)+'\n')
print('Created 4 mock company logos, 4 model PDFs and 20 practice questions.')
