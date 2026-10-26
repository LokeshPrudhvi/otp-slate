// A standalone print document prevents portal navigation and global styles leaking into PDFs.
export const resumePrintStyles = `
@page { size: A4; margin: 14mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; color: #17212b; }
.resume-paper { margin: 0; padding: 4mm; width: 100%; font: 10.5pt/1.45 Arial, sans-serif; overflow-wrap: anywhere; }
.resume-paper header { border-bottom: 1px solid #354251; padding-bottom: 10pt; margin-bottom: 12pt; break-inside: avoid; }
h1 { margin: 0 0 5pt; font-size: 23pt; line-height: 1.15; }
h2 { margin: 15pt 0 5pt; font-size: 10.5pt; text-transform: uppercase; letter-spacing: .07em; break-after: avoid; }
p { white-space: pre-line; margin: 5pt 0; orphans: 3; widows: 3; }
.resume-headline { font-size: 11pt; }
.resume-contact { font-size: 9pt; }
.resume-entry { margin: 9pt 0; }
.resume-entry-heading { display: flex; align-items: baseline; justify-content: space-between; flex-wrap: wrap; gap: 2pt 9pt; break-after: avoid; }
.resume-entry-title { font-size: 10.5pt; margin: 0; font-weight: 700; break-after: avoid; }
.resume-entry-dates { font-size: 9pt; color: #4a5665; flex-shrink: 0; }
.resume-entry-subtitle { margin: 2pt 0; break-after: avoid; }
.resume-entry-description, .resume-entry-link { margin: 3pt 0; }
.resume-entry-link { font-size: 9pt; }
.resume-bullets { margin: 4pt 0; padding-left: 15pt; list-style: disc; }
.resume-bullets li { margin: 2pt 0; white-space: pre-line; orphans: 2; widows: 2; }
.resume-skills { display: flex; flex-wrap: wrap; gap: 2pt 0; padding: 0; margin: 5pt 0; list-style: none; }
.resume-skills li:not(:last-child)::after { content: ' · '; padding: 0 6pt; }
.template-modern h1, .template-modern h2 { color: #24497d; }
.template-modern header { border-bottom: 3px solid #24497d; }
.template-compact { font-size: 9.5pt; line-height: 1.35; }
.template-compact h2 { margin-top: 10pt; }
.template-compact .resume-entry { margin: 6pt 0; }
.template-serif { font-family: Georgia, serif; }
.template-serif h1 { font-size: 25pt; }
.resume-placeholder { display: none; }
`;

export async function printResume(element: HTMLElement, name: string) {
  document.querySelectorAll('iframe[data-resume-print]').forEach(frame => frame.remove());
  const frame = document.createElement('iframe');
  frame.dataset.resumePrint = '';
  frame.title = 'Resume PDF export';
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:210mm;height:297mm;border:0;pointer-events:none;';
  document.body.append(frame);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cleanup = () => { clearTimeout(timer); frame.remove(); };
  try {
    const target = frame.contentDocument, printWindow = frame.contentWindow;
    if (!target || !printWindow) throw new Error('The resume print document could not open. Please retry.');
    target.open();
    target.write('<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body></body></html>');
    target.close();
    target.title = `${name.trim() || 'Student'} - Resume`;
    const style = target.createElement('style');
    style.textContent = resumePrintStyles;
    target.head.append(style);
    target.body.append(target.importNode(element, true));
    await target.fonts?.ready;
    printWindow.addEventListener('afterprint', cleanup, { once: true });
    // Some browsers omit afterprint on cancellation; also remove stale frames on the next export.
    timer = setTimeout(cleanup, 5 * 60_000);
    printWindow.focus();
    printWindow.print();
  } catch (error) { cleanup(); throw error; }
}
