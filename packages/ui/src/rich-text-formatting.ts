import type { Command } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { canSplit } from "@tiptap/pm/transform";

type LineBreak = { from: number; to: number };

/**
 * Make selected soft lines independent blocks before a paragraph/heading command.
 * Markdown newlines and pasted <br>s otherwise belong to one textblock, so a
 * heading command would change every visible line in that block. Only the
 * boundaries around/between touched lines change; ordinary wrapping is untouched.
 * Run in the same chain as setHeading/setParagraph so one Undo restores both.
 */
export const isolateTextStyleLines: Command = ({ tr, dispatch }) => {
  if (!dispatch || !(tr.selection instanceof TextSelection)) return true;

  const { from, to, anchor, head, empty } = tr.selection;
  const storedMarks = tr.storedMarks;
  const boundaries: LineBreak[] = [];

  tr.doc.descendants((node, position) => {
    if (node.type.name !== "paragraph" && node.type.name !== "heading") return;
    const start = position + 1;
    const end = start + node.content.size;
    const touched = empty ? from >= start && from <= end : from < end && to > start;
    if (!touched) return false;

    const breaks: LineBreak[] = [];
    node.forEach((child, offset) => {
      const childStart = start + offset;
      if (child.type.name === "hardBreak") breaks.push({ from: childStart, to: childStart + child.nodeSize });
      if (child.isText) {
        for (const match of child.text!.matchAll(/\r\n|\r|\n/g)) {
          breaks.push({ from: childStart + match.index!, to: childStart + match.index! + match[0].length });
        }
      }
    });
    const lineAt = (position: number) => breaks.filter(lineBreak => position >= lineBreak.to).length;
    const first = lineAt(Math.max(start, from));
    const last = lineAt(Math.min(end, empty ? to : to - 1));
    // Keep breaks in untouched preceding/following lines exactly as authored.
    boundaries.push(...breaks.filter((_, index) => index >= first - 1 && index <= last));
    return false;
  });

  if (!boundaries.length) return true;
  const splitBoundaries: LineBreak[] = [];
  for (const boundary of boundaries.sort((left, right) => right.from - left.from)) {
    // Descending positions keep earlier source offsets stable. Replacing each
    // separator with a block boundary retains inline marks and surrounding nodes.
    if (!canSplit(tr.doc, boundary.from)) continue;
    tr.delete(boundary.from, boundary.to);
    tr.split(boundary.from);
    splitBoundaries.push(boundary);
  }

  const mapEndpoint = (position: number, rangeEnd = false) => {
    const delimiter = splitBoundaries.find(boundary => rangeEnd
      ? position > boundary.from && position <= boundary.to
      : position >= boundary.from && position < boundary.to);
    const textPosition = delimiter?.from ?? position;
    // A removed separator becomes two node-boundary positions. Mapping endpoints
    // explicitly distinguishes both sides of consecutive breaks (an empty line),
    // which a single StepMap association cannot retain after delete + split.
    return textPosition + splitBoundaries.reduce((delta, boundary) =>
      delta + (boundary.to <= textPosition ? 2 - (boundary.to - boundary.from) : 0), 0);
  };
  const mappedFrom = mapEndpoint(from);
  const mappedTo = empty ? mappedFrom : mapEndpoint(to, true);
  tr.setSelection(TextSelection.create(tr.doc,
    anchor <= head ? mappedFrom : mappedTo,
    anchor <= head ? mappedTo : mappedFrom));
  if (storedMarks) tr.setStoredMarks(storedMarks);
  return true;
};
