"""Dedicated encrypted fixture vault. App DB holds opaque handles only.

Per-record data keys are wrapped by the configured key id. Refresh uses a file
lock, never a database transaction across network I/O. Tombstones prevent a late
refresh from recreating removed credentials. Vault directory must be private.
"""
import base64
import fcntl
import json
import os
from pathlib import Path
import sqlite3
from contextlib import contextmanager
from uuid import uuid4
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

class Vault:
    def __init__(self, directory, key_id, key):
        self.root=Path(directory); self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        if self.root.is_symlink() or self.root.stat().st_mode & 0o077: raise ValueError('private vault directory required')
        if len(key)!=32 or not key_id: raise ValueError('vault key required')
        self.key_id=key_id; self.key=key
        self.path=self.root/'vault.sqlite3'
        with self.db() as c:
            c.execute('CREATE TABLE IF NOT EXISTS secrets(handle TEXT PRIMARY KEY, envelope BLOB, revision INTEGER NOT NULL)')
        os.chmod(self.path,0o600)
    @contextmanager
    def db(self):
        c=sqlite3.connect(self.path,timeout=10)
        try:
            with c: yield c
        finally:c.close()
    def seal(self, handle, value):
        dek=os.urandom(32); n=os.urandom(12); w=os.urandom(12); aad=(self.key_id+':'+handle).encode()
        return json.dumps({'kid':self.key_id,'nonce':n.hex(),'wrap_nonce':w.hex(),
            'wrapped':AESGCM(self.key).encrypt(w,dek,aad).hex(),
            'ciphertext':AESGCM(dek).encrypt(n,json.dumps(value).encode(),aad).hex()}).encode()
    def open(self,handle,blob):
        d=json.loads(blob)
        if d['kid']!=self.key_id: raise ValueError('vault key unavailable')
        aad=(self.key_id+':'+handle).encode()
        dek=AESGCM(self.key).decrypt(bytes.fromhex(d['wrap_nonce']),bytes.fromhex(d['wrapped']),aad)
        return json.loads(AESGCM(dek).decrypt(bytes.fromhex(d['nonce']),bytes.fromhex(d['ciphertext']),aad))
    def put(self,value):
        handle=str(uuid4())
        with self.db() as c:c.execute('INSERT INTO secrets VALUES(?,?,1)',(handle,self.seal(handle,value)))
        return handle
    def read(self,handle):
        with self.db() as c:row=c.execute('SELECT envelope,revision FROM secrets WHERE handle=?',(handle,)).fetchone()
        if not row or row[0] is None: raise ValueError('credential unavailable')
        return self.open(handle,row[0]),row[1]
    def rotate(self,handle,revision,value):
        with self.db() as c:
            changed=c.execute('UPDATE secrets SET envelope=?,revision=revision+1 WHERE handle=? AND revision=? AND envelope IS NOT NULL',
                (self.seal(handle,value),handle,revision)).rowcount
        if changed!=1: raise ValueError('credential revoked or rotated')
    def remove(self,handle):
        if not handle:return
        with self.db() as c:c.execute('UPDATE secrets SET envelope=NULL,revision=revision+1 WHERE handle=?',(handle,))
    @contextmanager
    def refresh_lock(self,handle):
        # UUID from database, never a user-supplied filename.
        if str(__import__('uuid').UUID(handle))!=handle:raise ValueError('invalid handle')
        with open(self.root/(handle+'.lock'),'a',opener=lambda p,f:os.open(p,f|os.O_NOFOLLOW,0o600)) as lock:
            fcntl.flock(lock,fcntl.LOCK_EX)
            try:yield
            finally:fcntl.flock(lock,fcntl.LOCK_UN)
