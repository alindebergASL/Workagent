#!/usr/bin/env python3
"""Recheck published synthetic downloads; no provider or Workagent oracle imports."""
import argparse
import csv
from decimal import Decimal, ROUND_HALF_UP
import hashlib
import io
import json
import math
from pathlib import Path
import wasmtime

p=argparse.ArgumentParser(description=__doc__)
p.add_argument('directory',type=Path)
a=p.parse_args(); root=a.directory
source=list(csv.DictReader(io.StringIO((root/'source.csv').read_text())))
actual=list(csv.DictReader(io.StringIO((root/'verified-invoices.csv').read_text())))
assert len(source)==len(actual)==6
mismatches=0
for original,result in zip(source,actual,strict=True):
    assert all(result[k]==v for k,v in original.items())
    expected=(Decimal(original['quantity'])*Decimal(original['unit_price'])).quantize(Decimal('.01'),rounding=ROUND_HALF_UP)
    difference=Decimal(original['reported_total'])-expected
    assert result['calculated_total']==f'{expected:.2f}'
    assert result['difference']==f'{difference:.2f}'
    assert result['check']==('matched' if difference==0 else 'discrepancy')
    mismatches+=difference!=0
config=wasmtime.Config(); config.consume_fuel=True; config.wasm_threads=False
engine=wasmtime.Engine(config)
module=wasmtime.Module(engine,(root/'proposed-team-calculator.wat').read_text())
assert not module.imports
exports=[e.name for e in module.exports if isinstance(e.type,wasmtime.FuncType)]
assert len(exports)==1
count=0
for n in range(61):
    for k in range(n+1):
        with wasmtime.Store(engine) as store:
            store.set_limits(memory_size=1048576,table_elements=64,instances=1,tables=1,memories=1)
            store.set_fuel(50000)
            instance=wasmtime.Instance(store,module,[])
            assert instance.exports(store)[exports[0]](store,n,k)==math.comb(n,k),(n,k)
        count+=1
print(json.dumps({'passed':True,'csv_rows':len(source),'discrepancies':mismatches,'wasm_cases':count,
    'hashes':{name:hashlib.sha256((root/name).read_bytes()).hexdigest() for name in ['source.csv','verified-invoices.csv','proposed-team-calculator.wat']}}))
