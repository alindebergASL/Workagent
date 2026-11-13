import { Fault, id } from '../../../packages/workagent-contract/index.mjs';
import { validateDocument, workKind } from '../../../packages/workagent-contract/document.mjs';
import { authorize, work } from './workspace.mjs';
export const PDF_BYTES = 16_000_000;
export const PDF_WARNINGS = [
  'PDF export only: native paragraphs, literal text, bold, italic, single underline, half-point font sizes, RGB colour, simple alignment and one page geometry through the Word mapping.',
  'Fonts may be substituted; line wrapping, pagination and layout may differ from the native editor and Word. Native default hyphenation/canvas settings, metadata, themes and style names are not retained. No exact layout or full Word fidelity.',
  'PDF rendering uses DejaVu Serif for Latin, WenQuanYi Zen Hei for BMP Han and Noto Color Emoji for standalone emoji. Other scripts, combining/emoji sequences and missing glyphs are refused; this is not full Unicode coverage. Native documents, original files and Word exports retain their existing mapping.',
  'List rendering remains unqualified and is refused before download; use Word export for supported lists. PDF import, OCR, roundtrip editing, spreadsheet/deck PDF and advanced document features are not supported. Current native edits are exported without a server save.',
];
// The shared validator rejects foreign/nested objects. This narrower policy also
// refuses native features the DOCX bridge cannot represent, before rendering.
export function validatePdfDocument(input) {
  const document = validateDocument(input);
  if (document.body.paragraphs.some(p => p.bullet)) throw new Fault('pdf_lists_unqualified', 400);
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
