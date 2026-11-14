"""Deterministic synthetic pixels, not model or live product evidence."""
import base64
import io
import sys
from PIL import Image, ImageDraw, ImageFont
from reportlab.pdfgen.canvas import Canvas
from reportlab.lib.utils import ImageReader

FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'

def make(kind='scan', pages=1):
    out = io.BytesIO(); canvas = Canvas(out, pagesize=(600, 300), invariant=1)
    for page in range(1, pages + 1):
        if kind == 'mixed' and page % 2 == 0:
            canvas.setFont('Helvetica', 20)
            canvas.drawString(30, 240, 'Visible text page %d' % page)
            canvas.drawString(30, 200, 'Reference 00120')
        else:
            image = Image.new('RGB', (1200, 600), 'white')
            if kind != 'blank' and not (kind == 'mixed-blank' and page == pages):
                draw = ImageDraw.Draw(image); font = ImageFont.truetype(FONT, 40)
                for y, line in zip([80, 160, 240], ['Reference 00120', 'Guests 0042', 'English preview page %d' % page]):
                    draw.text((60, y), line, fill='black', font=font)
            canvas.drawImage(ImageReader(image), 0, 0, width=600, height=300)
            if kind == 'mixed':
                hidden = canvas.beginText(30, 20); hidden.setTextRenderMode(3)
                hidden.textOut('HIDDEN FALSE GROUND TRUTH 99999'); canvas.drawText(hidden)
        canvas.showPage()
    canvas.save(); return out.getvalue()

if __name__ == '__main__':
    print(base64.b64encode(make(sys.argv[1] if len(sys.argv)>1 else 'scan', int(sys.argv[2]) if len(sys.argv)>2 else 1)).decode())
