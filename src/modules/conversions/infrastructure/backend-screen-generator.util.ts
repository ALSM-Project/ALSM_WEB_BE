export interface ScreenField {
  name: string;
  label: string;
  defaultValue: string;
  type?: 'text' | 'select' | 'password' | 'number';
  options?: string[];
  fullWidth?: boolean;
}

export interface GeneratedScreenBundle {
  title: string;
  subtitle: string;
  fields: ScreenField[];
  files: { relativePath: string; language: string; content: string }[];
  linesOfCode: number;
}

/**
 * Deterministically generates screen fields, TSX code, and DTOs based on the screen name.
 */
export function generateBackendScreenBundle(screenName: string): GeneratedScreenBundle {
  const cleanName = screenName.replace(/\.(bms|dspf|cob|cbl|dds)$/i, '');
  const pascalName = cleanName.charAt(0).toUpperCase() + cleanName.slice(1).replace(/[^A-Za-z0-9]/g, '');
  const upper = cleanName.toUpperCase();

  const fields: ScreenField[] = [];
  const title = `${upper} Modernized Screen`;
  const subtitle = `Legacy BMS/DSPF Screen (${screenName} → React Component)`;

  const tsxContent = `import React from 'react';

/**
 * Modernized React Component for ${screenName}
 * ${subtitle}
 */
export const ${pascalName}Screen: React.FC = () => {
  return (
    <div className="p-6 bg-white rounded-2xl border border-slate-200 space-y-4">
      <h2 className="text-lg font-bold text-slate-900">${title}</h2>
      <p className="text-xs text-slate-500">${subtitle}</p>
    </div>
  );
};

export default ${pascalName}Screen;`;

  const dtoContent = `/**
 * Data Transfer Object for ${screenName}
 */
export interface ${pascalName}Dto {
  LAST_UPDATED: string;
}`;

  const files = [
    {
      relativePath: `src/components/${pascalName}Screen.tsx`,
      language: 'typescript',
      content: tsxContent,
    },
    {
      relativePath: `src/types/${cleanName}.dto.ts`,
      language: 'typescript',
      content: dtoContent,
    },
  ];

  const linesOfCode = files.reduce((sum, f) => sum + f.content.split('\n').length, 0);

  return {
    title,
    subtitle,
    fields,
    files,
    linesOfCode,
  };
}
