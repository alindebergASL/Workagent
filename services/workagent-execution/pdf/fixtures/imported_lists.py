"""Trusted synthetic Word fixture; no product upload or private identifiers.

The nine-paragraph source reproduces the approved imported-list sequence and
geometry. imported-list-saved.json reduces its observed ten-paragraph native
state, retaining the Enter-created run spanning a paragraph mark and its colour.
"""
import io
import copy
from docx import Document
from docx.shared import Pt
from docx.oxml import OxmlElement


def source_docx():
    doc = Document()
    doc.styles['Normal'].font.size = Pt(11)
    section = doc.sections[0]
    section.page_width = Pt(612); section.page_height = Pt(792)
    section.left_margin = section.right_margin = Pt(90)
    section.top_margin = section.bottom_margin = Pt(72)
    section.header_distance = section.footer_distance = Pt(36)
    q = lambda name: '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}' + name
    numbering = doc.part.numbering_part.element
    # Use genuine Word num/abstractNum references, resolving num7's actual
    # abstract definition rather than assuming the two IDs are equal.
    num7 = next(n for n in numbering.findall(q('num')) if n.get(q('numId')) == '7')
    abstract_id = num7.find(q('abstractNumId')).get(q('val'))
    abstract = next(a for a in numbering.findall(q('abstractNum')) if a.get(q('abstractNumId')) == abstract_id)
    abstract.find('.//' + q('ind')).set(q('left'), '1080')
    num = OxmlElement('w:num'); num.set(q('numId'), '42')
    ref = OxmlElement('w:abstractNumId'); ref.set(q('val'), '7'); num.append(ref)
    override = OxmlElement('w:lvlOverride'); override.set(q('ilvl'), '0')
    start = OxmlElement('w:startOverride'); start.set(q('val'), '5')
    override.append(start); num.append(override); numbering.append(num)
    for text, num_id in [('Heading', None), ('Bullet A', 1), ('Bullet B', 1),
                         ('First', 7), ('Second', 7), ('Note 00120', None),
                         ('Inspect 雪 🌍', 42), ('Finish', 42), ('Continue', 7)]:
        p = doc.add_paragraph(); run = p.add_run(text)
        if text == 'Heading': run.bold = True
        if text.startswith('Inspect'): run.italic = True
        if num_id:
            p._p.get_or_add_pPr().get_or_add_numPr().get_or_add_numId().val = num_id
    out = io.BytesIO(); doc.save(out)
    return out.getvalue()


def contrast_native(inheritance='default'):
    """Red/green markers versus blue body and editing marks, on one sequence."""
    lines = ['Red marker blue body', 'Plain gap', '', 'Continuation', 'Restart', 'Tail']
    blue = {'cl': {'rgb': '#0000FF'}, 'fs': 12, 'bl': 0, 'it': 0, 'ul': {'s': 0}}
    red = {'cl': {'rgb': '#FF0000'}, 'fs': 20, 'bl': 1, 'it': 1, 'ul': {'s': 1}}
    green = {'cl': {'rgb': '#008000'}, 'fs': 14, 'bl': 0, 'it': 0, 'ul': {'s': 0}}
    style = {'pageSize': {'width': 816, 'height': 1056}, 'marginLeft': 72, 'marginRight': 72}
    if inheritance == 'document': style['textStyle'] = copy.deepcopy(blue)
    if inheritance == 'default': style['defaultParagraphStyle'] = {'textStyle': copy.deepcopy(blue)}
    paragraphs = []; runs = []; start = 0
    for i, line in enumerate(lines):
        end = start + len(line)
        ps = {'paragraphMarkTextStyle': {**copy.deepcopy(blue), 'fs': 9}}
        if inheritance == 'paragraph': ps['textStyle'] = copy.deepcopy(blue)
        p = {'startIndex': end, 'paragraphId': 'contrast-' + str(i), 'paragraphStyle': ps}
        if i != 1:
            p['bullet'] = {'listId': 'shared', 'listType': 'contrast', 'nestingLevel': 0,
                           'textStyle': copy.deepcopy(red if i in (0, 2, 4) else green)}
        if i == 4: p['bullet']['startNumber'] = 1
        if inheritance == 'run': runs.append({'st': start, 'ed': end + 1, 'ts': copy.deepcopy(blue)})
        paragraphs.append(p); start = end + 1
    # Split body styling, with a run crossing the first paragraph mark. This
    # conflicts with its red, bold, underlined, 20pt marker in every variant.
    runs = [r for r in runs if r['st'] != 0]
    runs[:0] = [{'st': 0, 'ed': 10, 'ts': {**copy.deepcopy(blue), 'fs': 16}},
                {'st': 10, 'ed': len(lines[0]) + 1, 'ts': {**copy.deepcopy(blue), 'fs': 18, 'it': 1}}]
    return {'id': 'doc', 'title': 'Marker contrast', 'documentStyle': style,
            'body': {'dataStream': '\r'.join(lines) + '\r\n', 'paragraphs': paragraphs, 'textRuns': runs},
            'lists': {'contrast': {'listType': 'ORDER_LIST', 'nestingLevel': [
                {'bulletAlignment': 1, 'startNumber': 4, 'glyphFormat': '%1.', 'glyphType': 2,
                 'textStyle': {}, 'paragraphProperties': {'indentStart': {'v': 24}, 'hanging': {'v': 24}}}]}}}
