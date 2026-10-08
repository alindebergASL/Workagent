"""Import-free bounded WebAssembly execution capability (not a broker).

No WASI, host callbacks, filesystem, networking or subprocess imports are linked.
The caller must check current scope/fence, exact code version and commit authority.
An observed return value establishes execution only, not business-goal completion.
"""
import hashlib
import importlib.metadata
import json
import re

ENGINE_VERSION = '49.0.0'
MAX_CODE_BYTES = 16_000
MAX_ARGUMENTS = 8
FUEL = 50_000
MEMORY_BYTES = 1_048_576


class ToolRejected(ValueError):
    def __init__(self, message, code='wasm_rejected'):
        super().__init__(message)
        self.code=code


def run_wasm_tool(code: str, entrypoint: str, arguments: list[int], *, _cases=None) -> dict | list[int]:
    if (not isinstance(code, str) or not code or len(code.encode('utf-8')) > MAX_CODE_BYTES
            or not isinstance(entrypoint, str) or not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]{0,63}', entrypoint)
            or not isinstance(arguments, list) or len(arguments) > MAX_ARGUMENTS
            or any(type(v) is not int or not -(10**9) <= v <= 10**9 for v in arguments)):
        raise ToolRejected('invalid code, entrypoint or bounded integer arguments')
    try:
        if importlib.metadata.version('wasmtime') != ENGINE_VERSION:
            raise ToolRejected('reviewed execution engine version required')
        import wasmtime
    except (ImportError, importlib.metadata.PackageNotFoundError) as exc:
        raise ToolRejected('reviewed WebAssembly engine unavailable; no host fallback') from exc
    config = wasmtime.Config()
    config.consume_fuel = True
    config.wasm_threads = False
    config.wasm_memory64 = False
    config.wasm_multi_memory = False
    # No cache, provider credentials, WASI configuration or implicit host imports.
    try:
        with wasmtime.Engine(config) as engine:
            with wasmtime.Module(engine, code) as module:
                if module.imports:
                    raise ToolRejected('host/WASI imports forbidden')
                values = []
                for arguments in (_cases if _cases is not None else [arguments]):
                    with wasmtime.Store(engine) as store:
                        store.set_limits(memory_size=MEMORY_BYTES, table_elements=64, instances=1, tables=1, memories=1)
                        store.set_fuel(FUEL)
                        instance = wasmtime.Instance(store, module, [])
                        function = instance.exports(store).get(entrypoint)
                        if not isinstance(function, wasmtime.Func):
                            raise ToolRejected('function entrypoint missing')
                        signature = function.type(store)
                        if ([str(x) for x in signature.params] != ['i64'] * len(arguments)
                                or [str(x) for x in signature.results] != ['i64']):
                            raise ToolRejected('bounded i64 parameters and one i64 result required')
                        value = function(store, *arguments)
                        fuel_consumed = FUEL - store.get_fuel()
                    values.append(value)
                if _cases is not None:
                    return values
    except wasmtime.Trap as exc:
        # Only the engine's enum classification; never echo source/backtrace text.
        code={'UNREACHABLE':'wasm_unreachable','OUT_OF_FUEL':'wasm_fuel_exhausted',
              'INTEGER_DIVISION_BY_ZERO':'wasm_division_by_zero'}.get(
                  getattr(exc.trap_code,'name',None),'wasm_trap')
        raise ToolRejected('WebAssembly execution trapped',code) from exc
    except wasmtime.WasmtimeError as exc:
        raise ToolRejected('WebAssembly compilation or resource check failed','wasm_compile_or_resource') from exc
    material = json.dumps({'entrypoint':entrypoint,'arguments':arguments},sort_keys=True,separators=(',',':'))
    return {'value':value, 'entrypoint':entrypoint, 'arguments':list(arguments),
            'code_sha256':hashlib.sha256(code.encode('utf-8')).hexdigest(),
            'input_sha256':hashlib.sha256(material.encode('utf-8')).hexdigest(),
            'engine':'wasmtime-'+ENGINE_VERSION, 'execution_observed':True,
            'fuel_consumed':fuel_consumed, 'fuel_limit':FUEL, 'memory_limit_bytes':MEMORY_BYTES,
            'host_imports':0}
