import { applyJavaRenames, isValidJavaIdentifier } from '../src/modules/conversions/infrastructure/java-rename.util';

describe('isValidJavaIdentifier', () => {
  it('accepts a normal identifier', () => {
    expect(isValidJavaIdentifier('AccountTasklet')).toBe(true);
  });

  it('rejects an identifier starting with a digit', () => {
    expect(isValidJavaIdentifier('1Tasklet')).toBe(false);
  });

  it('rejects an identifier containing a space or hyphen', () => {
    expect(isValidJavaIdentifier('Account Tasklet')).toBe(false);
    expect(isValidJavaIdentifier('Account-Tasklet')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isValidJavaIdentifier('')).toBe(false);
  });
});

describe('applyJavaRenames', () => {
  it('renames the class declaration and its constructor reference in the same file', () => {
    const content = `public class Cbact01cTasklet {\n    public Cbact01cTasklet() {}\n}\n`;
    const [result] = applyJavaRenames(
      [{ relativePath: 'Cbact01cTasklet.java', content }],
      [{ relativePath: 'Cbact01cTasklet.java', originalName: 'Cbact01cTasklet', targetName: 'AccountLoaderTasklet' }],
    );

    expect(result.content).toBe('public class AccountLoaderTasklet {\n    public AccountLoaderTasklet() {}\n}\n');
  });

  it('renames a method declaration and its same-file call site', () => {
    const content = `public class Foo {\n    public void execute() {\n        readFile();\n    }\n    private void readFile() {}\n}\n`;
    const [result] = applyJavaRenames(
      [{ relativePath: 'Foo.java', content }],
      [{ relativePath: 'Foo.java', originalName: 'readFile', targetName: 'loadAccountFile' }],
    );

    expect(result.content).toContain('loadAccountFile();');
    expect(result.content).toContain('private void loadAccountFile()');
    expect(result.content).not.toContain('readFile');
  });

  it('does not touch a file with no matching instruction', () => {
    const content = 'public class Untouched {}';
    const [result] = applyJavaRenames(
      [{ relativePath: 'Untouched.java', content }],
      [{ relativePath: 'Other.java', originalName: 'Foo', targetName: 'Bar' }],
    );
    expect(result.content).toBe(content);
  });

  it('only renames whole-word matches, not substrings inside another identifier', () => {
    const content = 'public class Account {\n    private AccountDetails details;\n}\n';
    const [result] = applyJavaRenames(
      [{ relativePath: 'Account.java', content }],
      [{ relativePath: 'Account.java', originalName: 'Account', targetName: 'Customer' }],
    );
    expect(result.content).toBe('public class Customer {\n    private AccountDetails details;\n}\n');
  });
});
