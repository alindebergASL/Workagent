"""Internal synthetic consent only; no browser OAuth redirect or real accounts."""
import base64
import hashlib
import secrets
import time
import httpx
from .registry import BASE, REDIRECT, AUDIENCE, endpoint

class OAuthRejected(ValueError):pass

def challenge(verifier):return base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b'=').decode()

def new_flow():
    verifier=secrets.token_urlsafe(48)
    return dict(state=secrets.token_urlsafe(32),verifier=verifier,challenge=challenge(verifier),
                issuer=BASE,audience=AUDIENCE,redirect=REDIRECT,expires=time.time()+300)

def validate_callback(flow,callback,now=None):
    if (flow['expires'] <= (time.time() if now is None else now)
        or any(not secrets.compare_digest(str(callback.get(k,'')),str(flow[k])) for k in ('state','issuer','audience','redirect'))
        or flow['issuer']!=BASE or flow['audience']!=AUDIENCE or flow['redirect']!=REDIRECT
        or challenge(flow['verifier'])!=flow['challenge']):raise OAuthRejected('synthetic callback rejected')

def post(path,body):
    # No netrc, proxy inheritance, URL credentials or redirect handling.
    with httpx.Client(trust_env=False,follow_redirects=False,timeout=5) as client:
        with client.stream('POST',endpoint(BASE+path),json=body) as r:
            if r.status_code!=200:raise OAuthRejected('synthetic provider unavailable')
            raw=b''
            for chunk in r.iter_bytes():
                raw+=chunk
                if len(raw)>8192:raise OAuthRejected('synthetic provider response too large')
    import json
    return json.loads(raw)

def exchange(flow):
    callback=post('/oauth/issue',{k:flow[k] for k in ('state','challenge','issuer','audience','redirect')})
    validate_callback(flow,callback)
    return post('/oauth/token',dict(code=callback['code'],verifier=flow['verifier'],issuer=BASE,audience=AUDIENCE,redirect=REDIRECT))

def refresh(vault,handle,still_authorized):
    with vault.refresh_lock(handle):
        still_authorized()
        value,revision=vault.read(handle)
        if value['expires']>time.time()+30:return value
        rotated=post('/oauth/refresh',{'refresh_token':value['refresh_token'],'audience':AUDIENCE})
        if (rotated.get('issuer')!=BASE or rotated.get('audience')!=AUDIENCE
            or not all(isinstance(rotated.get(k),str) and 20<=len(rotated[k])<=256 for k in ('access_token','refresh_token'))):
            raise OAuthRejected('synthetic refresh binding')
        if 'binding' in value:rotated['binding']=value['binding']
        # Keep rotated material available to a waiting local-first revoker.
        # No credential escapes until the generation is rechecked.
        vault.rotate(handle,revision,rotated)
        still_authorized()
        return rotated
