"""Explicit local fixture; synthetic tokens/accounts only. Never imports app config.

Run: python -m workagent.connectors.synthetic_server
"""
import hashlib
import secrets
import threading
import time
from mcp.server import MCPServer
from mcp.types import ToolAnnotations
from pydantic import BaseModel, Field
from starlette.responses import JSONResponse
from .registry import BASE, REDIRECT, AUDIENCE, IDENTITY
from .oauth import challenge

server=MCPServer(**IDENTITY,log_level='ERROR',extensions=[],subscriptions=False)
class CatalogItem(BaseModel):
    id: str
    title: str
    summary: str
class CatalogPage(BaseModel):
    items: list[CatalogItem]
    next_page: int | None

@server.tool(annotations=ToolAnnotations(readOnlyHint=True,destructiveHint=False,idempotentHint=True,openWorldHint=False))
async def catalog_read(page: int = Field(ge=1,le=3)) -> CatalogPage:
    """Read one fixed page of the synthetic library. All records are invented."""
    return CatalogPage(items=[CatalogItem(id=f'synthetic-{page}',title=f'Synthetic handbook {page}',
        summary='Invented local evidence for connector lifecycle testing.')],next_page=page+1 if page<3 else None)

_lock=threading.Lock(); _codes={}; _tokens={}; _refresh={}; _families={}; _token_families={}
def hashed(s):return hashlib.sha256(s.encode()).hexdigest()
def issue_tokens(family=None):
    access=secrets.token_urlsafe(32);refresh=secrets.token_urlsafe(32);expires=time.time()+300
    family=family or secrets.token_hex(16)
    _tokens[hashed(access)]=expires;_refresh[hashed(refresh)]=hashed(access)
    _families[hashed(refresh)]=family;_token_families[hashed(access)]=family
    return dict(access_token=access,refresh_token=refresh,expires=expires,issuer=BASE,audience=AUDIENCE)

def binding(b):return b.get('issuer')==BASE and b.get('audience')==AUDIENCE and b.get('redirect')==REDIRECT

@server.custom_route('/oauth/issue',methods=['POST'])
async def issue(request):
    b=await request.json()
    if not binding(b) or not 40<=len(b.get('challenge',''))<=64 or not 32<=len(b.get('state',''))<=128:
        return JSONResponse({'error':'rejected'},400)
    code=secrets.token_urlsafe(32)
    with _lock:_codes[hashed(code)]={**b,'expires':time.time()+60}
    return JSONResponse({**{k:b[k] for k in ('state','issuer','audience','redirect')},'code':code})

@server.custom_route('/oauth/token',methods=['POST'])
async def token(request):
    b=await request.json()
    with _lock:
        saved=_codes.pop(hashed(str(b.get('code',''))),None)
        if not saved or saved['expires']<=time.time() or not binding(b) or challenge(str(b.get('verifier','')))!=saved['challenge']:
            return JSONResponse({'error':'rejected'},400)
        return JSONResponse(issue_tokens())

@server.custom_route('/oauth/refresh',methods=['POST'])
async def refresh(request):
    b=await request.json()
    with _lock:
        old=_refresh.pop(hashed(str(b.get('refresh_token',''))),None)
        if not old or b.get('audience')!=AUDIENCE:return JSONResponse({'error':'rejected'},400)
        _tokens.pop(old,None)
        return JSONResponse(issue_tokens(_families[hashed(str(b.get('refresh_token','')))]))

@server.custom_route('/oauth/revoke',methods=['POST'])
async def revoke(request):
    b=await request.json()
    with _lock:
        family=_families.get(hashed(str(b.get('refresh_token',''))))
        if family:
            for key,value in list(_families.items()):
                if value==family:_refresh.pop(key,None)
            for key,value in list(_token_families.items()):
                if value==family:_tokens.pop(key,None)
        _tokens.pop(hashed(str(b.get('access_token',''))),None)
    return JSONResponse({'revoked':True})

class Guard:
    """Fixture HTTP authorization; body/header logs are deliberately absent."""
    def __init__(self,app):self.app=app
    async def __call__(self,scope,receive,send):
        if scope['type']=='http' and scope['path']=='/mcp':
            auth=dict(scope.get('headers',[])).get(b'authorization',b'').decode()
            with _lock:valid=auth.startswith('Bearer ') and _tokens.get(hashed(auth[7:]),0)>time.time()
            if not valid:
                await JSONResponse({'error':'unauthorized'},401)(scope,receive,send);return
        await self.app(scope,receive,send)

def app():return Guard(server.streamable_http_app(json_response=True,stateless_http=True,max_request_body_size=16384))

if __name__=='__main__':
    import uvicorn
    uvicorn.run(app(),host='127.0.0.1',port=18769,access_log=False,log_level='error')
