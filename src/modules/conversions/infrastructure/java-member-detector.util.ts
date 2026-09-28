import type { JavaMemberKind } from '../domain/method-mapping.types';

export interface DetectedJavaMember {
  relativePath: string;
  kind: JavaMemberKind;
  name: string;
}

const CLASS_PATTERN = /\bpublic\s+(?:final\s+)?class\s+([A-Za-z_$][A-Za-z0-9_$]*)/;
// Matches a public method declaration's return type + name, up to its opening paren.
// Intentionally simple (no generics/annotation edge cases) - this only needs to find the
// real names tool2java's straightforward generated Tasklet classes actually contain, not
// parse arbitrary Java.
const METHOD_PATTERN = /\bpublic\s+(?:static\s+)?(?:final\s+)?[\w<>[\],.\s]+?\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\([^)]*\)\s*(?:throws\s+[\w.,\s]+)?\{/g;

/** Detects the real class name and public method names in each generated .java file — the
 * data a method-mapping override needs to show and let the user rename. tool2java produces
 * no structured metadata of its own, so this parses its literal output text. Never fabricates
 * a name: an unparseable file simply contributes no entries. */
export function detectJavaMembers(files: { relativePath: string; content: string }[]): DetectedJavaMember[] {
  const members: DetectedJavaMember[] = [];
  for (const file of files) {
    if (!file.relativePath.toLowerCase().endsWith('.java')) continue;
    const classMatch = file.content.match(CLASS_PATTERN);
    const className = classMatch?.[1];
    if (className) {
      members.push({ relativePath: file.relativePath, kind: 'CLASS', name: className });
    }
    const seen = new Set<string>();
    const methodPattern = new RegExp(METHOD_PATTERN.source, 'g');
    let match: RegExpExecArray | null;
    while ((match = methodPattern.exec(file.content))) {
      const name = match[1];
      if (name === className) continue; // constructor, not a renameable method
      if (seen.has(name)) continue;
      seen.add(name);
      members.push({ relativePath: file.relativePath, kind: 'METHOD', name });
    }
  }
  return members;
}
