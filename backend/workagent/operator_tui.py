"""Conversational Textual HTTP client; run with --help for script commands.

Default: type a conversation, Enter adds a line, F5/Ctrl+Enter sends, Ctrl+Q detaches.
Explicit curses fallback: arrows/Enter select; : begins a command; r refreshes; q quits.
Script commands retain the existing HTTP client and immutable replay journal.
"""
import argparse
import curses
import json
import os
import shlex
import sys
from .operator_client import OperatorClient, OperatorError, identifier

ACTIONS={
    'connectors':(), 'connector-status':('connector',), 'connector-connect':(),
    'connector-confirm':('flow',), 'connector-revoke':('connector','generation'),
    'areas':(), 'conversations':(), 'show':('conversation',), 'area':('conversation',),
    'create':('title','goal','kind'), 'chat':('title',),
    'follow':('conversation','text'), 'promote':('conversation','title','goal','kind'),
    'cancel':('conversation',), 'run':('run',), 'observation':('observation',),
    'artifact':('artifact',), 'history':('artifact',), 'proposals':('artifact',),
    'review':('proposal','artifact','revision'),
    'accept':('proposal','artifact','revision'), 'dismiss':('proposal','artifact','revision'),
    'revise':('artifact','revision','version','instruction'),
    'replay':('id',), 'command':('id',),
}


def parser():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--workspace',default=os.environ.get('WORKAGENT_WORKSPACE'))
    p.add_argument('--command-id',help='New exclusive ID; use replay ID to resend the saved exact envelope after an uncertain outcome')
    subs=p.add_subparsers(dest='action')
    for action,fields in ACTIONS.items():
        help_text={'replay':'Explicitly resend a private saved envelope; never refresh CAS', 'command':'Inspect private saved scope, original payload and receipt (sensitive text)',
                   'review':'Read the exact candidate/base and server review policy before accepting',
                   'accept':'Accept the reviewed candidate/base; neither completes the goal nor publishes externally'}
        sub=subs.add_parser(action,help=help_text.get(action))
        for field in fields: sub.add_argument(field)
        if action=='follow': sub.add_argument('--target',nargs=3,metavar=('ARTIFACT','REVISION','SHA256'))
        if action=='accept':
            sub.add_argument('--acknowledge-removed-content',action='store_true',
                help='Explicitly permit removed/replaced content after reviewing this exact candidate/base')
            sub.add_argument('--acknowledge-older-proposal',action='store_true',
                help='Explicitly choose this older candidate after reviewing this exact candidate/base')
    subs.add_parser('interactive',help='Explicit legacy curses fallback')
    subs.add_parser('curses',help='Explicit legacy curses fallback')
    subs.add_parser('textual',help='Conversational UI (optional requirements-tui.lock)')
    return p


def safe(value):
    # JSON escaping prevents stored text from emitting terminal control sequences.
    return json.dumps(value,ensure_ascii=True,indent=2)


def interactive(screen,client,ws):
    curses.curs_set(0)
    screen.keypad(True)
    items=[]; index=0; selected=None; target=None; lines=[]; offset=0; entry=None
    def display(value):
        nonlocal lines,offset
        lines=safe(value).splitlines(); offset=0
    def refresh():
        nonlocal items,index
        items=client.run(ws,'areas',[])['items']; index=min(index,max(0,len(items)-1))
        display(client.run(ws,'show',[selected]) if selected else {'spaces':items})
    def execute(text):
        nonlocal selected,target
        words=shlex.split(text)
        if not words: return
        action,*args=words
        if action=='use':
            selected=identifier(args[0]); target=None; refresh(); return
        if action=='target':
            if len(args)!=3: raise OperatorError('target ARTIFACT REVISION SHA256')
            target=args; display({'selected':selected,'exact_target':target}); return
        if action=='untarget': target=None; return
        if action=='refresh': refresh(); return
        if action=='prompt':
            if selected is None: raise OperatorError('Select a conversation first')
            action='follow'; args=[selected,' '.join(args),*(target or [])]
        if action=='cancel' and not args:
            if selected is None: raise OperatorError('Select a conversation first')
            args=[selected]
        if action not in ACTIONS: raise OperatorError('Unknown command; use CLI --help for arguments')
        acknowledgements={'acknowledge_removed_content':False,'acknowledge_older_proposal':False}
        if action=='accept':
            # Per-command switches only: refresh, selection and replay never
            # retain or infer consent from a previously inspected proposal.
            for field in acknowledgements:
                flag='--'+field.replace('_','-')
                if flag in args:
                    acknowledgements[field]=True
                    args.remove(flag)
        expected=len(ACTIONS[action])
        if len(args)!=expected and not (action=='follow' and len(args)==5):
            raise OperatorError('Arguments: '+action+' '+' '.join(ACTIONS[action]))
        def announce(value):
            display(value)
            screen.erase()
            try: screen.addnstr(0,0,'Sending command '+value['command_id']+'; no automatic retry',max(0,screen.getmaxyx()[1]-1))
            except curses.error: pass
            screen.refresh()
        result=client.run(ws,action,args,announce=announce,**acknowledgements)
        if action in ('create','chat'): selected=result['receipt']['id']
        display(result)
    try: refresh()
    except OperatorError as e: display({'error':str(e)})
    while True:
        height,width=screen.getmaxyx(); screen.erase()
        def put(y,text):
            if 0<=y<height:
                try: screen.addnstr(y,0,text,max(0,width-1))
                except curses.error: pass
        put(0,'Workagent operator | HTTP admission only | no worker execution')
        put(1,'Space: '+(selected or '(arrows + Enter to select)'))
        put(2,'Target: '+('/'.join(target) if target else 'conversation (no artifact target)'))
        put(3,'r refresh | : command | PgUp/PgDn scroll | q quit')
        if selected is None and items:
            put(4,'> '+items[index]['title']+' ['+items[index]['id']+']')
        visible=max(0,height-7)
        for y,line in enumerate(lines[offset:offset+visible],5): put(y,line)
        put(height-2,'review P A REV before accept P A REV [--acknowledge-removed-content] [--acknowledge-older-proposal] | command ID | replay ID')
        put(height-1,': '+entry if entry is not None else 'Ready. Writes are never retried automatically.')
        screen.refresh()
        key=screen.get_wch()
        if key==curses.KEY_RESIZE: continue
        if entry is not None:
            if key in ('\n','\r',curses.KEY_ENTER):
                text=entry; entry=None; curses.curs_set(0)
                try: execute(text)
                except (OperatorError,ValueError,IndexError) as e: display({'error':str(e) if isinstance(e,OperatorError) else 'Invalid command arguments'})
            elif key=='\x1b': entry=None; curses.curs_set(0)
            elif key in (curses.KEY_BACKSPACE,'\x7f','\b'): entry=entry[:-1]
            elif isinstance(key,str) and key.isprintable(): entry+=key
            continue
        if key=='q': break
        if key==':': entry=''; curses.curs_set(1)
        elif key in (curses.KEY_UP,'k'): index=max(0,index-1)
        elif key in (curses.KEY_DOWN,'j'): index=min(max(0,len(items)-1),index+1)
        elif key in ('\n','\r',curses.KEY_ENTER) and items:
            selected=items[index]['id']; target=None
            try: refresh()
            except OperatorError as e: display({'error':str(e)})
        elif key=='r':
            try: refresh()
            except OperatorError as e: display({'error':str(e)})
        elif key==curses.KEY_NPAGE: offset=min(max(0,len(lines)-visible),offset+max(1,visible))
        elif key==curses.KEY_PPAGE: offset=max(0,offset-max(1,visible))


def main(argv=None):
    p=parser(); args=p.parse_args(argv)
    if not args.workspace: p.error('--workspace or WORKAGENT_WORKSPACE is required')
    try:
        client=OperatorClient()
        if args.action in (None,'textual'):
            try:
                from .tui.app import WorkagentApp
            except ImportError:
                raise OperatorError('Textual is optional: install requirements-tui.lock, or choose the explicit curses fallback') from None
            WorkagentApp(client,identifier(args.workspace)).run()
        elif args.action in ('interactive','curses'):
            if not sys.stdin.isatty(): raise OperatorError('Interactive console requires a terminal')
            curses.wrapper(interactive,client,identifier(args.workspace))
        else:
            fields=[getattr(args,key) for key in ACTIONS[args.action]]
            if args.action=='follow' and args.target: fields.extend(args.target)
            result=client.run(args.workspace,args.action,fields,command_id=args.command_id,
                acknowledge_removed_content=getattr(args,'acknowledge_removed_content',False),
                acknowledge_older_proposal=getattr(args,'acknowledge_older_proposal',False),
                announce=lambda value:print(safe(value),file=sys.stderr,flush=True))
            print(safe(result))
        return 0
    except ValueError:
        print(safe({'error':'Invalid command arguments'}),file=sys.stderr)
        return 2
    except (OperatorError,KeyboardInterrupt) as exc:
        print(safe({'error':str(exc) or 'Interrupted; inspect saved state before any new command'}),file=sys.stderr)
        return 2


if __name__=='__main__':
    raise SystemExit(main())
