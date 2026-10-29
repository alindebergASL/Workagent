"""Parent-owned actual PTY recorder; not a Textual run_test/pilot substitute."""
import os
import codecs
from pathlib import Path
import time
import pexpect
import pyte
from PIL import Image, ImageDraw, ImageFont


class Terminal:
    def __init__(self, argv, cwd, env, cols, rows, prefix):
        self.cols, self.rows = cols, rows
        self.prefix = Path(prefix)
        self.prefix.parent.mkdir(parents=True, exist_ok=True)
        self.screen = pyte.Screen(cols, rows)
        self.stream = pyte.Stream(self.screen)
        self.raw = bytearray()
        self.decoder = codecs.getincrementaldecoder('utf-8')(errors='replace')
        self.child = pexpect.spawn(argv[0], argv[1:], cwd=str(cwd), env={**os.environ, **env, 'TERM':'xterm-256color'},
                                   dimensions=(rows,cols), encoding=None, timeout=1)

    def pump(self, seconds=.2):
        until=time.monotonic()+seconds
        while time.monotonic()<until:
            try:
                chunk=self.child.read_nonblocking(65536,timeout=min(.1,max(.01,until-time.monotonic())))
            except pexpect.TIMEOUT:
                continue
            except pexpect.EOF:
                break
            self.raw.extend(chunk)
            self.stream.feed(self.decoder.decode(chunk))
        return self.text

    @property
    def text(self):
        return '\n'.join(self.screen.display)

    def wait(self, text, timeout=20):
        end=time.monotonic()+timeout
        while time.monotonic()<end:
            self.pump(.2)
            if text in self.text:
                return self.text
        self.capture('timeout')
        raise AssertionError('Actual PTY did not show '+repr(text)+'\n'+self.text)

    def send(self, text):
        self.child.send(text.encode('utf-8'))
        self.pump(.15)

    def capture(self, name):
        self.pump(.3)
        root=self.prefix.with_name(self.prefix.name+'-'+name)
        root.with_suffix('.txt').write_text(self.text)
        root.with_suffix('.ansi').write_bytes(self.raw)
        font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',15)
        cellw,cellh=10,20
        image=Image.new('RGB',(self.cols*cellw+16,self.rows*cellh+16),'#101216')
        draw=ImageDraw.Draw(image)
        palette={'default':'#e8e8e8','black':'#000000','red':'#cc5555','green':'#55cc55','brown':'#cccc55','blue':'#5555cc','magenta':'#cc55cc','cyan':'#55cccc','white':'#e8e8e8'}
        def color(value, default):
            if value=='default': return default
            return '#'+value if len(value)==6 else palette.get(value,default)
        for y in range(self.rows):
            for x in range(self.cols):
                cell=self.screen.buffer[y][x]
                fg,bg=color(cell.fg,'#e8e8e8'),color(cell.bg,'#101216')
                if cell.reverse: fg,bg=bg,fg
                draw.rectangle((8+x*cellw,8+y*cellh,8+(x+1)*cellw,8+(y+1)*cellh),fill=bg)
                draw.text((8+x*cellw,8+y*cellh),cell.data,font=font,fill=fg)
        print('cursor',self.screen.cursor.x,self.screen.cursor.y,'hidden',self.screen.cursor.hidden)
        image.save(root.with_suffix('.png'))
        return str(root.with_suffix('.png'))

    def close(self):
        if self.child.isalive():
            self.send('\x11')
            self.pump(.5)
        if self.child.isalive():
            self.child.terminate(force=True)
        self.child.close()
        self.prefix.with_suffix('.ansi').write_bytes(self.raw)
