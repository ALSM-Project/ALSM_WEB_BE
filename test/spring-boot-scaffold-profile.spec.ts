import {
  buildSpringBootProjectTree,
  normalizeBatchPackages,
} from '../src/modules/conversions/application/spring-boot-scaffold';
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

  it('builds code that uses Spring Batch 4 and the jp.co.alsm runtime on Spring Boot 2.7 for Java 8 to 21', () => {
    const pom = find(legacy, 'pom.xml')?.content ?? '';
    expect(pom).toContain('<version>2.7.18</version>');
    expect(pom).toContain('<java.version>1.8</java.version>');
    // Compiled against the Java 8 API on any newer JDK, so the jar also runs on Java 8.
    expect(pom).toContain('<maven.compiler.release>8</maven.compiler.release>');
    expect(pom).toContain('<lombok.version>1.18.38</lombok.version>');
    // JDK 23+ only runs annotation processors it is told about.
    expect(pom).toMatch(/<annotationProcessorPaths>[\s\S]*<artifactId>lombok<\/artifactId>/);
    // The runtime is bundled as source, so no external library dependency is needed - only JPA.
    expect(pom).not.toContain('<groupId>C2J</groupId>');
    expect(pom).toContain('spring-boot-starter-data-jpa');
    expect(find(legacy, 'application.yml')?.content).toMatch(/^ {4}jdbc:\n {6}initialize-schema: always/m);
    expect(find(legacy, 'README.md')?.content).toContain('Spring Boot 2.7 (Java 8 to 21)');
    // One executable jar with a predictable name.
    expect(pom).toContain('<finalName>acme</finalName>');
    expect(pom).toContain('spring-boot-maven-plugin');
  });

  it('moves every converted program to jp.co.alsm.batch.<program> and scans jp.co.alsm only', () => {
    expect(find(legacy, 'src/main/java/jp/co/alsm/batch/model01/Model01Job.java')?.content).toContain(
      'package jp.co.alsm.batch.model01;',
    );
    expect(flatten(legacy).some((f) => f.path.includes('cobolprogramclasses'))).toBe(false);
    const app = find(legacy, 'src/main/java/jp/co/alsm/BatchApplication.java')?.content ?? '';
    expect(app).toContain('package jp.co.alsm;');
    expect(app).toContain('scanBasePackages = {"jp.co.alsm"}');
    expect(find(legacy, 'ModernizedApplication.java')).toBeUndefined();
  });

  it('runs the named job, or the first job when none is named, and lists the jobs for a wrong name', () => {
    const app = find(legacy, 'BatchApplication.java')?.content ?? '';
    expect(app).toContain('@EnableBatchProcessing');
    expect(app).toContain('implements CommandLineRunner, ExitCodeGenerator');
    expect(app).toContain('context.getBeansOfType(Job.class)');
    expect(app).toContain('jobs.keySet().iterator().next()');
    expect(app).toContain('Jobs you can run: " + jobs.keySet()');
    expect(app).toContain('equalsIgnoreCase(requested)');
    expect(app).toContain('System.exit(SpringApplication.exit(');
  });

  it('writes Config.properties at the project root, packs it into the jar and lets a local copy override it', () => {
    const config = find(legacy, 'Config.properties');
    expect(config?.path).toBe('Config.properties');
    expect(config?.content).toContain('encoding = MS932');
    expect(config?.content).toContain('sqlDatabaseType = 1');
    expect(config?.content).toContain('programPackage = jp.co.alsm.batch');
    expect(find(legacy, 'pom.xml')?.content).toContain('<include>Config.properties</include>');
    expect(find(legacy, 'BatchApplication.java')?.content).toContain(
      '@PropertySource(value = {"classpath:Config.properties", "file:Config.properties"}, ignoreResourceNotFound = true)',
    );
  });

  it('supplies the BaseJobExecutionListener the jobs import and names each file after its public class', () => {
    expect(find(legacy, 'jp/co/alsm/config/BaseJobExecutionListener.java')).toBeDefined();
    expect(find(legacy, 'jp/co/alsm/batch/model01/Model01Model.java')?.content).toContain('class Model01Model');
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
    expect(find(tree, 'Config.properties')).toBeUndefined();
  });
});

describe('normalizeBatchPackages', () => {
  it('rewrites the converter package root in declarations, imports and qualified names', () => {
    const [file] = normalizeBatchPackages([
      {
        relativePath: 'cobolprogramclasses/a/ATasklet.java',
        content: 'package cobolprogramclasses.a;\nimport cobolprogramclasses.b.BTasklet;\nObject x = new cobolprogramclasses.b.BModel();',
      },
    ]);
    expect(file.content).toBe(
      'package jp.co.alsm.batch.a;\nimport jp.co.alsm.batch.b.BTasklet;\nObject x = new jp.co.alsm.batch.b.BModel();',
    );
  });

  it('leaves library packages and code already in jp.co.alsm alone', () => {
    const files = [
      { relativePath: 'x.java', content: 'package com.example;\nimport org.springframework.batch.core.Job;' },
      { relativePath: 'y.java', content: 'package jp.co.alsm.batch.model01;' },
    ];
    expect(normalizeBatchPackages(files)).toEqual(files);
  });
});
