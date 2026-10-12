import type { OrganizationBranch } from "@slate/contracts";

export type ImportRow = {
  studentId: string;
  name: string;
  email: string;
  phone: string;
  collegeName: string;
  branchName: string;
  branchCode: string;
  cohort: string;
};
export type PreviewRow = { line: number; data: ImportRow; errors: string[] };
export const columns = [
  "student_id",
  "full_name",
  "email",
  "phone",
  "college_name",
  "branch_name",
  "branch_code",
  "cohort",
];
export const fieldKeys: (keyof ImportRow)[] = [
  "studentId",
  "name",
  "email",
  "phone",
  "collegeName",
  "branchName",
  "branchCode",
  "cohort",
];
const limits = [80, 120, 200, 30, 150, 120, 32, 120];
const normalize = (value: string) =>
  value.trim().replace(/\s+/g, " ").toLowerCase();
export function parseCsv(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false,
    closed = false;
  const text = source.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
        closed = true;
      } else cell += char;
    } else if (char === '"') {
      if (cell || closed)
        throw new Error(
          "Invalid CSV quotation. Save the file as a UTF-8 CSV and retry.",
        );
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
      closed = false;
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      closed = false;
      if (rows.length > 2002)
        throw new Error("Import up to 2,000 students per file.");
    } else {
      if (closed)
        throw new Error("Unexpected characters after a quoted CSV field.");
      cell += char;
    }
  }
  if (quoted) throw new Error("The CSV has an unfinished quoted field.");
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

export async function readStudentFile(file: File, branches: OrganizationBranch[]): Promise<string[][]> {
  if (file.size > 5 * 1024 * 1024)
    throw new Error("Choose a file smaller than 5 MB.");
  if (/\.csv$/i.test(file.name)) return parseCsv(await file.text());
  if (!/\.xlsx$/i.test(file.name))
    throw new Error("Choose an .xlsx workbook or a .csv file.");
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const sheet = workbook.getWorksheet("Students") || workbook.worksheets[0];
  if (!sheet) throw new Error("The workbook has no student sheet.");
  if (sheet.rowCount > 2001 || sheet.columnCount > 30)
    throw new Error("Use the template with up to 2,000 student rows.");
  const rows: string[][] = [];
  for (let line = 1; line <= sheet.rowCount; line++) {
    const row: string[] = [];
    for (let column = 1; column <= sheet.columnCount; column++) {
      const cell = sheet.getRow(line).getCell(column);
      if (cell.type === 6) {
        // Only our generated lookup is supported; never execute workbook formulas or trust cached values.
        if (line < 2 || column !== 7 || sheet.getRow(1).getCell(6).text !== "branch_name" || sheet.getRow(1).getCell(7).text !== "branch_code" || !isBranchCodeFormula(cell.formula, line))
          throw new Error(`Row ${line} contains an unsupported formula. Only the template’s automatic branch-code lookup is allowed; paste values for other fields.`);
        const name = sheet.getRow(line).getCell(6).text;
        const branch = branches.find(item => normalize(item.name) === normalize(name));
        row.push(branch?.code || "");
        continue;
      }
      row.push(cell.text);
    }
    rows.push(row);
  }
  return rows;
}

export function validateRows(matrix: string[][], organization: string, branches: OrganizationBranch[]): PreviewRow[] {
  if (!matrix.length)
    throw new Error("The file is empty. Start with the import template.");
  const headers = matrix[0].map((value) => value.trim().toLowerCase());
  if (new Set(headers.filter(Boolean)).size !== headers.filter(Boolean).length)
    throw new Error("Each column header must appear only once.");
  const missing = columns.filter(
    (column) => column !== "cohort" && !headers.includes(column),
  );
  if (missing.length)
    throw new Error(
      `Missing columns: ${missing.join(", ")}. Download the current template.`,
    );
  const unknown = headers.filter(
    (column) => column && !columns.includes(column),
  );
  if (unknown.length)
    throw new Error(
      `Unsupported columns: ${unknown.join(", ")}. Use the current student import template.`,
    );
  const emails = new Set<string>(),
    ids = new Set<string>();
  const rows = matrix.slice(1).flatMap((cells, index): PreviewRow[] => {
    // The template pre-fills college and lookup formulas for 2,000 rows; skip unused student rows.
    if (!fieldKeys.filter(key => key !== "collegeName" && key !== "branchCode").some(key => (cells[headers.indexOf(columns[fieldKeys.indexOf(key)])] || "").trim())) return [];
    const data = Object.fromEntries(
      fieldKeys.map((key, i) => [
        key,
        (cells[headers.indexOf(columns[i])] || "").trim(),
      ]),
    ) as ImportRow;
    data.email = data.email.toLowerCase();
    data.branchCode = data.branchCode.toUpperCase();
    data.phone = data.phone.replace(/[\s()-]/g, "");
    if (/^[6-9]\d{9}$/.test(data.phone)) data.phone = `+91${data.phone}`;
    const errors: string[] = [];
    const canonical = branches.find(branch => normalize(branch.code) === normalize(data.branchCode));
    if (data.branchCode && !canonical) errors.push("Branch code is not registered for this organization. Choose a branch from the current template.");
    else if (canonical && normalize(canonical.name) !== normalize(data.branchName)) errors.push("Branch name and code must match the same organization branch");
    else if (canonical) {
      data.branchName = canonical.name;
      data.branchCode = canonical.code;
    }
    fieldKeys.forEach((key, i) => {
      if (key !== "cohort" && !data[key])
        errors.push(`${columns[i]} is required`);
      if (data[key].length > limits[i])
        errors.push(`${columns[i]} exceeds ${limits[i]} characters`);
      if (/[\u0000-\u001f\u007f]/.test(data[key]))
        errors.push(`${columns[i]} contains a line break or control character`);
    });
    if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email))
      errors.push("Enter a valid email");
    if (data.phone && !/^\+[1-9]\d{7,14}$/.test(data.phone))
      errors.push(
        "Phone needs a country code or a 10-digit Indian mobile number",
      );
    if (
      data.branchCode &&
      !/^[A-Za-z0-9][A-Za-z0-9 ._/-]*$/.test(data.branchCode)
    )
      errors.push("Branch code contains unsupported characters");
    if (
      data.collegeName &&
      normalize(data.collegeName) !== normalize(organization)
    )
      errors.push("College must match the selected organization");
    if (data.email && emails.has(data.email))
      errors.push("Email repeats in this file");
    if (data.studentId && ids.has(data.studentId.toLowerCase()))
      errors.push("Student ID repeats in this file");
    emails.add(data.email);
    ids.add(data.studentId.toLowerCase());
    return [{ line: index + 2, data, errors }];
  });
  if (!rows.length)
    throw new Error("Add at least one student below the header row.");
  if (rows.length > 2000)
    throw new Error("Import up to 2,000 students per file.");
  return rows;
}


// Keep this formula format narrow so import can recognize it without evaluating spreadsheet code.
export function branchCodeFormula(row: number, branchCount: number) {
  return `IFERROR(VLOOKUP(F${row},Branches!$A$2:$B$${branchCount + 1},2,FALSE),"")`;
}
export function isBranchCodeFormula(formula: string | undefined, row: number) {
  const match = /^IFERROR\(VLOOKUP\(F(\d+),Branches!\$A\$2:\$B\$(\d+),2,FALSE\),""\)$/.exec(formula || "");
  return Boolean(match && Number(match[1]) === row && Number(match[2]) >= 2);
}

export async function buildStudentTemplate(organization: { id: string; name: string }, branches: OrganizationBranch[]) {
  const catalog = branches.filter(branch => branch.organizationId === organization.id);
  if (!catalog.length) throw new Error("Create a branch for this organization before downloading its student template.");
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.calcProperties.fullCalcOnLoad = true;
  const sheet = workbook.addWorksheet("Students");
  sheet.columns = columns.map((header, index) => ({ header, key: header, width: [22, 28, 34, 22, 40, 40, 18, 22][index], style: { numFmt: "@" } }));
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).height = 28;
  sheet.getRow(1).eachCell(cell => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F2747" } }; });
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  const branchSheet = workbook.addWorksheet("Branches");
  branchSheet.columns = [{ header: "Branch name", width: 50 }, { header: "Branch code", width: 20 }];
  catalog.forEach(branch => branchSheet.addRow([branch.name, branch.code]));
  workbook.definedNames.add(`Branches!$A$2:$A$${catalog.length + 1}`, "OrganizationBranches");
  for (let row = 2; row <= 2001; row++) {
    sheet.getCell(`E${row}`).value = organization.name;
    sheet.getCell(`F${row}`).dataValidation = {
      type: "list", allowBlank: true, formulae: ["OrganizationBranches"], showErrorMessage: true,
      errorStyle: "stop", errorTitle: "Select an organization branch", error: "Choose a branch from the dropdown. Create any missing branch in Slate first.",
    };
    sheet.getCell(`G${row}`).value = { formula: branchCodeFormula(row, catalog.length) };
    sheet.getCell(`G${row}`).numFmt = "General";
    sheet.getCell(`G${row}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEAF1F9" } };
  }
  const guide = workbook.addWorksheet("Instructions");
  guide.getColumn(1).width = 110;
  [
    "STUDENT IMPORT · OTP SLATE",
    `Organization: ${organization.name}. This template is only for this organization.`,
    "Fill the Students sheet. Keep all column headers unchanged. Leave unused rows empty.",
    "Required: student ID, full name, email, phone and branch. College is prefilled; branch code fills automatically.",
    "Choose branch_name from the dropdown. Branch names and codes must already exist in this organization. Cohort is optional.",
    "Do not edit the Branches sheet. Download a new template after creating or updating organization branches.",
    "Student IDs and phone numbers are text. Preserve leading zeroes. Use +country code for international numbers.",
    "The branch_code lookup formula is supported. Other formulas, passwords and access settings are not allowed.",
    "For CSV files, supply the matching branch_name and branch_code from this organization’s catalog.",
    "Import up to 2,000 students per file (maximum 5 MB). Uploading only previews and validates.",
    "Confirm Create accounts & send emails to create accounts and queue welcome emails, with no second approval.",
    "Students must change their password and verify their phone before using assigned learning.",
  ].forEach(text => guide.addRow([text]));
  guide.getRow(1).font = { bold: true, size: 16, color: { argb: "FF0F2747" } };
  return workbook;
}
