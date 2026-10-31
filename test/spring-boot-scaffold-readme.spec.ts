import {
  buildSpringBootProjectTree,
  findJobNames,
} from '../src/modules/conversions/application/spring-boot-scaffold';
import type { ExportFileItem } from '../src/modules/conversions/domain/export.types';

const flatten = (items: ExportFileItem[]): ExportFileItem[] =>
  items.flatMap((i) => (i.type === 'dir' ? flatten(i.children ?? []) : [i]));
const find = (items: ExportFileItem[], suffix: string) => flatten(items).find((f) => f.path.endsWith(suffix));

// Java the AKAMIG converter writes: a Job class named by @Bean(name = ...), and a Tasklet
// that calls a program (VSBABEND) which was not converted.
const jobClass = {
  relativePath: 'cobolprogramclasses/vbka1200/Vbka1200Job.java',
  content: `package cobolprogramclasses.vbka1200;

import org.springframework.batch.core.configuration.annotation.JobBuilderFactory;
import jp.co.alsm.config.BaseJobExecutionListener;

public class Vbka1200Job {
	@Bean(name ="Vbka1200" )
	public Job vbka1200() { return null; }
}`,
};
const tasklet = {
  relativePath: 'cobolprogramclasses/vbka1200/Vbka1200Tasklet.java',
  content: `package cobolprogramclasses.vbka1200;

import cobolprogramclasses.vsbabend.VsbabendTasklet;
import cobolprogramclasses.vsba2280.Vsba2280Tasklet;
import cobolprogramclasses.vbka1210.Vbka1210Tasklet;

public class Vbka1200Tasklet {
	private void callVsbabend() throws Exception {
		VsbabendTasklet t = new VsbabendTasklet();
	}
}`,
};
const converted = {
  relativePath: 'cobolprogramclasses/vbka1210/Vbka1210Tasklet.java',
  content: `package cobolprogramclasses.vbka1210;

public class Vbka1210Tasklet {
}`,
};

const base = { projectName: 'Acme', excludedItems: [], includeUnitTests: false, includeDocumentation: true };

describe('Java export: programs that are called but not converted', () => {
  const tree = buildSpringBootProjectTree({
    ...base,
    programs: [{ name: 'ALL', files: [jobClass, tasklet, converted] }],
  });

  it('writes a stand-in only for a called program that is not in the export', () => {
    const stub = find(tree, 'jp/co/alsm/batch/vsbabend/VsbabendTasklet.java');
    expect(stub?.content).toContain('package jp.co.alsm.batch.vsbabend;');
    expect(stub?.content).toContain('public class VsbabendTasklet');
    expect(stub?.content).toContain('COBOL program VSBABEND was not converted');
    expect(find(tree, 'jp/co/alsm/batch/vsba2280/Vsba2280Tasklet.java')).toBeDefined();
    // Vbka1210 is converted, so its own file is kept and no stand-in replaces it.
    expect(find(tree, 'jp/co/alsm/batch/vbka1210/Vbka1210Tasklet.java')?.content).toBe(
      converted.content.replace('cobolprogramclasses.', 'jp.co.alsm.batch.'),
    );
  });

  it('lists the stand-ins in the README so the reader knows what to convert next', () => {
    const readme = find(tree, 'README.md')?.content ?? '';
    expect(readme).toContain('Programs called but not converted');
    expect(readme).toContain('`VSBABEND`');
    expect(readme).toContain('`VSBA2280`');
    expect(readme).not.toContain('`VBKA1210`');
  });
});

describe('Java export README: how to run', () => {
  const tree = buildSpringBootProjectTree({ ...base, programs: [{ name: 'ALL', files: [jobClass, tasklet, converted] }] });
  const readme = find(tree, 'README.md')?.content ?? '';

  it('shows the commands with a real job name and the jobs that exist', () => {
    expect(readme).toContain('mvn spring-boot:run -Dspring-boot.run.arguments=Vbka1200');
    expect(readme).toContain('java -jar target/acme.jar Vbka1200');
    expect(readme).toContain('java -jar target/acme.jar\n');
    expect(readme).toContain('- `Vbka1200`');
    expect(readme).toContain('mvn clean package');
    expect(readme).toContain('status: [COMPLETED]');
  });

  it('explains which job runs without a name, the exit code, Config.properties and the in-memory database', () => {
    expect(readme).toContain('**No argument:** it runs the first job');
    expect(readme).toContain('exits - with code 0 only when the job ended `COMPLETED`');
    expect(readme).toContain('Config.properties');
    expect(readme).toContain('jdbc:h2:mem:batchdb');
    expect(readme).toContain('JDK 8 or newer (8, 11, 17 and 21 all work)');
    expect(readme).not.toContain('does nothing');
  });
});

describe('findJobNames', () => {
  it('reads @Bean(name = "...") and @Bean(JobConstants.X) job names but not step names', () => {
    const configuration = {
      relativePath: 'p/c/Cbact01cConfiguration.java',
      content: `@Bean(JobConstants.CBACT01C)\npublic Job job() {}`,
    };
    const constants = {
      relativePath: 'p/c/JobConstants.java',
      content: `public static final String CBACT01C = "cbact01c";\npublic static final String CBACT01C_STEP = "cbact01cStep";`,
    };
    const step = { relativePath: 'p/c/Step.java', content: `@Bean(JobConstants.CBACT01C_STEP)\nStep s() {}` };
    expect(findJobNames([jobClass, configuration, constants, step])).toEqual(['Vbka1200', 'cbact01c']);
  });

  it('returns nothing when no job is declared', () => {
    expect(findJobNames([converted])).toEqual([]);
  });
});
