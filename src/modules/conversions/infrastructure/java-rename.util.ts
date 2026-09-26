export interface JavaRenameInstruction {
  relativePath: string;
  originalName: string;
  targetName: string;
}

const JAVA_IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export function isValidJavaIdentifier(name: string): boolean {
  return JAVA_IDENTIFIER_PATTERN.test(name);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Applies real class/method renames to generated Java source — a literal, word-boundary
 * identifier replacement scoped to each file. Covers the declaration plus any same-file call
 * sites (constructor references, internal method calls), which is everything tool2java's
 * generated Tasklet classes contain. Files with no matching instruction are returned
 * unchanged (same object reference is not preserved, but content is identical). */
export function applyJavaRenames(
  files: { relativePath: string; content: string }[],
  instructions: JavaRenameInstruction[],
): { relativePath: string; content: string }[] {
  return files.map((file) => {
    const fileInstructions = instructions.filter((i) => i.relativePath === file.relativePath);
    if (fileInstructions.length === 0) return file;
    let content = file.content;
    for (const instruction of fileInstructions) {
      const pattern = new RegExp(`\\b${escapeRegExp(instruction.originalName)}\\b`, 'g');
      content = content.replace(pattern, instruction.targetName);
    }
    return { relativePath: file.relativePath, content };
  });
}
