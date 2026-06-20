// packages/backend/src/validation/validation.test.ts
import { describe, it, expect } from 'vitest';
import { validate } from './ast-validator.js';

describe('AST Validator', () => {
  describe('valid code', () => {
    it('should pass for valid TypeScript', () => {
      const code = `const x = 1;
function foo() {
  return x;
}
export { foo };
`;

      const result = validate('test.ts', code);

      expect(result.isValid).toBe(true);
      expect(result.errors.filter(e => e.severity === 'error')).toHaveLength(0);
    });

    it('should pass for valid Python', () => {
      const code = `def foo():
    return 1

class Bar:
    pass
`;

      const result = validate('test.py', code);

      expect(result.isValid).toBe(true);
      expect(result.errors.filter(e => e.severity === 'error')).toHaveLength(0);
    });

    it('should pass for valid JavaScript', () => {
      const code = `const x = 1;
const y = { a: 1, b: 2 };
const z = [1, 2, 3];
function foo(a, b) {
  return a + b;
}
`;

      const result = validate('test.js', code);

      expect(result.isValid).toBe(true);
    });
  });

  describe('invalid syntax', () => {
    it('should catch missing closing brace', () => {
      const code = `function foo() {
  return 1;
// missing closing brace
`;

      const result = validate('test.ts', code);

      expect(result.isValid).toBe(false);
      const bracketErrors = result.errors.filter(e => e.message.includes('Unclosed'));
      expect(bracketErrors.length).toBeGreaterThan(0);
      expect(bracketErrors[0].line).toBe(1);
    });

    it('should catch unexpected closing bracket', () => {
      const code = `const x = 1;
}
`;

      const result = validate('test.ts', code);

      expect(result.isValid).toBe(false);
      const unexpectedErrors = result.errors.filter(e => e.message.includes('Unexpected closing'));
      expect(unexpectedErrors.length).toBeGreaterThan(0);
    });

    it('should catch mismatched brackets', () => {
      const code = `const x = { a: 1 );
`;

      const result = validate('test.ts', code);

      expect(result.isValid).toBe(false);
      const mismatchErrors = result.errors.filter(e => e.message.includes('Mismatched'));
      expect(mismatchErrors.length).toBeGreaterThan(0);
    });

    it('should report correct line numbers', () => {
      const code = `const a = 1;
const b = {
const c = 3;
`;

      const result = validate('test.ts', code);

      expect(result.isValid).toBe(false);
      const unclosedError = result.errors.find(e => e.message.includes('Unclosed'));
      expect(unclosedError).toBeDefined();
      expect(unclosedError!.line).toBe(2);
    });
  });

  describe('auto-fix', () => {
    it('should auto-fix missing semicolons in TypeScript', () => {
      const code = `const x = 1
const y = 2
`;

      const result = validate('test.ts', code);

      expect(result.isValid).toBe(true); // No bracket errors
      expect(result.fixedContent).toBeDefined();
      expect(result.fixedContent).toContain('const x = 1;');
      expect(result.fixedContent).toContain('const y = 2;');
    });

    it('should auto-fix missing colons in Python', () => {
      const code = `def foo()
    return 1
`;

      const result = validate('test.py', code);

      expect(result.isValid).toBe(true); // No bracket errors
      expect(result.fixedContent).toBeDefined();
      expect(result.fixedContent).toContain('def foo():');
    });

    it('should not change content when no fixes needed', () => {
      const code = `const x = 1;
const y = 2;
`;

      const result = validate('test.ts', code);

      expect(result.isValid).toBe(true);
      expect(result.fixedContent).toBeUndefined();
    });
  });

  describe('language detection', () => {
    it('should detect TypeScript from .ts extension', () => {
      const code = `const x = 1`;
      const result = validate('file.ts', code);
      expect(result.isValid).toBe(true);
    });

    it('should detect Python from .py extension', () => {
      const code = `x = 1`;
      const result = validate('file.py', code);
      expect(result.isValid).toBe(true);
    });

    it('should detect JavaScript from .js extension', () => {
      const code = `const x = 1`;
      const result = validate('file.js', code);
      expect(result.isValid).toBe(true);
    });

    it('should handle unknown extensions gracefully', () => {
      const code = `some content`;
      const result = validate('file.xyz', code);
      expect(result.isValid).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle empty content', () => {
      const result = validate('test.ts', '');
      expect(result.isValid).toBe(true);
    });

    it('should handle content with strings containing brackets', () => {
      const code = `const x = "{ hello }";
const y = '[ world ]';
`;

      const result = validate('test.ts', code);
      expect(result.isValid).toBe(true);
    });

    it('should handle content with comments', () => {
      const code = `// { }
const x = 1; // }
/* { } */
`;

      const result = validate('test.ts', code);
      expect(result.isValid).toBe(true);
    });

    it('should handle nested brackets', () => {
      const code = `const x = { a: { b: { c: 1 } } };
const y = [[[1]]];
const z = ((1 + 2) * 3);
`;

      const result = validate('test.ts', code);
      expect(result.isValid).toBe(true);
    });
  });
});
