import { Fault, id } from '../../../packages/workagent-contract/index.mjs';
import { validateDocument, documentListDefinition, workKind } from '../../../packages/workagent-contract/document.mjs';
import { authorize, work } from './workspace.mjs';
export const PDF_BYTES = 16_000_000;
export const PDF_WARNINGS = [
  'PDF export only: native paragraphs, literal text, bold, italic, single underline, half-point font sizes, RGB colour, simple alignment and one page geometry through the Word mapping.',
  'PDF preserves visible list-marker and body styles but does not retain conflicting paragraph-mark editing metadata. Native documents and saved/source files are unchanged; Word export still refuses that conflict.',
  'Fonts may be substituted; line wrapping, pagination and layout may differ from the native editor and Word. Native default hyphenation/canvas settings, metadata, themes and style names are not retained. No exact layout or full Word fidelity.',
  'PDF rendering uses DejaVu Serif for Latin, WenQuanYi Zen Hei for BMP Han and Noto Color Emoji for standalone emoji. Other scripts, combining/emoji sequences and missing glyphs are refused; this is not full Unicode coverage. Native documents, original files and Word exports retain their existing mapping.',
  'Flat Unicode bullets and decimal lists retain markers, effective marker styles, identities and starts/restarts. PDF supports effective item numbers 1–32,767, including continuations; larger numbers are refused. Native documents and Word retain their existing 1–1,000,000 start bounds. PDF reserves room for markers and body-font overhang; wrapping and pagination may change, and layouts that cannot fit are refused. Nested lists, other numbering formats and unmapped list layout are refused. PDF import, OCR, roundtrip editing, spreadsheet/deck PDF and advanced document features are not supported. Current native edits are exported without a server save.',
];
// The shared validator rejects foreign/nested objects. This narrower policy also
// refuses native features the DOCX bridge cannot represent, before rendering.
export function validatePdfDocument(input) {
  const document = validateDocument(input);
  const only = (value, keys) => { if (Object.keys(value ?? {}).some(k => !keys.includes(k))) throw new Fault('unsupported_pdf_formatting', 400); };
  const text = value => {
    only(value, ['bl', 'it', 'ul', 'fs', 'cl', 'ff', 'eastAsiaFontFamily', 'lang', 'altLang']);
    if (value?.ul) only(value.ul, ['s']);
    if (value?.cl) { only(value.cl, ['rgb']); if (value.cl.rgb && !/^#[a-fA-F0-9]{6}$/.test(value.cl.rgb)) throw new Fault('unsupported_pdf_formatting', 400); }
    if (value?.fs !== undefined && !Number.isInteger(value.fs * 2)) throw new Fault('unsupported_pdf_font_size', 400);
  };
  const paragraph = value => { only(value, ['horizontalAlign', 'textStyle', 'paragraphMarkTextStyle']); if (value?.horizontalAlign > 5) throw new Fault('unsupported_pdf_formatting', 400); text(value?.textStyle); text(value?.paragraphMarkTextStyle); };
  const geometry = ['pageSize', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight', 'marginHeader', 'marginFooter'];
  // Univer adds these defaults when a plain document is opened. They contain no
  // extra content; the existing DOCX mapping omits their view/hyphenation hints.
  // Admit only these exact defaults, not arbitrary advanced layout options.
  const nativeDefaults = { documentFlavor: 2, autoHyphenation: 1, doNotHyphenateCaps: 0, consecutiveHyphenLimit: 2,
    defaultHeaderId: '', defaultFooterId: '', evenPageHeaderId: '', evenPageFooterId: '', firstPageHeaderId: '', firstPageFooterId: '', evenAndOddHeaders: 0, useFirstPageHeaderFooter: 0 };
  const style = document.documentStyle;
  only(style, [...geometry, 'textStyle', 'defaultParagraphStyle', 'renderConfig', ...Object.keys(nativeDefaults)]);
  for (const [key, value] of Object.entries(nativeDefaults)) if (style[key] !== undefined && style[key] !== value) throw new Fault('unsupported_pdf_formatting', 400);
  if (style.renderConfig) {
    only(style.renderConfig, ['zeroWidthParagraphBreak', 'vertexAngle', 'centerAngle', 'background']);
    for (const key of ['zeroWidthParagraphBreak', 'vertexAngle', 'centerAngle']) if (style.renderConfig[key] !== undefined && style.renderConfig[key] !== 0) throw new Fault('unsupported_pdf_formatting', 400);
    if (style.renderConfig.background && JSON.stringify(style.renderConfig.background) !== JSON.stringify({ rgb: '#ccc' })) throw new Fault('unsupported_pdf_formatting', 400);
  }
  text(document.documentStyle.textStyle); paragraph(document.documentStyle.defaultParagraphStyle);
  for (const p of document.body.paragraphs) paragraph(p.paragraphStyle);
  // Validate only active levels: the SDK retains unused stock levels/templates.
  const sequences = new Map();
  let cursor = 0, runCursor = 0;
  const runs = document.body.textRuns ?? [];
  const page = { ...document.documentStyle, ...document.body.sectionBreaks?.[0] };
  for (const p of document.body.paragraphs) {
    while (runCursor < runs.length && runs[runCursor].ed <= cursor) runCursor++;
    if (!p.bullet) { cursor = p.startIndex + 1; continue; }
    const { level } = documentListDefinition(document, p.bullet);
    text(p.bullet.textStyle); text(level.textStyle);
    const props = level.paragraphProperties ?? {};
    only(props, ['indentStart', 'hanging']);
    for (const unit of Object.values(props)) {
      only(unit, ['v', 'u']);
      if ((unit.u ?? 0) !== 0 || unit.v < 0) throw new Fault('unsupported_pdf_list_layout', 400);
    }
    if ((props.hanging?.v ?? 0) > (props.indentStart?.v ?? 0)) throw new Fault('unsupported_pdf_list_layout', 400);
    const ps = { ...document.documentStyle.defaultParagraphStyle, ...p.paragraphStyle };
    const first = runs[runCursor];
    const marker = { fs: 11, ...document.documentStyle.textStyle, ...ps.textStyle,
      ...(first && first.st <= cursor && cursor < first.ed ? first.ts : {}),
      ...(cursor === p.startIndex ? ps.paragraphMarkTextStyle : {}), ...p.bullet.textStyle, ...level.textStyle };
    const count = p.bullet.startNumber !== undefined ? p.bullet.startNumber + 1 : (sequences.get(p.bullet.listId) ?? level.startNumber) + 1;
    sequences.set(p.bullet.listId, count);
    const { kind } = documentListDefinition(document, p.bullet);
    // The actual renderer is qualified only through 32767. Check effective
    // values, including continuation across plain paragraphs and style changes.
    if (kind === 'ORDER_LIST' && (count < 1 || count > 32767)) throw new Fault('unsupported_pdf_list_number', 400);
    const baseSize = ps.textStyle?.fs ?? document.documentStyle.textStyle?.fs ?? 11;
    let bodySize = 0, covered = cursor;
    for (let i = runCursor; i < runs.length && runs[i].st < p.startIndex; i++) {
      const r = runs[i];
      if (r.st > covered) bodySize = Math.max(bodySize, baseSize);
      bodySize = Math.max(bodySize, r.ts.fs ?? baseSize);
      covered = Math.min(p.startIndex, r.ed);
    }
    if (covered < p.startIndex) bodySize = Math.max(bodySize, baseSize);
    // One em covers the pinned faces' left overhang. Include every effective
    // body run because any run can start a wrapped line; marker style is separate.
    const gutter = ((kind === 'ORDER_LIST' ? String(count).length + 1 : 1) * marker.fs + bodySize + 6) / .75;
    const implicit = document.lists?.[p.bullet.listType] ? 0 : 21;
    const left = props.indentStart?.v ?? implicit, hanging = props.hanging?.v ?? implicit;
    if (left - hanging + Math.max(hanging, gutter) + 48 >= (page.pageSize?.width ?? 794) - (page.marginLeft ?? 96) - (page.marginRight ?? 96)) throw new Fault('unsupported_pdf_list_layout', 400);
    cursor = p.startIndex + 1;
  }
  for (const r of document.body.textRuns ?? []) text(r.ts);
  for (const s of document.body.sectionBreaks ?? []) only(s, [...geometry, 'startIndex', 'sectionId']);
  return document;
}
export function pdfBytes(result) {
  if (!result || typeof result.base64 !== 'string' || result.base64.length > Math.ceil(PDF_BYTES / 3) * 4) throw new Fault('pdf_invalid_worker_output', 503);
  const bytes = Buffer.from(result.base64, 'base64');
  if (bytes.length > PDF_BYTES || bytes.toString('base64') !== result.base64 || !/^%PDF-1\.[0-9]\r?\n/.test(bytes.subarray(0, 12).toString('ascii')) || !/%%EOF\s*$/.test(bytes.subarray(-64).toString('ascii'))) throw new Fault('pdf_invalid_worker_output', 503);
  return bytes;
}
export class PdfExchange {
  constructor({ workspace, worker }) { this.store = workspace.store; this.worker = worker; }
  async grant(principal, workId, revision, permission) {
    return this.store.read(s => {
      authorize(s, principal);
      const w = work(s, workId);
      if (workKind(w) !== 'document') throw new Fault('document_required', 400);
      if (permission !== undefined && permission !== s.permissionRevision) throw new Fault('access_changed', 403);
      if (revision !== w.contentRevision) throw new Fault('pdf_work_changed', 409);
      return s.permissionRevision;
    });
  }
  async export(principal, input, { signal } = {}) {
    if (!input || Array.isArray(input) || Object.keys(input).some(k => !['workId', 'document', 'contentRevision'].includes(k)) || !Number.isSafeInteger(input.contentRevision) || input.contentRevision < 1) throw new Fault('invalid_pdf_input', 400);
    const workId = id(input.workId), grant = await this.grant(principal, workId, input.contentRevision);
    const document = validatePdfDocument(input.document);
    if (document.id !== workId) throw new Fault('invalid_document_identity', 400);
    if (signal?.aborted) throw new Fault('pdf_export_cancelled', 409);
    const result = await this.worker.run({ op: 'export', document }, { signal });
    pdfBytes(result);
    await this.grant(principal, workId, input.contentRevision, grant);
    if (signal?.aborted) throw new Fault('pdf_export_cancelled', 409);
    return { base64: result.base64, warnings: PDF_WARNINGS, filename: document.title.replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g, '_').replace(/\.(docx|pdf)$/i, '').slice(0, 180) + '.pdf' };
  }
}
