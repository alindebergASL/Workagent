"""Trusted synthetic-only fixtures. Uses already installed system libraries."""
import base64
import io
import json
import sys
from reportlab.pdfgen.canvas import Canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from pypdf import PdfReader, PdfWriter

pdfmetrics.registerFont(TTFont('Fixture', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'))

def make(kind='plain', pages=1):
    if kind == 'paragraph-limit': pages = 101
    if kind in ('mixed-scanned', 'mixed-blank'): pages = 2
    stream = io.BytesIO()
    c = Canvas(stream, pageCompression=1)
    for n in range(pages):
        c.setFont('Fixture', 10)
        if kind in ('text-limit', 'paragraph-limit'):
            count, width = (205, 10000) if kind == 'text-limit' else (100, 600)
            c.setPageSize((width, count * 20 + 100))
            for line in range(count): c.drawString(20, count * 20 + 50 - line * 20, 'A' * (1000 if kind == 'text-limit' else 1))
        elif kind == 'scanned' or kind == 'mixed-scanned' and n == 1:
            from PIL import Image, ImageDraw, ImageFont
            from reportlab.lib.utils import ImageReader
            image = Image.new('RGB', (600, 100), 'white')
            ImageDraw.Draw(image).text((10, 10), 'Scanned text must not disappear', font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 24), fill='black')
            c.drawImage(ImageReader(image), 20, 600, width=500, height=84)
        elif kind != 'empty' and not (kind == 'mixed-blank' and n == 1):
            value = 'Cafe\u0301 café Ω Ж 0012 1. Literal label' if kind == 'unicode' else 'Page %d plain text' % (n + 1)
            c.drawString(40, 780, value)
            c.drawString(40, 760, 'Second line')
        c.showPage()
    c.save()
    value = stream.getvalue()
    if kind in ('encrypted', 'empty-password'):
        writer = PdfWriter(); writer.append(PdfReader(io.BytesIO(value)))
        writer.encrypt('secret' if kind == 'encrypted' else '', 'owner-secret')
        result = io.BytesIO(); writer.write(result); value = result.getvalue()
    return value

if __name__ == '__main__':
    print(base64.b64encode(make(sys.argv[1] if len(sys.argv) > 1 else 'plain', int(sys.argv[2]) if len(sys.argv) > 2 else 1)).decode())
