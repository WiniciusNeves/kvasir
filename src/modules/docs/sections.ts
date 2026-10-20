// Markdown split into sections by heading, so the model edits a section instead of rewriting a whole
// document (long docs would not fit, and a full rewrite loses things silently).

export interface Section {
  // the heading line as written ("## Comandos"); '' for the text before the first heading
  heading: string;
  level: number;
  // 0-based line index of the heading (or of the first line for the preamble)
  start: number;
  // exclusive
  end: number;
}

const HEADING = /^(#{1,6})\s+\S/;
const FENCE = /^\s*(```|~~~)/;

export function splitLines(content: string): { lines: string[]; eol: string } {
  return { lines: content.split(/\r?\n/), eol: content.includes('\r\n') ? '\r\n' : '\n' };
}

// Headings inside code fences are not headings.
export function parseSections(lines: string[]): Section[] {
  const headings: { line: number; level: number }[] = [];
  let inFence = false;
  lines.forEach((line, index) => {
    if (FENCE.test(line)) inFence = !inFence;
    const match = !inFence ? line.match(HEADING) : null;
    if (match) headings.push({ line: index, level: match[1].length });
  });

  const sections: Section[] = [];
  if (headings.length === 0 || headings[0].line > 0) {
    sections.push({ heading: '', level: 0, start: 0, end: headings[0]?.line ?? lines.length });
  }
  headings.forEach((heading, index) => {
    // a section ends at the next heading of the same or a higher level (subsections stay inside)
    const next = headings.slice(index + 1).find((other) => other.level <= heading.level);
    sections.push({ heading: lines[heading.line].trim(), level: heading.level, start: heading.line, end: next?.line ?? lines.length });
  });
  return sections;
}

export function sectionBody(lines: string[], section: Section): string {
  const from = section.heading ? section.start + 1 : section.start;
  return lines.slice(from, section.end).join('\n');
}

export function outline(sections: Section[]): string {
  return sections
    .filter((section) => section.heading)
    .map((section) => `${'  '.repeat(section.level - 1)}${section.heading}`)
    .join('\n');
}

// Replaces the body of the section with exactly this heading (subsections included); the heading stays.
export function replaceSection(lines: string[], heading: string, body: string): string[] | null {
  const section = parseSections(lines).find((item) => item.heading === heading.trim());
  if (!section) return null;
  const bodyLines = body.replace(/^\s*\n/, '').replace(/\s+$/, '').split('\n');
  // keep the document's own spacing: a blank line after the heading if it had one
  const blankAfterHeading = lines[section.start + 1]?.trim() === '' ? [''] : [];
  const atEnd = section.end >= lines.length;
  return [...lines.slice(0, section.start + 1), ...blankAfterHeading, ...bodyLines, ...(atEnd ? [] : ['']), ...lines.slice(section.end)];
}

export function appendSection(lines: string[], heading: string, body: string): string[] {
  const trimmed = [...lines];
  while (trimmed.length > 0 && trimmed[trimmed.length - 1].trim() === '') trimmed.pop();
  return [...trimmed, '', heading.trim(), ...body.replace(/\s+$/, '').split('\n'), ''];
}
