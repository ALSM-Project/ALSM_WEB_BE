import { detectJavaMembers } from '../src/modules/conversions/infrastructure/java-member-detector.util';

describe('detectJavaMembers', () => {
  it('detects the real class name and public method names from a generated Tasklet', () => {
    const content = `
package cobolprogramclasses.cbact01c;

public class Cbact01cTasklet {

    public Cbact01cTasklet() {
    }

    public void execute() {
        readAccountFile();
    }

    private void readAccountFile() {
    }
}
`;
    const members = detectJavaMembers([{ relativePath: 'cobolprogramclasses/cbact01c/Cbact01cTasklet.java', content }]);

    expect(members).toEqual([
      { relativePath: 'cobolprogramclasses/cbact01c/Cbact01cTasklet.java', kind: 'CLASS', name: 'Cbact01cTasklet' },
      { relativePath: 'cobolprogramclasses/cbact01c/Cbact01cTasklet.java', kind: 'METHOD', name: 'execute' },
    ]);
  });

  it('does not report the constructor as a renameable method', () => {
    const content = `
public class Foo {
    public Foo() {}
    public void run() {}
}
`;
    const members = detectJavaMembers([{ relativePath: 'Foo.java', content }]);

    expect(members.filter((m) => m.kind === 'METHOD')).toEqual([
      { relativePath: 'Foo.java', kind: 'METHOD', name: 'run' },
    ]);
  });

  it('ignores non-.java files', () => {
    const members = detectJavaMembers([
      { relativePath: 'notes.txt', content: 'public class Foo { public void run() {} }' },
    ]);
    expect(members).toEqual([]);
  });

  it('never fabricates a name for a file with no recognizable class declaration', () => {
    const members = detectJavaMembers([{ relativePath: 'Empty.java', content: '// nothing here' }]);
    expect(members).toEqual([]);
  });

  it('does not duplicate a method name seen more than once in the same file', () => {
    const content = `
public class Foo {
    public void run() {}
    public void run(String arg) {}
}
`;
    const members = detectJavaMembers([{ relativePath: 'Foo.java', content }]);
    expect(members.filter((m) => m.kind === 'METHOD')).toHaveLength(1);
  });
});
