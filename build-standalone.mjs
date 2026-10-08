import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The supplied workspace contained only a bundled HTML file. Keep an editable
// standalone source so rebuilding does not depend on the missing original tree.
const source = new URL('./src/otp-slate.html', import.meta.url);
const output = new URL('./otp-slate.html', import.meta.url);
let html = readFileSync(source, 'utf8');
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const hundred = html.match(/const HUNDRED = '([^']+)'/)[1];
const raw = html.match(/const RAW = `([\s\S]*?)`;/)[1].replace('${HUNDRED}', hundred);
const catalog = raw.trim().split('\n').map(line => {
  const [id, name, code, cat, sub, color, glyph, workspace, staff, modules] = line.split('|');
  return { id, name, code, cat, color, mods: modules.split(';').map(m => m.replace('*', '')) };
});
const catalogScript = `window.SLATE_CATALOG=${JSON.stringify(catalog).replaceAll('<', '\\u003c')};`;
const shared = read('./src/admin/shared-model.js');
html = html.replace('/*STUDENT_SHARED_MODEL*/', catalogScript + '\n' + shared)
  .replace('/*STUDENT_BRIDGE*/', read('./src/admin/student-bridge.js'));
for (const [, script] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new Function(script);
writeFileSync(output, html, 'utf8');
console.log(`Built ${fileURLToPath(output)} (${(Buffer.byteLength(html) / 1024).toFixed(1)} KB)`);

let admin = read('./src/admin/index.template.html');
const template = readFileSync(new URL('./outputs/admin-template/student-import-template.xlsx', import.meta.url)).toString('base64');
admin = admin.replace('/*ADMIN_CSS*/', () => read('./src/admin/admin.css'))
  .replace('/*XLSX_VENDOR*/', () => read('./vendor/xlsx.full.min.js').replaceAll('</script', '<\\/script'))
  .replace('/*CATALOG*/', () => catalogScript + `\nconst STUDENT_TEMPLATE_BASE64='${template}';`)
  .replace('/*SHARED_MODEL*/', () => shared)
  .replace('/*ADMIN_JS*/', () => read('./src/admin/admin.js'));
for (const [, script] of admin.matchAll(/<script>([\s\S]*?)<\/script>/g)) new Function(script);
const adminOutput = new URL('./otp-slate-platform-admin.html', import.meta.url);
writeFileSync(adminOutput, admin, 'utf8');
console.log(`Built ${fileURLToPath(adminOutput)} (${(Buffer.byteLength(admin) / 1024).toFixed(1)} KB)`);

// Keep the original admin URL usable while giving each portal its own HTML.
writeFileSync(new URL('./otp-slate-admin.html', import.meta.url), admin, 'utf8');
let organization = read('./src/organization/index.template.html');
organization = organization.replace('/*ORG_CSS*/', () => read('./src/organization/organization.css'))
  .replace('/*CATALOG*/', () => catalogScript)
  .replace('/*SHARED_MODEL*/', () => shared)
  .replace('/*ORG_JS*/', () => read('./src/organization/organization.js'));
for (const [, script] of organization.matchAll(/<script>([\s\S]*?)<\/script>/g)) new Function(script);
const organizationOutput = new URL('./otp-slate-organization-admin.html', import.meta.url);
writeFileSync(organizationOutput, organization, 'utf8');
console.log(`Built ${fileURLToPath(organizationOutput)} (${(Buffer.byteLength(organization) / 1024).toFixed(1)} KB)`);
