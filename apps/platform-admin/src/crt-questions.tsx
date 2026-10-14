import type { LessonQuestion } from "@slate/contracts";
import { Field, QuestionImageEditor } from "@slate/ui";

export const newCrtQuestion = (): LessonQuestion => ({ id: crypto.randomUUID(), prompt: "", options: ["", "", "", ""], correctOption: 0, explanation: "" });

export function validateCrtQuestion(question: LessonQuestion, index = 0): string | null {
  if (!question.prompt.trim()) return `Add the text for question ${index + 1}.`;
  if (question.options.length < 2 || question.options.length > 6 || question.options.some(option => !option.trim())) return `Complete every answer option for question ${index + 1}.`;
  if (new Set(question.options.map(option => option.trim().toLowerCase())).size !== question.options.length) return `Use different answer options for question ${index + 1}.`;
  if (!Number.isInteger(question.correctOption) || question.correctOption! < 0 || question.correctOption! >= question.options.length) return `Choose the correct answer for question ${index + 1}.`;
  if (question.image && !question.image.alt.trim()) return `Describe the image for question ${index + 1}.`;
  return null;
}

export function CrtQuestionEditor({ question, index, onChange, onRemove, disabled, onPending }: {
  question: LessonQuestion; index: number; onChange: (question: LessonQuestion) => void;
  onRemove?: () => void; disabled: boolean; onPending: (pending: boolean) => void;
}) {
  const removeOption = (removeIndex: number) => onChange({ ...question,
    options: question.options.filter((_, i) => i !== removeIndex),
    correctOption: question.correctOption === removeIndex ? undefined : question.correctOption !== undefined && question.correctOption > removeIndex ? question.correctOption - 1 : question.correctOption,
  });
  return <fieldset className="crt-admin-question" disabled={disabled}>
    <legend>Question {index + 1}</legend>
    <div className="crt-question-head"><span>One correct answer</span>{onRemove && <button type="button" className="text-button crt-remove" onClick={onRemove}>Remove question</button>}</div>
    <Field label={`Question ${index + 1} text`}><textarea rows={3} required maxLength={5000} value={question.prompt} onChange={event => onChange({ ...question, prompt: event.target.value })} placeholder="Write a clear question for students." /></Field>
    <QuestionImageEditor image={question.image} disabled={disabled} onChange={image => onChange({ ...question, image })} onPending={onPending} label={`Question ${index + 1} image`} />
    <div className="crt-answer-heading"><strong>Answer options</strong><span>Select the correct answer</span></div>
    <div className="crt-answer-options">{question.options.map((option, optionIndex) => <div className={`crt-answer-option${question.correctOption === optionIndex ? " is-correct" : ""}`} key={optionIndex}>
      <label className="crt-answer-radio"><input type="radio" name={`crt-answer-${question.id}`} checked={question.correctOption === optionIndex} onChange={() => onChange({ ...question, correctOption: optionIndex })} aria-label={`Question ${index + 1}: option ${String.fromCharCode(65 + optionIndex)} is correct`} /><span aria-hidden="true">{String.fromCharCode(65 + optionIndex)}</span></label>
      <input required value={option} maxLength={2000} aria-label={`Question ${index + 1} option ${String.fromCharCode(65 + optionIndex)}`} placeholder={`Option ${String.fromCharCode(65 + optionIndex)}`} onChange={event => onChange({ ...question, options: question.options.map((value, i) => i === optionIndex ? event.target.value : value) })} />
      {question.options.length > 2 && <button type="button" aria-label={`Remove question ${index + 1} option ${String.fromCharCode(65 + optionIndex)}`} onClick={() => removeOption(optionIndex)}>×</button>}
    </div>)}</div>
    {question.options.length < 6 && <button className="text-button" type="button" onClick={() => onChange({ ...question, options: [...question.options, ""] })}>+ Add answer option</button>}
    <Field label={`Question ${index + 1} explanation (optional)`}><textarea rows={2} maxLength={5000} value={question.explanation || ""} onChange={event => onChange({ ...question, explanation: event.target.value })} placeholder="Explain the answer after submission." /></Field>
  </fieldset>;
}
