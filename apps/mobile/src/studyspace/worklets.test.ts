import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import ts from 'typescript';

// The canvas runs gestures, animation callbacks and useAnimatedStyle on the
// UI thread, calling camera.ts. There a function runs only if it is a
// worklet, and the worklets plugin captures the module constants a worklet
// reads in its body but not those read only in a default parameter: on the
// UI runtime the name is undefined (the "Property 'DETENT_WINDOW' doesn't
// exist" crash on releasing a pinch).

/** Modules whose every top-level function is called on the UI thread. */
const WORKLET_MODULES = ['camera.ts'];
/** Modules with worklets in them, checked for default parameters. */
const UI_THREAD_FILES = ['camera.ts', 'canvas.tsx'];

function parse(file: string): ts.SourceFile {
  const text = readFileSync(new URL(file, import.meta.url), 'utf8');
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
}

function isWorklet(fn: ts.FunctionDeclaration): boolean {
  const first = fn.body?.statements[0];
  return (
    first !== undefined &&
    ts.isExpressionStatement(first) &&
    ts.isStringLiteral(first.expression) &&
    first.expression.text === 'worklet'
  );
}

function readsAName(node: ts.Node): boolean {
  return ts.isIdentifier(node) || ts.forEachChild(node, readsAName) === true;
}

/** Every parameter, in any function in the file, whose default reads a name. */
function namedDefaults(source: ts.SourceFile): string[] {
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isParameter(node) && node.initializer !== undefined && readsAName(node.initializer)) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart());
      found.push(`${source.fileName}:${line + 1} ${node.getText()}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe('UI-thread code is worklets', () => {
  for (const file of WORKLET_MODULES) {
    test(`every function in ${file} is a worklet`, () => {
      const functions = parse(file).statements.filter(ts.isFunctionDeclaration);
      assert.ok(functions.length > 0);
      assert.deepEqual(
        functions.filter((fn) => !isWorklet(fn)).map((fn) => fn.name?.text),
        [],
      );
    });
  }

  for (const file of UI_THREAD_FILES) {
    test(`no default parameter in ${file} reads a name`, () => {
      assert.deepEqual(namedDefaults(parse(file)), []);
    });
  }
});
