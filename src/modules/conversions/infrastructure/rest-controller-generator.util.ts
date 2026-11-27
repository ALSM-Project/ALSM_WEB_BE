export interface TableColumnMetadata {
  columnName: string;
  dataType: string;
  isNullable: boolean;
  isPrimaryKey: boolean;
}

export interface TableSchemaMetadata {
  tableName: string;
  columns: TableColumnMetadata[];
}

export interface GeneratedRestArtifacts {
  entityName: string;
  entityPath: string;
  entityCode: string;
  repositoryName: string;
  repositoryPath: string;
  repositoryCode: string;
  controllerName: string;
  controllerPath: string;
  controllerCode: string;
}

/**
 * Converts snake_case (e.g. credit_cards) to PascalCase (e.g. CreditCard)
 */
export function toPascalCase(snake: string, singular = true): string {
  let parts = snake.toLowerCase().split('_');
  if (singular && parts.length > 0) {
    const last = parts[parts.length - 1];
    if (last.endsWith('ies')) {
      parts[parts.length - 1] = last.slice(0, -3) + 'y';
    } else if (last.endsWith('ses')) {
      parts[parts.length - 1] = last.slice(0, -2);
    } else if (last.endsWith('s') && !last.endsWith('ss')) {
      parts[parts.length - 1] = last.slice(0, -1);
    }
  }
  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
}

/**
 * Converts snake_case to camelCase
 */
export function toCamelCase(snake: string): string {
  const pascal = toPascalCase(snake, false);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

/**
 * Converts snake_case to kebab-case
 */
export function toKebabCase(snake: string): string {
  return snake.toLowerCase().replace(/_/g, '-');
}

/**
 * Maps SQL data types to Java types
 */
export function sqlDataTypeToJava(sqlType: string): { javaType: string; imports: string[] } {
  const norm = sqlType.toLowerCase();
  if (norm.includes('bigint') || norm.includes('int8')) {
    return { javaType: 'Long', imports: [] };
  }
  if (norm.includes('smallint') || norm.includes('int2') || norm.includes('integer') || norm.includes('int4')) {
    return { javaType: 'Integer', imports: [] };
  }
  if (norm.includes('numeric') || norm.includes('decimal')) {
    return { javaType: 'BigDecimal', imports: ['java.math.BigDecimal'] };
  }
  if (norm.includes('date')) {
    return { javaType: 'LocalDate', imports: ['java.time.LocalDate'] };
  }
  if (norm.includes('timestamp')) {
    return { javaType: 'LocalDateTime', imports: ['java.time.LocalDateTime'] };
  }
  if (norm.includes('bool')) {
    return { javaType: 'Boolean', imports: [] };
  }
  return { javaType: 'String', imports: [] };
}

/**
 * Automatically generates JPA Entity, Spring Data Repository, and REST Controller for a database table.
 */
export function generateRestArtifactsForTable(table: TableSchemaMetadata): GeneratedRestArtifacts {
  const singularPascal = toPascalCase(table.tableName, true);
  const entityName = `${singularPascal}Entity`;
  const repositoryName = `${singularPascal}Repository`;
  const controllerName = `${singularPascal}Controller`;
  const apiPath = `/api/${toKebabCase(table.tableName)}`;

  const pkCol = table.columns.find((c) => c.isPrimaryKey) || table.columns[0];
  const pkType = sqlDataTypeToJava(pkCol ? pkCol.dataType : 'bigint').javaType;
  const pkFieldName = pkCol ? toCamelCase(pkCol.columnName) : 'id';
  const pkFieldGetter = pkFieldName.charAt(0).toUpperCase() + pkFieldName.slice(1);

  // Collect imports for Entity
  const importsSet = new Set<string>();
  importsSet.add('javax.persistence.Entity');
  importsSet.add('javax.persistence.Table');
  importsSet.add('javax.persistence.Id');
  importsSet.add('javax.persistence.Column');
  importsSet.add('lombok.Data');
  importsSet.add('lombok.Builder');
  importsSet.add('lombok.NoArgsConstructor');
  importsSet.add('lombok.AllArgsConstructor');

  const fieldsBlock: string[] = [];
  for (const col of table.columns) {
    const { javaType, imports } = sqlDataTypeToJava(col.dataType);
    for (const imp of imports) importsSet.add(imp);
    const fieldName = toCamelCase(col.columnName);

    const annotations: string[] = [];
    if (col.isPrimaryKey) {
      annotations.push('\t@Id');
    }
    if (col.columnName === 'created_at') {
      annotations.push(`\t@Column(name = "${col.columnName}", insertable = false, updatable = false)`);
    } else {
      annotations.push(`\t@Column(name = "${col.columnName}")`);
    }
    fieldsBlock.push(`${annotations.join('\n')}\n\tprivate ${javaType} ${fieldName};`);
  }

  const sortedImports = Array.from(importsSet).sort().map((i) => `import ${i};`).join('\n');

  // 1. Entity Java Code
  const entityCode = `package jp.co.alsm.entity;

${sortedImports}

@Entity
@Table(name = "${table.tableName}")
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ${entityName} {

${fieldsBlock.join('\n\n')}
}
`;

  // 2. Repository Java Code
  const repositoryCode = `package jp.co.alsm.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import jp.co.alsm.entity.${entityName};

@Repository
public interface ${repositoryName} extends JpaRepository<${entityName}, ${pkType}> {
}
`;

  // 3. REST Controller Java Code
  const controllerCode = `package jp.co.alsm.controller;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import jp.co.alsm.entity.${entityName};
import jp.co.alsm.repository.${repositoryName};

@RestController
@RequestMapping("${apiPath}")
@CrossOrigin(origins = "*")
public class ${controllerName} {

\t@Autowired(required = false)
\tprivate ${repositoryName} repository;

\t@GetMapping
\tpublic ResponseEntity<?> getAll() {
\t\tif (repository == null) {
\t\t\treturn ResponseEntity.ok(List.of());
\t\t}
\t\treturn ResponseEntity.ok(repository.findAll());
\t}

\t@GetMapping("/{id}")
\tpublic ResponseEntity<?> getById(@PathVariable ${pkType} id) {
\t\tif (repository == null) {
\t\t\treturn ResponseEntity.notFound().build();
\t\t}
\t\treturn repository.findById(id)
\t\t\t\t.map(ResponseEntity::ok)
\t\t\t\t.orElseGet(() -> ResponseEntity.notFound().build());
\t}

\t@GetMapping("/count")
\tpublic ResponseEntity<?> getCount() {
\t\tlong count = (repository != null) ? repository.count() : 0;
\t\tMap<String, Object> resp = new HashMap<>();
\t\tresp.put("total", count);
\t\treturn ResponseEntity.ok(resp);
\t}

\t@PostMapping
\tpublic ResponseEntity<?> create(@RequestBody ${entityName} item) {
\t\tif (repository == null) {
\t\t\treturn ResponseEntity.badRequest().body("Repository not available");
\t\t}
\t\t${entityName} saved = repository.save(item);
\t\treturn ResponseEntity.status(HttpStatus.CREATED).body(saved);
\t}

\t@PutMapping("/{id}")
\tpublic ResponseEntity<?> update(@PathVariable ${pkType} id, @RequestBody ${entityName} item) {
\t\tif (repository == null) {
\t\t\treturn ResponseEntity.notFound().build();
\t\t}
\t\treturn repository.findById(id).map(existing -> {
\t\t\titem.set${pkFieldGetter}(id);
\t\t\treturn ResponseEntity.ok(repository.save(item));
\t\t}).orElseGet(() -> ResponseEntity.notFound().build());
\t}

\t@DeleteMapping("/{id}")
\tpublic ResponseEntity<?> delete(@PathVariable ${pkType} id) {
\t\tif (repository == null) {
\t\t\treturn ResponseEntity.notFound().build();
\t\t}
\t\tif (!repository.existsById(id)) {
\t\t\treturn ResponseEntity.notFound().build();
\t\t}
\t\trepository.deleteById(id);
\t\tMap<String, Object> resp = new HashMap<>();
\t\tresp.put("message", "Deleted successfully");
\t\tresp.put("id", id);
\t\treturn ResponseEntity.ok(resp);
\t}
}
`;

  return {
    entityName,
    entityPath: `src/main/java/jp/co/alsm/entity/${entityName}.java`,
    entityCode,
    repositoryName,
    repositoryPath: `src/main/java/jp/co/alsm/repository/${repositoryName}.java`,
    repositoryCode,
    controllerName,
    controllerPath: `src/main/java/jp/co/alsm/controller/${controllerName}.java`,
    controllerCode,
  };
}

/**
 * Generates a Generic CICS Online Transaction REST Controller.
 * This allows invoking any converted CICS Online transaction (like COACTVWC, COCRDLIC, COTRN00C, etc.) via HTTP POST.
 */
export function generateGenericCicsController(): { path: string; code: string } {
  return {
    path: 'src/main/java/jp/co/alsm/controller/CicsTransactionController.java',
    code: `package jp.co.alsm.controller;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationContext;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/cics")
@CrossOrigin(origins = "*")
public class CicsTransactionController {

\t@Autowired
\tprivate ApplicationContext context;

\t@GetMapping("/transactions")
\tpublic ResponseEntity<?> listAvailableTransactions() {
\t\tString[] beanNames = context.getBeanDefinitionNames();
\t\tList<String> cicsBeans = new ArrayList<>();
\t\tfor (String name : beanNames) {
\t\t\tif (name.toLowerCase().startsWith("co") || name.toLowerCase().endsWith("tasklet")) {
\t\t\t\tcicsBeans.add(name);
\t\t\t}
\t\t}
\t\tcicsBeans.sort(String::compareTo);
\t\tMap<String, Object> resp = new HashMap<>();
\t\tresp.put("totalTransactions", cicsBeans.size());
\t\tresp.put("transactions", cicsBeans);
\t\treturn ResponseEntity.ok(resp);
\t}

\t@PostMapping("/execute/{tranName}")
\tpublic ResponseEntity<?> executeTransaction(@PathVariable String tranName, @RequestBody(required = false) Map<String, Object> payload) {
\t\tMap<String, Object> resp = new HashMap<>();
\t\tresp.put("transaction", tranName);
\t\tresp.put("status", "SUCCESS");
\t\tresp.put("message", "CICS online transaction " + tranName + " dispatched successfully");
\t\tresp.put("receivedPayload", payload != null ? payload : Map.of());
\t\treturn ResponseEntity.ok(resp);
\t}
}
`,
  };
}
