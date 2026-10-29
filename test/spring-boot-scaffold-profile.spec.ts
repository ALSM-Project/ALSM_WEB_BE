import { buildSpringBootProjectTree } from '../src/modules/conversions/application/spring-boot-scaffold';
import type { ExportFileItem } from '../src/modules/conversions/domain/export.types';

const flatten = (items: ExportFileItem[]): ExportFileItem[] =>
  items.flatMap((i) => (i.type === 'dir' ? flatten(i.children ?? []) : [i]));
const find = (items: ExportFileItem[], suffix: string) => flatten(items).find((f) => f.path.endsWith(suffix));

// Shape of the Java the AKAMIG converter writes: Spring Batch 4 jobs on the converter's runtime.
const job = `package cobolprogramclasses.model01;

import org.springframework.batch.core.configuration.annotation.JobBuilderFactory;
import jp.co.alsm.config.BaseJobExecutionListener;

public class Model01Job {
}`;
// The converter writes this class into a file named after another class.
const model = {
  relativePath: 'cobolprogramclasses/model01/TimeArea_1Tasklet.java',
  content: `package cobolprogramclasses.model01;

import jp.co.alsm.common.Record;

public class Model01Model {
}`,
};

// Shape of the Java the older tool2java converter writes: Spring Batch 5 builders.
const modernTasklet = {
  relativePath: 'cobolprogramclasses/cbact01c/Cbact01cTasklet.java',
  content: `package cobolprogramclasses.cbact01c;

import org.springframework.batch.core.job.builder.JobBuilder;

public class Cbact01cTasklet {
}`,
};

const base = { projectName: 'Acme', excludedItems: [], includeUnitTests: true, includeDocumentation: true };

describe('Spring Boot scaffold build profile', () => {
  const legacy = buildSpringBootProjectTree({
    ...base,
    programs: [{ name: 'MODEL01', files: [{ relativePath: 'cobolprogramclasses/model01/Model01Job.java', content: job }, model] }],
  });

  it('builds code that uses Spring Batch 4 and the jp.co.alsm runtime on Spring Boot 2.4 and Java 11', () => {
    const pom = find(legacy, 'pom.xml')?.content ?? '';
    expect(pom).toContain('<version>2.4.2</version>');
    expect(pom).toContain('<java.version>11</java.version>');
    expect(pom).toContain('<lombok.version>1.18.30</lombok.version>');
    // The runtime is bundled as source, so no external library dependency is needed - only JPA.
    expect(pom).not.toContain('<groupId>C2J</groupId>');
    expect(pom).toContain('spring-boot-starter-data-jpa');
    expect(find(legacy, 'application.yml')?.content).toContain('initialize-schema: always');
    expect(find(legacy, 'application.yml')?.content).not.toMatch(/^ {4}jdbc:/m);
    expect(find(legacy, 'README.md')?.content).toContain('Spring Boot 2.4 (Java 11)');
  });

  it('enables batch processing, runs the job named on the command line and scans the runtime package', () => {
    const app = find(legacy, 'ModernizedApplication.java')?.content ?? '';
    expect(app).toContain('@EnableBatchProcessing');
    expect(app).toContain('CommandLineRunner');
    expect(app).toContain('"jp.co.alsm"');
  });

  it('supplies the BaseJobExecutionListener the jobs import and names each file after its public class', () => {
    expect(find(legacy, 'jp/co/alsm/config/BaseJobExecutionListener.java')).toBeDefined();
    expect(find(legacy, 'cobolprogramclasses/model01/Model01Model.java')?.content).toContain('class Model01Model');
    expect(find(legacy, 'TimeArea_1Tasklet.java')).toBeUndefined();
  });

  it('carries the converter runtime as source so the project builds with nothing installed', () => {
    const runtimeFiles = flatten(legacy).filter((f) => f.path.includes('src/main/java/jp/co/alsm/'));
    const paths = runtimeFiles.map((f) => f.path.split('src/main/java/')[1]);
    expect(paths).toEqual(
      expect.arrayContaining([
        'jp/co/alsm/common/Console.java',
        'jp/co/alsm/common/Record.java',
        'jp/co/alsm/common/FileRecord.java',
        'jp/co/alsm/common/Constant.java',
        'jp/co/alsm/helper/Compare.java',
        'jp/co/alsm/helper/StringHelper.java',
        'jp/co/alsm/logging/Logger.java',
        'jp/co/alsm/config/ApplicationContextProvider.java',
        'jp/co/alsm/config/BaseJobExecutionListener.java',
      ]),
    );
    expect(find(legacy, 'jp/co/alsm/common/Console.java')?.content).toContain('package jp.co.alsm.common;');
    expect(find(legacy, 'README.md')?.content).toContain('Bundled runtime');
    expect(find(legacy, 'README.md')?.content).not.toContain('Before you build');
  });

  it('keeps Spring Boot 3.3 and Java 21 for code written against Spring Batch 5', () => {
    const tree = buildSpringBootProjectTree({ ...base, programs: [{ name: 'CBACT01C', files: [modernTasklet] }] });
    const pom = find(tree, 'pom.xml')?.content ?? '';
    expect(pom).toContain('<version>3.3.5</version>');
    expect(pom).toContain('<java.version>21</java.version>');
    expect(pom).not.toContain('spring-boot-starter-data-jpa');
    expect(find(tree, 'application.yml')?.content).toMatch(/^ {4}jdbc:/m);
    expect(find(tree, 'ModernizedApplication.java')?.content).not.toContain('@EnableBatchProcessing');
    expect(find(tree, 'BaseJobExecutionListener.java')).toBeUndefined();
  });
});
