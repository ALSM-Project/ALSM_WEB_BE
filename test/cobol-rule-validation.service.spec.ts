import { CobolRuleValidationService } from '../src/modules/validation/application/cobol-rule-validation.service';
import { ValidationFindingCategory } from '../src/modules/validation/domain/validation-finding.types';

describe('CobolRuleValidationService (COBOL to Java Hybrid Step 1 & 2)', () => {
  let service: CobolRuleValidationService;

  beforeEach(() => {
    service = new CobolRuleValidationService();
  });

  const cobolMock = `
       IDENTIFICATION DIVISION.
       PROGRAM-ID. CBACT01C.
       ENVIRONMENT DIVISION.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-ACCOUNT-ID         PIC 9(11).
       01 WS-CURRENT-BALANCE    PIC S9(10)V99 COMP-3.
       01 WS-CUSTOMER-NAME      PIC X(30).
       01 WS-STATUS             PIC X(01).
       PROCEDURE DIVISION.
       0000-MAIN.
           PERFORM 1000-PROCESS-RECORD.
           GOBACK.
       1000-PROCESS-RECORD.
           EXEC SQL
               SELECT BALANCE INTO :WS-CURRENT-BALANCE FROM ACCOUNTS
           END-EXEC.
           READ ACCTFILE-FILE NEXT RECORD.
           EXIT.
  `;

  it('detects DATA_TYPE_MISMATCH when decimal/COMP-3 currency in COBOL is mapped to floating-point double in Java', () => {
    const javaWithDouble = `
public class AccountProcess {
    private Long wsAccountId;
    private double wsCurrentBalance; // INSECURE: Binary floating-point
    private String wsCustomerName;
    private String wsStatus;

    public void main() {}
    public void processRecord() {
        // query
        repository.find();
        Files.readAllBytes(path);
    }
}
    `;

    const result = service.validate(
      { path: 'CBACT01C.cbl', content: cobolMock },
      { path: 'AccountProcess.java', content: javaWithDouble },
    );

    const typeMismatch = result.findings.find(
      (f) =>
        f.category === ValidationFindingCategory.DATA_TYPE_MISMATCH &&
        f.title.includes('WS-CURRENT-BALANCE') &&
        f.explanation.includes('floating-point'),
    );
    expect(typeMismatch).toBeDefined();
    expect(typeMismatch?.severity).toBe('CRITICAL');
  });

  it('detects VARIABLE_MAPPING_MISMATCH when a level 01 variable in COBOL is missing in Java', () => {
    const javaMissingCustomerName = `
public class AccountProcess {
    private Long wsAccountId;
    private BigDecimal wsCurrentBalance;
    // wsCustomerName is missing
    private String wsStatus;

    public void main() {}
    public void processRecord() {
        repository.find();
        Files.readAllBytes(path);
    }
}
    `;

    const result = service.validate(
      { path: 'CBACT01C.cbl', content: cobolMock },
      { path: 'AccountProcess.java', content: javaMissingCustomerName },
    );

    const missingVar = result.findings.find(
      (f) =>
        f.category === ValidationFindingCategory.VARIABLE_MAPPING_MISMATCH &&
        f.title.includes('WS-CUSTOMER-NAME'),
    );
    expect(missingVar).toBeDefined();
    expect(missingVar?.severity).toBe('MEDIUM');
  });

  it('detects MISSING_OPERATION when a COBOL procedure paragraph is not implemented in Java', () => {
    const javaMissingProcessRecord = `
public class AccountProcess {
    private Long wsAccountId;
    private BigDecimal wsCurrentBalance;
    private String wsCustomerName;
    private String wsStatus;

    public void main() {}
    // processRecord is missing!
}
    `;

    const result = service.validate(
      { path: 'CBACT01C.cbl', content: cobolMock },
      { path: 'AccountProcess.java', content: javaMissingProcessRecord },
    );

    const missingOp = result.findings.find(
      (f) =>
        f.category === ValidationFindingCategory.MISSING_OPERATION &&
        f.title.includes('1000-PROCESS-RECORD'),
    );
    expect(missingOp).toBeDefined();
    expect(missingOp?.severity).toBe('HIGH');
  });

  it('detects DATABASE_MISMATCH when EXEC SQL is used in COBOL but Java lacks DB operations', () => {
    const cobolWithSql = `
       IDENTIFICATION DIVISION.
       PROGRAM-ID. TESTSQL.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-ID PIC 9(5).
       PROCEDURE DIVISION.
       0000-MAIN.
           EXEC SQL SELECT NAME FROM TABLE END-EXEC.
    `;
    const javaNoDb = `
public class TestSql {
    private Integer wsId;
    public void main() {
        System.out.println("No DB");
    }
}
    `;

    const result = service.validate(
      { path: 'TESTSQL.cbl', content: cobolWithSql },
      { path: 'TestSql.java', content: javaNoDb },
    );

    const dbMismatch = result.findings.find(
      (f) => f.category === ValidationFindingCategory.DATABASE_MISMATCH,
    );
    expect(dbMismatch).toBeDefined();
    expect(dbMismatch?.severity).toBe('HIGH');
  });

  it('detects FILE_IO_MISMATCH when File I/O is in COBOL but missing in Java', () => {
    const cobolWithIo = `
       IDENTIFICATION DIVISION.
       PROGRAM-ID. TESTIO.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-ID PIC 9(5).
       PROCEDURE DIVISION.
       0000-MAIN.
           READ ACCTFILE NEXT RECORD.
    `;
    const javaNoIo = `
public class TestIo {
    private Integer wsId;
    public void main() {
        System.out.println("Hello");
    }
}
    `;

    const result = service.validate(
      { path: 'TESTIO.cbl', content: cobolWithIo },
      { path: 'TestIo.java', content: javaNoIo },
    );

    const ioMismatch = result.findings.find(
      (f) => f.category === ValidationFindingCategory.FILE_IO_MISMATCH,
    );
    expect(ioMismatch).toBeDefined();
    expect(ioMismatch?.severity).toBe('MEDIUM');
  });

  it('yields zero findings when Java properly preserves types, operations, and fields from COBOL', () => {
    const perfectJava = `
import java.math.BigDecimal;
import java.nio.file.Files;
import org.springframework.data.jpa.repository.JpaRepository;

public class AccountProcess {
    private Long wsAccountId;
    private BigDecimal wsCurrentBalance;
    private String wsCustomerName;
    private String wsStatus;

    private AccountRepository repository;

    public void main() {
        processRecord();
    }

    public void processRecord() {
        repository.findBalance();
        Files.readAllBytes(path);
    }
}
    `;

    const result = service.validate(
      { path: 'CBACT01C.cbl', content: cobolMock },
      { path: 'AccountProcess.java', content: perfectJava },
    );

    expect(result.findings).toHaveLength(0);
  });
});
