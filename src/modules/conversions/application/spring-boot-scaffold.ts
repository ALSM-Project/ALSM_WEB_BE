import type { ExcludedExportItem, ExportFileItem } from '../domain/export.types';
import { ALSM_RUNTIME_SOURCES } from './alsm-runtime-sources';

export interface JavaSourceFile {
  relativePath: string;
  content: string;
}

export interface SpringBootScaffoldInput {
  projectName: string;
  programs: { name: string; files: JavaSourceFile[] }[];
  excludedItems: ExcludedExportItem[];
  includeUnitTests: boolean;
  includeDocumentation: boolean;
}

const APPLICATION_PACKAGE = 'com.alsm.modernized';
const SPRING_BOOT_VERSION = '3.3.5';

/**
 * Generated code written against the converter's own runtime (Common) uses Spring Batch 4
 * (JobBuilderFactory, StepBuilderFactory) and javax.persistence, which only exist up to
 * Spring Boot 2.x. Such code is built on Spring Boot 2.4 / Java 11 instead of 3.3 / Java 21.
 */
const LEGACY_SPRING_BOOT_VERSION = '2.4.2';
const LEGACY_JAVA_VERSION = '11';
const LEGACY_RUNTIME_PREFIX = 'jp.co.alsm';

interface BuildProfile {
  legacy: boolean;
  springBoot: string;
  java: string;
  label: string;
}

const JOB_LISTENER_IMPORT = 'jp.co.alsm.config.BaseJobExecutionListener';
const JOB_LISTENER_PATH = 'src/main/java/jp/co/alsm/config/BaseJobExecutionListener.java';
const JOB_LISTENER_SOURCE = `package jp.co.alsm.config;

import org.springframework.batch.core.JobExecution;
import org.springframework.batch.core.JobExecutionListener;
import org.springframework.batch.core.configuration.annotation.JobScope;
import org.springframework.context.annotation.Primary;
import org.springframework.stereotype.Component;

/** Listener the generated jobs register; it does nothing by default - add job-level hooks here. */
@Primary
@Component
@JobScope
public class BaseJobExecutionListener implements JobExecutionListener {

  @Override
  public void beforeJob(JobExecution jobExecution) {
  }

  @Override
  public void afterJob(JobExecution jobExecution) {
  }
}
`;

function needsJobListener(files: JavaSourceFile[], placed: PlacedJavaFile[]): boolean {
  const provided = placed.some((f) => f.packageName === 'jp.co.alsm.config' && f.className === 'BaseJobExecutionListener');
  return !provided && files.some((f) => f.content.includes(JOB_LISTENER_IMPORT));
}

function detectProfile(files: JavaSourceFile[]): BuildProfile {
  const legacy = files.some((f) =>
    /\b(?:JobBuilderFactory|StepBuilderFactory)\b|javax\.persistence|\bjp\.co\.alsm\./.test(f.content),
  );
  return legacy
    ? {
        legacy,
        springBoot: LEGACY_SPRING_BOOT_VERSION,
        java: LEGACY_JAVA_VERSION,
        label: `Spring Boot 2.4 (Java ${LEGACY_JAVA_VERSION})`,
      }
    : { legacy, springBoot: SPRING_BOOT_VERSION, java: '21', label: 'Spring Boot 3.3 (Java 21)' };
}

/** Packages the generated code may import without anything extra on the classpath. */
const PROVIDED_PACKAGE_PREFIXES = [
  'java.',
  'javax.',
  'jakarta.',
  'org.springframework.',
  'lombok.',
  'org.slf4j.',
  'org.junit.',
];

interface PlacedJavaFile {
  /** Path inside the project, e.g. src/main/java/cobolprogramclasses/cbact02c/Cbact02cTasklet.java */
  path: string;
  packageName?: string;
  className?: string;
  content: string;
}

function kb(content: string): string {
  return `${(Buffer.byteLength(content, 'utf8') / 1024).toFixed(1)} KB`;
}

function fileItem(path: string, content: string, language?: ExportFileItem['language']): ExportFileItem {
  return {
    path,
    name: path.split('/').pop() ?? path,
    size: kb(content),
    type: 'file',
    ...(language ? { language } : {}),
    content,
  };
}

function packageOf(content: string): string | undefined {
  return /^\s*package\s+([A-Za-z_][\w.]*)\s*;/m.exec(content)?.[1];
}

function publicClassOf(content: string): string | undefined {
  return /^\s*public\s+(?:final\s+|abstract\s+)*class\s+([A-Za-z_]\w*)/m.exec(content)?.[1];
}

function basename(relativePath: string): string {
  return relativePath.replace(/\\/g, '/').split('/').pop() ?? relativePath;
}

/** Places each file where javac expects it: under the folder of its declared package. */
function placeJavaFile(file: JavaSourceFile): PlacedJavaFile {
  const packageName = packageOf(file.content);
  // javac needs the file to be named after its public class; the converter may name it after another one.
  const declaredClass = publicClassOf(file.content);
  const fileName = declaredClass ? `${declaredClass}.java` : basename(file.relativePath);
  const folder = packageName
    ? packageName.replace(/\./g, '/')
    : file.relativePath.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
  return {
    path: ['src/main/java', folder, fileName].filter(Boolean).join('/'),
    packageName,
    className: publicClassOf(file.content),
    content: file.content,
  };
}

/** Imports that are neither JDK/Spring/Lombok nor generated in this bundle - the partner
 * has to supply these libraries (e.g. the conversion runtime) before the project compiles. */
export function findExternalImports(files: JavaSourceFile[]): string[] {
  const bundlePackages = new Set(files.map((f) => packageOf(f.content)).filter(Boolean) as string[]);
  const external = new Set<string>();
  for (const file of files) {
    for (const match of file.content.matchAll(/^\s*import\s+(?:static\s+)?([A-Za-z_][\w.]*)(?:\.\*)?\s*;/gm)) {
      const imported = match[1];
      if (PROVIDED_PACKAGE_PREFIXES.some((prefix) => imported.startsWith(prefix))) continue;
      const parts = imported.split('.');
      const owner = parts.slice(0, -1).join('.');
      if (bundlePackages.has(owner) || bundlePackages.has(imported)) continue;
      // Report the library by its top three package segments (e.g. jp.co.fpt).
      external.add(parts.slice(0, Math.min(3, parts.length - 1)).join('.'));
    }
  }
  return [...external].sort();
}

function artifactIdOf(projectName: string): string {
  const slug = projectName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'modernized-app';
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Code written against the converter runtime carries the runtime's own sources. */
function usesEmbeddedRuntime(profile: BuildProfile, externalImports: string[]): boolean {
  return profile.legacy && externalImports.some((p) => p.startsWith(LEGACY_RUNTIME_PREFIX));
}

function pomXml(
  projectName: string,
  includeUnitTests: boolean,
  externalImports: string[],
  profile: BuildProfile,
): string {
  const embedsRuntime = usesEmbeddedRuntime(profile, externalImports);
  const stillExternal = externalImports.filter((p) => !(embedsRuntime && p.startsWith(LEGACY_RUNTIME_PREFIX)));
  // The runtime sources are part of this project (src/main/java/jp/co/alsm) and use JPA.
  const runtimeDependency = embedsRuntime
    ? `
    <!-- The bundled converter runtime (jp.co.alsm) uses JPA for its data access helpers. -->
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-data-jpa</artifactId>
    </dependency>`
    : '';
  const legacyProperty = profile.legacy
    ? `
    <!-- Spring Boot 2.4 manages a Lombok too old for JDK 17 and newer. -->
    <lombok.version>1.18.30</lombok.version>`
    : '';
  const externalNote = stillExternal.length
    ? `
    <!--
      The generated sources import these packages, which are not part of this bundle:
        ${stillExternal.join('\n        ')}
      Add the library that provides them (for example the conversion runtime jar) here
      before running "mvn package" - the build fails to compile until they resolve.
    -->`
    : '';
  const testDependency = includeUnitTests
    ? `
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-test</artifactId>
      <scope>test</scope>
    </dependency>`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>

  <parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>${profile.springBoot}</version>
    <relativePath/>
  </parent>

  <groupId>${APPLICATION_PACKAGE}</groupId>
  <artifactId>${artifactIdOf(projectName)}</artifactId>
  <version>1.0.0</version>
  <name>${xmlEscape(projectName)}</name>
  <description>COBOL programs modernized to Java by ALSM</description>

  <properties>
    <java.version>${profile.java}</java.version>${legacyProperty}
  </properties>

  <dependencies>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-batch</artifactId>
    </dependency>
    <!-- Spring Batch keeps its job repository in a database; H2 makes the app start out of the box. -->
    <dependency>
      <groupId>com.h2database</groupId>
      <artifactId>h2</artifactId>
      <scope>runtime</scope>
    </dependency>
    <dependency>
      <groupId>org.projectlombok</groupId>
      <artifactId>lombok</artifactId>
      <optional>true</optional>
    </dependency>${runtimeDependency}${testDependency}${externalNote}
  </dependencies>

  <build>
    <plugins>
      <plugin>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-maven-plugin</artifactId>
        <configuration>
          <excludes>
            <exclude>
              <groupId>org.projectlombok</groupId>
              <artifactId>lombok</artifactId>
            </exclude>
          </excludes>
        </configuration>
      </plugin>
    </plugins>
  </build>
</project>
`;
}

function applicationYml(projectName: string, profile: BuildProfile): string {
  return `spring:
  application:
    name: ${artifactIdOf(projectName)}
  batch:
${profile.legacy ? '    initialize-schema: always' : '    jdbc:\n      initialize-schema: always'}
    job:
      # Converted programs are Spring Batch tasklets; wire them into jobs before enabling this.
      enabled: false
  datasource:
    url: jdbc:h2:mem:batchdb;DB_CLOSE_DELAY=-1
    username: sa
    password:
`;
}

/**
 * Spring Batch 4 jobs (JobBuilderFactory) need @EnableBatchProcessing, and the app runs the job
 * named by its first argument: `java -jar app.jar Model01`.
 */
function legacyApplicationClass(scanPackages: string[]): string {
  const packages = [APPLICATION_PACKAGE, ...scanPackages.filter((p) => p !== APPLICATION_PACKAGE)];
  return `package ${APPLICATION_PACKAGE};

import org.springframework.batch.core.Job;
import org.springframework.batch.core.JobParametersBuilder;
import org.springframework.batch.core.configuration.annotation.EnableBatchProcessing;
import org.springframework.batch.core.launch.JobLauncher;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.CommandLineRunner;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.ApplicationContext;

@SpringBootApplication(scanBasePackages = {${packages.map((p) => `"${p}"`).join(', ')}})
@EnableBatchProcessing
public class ModernizedApplication implements CommandLineRunner {

  @Autowired
  private JobLauncher jobLauncher;

  @Autowired
  private ApplicationContext context;

  public static void main(String[] args) {
    SpringApplication.run(ModernizedApplication.class, args);
  }

  @Override
  public void run(String... args) throws Exception {
    if (args.length == 0) {
      return;
    }
    Job job = context.getBean(args[0], Job.class);
    jobLauncher.run(job, new JobParametersBuilder().addLong("run.id", System.currentTimeMillis()).toJobParameters());
  }
}
`;
}

function applicationClass(scanPackages: string[], profile: BuildProfile): string {
  if (profile.legacy) return legacyApplicationClass(scanPackages);
  const packages = [APPLICATION_PACKAGE, ...scanPackages.filter((p) => p !== APPLICATION_PACKAGE)];
  return `package ${APPLICATION_PACKAGE};

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication(scanBasePackages = {${packages.map((p) => `"${p}"`).join(', ')}})
public class ModernizedApplication {

  public static void main(String[] args) {
    SpringApplication.run(ModernizedApplication.class, args);
  }
}
`;
}

/** A smoke test per generated class: it only proves the class compiles and loads. */
function classTest(file: PlacedJavaFile): ExportFileItem | null {
  if (!file.className) return null;
  const qualified = file.packageName ? `${file.packageName}.${file.className}` : file.className;
  const folder = file.packageName ? file.packageName.replace(/\./g, '/') : '';
  const content = `${file.packageName ? `package ${file.packageName};\n\n` : ''}import static org.junit.jupiter.api.Assertions.assertNotNull;

import org.junit.jupiter.api.Test;

class ${file.className}Test {

  @Test
  void classIsOnTheClasspath() throws ClassNotFoundException {
    assertNotNull(Class.forName("${qualified}"));
  }
}
`;
  return fileItem(['src/test/java', folder, `${file.className}Test.java`].filter(Boolean).join('/'), content, 'java');
}

function readme(
  input: SpringBootScaffoldInput,
  externalImports: string[],
  classCount: number,
  profile: BuildProfile,
  embedsRuntime = false,
): string {
  const programList = input.programs.map((p) => `- ${p.name}`).join('\n') || '- none';
  const excluded = input.excludedItems.length
    ? `\n## Not included\n\n${input.excludedItems.map((i) => `- ${i.name}: ${i.reason}`).join('\n')}\n`
    : '';
  const external = externalImports.length
    ? `\n## Before you build\n\nThe generated code imports packages that are not part of this bundle:\n\n${externalImports
        .map((p) => `- \`${p}\``)
        .join('\n')}\n\nAdd the library that provides them to \`pom.xml\` (see the comment in its \`<dependencies>\`). Until then \`mvn package\` stops with "package does not exist" errors.\n`
    : '';
  const tests = input.includeUnitTests
    ? `\n## Run the tests\n\n\`\`\`bash\nmvn test\n\`\`\`\n\nEach generated class has a smoke test that only checks it compiles and loads. Verify the business behaviour against the original COBOL program before going to production.\n`
    : '';
  return `# ${input.projectName}

${profile.label} project generated by ALSM from the COBOL programs converted in this project. The files under \`src/main/java\` (other than \`${APPLICATION_PACKAGE.replace(/\./g, '/')}/ModernizedApplication.java\`) are the real conversion output - ${classCount} class(es) from:

${programList}
${excluded}${embedsRuntime ? '\n## Bundled runtime\n\nThe classes under `src/main/java/jp/co/alsm` are the converter runtime (`Console`, `Record`, `Compare`, `Logger`, ...) that the converted programs call. They are part of this project, so nothing needs to be installed before `mvn package`.\n' : ''}${external}
## Requirements

- JDK ${profile.java} or newer
- Maven 3.9 or newer

## Build

\`\`\`bash
mvn package
\`\`\`

## Run

\`\`\`bash
mvn spring-boot:run
\`\`\`

The converted programs are Spring Batch tasklets. \`application.yml\` keeps \`spring.batch.job.enabled: false\` so the app starts without running anything; define the jobs and steps that call each tasklet, then enable it.
${tests}`;
}

/** Runnable Spring Boot 3.3 project around real tool2java output (UC-48). */
export function buildSpringBootProjectTree(input: SpringBootScaffoldInput): ExportFileItem[] {
  const allFiles = input.programs.flatMap((p) => p.files);
  const profile = detectProfile(allFiles);
  // Programs converted in the same bundle can each carry a copy of a shared class; keep one.
  const placed = [...new Map(allFiles.map(placeJavaFile).map((f) => [f.path, f])).values()];
  const externalImports = findExternalImports(allFiles);
  const embedsRuntime = usesEmbeddedRuntime(profile, externalImports);
  const externalLeft = externalImports.filter((p) => !(embedsRuntime && p.startsWith(LEGACY_RUNTIME_PREFIX)));
  const addListener = profile.legacy && needsJobListener(allFiles, placed);
  const scanPackages = [
    ...new Set([
      ...(placed.map((f) => f.packageName?.split('.')[0]).filter(Boolean) as string[]),
      // The listener and the runtime's own components live under jp.co.alsm.
      ...(addListener ? ['jp.co.alsm'] : []),
    ]),
  ].sort();

  const children: ExportFileItem[] = [
    fileItem('pom.xml', pomXml(input.projectName, input.includeUnitTests, externalImports, profile)),
    fileItem('src/main/resources/application.yml', applicationYml(input.projectName, profile)),
    fileItem(
      `src/main/java/${APPLICATION_PACKAGE.replace(/\./g, '/')}/ModernizedApplication.java`,
      applicationClass(scanPackages, profile),
      'java',
    ),
    ...placed.map((f) => fileItem(f.path, f.content, 'java')),
  ];
  // The generated job classes hook into BaseJobExecutionListener, which belongs to the batch
  // runner rather than the runtime library, so a bundle that uses it has to carry it.
  if (addListener) {
    children.push(fileItem(JOB_LISTENER_PATH, JOB_LISTENER_SOURCE, 'java'));
  }
  // The shared runtime the generated code imports (Console, Record, Compare, ...), so the
  // project builds without installing a library first. A file the bundle already has wins.
  if (embedsRuntime) {
    const have = new Set(children.map((c) => c.path));
    for (const [relativePath, content] of Object.entries(ALSM_RUNTIME_SOURCES)) {
      const path = `src/main/java/${relativePath}`;
      if (!have.has(path)) children.push(fileItem(path, content, 'java'));
    }
  }
  if (input.includeUnitTests) {
    for (const file of placed) {
      const test = classTest(file);
      if (test) children.push(test);
    }
  }
  children.push(fileItem('.gitignore', 'target/\n.idea/\n*.iml\n.vscode/\n'));
  if (input.includeDocumentation) {
    children.push(fileItem('README.md', readme(input, externalLeft, placed.length, profile, embedsRuntime), 'markdown'));
  }

  return [
    {
      path: 'project-root',
      name: artifactIdOf(input.projectName),
      size: 'Root',
      type: 'dir',
      children: nest(children),
    },
  ];
}

/** Turns flat "a/b/c.java" items into the nested dir/file tree the zip writer expects. */
function nest(files: ExportFileItem[]): ExportFileItem[] {
  const root: ExportFileItem[] = [];
  for (const file of files) {
    const segments = file.path.split('/');
    let level = root;
    let prefix = '';
    for (const segment of segments.slice(0, -1)) {
      prefix = prefix ? `${prefix}/${segment}` : segment;
      let dir = level.find((i) => i.type === 'dir' && i.name === segment);
      if (!dir) {
        dir = { path: prefix, name: segment, size: '', type: 'dir', children: [] };
        level.push(dir);
      }
      dir.children = dir.children ?? [];
      level = dir.children;
    }
    level.push(file);
  }
  const label = (items: ExportFileItem[]): void => {
    for (const item of items) {
      if (item.type === 'dir' && item.children) {
        label(item.children);
        item.size = `${item.children.length} item(s)`;
      }
    }
  };
  label(root);
  return root;
}
