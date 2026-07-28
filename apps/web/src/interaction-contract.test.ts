import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const sourceFiles = [
  "pages/Operations.tsx",
  "pages/Management.tsx",
  "pages/Logs.tsx",
  "typed-forms.tsx",
];

function source(path: string) {
  const fileName = resolve(import.meta.dirname, path);
  return ts.createSourceFile(
    fileName,
    readFileSync(fileName, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

function lineOf(file: ts.SourceFile, node: ts.Node) {
  return file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
}

describe("console interaction contract", () => {
  it("does not render command controls without an action", () => {
    const violations: string[] = [];
    const commandControls = new Set([
      "Button",
      "IconButton",
      "ButtonBase",
      "ListItemButton",
    ]);
    for (const path of sourceFiles) {
      const file = source(path);
      const visit = (node: ts.Node): void => {
        if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
          const name = node.tagName.getText(file);
          if (commandControls.has(name)) {
            const attributes = new Set(
              node.attributes.properties
                .filter(ts.isJsxAttribute)
                .map((attribute) => attribute.name.getText(file)),
            );
            const hasAction =
              attributes.has("onClick") ||
              attributes.has("onChange") ||
              attributes.has("href") ||
              attributes.has("to") ||
              attributes.has("component") ||
              (attributes.has("type") && node.getText(file).includes('type="submit"'));
            if (!hasAction) violations.push(`${path}:${lineOf(file, node)} ${name}`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(file);
    }
    expect(violations).toEqual([]);
  });

  it("routes page mutations through the shared command feedback hook", () => {
    const violations: string[] = [];
    for (const path of sourceFiles) {
      const file = source(path);
      const visit = (node: ts.Node): void => {
        if (
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === "useMutation"
        ) {
          violations.push(`${path}:${lineOf(file, node)}`);
        }
        ts.forEachChild(node, visit);
      };
      visit(file);
    }
    expect(violations).toEqual([]);
  });
});
