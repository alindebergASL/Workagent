"""Keep composer bytes exact while neutralizing terminal control characters."""
import unicodedata
from rich.segment import Segment
from textual.strip import Strip
from textual.widgets import TextArea
from textual.document._document import Document, EditResult
from textual.document._wrapped_document import WrappedDocument
from textual.document._document_navigator import DocumentNavigator


class ExactDocument(Document):
    """Only LF is structural. CR, BOM and Unicode separators retain exact bytes."""
    def __init__(self,text):
        self._newline='\n'
        self._lines=text.split('\n')

    def replace_range(self,start,end,text):
        top,bottom=sorted((start,end));row,column=top;last_row,last_column=bottom
        replaced=self.get_text_range(top,bottom)
        before=self._lines[row][:column] if row<len(self._lines) else ''
        after=self._lines[last_row][last_column:] if last_row<len(self._lines) else ''
        inserted=text.split('\n')
        inserted[0]=before+inserted[0]
        destination=(row+len(inserted)-1,len(inserted[-1]))
        inserted[-1]+=after
        self._lines[row:last_row+1]=inserted
        return EditResult(destination,replaced)



class Composer(TextArea):
    def _set_document(self,text,language):
        # Textual 8.2.8's stock Document uses splitlines(), which normalizes mixed
        # CR/LF and Unicode line separators. This pinned plain document preserves
        # them through editing, undo, staging and restart.
        self._highlight_query=None
        self.document=ExactDocument(text)
        self.wrapped_document=WrappedDocument(self.document,tab_width=self.indent_width)
        self.navigator=DocumentNavigator(self.wrapped_document)
        self._build_highlight_map()
        self.move_cursor((0,0))
        self._rewrap_and_refresh_virtual_size()

    def render_line(self,y):
        strip=super().render_line(y)
        # The buffer (and therefore draft/snapshot) remains exact. Escaping at
        # the final render boundary prevents pasted OSC/CSI/bidi from becoming
        # terminal instructions. Ordinary Unicode and Rich-like text stay text.
        segments=[]
        for segment in strip:
            text=''.join('\\u%04x'%ord(c) if unicodedata.category(c) in ('Cc','Cf','Cs')
                         else c for c in segment.text)
            segments.append(Segment(text,segment.style))
        return Strip(segments).crop(0,self.size.width)
