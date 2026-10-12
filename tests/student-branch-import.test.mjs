// Run: node --import tsx --test tests/student-branch-import.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import ExcelJS from "exceljs";
const { Workbook } = ExcelJS;
import { columns, validateRows, readStudentFile, buildStudentTemplate, branchCodeFormula, isBranchCodeFormula } from "../apps/platform-admin/src/student-import.ts";
import { selectedOrganizationBranch } from "../apps/platform-admin/src/organization-branch-selection.ts";

const organization = { id: "org-a", name: "Example College" };
const branches = [
  { organizationId: "org-a", code: "CSE", name: "Computer Science and Engineering" },
  { organizationId: "org-a", code: "ME", name: "Mechanical Engineering" },
];
const row = ["2026001", "Test Student", "test@example.test", "9876543210", organization.name, branches[0].name, "CSE", "2026"];
const file = async workbook => new File([await workbook.xlsx.writeBuffer()], "students.xlsx");

test("a selected code only resolves within its own organization, never stale query data", () => {
  assert.equal(selectedOrganizationBranch(branches, "org-b", "CSE"), undefined);
  assert.equal(selectedOrganizationBranch(undefined, "org-a", "CSE"), undefined);
  assert.equal(selectedOrganizationBranch(branches, "org-a", ""), undefined);
  assert.deepEqual(selectedOrganizationBranch(branches, "org-a", "ME"), branches[1]);
});

test("CSV imports canonicalize branch case and whitespace without creating spelling variants", () => {
  const values = [...row]; values[5] = "  computer   SCIENCE and engineering "; values[6] = " cse ";
  const [result] = validateRows([columns, values], organization.name, branches);
  assert.deepEqual(result.errors, []);
  assert.equal(result.data.branchName, branches[0].name);
  assert.equal(result.data.branchCode, "CSE");
});

test("unknown branch codes and mismatched or misspelled names are rejected", () => {
  for (const [name, code] of [["Computer Sciencee and Engineering", "CSE"], [branches[1].name, "CSE"], ["Other branch", "OTHER"]]) {
    const values = [...row]; values[5] = name; values[6] = code;
    const [result] = validateRows([columns, values], organization.name, branches);
    assert.ok(result.errors.some(error => /branch/i.test(error)));
  }
});

test("template contains only the selected organization's branches, dropdowns, and automatic codes", async () => {
  const workbook = await buildStudentTemplate(organization, [...branches, { organizationId: "org-b", code: "OTHER", name: "Other organization branch" }]);
  const sheet = workbook.getWorksheet("Students");
  assert.equal(workbook.getWorksheet("Branches").rowCount, 3);
  assert.equal(sheet.getCell("F2").dataValidation.type, "list");
  assert.deepEqual(sheet.getCell("F2").dataValidation.formulae, ["OrganizationBranches"]);
  assert.equal(sheet.getCell("G2").formula, branchCodeFormula(2, 2));
  sheet.getRow(2).values = row;
  sheet.getCell("G2").value = { formula: branchCodeFormula(2, 2), result: "WRONG-CACHED-CODE" };
  const matrix = await readStudentFile(await file(workbook), branches);
  const preview = validateRows(matrix, organization.name, branches);
  assert.equal(preview.length, 1, "unused prefilled template rows are ignored");
  assert.deepEqual(preview[0].errors, []);
  assert.equal(preview[0].data.branchCode, "CSE", "branch code comes from current catalog, not cached formula result");
});

test("import distrusts edited workbook branch catalogs and rejects stale branch names", async () => {
  const workbook = await buildStudentTemplate(organization, branches);
  const sheet = workbook.getWorksheet("Students");
  sheet.getRow(2).values = row;
  sheet.getCell("F2").value = "Invented branch";
  sheet.getCell("G2").value = { formula: branchCodeFormula(2, 2), result: "CSE" };
  workbook.getWorksheet("Branches").getCell("A2").value = "Invented branch";
  const preview = validateRows(await readStudentFile(await file(workbook), branches), organization.name, branches);
  assert.ok(preview[0].errors.includes("branch_code is required"));
});

test("template formulas from wrong rows, external references, and arbitrary formulas are rejected", async () => {
  assert.equal(isBranchCodeFormula(branchCodeFormula(2, 1), 2), true);
  assert.equal(isBranchCodeFormula(branchCodeFormula(2, 10), 2), true);
  assert.equal(isBranchCodeFormula(branchCodeFormula(2, 100), 2), true);
  assert.equal(isBranchCodeFormula(branchCodeFormula(3, 1), 2), false);
  assert.equal(isBranchCodeFormula('HYPERLINK("https://example.test")', 2), false);
  for (const [cell, formula] of [["G2", "1+1"], ["G2", branchCodeFormula(3, 2)], ["A2", branchCodeFormula(2, 2)]]) {
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet("Students"); sheet.addRow(columns); sheet.addRow(row);
    sheet.getCell(cell).value = { formula, result: "CSE" };
    await assert.rejects(readStudentFile(await file(workbook), branches), /unsupported formula/);
  }
});

test("template creation requires registered branches for the selected organization", async () => {
  await assert.rejects(buildStudentTemplate(organization, []), /Create a branch/);
  await assert.rejects(buildStudentTemplate({ id: "org-b", name: "Other" }, branches), /Create a branch/);
});
