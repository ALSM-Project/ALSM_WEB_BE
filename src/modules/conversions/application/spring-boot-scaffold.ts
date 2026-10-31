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
 * Spring Boot 2.x. Such code is built on Spring Boot 2.7 - the last 2.x line, which runs on
 * Java 8 up to 21 - instead of 3.3 / Java 21.
 */
const LEGACY_SPRING_BOOT_VERSION = '2.7.18';
const LEGACY_JAVA_VERSION = '1.8';
const LEGACY_RUNTIME_PREFIX = 'jp.co.alsm';
/** Lombok release that understands JDK 8 through 24; older ones break getters/setters on new JDKs. */
const LOMBOK_VERSION = '1.18.38';

/** Every converted program lives in jp.co.alsm.batch.<program>, next to jp.co.alsm.common/config. */
const BATCH_PACKAGE = 'jp.co.alsm.batch';
const LEGACY_APPLICATION_PACKAGE = 'jp.co.alsm';
const LEGACY_APPLICATION_CLASS = 'BatchApplication';
/** Package roots that belong to libraries, never to the converter's -pp/-dp output. */
const LIBRARY_ROOTS = new Set(['com', 'org', 'net', 'io', 'java', 'javax', 'jakarta', 'jp', 'lombok']);

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
        label: 'Spring Boot 2.7 (Java 8 to 21)',
      }
    : { legacy, springBoot: SPRING_BOOT_VERSION, java: '21', label: 'Spring Boot 3.3 (Java 21)' };
}

/**
 * The converter writes each program to <root>.<program> where <root> is whatever -pp/-dp it was
 * given (cobolprogramclasses on this platform). Spring has to scan the same packages it was told
 * about, so the export moves every program to jp.co.alsm.batch.<program> - package declarations,
 * imports and fully qualified names alike - and scans jp.co.alsm only.
 */
export function normalizeBatchPackages(files: JavaSourceFile[]): JavaSourceFile[] {
  const roots = new Set<string>();
  for (const file of files) {
    const match = /^([a-z]\w*)\.[a-z0-9_]\w*$/.exec(packageOf(file.content) ?? '');
    if (match && !LIBRARY_ROOTS.has(match[1])) roots.add(match[1]);
  }
  if (roots.size === 0) return files;
  const pattern = new RegExp(`(^|[^\\w.])(?:${[...roots].join('|')})\\.(?=[a-z0-9_])`, 'gm');
  return files.map((file) => ({
    relativePath: file.relativePath,
    content: file.content.replace(pattern, `$1${BATCH_PACKAGE}.`),
  }));
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

/** A program the converted code calls but that was not part of the conversion. */
interface CalledProgram {
  packageName: string;
  className: string;
  programName: string;
}

/**
 * Converted programs call each other through `import <root>.<program>.<Program>Tasklet`. When the
 * called program was not converted, that import points at nothing and the whole project fails to
 * compile - so a stand-in class is written that fails with a clear message only if it is called.
 */
function findMissingCalledPrograms(files: JavaSourceFile[], placed: PlacedJavaFile[]): CalledProgram[] {
  const provided = new Set(placed.map((f) => `${f.packageName}.${f.className}`));
  const roots = new Set(placed.map((f) => f.packageName?.split('.')[0]).filter(Boolean) as string[]);
  const missing = new Map<string, CalledProgram>();
  for (const file of files) {
    for (const match of file.content.matchAll(/^\s*import\s+([a-z][\w]*(?:\.[a-z][\w]*)+)\.([A-Z]\w*Tasklet)\s*;/gm)) {
      const [, packageName, className] = match;
      if (!roots.has(packageName.split('.')[0]) || provided.has(`${packageName}.${className}`)) continue;
      const programName = (packageName.split('.').pop() ?? className).toUpperCase();
      missing.set(`${packageName}.${className}`, { packageName, className, programName });
    }
  }
  return [...missing.values()].sort((a, b) => a.programName.localeCompare(b.programName));
}

function calledProgramStub(program: CalledProgram): string {
  return `package ${program.packageName};

/** Stand-in for the COBOL program ${program.programName}, which was not part of this conversion. */
public class ${program.className} {

  public Object execute(Object... arguments) throws Exception {
    throw new UnsupportedOperationException(
        "COBOL program ${program.programName} was not converted, so it cannot be called. "
            + "Convert it as well and add it to this project.");
  }
}
`;
}

/** Names the jobs can be started by: the bean names of the generated Job classes. */
export function findJobNames(files: JavaSourceFile[]): string[] {
  const constants = new Map<string, string>();
  for (const file of files) {
    for (const m of file.content.matchAll(/static\s+final\s+String\s+(\w+)\s*=\s*"([^"]+)"/g)) constants.set(m[1], m[2]);
  }
  const names = new Set<string>();
  for (const file of files) {
    for (const m of file.content.matchAll(/@Bean\(\s*name\s*=\s*"([^"]+)"\s*\)/g)) names.add(m[1]);
    for (const m of file.content.matchAll(/@Bean\(\s*\w+\.(\w+)\s*\)/g)) {
      const value = constants.get(m[1]);
      if (value && !value.endsWith('Step') && !m[1].endsWith('_STEP')) names.add(value);
    }
  }
  return [...names].sort();
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
  const lombokProperty = `
    <!-- The Lombok Spring Boot manages is too old for the newest JDKs. -->
    <lombok.version>${LOMBOK_VERSION}</lombok.version>`;
  // On JDK 9+ "release" also checks the code only uses Java 8 APIs, so the jar runs on Java 8 too;
  // JDK 8 itself has no --release flag and compiles with source/target 1.8.
  const legacyBuild = profile.legacy
    ? `
  <profiles>
    <profile>
      <id>release-8</id>
      <activation>
        <jdk>[9,)</jdk>
      </activation>
      <properties>
        <maven.compiler.release>8</maven.compiler.release>
      </properties>
    </profile>
  </profiles>`
    : '';
  // Config.properties sits at the project root for editing and is also packed into the jar.
  const configResource = profile.legacy
    ? `
    <resources>
      <resource>
        <directory>src/main/resources</directory>
      </resource>
      <resource>
        <directory>\${project.basedir}</directory>
        <includes>
          <include>Config.properties</include>
        </includes>
      </resource>
    </resources>`
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
    <java.version>${profile.java}</java.version>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>${lombokProperty}
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
    <!-- target/${artifactIdOf(projectName)}.jar is one executable jar with every dependency inside. -->
    <finalName>${artifactIdOf(projectName)}</finalName>${configResource}
    <plugins>
      <!-- Naming Lombok as the annotation processor keeps getters/setters generated on JDK 23+,
           which no longer runs processors found on the classpath. -->
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-compiler-plugin</artifactId>
        <configuration>
          <annotationProcessorPaths>
            <path>
              <groupId>org.projectlombok</groupId>
              <artifactId>lombok</artifactId>
              <version>\${lombok.version}</version>
            </path>
          </annotationProcessorPaths>
        </configuration>
      </plugin>
      <plugin>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-maven-plugin</artifactId>
        <!-- spring-boot-starter-parent binds "repackage" to mvn package: it nests every dependency in the jar. -->
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
  </build>${legacyBuild}
</project>
`;
}

/** Converter settings plus the defaults the runtime reads; a copy next to the jar overrides them. */
function configProperties(): string {
  return `# Settings of the COBOL to Java conversion this project came from.
# BatchApplication loads this file from the jar and, if present, from the working directory -
# edit the copy next to the jar to change a value without rebuilding.

# Packages the converted programs and their data records were written to.
programPackage = ${BATCH_PACKAGE}
dataPackage = ${BATCH_PACKAGE}

# Character set of the data files the programs read and write (Shift_JIS on Windows).
encoding = MS932
isEbcdicMachine = false
isFixedFormat = true

# Database the generated SQL targets: 1-Oracle, 2-Sybase, 3-Informix, 4-DB2, 5-SQL Server,
# 6-MS Access, 7-Sybase SQL Anywhere, 8-MySQL.
sqlDatabaseType = 1

# Database Spring Batch keeps its job history in. H2 runs in memory and needs nothing installed;
# to use another one change spring.datasource in src/main/resources/application.yml.
database.type = H2
`;
}

function applicationYml(projectName: string, profile: BuildProfile): string {
  return `spring:
  application:
    name: ${artifactIdOf(projectName)}
  batch:
    jdbc:
      initialize-schema: always${profile.legacy ? '\n      # The runtime brings JPA; JPA cannot take the stricter lock Spring Batch asks for by default.\n      isolation-level-for-create: default' : ''}
    job:
      # ${profile.legacy ? `${LEGACY_APPLICATION_CLASS} decides which job runs, so Spring Boot must not start them all.` : 'Converted programs are Spring Batch tasklets; wire them into jobs before enabling this.'}
      enabled: false
  datasource:
    url: jdbc:h2:mem:batchdb;DB_CLOSE_DELAY=-1
    username: sa
    password:
`;
}

/**
 * Spring Batch 4 jobs (JobBuilderFactory) need @EnableBatchProcessing. The app runs the job named
 * by its first argument (`java -jar app.jar Model01`) or, without one, the first job it finds, then
 * exits with 0 only when that job COMPLETED. A wrong name lists the jobs that do exist.
 */
function legacyApplicationClass(scanPackages: string[]): string {
  const packages = [
    LEGACY_APPLICATION_PACKAGE,
    ...scanPackages.filter((p) => p !== LEGACY_APPLICATION_PACKAGE && !p.startsWith(`${LEGACY_APPLICATION_PACKAGE}.`)),
  ];
  return `package ${LEGACY_APPLICATION_PACKAGE};

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

import org.springframework.batch.core.BatchStatus;
import org.springframework.batch.core.Job;
import org.springframework.batch.core.JobExecution;
import org.springframework.batch.core.JobParametersBuilder;
import org.springframework.batch.core.configuration.annotation.EnableBatchProcessing;
import org.springframework.batch.core.launch.JobLauncher;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.CommandLineRunner;
import org.springframework.boot.ExitCodeGenerator;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.ApplicationContext;
import org.springframework.context.annotation.PropertySource;

@SpringBootApplication(scanBasePackages = {${packages.map((p) => `"${p}"`).join(', ')}})
@EnableBatchProcessing
@PropertySource(value = {"classpath:Config.properties", "file:Config.properties"}, ignoreResourceNotFound = true)
public class ${LEGACY_APPLICATION_CLASS} implements CommandLineRunner, ExitCodeGenerator {

  @Autowired
  private JobLauncher jobLauncher;

  @Autowired
  private ApplicationContext context;

  private int exitCode;

  public static void main(String[] args) {
    System.exit(SpringApplication.exit(SpringApplication.run(${LEGACY_APPLICATION_CLASS}.class, args)));
  }

  @Override
  public void run(String... args) throws Exception {
    Map<String, Job> jobs = new TreeMap<>(context.getBeansOfType(Job.class));
    if (jobs.isEmpty()) {
      System.err.println("No Spring Batch job was found under the scanned packages " + scanned() + ".");
      exitCode = 1;
      return;
    }
    String requested = firstJobArgument(args);
    String name = requested == null ? jobs.keySet().iterator().next() : findJob(jobs, requested);
    if (name == null) {
      System.err.println("There is no job named \\"" + requested + "\\". Jobs you can run: " + jobs.keySet());
      exitCode = 2;
      return;
    }
    if (requested == null && jobs.size() > 1) {
      System.out.println("No job name given, running " + name + ". Jobs you can run: " + jobs.keySet());
    }
    JobExecution execution = jobLauncher.run(jobs.get(name),
        new JobParametersBuilder().addLong("run.id", System.currentTimeMillis()).toJobParameters());
    System.out.println("Job " + name + " finished with status " + execution.getStatus());
    exitCode = execution.getStatus() == BatchStatus.COMPLETED ? 0 : 1;
  }

  @Override
  public int getExitCode() {
    return exitCode;
  }

  /** The job name is the first argument that is not a Spring option such as --server.port=0. */
  private static String firstJobArgument(String... args) {
    for (String arg : args) {
      if (!arg.startsWith("-")) {
        return arg;
      }
    }
    return null;
  }

  /** Exact bean name first, then ignoring case, so "model01" finds the job "Model01". */
  private static String findJob(Map<String, Job> jobs, String requested) {
    if (jobs.containsKey(requested)) {
      return requested;
    }
    for (String name : jobs.keySet()) {
      if (name.equalsIgnoreCase(requested)) {
        return name;
      }
    }
    return null;
  }

  private static List<String> scanned() {
    List<String> packages = new ArrayList<>();
    for (String p : ${LEGACY_APPLICATION_CLASS}.class.getAnnotation(SpringBootApplication.class).scanBasePackages()) {
      packages.add(p);
    }
    return packages;
  }
}
`;
}

function applicationClassPath(profile: BuildProfile): string {
  return profile.legacy
    ? `src/main/java/${LEGACY_APPLICATION_PACKAGE.replace(/\./g, '/')}/${LEGACY_APPLICATION_CLASS}.java`
    : `src/main/java/${APPLICATION_PACKAGE.replace(/\./g, '/')}/ModernizedApplication.java`;
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
  jobNames: string[] = [],
  calledPrograms: CalledProgram[] = [],
): string {
  const exampleJob = jobNames[0] ?? '<jobName>';
  const jobList = jobNames.length
    ? jobNames.map((name) => `- \`${name}\``).join('\n')
    : '- (no job names could be read from the generated code; look for the `@Bean` methods in the `*Job` or `*Configuration` classes)';
  const notConverted = calledPrograms.length
    ? `\n## Programs called but not converted\n\nThese COBOL programs are called by the converted ones but were not part of the conversion. Each has a stand-in class that fails with a clear message if it is reached; convert the program too and replace the stand-in:\n\n${calledPrograms
        .map((p) => `- \`${p.programName}\` (\`${p.packageName}.${p.className}\`)`)
        .join('\n')}\n`
    : '';
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
  const javaVersion = profile.java === '1.8' ? '8' : profile.java;
  const jar = `target/${artifactIdOf(input.projectName)}.jar`;
  const run = profile.legacy
    ? `The application starts the Spring context, runs one job and exits - with code 0 only when the job ended \`COMPLETED\`.

- **No argument:** it runs the first job (by name). If there are several it also prints the names of the others.
- **A job name as the first argument:** it runs that job. The name is not case sensitive (\`model01\` finds \`Model01\`); a name that does not exist prints the list of jobs you can run.

\`\`\`bash
java -jar ${jar}
java -jar ${jar} ${exampleJob}
\`\`\`

or without building the jar first:

\`\`\`bash
mvn spring-boot:run -Dspring-boot.run.arguments=${exampleJob}
\`\`\`

The jar is self-contained (every dependency is inside), so it can be copied to any machine with Java ${javaVersion} or newer.`
    : `The application starts the Spring context and then runs the job whose name you pass as the first argument. Without a name it starts and does nothing (\`spring.batch.job.enabled\` is \`false\` on purpose: otherwise every job would run at start-up).

\`\`\`bash
mvn spring-boot:run -Dspring-boot.run.arguments=${exampleJob}
\`\`\`

or, after \`mvn package\`:

\`\`\`bash
java -jar ${jar} ${exampleJob}
\`\`\``;
  const config = profile.legacy
    ? `\n- **Config.properties** (in this folder) holds the conversion settings - packages, \`encoding = MS932\`, \`sqlDatabaseType\` - and is packed into the jar. A \`Config.properties\` in the folder you run \`java -jar\` from overrides it, so values can change without rebuilding.\n- **Packages:** every converted program is in \`${BATCH_PACKAGE}.<program>\`; the runtime is in \`jp.co.alsm.common\`, \`jp.co.alsm.helper\`, \`jp.co.alsm.config\`. \`${LEGACY_APPLICATION_CLASS}\` scans \`jp.co.alsm\`, so a class moved elsewhere is not found.`
    : '';
  return `# ${input.projectName}

${profile.label} project generated by ALSM from the COBOL programs converted in this project. The files under \`src/main/java\` (other than \`${applicationClassPath(profile).replace('src/main/java/', '')}\`) are the real conversion output - ${classCount} class(es) from:

${programList}
${excluded}${embedsRuntime ? '\n## Bundled runtime\n\nThe classes under `src/main/java/jp/co/alsm` are the converter runtime (`Console`, `Record`, `Compare`, `Logger`, `PropertiesHelper`, ...) that the converted programs call. They are part of this project, so nothing needs to be installed before `mvn package`.\n' : ''}${external}
## Requirements

- JDK ${javaVersion} or newer${profile.legacy ? ' (8, 11, 17 and 21 all work)' : ''}
- Maven 3.9 or newer

## Build

\`\`\`bash
mvn clean package
\`\`\`

## Run

${run}

Jobs you can start:

${jobList}

A finished run ends with a log line containing \`status: [COMPLETED]\`.

## Quick start

1. Install JDK ${javaVersion} or newer and Maven 3.9 or newer (\`java -version\`, \`mvn -version\`).
2. In this folder run \`mvn clean package\` - it compiles the code and runs the smoke tests.
3. Run a job as shown above.

## Good to know

- **Database:** Spring Batch keeps its job history in an in-memory H2 database (\`jdbc:h2:mem:batchdb\`), so nothing needs to be installed. It is lost when the program stops. To use your own database, change \`spring.datasource\` in \`src/main/resources/application.yml\` and add its driver to \`pom.xml\`.
- **Running the same job twice** is fine: every run gets its own run id.
- **Output** of the converted programs (\`DISPLAY\`) is printed to the console.${config}
- **"package does not exist" while compiling:** the project is incomplete - make sure you opened the whole folder, not a single file, and that Maven finished downloading dependencies.
${notConverted}${tests}`;
}

/** Runnable Spring Boot 3.3 project around real tool2java output (UC-48). */
export function buildSpringBootProjectTree(input: SpringBootScaffoldInput): ExportFileItem[] {
  const converted = input.programs.flatMap((p) => p.files);
  // Decided on the converter's own packages: after normalizing every file mentions jp.co.alsm.
  const profile = detectProfile(converted);
  const allFiles = normalizeBatchPackages(converted);
  // Programs converted in the same bundle can each carry a copy of a shared class; keep one.
  const placed = [...new Map(allFiles.map(placeJavaFile).map((f) => [f.path, f])).values()];
  const externalImports = findExternalImports(allFiles);
  const embedsRuntime = usesEmbeddedRuntime(profile, externalImports);
  const externalLeft = externalImports.filter((p) => !(embedsRuntime && p.startsWith(LEGACY_RUNTIME_PREFIX)));
  const addListener = profile.legacy && needsJobListener(allFiles, placed);
  const scanPackages = [
    ...new Set([
      ...(placed
        .map((f) => f.packageName)
        .filter((p): p is string => Boolean(p))
        // Programs, the runtime and the listener all live under jp.co.alsm.
        .map((p) => (p === LEGACY_RUNTIME_PREFIX || p.startsWith(`${LEGACY_RUNTIME_PREFIX}.`) ? LEGACY_RUNTIME_PREFIX : p.split('.')[0]))),
      ...(addListener ? [LEGACY_RUNTIME_PREFIX] : []),
    ]),
  ].sort();

  const children: ExportFileItem[] = [
    fileItem('pom.xml', pomXml(input.projectName, input.includeUnitTests, externalImports, profile)),
    fileItem('src/main/resources/application.yml', applicationYml(input.projectName, profile)),
    fileItem(applicationClassPath(profile), applicationClass(scanPackages, profile), 'java'),
    ...placed.map((f) => fileItem(f.path, f.content, 'java')),
  ];
  if (profile.legacy) {
    children.push(fileItem('Config.properties', configProperties()));
  }
  // The generated job classes hook into BaseJobExecutionListener, which belongs to the batch
  // runner rather than the runtime library, so a bundle that uses it has to carry it.
  if (addListener) {
    children.push(fileItem(JOB_LISTENER_PATH, JOB_LISTENER_SOURCE, 'java'));
  }
  // The shared runtime the generated code imports (Console, Record, Compare, ...), so the
  // project builds without installing a library first. A file the bundle already has wins.
  const calledPrograms = findMissingCalledPrograms(allFiles, placed);
  for (const program of calledPrograms) {
    const path = `src/main/java/${program.packageName.replace(/\./g, '/')}/${program.className}.java`;
    children.push(fileItem(path, calledProgramStub(program), 'java'));
  }
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
    children.push(fileItem('README.md', readme(input, externalLeft, placed.length, profile, embedsRuntime, findJobNames(allFiles), calledPrograms), 'markdown'));
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
